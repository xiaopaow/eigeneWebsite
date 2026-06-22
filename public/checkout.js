const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const money = value => `$${Number(value).toFixed(2)}`;
let cart = [];
let products = [];

function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem("patchreach_quote") || "[]");
    return Array.isArray(saved) ? saved.map(item => typeof item === "string" ? { sku: item, quantity: 1 } : item) : [];
  } catch {
    return [];
  }
}

function selectedItems() {
  return cart.map(item => ({ ...item, product: products.find(product => product.sku === item.sku) })).filter(item => item.product);
}

function render() {
  const items = selectedItems();
  const blocked = items.filter(item => !item.product.direct_checkout || item.product.price_from == null);
  const total = items.reduce((sum, item) => sum + Number(item.product.price_from || 0) * item.quantity, 0);
  $("[data-checkout-items]").innerHTML = items.length ? items.map(item => `<article class="checkout-item"><img src="${esc(item.product.image_url || "/assets/product-steel.svg")}" alt="${esc(item.product.image_alt || item.product.name)}"><div><h3>${esc(item.product.name)}</h3><p>${esc(item.product.sku)} · x${item.quantity} · ${money(item.product.price_from)} each</p></div><b>${money(Number(item.product.price_from) * item.quantity)}</b></article>`).join("") : '<p class="muted">Your selection is empty. Return to the catalog to choose products.</p>';
  $("[data-checkout-subtotal]").textContent = money(total);
  $("[data-checkout-total]").textContent = `${money(total)} USD`;
  if (blocked.length) throw new Error(`${blocked.map(item => item.product.name).join(", ")} must be quoted before payment.`);
  if (!items.length) throw new Error("Your checkout list is empty.");
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { error: await response.text() };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function loadPayPal(config) {
  const form = $("[data-checkout-form]");
  const container = $("[data-paypal-buttons]");
  const status = $("[data-payment-status]");
  if (!config.enabled || !config.clientId) {
    status.textContent = "PayPal Sandbox is not configured. Add the PayPal credentials in .env to enable payment.";
    return;
  }
  container.innerHTML = `<button type="button" class="paypal-redirect-button" disabled>
    <span>Continue with <b>PayPal</b></span><small>Secure redirect checkout</small>
  </button>`;
  const button = container.querySelector("button");
  const syncFormState = () => {
    button.disabled = !form.checkValidity();
    status.textContent = button.disabled ? "Complete the delivery form to enable PayPal." : "";
  };
  form.addEventListener("input", syncFormState);
  form.addEventListener("change", syncFormState);
  button.addEventListener("click", async () => {
    if (!form.reportValidity()) return syncFormState();
    button.disabled = true;
    status.textContent = "Connecting to PayPal securely...";
    try {
      const customer = Object.fromEntries(new FormData(form));
      const result = await api("/api/checkout/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...customer, items: cart })
      });
      if (!/^https:\/\/(www\.)?(sandbox\.)?paypal\.com\//i.test(result.approvalUrl || "")) {
        throw new Error("PayPal returned an invalid checkout link.");
      }
      location.assign(result.approvalUrl);
    } catch (error) {
      status.textContent = error.message || "PayPal could not start the payment.";
      syncFormState();
    }
  });
  syncFormState();
}

async function initialize() {
  cart = readCart();
  try {
    const [catalog, config] = await Promise.all([api("/api/products"), api("/api/checkout/config")]);
    products = catalog.products;
    render();
    loadPayPal(config);
  } catch (error) {
    $("[data-payment-status]").textContent = error.message;
    $("[data-paypal-buttons]").innerHTML = '<a href="/#compare">Return to the product list</a>';
  }
}
initialize();
