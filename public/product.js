const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const money = value => value == null ? "Request quote" : `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
let selectedQuantity = 1;

function readQuote() {
  try {
    const saved = JSON.parse(localStorage.getItem("patchreach_quote") || "[]");
    if (!Array.isArray(saved)) return [];
    const merged = new Map();
    saved.forEach(item => {
      const sku = String(typeof item === "string" ? item : item?.sku || "").trim();
      const quantity = Math.min(20, Math.max(1, Number(typeof item === "string" ? 1 : item?.quantity) || 1));
      if (sku) merged.set(sku, Math.min(20, (merged.get(sku) || 0) + quantity));
    });
    return [...merged].map(([sku, quantity]) => ({ sku, quantity }));
  } catch {
    return [];
  }
}

function saveQuote(quote) {
  localStorage.setItem("patchreach_quote", JSON.stringify(quote));
  document.querySelectorAll("[data-quote-count]").forEach(node => { node.textContent = quote.length; });
}

function spec(label, value, suffix = "") {
  return `<article><span>${esc(label)}</span><b>${esc(value == null || value === "" ? "TBC" : `${value}${suffix}`)}</b></article>`;
}

function tableRow(label, value, suffix = "") {
  return `<div><span>${esc(label)}</span><b>${esc(value == null || value === "" ? "TBC" : `${value}${suffix}`)}</b></div>`;
}

function setQuantity(value) {
  selectedQuantity = Math.min(20, Math.max(1, value));
  $("[data-detail-quantity-label]").textContent = `x${selectedQuantity}`;
}

function addToQuote(product) {
  const quote = readQuote();
  const existing = quote.find(item => item.sku === product.sku);
  if (existing) existing.quantity = Math.min(20, existing.quantity + selectedQuantity);
  else quote.push({ sku: product.sku, quantity: selectedQuantity });
  saveQuote(quote);
  $("[data-detail-status]").textContent = `${product.name} x${selectedQuantity} is in your quote list.`;
}

function renderProduct(product) {
  const intro = product.detail_intro || product.description || product.fit || "Built around exact desk fit, gear access, and cable clearance.";
  const directCheckout = Boolean(product.direct_checkout && product.price_from != null);
  document.title = `${product.name} | PatchReach`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", intro.slice(0, 180));
  $("[data-detail-name]").textContent = product.name;
  $("[data-detail-collection]").textContent = `${product.collection} / ${product.material}`;
  $("[data-detail-intro]").textContent = intro;
  $("[data-detail-long-description]").textContent = intro;
  $("[data-detail-image]").src = product.image_url || "/assets/product-steel.svg";
  $("[data-detail-image]").alt = product.image_alt || product.name;
  $("[data-detail-sku]").textContent = product.sku;
  $("[data-detail-price]").textContent = money(product.price_from);
  $("[data-detail-purchase-note]").textContent = directCheckout
    ? "Fixed product total now. Shipping is quoted separately."
    : "This product requires fit confirmation before payment.";
  $("[data-detail-badges]").innerHTML = [
    product.tier_label,
    product.footprint,
    product.direct_checkout ? "Direct checkout" : "Quote-first fit"
  ].map(item => `<span class="tag">${esc(item)}</span>`).join("");
  const specs = [
    ["Width", product.width_cm, " cm"],
    ["Depth", product.depth_cm, " cm"],
    ["Height", product.height_cm, " cm"],
    ["Load", product.load_kg, " kg"],
    ["Angle", product.angle || "Custom", ""],
    ["Tiers", product.tier_label, ""],
    ["Cable gap", product.cable_gap_cm, " cm"],
    ["Material", product.material, ""]
  ];
  $("[data-detail-specs]").innerHTML = specs.slice(0, 6).map(([label, value, suffix]) => spec(label, value, suffix)).join("");
  $("[data-detail-spec-table]").innerHTML = specs.map(([label, value, suffix]) => tableRow(label, value, suffix)).join("");
  $("[data-detail-device]").textContent = product.device || "Tell us your gear list and we will confirm fit.";
  $("[data-detail-fit]").textContent = product.fit || product.description || "Exact fit will be confirmed before production.";
  $("[data-detail-spec-notes]").textContent = product.spec_notes || "Measurements are checked again against your device list before production.";
  $("[data-detail-shipping]").textContent = product.shipping_note || "Shipping is quoted after destination and packing requirements are confirmed.";
  const features = Array.isArray(product.feature_list) && product.feature_list.length
    ? product.feature_list
    : [product.description, product.tag, "Exact-fit review before production"].filter(Boolean);
  $("[data-detail-features]").innerHTML = features.map(item => `<li>${esc(item)}</li>`).join("");
  $("[data-detail-checkout]").hidden = !directCheckout;
  $("[data-detail-add]").addEventListener("click", () => addToQuote(product));
  $("[data-detail-request]").addEventListener("click", () => addToQuote(product));
  $("[data-detail-checkout]").addEventListener("click", () => addToQuote(product));
  document.querySelectorAll("[data-detail-quantity]").forEach(button => {
    button.addEventListener("click", () => setQuantity(selectedQuantity + Number(button.dataset.detailQuantity)));
  });
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    image: product.image_url ? [new URL(product.image_url, location.origin).href] : undefined,
    description: intro,
    brand: { "@type": "Brand", name: "PatchReach" },
    offers: product.price_from == null ? undefined : {
      "@type": "Offer",
      priceCurrency: "USD",
      price: Number(product.price_from).toFixed(2),
      availability: "https://schema.org/InStock"
    }
  };
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(schema);
  document.head.appendChild(script);
}

function wireMenu() {
  $("[data-menu-toggle]")?.addEventListener("click", () => $("[data-nav-links]")?.classList.toggle("open"));
}

async function initialize() {
  wireMenu();
  saveQuote(readQuote());
  setQuantity(1);
  const product = window.__PATCHREACH_PRODUCT__;
  if (product) {
    renderProduct(product);
    return;
  }
  const sku = decodeURIComponent(location.pathname.split("/").pop() || "");
  const response = await fetch(`/api/products/${encodeURIComponent(sku)}`);
  if (!response.ok) location.href = "/#products";
  else renderProduct((await response.json()).product);
}

initialize();
