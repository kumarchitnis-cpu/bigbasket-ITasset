import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'server-data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'itam.db'));

export function getDb() {
  return db;
}

export function uploadsDir() {
  return UPLOADS_DIR;
}

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

export function nextVal(name) {
  const row = getDb().prepare('UPDATE sequences SET value = value + 1 WHERE name = ? RETURNING value').get(name);
  if (!row) throw new Error(`Unknown sequence: ${name}`);
  return row.value;
}

export function audit(actorId, action, entityType, entityId, outcome = 'SUCCESS', reason = null, metadata = {}) {
  try {
    getDb()
      .prepare(
        'INSERT INTO app_audit_log (id, actor_id, action, entity_type, entity_id, outcome, reason, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(newId(), actorId, action, entityType, entityId, outcome, reason, JSON.stringify(metadata ?? {}));
  } catch {
    // Audit failures must never break the business request.
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT 'Workspace user',
  password_hash TEXT NOT NULL,
  google_sub TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'it_asset_manager', 'procurement_officer', 'finance_officer', 'approver', 'employee', 'auditor')) DEFAULT 'employee',
  department TEXT NOT NULL DEFAULT 'General',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS it_assets (
  id TEXT PRIMARY KEY,
  asset_tag TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ASSIGNED', 'AVAILABLE', 'UNDER_MAINTENANCE', 'QUARANTINED', 'RETIRED')),
  condition TEXT NOT NULL CHECK (condition IN ('NEW', 'GOOD', 'DAMAGED')) DEFAULT 'GOOD',
  custodian TEXT NOT NULL,
  location TEXT NOT NULL,
  purchase_cost REAL NOT NULL DEFAULT 0 CHECK (purchase_cost >= 0),
  warranty_start TEXT,
  warranty_end TEXT,
  purchase_order TEXT,
  department TEXT NOT NULL,
  last_audited_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS it_asset_events (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES it_assets(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('REGISTERED', 'ASSIGNED', 'RETURNED', 'TRANSFERRED', 'MAINTENANCE_STARTED', 'MAINTENANCE_COMPLETED', 'QUARANTINED', 'RETIRED', 'AUDITED')),
  from_status TEXT,
  to_status TEXT,
  from_custodian TEXT,
  to_custodian TEXT,
  location TEXT,
  notes TEXT,
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS it_invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  vendor TEXT NOT NULL,
  purchase_order TEXT NOT NULL,
  total REAL NOT NULL CHECK (total >= 0),
  currency_code TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'PROCESSED', 'ON_HOLD', 'REJECTED')),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  issue TEXT,
  invoice_date TEXT NOT NULL DEFAULT (date('now')),
  extraction_status TEXT NOT NULL DEFAULT 'VALIDATED',
  extracted_fields TEXT NOT NULL DEFAULT '{}',
  document_id TEXT,
  matched_at TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS it_tickets (
  id TEXT PRIMARY KEY,
  ticket_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED')),
  assignee TEXT NOT NULL,
  requester TEXT NOT NULL,
  due_label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS it_purchase_requests (
  id TEXT PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  requester TEXT NOT NULL,
  department TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'RETURNED', 'ORDERED')),
  needed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS it_goods_receipts (
  id TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  purchase_order TEXT NOT NULL,
  vendor TEXT NOT NULL,
  received_by TEXT NOT NULL REFERENCES users(id),
  received_date TEXT NOT NULL DEFAULT (date('now')),
  ordered_quantity INTEGER NOT NULL CHECK (ordered_quantity >= 0),
  accepted_quantity INTEGER NOT NULL CHECK (accepted_quantity >= 0),
  rejected_quantity INTEGER NOT NULL CHECK (rejected_quantity >= 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'DISCREPANCY')) DEFAULT 'DRAFT',
  discrepancy_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (accepted_quantity + rejected_quantity <= ordered_quantity)
);

CREATE TABLE IF NOT EXISTS it_maintenance_records (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES it_assets(id) ON DELETE RESTRICT,
  issue TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')) DEFAULT 'OPEN',
  priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')) DEFAULT 'MEDIUM',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
  downtime_hours REAL NOT NULL DEFAULT 0 CHECK (downtime_hours >= 0),
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS it_employee_asset_requests (
  id TEXT PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  justification TEXT NOT NULL,
  needed_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING_APPROVAL',
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS it_write_off_requests (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES it_assets(id),
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING_APPROVAL',
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  dedupe_key TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (recipient_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS app_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'REJECTED', 'FAILED')),
  reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_documents (
  id TEXT PRIMARY KEY,
  storage_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  sha256 TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('INVOICE', 'PURCHASE_ORDER', 'RECEIPT', 'WARRANTY', 'OTHER')) DEFAULT 'OTHER',
  extraction_status TEXT NOT NULL CHECK (extraction_status IN ('UPLOADED', 'EXTRACTING', 'NEEDS_REVIEW', 'VALIDATED', 'FAILED')) DEFAULT 'UPLOADED',
  extracted_fields TEXT NOT NULL DEFAULT '{}',
  confidence REAL CHECK (confidence >= 0 AND confidence <= 100),
  review_reason TEXT,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS it_assets_status_idx ON it_assets(status);
CREATE INDEX IF NOT EXISTS it_assets_category_idx ON it_assets(category);
CREATE INDEX IF NOT EXISTS it_invoices_status_idx ON it_invoices(status);
CREATE INDEX IF NOT EXISTS it_tickets_status_priority_idx ON it_tickets(status, priority);
CREATE INDEX IF NOT EXISTS it_purchase_requests_status_idx ON it_purchase_requests(status);
CREATE INDEX IF NOT EXISTS it_asset_events_asset_idx ON it_asset_events(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS it_goods_receipts_po_idx ON it_goods_receipts(purchase_order);
CREATE INDEX IF NOT EXISTS it_maintenance_asset_idx ON it_maintenance_records(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS it_employee_asset_requests_user_idx ON it_employee_asset_requests(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS it_write_off_requests_asset_idx ON it_write_off_requests(asset_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS it_write_off_pending_asset_idx ON it_write_off_requests(asset_id) WHERE status = 'PENDING_APPROVAL';
CREATE INDEX IF NOT EXISTS app_notifications_recipient_idx ON app_notifications(recipient_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS app_audit_log_entity_idx ON app_audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_documents_status_idx ON app_documents(extraction_status, created_at DESC);
`;

export function ensureSchema() {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
  if (!userColumns.has('google_sub')) {
    db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users(google_sub) WHERE google_sub IS NOT NULL');
  }
  const invoiceColumns = new Set(db.prepare('PRAGMA table_info(it_invoices)').all().map((column) => column.name));
  if (!invoiceColumns.has('extracted_fields')) {
    db.exec("ALTER TABLE it_invoices ADD COLUMN extracted_fields TEXT NOT NULL DEFAULT '{}'");
  }
  if (!invoiceColumns.has('document_id')) {
    db.exec('ALTER TABLE it_invoices ADD COLUMN document_id TEXT');
  }
  db.prepare("INSERT OR IGNORE INTO sequences (name, value) VALUES ('ticket', 2048)").run();
  db.prepare("INSERT OR IGNORE INTO sequences (name, value) VALUES ('purchase_request', 41)").run();
  db.prepare("INSERT OR IGNORE INTO sequences (name, value) VALUES ('goods_receipt', 0)").run();
  db.prepare("INSERT OR IGNORE INTO sequences (name, value) VALUES ('employee_asset_request', 0)").run();
}

export function notify(recipientId, eventType, title, body, entityType = null, entityId = null, dedupeKey = `${eventType}:${entityId || newId()}`) {
  getDb()
    .prepare(
      `INSERT INTO app_notifications (id, recipient_id, event_type, title, body, entity_type, entity_id, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (recipient_id, dedupe_key) DO NOTHING`,
    )
    .run(newId(), recipientId, eventType, title, body, entityType, entityId, dedupeKey);
}
