const state = { products: [], quote: [], search: "", collection: "All", tier: "All", footprint: "All", sort: "recommended", checks: {} };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const money = value => value == null ? "Request quote" : `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const tierBucket = product => Number(product.tier_count) >= 4 ? "4" : String(product.tier_count);
const quoteItem = sku => state.quote.find(item => item.sku === sku);
const hasQuote = sku => Boolean(quoteItem(sku));

function normalizeStoredQuote(value) {
  if (!Array.isArray(value)) return [];
  const merged = new Map();
  value.forEach(item => {
    const sku = String(typeof item === "string" ? item : item?.sku || "").trim();
    const quantity = Math.min(20, Math.max(1, Number(typeof item === "string" ? 1 : item?.quantity) || 1));
    if (sku) merged.set(sku, Math.min(20, (merged.get(sku) || 0) + quantity));
  });
  return [...merged].map(([sku, quantity]) => ({ sku, quantity }));
}

function saveQuote() {
  localStorage.setItem("patchreach_quote", JSON.stringify(state.quote));
}

function readControls() {
  state.search = ($("[data-search]")?.value || "").trim().toLowerCase();
  state.collection = $("[data-material]")?.value || "All";
  state.tier = $("[data-tier]")?.value || "All";
  state.footprint = $("[data-footprint]")?.value || "All";
  state.sort = $("[data-sort]")?.value || "recommended";
  state.checks = {};
  $$("[data-check-filter]:checked").forEach(input => {
    (state.checks[input.dataset.checkFilter] ||= []).push(input.value);
  });
}

function matches(product) {
  const text = [product.sku, product.name, product.collection, product.material, product.device, product.fit, product.description, product.tag].join(" ").toLowerCase();
  const checks = (key, value) => !state.checks[key]?.length || state.checks[key].includes(String(value));
  return (!state.search || text.includes(state.search))
    && (state.collection === "All" || product.collection === state.collection)
    && (state.tier === "All" || tierBucket(product) === state.tier)
    && (state.footprint === "All" || product.footprint === state.footprint)
    && checks("collection", product.collection)
    && checks("tier_count", tierBucket(product))
    && checks("footprint", product.footprint);
}

function productImage(product) {
  const src = product.image_url || "/assets/product-steel.svg";
  return `<img src="${esc(src)}" alt="${esc(product.image_alt || product.name)}" loading="lazy" data-fallback-image>`;
}

function rowCard(product) {
  const checked = hasQuote(product.sku) ? "checked" : "";
  return `<article class="row-card">
    <input type="checkbox" data-row-quote="${esc(product.sku)}" ${checked} aria-label="Compare ${esc(product.name)}">
    <a class="product-thumb-link" href="/products/${encodeURIComponent(product.sku)}" aria-label="View ${esc(product.name)} details">${productImage(product)}</a>
    <div><a class="product-title-link" href="/products/${encodeURIComponent(product.sku)}"><span class="tag">${esc(product.sku)}</span><h3>${esc(product.name)}</h3></a><p>Fits ${esc(product.device)}</p><div class="tags"><span class="tag">${esc(product.tier_label)}</span><span class="tag">${esc(product.collection)}</span></div></div>
    <div class="row-specs"><span>Angle<br><b>${esc(product.angle || "Custom")}</b></span><span>Width<br><b>${esc(product.width_cm || "TBC")} cm</b></span><span>Depth<br><b>${esc(product.depth_cm || "TBC")} cm</b></span><span>Load<br><b>${esc(product.load_kg || "TBC")} kg</b></span></div>
    <div class="row-price"><small>From</small><br><b>${money(product.price_from)}</b><br><small>Final price by fit</small></div>
    <button class="btn" type="button" data-add-quote="${esc(product.sku)}">${checked ? "Selected" : "Add to quote"}</button>
  </article>`;
}

function filteredProducts() {
  readControls();
  const products = state.products.filter(matches);
  if (state.sort === "price-low") products.sort((a,b) => Number(a.price_from ?? Infinity) - Number(b.price_from ?? Infinity));
  if (state.sort === "price-high") products.sort((a,b) => Number(b.price_from ?? -1) - Number(a.price_from ?? -1));
  return products;
}

function renderProducts() {
  const products = filteredProducts();
  $("[data-result-count]").textContent = products.length;
  $("[data-product-list]").innerHTML = products.length ? products.map(rowCard).join("") : '<div class="empty-state">No exact matches. Clear filters or send your gear list for a custom recommendation.</div>';
  bindImageFallbacks();
}

function bindImageFallbacks() {
  $$("[data-fallback-image]").forEach(image => image.addEventListener("error", () => {
    image.src = "/assets/product-steel.svg";
    image.removeAttribute("data-fallback-image");
  }, { once: true }));
}

function toggleQuote(sku, force) {
  const has = hasQuote(sku);
  if ((force ?? !has) && !has) state.quote.push({ sku, quantity: 1 });
  if (!(force ?? !has) && has) state.quote = state.quote.filter(item => item.sku !== sku);
  saveQuote();
  renderProducts();
  renderQuote();
}

function changeQuantity(sku, delta) {
  const item = quoteItem(sku);
  if (!item) return;
  item.quantity = Math.min(20, Math.max(1, item.quantity + delta));
  saveQuote();
  renderQuote();
}

function closeClearConfirmation() {
  $("[data-clear-quote-confirm]").hidden = true;
}

function clearQuote() {
  state.quote = [];
  localStorage.removeItem("patchreach_quote");
  closeClearConfirmation();
  renderProducts();
  renderQuote();
}

function renderQuote() {
  const items = state.quote.map(item => ({ ...item, product: state.products.find(product => product.sku === item.sku) })).filter(item => item.product);
  $$("[data-quote-count]").forEach(node => node.textContent = items.length);
  $("[data-clear-quote]").hidden = !items.length;
  if (!items.length) closeClearConfirmation();
  const total = items.reduce((sum, item) => sum + Number(item.product.price_from || 0) * item.quantity, 0);
  $("[data-quote-total]").textContent = money(total);
  $("[data-quote-items]").innerHTML = items.length ? items.map(item => `<div class="quote-chip">
    ${productImage(item.product)}
    <div><b>${esc(item.product.name)}</b><br><span>${esc(item.product.collection)}</span><br><b>${money(item.product.price_from)}</b>
      <div class="quantity-control"><button type="button" data-quantity="${esc(item.product.sku)}" data-delta="-1" aria-label="Decrease quantity">−</button><span>x${item.quantity}</span><button type="button" data-quantity="${esc(item.product.sku)}" data-delta="1" aria-label="Increase quantity">+</button></div>
    </div>
    <button type="button" data-remove-quote="${esc(item.product.sku)}" aria-label="Remove ${esc(item.product.name)}">×</button>
  </div>`).join("") : '<p class="muted">Select products to build a quote.</p>';
  $("[data-form-products]").textContent = items.length ? `Selected: ${items.map(item => `${item.product.name} x${item.quantity}`).join(", ")}` : "No products selected. You can still request an exact recommendation.";
  const blocked = items.filter(item => !item.product.direct_checkout || item.product.price_from == null);
  const checkout = $("[data-checkout]");
  checkout.disabled = !items.length || blocked.length > 0;
  checkout.title = blocked.length ? "Custom or From-price products must be quoted before payment." : "";
  $("[data-checkout-note]").textContent = blocked.length
    ? `${blocked.length} selected product${blocked.length > 1 ? "s require" : " requires"} a quote before checkout.`
    : items.length ? "Fixed-price products are eligible for PayPal checkout. Shipping is not included." : "";
  bindImageFallbacks();
}

async function submitInquiry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("[data-form-status]", form);
  const button = $("button[type=submit]", form);
  status.classList.remove("error");
  status.textContent = "Sending your fit request...";
  button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  data.items = state.quote;
  data.productSkus = state.quote.map(item => item.sku);
  try {
    const response = await fetch("/api/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const contentType = response.headers.get("content-type") || "";
    const result = contentType.includes("application/json")
      ? await response.json()
      : { error: await response.text() };
    if (!response.ok) throw new Error(result.error || "Request failed.");
    status.textContent = `${result.message} Reference #${result.inquiryId}.`;
    form.reset();
    state.quote = [];
    localStorage.removeItem("patchreach_quote");
    renderProducts();
    renderQuote();
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message || "We could not send the request. Please try again.";
  } finally {
    button.disabled = false;
  }
}

function wire() {
  $$("[data-search],[data-material],[data-tier],[data-footprint],[data-sort]").forEach(node => node.addEventListener("input", renderProducts));
  $$("[data-check-filter]").forEach(node => node.addEventListener("change", renderProducts));
  document.addEventListener("click", event => {
    const add = event.target.closest("[data-add-quote]");
    const remove = event.target.closest("[data-remove-quote]");
    const quantity = event.target.closest("[data-quantity]");
    const openClear = event.target.closest("[data-clear-quote]");
    const cancelClear = event.target.closest("[data-cancel-clear]");
    const confirmClear = event.target.closest("[data-confirm-clear]");
    if (add) toggleQuote(add.dataset.addQuote, true);
    if (remove) toggleQuote(remove.dataset.removeQuote, false);
    if (quantity) changeQuantity(quantity.dataset.quantity, Number(quantity.dataset.delta));
    if (openClear) {
      $("[data-clear-quote-message]").textContent = `Clear all ${state.quote.length} selected product${state.quote.length === 1 ? "" : "s"}?`;
      $("[data-clear-quote-confirm]").hidden = false;
      $("[data-confirm-clear]").focus();
    }
    if (cancelClear) closeClearConfirmation();
    if (confirmClear) clearQuote();
  });
  document.addEventListener("change", event => {
    const checkbox = event.target.closest("[data-row-quote]");
    if (checkbox) toggleQuote(checkbox.dataset.rowQuote, checkbox.checked);
  });
  $("[data-clear-filters]").addEventListener("click", () => {
    $$("[data-check-filter]").forEach(input => { input.checked = false; });
    $$("[data-search],[data-material],[data-tier],[data-footprint]").forEach(input => { input.value = input.matches("[data-search]") ? "" : "All"; });
    renderProducts();
  });
  $("[data-menu-toggle]").addEventListener("click", () => $("[data-nav-links]").classList.toggle("open"));
  $("[data-focus-search]").addEventListener("click", () => { location.hash = "#finder"; setTimeout(() => $("[data-search]").focus(), 100); });
  $("[data-request-form]").addEventListener("submit", submitInquiry);
  $("[data-checkout]").addEventListener("click", () => { if (!$("[data-checkout]").disabled) location.href = "/checkout"; });
}

async function initialize() {
  state.quote = normalizeStoredQuote(JSON.parse(localStorage.getItem("patchreach_quote") || "[]"));
  saveQuote();
  wire();
  try {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Catalog unavailable.");
    state.products = (await response.json()).products;
    $("[data-product-metric]").textContent = state.products.length;
    state.quote = state.quote.filter(item => state.products.some(product => product.sku === item.sku));
    saveQuote();
    renderProducts();
    renderQuote();
  } catch {
    $("[data-product-list]").innerHTML = '<div class="empty-state">The catalog is temporarily unavailable. Please refresh or use the fit request form.</div>';
  }
}
initialize();
