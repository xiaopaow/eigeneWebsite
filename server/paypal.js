import crypto from "node:crypto";

const paypalBaseUrl = () => process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

export function paypalIsConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export function createPayPalService(fetchImpl = fetch) {
  async function accessToken() {
    if (!paypalIsConfigured()) throw new Error("PayPal is not configured.");
    const authorization = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
    const response = await fetchImpl(`${paypalBaseUrl()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error_description || "PayPal authentication failed.");
    return body.access_token;
  }

  async function paypalRequest(path, options = {}) {
    const token = await accessToken();
    const response = await fetchImpl(`${paypalBaseUrl()}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": options.requestId || crypto.randomUUID(),
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.details?.[0]?.description || "PayPal request failed.");
    return body;
  }

  return {
    configured: paypalIsConfigured,
    async createOrder({ amount, currency, orderNumber, returnUrl, cancelUrl }) {
      return paypalRequest("/v2/checkout/orders", {
        method: "POST",
        requestId: `create-${orderNumber}`,
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{
            reference_id: orderNumber,
            custom_id: orderNumber,
            description: `PatchReach order ${orderNumber}`,
            amount: { currency_code: currency, value: amount }
          }],
          payment_source: {
            paypal: {
              experience_context: {
                payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
                brand_name: "PatchReach",
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
                return_url: returnUrl,
                cancel_url: cancelUrl
              }
            }
          }
        })
      });
    },
    async captureOrder(paypalOrderId) {
      return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
        method: "POST",
        requestId: `capture-${paypalOrderId}`
      });
    },
    async verifyWebhook(headers, event) {
      if (!process.env.PAYPAL_WEBHOOK_ID) return false;
      const result = await paypalRequest("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        body: JSON.stringify({
          auth_algo: headers["paypal-auth-algo"],
          cert_url: headers["paypal-cert-url"],
          transmission_id: headers["paypal-transmission-id"],
          transmission_sig: headers["paypal-transmission-sig"],
          transmission_time: headers["paypal-transmission-time"],
          webhook_id: process.env.PAYPAL_WEBHOOK_ID,
          webhook_event: event
        })
      });
      return result.verification_status === "SUCCESS";
    }
  };
}
