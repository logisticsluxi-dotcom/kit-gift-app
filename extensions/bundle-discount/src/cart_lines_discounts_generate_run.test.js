import { describe, expect, it } from "vitest";
import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run";

const line = (id, variant, product, vendor, quantity = 1, attrs = {}) => ({
  id,
  quantity,
  kit: attrs.kit ? { value: attrs.kit } : null,
  gift: attrs.gift ? { value: attrs.gift } : null,
  merchandise: {
    __typename: "ProductVariant",
    id: variant,
    product: { id: product, vendor },
  },
});

const run = (lines, config) =>
  cartLinesDiscountsGenerateRun({
    cart: { lines },
    discount: { discountClasses: ["PRODUCT"], metafield: { jsonValue: config } },
  });

const giftRule = {
  id: "g1",
  enabled: true,
  message: "Free tote",
  triggerType: "products",
  triggerProductIds: ["P1"],
  triggerVendors: [],
  minTriggerQty: 1,
  giftVariantIds: ["GV"],
  giftQuantity: 1,
};

const kit = {
  enabled: true,
  message: "Kit {percent}% off",
  vendors: ["Acme"],
  tiers: [
    { minItems: 3, percent: 10 },
    { minItems: 5, percent: 20 },
  ],
};

const candidates = (result) =>
  result.operations[0]?.productDiscountsAdd.candidates ?? [];

describe("free gift", () => {
  it("makes the gift free when the trigger product is in the cart", () => {
    const result = run(
      [line("L1", "V1", "P1", "Acme"), line("L2", "GV", "PG", "Acme", 1, { gift: "g1" })],
      { gifts: [giftRule] },
    );
    expect(candidates(result)).toEqual([
      {
        message: "Free tote",
        targets: [{ cartLine: { id: "L2", quantity: 1 } }],
        value: { percentage: { value: 100 } },
      },
    ]);
  });

  it("does nothing without the trigger product", () => {
    const result = run([line("L2", "GV", "PG", "Acme")], { gifts: [giftRule] });
    expect(result.operations).toEqual([]);
  });

  it("only discounts the configured gift quantity", () => {
    const result = run(
      [line("L1", "V1", "P1", "Acme"), line("L2", "GV", "PG", "Acme", 3)],
      { gifts: [giftRule] },
    );
    expect(candidates(result)[0].targets).toEqual([{ cartLine: { id: "L2", quantity: 1 } }]);
  });

  it("supports buy-one-get-one of the same product", () => {
    const bogo = { ...giftRule, triggerProductIds: ["PG"] };
    expect(run([line("L1", "GV", "PG", "Acme", 1)], { gifts: [bogo] }).operations).toEqual([]);
    const result = run([line("L1", "GV", "PG", "Acme", 2)], { gifts: [bogo] });
    expect(candidates(result)[0].targets).toEqual([{ cartLine: { id: "L1", quantity: 1 } }]);
  });

  it("lets the shopper pick any one of several gift options", () => {
    const rule = { ...giftRule, giftVariantIds: ["GA", "GB", "GC"] };
    const result = run(
      [
        line("L1", "V1", "P1", "Acme"),
        line("L2", "GB", "PB", "Acme", 1, { gift: "g1" }),
        line("L3", "GC", "PC", "Acme", 1),
      ],
      { gifts: [rule] },
    );
    // Only one free unit in total, and the tagged gift line wins.
    expect(candidates(result).flatMap((c) => c.targets)).toEqual([
      { cartLine: { id: "L2", quantity: 1 } },
    ]);
  });

  it("still reads the older single-gift format", () => {
    const { giftVariantIds, ...legacy } = giftRule;
    const result = run(
      [line("L1", "V1", "P1", "Acme"), line("L2", giftVariantIds[0], "PG", "Acme")],
      { gifts: [{ ...legacy, giftVariantId: "GV" }] },
    );
    expect(candidates(result)).toHaveLength(1);
  });

  it("triggers by vendor", () => {
    const rule = { ...giftRule, triggerType: "vendors", triggerVendors: ["acme "], minTriggerQty: 2 };
    expect(run([line("L1", "V1", "P9", "Acme"), line("L2", "GV", "PG", "X")], { gifts: [rule] }).operations).toEqual([]);
    const result = run([line("L1", "V1", "P9", "Acme", 2), line("L2", "GV", "PG", "X")], { gifts: [rule] });
    expect(candidates(result)).toHaveLength(1);
  });
});

describe("build your own kit", () => {
  it("applies the highest tier reached", () => {
    const lines = [1, 2, 3, 4, 5].map((n) => line(`L${n}`, `V${n}`, `P${n}`, "Acme", 1, { kit: "k1" }));
    const [c] = candidates(run(lines, { kit }));
    expect(c.value).toEqual({ percentage: { value: 20 } });
    expect(c.message).toBe("Kit 20% off");
    expect(c.targets).toHaveLength(5);
  });

  it("requires the minimum item count", () => {
    const lines = [1, 2].map((n) => line(`L${n}`, `V${n}`, `P${n}`, "Acme", 1, { kit: "k1" }));
    expect(run(lines, { kit }).operations).toEqual([]);
  });

  it("counts quantities and ignores other vendors and non-kit lines", () => {
    const lines = [
      line("L1", "V1", "P1", "Acme", 2, { kit: "k1" }),
      line("L2", "V2", "P2", "Other", 5, { kit: "k1" }),
      line("L3", "V3", "P3", "Acme", 5),
    ];
    expect(run(lines, { kit }).operations).toEqual([]);
    lines.push(line("L4", "V4", "P4", "Acme", 1, { kit: "k1" }));
    const [c] = candidates(run(lines, { kit }));
    expect(c.value).toEqual({ percentage: { value: 10 } });
    expect(c.targets.map((t) => t.cartLine.id)).toEqual(["L1", "L4"]);
  });

  it("prices each kit separately", () => {
    const lines = [
      ...[1, 2, 3].map((n) => line(`A${n}`, `V${n}`, `P${n}`, "Acme", 1, { kit: "k1" })),
      ...[1, 2].map((n) => line(`B${n}`, `V${n}`, `P${n}`, "Acme", 1, { kit: "k2" })),
    ];
    const cs = candidates(run(lines, { kit }));
    expect(cs).toHaveLength(1);
    expect(cs[0].targets.map((t) => t.cartLine.id)).toEqual(["A1", "A2", "A3"]);
  });
});

it("returns nothing for non-product discount classes", () => {
  const result = cartLinesDiscountsGenerateRun({
    cart: { lines: [] },
    discount: { discountClasses: ["ORDER"], metafield: { jsonValue: { kit } } },
  });
  expect(result).toEqual({ operations: [] });
});
