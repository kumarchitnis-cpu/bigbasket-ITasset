import { Router } from 'express';
import { audit, getDb } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

const ENTITY_LABELS = {
  asset: 'Asset',
  invoice: 'Invoice',
  employee_asset_assignment: 'Employee asset',
  write_off_request: 'Write-off request',
  goods_receipt: 'Goods receipt',
  employee_asset_request: 'Employee asset request',
  maintenance_record: 'Maintenance record',
  user: 'User',
  profile: 'Profile',
};

function parseMetadata(row) {
  if (!row.metadata) return {};
  try {
    const parsed = JSON.parse(row.metadata);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function labelFor(entityType, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return entityType;
  const assetTag = snapshot.asset_tag ?? snapshot.receipt_number ?? snapshot.request_number;
  const identity = snapshot.invoice_number ?? snapshot.employee_name ?? snapshot.email ?? snapshot.full_name;
  const serial = snapshot.serial_number;
  const headline = [assetTag, identity].filter(Boolean).join(' · ') || entityType;
  const detail = [snapshot.manufacturer, snapshot.model, serial].filter(Boolean).join(' · ');
  return { headline, detail };
}

function tableColumns(table) {
  return getDb().prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function tableForEntity(entityType) {
  switch (entityType) {
    case 'asset':
      return 'it_assets';
    case 'invoice':
      return 'it_invoices';
    case 'employee_asset_assignment':
      return 'it_employee_asset_assignments';
    case 'write_off_request':
      return 'it_write_off_requests';
    case 'goods_receipt':
      return 'it_goods_receipts';
    default:
      return null;
  }
}

function restoreDependents(db, entityType, metadata) {
  const dependents = metadata.dependents && typeof metadata.dependents === 'object' ? metadata.dependents : null;
  if (!dependents) return;
  const groups = entityType === 'asset' ? { write_off_requests: 'it_write_off_requests' } : {};
  for (const [key, table] of Object.entries(groups)) {
    const rows = Array.isArray(dependents[key]) ? dependents[key] : [];
    const columns = tableColumns(table);
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const fields = Object.keys(row).filter((column) => columns.includes(column) && row[column] !== undefined);
      if (!fields.length) continue;
      const placeholders = fields.map(() => '?').join(', ');
      try {
        db.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`).run(...fields.map((field) => row[field]));
      } catch (error) {
        if (error && error.code !== 'ERR_SQLITE_ERROR') throw error;
      }
    }
  }
}

router.get('/', requireRole('admin', 'auditor'), (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, a.metadata,
              u.full_name AS actor_name
       FROM app_audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.action = 'DELETE' AND a.outcome = 'SUCCESS'
       ORDER BY a.created_at DESC
       LIMIT 200`,
    ).all();

    const restoredIds = new Set(
      db.prepare(
        `SELECT entity_id FROM app_audit_log WHERE action = 'RESTORE' AND outcome = 'SUCCESS' ORDER BY created_at DESC`,
      ).all().map((row) => `${row.entity_id}`),
    );

    const records = rows.map((row) => {
      const metadata = parseMetadata(row);
      const snapshot = metadata.snapshot && typeof metadata.snapshot === 'object' ? metadata.snapshot : null;
      const { headline, detail } = labelFor(row.entity_type, snapshot);
      const table = tableForEntity(row.entity_type);
      const restored = restoredIds.has(`${row.entity_id}`);
      return {
        audit_id: row.id,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        label: headline,
        detail,
        type_label: ENTITY_LABELS[row.entity_type] ?? row.entity_type,
        deleted_by: row.actor_name,
        deleted_at: row.created_at,
        restorable: Boolean(table && snapshot && !restored),
        restored,
      };
    });

    const deletedTotal = db.prepare(
      "SELECT COUNT(*) AS count FROM app_audit_log WHERE action = 'DELETE' AND outcome = 'SUCCESS'",
    ).get().count;
    const restoredTotal = db.prepare(
      "SELECT COUNT(*) AS count FROM app_audit_log WHERE action = 'RESTORE' AND outcome = 'SUCCESS'",
    ).get().count;

    res.json({
      records,
      totals: {
        deleted: deletedTotal,
        restored: restoredTotal,
        pending: Math.max(deletedTotal - restoredTotal, 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/activity', requireRole('admin', 'auditor'), (req, res, next) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 365);
    const db = getDb();
    const rows = db.prepare(
      `SELECT date(created_at) AS date, action, COUNT(*) AS count
       FROM app_audit_log
       WHERE outcome = 'SUCCESS'
         AND action IN ('DELETE', 'RESTORE')
         AND created_at >= datetime('now', ?)
       GROUP BY date(created_at), action`,
    ).all(`-${days} days`);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return res.json(
      Array.from({ length: days }, (_, index) => {
        const date = new Date(today);
        date.setUTCDate(today.getUTCDate() - (days - 1 - index));
        const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
        const day = rows.filter((row) => row.date === key);
        const deleted = day.find((row) => row.action === 'DELETE')?.count ?? 0;
        const restored = day.find((row) => row.action === 'RESTORE')?.count ?? 0;
        return {
          date: key,
          label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
          deleted,
          restored,
        };
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post('/restore', requireRole('admin'), (req, res, next) => {
  try {
    const entityType = String(req.body?.entity_type ?? '');
    const entityId = String(req.body?.entity_id ?? '');
    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'An entity type and record id are required.' });
    }
    const table = tableForEntity(entityType);
    if (!table) {
      return res.status(400).json({ error: 'This record type cannot be restored.' });
    }
    const db = getDb();
    const alreadyRestored = db.prepare(
      "SELECT id FROM app_audit_log WHERE action = 'RESTORE' AND entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(entityType, entityId);
    if (alreadyRestored) {
      return res.status(409).json({ error: 'This record has already been restored.' });
    }
    const entry = db.prepare(
      `SELECT id, metadata FROM app_audit_log
       WHERE action = 'DELETE' AND entity_type = ? AND entity_id = ? AND outcome = 'SUCCESS'
       ORDER BY created_at DESC LIMIT 1`,
    ).get(entityType, entityId);
    if (!entry) return res.status(404).json({ error: 'No deleted record was found for this entry.' });

    const metadata = parseMetadata(entry);
    const snapshot = metadata.snapshot && typeof metadata.snapshot === 'object' ? metadata.snapshot : null;
    if (!snapshot) {
      return res.status(409).json({ error: 'This deletion was recorded without a restorable snapshot.' });
    }

    const columns = tableColumns(table);
    const fields = Object.keys(snapshot).filter((key) => columns.includes(key) && snapshot[key] !== undefined);
    if (!fields.length) {
      return res.status(409).json({ error: 'The stored snapshot no longer matches this record type.' });
    }
    const values = fields.map((field) => snapshot[field]);
    const placeholders = fields.map(() => '?').join(', ');
    try {
      db.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
    } catch (error) {
      if (error.message && error.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'A record with the same unique reference already exists. Rename or remove it before restoring.' });
      }
      if (error.message && error.message.includes('FOREIGN KEY')) {
        return res.status(409).json({ error: 'A related record is missing, so this record cannot be restored yet.' });
      }
      throw error;
    }
    audit(req.user.id, 'RESTORE', entityType, entityId, 'SUCCESS', null, { restored_from_audit: entry.id });
    restoreDependents(db, entityType, metadata);
    res.status(201).json({ ok: true, entity_type: entityType, entity_id: entityId });
  } catch (error) {
    next(error);
  }
});

router.delete('/:auditId', requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const entry = db.prepare('SELECT id, entity_type, entity_id FROM app_audit_log WHERE id = ? AND action = ?').get(req.params.auditId, 'DELETE');
    if (!entry) return res.status(404).json({ error: 'Deleted record entry not found.' });
    db.prepare('DELETE FROM app_audit_log WHERE id = ?').run(entry.id);
    audit(req.user.id, 'PERMANENT_DELETE', entry.entity_type, entry.entity_id, 'SUCCESS');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export const deletedRouter = router;
