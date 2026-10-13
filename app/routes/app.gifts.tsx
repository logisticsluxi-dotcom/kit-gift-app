import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadConfig, saveConfig } from "../lib/config.server";
import { newGiftRule, unique, type GiftOption, type GiftRule } from "../lib/config";
import { Checkbox, NumberField, Select, TextField } from "../components/fields";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { config, vendors } = await loadConfig(admin);
  return { gifts: config.gifts, vendors, discountActive: Boolean(config.discountId) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const gifts = JSON.parse(String((await request.formData()).get("gifts"))) as GiftRule[];
  const invalid = gifts.find((g) => g.enabled && g.giftOptions.length === 0);
  if (invalid) return { ok: false, error: `“${invalid.name || "Untitled"}” needs at least one gift product` };
  try {
    const { config } = await loadConfig(admin);
    await saveConfig(admin, { ...config, gifts });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
};

type PickedProduct = {
  id: string;
  title: string;
  vendor?: string;
  images?: { originalSrc?: string; url?: string }[];
  variants?: { id: string; price?: string; title?: string }[];
};

export default function Gifts() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [gifts, setGifts] = useState<GiftRule[]>(data.gifts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const saving = fetcher.state !== "idle";
  const editing = gifts.find((g) => g.id === editingId) ?? null;

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show("Gift offers saved");
    else shopify.toast.show(fetcher.data.error ?? "Could not save", { isError: true });
  }, [fetcher.data, shopify]);

  const update = (id: string, patch: Partial<GiftRule>) =>
    setGifts((all) => all.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const save = (next = gifts) => fetcher.submit({ gifts: JSON.stringify(next) }, { method: "POST" });

  const addRule = () => {
    const rule = newGiftRule();
    setGifts((all) => [...all, rule]);
    setEditingId(rule.id);
  };

  const removeRule = (id: string) => {
    const next = gifts.filter((g) => g.id !== id);
    setGifts(next);
    setEditingId(null);
    save(next);
  };

  const pickTriggers = async (rule: GiftRule) => {
    const selected = (await shopify.resourcePicker({
      type: "product",
      multiple: true,
      filter: { variants: false },
      selectionIds: rule.triggerProducts.map((p) => ({ id: p.id })),
    })) as PickedProduct[] | undefined;
    if (selected) {
      update(rule.id, { triggerProducts: selected.map((p) => ({ id: p.id, title: p.title })) });
    }
  };

  const pickGifts = async (rule: GiftRule) => {
    const byProduct = new Map<string, string[]>();
    for (const o of rule.giftOptions) byProduct.set(o.productId, [...(byProduct.get(o.productId) ?? []), o.variantId]);
    const selected = (await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "select",
      selectionIds: [...byProduct].map(([id, variantIds]) => ({ id, variants: variantIds.map((v) => ({ id: v })) })),
    })) as PickedProduct[] | undefined;
    if (!selected) return;
    // One option per selected variant, so a shopper can pick e.g. a specific shade.
    const giftOptions: GiftOption[] = selected.flatMap((product) =>
      (product.variants ?? []).map((variant) => ({
        productId: product.id,
        variantId: variant.id,
        title:
          variant.title && variant.title !== "Default Title" ? `${product.title} – ${variant.title}` : product.title,
        image: product.images?.[0]?.originalSrc ?? product.images?.[0]?.url ?? "",
        price: variant.price ?? "",
        vendor: product.vendor ?? "",
      })),
    );
    update(rule.id, {
      giftOptions,
      name: rule.name || (giftOptions.length === 1 ? `Free ${giftOptions[0].title}` : "Free gift"),
    });
  };

  const removeGiftOption = (rule: GiftRule, variantId: string) =>
    update(rule.id, { giftOptions: rule.giftOptions.filter((o) => o.variantId !== variantId) });

  const describeTrigger = (g: GiftRule) => {
    const qty = g.minTriggerQty > 1 ? `${g.minTriggerQty}+ of ` : "";
    if (g.triggerType === "any") return `${qty}any product`;
    if (g.triggerType === "vendors") return `${qty}${g.triggerVendors.join(", ") || "(no vendors)"}`;
    return `${qty}${g.triggerProducts.map((p) => p.title).join(", ") || "(no products)"}`;
  };

  if (editing) {
    return (
      <s-page heading={editing.name || "New gift offer"}>
        <s-button slot="primary-action" variant="primary" onClick={() => save()} {...(saving ? { loading: true } : {})}>
          Save
        </s-button>
        <s-button slot="secondary-actions" onClick={() => setEditingId(null)}>
          Back to all offers
        </s-button>

        <s-section heading="Offer">
          <s-stack direction="block" gap="base">
            <TextField label="Internal name" value={editing.name} onChange={(name) => update(editing.id, { name })} />
            <TextField
              label="Discount message"
              details="Shown at checkout next to the $0 gift."
              value={editing.message}
              onChange={(message) => update(editing.id, { message })}
            />
            <Checkbox label="Offer is active" checked={editing.enabled} onChange={(enabled) => update(editing.id, { enabled })} />
          </s-stack>
        </s-section>

        <s-section heading="When the cart has…">
          <s-stack direction="block" gap="base">
            <Select
              label="Trigger"
              value={editing.triggerType}
              options={[
                { value: "products", label: "Specific products" },
                { value: "vendors", label: "Any product from these vendors" },
                { value: "any", label: "Any product" },
              ]}
              onChange={(v) => update(editing.id, { triggerType: v as GiftRule["triggerType"] })}
            />
            {editing.triggerType === "products" && (
              <s-stack direction="block" gap="small-200">
                <s-button onClick={() => pickTriggers(editing)}>
                  {editing.triggerProducts.length ? "Change products" : "Choose products"}
                </s-button>
                {editing.triggerProducts.length > 0 && (
                  <s-text color="subdued">{editing.triggerProducts.map((p) => p.title).join(", ")}</s-text>
                )}
              </s-stack>
            )}
            {editing.triggerType === "vendors" && (
              <s-stack direction="block" gap="small-200">
                <s-text>Vendors</s-text>
                <s-stack direction="inline" gap="small-200">
                  {data.vendors.map((vendor) => (
                    <Checkbox
                      key={vendor}
                      label={vendor}
                      checked={editing.triggerVendors.includes(vendor)}
                      onChange={(on) =>
                        update(editing.id, {
                          triggerVendors: on
                            ? unique([...editing.triggerVendors, vendor])
                            : editing.triggerVendors.filter((v) => v !== vendor),
                        })
                      }
                    />
                  ))}
                </s-stack>
              </s-stack>
            )}
            <NumberField
              label="Minimum quantity"
              details="How many qualifying items the shopper must add. Use 1 for “buy any, get a gift”."
              min={1}
              value={editing.minTriggerQty}
              onChange={(minTriggerQty) => update(editing.id, { minTriggerQty: Math.max(1, Math.round(minTriggerQty)) })}
            />
          </s-stack>
        </s-section>

        <s-section heading="…let the shopper choose a free gift">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Shoppers see these in the cart drawer and on the cart page under “Choose your free gift” and pick one.
            </s-paragraph>
            {editing.giftOptions.map((option) => (
              <s-stack key={option.variantId} direction="inline" gap="base" alignItems="center">
                {option.image && <s-thumbnail src={option.image} alt={option.title} size="small" />}
                <s-text>{option.title}</s-text>
                {option.price && <s-text color="subdued">${option.price}</s-text>}
                <s-button variant="tertiary" tone="critical" onClick={() => removeGiftOption(editing, option.variantId)}>
                  Remove
                </s-button>
              </s-stack>
            ))}
            <s-stack direction="inline">
              <s-button onClick={() => pickGifts(editing)}>
                {editing.giftOptions.length ? "Add or change gifts" : "Choose gifts"}
              </s-button>
            </s-stack>
            <s-text color="subdued">
              Use products that are published to your Online Store. Pick specific variants in the picker to offer them
              separately. Choose the trigger product itself for classic buy-one-get-one.
            </s-text>
            <NumberField
              label="Free quantity"
              details="How many free units the shopper gets in total."
              min={1}
              value={editing.giftQuantity}
              onChange={(giftQuantity) => update(editing.id, { giftQuantity: Math.max(1, Math.round(giftQuantity)) })}
            />
            {editing.giftOptions.length <= 1 && (
              <Checkbox
                label="Add the gift to the cart automatically"
                details="Off: the gift is offered at the bottom of the cart and the shopper adds it with one click."
                checked={editing.autoAdd}
                onChange={(autoAdd) => update(editing.id, { autoAdd })}
              />
            )}
          </s-stack>
        </s-section>

        <s-section>
          <s-button tone="critical" onClick={() => removeRule(editing.id)}>
            Delete offer
          </s-button>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Free gift offers">
      <s-button slot="primary-action" variant="primary" onClick={addRule}>
        Create gift offer
      </s-button>

      {!data.discountActive && (
        <s-banner tone="warning" heading="Checkout discount is not active">
          Gifts will not be free at checkout until you activate the discount on the home page.
        </s-banner>
      )}

      <s-section>
        {gifts.length === 0 ? (
          <s-paragraph>No gift offers yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Offer</s-table-header>
              <s-table-header>When cart has</s-table-header>
              <s-table-header>Free gift</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {gifts.map((g) => (
                <s-table-row key={g.id}>
                  <s-table-cell>{g.name || "Untitled"}</s-table-cell>
                  <s-table-cell>{describeTrigger(g)}</s-table-cell>
                  <s-table-cell>
                    {g.giftQuantity > 1 ? `${g.giftQuantity} × ` : ""}
                    {g.giftOptions.map((o) => o.title).join(" / ") || "—"}
                  </s-table-cell>
                  <s-table-cell>
                    {g.enabled ? <s-badge tone="success">Active</s-badge> : <s-badge>Paused</s-badge>}
                  </s-table-cell>
                  <s-table-cell>
                    <s-button variant="tertiary" onClick={() => setEditingId(g.id)}>
                      Edit
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
