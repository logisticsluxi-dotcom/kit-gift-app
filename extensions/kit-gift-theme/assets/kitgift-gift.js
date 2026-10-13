(() => {
  if (window.__kitgiftGift) return;
  window.__kitgiftGift = true;

  const readJson = (id) => {
    try {
      return JSON.parse(document.getElementById(id)?.textContent || "null");
    } catch {
      return null;
    }
  };

  const config = readJson("kitgift-config");
  const settings = readJson("kitgift-settings") || {};
  const rules = (config?.gifts || [])
    .map((r) => ({ ...r, options: giftOptions(r) }))
    .filter((r) => r.enabled && r.options.length > 0);
  if (rules.length === 0) return;

  const root = settings.root || "/";
  const nativeFetch = window.fetch.bind(window);
  const numericId = (gid) => Number(String(gid).split("/").pop());
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const isCartPage = () => /\/cart\/?$/.test(location.pathname);

  /** Older configs had a single gift; newer ones a list of options. */
  function giftOptions(rule) {
    if (Array.isArray(rule.giftOptions)) return rule.giftOptions;
    if (!rule.giftVariantId) return [];
    return [
      {
        productId: rule.giftProductId,
        variantId: rule.giftVariantId,
        title: rule.giftTitle,
        image: rule.giftImage,
        price: rule.giftPrice,
        vendor: rule.giftVendor,
      },
    ];
  }

  const formatMoney = (cents) => {
    const amount = (cents / 100).toFixed(2);
    const fmt = settings.moneyFormat || "${{amount}}";
    return fmt.replace(/\{\{\s*(\w+)\s*\}\}/, (_, kind) => {
      if (kind === "amount_no_decimals") return Math.round(cents / 100).toString();
      if (kind === "amount_with_comma_separator") return amount.replace(".", ",");
      return amount;
    });
  };

  const isTrigger = (rule, { productId, vendor }) => {
    if (rule.triggerType === "any") return true;
    if (rule.triggerType === "vendors") {
      return (rule.triggerVendors || []).map(norm).includes(norm(vendor));
    }
    return (rule.triggerProductIds || []).map(numericId).includes(Number(productId));
  };

  // Mirrors the discount function, so we only offer gifts that will actually be free.
  const evaluate = (rule, items) => {
    const variants = new Set(rule.options.map((o) => numericId(o.variantId)));
    const giftItems = items.filter((i) => variants.has(i.variant_id));
    const triggerQty = items
      .filter((i) => isTrigger(rule, { productId: i.product_id, vendor: i.vendor }))
      .reduce((sum, i) => sum + i.quantity, 0);
    const minTrigger = Math.max(1, Number(rule.minTriggerQty) || 1);
    const giftIsTrigger = giftItems.some((i) => isTrigger(rule, { productId: i.product_id, vendor: i.vendor }));
    const giftQty = giftItems.reduce((sum, i) => sum + i.quantity, 0);
    const qualifies = giftIsTrigger ? triggerQty - giftQty >= minTrigger : triggerQty >= minTrigger;
    return { qualifies, giftItems };
  };

  // ---- Theme integration (Dawn-style themes; falls back to a page reload) ----
  const drawer = () => document.querySelector("cart-drawer");
  const cartItems = () => document.querySelector("cart-items");

  const sectionIds = () => (drawer()?.getSectionsToRender?.() || []).map((s) => s.id).filter(Boolean);

  /** POST to a cart endpoint and let the theme re-render with the returned sections. */
  const cartUpdate = async (path, body, { openDrawer = false } = {}) => {
    const res = await nativeFetch(`${root}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, sections: sectionIds(), sections_url: location.pathname }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.description || data.message || "Cart update failed");
    refreshTheme(data, openDrawer);
    return data;
  };

  const refreshTheme = (data, openDrawer) => {
    document.dispatchEvent(new CustomEvent("kitgift:cart-updated", { bubbles: true, detail: data }));
    const d = drawer();
    const canRender = d?.getSectionsToRender && d?.getSectionInnerHTML && data?.sections;

    if (canRender) {
      // Same as Dawn's renderContents(), minus opening the drawer.
      for (const section of d.getSectionsToRender()) {
        const html = data.sections[section.id];
        const el = section.selector ? document.querySelector(section.selector) : document.getElementById(section.id);
        if (html && el) el.innerHTML = d.getSectionInnerHTML(html, section.selector);
      }
      d.classList.toggle("is-empty", (data.item_count ?? data.items?.length ?? 1) === 0);
      if (openDrawer && !isCartPage()) d.open?.();
    }

    if (isCartPage()) {
      const items = cartItems();
      if (items?.onCartUpdate) items.onCartUpdate();
      else location.reload();
    } else if (!canRender) {
      location.reload();
    }
  };

  // ---- "Choose your free gift" box ----
  let cart = null;

  const offerFor = () => {
    if (!cart) return null;
    for (const rule of rules) {
      const { qualifies, giftItems } = evaluate(rule, cart.items || []);
      if (qualifies && giftItems.length === 0) return rule;
    }
    return null;
  };

  const buildBox = (rule) => {
    const box = document.createElement("div");
    box.className = "kitgift-cartgift";
    box.dataset.kitgiftBox = rule.id;
    box.innerHTML = `
      <p class="kitgift-cartgift__title"></p>
      <p class="kitgift-cartgift__sub"></p>
      <div class="kitgift-cartgift__options"></div>`;
    box.querySelector(".kitgift-cartgift__title").textContent =
      rule.options.length > 1
        ? settings.heading || "🎁 Choose your free gift"
        : settings.headingSingle || "🎁 You get a free gift";
    const sub = box.querySelector(".kitgift-cartgift__sub");
    sub.textContent = settings.subheading || "";
    if (!sub.textContent) sub.remove();

    const list = box.querySelector(".kitgift-cartgift__options");
    for (const option of rule.options) {
      const row = document.createElement("div");
      row.className = "kitgift-cartgift__option";
      row.innerHTML = `
        <div class="kitgift-cartgift__media"></div>
        <div class="kitgift-cartgift__info">
          <span class="kitgift-cartgift__name"></span>
          <span class="kitgift-cartgift__price"><s></s> <strong>FREE</strong></span>
        </div>
        <button type="button" class="kitgift-cartgift__add"></button>`;
      if (option.image) {
        const img = document.createElement("img");
        img.src = option.image.includes("?") ? `${option.image}&width=120` : `${option.image}?width=120`;
        img.alt = "";
        img.loading = "lazy";
        row.querySelector(".kitgift-cartgift__media").appendChild(img);
      }
      row.querySelector(".kitgift-cartgift__name").textContent = option.title || "Free gift";
      const was = row.querySelector("s");
      if (option.price && Number(option.price) > 0) was.textContent = formatMoney(Math.round(Number(option.price) * 100));
      else was.remove();
      const button = row.querySelector(".kitgift-cartgift__add");
      button.textContent = settings.addLabel || "Add free";
      button.addEventListener("click", async () => {
        box.querySelectorAll("button").forEach((b) => (b.disabled = true));
        button.textContent = "Adding…";
        try {
          await addGift(rule, option);
        } catch (err) {
          console.warn("[kitgift]", err);
          button.textContent = "Try again";
          box.querySelectorAll("button").forEach((b) => (b.disabled = false));
        }
      });
      list.appendChild(row);
    }
    return box;
  };

  /** Where the box goes: bottom of the drawer's item list, and under the items on /cart. */
  const targets = () => {
    const spots = [];
    const drawerItems = document.querySelector("#CartDrawer-CartItems, cart-drawer .drawer__contents");
    const drawerFooter = document.querySelector("cart-drawer .drawer__footer");
    if (drawerFooter) spots.push({ parent: drawerFooter, before: drawerFooter.firstChild });
    else if (drawerItems) spots.push({ parent: drawerItems, before: null });
    if (isCartPage()) {
      const items = cartItems();
      if (items?.parentElement) spots.push({ parent: items.parentElement, before: items.nextSibling });
      else {
        const form = document.querySelector('form[action*="/cart"]');
        if (form) spots.push({ parent: form, before: null });
      }
    }
    return spots;
  };

  const render = () => {
    const rule = offerFor();
    document.querySelectorAll("[data-kitgift-box]").forEach((el) => {
      if (!rule || el.dataset.kitgiftBox !== rule.id) el.remove();
    });
    if (!rule) return;
    for (const { parent, before } of targets()) {
      if (parent.querySelector(":scope > [data-kitgift-box]")) continue;
      parent.insertBefore(buildBox(rule), before);
    }
  };

  const addGift = async (rule, option) => {
    await cartUpdate("cart/add.js", {
      items: [
        {
          id: numericId(option.variantId),
          quantity: Math.max(1, Number(rule.giftQuantity) || 1),
          properties: { _free_gift: rule.id },
        },
      ],
    }, { openDrawer: Boolean(drawer()?.classList.contains("active")) });
    await refresh();
  };

  // ---- Keep the cart in sync ----
  let running = false;
  let queued = false;
  const refresh = async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      cart = await nativeFetch(`${root}cart.js`, { headers: { Accept: "application/json" } }).then((r) => r.json());
      const items = cart.items || [];

      for (const rule of rules) {
        const { qualifies, giftItems } = evaluate(rule, items);
        if (!qualifies) {
          // Take back gifts we added once the cart no longer qualifies.
          const ours = giftItems.filter((i) => i.properties?._free_gift === rule.id);
          for (const item of ours) await cartUpdate("cart/change.js", { id: item.key, quantity: 0 });
          if (ours.length) return void (queued = true);
        } else if (giftItems.length === 0 && rule.autoAdd && rule.options.length === 1) {
          await cartUpdate("cart/add.js", {
            items: [
              {
                id: numericId(rule.options[0].variantId),
                quantity: Math.max(1, Number(rule.giftQuantity) || 1),
                properties: { _free_gift: rule.id },
              },
            ],
          });
          return void (queued = true);
        }
      }
      render();
    } catch (err) {
      console.warn("[kitgift]", err);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        refresh();
      }
    }
  };

  let timer;
  const scheduleRefresh = (delay = 300) => {
    clearTimeout(timer);
    timer = setTimeout(refresh, delay);
  };
  const isCartMutation = (url) => /\/cart\/(add|change|update|clear)(\.js)?/.test(String(url || ""));

  // Any AJAX cart change (theme, apps) → re-check.
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    if (isCartMutation(url)) scheduleRefresh();
    return response;
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isCartMutation(url)) this.addEventListener("load", () => scheduleRefresh());
    return nativeOpen.call(this, method, url, ...rest);
  };
  // Dawn-based themes publish cart updates here.
  window.subscribe?.("cart-update", () => scheduleRefresh());

  // Themes re-render the drawer/cart HTML after every change, which removes our box: put it back.
  const observer = new MutationObserver(() => {
    if (cart && offerFor() && targets().some(({ parent }) => !parent.querySelector(":scope > [data-kitgift-box]"))) {
      observer.disconnect();
      render();
      observe();
    }
  });
  const observe = () => observer.observe(document.body, { childList: true, subtree: true });

  refresh().then(observe);
})();
