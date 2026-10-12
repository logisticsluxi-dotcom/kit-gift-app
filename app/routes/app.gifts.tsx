import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadConfig, saveConfig } from "../lib/config.server";
import { newGiftRule, type GiftRule } from "../lib/config";
import { Checkbox, NumberField, Select, TextField } from "../components/fields";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { config, vendors } = await loadConfig(admin);
  return { gifts: config.gifts, vendors, discountActive: Boolean(config.discountId) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const gifts = JSON.parse(String((await request.formData()).get("gifts"))) as GiftRule[];
  const invalid = gifts.find((g) => g.enabled && !g.giftVariantId);
  if (invalid) return { ok: false, error: `“${invalid.name || "Untitled"}” needs a gift product` };
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

  const pickGift = async (rule: GiftRule) => {
    const selected = (await shopify.resourcePicker({
      type: "product",
      multiple: false,
      action: "select",
    })) as PickedProduct[] | undefined;
    const product = selected?.[0];
    const variant = product?.variants?.[0];
    if (!product || !variant) return;
    update(rule.id, {
      giftProductId: product.id,
      giftVariantId: variant.id,
      giftTitle:
        variant.title && variant.title !== "Default Title"
          ? `${product.title} – ${variant.title}`
          : product.title,
      giftImage: product.images?.[0]?.originalSrc ?? product.images?.[0]?.url ?? "",
      giftPrice: variant.price ?? "",
      giftVendor: product.vendor ?? "",
      name: rule.name || `Free ${product.title}`,
    });
  };

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
              details="Shown at checkout and in the gift popup."
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
                            ? [...editing.triggerVendors, vendor]
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

        <s-section heading="…give this free gift">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              {editing.giftImage && <s-thumbnail src={editing.giftImage} alt={editing.giftTitle} size="small" />}
              <s-text>{editing.giftTitle || "No gift selected"}</s-text>
              <s-button onClick={() => pickGift(editing)}>{editing.giftVariantId ? "Change gift" : "Choose gift"}</s-button>
            </s-stack>
            <s-text color="subdued">
              Tip: use a product (or variant) that is published to your Online Store. The first variant is used.
              Choose the same product as the trigger for classic buy-one-get-one.
            </s-text>
            <NumberField
              label="Free quantity"
              min={1}
              value={editing.giftQuantity}
              onChange={(giftQuantity) => update(editing.id, { giftQuantity: Math.max(1, Math.round(giftQuantity)) })}
            />
            <Checkbox
              label="Add the gift to the cart automatically"
              details="Off: shoppers see a popup recommending the gift and add it with one click."
              checked={editing.autoAdd}
              onChange={(autoAdd) => update(editing.id, { autoAdd })}
            />
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
                    {g.giftTitle || "—"}
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
