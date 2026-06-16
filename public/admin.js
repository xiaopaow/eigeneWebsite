const state = { products: [], inquiries: [], orders: [], active: "products" };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const money = value => value == null ? "Quote" : `$${Number(value).toLocaleString()}`;

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = response.status === 204 ? null : contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { error: await response.text() };
  if (!response.ok) throw new Error(body?.error || "Request failed.");
  return body;
}

function showDashboard() {
  $("[data-login-view]").hidden = true;
  $("[data-dashboard]").hidden = false;
  $("[data-logout]").hidden = false;
}

async function checkSession() {
  try {
    await api("/api/admin/session");
    showDashboard();
    await loadProducts();
  } catch {
    $("[data-login-view]").hidden = false;
  }
}

async function login(event) {
  event.preventDefault();
  const status = $("[data-login-status]");
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await api("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    showDashboard();
    await loadProducts();
  } catch (error) { status.textContent = error.message; }
}

async function loadProducts() {
  state.products = (await api("/api/admin/products")).products;
  renderProducts();
}

function renderProducts() {
  const query = ($("[data-admin-search]").value || "").toLowerCase();
  const products = state.products.filter(product => `${product.sku} ${product.name} ${product.collection}`.toLowerCase().includes(query));
  $("[data-admin-count]").textContent = products.length;
  $("[data-admin-products]").innerHTML = products.length ? products.map(product => `<article class="admin-row" data-edit-product="${product.id}"><img src="${esc(product.image_url || "/assets/product-steel.svg")}" alt=""><div><h3>${esc(product.name)}</h3><p>${esc(product.sku)} · ${esc(product.collection)}</p></div><span class="pill ${esc(product.status)}">${esc(product.status)}</span><b>${money(product.price_from)}</b></article>`).join("") : '<div class="empty">No products found.</div>';
}

function resetProductForm() {
  const form = $("[data-product-form]");
  form.reset();
  form.elements.id.value = "";
  form.elements.status.value = "published";
  form.elements.tier_count.value = "1";
  form.elements.sort_order.value = "0";
  form.elements.direct_checkout.checked = false;
  $("[data-editor-mode]").textContent = "New product";
  $("[data-editor-title]").textContent = "Add product";
  $("[data-delete-product]").hidden = true;
  $("[data-product-status]").textContent = "";
}

function editProduct(id) {
  const product = state.products.find(item => String(item.id) === String(id));
  if (!product) return;
  const form = $("[data-product-form]");
  Object.entries(product).forEach(([key, value]) => {
    if (!form.elements[key]) return;
    if (form.elements[key].type === "checkbox") form.elements[key].checked = Boolean(value);
    else form.elements[key].value = value ?? "";
  });
  $("[data-editor-mode]").textContent = product.sku;
  $("[data-editor-title]").textContent = product.name;
  $("[data-delete-product]").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("[data-product-status]");
  const data = Object.fromEntries(new FormData(form));
  delete data.image;
  const id = data.id;
  delete data.id;
  status.textContent = "Saving...";
  try {
    await api(id ? `/api/admin/products/${id}` : "/api/admin/products", {
      method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    });
    status.textContent = "Saved.";
    await loadProducts();
    if (!id) resetProductForm();
  } catch (error) { status.textContent = error.message; }
}

async function uploadImage() {
  const form = $("[data-product-form]");
  const file = form.elements.image.files[0];
  const status = $("[data-product-status]");
  if (!file) return status.textContent = "Choose an image first.";
  const data = new FormData();
  data.append("image", file);
  status.textContent = "Uploading...";
  try {
    const result = await api("/api/admin/upload", { method: "POST", body: data });
    form.elements.image_url.value = result.url;
    status.textContent = "Image uploaded. Save the product to apply it.";
  } catch (error) { status.textContent = error.message; }
}

async function deleteProduct() {
  const form = $("[data-product-form]");
  if (!form.elements.id.value || !confirm("Permanently delete this product? Archive is safer for past products.")) return;
  try {
    await api(`/api/admin/products/${form.elements.id.value}`, { method: "DELETE" });
    resetProductForm();
    await loadProducts();
  } catch (error) { $("[data-product-status]").textContent = error.message; }
}

async function loadInquiries() {
  state.inquiries = (await api("/api/admin/inquiries")).inquiries;
  $("[data-inquiries]").innerHTML = state.inquiries.length ? state.inquiries.map(item => `<article class="inquiry-row"><div><b>#${item.id}</b><p>${new Date(item.created_at).toLocaleString()}</p><span class="pill ${esc(item.status)}">${esc(item.status)}</span></div><div><b>${esc(item.name)}</b><p><a href="mailto:${esc(item.email)}">${esc(item.email)}</a><br>${esc(item.country || "")}</p></div><div><b>${esc((item.product_skus || []).join(", ") || "Recommendation request")}</b><p>${esc(item.gear)}</p><p>${esc(item.notes)}</p></div><select data-inquiry-status="${item.id}"><option value="new" ${item.status==="new"?"selected":""}>New</option><option value="contacted" ${item.status==="contacted"?"selected":""}>Contacted</option><option value="closed" ${item.status==="closed"?"selected":""}>Closed</option><option value="spam" ${item.status==="spam"?"selected":""}>Spam</option></select></article>`).join("") : '<div class="empty">No inquiries yet.</div>';
}

async function loadOrders() {
  state.orders = (await api("/api/admin/orders")).orders;
  $("[data-orders]").innerHTML = state.orders.length ? state.orders.map(order => `<article class="order-row">
    <div><b>${esc(order.order_number)}</b><p>${new Date(order.created_at).toLocaleString()}</p><span class="pill ${esc(order.status)}">${esc(order.status)}</span></div>
    <div><b>${esc(order.name)}</b><p><a href="mailto:${esc(order.email)}">${esc(order.email)}</a><br>${esc(order.country)} · ${esc(order.phone)}</p></div>
    <div><b>${(order.items || []).reduce((sum, item) => sum + Number(item.quantity), 0)} units</b><p>${(order.items || []).map(item => `${esc(item.sku)} x${item.quantity}`).join("<br>")}</p></div>
    <div><b>${esc(order.currency)} ${Number(order.total).toFixed(2)}</b><p>Order: ${esc(order.paypal_order_id || "-")}<br>Capture: ${esc(order.paypal_capture_id || "-")}</p></div>
  </article>`).join("") : '<div class="empty">No checkout orders yet.</div>';
}

async function switchTab(tab) {
  state.active = tab;
  $$("[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
  $("[data-products-panel]").hidden = tab !== "products";
  $("[data-inquiries-panel]").hidden = tab !== "inquiries";
  $("[data-orders-panel]").hidden = tab !== "orders";
  $(".page-head h1").textContent = tab === "products" ? "Products" : tab === "inquiries" ? "Inquiries" : "Orders";
  $("[data-new-product]").hidden = tab !== "products";
  if (tab === "inquiries") await loadInquiries();
  if (tab === "orders") await loadOrders();
}

document.addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit-product]");
  const tab = event.target.closest("[data-tab]");
  if (edit) editProduct(edit.dataset.editProduct);
  if (tab) switchTab(tab.dataset.tab);
});
document.addEventListener("change", async event => {
  const select = event.target.closest("[data-inquiry-status]");
  if (select) await api(`/api/admin/inquiries/${select.dataset.inquiryStatus}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: select.value }) });
});
$("[data-login-form]").addEventListener("submit", login);
$("[data-product-form]").addEventListener("submit", saveProduct);
$("[data-admin-search]").addEventListener("input", renderProducts);
$("[data-new-product]").addEventListener("click", resetProductForm);
$("[data-close-editor]").addEventListener("click", resetProductForm);
$("[data-upload]").addEventListener("click", uploadImage);
$("[data-delete-product]").addEventListener("click", deleteProduct);
$("[data-logout]").addEventListener("click", async () => { await api("/api/admin/logout", { method: "POST" }); location.reload(); });
checkSession();
