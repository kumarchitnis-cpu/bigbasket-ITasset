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

router.get('/:id/events', (req, res, next) => {
  try {
    const db = getDb();
    if (!db.prepare('SELECT id FROM it_assets WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'Asset not found.' });
    }
    const events = db.prepare(
      `SELECT e.*, u.full_name AS actor_name
       FROM it_asset_events e
       JOIN users u ON u.id = e.actor_id
       WHERE e.asset_id = ?
       ORDER BY e.created_at DESC`,
    ).all(req.params.id);
    res.json(events);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/events', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  const db = getDb();
  let transactionStarted = false;
  try {
    const existing = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found.' });

    const body = req.body ?? {};
    const eventType = String(body.event_type || '');
    const now = nowIso();
    const updates = { status: existing.status, custodian: existing.custodian, location: existing.location, condition: existing.condition };
    let eventNotes = body.notes ? String(body.notes).trim() : null;
    let maintenance = null;

    const requireText = (value, name) => {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) throw Object.assign(new Error(`${name} is required.`), { status: 400 });
      return text;
    };
    const requireCurrentStatus = (...statuses) => {
      if (!statuses.includes(existing.status)) {
        throw Object.assign(new Error(`This action is not available while the asset is ${existing.status.toLowerCase().replace(/_/g, ' ')}.`), { status: 409 });
      }
    };

    switch (eventType) {
      case 'ASSIGNED':
        requireCurrentStatus('AVAILABLE');
        updates.status = 'ASSIGNED';
        updates.custodian = requireText(body.custodian, 'custodian');
        eventNotes ||= 'Asset assigned';
        break;
      case 'RETURNED':
        requireCurrentStatus('ASSIGNED');
        updates.status = 'AVAILABLE';
        updates.custodian = requireText(body.custodian, 'receiving custodian');
        eventNotes ||= 'Asset returned to inventory';
        break;
      case 'TRANSFERRED':
        requireCurrentStatus('ASSIGNED');
        updates.custodian = requireText(body.custodian, 'new custodian');
        if (body.location !== undefined) updates.location = requireText(body.location, 'location');
        eventNotes ||= 'Asset transferred';
        break;
      case 'MAINTENANCE_STARTED': {
        requireCurrentStatus('AVAILABLE', 'ASSIGNED');
        const priority = body.priority === undefined || body.priority === '' ? 'MEDIUM' : body.priority;
        if (!['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(priority)) {
          throw Object.assign(new Error('priority must be LOW, MEDIUM, HIGH, or URGENT.'), { status: 400 });
        }
        maintenance = {
          issue: requireText(body.issue, 'issue'),
          provider: typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : 'In-house',
          priority,
        };
        updates.status = 'UNDER_MAINTENANCE';
        eventNotes = maintenance.issue;
        break;
      }
      case 'MAINTENANCE_COMPLETED':
        requireCurrentStatus('UNDER_MAINTENANCE');
        maintenance = db.prepare(
          `SELECT id FROM it_maintenance_records
           WHERE asset_id = ? AND status IN ('OPEN', 'IN_PROGRESS')
           ORDER BY created_at DESC LIMIT 1`,
        ).get(existing.id);
        if (!maintenance) {
          throw Object.assign(new Error('No open maintenance record exists for this asset.'), { status: 409 });
        }
        updates.status = 'AVAILABLE';
        eventNotes ||= 'Maintenance completed; asset returned to available inventory';
        break;
      case 'QUARANTINED':
        requireCurrentStatus('AVAILABLE', 'ASSIGNED', 'UNDER_MAINTENANCE');
        updates.status = 'QUARANTINED';
        eventNotes = requireText(eventNotes, 'reason');
        break;
      case 'RETIRED':
        requireCurrentStatus('AVAILABLE', 'ASSIGNED', 'UNDER_MAINTENANCE', 'QUARANTINED');
        updates.status = 'RETIRED';
        eventNotes = requireText(eventNotes, 'reason');
        break;
      case 'AUDITED':
        updates.condition = body.condition === undefined ? existing.condition : body.condition;
        if (!CONDITIONS.includes(updates.condition)) {
          throw Object.assign(new Error(`condition must be one of: ${CONDITIONS.join(', ')}`), { status: 400 });
        }
        eventNotes = requireText(eventNotes, 'audit notes');
        break;
      default:
        return res.status(400).json({ error: 'event_type must be a supported asset lifecycle action.' });
    }

    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    db.prepare(
      `UPDATE it_assets
       SET status = ?, custodian = ?, location = ?, condition = ?,
           last_audited_at = CASE WHEN ? = 'AUDITED' THEN ? ELSE last_audited_at END,
           updated_at = ?
       WHERE id = ?`,
    ).run(updates.status, updates.custodian, updates.location, updates.condition, eventType, now, now, existing.id);

    if (eventType === 'MAINTENANCE_STARTED') {
      db.prepare(
        `INSERT INTO it_maintenance_records
         (id, asset_id, issue, provider, status, priority, created_by, created_at)
         VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
      ).run(newId(), existing.id, maintenance.issue, maintenance.provider, maintenance.priority, req.user.id, now);
    } else if (eventType === 'MAINTENANCE_COMPLETED') {
      db.prepare(
        `UPDATE it_maintenance_records
         SET status = 'COMPLETED', completed_at = ?
         WHERE id = ?`,
      ).run(now, maintenance.id);
    } else if (eventType === 'QUARANTINED' || eventType === 'RETIRED') {
      db.prepare(
        `UPDATE it_maintenance_records
         SET status = 'CANCELLED', completed_at = ?
         WHERE asset_id = ? AND status IN ('OPEN', 'IN_PROGRESS')`,
      ).run(now, existing.id);
    }

    db.prepare(
      `INSERT INTO it_asset_events
       (id, asset_id, event_type, from_status, to_status, from_custodian, to_custodian, location, notes, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId(), existing.id, eventType, existing.status, updates.status, existing.custodian,
      updates.custodian, updates.location, eventNotes, req.user.id, now,
    );
    audit(req.user.id, eventType, 'asset', existing.id, 'SUCCESS', eventNotes);
    db.exec('COMMIT');
    transactionStarted = false;
    res.json(db.prepare('SELECT * FROM it_assets WHERE id = ?').get(existing.id));
  } catch (e) {
    if (transactionStarted) db.exec('ROLLBACK');
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
    if (updates.status && updates.status !== existing.status) {
      return res.status(400).json({ error: 'Use an asset lifecycle action to change status so the change is recorded.' });
    }
    if (updates.custodian && updates.custodian !== existing.custodian) {
      return res.status(400).json({ error: 'Use an asset lifecycle action to change custodian so the change is recorded.' });
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
