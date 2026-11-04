import crypto from "node:crypto";
import {
  saveSession,
  getSession,
  deleteSession,
} from "./db.js";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bumirangka123";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const PASSWORD_DIGEST = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();

export const sessionTtlSeconds = Math.floor(SESSION_TTL_MS / 1000);
export const usingDefaultPassword = !process.env.ADMIN_PASSWORD;

export function verifyPassword(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const digest = crypto.createHash("sha256").update(candidate).digest();
  return (
    digest.length === PASSWORD_DIGEST.length &&
    crypto.timingSafeEqual(digest, PASSWORD_DIGEST)
  );
}

export function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  saveSession(token, expiresAt);
  return { token, expiresAt };
}

export function resolveSession(token) {
  if (!token) return null;
  return getSession(token);
}

export function destroySession(token) {
  if (token) deleteSession(token);
}

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach(function (part) {
    const index = part.indexOf("=");
    if (index === -1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (error) {
      cookies[key] = value;
    }
  });
  return cookies;
}

export function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.sid || null;
}
