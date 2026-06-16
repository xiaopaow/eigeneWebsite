import nodemailer from "nodemailer";

export function createMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    } : undefined
  });
}

export async function sendInquiryEmail(mailer, inquiry) {
  if (!mailer) return false;
  const skus = inquiry.items?.length
    ? inquiry.items.map(item => `${item.sku} x${item.quantity}`).join(", ")
    : "No products selected";
  await mailer.sendMail({
    from: process.env.SMTP_FROM,
    to: process.env.INQUIRY_TO_EMAIL,
    replyTo: inquiry.email,
    subject: `PatchReach inquiry from ${inquiry.name}`,
    text: [
      `Name: ${inquiry.name}`,
      `Email: ${inquiry.email}`,
      `Company: ${inquiry.company || "-"}`,
      `Country: ${inquiry.country || "-"}`,
      `Products: ${skus}`,
      `Gear: ${inquiry.gear}`,
      `Notes: ${inquiry.notes || "-"}`
    ].join("\n")
  });
  return true;
}

export async function sendPaymentEmails(mailer, order, items) {
  if (!mailer) return false;
  const lines = items.map(item =>
    `${item.sku} - ${item.name} x${item.quantity}: $${Number(item.line_total).toFixed(2)}`
  );
  const text = [
    `Order: ${order.order_number}`,
    `Customer: ${order.name} <${order.email}>`,
    `Phone: ${order.phone}`,
    `Ship to: ${order.address1}${order.address2 ? `, ${order.address2}` : ""}, ${order.city}, ${order.region || ""} ${order.postal_code}, ${order.country}`,
    "",
    ...lines,
    "",
    `Product total: ${order.currency} ${Number(order.total).toFixed(2)}`,
    "Shipping is not included and will be confirmed separately.",
    `PayPal capture: ${order.paypal_capture_id || "-"}`
  ].join("\n");
  await Promise.all([
    mailer.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.INQUIRY_TO_EMAIL,
      replyTo: order.email,
      subject: `Paid PatchReach order ${order.order_number}`,
      text
    }),
    mailer.sendMail({
      from: process.env.SMTP_FROM,
      to: order.email,
      subject: `PatchReach payment received - ${order.order_number}`,
      text: `Thanks, ${order.name}.\n\n${text}`
    })
  ]);
  return true;
}
