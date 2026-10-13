export type TriggerType = "products" | "vendors" | "any";

export interface GiftRule {
  id: string;
  enabled: boolean;
  name: string;
  /** Shown at checkout next to the discount. */
  message: string;
  triggerType: TriggerType;
  triggerProducts: { id: string; title: string }[];
  triggerVendors: string[];
  /** Units of trigger items the cart needs before the gift unlocks. */
  minTriggerQty: number;
  /** Gifts the shopper can choose from (they pick one). */
  giftOptions: GiftOption[];
  /** Free units granted. */
  giftQuantity: number;
  /** With a single gift option: add it automatically instead of offering it in the cart. */
  autoAdd: boolean;
}

export interface GiftOption {
  productId: string;
  variantId: string;
  title: string;
  image: string;
  price: string;
  vendor: string;
}

export interface KitTier {
  minItems: number;
  percent: number;
}

export interface KitConfig {
  enabled: boolean;
  title: string;
  /** Checkout discount label. {percent} is replaced with the tier percentage. */
  message: string;
  /** Empty = any vendor. */
  vendors: string[];
  tiers: KitTier[];
}

export interface AppConfig {
  discountId: string | null;
  gifts: GiftRule[];
  kit: KitConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  discountId: null,
  gifts: [],
  kit: {
    enabled: false,
    title: "Build your own kit",
    message: "Kit savings: {percent}% off",
    vendors: [],
    tiers: [
      { minItems: 3, percent: 10 },
      { minItems: 5, percent: 15 },
      { minItems: 8, percent: 20 },
    ],
  },
};

export function newGiftRule(): GiftRule {
  return {
    id: `gift-${Date.now().toString(36)}`,
    enabled: true,
    name: "",
    message: "Free gift",
    triggerType: "products",
    triggerProducts: [],
    triggerVendors: [],
    minTriggerQty: 1,
    giftOptions: [],
    giftQuantity: 1,
    autoAdd: false,
  };
}

export function normalizeConfig(raw: unknown): AppConfig {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<AppConfig>;
  return {
    discountId: value.discountId ?? null,
    gifts: (value.gifts ?? []).map(normalizeGift),
    kit: normalizeKit({ ...DEFAULT_CONFIG.kit, ...(value.kit ?? {}) }),
  };
}

type LegacyGift = Partial<GiftRule> & {
  giftProductId?: string;
  giftVariantId?: string;
  giftTitle?: string;
  giftImage?: string;
  giftPrice?: string;
  giftVendor?: string;
};

/** Older configs stored a single gift; convert it to a one-item option list. */
function normalizeGift(raw: LegacyGift): GiftRule {
  const { giftProductId, giftVariantId, giftTitle, giftImage, giftPrice, giftVendor, ...rest } = raw;
  const rule = { ...newGiftRule(), ...rest };
  if (!raw.giftOptions && giftVariantId) {
    rule.giftOptions = [
      {
        productId: giftProductId ?? "",
        variantId: giftVariantId,
        title: giftTitle ?? "",
        image: giftImage ?? "",
        price: giftPrice ?? "",
        vendor: giftVendor ?? "",
      },
    ];
  }
  rule.triggerVendors = unique(rule.triggerVendors);
  return rule;
}

function normalizeKit(kit: KitConfig): KitConfig {
  return { ...kit, vendors: unique(kit.vendors) };
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Storefront copy (theme extension): everything the popup and kit builder need. */
export function storefrontConfig(config: AppConfig) {
  return {
    gifts: config.gifts.map(({ triggerProducts, ...rule }) => ({
      ...rule,
      triggerProductIds: triggerProducts.map((p) => p.id),
    })),
    kit: config.kit,
  };
}

/** Function copy: only what the discount function reads, to keep its input small. */
export function functionConfig(config: AppConfig) {
  return {
    gifts: config.gifts.map((g) => ({
      id: g.id,
      enabled: g.enabled,
      message: g.message,
      triggerType: g.triggerType,
      triggerProductIds: g.triggerProducts.map((p) => p.id),
      triggerVendors: g.triggerVendors,
      minTriggerQty: g.minTriggerQty,
      giftVariantIds: g.giftOptions.map((o) => o.variantId),
      giftQuantity: g.giftQuantity,
    })),
    kit: {
      enabled: config.kit.enabled,
      message: config.kit.message,
      vendors: config.kit.vendors,
      tiers: config.kit.tiers,
    },
  };
}
