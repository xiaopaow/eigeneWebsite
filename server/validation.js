const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeCartItems(items, legacySkus = []) {
  const source = Array.isArray(items) && items.length
    ? items
    : (Array.isArray(legacySkus) ? legacySkus : []).map(sku => ({ sku, quantity: 1 }));
  const merged = new Map();
  for (const entry of source.slice(0, 100)) {
    const sku = String(typeof entry === "string" ? entry : entry?.sku || "").trim().toUpperCase();
    const quantity = Number(typeof entry === "string" ? 1 : entry?.quantity);
    if (!sku || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return { error: "Each product quantity must be between 1 and 20." };
    }
    merged.set(sku, (merged.get(sku) || 0) + quantity);
    if (merged.get(sku) > 20) return { error: "Each product quantity must be between 1 and 20." };
  }
  const value = [...merged.entries()].slice(0, 30).map(([sku, quantity]) => ({ sku, quantity }));
  return { value };
}

export function validateInquiry(body) {
  const cart = normalizeCartItems(body.items, body.productSkus);
  if (cart.error) return cart;
  const inquiry = {
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    company: String(body.company || "").trim(),
    country: String(body.country || "").trim(),
    gear: String(body.gear || "").trim(),
    notes: String(body.notes || "").trim(),
    items: cart.value,
    product_skus: cart.value.map(item => item.sku),
    website: String(body.website || "").trim()
  };
  if (inquiry.website) return { error: "Submission rejected." };
  if (inquiry.name.length < 2 || inquiry.name.length > 120) return { error: "Enter your name." };
  if (!emailPattern.test(inquiry.email) || inquiry.email.length > 254) return { error: "Enter a valid email." };
  if (inquiry.gear.length < 3 || inquiry.gear.length > 4000) return { error: "Tell us which gear you use." };
  if (inquiry.notes.length > 4000) return { error: "Notes are too long." };
  return { value: inquiry };
}

export function validateCheckout(body) {
  const cart = normalizeCartItems(body.items);
  if (cart.error || !cart.value.length) return { error: cart.error || "Your checkout list is empty." };
  const checkout = {
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    phone: String(body.phone || "").trim(),
    country: String(body.country || "").trim(),
    address1: String(body.address1 || "").trim(),
    address2: String(body.address2 || "").trim(),
    city: String(body.city || "").trim(),
    region: String(body.region || "").trim(),
    postal_code: String(body.postal_code || "").trim(),
    items: cart.value,
    website: String(body.website || "").trim()
  };
  if (checkout.website) return { error: "Submission rejected." };
  if (checkout.name.length < 2 || checkout.name.length > 120) return { error: "Enter your name." };
  if (!emailPattern.test(checkout.email) || checkout.email.length > 254) return { error: "Enter a valid email." };
  if (!checkout.phone || checkout.phone.length > 60) return { error: "Enter a phone number." };
  for (const [key, label] of [["country", "country"], ["address1", "address"], ["city", "city"], ["postal_code", "postal code"]]) {
    if (!checkout[key] || checkout[key].length > 180) return { error: `Enter your ${label}.` };
  }
  if (checkout.address2.length > 180 || checkout.region.length > 180) return { error: "Address details are too long." };
  return { value: checkout };
}

export function validateProduct(body) {
  const product = {
    sku: String(body.sku || "").trim().toUpperCase(),
    name: String(body.name || "").trim(),
    collection: String(body.collection || "").trim(),
    material: String(body.material || "").trim(),
    tier_count: Number(body.tier_count || 1),
    tier_label: String(body.tier_label || "").trim(),
    device: String(body.device || "").trim(),
    angle: String(body.angle || "").trim(),
    fit: String(body.fit || "").trim(),
    description: String(body.description || "").trim(),
    tag: String(body.tag || "").trim(),
    image_url: body.image_url ? String(body.image_url).trim() : null,
    image_alt: String(body.image_alt || "").trim(),
    price_from: body.price_from === "" || body.price_from == null ? null : Number(body.price_from),
    footprint: String(body.footprint || "Medium").trim(),
    width_cm: nullableNumber(body.width_cm),
    depth_cm: nullableNumber(body.depth_cm),
    height_cm: nullableNumber(body.height_cm),
    cable_gap_cm: nullableNumber(body.cable_gap_cm),
    load_kg: nullableNumber(body.load_kg),
    status: String(body.status || "published"),
    sort_order: Number(body.sort_order || 0),
    direct_checkout: body.direct_checkout === true || body.direct_checkout === "true" || body.direct_checkout === "on"
  };
  if (!/^[A-Z0-9-]{2,64}$/.test(product.sku)) return { error: "SKU must use letters, numbers, and hyphens." };
  if (product.name.length < 2 || product.name.length > 160) return { error: "Product name is required." };
  if (!product.collection || !product.material) return { error: "Collection and material are required." };
  if (!Number.isInteger(product.tier_count) || product.tier_count < 1 || product.tier_count > 12) return { error: "Tier count must be between 1 and 12." };
  if (!["draft", "published", "archived"].includes(product.status)) return { error: "Invalid product status." };
  if (product.price_from != null && (!Number.isFinite(product.price_from) || product.price_from < 0)) return { error: "Invalid price." };
  if (product.direct_checkout && product.price_from == null) return { error: "Direct checkout requires a fixed price." };
  return { value: product };
}

function nullableNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
