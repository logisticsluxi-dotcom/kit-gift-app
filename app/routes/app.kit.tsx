import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadConfig, saveConfig } from "../lib/config.server";
import { unique, type KitConfig } from "../lib/config";
import { Checkbox, NumberField, TextField } from "../components/fields";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { config, vendors } = await loadConfig(admin);
  return { kit: config.kit, vendors, discountActive: Boolean(config.discountId) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const kit = JSON.parse(String((await request.formData()).get("kit"))) as KitConfig;
  kit.tiers = kit.tiers
    .map((t) => ({ minItems: Math.round(Number(t.minItems)), percent: Number(t.percent) }))
    .filter((t) => t.minItems > 0 && t.percent > 0 && t.percent <= 100)
    .sort((a, b) => a.minItems - b.minItems);
  if (kit.enabled && kit.tiers.length === 0) {
    return { ok: false, error: "Add at least one savings tier" };
  }
  try {
    const { config } = await loadConfig(admin);
    await saveConfig(admin, { ...config, kit });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
};

export default function Kit() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [kit, setKit] = useState<KitConfig>(data.kit);
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) {
      shopify.toast.show("Kit settings saved");
    } else {
      shopify.toast.show(fetcher.data.error ?? "Could not save", { isError: true });
    }
  }, [fetcher.data, shopify]);

  const set = (patch: Partial<KitConfig>) => setKit((k) => ({ ...k, ...patch }));
  const setTier = (i: number, patch: Partial<KitConfig["tiers"][number]>) =>
    set({ tiers: kit.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const minItems = Math.min(...kit.tiers.map((t) => t.minItems), Infinity);

  return (
    <s-page heading="Build your own kit">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => fetcher.submit({ kit: JSON.stringify(kit) }, { method: "POST" })}
        {...(saving ? { loading: true } : {})}
      >
        Save
      </s-button>

      {!data.discountActive && (
        <s-banner tone="warning" heading="Checkout discount is not active">
          Kit savings will not apply at checkout until you activate the discount on the home page.
        </s-banner>
      )}

      <s-section heading="General">
        <s-stack direction="block" gap="base">
          <Checkbox label="Kit builder is on" checked={kit.enabled} onChange={(enabled) => set({ enabled })} />
          <TextField
            label="Kit name"
            details="Shown on each cart line as “Bundle: …”."
            value={kit.title}
            onChange={(title) => set({ title })}
          />
          <TextField
            label="Checkout discount message"
            details="{percent} is replaced with the savings percentage."
            value={kit.message}
            onChange={(message) => set({ message })}
          />
        </s-stack>
      </s-section>

      <s-section heading="Savings tiers">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Shoppers must pick at least{" "}
            <s-text type="strong">{Number.isFinite(minItems) ? minItems : "—"} items</s-text> (your lowest tier). The
            highest tier they reach is applied to every item in the kit.
          </s-paragraph>
          {kit.tiers.map((tier, i) => (
            <s-stack key={i} direction="inline" gap="base" alignItems="end">
              <NumberField label="Items in kit (at least)" min={1} value={tier.minItems} onChange={(minItems) => setTier(i, { minItems })} />
              <NumberField label="Discount" min={1} max={100} suffix="%" value={tier.percent} onChange={(percent) => setTier(i, { percent })} />
              <s-button
                variant="tertiary"
                tone="critical"
                onClick={() => set({ tiers: kit.tiers.filter((_, j) => j !== i) })}
              >
                Remove
              </s-button>
            </s-stack>
          ))}
          <s-stack direction="inline">
            <s-button
              onClick={() => {
                const last = kit.tiers[kit.tiers.length - 1];
                set({
                  tiers: [
                    ...kit.tiers,
                    { minItems: (last?.minItems ?? 2) + 1, percent: (last?.percent ?? 5) + 5 },
                  ],
                });
              }}
            >
              Add tier
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Eligible vendors">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Only items from these vendors count toward a kit. Leave all unchecked to allow any vendor. You can also
            narrow a kit page to one vendor from the theme editor or with the “Build your kit button” on product pages.
          </s-paragraph>
          <s-stack direction="inline" gap="small-200">
            {data.vendors.map((vendor) => (
              <Checkbox
                key={vendor}
                label={vendor}
                checked={kit.vendors.includes(vendor)}
                onChange={(on) =>
                  set({ vendors: on ? unique([...kit.vendors, vendor]) : kit.vendors.filter((v) => v !== vendor) })
                }
              />
            ))}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
