import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { activateDiscount, deactivateDiscount, loadConfig } from "../lib/config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { config, discount } = await loadConfig(admin);
  const store = session.shop.replace(".myshopify.com", "");
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const editor = `https://admin.shopify.com/store/${store}/themes/current/editor`;

  return {
    discount,
    discountActive: Boolean(config.discountId),
    giftCount: config.gifts.filter((g) => g.enabled).length,
    kitEnabled: config.kit.enabled,
    kitTiers: config.kit.tiers,
    links: {
      embed: `${editor}?context=apps&activateAppId=${apiKey}/gift-embed`,
      kitBlock: `${editor}?template=page&addAppBlockId=${apiKey}/kit-builder&target=newAppsSection`,
      kitButton: `${editor}?template=product&addAppBlockId=${apiKey}/kit-cta&target=mainSection`,
      pages: `https://admin.shopify.com/store/${store}/pages/new`,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const intent = (await request.formData()).get("intent");
  const { config } = await loadConfig(admin);
  try {
    if (intent === "activate") await activateDiscount(admin, config);
    if (intent === "deactivate") await deactivateDiscount(admin, config);
    return { ok: true, intent };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) {
      shopify.toast.show(fetcher.data.intent === "activate" ? "Discount activated" : "Discount turned off");
    } else {
      shopify.toast.show(fetcher.data.error ?? "Something went wrong", { isError: true });
    }
  }, [fetcher.data, shopify]);

  const submit = (intent: string) => fetcher.submit({ intent }, { method: "POST" });

  return (
    <s-page heading="Free gifts & kit builder">
      <s-section heading="1. Checkout discount">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            One automatic discount powers both features: it makes qualifying gifts free and applies
            kit savings at checkout. Shoppers cannot fake it from the storefront.
          </s-paragraph>
          <s-stack direction="inline" gap="base" alignItems="center">
            {data.discountActive ? (
              <s-badge tone="success">Active{data.discount ? ` · ${data.discount.status}` : ""}</s-badge>
            ) : (
              <s-badge tone="warning">Not active</s-badge>
            )}
            {data.discountActive ? (
              <s-button onClick={() => submit("deactivate")} {...(busy ? { loading: true } : {})}>
                Turn off
              </s-button>
            ) : (
              <s-button variant="primary" onClick={() => submit("activate")} {...(busy ? { loading: true } : {})}>
                Activate discount
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="2. Free gifts">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {data.giftCount === 0
              ? "No gift offers yet. Create one, e.g. “Buy any Acme serum, get a free travel bag”."
              : `${data.giftCount} active gift offer${data.giftCount === 1 ? "" : "s"}.`}
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href="/app/gifts">Manage gift offers</s-button>
            <s-button href={data.links.embed} target="_blank" variant="tertiary">
              Turn on “Free gift offers” app embed
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="3. Build your own kit">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {data.kitEnabled
              ? `On — ${data.kitTiers.map((t) => `${t.minItems}+ items ${t.percent}% off`).join(", ")}.`
              : "Off. Set your minimum items and savings tiers to turn it on."}
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href="/app/kit">Kit settings</s-button>
          </s-stack>
          <s-unordered-list>
            <s-list-item>
              <s-link href={data.links.pages} target="_blank">Create a page</s-link> called e.g. “Build your
              kit”.
            </s-list-item>
            <s-list-item>
              <s-link href={data.links.kitBlock} target="_blank">Add the “Build your own kit” block</s-link>{" "}
              to that page’s template and choose the collection to pick from.
            </s-list-item>
            <s-list-item>
              <s-link href={data.links.kitButton} target="_blank">Add the “Build your kit button”</s-link> to
              product pages and point it at the kit page.
            </s-list-item>
          </s-unordered-list>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
