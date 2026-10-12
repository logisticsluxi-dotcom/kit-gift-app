import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import {
  functionConfig,
  normalizeConfig,
  storefrontConfig,
  type AppConfig,
} from "./config";

type Admin = AdminApiContext;

const FUNCTION_HANDLE = "bundle-discount";
const DISCOUNT_TITLE = "Free gifts & kit savings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Admin API responses are untyped here
async function gql<T = any>(admin: Admin, query: string, variables?: Record<string, unknown>) {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

function assertNoUserErrors(errors: { message: string }[] | undefined) {
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(", "));
}

export async function loadConfig(admin: Admin) {
  const data = await gql(
    admin,
    `#graphql
    query KitGiftLoad {
      currentAppInstallation {
        id
        metafield(namespace: "kitgift", key: "config") { jsonValue }
      }
      productVendors(first: 250) { nodes }
    }`,
  );
  // The full admin copy is stored alongside the storefront fields under `admin`.
  const stored = data.currentAppInstallation.metafield?.jsonValue;
  const config = normalizeConfig(stored?.admin ?? stored);
  let discount: { title: string; status: string } | null = null;

  if (config.discountId) {
    const d = await gql(
      admin,
      `#graphql
      query KitGiftDiscount($id: ID!) {
        discountNode(id: $id) {
          id
          discount { ... on DiscountAutomaticApp { title status } }
        }
      }`,
      { id: config.discountId },
    );
    discount = d.discountNode?.discount ?? null;
    // Merchant deleted the discount in the admin.
    if (!d.discountNode) config.discountId = null;
  }

  return {
    config,
    installationId: data.currentAppInstallation.id as string,
    vendors: (data.productVendors?.nodes ?? []) as string[],
    discount,
  };
}

/**
 * Writes the config to two places:
 *  - the app installation (read by the theme extension via `app.metafields.kitgift.config`)
 *  - the automatic discount (read by the discount function)
 */
export async function saveConfig(admin: Admin, config: AppConfig) {
  const { installationId } = await loadConfig(admin);
  const metafields: Record<string, string>[] = [
    {
      ownerId: installationId,
      namespace: "kitgift",
      key: "config",
      type: "json",
      value: JSON.stringify({ ...storefrontConfig(config), discountId: config.discountId, admin: config }),
    },
  ];
  if (config.discountId) {
    metafields.push({
      ownerId: config.discountId,
      namespace: "$app:kitgift",
      key: "config",
      type: "json",
      value: JSON.stringify(functionConfig(config)),
    });
  }
  const data = await gql(
    admin,
    `#graphql
    mutation KitGiftSave($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    { metafields },
  );
  assertNoUserErrors(data.metafieldsSet.userErrors);
}

export async function activateDiscount(admin: Admin, config: AppConfig) {
  const data = await gql(
    admin,
    `#graphql
    mutation KitGiftCreate($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount { discountId status }
        userErrors { field message }
      }
    }`,
    {
      discount: {
        title: DISCOUNT_TITLE,
        functionHandle: FUNCTION_HANDLE,
        discountClasses: ["PRODUCT"],
        startsAt: new Date().toISOString(),
        combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
        metafields: [
          {
            namespace: "$app:kitgift",
            key: "config",
            type: "json",
            value: JSON.stringify(functionConfig(config)),
          },
        ],
      },
    },
  );
  assertNoUserErrors(data.discountAutomaticAppCreate.userErrors);
  const next = { ...config, discountId: data.discountAutomaticAppCreate.automaticAppDiscount.discountId };
  await saveConfig(admin, next);
  return next;
}

export async function deactivateDiscount(admin: Admin, config: AppConfig) {
  if (config.discountId) {
    const data = await gql(
      admin,
      `#graphql
      mutation KitGiftDelete($id: ID!) {
        discountAutomaticDelete(id: $id) {
          deletedAutomaticDiscountId
          userErrors { field message }
        }
      }`,
      { id: config.discountId },
    );
    assertNoUserErrors(data.discountAutomaticDelete.userErrors);
  }
  const next = { ...config, discountId: null };
  await saveConfig(admin, next);
  return next;
}
