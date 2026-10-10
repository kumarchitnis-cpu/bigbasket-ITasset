import { Router } from 'express';
import { audit, getDb, newId, nextVal } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

// --- Profiles -------------------------------------------------------------

router.get('/profiles', requireRole('admin'), (req, res, next) => {
  try {
    const rows = getDb()
      .prepare('SELECT id, email, full_name, role, department, active, created_at FROM users ORDER BY created_at DESC')
      .all();
    res.json(rows.map((row) => ({ ...row, active: !!row.active })));
  } catch (e) {
    next(e);
  }
});

router.get('/profiles/:id', (req, res, next) => {
  try {
    if (req.params.id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: you can only read your own profile.' });
    }
    const row = getDb()
      .prepare('SELECT id, email, full_name, role, department, active, created_at FROM users WHERE id = ?')
      .get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ ...row, active: !!row.active });
  } catch (e) {
    next(e);
  }
});

router.put('/profiles/:id', (req, res, next) => {
  try {
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: you can only update your own profile.' });
    }
    const body = req.body ?? {};
    const updates = {};
    if ('full_name' in body && String(body.full_name || '').trim()) updates.full_name = String(body.full_name).trim();
    if ('department' in body && String(body.department || '').trim()) updates.department = String(body.department).trim();
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      getDb().prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...keys.map((k) => updates[k]), req.user.id);
    }
    audit(req.user.id, 'UPDATE', 'profile', req.user.id, 'SUCCESS');
    res.json(
      getDb().prepare('SELECT id, email, full_name, role, department, active FROM users WHERE id = ?').get(req.user.id),
    );
  } catch (e) {
    next(e);
  }
});

router.delete('/profiles/:id', requireRole('admin'), (req, res, next) => {
  try {
    const existing = getDb().prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Profile not found.' });
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    getDb().prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    audit(req.user.id, 'DELETE', 'profile', req.params.id, 'SUCCESS');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// --- Audit log ------------------------------------------------------------

router.get('/audit', requireRole('admin', 'auditor'), (req, res, next) => {
  try {
    const rows = getDb()
      .prepare(
        `SELECT a.*, u.full_name AS actor_name FROM app_audit_log a
         LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 500`,
      )
      .all();
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// --- Maintenance records ---------------------------------------------------

const MAINTENANCE_WRITABLE = ['asset_id', 'issue', 'provider', 'status', 'priority', 'cost', 'downtime_hours', 'notes', 'completed_at'];

router.get('/maintenance', (req, res, next) => {
  try {
    res.json(getDb().prepare('SELECT * FROM it_maintenance_records ORDER BY created_at DESC').all());
  } catch (e) {
    next(e);
  }
});

router.post('/maintenance', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (!body.asset_id || !body.issue) {
      return res.status(400).json({ error: 'asset_id and issue are required.' });
    }
    const db = getDb();
    const asset = db.prepare('SELECT id FROM it_assets WHERE id = ?').get(body.asset_id);
    if (!asset) return res.status(400).json({ error: 'Referenced asset does not exist.' });
    const id = newId();
    db.prepare(
      `INSERT INTO it_maintenance_records (id, asset_id, issue, provider, status, priority, cost, downtime_hours, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      id, body.asset_id, body.issue, body.provider || 'In-house', body.priority || 'MEDIUM',
      Number(body.cost) || 0, Number(body.downtime_hours) || 0, body.notes || null, req.user.id,
    );
    db.prepare(
      `INSERT INTO it_asset_events (id, asset_id, event_type, to_status, notes, actor_id)
       VALUES (?, ?, 'MAINTENANCE_STARTED', 'UNDER_MAINTENANCE', ?, ?)`,
    ).run(newId(), body.asset_id, body.issue, req.user.id);
    audit(req.user.id, 'CREATE', 'maintenance_record', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_maintenance_records WHERE id = ?').get(id));
  } catch (e) {
    next(e);
  }
});

router.put('/maintenance/:id', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_maintenance_records WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Maintenance record not found.' });
    const body = req.body ?? {};
    const updates = {};
    for (const field of MAINTENANCE_WRITABLE) {
      if (field in body) updates[field] = body[field];
    }
    if (updates.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
      updates.completed_at = updates.completed_at || new Date().toISOString();
    }
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      db.prepare(`UPDATE it_maintenance_records SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => updates[k]), existing.id);
    }
    audit(req.user.id, 'UPDATE', 'maintenance_record', existing.id, 'SUCCESS');
    res.json(db.prepare('SELECT * FROM it_maintenance_records WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

// --- Goods receipts --------------------------------------------------------

const RECEIPT_WRITABLE = ['purchase_order', 'vendor', 'ordered_quantity', 'accepted_quantity', 'rejected_quantity', 'received_date', 'discrepancy_note'];

function receiptStatus(ordered, accepted, rejected) {
  if (accepted + rejected === 0) return 'DRAFT';
  if (rejected > 0 && accepted > 0) return 'DISCREPANCY';
  if (rejected > 0) return 'DISCREPANCY';
  if (accepted < ordered) return 'PARTIALLY_RECEIVED';
  return 'RECEIVED';
}

router.get('/receipts', (req, res, next) => {
  try {
    res.json(getDb().prepare('SELECT * FROM it_goods_receipts ORDER BY created_at DESC').all());
  } catch (e) {
    next(e);
  }
});

router.post('/receipts', requireRole('admin', 'it_asset_manager', 'procurement_officer'), (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (!body.purchase_order || !body.vendor) {
      return res.status(400).json({ error: 'purchase_order and vendor are required.' });
    }
    const ordered = Number(body.ordered_quantity) || 0;
    const accepted = Number(body.accepted_quantity) || 0;
    const rejected = Number(body.rejected_quantity) || 0;
    if (accepted + rejected > ordered) {
      return res.status(400).json({ error: 'Accepted plus rejected quantity cannot exceed the ordered quantity.' });
    }
    const db = getDb();
    const id = newId();
    const receiptNumber = `GR-${String(nextVal('goods_receipt')).padStart(6, '0')}`;
    db.prepare(
      `INSERT INTO it_goods_receipts (id, receipt_number, purchase_order, vendor, received_by, received_date, ordered_quantity, accepted_quantity, rejected_quantity, status, discrepancy_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      id, receiptNumber, body.purchase_order, body.vendor, req.user.id,
      body.received_date || new Date().toISOString().slice(0, 10),
      ordered, accepted, rejected, receiptStatus(ordered, accepted, rejected),
      body.discrepancy_note || null,
    );
    audit(req.user.id, 'CREATE', 'goods_receipt', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_goods_receipts WHERE id = ?').get(id));
  } catch (e) {
    next(e);
  }
});

router.put('/receipts/:id', requireRole('admin', 'it_asset_manager', 'procurement_officer'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_goods_receipts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Goods receipt not found.' });
    const body = req.body ?? {};
    const updates = {};
    for (const field of RECEIPT_WRITABLE) {
      if (field in body) updates[field] = body[field];
    }
    const ordered = updates.ordered_quantity !== undefined ? Number(updates.ordered_quantity) : existing.ordered_quantity;
    const accepted = updates.accepted_quantity !== undefined ? Number(updates.accepted_quantity) : existing.accepted_quantity;
    const rejected = updates.rejected_quantity !== undefined ? Number(updates.rejected_quantity) : existing.rejected_quantity;
    if (accepted + rejected > ordered) {
      return res.status(400).json({ error: 'Accepted plus rejected quantity cannot exceed the ordered quantity.' });
    }
    updates.status = receiptStatus(ordered, accepted, rejected);
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      db.prepare(`UPDATE it_goods_receipts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => updates[k]), existing.id);
    }
    audit(req.user.id, 'UPDATE', 'goods_receipt', existing.id, 'SUCCESS');
    res.json(db.prepare('SELECT * FROM it_goods_receipts WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

// --- Notifications ---------------------------------------------------------

router.get('/notifications', (req, res, next) => {
  try {
    res.json(
      getDb()
        .prepare('SELECT * FROM app_notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT 100')
        .all(req.user.id),
    );
  } catch (e) {
    next(e);
  }
});

router.put('/notifications/:id/read', (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM app_notifications WHERE id = ?').get(req.params.id);
    if (!existing || existing.recipient_id !== req.user.id) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    db.prepare(`UPDATE app_notifications SET read_at = datetime('now') WHERE id = ?`).run(existing.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- Asset lifecycle events -------------------------------------------------

router.get('/asset-events', (req, res, next) => {
  try {
    const assetId = req.query.asset_id;
    const rows = assetId
      ? getDb().prepare('SELECT * FROM it_asset_events WHERE asset_id = ? ORDER BY created_at DESC').all(assetId)
      : getDb().prepare('SELECT * FROM it_asset_events ORDER BY created_at DESC LIMIT 500').all();
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

export const miscRouter = router;
