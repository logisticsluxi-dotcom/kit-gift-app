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
  const rules = (config?.gifts || []).filter((r) => r.enabled && r.giftVariantId);
  if (rules.length === 0) return;

  const root = settings.root || "/";
  const nativeFetch = window.fetch.bind(window);
  const numericId = (gid) => Number(String(gid).split("/").pop());
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const dismissKey = (rule) => `kitgift-dismissed-${rule.id}`;

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

  // Mirrors the discount function so the storefront only offers gifts that will be free.
  const evaluate = (rule, items) => {
    const giftVariant = numericId(rule.giftVariantId);
    const giftItems = items.filter((i) => i.variant_id === giftVariant);
    const triggerQty = items
      .filter((i) => isTrigger(rule, { productId: i.product_id, vendor: i.vendor }))
      .reduce((sum, i) => sum + i.quantity, 0);
    const minTrigger = Math.max(1, Number(rule.minTriggerQty) || 1);
    const giftIsTrigger = isTrigger(rule, {
      productId: numericId(rule.giftProductId),
      vendor: rule.giftVendor,
    });
    const giftQty = giftItems.reduce((sum, i) => sum + i.quantity, 0);
    const qualifies = giftIsTrigger
      ? triggerQty - giftQty >= minTrigger
      : triggerQty >= minTrigger;
    return { qualifies, giftItems };
  };

  const cartRequest = (path, body) =>
    nativeFetch(`${root}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());

  const afterCartChange = () => {
    document.dispatchEvent(new CustomEvent("kitgift:cart-updated", { bubbles: true }));
    if (settings.afterAdd === "cart") {
      window.location.href = `${root}cart`;
    } else if (settings.afterAdd === "reload" || /\/cart\/?$/.test(location.pathname)) {
      window.location.reload();
    }
  };

  const addGift = async (rule) => {
    await cartRequest("cart/add.js", {
      items: [
        {
          id: numericId(rule.giftVariantId),
          quantity: Math.max(1, Number(rule.giftQuantity) || 1),
          properties: { _free_gift: rule.id },
        },
      ],
    });
    afterCartChange();
  };

  // ---- Popup ----
  let open = false;
  const showOffer = (rule) => {
    if (open) return;
    open = true;
    const overlay = document.createElement("div");
    overlay.className = "kitgift-overlay";
    overlay.innerHTML = `
      <div class="kitgift-modal" role="dialog" aria-modal="true" aria-labelledby="kitgift-title">
        <button class="kitgift-close" aria-label="Close">&times;</button>
        <p class="kitgift-eyebrow" id="kitgift-title"></p>
        ${rule.giftImage ? `<img class="kitgift-image" alt="">` : ""}
        <p class="kitgift-name"></p>
        <p class="kitgift-price">
          ${rule.giftPrice ? `<s>${formatMoney(Math.round(Number(rule.giftPrice) * 100))}</s>` : ""}
          <strong>FREE</strong>
        </p>
        <p class="kitgift-message"></p>
        <button class="kitgift-accept"></button>
        <button class="kitgift-decline"></button>
      </div>`;
    if (rule.giftImage) overlay.querySelector(".kitgift-image").src = rule.giftImage;
    overlay.querySelector(".kitgift-eyebrow").textContent = settings.heading || "You unlocked a free gift!";
    overlay.querySelector(".kitgift-name").textContent = rule.giftTitle || "Free gift";
    overlay.querySelector(".kitgift-message").textContent = rule.message || "";
    overlay.querySelector(".kitgift-accept").textContent = settings.addLabel || "Add my free gift";
    overlay.querySelector(".kitgift-decline").textContent = settings.declineLabel || "No thanks";

    const close = (dismiss) => {
      if (dismiss) sessionStorage.setItem(dismissKey(rule), "1");
      overlay.remove();
      open = false;
    };
    overlay.querySelector(".kitgift-close").onclick = () => close(true);
    overlay.querySelector(".kitgift-decline").onclick = () => close(true);
    overlay.addEventListener("click", (e) => e.target === overlay && close(true));
    overlay.querySelector(".kitgift-accept").onclick = async (e) => {
      e.currentTarget.disabled = true;
      await addGift(rule);
      close(false);
    };
    document.body.appendChild(overlay);
  };

  // ---- Cart check ----
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const cart = await cartRequest("cart.js");
      const items = cart.items || [];
      let changed = false;

      for (const rule of rules) {
        const { qualifies, giftItems } = evaluate(rule, items);
        if (!qualifies) {
          // Remove gifts we added once the cart no longer qualifies.
          for (const item of giftItems.filter((i) => i.properties?._free_gift === rule.id)) {
            await cartRequest("cart/change.js", { id: item.key, quantity: 0 });
            changed = true;
          }
          continue;
        }
        if (giftItems.length > 0) continue;
        if (rule.autoAdd) {
          await addGift(rule);
          return;
        }
        if (!sessionStorage.getItem(dismissKey(rule))) {
          showOffer(rule);
          break;
        }
      }
      if (changed) afterCartChange();
    } catch (err) {
      console.warn("[kitgift]", err);
    } finally {
      running = false;
    }
  };

  let timer;
  const scheduleCheck = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 400);
  };
  const isCartMutation = (url) => /\/cart\/(add|change|update|clear)(\.js)?/.test(String(url || ""));

  // Catch AJAX add-to-cart from any theme or app.
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    if (isCartMutation(url)) scheduleCheck();
    return response;
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isCartMutation(url)) this.addEventListener("load", scheduleCheck);
    return nativeOpen.call(this, method, url, ...rest);
  };

  // ---- Product page notice ----
  const showBadge = () => {
    if (!settings.productBadge || !settings.product) return;
    const rule = rules.find((r) =>
      isTrigger(r, { productId: settings.product.id, vendor: settings.product.vendor }),
    );
    const form = document.querySelector('form[action*="/cart/add"]');
    if (!rule || !form || form.querySelector(".kitgift-badge")) return;
    const badge = document.createElement("p");
    badge.className = "kitgift-badge";
    badge.textContent = (settings.badgeText || "🎁 Get a FREE {gift} with this item").replace(
      "{gift}",
      rule.giftTitle || "gift",
    );
    const button = form.querySelector('[type="submit"], button[name="add"]');
    (button?.parentElement || form).insertBefore(badge, button || null);
  };

  showBadge();
  check();
})();
