const state = {
  products: [], inquiries: [], orders: [], active: "products",
  inquiryQuery: "", inquiryStatus: "all", inquiryPage: 1,
  inquiryPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  inquirySummary: { newCount: 0, contactedCount: 0, closedCount: 0, emailedCount: 0 },
  inquiryLoading: false,
  orderQuery: "", orderStatus: "all", orderPage: 1,
  orderPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  orderSummary: { paidTotal: 0, paidCount: 0, pendingCount: 0, latestPaid: null },
  orderLoading: false
};
let inquirySearchTimer;
let orderSearchTimer;
const tabContent = {
  products: {
    eyebrow: "Catalog operations",
    title: "Products",
    description: "Manage products and direct checkout settings."
  },
  inquiries: {
    eyebrow: "Sales inbox",
    title: "Fit inquiries",
    description: "Review customer gear lists and quote requests."
  },
  orders: {
    eyebrow: "Payment operations",
    title: "Orders",
    description: "Track PayPal payments and delivery details."
  }
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const money = value => value == null ? "Quote" : `$${Number(value).toLocaleString()}`;
const currencyMoney = (currency, value) => `${esc(currency || "USD")} ${Number(value || 0).toFixed(2)}`;
const orderDate = value => value ? new Date(value).toLocaleString() : "-";

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
    const session = await api("/api/admin/session");
    if (!session.authenticated) throw new Error("Not signed in");
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
  $("[data-admin-products]").innerHTML = products.length ? products.map(product => `<article class="admin-row" data-edit-product="${product.id}"><img src="${esc(product.image_url || "/assets/product-steel.svg")}" alt=""><div><h3>${esc(product.name)}</h3><p>${esc(product.sku)} - ${esc(product.collection)}</p></div><span class="pill ${esc(product.status)}">${esc(product.status)}</span><b>${money(product.price_from)}</b></article>`).join("") : '<div class="empty">No products found.</div>';
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
  const container = $("[data-inquiries]");
  state.inquiryLoading = true;
  if (state.inquiries.length) renderInquiries();
  else container.innerHTML = '<div class="empty">Loading fit inquiries...</div>';
  try {
    const params = new URLSearchParams({
      page: state.inquiryPage,
      pageSize: 20,
      status: state.inquiryStatus,
      q: state.inquiryQuery.trim()
    });
    const result = await api(`/api/admin/inquiries?${params}`);
    state.inquiries = result.inquiries;
    state.inquiryPagination = result.pagination;
    state.inquirySummary = result.summary;
    state.inquiryPage = result.pagination.page;
    state.inquiryLoading = false;
    renderInquiries();
  } catch (error) {
    state.inquiryLoading = false;
    container.innerHTML = `<div class="empty error-state">${esc(error.message)}</div>`;
  }
}

function renderInquiries() {
  const query = state.inquiryQuery.trim().toLowerCase();
  const status = state.inquiryStatus;
  const inquiries = state.inquiries;
  const summary = state.inquirySummary;
  $("[data-inquiries]").innerHTML = `
    <section class="inquiry-dashboard">
      <div class="inquiry-metrics">
        <article><span>New</span><b>${summary.newCount}</b></article>
        <article><span>Contacted</span><b>${summary.contactedCount}</b></article>
        <article><span>Closed</span><b>${summary.closedCount}</b></article>
        <article><span>Email sent</span><b>${summary.emailedCount}</b></article>
      </div>
      <div class="inquiry-controls">
        <input type="search" data-inquiry-search placeholder="Search customer, email, country, SKU, gear" value="${esc(query)}">
        <select data-inquiry-filter>
          ${["all", "new", "contacted", "closed", "spam"].map(value => `<option value="${value}" ${status === value ? "selected" : ""}>${value === "all" ? "All statuses" : value[0].toUpperCase() + value.slice(1)}</option>`).join("")}
        </select>
      </div>
      <div class="inquiry-card-list">
        ${state.inquiryLoading ? '<div class="empty list-loading">Loading fit inquiries...</div>' : inquiries.length ? inquiries.map(renderInquiryCard).join("") : '<div class="empty">Customer fit requests will appear here after submission.</div>'}
      </div>
      ${renderPagination("inquiries", state.inquiryPagination)}
    </section>`;
}

function renderInquiryCard(inquiry) {
  const quoteItems = inquiry.quote_items || [];
  const quantity = quoteItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const productLabel = (inquiry.product_skus || []).join(", ") || "Recommendation request";
  return `<article class="inquiry-card" data-inquiry-card>
    <button type="button" class="inquiry-card-main" data-toggle-inquiry aria-expanded="false">
      <div class="inquiry-identity">
        <span class="pill ${esc(inquiry.status)}">${esc(inquiry.status)}</span>
        <b>Request #${Number(inquiry.id)}</b>
        <small>${orderDate(inquiry.created_at)}</small>
      </div>
      <div class="inquiry-customer">
        <b>${esc(inquiry.name)}</b>
        <span>${esc(inquiry.email)}</span>
        <span>${esc(inquiry.country || "Country not provided")}</span>
      </div>
      <div class="inquiry-products">
        <b>${esc(productLabel)}</b>
        <span>${quantity || (inquiry.product_skus || []).length} requested unit${quantity === 1 ? "" : "s"}</span>
      </div>
      <div class="inquiry-value">
        <b>${inquiry.estimated_total == null ? "Recommendation" : currencyMoney("USD", inquiry.estimated_total)}</b>
        <span>${inquiry.email_sent ? "Email delivered" : "Saved to inbox"}</span>
      </div>
      <span class="order-chevron" aria-hidden="true">+</span>
    </button>
    <div class="inquiry-detail" hidden>
      <div class="inquiry-detail-grid">
        <section>
          <h3>Requested products</h3>
          <div class="inquiry-items">${quoteItems.length ? quoteItems.map(renderInquiryItem).join("") : `<p class="muted">${esc(productLabel)}</p>`}</div>
        </section>
        <section>
          <h3>Customer brief</h3>
          <dl><dt>Company</dt><dd>${esc(inquiry.company || "-")}</dd><dt>Country</dt><dd>${esc(inquiry.country || "-")}</dd><dt>Email status</dt><dd>${inquiry.email_sent ? "Sent" : "Not sent"}</dd></dl>
          <h4>Gear list</h4><p class="inquiry-copy">${esc(inquiry.gear || "-")}</p>
          <h4>Notes</h4><p class="inquiry-copy">${esc(inquiry.notes || "-")}</p>
        </section>
        <section class="inquiry-actions-panel">
          <h3>Follow-up</h3>
          <a class="contact-link" href="mailto:${esc(inquiry.email)}">Email customer</a>
          <label>Status<select data-inquiry-status="${Number(inquiry.id)}">${renderInquiryStatusOptions(inquiry.status)}</select></label>
        </section>
      </div>
    </div>
  </article>`;
}

function renderInquiryItem(item) {
  return `<div class="inquiry-item"><div><b>${esc(item.sku)}</b><span>x${Number(item.quantity || 1)}</span></div><span>${currencyMoney("USD", item.unit_price)} each</span></div>`;
}

function renderInquiryStatusOptions(status) {
  return ["new", "contacted", "closed", "spam"].map(value => `<option value="${value}" ${status === value ? "selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("");
}

function paginationPages(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages].filter(value => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  const result = [];
  sorted.forEach((value, index) => {
    if (index && value - sorted[index - 1] > 1) result.push("ellipsis");
    result.push(value);
  });
  return result;
}

function renderPagination(target, pagination) {
  const { page, total, totalPages } = pagination;
  const controls = totalPages > 1 ? `<div class="pagination-buttons">
    <button type="button" data-pagination-target="${target}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Previous</button>
    ${paginationPages(page, totalPages).map(value => value === "ellipsis"
      ? '<span class="pagination-ellipsis">...</span>'
      : `<button type="button" data-pagination-target="${target}" data-page="${value}" class="${value === page ? "active" : ""}" ${value === page ? 'aria-current="page"' : ""}>${value}</button>`).join("")}
    <button type="button" data-pagination-target="${target}" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Next</button>
  </div>` : "";
  return `<nav class="pagination" aria-label="${target} pagination"><span>Page ${page} of ${totalPages} · ${total} results</span>${controls}</nav>`;
}

async function loadOrders() {
  const container = $("[data-orders]");
  state.orderLoading = true;
  if (state.orders.length) renderOrders();
  else container.innerHTML = '<div class="empty">Loading checkout orders...</div>';
  try {
    const params = new URLSearchParams({
      page: state.orderPage,
      pageSize: 20,
      status: state.orderStatus,
      q: state.orderQuery.trim()
    });
    const result = await api(`/api/admin/orders?${params}`);
    state.orders = result.orders;
    state.orderPagination = result.pagination;
    state.orderSummary = result.summary;
    state.orderPage = result.pagination.page;
    state.orderLoading = false;
    renderOrders();
  } catch (error) {
    state.orderLoading = false;
    container.innerHTML = `<div class="empty error-state">${esc(error.message)}</div>`;
  }
}

function renderOrders() {
  const query = state.orderQuery.trim().toLowerCase();
  const status = state.orderStatus;
  const orders = state.orders;
  const summary = state.orderSummary;
  $("[data-orders]").innerHTML = `
    <section class="order-dashboard">
      <div class="order-metrics">
        <article><span>Paid revenue</span><b>${currencyMoney("USD", summary.paidTotal)}</b></article>
        <article><span>Pending orders</span><b>${summary.pendingCount}</b></article>
        <article><span>Paid orders</span><b>${summary.paidCount}</b></article>
        <article><span>Latest paid</span><b>${summary.latestPaid ? orderDate(summary.latestPaid) : "-"}</b></article>
      </div>
      <div class="order-controls">
        <input type="search" data-order-search placeholder="Search order, customer, PayPal ID, SKU" value="${esc(query)}">
        <select data-order-status>
          ${["all", "paid", "pending", "failed", "refunded", "disputed"].map(value => `<option value="${value}" ${status === value ? "selected" : ""}>${value === "all" ? "All statuses" : value[0].toUpperCase() + value.slice(1)}</option>`).join("")}
        </select>
      </div>
      <div class="order-card-list">
        ${state.orderLoading ? '<div class="empty list-loading">Loading checkout orders...</div>' : orders.length ? orders.map(renderOrderCard).join("") : '<div class="empty">Checkout orders will appear here after PayPal creates them.</div>'}
      </div>
      ${renderPagination("orders", state.orderPagination)}
    </section>`;
}

function renderOrderCard(order) {
  const items = order.items || [];
  const unitCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const address = [order.address1, order.address2, order.city, order.region, order.postal_code].filter(Boolean).join(", ");
  return `<article class="order-card" data-order-card>
    <button class="order-card-main" type="button" data-toggle-order aria-expanded="false">
      <div class="order-identity">
        <span class="pill ${esc(order.status)}">${esc(order.status)}</span>
        <b>${esc(order.order_number)}</b>
        <small>Created ${orderDate(order.created_at)}</small>
      </div>
      <div class="order-customer">
        <b>${esc(order.name)}</b>
        <span>${esc(order.country || "-")} - ${esc(order.phone || "-")}</span>
        <a href="mailto:${esc(order.email)}" data-mail-link>${esc(order.email)}</a>
      </div>
      <div class="order-units">
        <b>${unitCount} unit${unitCount === 1 ? "" : "s"}</b>
        <span>${items.map(item => `${esc(item.sku)} x${Number(item.quantity)}`).join(", ") || "No items"}</span>
      </div>
      <div class="order-payment">
        <b>${currencyMoney(order.currency, order.total)}</b>
        <span>Order ${esc(order.paypal_order_id || "-")}</span>
        <span>Capture ${esc(order.paypal_capture_id || "-")}</span>
      </div>
      <span class="order-chevron" aria-hidden="true">+</span>
    </button>
    <div class="order-detail" hidden>
      <div class="order-detail-grid">
        <section>
          <h3>Product snapshot</h3>
          <div class="order-items">${items.map(renderOrderItem).join("") || '<p class="muted">No products saved.</p>'}</div>
        </section>
        <section>
          <h3>Delivery</h3>
          <p><b>${esc(order.name)}</b><br>${esc(address || "-")}<br>${esc(order.country || "-")}</p>
          <a class="contact-link" href="mailto:${esc(order.email)}">Email customer</a>
        </section>
        <section>
          <h3>PayPal verification</h3>
          <dl>
            <dt>Status</dt><dd>${esc(order.status)}</dd>
            <dt>Paid at</dt><dd>${orderDate(order.paid_at)}</dd>
            <dt>Payer</dt><dd>${esc(order.payer_email || "-")}</dd>
            <dt>Order ID</dt><dd>${esc(order.paypal_order_id || "-")}</dd>
            <dt>Capture ID</dt><dd>${esc(order.paypal_capture_id || "-")}</dd>
            <dt>Email sent</dt><dd>${order.payment_email_sent ? "Yes" : "No"}</dd>
          </dl>
        </section>
      </div>
    </div>
  </article>`;
}

function renderOrderItem(item) {
  return `<div class="order-item">
    <img src="${esc(item.image_url || "/assets/product-steel.svg")}" alt="">
    <div><b>${esc(item.name)}</b><span>${esc(item.sku)} - x${Number(item.quantity)}</span></div>
    <span>${currencyMoney("USD", item.unit_price)} each</span>
    <b>${currencyMoney("USD", item.line_total)}</b>
  </div>`;
}

async function switchTab(tab) {
  state.active = tab;
  const content = tabContent[tab];
  $$("[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
  $("[data-products-panel]").hidden = tab !== "products";
  $("[data-inquiries-panel]").hidden = tab !== "inquiries";
  $("[data-orders-panel]").hidden = tab !== "orders";
  $(".page-head .eyebrow").textContent = content.eyebrow;
  $(".page-head h1").textContent = content.title;
  $(".page-head h1 + p").textContent = content.description;
  $("[data-new-product]").hidden = tab !== "products";
  if (tab === "inquiries") await loadInquiries();
  if (tab === "orders") await loadOrders();
}

document.addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit-product]");
  const tab = event.target.closest("[data-tab]");
  const toggleInquiry = event.target.closest("[data-toggle-inquiry]");
  const toggleOrder = event.target.closest("[data-toggle-order]");
  const paginationButton = event.target.closest("[data-pagination-target][data-page]");
  if (event.target.closest("[data-mail-link]")) return;
  if (edit) editProduct(edit.dataset.editProduct);
  if (tab) switchTab(tab.dataset.tab);
  if (paginationButton && !paginationButton.disabled) {
    const page = Number(paginationButton.dataset.page);
    if (paginationButton.dataset.paginationTarget === "inquiries") {
      state.inquiryPage = page;
      await loadInquiries();
    } else {
      state.orderPage = page;
      await loadOrders();
    }
  }
  if (toggleInquiry) {
    const card = toggleInquiry.closest("[data-inquiry-card]");
    const detail = card.querySelector(".inquiry-detail");
    const expanded = toggleInquiry.getAttribute("aria-expanded") === "true";
    toggleInquiry.setAttribute("aria-expanded", String(!expanded));
    detail.hidden = expanded;
  }
  if (toggleOrder) {
    const card = toggleOrder.closest("[data-order-card]");
    const detail = card.querySelector(".order-detail");
    const expanded = toggleOrder.getAttribute("aria-expanded") === "true";
    toggleOrder.setAttribute("aria-expanded", String(!expanded));
    detail.hidden = expanded;
  }
});
document.addEventListener("change", async event => {
  const select = event.target.closest("[data-inquiry-status]");
  if (select) {
    await api(`/api/admin/inquiries/${select.dataset.inquiryStatus}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: select.value }) });
    await loadInquiries();
  }
  const inquiryFilter = event.target.closest("[data-inquiry-filter]");
  if (inquiryFilter) {
    state.inquiryStatus = inquiryFilter.value;
    state.inquiryPage = 1;
    await loadInquiries();
  }
  const orderStatus = event.target.closest("[data-order-status]");
  if (orderStatus) {
    state.orderStatus = orderStatus.value;
    state.orderPage = 1;
    await loadOrders();
  }
});
document.addEventListener("input", event => {
  const inquirySearch = event.target.closest("[data-inquiry-search]");
  if (inquirySearch) {
    state.inquiryQuery = inquirySearch.value;
    clearTimeout(inquirySearchTimer);
    inquirySearchTimer = setTimeout(() => {
      state.inquiryPage = 1;
      loadInquiries();
    }, 300);
  }
  const orderSearch = event.target.closest("[data-order-search]");
  if (orderSearch) {
    state.orderQuery = orderSearch.value;
    clearTimeout(orderSearchTimer);
    orderSearchTimer = setTimeout(() => {
      state.orderPage = 1;
      loadOrders();
    }, 300);
  }
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
