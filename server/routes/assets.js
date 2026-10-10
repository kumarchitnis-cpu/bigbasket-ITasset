import { Router } from 'express';
import { audit, getDb, newId, nowIso } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

const STATUSES = ['ASSIGNED', 'AVAILABLE', 'UNDER_MAINTENANCE', 'QUARANTINED', 'RETIRED'];
const CONDITIONS = ['NEW', 'GOOD', 'DAMAGED'];
const WRITABLE = ['asset_tag', 'category', 'manufacturer', 'model', 'serial_number', 'status', 'condition', 'custodian', 'location', 'department', 'purchase_cost', 'warranty_start', 'warranty_end', 'purchase_order'];

router.get('/', (req, res, next) => {
  try {
    const q = req.query.q ? `%${String(req.query.q).toLowerCase()}%` : null;
    const rows = q
      ? getDb().prepare(
          `SELECT * FROM it_assets WHERE lower(asset_tag) LIKE ? OR lower(category) LIKE ? OR lower(model) LIKE ? OR lower(custodian) LIKE ? OR lower(department) LIKE ? ORDER BY created_at DESC`,
        ).all(q, q, q, q, q)
      : getDb().prepare('SELECT * FROM it_assets ORDER BY created_at DESC').all();
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const body = req.body ?? {};
    for (const field of ['asset_tag', 'category', 'manufacturer', 'model', 'serial_number', 'custodian', 'location', 'department']) {
      if (!body[field] || !String(body[field]).trim()) {
        return res.status(400).json({ error: `${field.replace(/_/g, ' ')} is required.` });
      }
    }
    const db = getDb();
    const id = newId();
    const now = nowIso();
    db.prepare(
      `INSERT INTO it_assets (id, asset_tag, category, manufacturer, model, serial_number, status, condition, custodian, location, purchase_cost, warranty_start, warranty_end, purchase_order, department, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE', 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, body.asset_tag, body.category, body.manufacturer, body.model, body.serial_number,
      body.custodian, body.location, Number(body.purchase_cost) || 0,
      body.warranty_start || null, body.warranty_end || null, body.purchase_order || null,
      body.department, now, now,
    );
    db.prepare(
      `INSERT INTO it_asset_events (id, asset_id, event_type, to_status, location, notes, actor_id)
       VALUES (?, ?, 'REGISTERED', 'AVAILABLE', ?, 'Asset registered', ?)`,
    ).run(newId(), id, body.location, req.user.id);
    audit(req.user.id, 'CREATE', 'asset', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_assets WHERE id = ?').get(id));
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'An asset with this tag already exists. Use a unique asset tag.' });
    }
    next(e);
  }
});

router.put('/:id', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found.' });
    const body = req.body ?? {};
    const updates = {};
    for (const field of WRITABLE) {
      if (field in body) updates[field] = body[field];
    }
    if (updates.status && !STATUSES.includes(updates.status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    if (updates.condition && !CONDITIONS.includes(updates.condition)) {
      return res.status(400).json({ error: `condition must be one of: ${CONDITIONS.join(', ')}` });
    }
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      keys.push('updated_at');
      db.prepare(`UPDATE it_assets SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => (k === 'updated_at' ? nowIso() : updates[k])), existing.id);
    }
    audit(req.user.id, 'UPDATE', 'asset', existing.id, 'SUCCESS');
    res.json(db.prepare('SELECT * FROM it_assets WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found.' });
    db.prepare('DELETE FROM it_maintenance_records WHERE asset_id = ?').run(existing.id);
    db.prepare('DELETE FROM it_asset_events WHERE asset_id = ?').run(existing.id);
    db.prepare('DELETE FROM it_assets WHERE id = ?').run(existing.id);
    audit(req.user.id, 'DELETE', 'asset', existing.id, 'SUCCESS');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export const assetsRouter = router;
