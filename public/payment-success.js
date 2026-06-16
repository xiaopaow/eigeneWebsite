const params = new URLSearchParams(location.search);
const order = params.get("order");
const token = params.get("token");

async function initialize() {
  const title = document.querySelector("[data-success-title]");
  const message = document.querySelector("[data-success-message]");
  const details = document.querySelector("[data-success-order]");
  if (!order || !token) {
    title.textContent = "Order reference missing";
    message.textContent = "Return to the catalog or contact PatchReach with your PayPal receipt.";
    return;
  }
  try {
    const response = await fetch(`/api/checkout/orders/${encodeURIComponent(order)}?token=${encodeURIComponent(token)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    const paid = body.order.status === "paid";
    title.textContent = paid ? "Payment received." : "Payment is being confirmed.";
    message.textContent = paid
      ? "We have saved your order. Shipping is not included; we will contact you to confirm fit and delivery cost."
      : "PayPal is still reporting this payment. We will update the order automatically.";
    details.textContent = `${body.order.order_number} · ${body.order.currency} ${Number(body.order.total).toFixed(2)} · ${body.order.status}`;
  } catch {
    title.textContent = "We could not display the order.";
    message.textContent = "Your PayPal receipt remains valid. Contact PatchReach and include the order reference shown in PayPal.";
  }
}
initialize();
