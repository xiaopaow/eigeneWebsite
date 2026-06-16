import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const COOKIE_NAME = "patchreach_admin";

export async function verifyAdminCredentials(email, password) {
  const expectedEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const configured = String(process.env.ADMIN_PASSWORD || "");
  if (!expectedEmail || !configured) return false;
  const emailMatches = String(email || "").trim().toLowerCase() === expectedEmail;
  if (!emailMatches) return false;
  if (configured.startsWith("$2")) return bcrypt.compare(password, configured);
  return password === configured;
}

export function issueAdminCookie(res, email) {
  const token = jwt.sign({ sub: email, role: "admin" }, process.env.JWT_SECRET, {
    expiresIn: "12h"
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/"
  });
}

export function clearAdminCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function requireAdmin(req, res, next) {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Authentication required." });
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Your admin session has expired." });
  }
}
