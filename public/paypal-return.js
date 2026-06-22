const params = new URLSearchParams(location.search);
const paypalOrderId = params.get("token");

async function confirmPayment() {
  const title = document.querySelector("[data-return-title]");
  const message = document.querySelector("[data-return-message]");
  const status = document.querySelector("[data-return-status]");
  const link = document.querySelector("[data-return-link]");
  if (!paypalOrderId) {
    title.textContent = "PayPal order missing.";
    message.textContent = "Return to checkout and start the payment again.";
    status.textContent = "No PayPal token was provided.";
    link.hidden = false;
    return;
  }
  try {
    const response = await fetch(`/api/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "PayPal capture failed.");
    localStorage.removeItem("patchreach_quote");
    location.replace(`/payment-success?order=${encodeURIComponent(body.orderNumber)}&token=${encodeURIComponent(body.publicToken)}`);
  } catch (error) {
    title.textContent = "Payment needs attention.";
    message.textContent = "Your PayPal receipt remains valid. You can retry confirmation or contact PatchReach.";
    status.textContent = error.message;
    link.hidden = false;
  }
}

confirmPayment();
