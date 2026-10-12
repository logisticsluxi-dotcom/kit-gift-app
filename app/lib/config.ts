export type TriggerType = "products" | "vendors" | "any";

export interface GiftRule {
  id: string;
  enabled: boolean;
  name: string;
  /** Shown at checkout next to the discount and in the storefront popup. */
  message: string;
  triggerType: TriggerType;
  triggerProducts: { id: string; title: string }[];
  triggerVendors: string[];
  /** Units of trigger items the cart needs before the gift unlocks. */
  minTriggerQty: number;
  giftProductId: string;
  giftVariantId: string;
  giftTitle: string;
  giftImage: string;
  giftPrice: string;
  giftVendor: string;
  /** Free units granted. */
  giftQuantity: number;
  /** Add the gift automatically instead of showing a popup offer. */
  autoAdd: boolean;
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
    giftProductId: "",
    giftVariantId: "",
    giftTitle: "",
    giftImage: "",
    giftPrice: "",
    giftVendor: "",
    giftQuantity: 1,
    autoAdd: false,
  };
}

export function normalizeConfig(raw: unknown): AppConfig {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<AppConfig>;
  return {
    discountId: value.discountId ?? null,
    gifts: (value.gifts ?? []).map((g) => ({ ...newGiftRule(), ...g })),
    kit: { ...DEFAULT_CONFIG.kit, ...(value.kit ?? {}) },
  };
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
      giftVariantId: g.giftVariantId,
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
