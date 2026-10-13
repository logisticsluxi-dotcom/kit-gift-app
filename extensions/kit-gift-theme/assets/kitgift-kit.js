(() => {
  const norm = (s) => String(s ?? "").trim().toLowerCase();

  const formatMoney = (cents, format) => {
    const amount = (cents / 100).toFixed(2);
    return (format || "${{amount}}").replace(/\{\{\s*(\w+)\s*\}\}/, (_, kind) => {
      if (kind === "amount_no_decimals") return Math.round(cents / 100).toString();
      if (kind === "amount_with_comma_separator") return amount.replace(".", ",");
      return amount;
    });
  };

  const init = (el) => {
    if (el.dataset.kitgiftReady) return;
    el.dataset.kitgiftReady = "1";

    let config = {};
    try {
      config = JSON.parse(el.querySelector("[data-kitgift-kit-config]")?.textContent || "{}") || {};
    } catch {
      // Invalid config: leave the builder inactive.
    }
    if (!config.enabled) return;

    const tiers = (config.tiers || [])
      .map((t) => ({ minItems: Number(t.minItems), percent: Number(t.percent) }))
      .filter((t) => t.minItems > 0 && t.percent > 0)
      .sort((a, b) => a.minItems - b.minItems);
    if (tiers.length === 0) return;

    const moneyFormat = el.dataset.moneyFormat;
    const allowMultiples = el.dataset.allowMultiples === "true";
    const root = el.dataset.root || "/";

    // Vendor filter: ?vendor= link > block setting > app setting.
    const urlVendor = new URLSearchParams(location.search).get("vendor");
    const blockVendors = (el.dataset.vendorFilter || "").split(",").map(norm).filter(Boolean);
    const appVendors = [...new Set((config.vendors || []).map(norm).filter(Boolean))];
    let allowed = blockVendors.length ? blockVendors : appVendors;
    if (urlVendor && (allowed.length === 0 || allowed.includes(norm(urlVendor)))) {
      allowed = [norm(urlVendor)];
      const title = el.querySelector("[data-kitgift-title]");
      if (title && el.dataset.headingVendor) {
        title.textContent = el.dataset.headingVendor.replace("{vendor}", urlVendor);
      }
    }

    const cards = [...el.querySelectorAll("[data-kitgift-card]")].filter((card) => {
      const ok = allowed.length === 0 || allowed.includes(norm(card.dataset.vendor));
      if (!ok) card.remove();
      return ok;
    });

    const variantOf = (card) => {
      const input = card.querySelector("[data-kitgift-variant]");
      const option = input?.tagName === "SELECT" ? input.selectedOptions[0] : input;
      return {
        id: Number(input?.value),
        price: Number(option?.dataset.price || 0),
        label: input?.tagName === "SELECT" ? option?.textContent.split("–")[0].trim() : "",
      };
    };

    /** @type {{ card: Element, id: number, price: number, title: string, image: string }[]} */
    let picks = [];
    let size = tiers[0].minItems;
    const tierFor = (n) => tiers.find((t) => t.minItems === n);

    const sizesEl = el.querySelector("[data-kitgift-sizes]");
    const slotsEl = el.querySelector("[data-kitgift-slots]");
    const status = el.querySelector("[data-kitgift-status]");
    const total = el.querySelector("[data-kitgift-total]");
    const message = el.querySelector("[data-kitgift-message]");
    const addButton = el.querySelector("[data-kitgift-add]");
    const addLabel = addButton.textContent.trim();

    let messageTimer;
    const flash = (text) => {
      message.textContent = text;
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => (message.textContent = ""), 3500);
    };

    // ---- Kit size buttons ----
    for (const tier of tiers) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kitgift-size";
      button.setAttribute("role", "radio");
      button.dataset.size = String(tier.minItems);
      button.innerHTML = `<strong></strong><span></span>`;
      button.querySelector("strong").textContent = `${tier.minItems} items`;
      button.querySelector("span").textContent = `Save ${tier.percent}%`;
      button.addEventListener("click", () => {
        size = tier.minItems;
        if (picks.length > size) {
          picks = picks.slice(0, size);
          flash(`Kit resized to ${size} items — removed the extra picks.`);
        }
        render();
      });
      sizesEl.appendChild(button);
    }

    const removePick = (index) => {
      picks.splice(index, 1);
      render();
    };

    const render = () => {
      const tier = tierFor(size);

      sizesEl.querySelectorAll(".kitgift-size").forEach((b) => {
        const active = Number(b.dataset.size) === size;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-checked", String(active));
      });

      // Slots: one box per item in the chosen kit size.
      slotsEl.innerHTML = "";
      slotsEl.style.setProperty("--kitgift-slots", String(size));
      for (let i = 0; i < size; i++) {
        const pick = picks[i];
        const slot = document.createElement("div");
        slot.className = `kitgift-slot${pick ? " is-filled" : ""}`;
        if (pick) {
          if (pick.image) {
            const img = document.createElement("img");
            img.src = pick.image;
            img.alt = pick.title;
            slot.appendChild(img);
          } else {
            slot.textContent = pick.title;
          }
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "kitgift-slot__remove";
          remove.setAttribute("aria-label", `Remove ${pick.title}`);
          remove.textContent = "×";
          remove.addEventListener("click", () => removePick(i));
          slot.appendChild(remove);
          slot.title = pick.title;
        } else {
          slot.innerHTML = `<span>${i + 1}</span>`;
        }
        slotsEl.appendChild(slot);
      }

      // Cards: count badges and button state.
      const full = picks.length >= size;
      for (const card of cards) {
        const count = picks.filter((p) => p.card === card).length;
        const badge = card.querySelector("[data-kitgift-count]");
        badge.hidden = count === 0;
        badge.textContent = count > 1 ? `×${count}` : "✓";
        card.classList.toggle("is-selected", count > 0);
        const button = card.querySelector("[data-kitgift-pick]");
        const blocked = full || (!allowMultiples && count > 0);
        button.disabled = blocked;
        button.textContent = !allowMultiples && count > 0 ? "In your kit" : full ? "Kit is full" : "Add to kit";
      }

      // Summary
      const subtotal = picks.reduce((sum, p) => sum + p.price, 0);
      const left = size - picks.length;
      status.textContent =
        left > 0
          ? `${picks.length} of ${size} picked — add ${left} more to save ${tier.percent}%`
          : `Your kit is ready — you're saving ${tier.percent}%!`;
      if (subtotal > 0) {
        const discounted = Math.round(subtotal * (1 - tier.percent / 100));
        total.innerHTML = left > 0 ? "<span></span>" : "<s></s> <strong></strong>";
        if (left > 0) total.querySelector("span").textContent = formatMoney(subtotal, moneyFormat);
        else {
          total.querySelector("s").textContent = formatMoney(subtotal, moneyFormat);
          total.querySelector("strong").textContent = formatMoney(discounted, moneyFormat);
        }
      } else {
        total.textContent = "";
      }
      addButton.disabled = left > 0;
      addButton.textContent = left > 0 ? addLabel : `${addLabel} · Save ${tier.percent}%`;
    };

    for (const card of cards) {
      card.querySelector("[data-kitgift-pick]").addEventListener("click", () => {
        if (picks.length >= size) {
          const bigger = tiers.find((t) => t.minItems > size);
          flash(bigger ? `Your kit is full. Choose ${bigger.minItems} items to add more.` : "Your kit is full.");
          return;
        }
        const variant = variantOf(card);
        picks.push({
          card,
          id: variant.id,
          price: variant.price,
          title: [card.dataset.title, variant.label].filter(Boolean).join(" – "),
          image: card.dataset.image || "",
        });
        render();
      });
    }

    addButton.addEventListener("click", async () => {
      if (picks.length < size) return;
      const kitId = `kit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const quantities = new Map();
      for (const p of picks) quantities.set(p.id, (quantities.get(p.id) || 0) + 1);
      const items = [...quantities].map(([id, quantity]) => ({
        id,
        quantity,
        properties: { _kit: kitId, Bundle: config.title || "Build your own kit" },
      }));

      addButton.disabled = true;
      addButton.textContent = "Adding…";
      try {
        const res = await fetch(`${root}cart/add.js`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.description || "Could not add kit to cart");
        }
        document.dispatchEvent(new CustomEvent("kitgift:cart-updated", { bubbles: true }));
        const after = el.dataset.afterAdd;
        if (after === "checkout") return void (location.href = `${root}checkout`);
        if (after === "cart") return void (location.href = `${root}cart`);
        picks = [];
        flash("Kit added to your cart!");
        render();
      } catch (err) {
        flash(err.message);
        render();
      }
    });

    render();
  };

  const boot = () => document.querySelectorAll("[data-kitgift-kit]").forEach(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  // Re-init when the theme editor re-renders the section.
  document.addEventListener("shopify:section:load", boot);
})();
