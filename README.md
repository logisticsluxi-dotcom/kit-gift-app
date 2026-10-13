# Kit Builder & Free Gifts — Shopify app

Two features, one app:

1. **Free gifts (BOGO-style)**: when the cart has a qualifying item, a "Choose your free gift" box appears at the bottom of the cart drawer and the cart page. The shopper picks one of the gifts you offer and it's added at $0 (or a single gift can be added automatically). Triggers can be specific products, any product from chosen vendors, or any product, with a minimum quantity. Choose the trigger product as the gift too and you get classic buy-one-get-one.
2. **Build your own kit & save**: a storefront page where shoppers choose a kit size (one per discount tier, e.g. 3 items = 10%, 5 = 15%, 8 = 20%), fill the empty boxes with products (filtered by collection and vendor), and add the kit to the cart.

## How it works

| Piece | Path | Role |
|---|---|---|
| Admin app | `app/routes/app._index.tsx`, `app.gifts.tsx`, `app.kit.tsx` | Turn on the discount, manage gift offers and kit tiers and vendors |
| Discount function | `extensions/bundle-discount` | Runs at checkout. Makes gifts $0 and applies kit tier %. This is the source of truth, so the discount can't be faked from the browser. |
| Theme extension | `extensions/kit-gift-theme` | `gift-embed` (free-gift box in the cart drawer and cart page), `kit-builder` block, `kit-cta` button block |

Config is saved in two metafields. One sits on the app installation (the theme reads `app.metafields.kitgift.config`) and one sits on the automatic discount (the function reads `$app:kitgift.config`). Kit items are added with a hidden `_kit` line property and gifts with `_free_gift`.

## First run

```bash
npm install
npm run dev        # log in, create/link the app, pick a dev store
```

When the CLI asks, create a new app. It fills in `client_id` in `shopify.app.toml`. If the function build complains about a missing schema, run:

```bash
cd extensions/bundle-discount && npx shopify app function schema
```

Then in the app's admin page:

1. **Activate discount** (Home).
2. **Free gifts**: create an offer → pick trigger products/vendors → pick the gift → Save.
3. Click **Turn on "Free gift in cart" app embed** → Save in the theme editor.
4. **Build your own kit**: turn it on, set tiers and vendors → Save.
5. Create a page (e.g. "Build your kit") → add the **Build your own kit** block to it and choose a collection.
6. Add the **Build your kit button** block to the product template and point it at that page. With "Only show this product's vendor" checked, it links to `/pages/build-your-kit?vendor=Acme`.

## Tests

```bash
cd extensions/bundle-discount && npx vitest run
```

## Notes and limits

- The gift box re-renders Dawn-style cart drawers (`cart-drawer`) and cart pages (`cart-items`) in place; other themes fall back to a page reload. It also fires a `kitgift:cart-updated` event.
- Gifts added through the box are removed automatically if the cart stops qualifying. Even when they aren't removed, the function won't discount them.
- Kit discounts combine with order and shipping discounts but not with other product discounts. You can change this in `activateDiscount` in `app/lib/config.server.ts`.
- Liquid can paginate up to 250 products for the kit grid. Use a focused collection.
