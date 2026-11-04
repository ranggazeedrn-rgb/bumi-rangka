import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as store from "./src/db.js";
import {
  verifyPassword,
  createSession,
  resolveSession,
  destroySession,
  getSessionToken,
  sessionTtlSeconds,
  usingDefaultPassword,
} from "./src/auth.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const cookieSecure = process.env.COOKIE_SECURE === "1";

const contactTypes = new Set([
  "Renovasi & perluasan",
  "Bangun rumah baru",
  "Desain & build",
  "Perawatan / lain-lain",
]);

const inquiryStatuses = new Set(["new", "contacted", "closed", "archived"]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const rateBuckets = new Map();

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      "img-src 'self' https: data:",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "script-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  };
}

function sendJSON(res, status, data, extraHeaders) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...(extraHeaders || {}),
  });
  res.end(payload);
}

function sendText(res, status, message) {
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(message);
}

function readJSON(req, limit) {
  const maxBytes = limit || 32 * 1024;
  return new Promise(function (resolve, reject) {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", function () {
      if (tooLarge) {
        const error = new Error("Data yang dikirim terlalu besar.");
        error.status = 413;
        reject(error);
        return;
      }
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("invalid");
        }
        resolve(parsed);
      } catch (error) {
        const err = new Error("Body permintaan harus berupa JSON yang valid.");
        err.status = 400;
        reject(err);
      }
    });

    req.on("error", reject);
  });
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function clientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;

  if (rateBuckets.size > 2000) {
    for (const [entryKey, entry] of rateBuckets) {
      if (entry.resetAt <= now) rateBuckets.delete(entryKey);
    }
  }

  return bucket.count <= limit;
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (error) {
    return false;
  }
}

function currentSession(req) {
  const token = getSessionToken(req);
  const session = resolveSession(token);
  if (!session) return null;
  return { token, expiresAt: session.expiresAt };
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function validateProjectInput(body) {
  const title = cleanText(body.title, 120);
  const location = cleanText(body.location, 80);
  const year = cleanText(body.year, 20);
  const category = cleanText(body.category, 60);
  const imageUrl = cleanText(body.imageUrl, 500);

  if (title.length < 2) {
    return { error: "Judul proyek minimal 2 karakter." };
  }

  if (imageUrl) {
    const isRelative = imageUrl.startsWith("/") && !imageUrl.startsWith("//");
    let isRemote = false;
    if (!isRelative) {
      try {
        const parsed = new URL(imageUrl);
        isRemote = parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch (error) {
        isRemote = false;
      }
    }
    if (!isRelative && !isRemote) {
      return { error: "URL gambar harus diawali http://, https://, atau /." };
    }
  }

  let sortOrder = Number(body.sortOrder);
  if (!Number.isFinite(sortOrder)) sortOrder = 0;
  sortOrder = Math.round(Math.max(0, Math.min(9999, sortOrder)));

  return {
    data: { title, location, year, category, imageUrl, sortOrder },
  };
}

async function handleContact(req, res) {
  if (!rateLimit("contact:" + clientIp(req), 6, 10 * 60 * 1000)) {
    sendJSON(
      res,
      429,
      { error: "Terlalu banyak pesan dari perangkat ini. Coba lagi beberapa saat lagi." },
      { "Retry-After": "600" }
    );
    return;
  }

  const body = await readJSON(req);
  const honeypot = cleanText(body.website, 200);
  if (honeypot) {
    sendJSON(res, 201, { ok: true, id: null });
    return;
  }

  const name = cleanText(body.name, 80);
  const contact = cleanText(body.contact, 120);
  const projectType = cleanText(body.projectType, 60);
  const message = cleanText(body.message, 2000);

  if (name.length < 2) {
    sendJSON(res, 400, { error: "Nama minimal 2 karakter." });
    return;
  }

  if (contact.length < 5) {
    sendJSON(res, 400, { error: "Nomor atau email yang bisa dihubungi wajib diisi." });
    return;
  }

  if (!contactTypes.has(projectType)) {
    sendJSON(res, 400, { error: "Jenis proyek tidak valid." });
    return;
  }

  const id = store.createInquiry({ name, contact, projectType, message });
  sendJSON(res, 201, { ok: true, id });
}

async function handleLogin(req, res) {
  if (!rateLimit("login:" + clientIp(req), 8, 15 * 60 * 1000)) {
    sendJSON(
      res,
      429,
      { error: "Terlalu banyak percobaan masuk. Coba lagi dalam beberapa menit." },
      { "Retry-After": "900" }
    );
    return;
  }

  const body = await readJSON(req);
  const password = typeof body.password === "string" ? body.password : "";

  if (!verifyPassword(password)) {
    await delay(300);
    sendJSON(res, 401, { error: "Kata sandi salah." });
    return;
  }

  const session = createSession();
  store.purgeSessions();

  const cookie = [
    "sid=" + session.token,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" + sessionTtlSeconds,
    cookieSecure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");

  sendJSON(
    res,
    200,
    { ok: true, expiresAt: session.expiresAt },
    { "Set-Cookie": cookie }
  );
}

function handleLogout(req, res) {
  const token = getSessionToken(req);
  if (token) destroySession(token);

  const cookie = [
    "sid=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    cookieSecure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");

  sendJSON(res, 200, { ok: true }, { "Set-Cookie": cookie });
}

async function handleInquiryUpdate(req, res, id) {
  const body = await readJSON(req);
  const status = cleanText(body.status, 20);
  if (!inquiryStatuses.has(status)) {
    sendJSON(res, 400, { error: "Status pesan tidak valid." });
    return;
  }

  const inquiry = store.updateInquiryStatus(id, status);
  if (!inquiry) {
    sendJSON(res, 404, { error: "Pesan tidak ditemukan." });
    return;
  }

  const stats = store.getStats(store.listProjects().length);
  sendJSON(res, 200, { inquiry, stats });
}

function handleInquiryDelete(res, id) {
  const deleted = store.deleteInquiry(id);
  if (!deleted) {
    sendJSON(res, 404, { error: "Pesan tidak ditemukan." });
    return;
  }
  const stats = store.getStats(store.listProjects().length);
  sendJSON(res, 200, { ok: true, stats });
}

async function handleProjectCreate(req, res) {
  const body = await readJSON(req);
  const check = validateProjectInput(body);
  if (check.error) {
    sendJSON(res, 400, { error: check.error });
    return;
  }
  const project = store.createProject(check.data);
  sendJSON(res, 201, { project });
}

async function handleProjectUpdate(req, res, id) {
  const body = await readJSON(req);
  const check = validateProjectInput(body);
  if (check.error) {
    sendJSON(res, 400, { error: check.error });
    return;
  }
  const project = store.updateProject(id, check.data);
  if (!project) {
    sendJSON(res, 404, { error: "Proyek tidak ditemukan." });
    return;
  }
  sendJSON(res, 200, { project });
}

function handleProjectDelete(res, id) {
  const deleted = store.deleteProject(id);
  if (!deleted) {
    sendJSON(res, 404, { error: "Proyek tidak ditemukan." });
    return;
  }
  sendJSON(res, 200, { ok: true });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !isSameOrigin(req)) {
    sendJSON(res, 403, { error: "Permintaan lintas situs tidak diizinkan." });
    return;
  }

  if (pathname === "/api/health" && method === "GET") {
    sendJSON(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/projects" && method === "GET") {
    sendJSON(res, 200, { projects: store.listProjects() });
    return;
  }

  const projectSlugMatch = pathname.match(/^\/api\/projects\/([a-z0-9-]+)$/);
  if (projectSlugMatch && method === "GET") {
    const project = store.getProjectBySlug(projectSlugMatch[1]);
    if (!project) {
      sendJSON(res, 404, { error: "Proyek tidak ditemukan." });
      return;
    }
    sendJSON(res, 200, { project });
    return;
  }

  if (pathname === "/api/contact" && method === "POST") {
    await handleContact(req, res);
    return;
  }

  if (pathname === "/api/admin/login" && method === "POST") {
    await handleLogin(req, res);
    return;
  }

  if (pathname === "/api/admin/logout" && method === "POST") {
    handleLogout(req, res);
    return;
  }

  if (pathname.startsWith("/api/admin")) {
    const session = currentSession(req);
    if (!session) {
      sendJSON(res, 401, { error: "Sesi tidak valid. Silakan masuk kembali." });
      return;
    }

    if (pathname === "/api/admin/me" && method === "GET") {
      sendJSON(res, 200, {
        authenticated: true,
        expiresAt: session.expiresAt,
        usingDefaultPassword,
      });
      return;
    }

    if (pathname === "/api/admin/inquiries" && method === "GET") {
      const status = url.searchParams.get("status") || "all";
      if (status !== "all" && !inquiryStatuses.has(status)) {
        sendJSON(res, 400, { error: "Filter status tidak valid." });
        return;
      }
      sendJSON(res, 200, {
        inquiries: store.listInquiries(status),
        stats: store.getStats(store.listProjects().length),
      });
      return;
    }

    const inquiryMatch = pathname.match(/^\/api\/admin\/inquiries\/(\d+)$/);
    if (inquiryMatch) {
      const id = Number(inquiryMatch[1]);
      if (method === "PATCH") {
        await handleInquiryUpdate(req, res, id);
        return;
      }
      if (method === "DELETE") {
        handleInquiryDelete(res, id);
        return;
      }
    }

    if (pathname === "/api/admin/projects" && method === "GET") {
      sendJSON(res, 200, {
        projects: store.listProjects(),
        stats: store.getStats(store.listProjects().length),
      });
      return;
    }

    if (pathname === "/api/admin/projects" && method === "POST") {
      await handleProjectCreate(req, res);
      return;
    }

    const adminProjectMatch = pathname.match(/^\/api\/admin\/projects\/(\d+)$/);
    if (adminProjectMatch) {
      const id = Number(adminProjectMatch[1]);
      if (method === "PUT") {
        await handleProjectUpdate(req, res, id);
        return;
      }
      if (method === "DELETE") {
        handleProjectDelete(res, id);
        return;
      }
    }
  }

  sendJSON(res, 404, { error: "Endpoint tidak ditemukan." });
}

async function serveStatic(req, res, url) {
  if (!["GET", "HEAD"].includes(req.method)) {
    sendText(res, 405, "Metode tidak diizinkan.");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    sendText(res, 400, "Permintaan tidak valid.");
    return;
  }

  if (pathname.includes("\0")) {
    sendText(res, 400, "Permintaan tidak valid.");
    return;
  }

  if (pathname === "/" || pathname === "/index.html") pathname = "/index.html";
  if (pathname === "/admin" || pathname === "/admin/") pathname = "/admin.html";

  const filePath = path.normalize(path.join(publicDir, pathname));
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
    sendText(res, 404, "Halaman tidak ditemukan.");
    return;
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (error) {
    sendText(res, 404, "Halaman tidak ditemukan.");
    return;
  }

  if (!stat.isFile()) {
    sendText(res, 404, "Halaman tidak ditemukan.");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";
  const cacheControl = pathname.startsWith("/assets/")
    ? "public, max-age=300"
    : "no-cache";

  res.writeHead(200, {
    ...securityHeaders(),
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": cacheControl,
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on("error", function () {
    if (!res.headersSent) sendText(res, 500, "Gagal membaca berkas.");
    else res.destroy();
  });
  stream.pipe(res);
}

async function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  } catch (error) {
    sendText(res, 400, "Permintaan tidak valid.");
    return;
  }

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    if (status === 500) console.error("[error]", error);
    if (!res.headersSent) {
      sendJSON(res, status, {
        error:
          status === 500
            ? "Terjadi kesalahan pada server. Silakan coba lagi."
            : error.message,
      });
    } else {
      res.destroy();
    }
  }
}

const server = http.createServer(handleRequest);
server.requestTimeout = 20_000;
server.headersTimeout = 10_000;

server.on("error", function (error) {
  console.error("Server gagal berjalan:", error.message);
  process.exit(1);
});

server.listen(port, host, function () {
  store.purgeSessions();
  console.log("Bumi Rangka berjalan di http://localhost:" + port);
  console.log("Panel admin: http://localhost:" + port + "/admin");
  if (usingDefaultPassword) {
    console.warn(
      "PERINGATAN: ADMIN_PASSWORD belum diatur. Kata sandi sementara: bumirangka123"
    );
  }
});

const sessionCleanup = setInterval(function () {
  try {
    store.purgeSessions();
  } catch (error) {
    console.error("Gagal membersihkan sesi:", error.message);
  }
}, 60 * 60 * 1000);
sessionCleanup.unref();

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Menerima " + signal + ", menutup server…");
  server.close(function () {
    store.closeDb();
    process.exit(0);
  });
  setTimeout(function () {
    store.closeDb();
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", function () {
  shutdown("SIGINT");
});
process.on("SIGTERM", function () {
  shutdown("SIGTERM");
});
