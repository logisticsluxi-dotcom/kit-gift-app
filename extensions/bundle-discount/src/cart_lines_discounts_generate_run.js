// @ts-check

/**
 * Config is written by the admin app to the discount's `$app:kitgift.config` metafield.
 *
 * {
 *   gifts: [{
 *     id, enabled, message,
 *     triggerType: "products" | "vendors" | "any",
 *     triggerProductIds: string[],   // product GIDs
 *     triggerVendors: string[],
 *     minTriggerQty: number,         // units of trigger items required
 *     giftVariantIds: string[],      // variant GIDs the shopper can pick from
 *     giftQuantity: number,          // free units granted (across all options)
 *   }],
 *   kit: {
 *     enabled, message,
 *     vendors: string[],             // empty = any vendor
 *     tiers: [{ minItems: number, percent: number }],
 *   }
 * }
 */

const EMPTY = { operations: [] };

/**
 * @param {any} input
 */
export function cartLinesDiscountsGenerateRun(input) {
  const classes = input.discount?.discountClasses ?? [];
  if (!classes.includes("PRODUCT")) return EMPTY;

  const config = input.discount?.metafield?.jsonValue;
  if (!config) return EMPTY;

  const lines = (input.cart?.lines ?? []).filter(
    (/** @type {any} */ l) => l.merchandise?.__typename === "ProductVariant",
  );

  const candidates = [];
  /** Line IDs already discounted as gifts — excluded from kit pricing. */
  const giftLineIds = new Set();

  for (const rule of config.gifts ?? []) {
    if (!rule.enabled || giftVariants(rule).size === 0) continue;
    const result = applyGiftRule(rule, lines);
    for (const target of result) {
      giftLineIds.add(target.cartLine.id);
      candidates.push({
        message: rule.message || "Free gift",
        targets: [target],
        value: { percentage: { value: 100 } },
      });
    }
  }

  if (config.kit?.enabled) {
    candidates.push(...applyKit(config.kit, lines, giftLineIds));
  }

  if (candidates.length === 0) return EMPTY;

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: "ALL",
        },
      },
    ],
  };
}

/**
 * @param {any} rule
 * @param {any[]} lines
 * @returns {{ cartLine: { id: string, quantity: number } }[]}
 */
export function applyGiftRule(rule, lines) {
  const vendors = (rule.triggerVendors ?? []).map(norm);
  const productIds = new Set(rule.triggerProductIds ?? []);
  const isTrigger = (/** @type {any} */ line) => {
    const product = line.merchandise.product;
    if (rule.triggerType === "any") return true;
    if (rule.triggerType === "vendors") return vendors.includes(norm(product.vendor));
    return productIds.has(product.id);
  };
  const variants = giftVariants(rule);
  const isGift = (/** @type {any} */ line) => variants.has(line.merchandise.id);

  const minTrigger = Math.max(1, Number(rule.minTriggerQty) || 1);
  const maxFree = Math.max(1, Number(rule.giftQuantity) || 1);

  // Lines tagged by the storefront as this rule's gift come first, then any other
  // line of the gift variant (e.g. customer added it manually).
  const giftLines = lines
    .filter(isGift)
    .sort((a, b) => Number(!!b.gift?.value) - Number(!!a.gift?.value));
  if (giftLines.length === 0) return [];

  const triggerQty = lines
    .filter(isTrigger)
    .reduce((sum, l) => sum + l.quantity, 0);

  // If the gift itself counts as a trigger (classic "buy 1 get 1 of the same item"),
  // units given away free can't also count toward unlocking the gift.
  const giftIsTrigger = giftLines.some(isTrigger);
  let free = maxFree;
  if (giftIsTrigger) {
    free = Math.min(free, triggerQty - minTrigger);
  } else if (triggerQty < minTrigger) {
    free = 0;
  }
  if (free <= 0) return [];

  const targets = [];
  for (const line of giftLines) {
    if (free <= 0) break;
    const qty = Math.min(line.quantity, free);
    targets.push({ cartLine: { id: line.id, quantity: qty } });
    free -= qty;
  }
  return targets;
}

/**
 * Lines added through the kit builder carry a `_kit` attribute (one ID per kit).
 * Each kit is priced on its own, using the best tier its item count reaches.
 *
 * @param {any} kit
 * @param {any[]} lines
 * @param {Set<string>} excludeIds
 */
export function applyKit(kit, lines, excludeIds) {
  const vendors = (kit.vendors ?? []).map(norm);
  const tiers = [...(kit.tiers ?? [])]
    .filter((t) => Number(t.minItems) > 0 && Number(t.percent) > 0)
    .sort((a, b) => b.minItems - a.minItems);
  if (tiers.length === 0) return [];

  /** @type {Map<string, any[]>} */
  const kits = new Map();
  for (const line of lines) {
    const kitId = line.kit?.value;
    if (!kitId || excludeIds.has(line.id)) continue;
    if (vendors.length && !vendors.includes(norm(line.merchandise.product.vendor))) continue;
    if (!kits.has(kitId)) kits.set(kitId, []);
    kits.get(kitId)?.push(line);
  }

  const candidates = [];
  for (const kitLines of kits.values()) {
    const count = kitLines.reduce((sum, l) => sum + l.quantity, 0);
    const tier = tiers.find((t) => count >= t.minItems);
    if (!tier) continue;
    candidates.push({
      message: (kit.message || "Kit savings: {percent}% off").replace(
        "{percent}",
        String(tier.percent),
      ),
      targets: kitLines.map((l) => ({ cartLine: { id: l.id } })),
      value: { percentage: { value: Math.min(100, Number(tier.percent)) } },
    });
  }
  return candidates;
}

/**
 * @param {any} rule
 * @returns {Set<string>}
 */
function giftVariants(rule) {
  // `giftVariantId` is the older single-gift format.
  return new Set([...(rule.giftVariantIds ?? []), rule.giftVariantId].filter(Boolean));
}

/** @param {string | undefined | null} s */
function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}
