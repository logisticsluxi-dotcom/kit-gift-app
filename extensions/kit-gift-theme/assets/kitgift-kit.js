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
    const minItems = tiers[0].minItems;

    const moneyFormat = el.dataset.moneyFormat;
    const allowMultiples = el.dataset.allowMultiples === "true";
    const root = el.dataset.root || "/";

    // Vendor filter: ?vendor= link > block setting > app setting.
    const urlVendor = new URLSearchParams(location.search).get("vendor");
    const blockVendors = (el.dataset.vendorFilter || "").split(",").map(norm).filter(Boolean);
    const appVendors = (config.vendors || []).map(norm).filter(Boolean);
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

    const tierList = el.querySelector("[data-kitgift-tiers]");
    if (tierList) {
      tierList.innerHTML = "";
      for (const t of tiers) {
        const li = document.createElement("li");
        li.textContent = `${t.minItems}+ items: ${t.percent}% off`;
        li.dataset.min = String(t.minItems);
        tierList.appendChild(li);
      }
    }

    const state = new Map(); // card -> quantity
    const variantOf = (card) => {
      const input = card.querySelector("[data-kitgift-variant]");
      const option = input?.tagName === "SELECT" ? input.selectedOptions[0] : input;
      return { id: Number(input?.value), price: Number(option?.dataset.price || 0) };
    };

    const status = el.querySelector("[data-kitgift-status]");
    const total = el.querySelector("[data-kitgift-total]");
    const progress = el.querySelector("[data-kitgift-progress]");
    const addButton = el.querySelector("[data-kitgift-add]");

    const render = () => {
      let count = 0;
      let subtotal = 0;
      for (const card of cards) {
        const qty = state.get(card) || 0;
        count += qty;
        subtotal += qty * variantOf(card).price;
        card.querySelector("[data-kitgift-count]").textContent = String(qty);
        card.classList.toggle("is-selected", qty > 0);
        card.querySelector("[data-kitgift-plus]").disabled = !allowMultiples && qty >= 1;
        card.querySelector("[data-kitgift-minus]").disabled = qty === 0;
      }

      const current = [...tiers].reverse().find((t) => count >= t.minItems);
      const next = tiers.find((t) => count < t.minItems);

      if (!current) {
        const need = minItems - count;
        status.textContent = `${count} selected — add ${need} more to save ${tiers[0].percent}%`;
      } else if (next) {
        const need = next.minItems - count;
        status.textContent = `${count} selected — you're saving ${current.percent}%! Add ${need} more for ${next.percent}% off`;
      } else {
        status.textContent = `${count} selected — you're saving ${current.percent}%!`;
      }

      if (current && subtotal > 0) {
        const discounted = Math.round(subtotal * (1 - current.percent / 100));
        total.innerHTML = `<s></s> <strong></strong>`;
        total.querySelector("s").textContent = formatMoney(subtotal, moneyFormat);
        total.querySelector("strong").textContent = formatMoney(discounted, moneyFormat);
      } else {
        total.textContent = subtotal > 0 ? formatMoney(subtotal, moneyFormat) : "";
      }

      const goal = tiers[tiers.length - 1].minItems;
      progress.style.width = `${Math.min(100, (count / goal) * 100)}%`;
      tierList?.querySelectorAll("li").forEach((li) => {
        li.classList.toggle("is-reached", count >= Number(li.dataset.min));
      });
      addButton.disabled = count < minItems;
    };

    for (const card of cards) {
      card.querySelector("[data-kitgift-plus]").addEventListener("click", () => {
        state.set(card, (state.get(card) || 0) + 1);
        render();
      });
      card.querySelector("[data-kitgift-minus]").addEventListener("click", () => {
        state.set(card, Math.max(0, (state.get(card) || 0) - 1));
        render();
      });
      card.querySelector("select[data-kitgift-variant]")?.addEventListener("change", render);
    }

    addButton.addEventListener("click", async () => {
      const kitId = `kit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const items = [];
      for (const card of cards) {
        const qty = state.get(card) || 0;
        if (qty > 0) {
          items.push({
            id: variantOf(card).id,
            quantity: qty,
            properties: { _kit: kitId, Bundle: config.title || "Build your own kit" },
          });
        }
      }
      if (items.length === 0) return;

      addButton.disabled = true;
      const label = addButton.textContent;
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
        if (after === "checkout") location.href = `${root}checkout`;
        else if (after === "cart") location.href = `${root}cart`;
        else {
          state.clear();
          addButton.textContent = "Added!";
          setTimeout(() => {
            addButton.textContent = label;
            render();
          }, 1500);
          return;
        }
      } catch (err) {
        alert(err.message);
        addButton.textContent = label;
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
