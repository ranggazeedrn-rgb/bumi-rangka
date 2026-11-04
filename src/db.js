import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "app.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    location TEXT NOT NULL DEFAULT '',
    year TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    project_type TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new'
      CHECK (status IN ('new', 'contacted', 'closed', 'archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries (status);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
`);

function mapProject(row) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    location: row.location,
    year: row.year,
    category: row.category,
    imageUrl: row.image_url,
    sortOrder: row.sort_order,
  };
}

function mapInquiry(row) {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    projectType: row.project_type,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function uniqueSlug(title, excludeId) {
  const base = slugify(title) || "proyek";
  let slug = base;
  let counter = 2;
  while (true) {
    const row = excludeId
      ? db.prepare("SELECT id FROM projects WHERE slug = ? AND id <> ?").get(slug, excludeId)
      : db.prepare("SELECT id FROM projects WHERE slug = ?").get(slug);
    if (!row) return slug;
    slug = `${base}-${counter}`;
    counter += 1;
  }
}

export function listProjects() {
  return db
    .prepare("SELECT * FROM projects ORDER BY sort_order ASC, id ASC")
    .all()
    .map(mapProject);
}

export function getProjectById(id) {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? mapProject(row) : null;
}

export function getProjectBySlug(slug) {
  const row = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug);
  return row ? mapProject(row) : null;
}

export function createProject(input) {
  const slug = uniqueSlug(input.title);
  const result = db
    .prepare(
      `INSERT INTO projects (title, slug, location, year, category, image_url, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.title,
      slug,
      input.location,
      input.year,
      input.category,
      input.imageUrl,
      input.sortOrder
    );
  return getProjectById(Number(result.lastInsertRowid));
}

export function updateProject(id, input) {
  const existing = db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
  if (!existing) return null;
  db.prepare(
    `UPDATE projects
     SET title = ?, location = ?, year = ?, category = ?, image_url = ?,
         sort_order = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    input.title,
    input.location,
    input.year,
    input.category,
    input.imageUrl,
    input.sortOrder,
    id
  );
  return getProjectById(id);
}

export function deleteProject(id) {
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}

export function createInquiry(input) {
  const result = db
    .prepare(
      `INSERT INTO inquiries (name, contact, project_type, message)
       VALUES (?, ?, ?, ?)`
    )
    .run(input.name, input.contact, input.projectType, input.message);
  return Number(result.lastInsertRowid);
}

export function listInquiries(status) {
  const rows =
    status && status !== "all"
      ? db
          .prepare("SELECT * FROM inquiries WHERE status = ? ORDER BY id DESC")
          .all(status)
      : db.prepare("SELECT * FROM inquiries ORDER BY id DESC").all();
  return rows.map(mapInquiry);
}

export function getInquiryById(id) {
  const row = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(id);
  return row ? mapInquiry(row) : null;
}

export function updateInquiryStatus(id, status) {
  const result = db
    .prepare(
      "UPDATE inquiries SET status = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .run(status, id);
  return result.changes > 0 ? getInquiryById(id) : null;
}

export function deleteInquiry(id) {
  const result = db.prepare("DELETE FROM inquiries WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getStats(projectCount) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 'new'), 0) AS new,
              COALESCE(SUM(status = 'contacted'), 0) AS contacted,
              COALESCE(SUM(status = 'closed'), 0) AS closed
       FROM inquiries`
    )
    .get();
  return {
    total: Number(row.total),
    new: Number(row.new),
    contacted: Number(row.contacted),
    closed: Number(row.closed),
    projects: projectCount,
  };
}

export function saveSession(token, expiresAt) {
  db.prepare("INSERT OR REPLACE INTO sessions (token, expires_at) VALUES (?, ?)").run(
    token,
    expiresAt
  );
}

export function getSession(token) {
  return (
    db
      .prepare(
        "SELECT token, expires_at AS expiresAt FROM sessions WHERE token = ? AND datetime(expires_at) > datetime('now')"
      )
      .get(token) || null
  );
}

export function deleteSession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function purgeSessions() {
  db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')").run();
}

export function closeDb() {
  db.close();
}

function seedProjects() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM projects").get();
  if (Number(row.count) > 0) return;

  const seeds = [
    {
      title: "Rumah Teduh Kaliurang",
      location: "Sleman",
      year: "2024",
      category: "Bangun baru",
      imageUrl:
        "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80",
      sortOrder: 1,
    },
    {
      title: "Rumah Panjang Bantul",
      location: "Bantul",
      year: "2023",
      category: "Renovasi",
      imageUrl:
        "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
      sortOrder: 2,
    },
    {
      title: "Dapur Ibu Sari",
      location: "Yogyakarta",
      year: "2023",
      category: "Desain & build",
      imageUrl:
        "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80",
      sortOrder: 3,
    },
    {
      title: "Rumah Jengki Kotabaru",
      location: "Yogyakarta",
      year: "2022",
      category: "Renovasi",
      imageUrl:
        "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80",
      sortOrder: 4,
    },
  ];

  const insert = db.prepare(
    `INSERT INTO projects (title, slug, location, year, category, image_url, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  seeds.forEach(function (seed) {
    insert.run(
      seed.title,
      slugify(seed.title),
      seed.location,
      seed.year,
      seed.category,
      seed.imageUrl,
      seed.sortOrder
    );
  });
}

seedProjects();
