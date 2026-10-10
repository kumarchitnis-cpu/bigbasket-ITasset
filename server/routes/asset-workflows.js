import { Router } from 'express';
import { audit, getDb, newId, nextVal, nowIso, notify } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

router.get('/employee-requests', (req, res, next) => {
  try {
    const db = getDb();
    const rows = ['admin', 'it_asset_manager'].includes(req.user.role)
      ? db.prepare(
          `SELECT r.*, u.full_name AS requester_name, u.department
           FROM it_employee_asset_requests r JOIN users u ON u.id = r.requester_id
           ORDER BY r.created_at DESC`,
        ).all()
      : db.prepare(
          `SELECT r.*, u.full_name AS requester_name, u.department
           FROM it_employee_asset_requests r JOIN users u ON u.id = r.requester_id
           WHERE r.requester_id = ? ORDER BY r.created_at DESC`,
        ).all(req.user.id);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/employee-requests', requireRole('admin', 'it_asset_manager', 'employee'), (req, res, next) => {
  try {
    const body = req.body ?? {};
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
    const neededBy = typeof body.needed_by === 'string' ? body.needed_by.trim() : '';
    if (!category || !justification || !neededBy) {
      return res.status(400).json({ error: 'Category, justification, and needed-by date are required.' });
    }
    if (!Number.isFinite(Date.parse(neededBy))) return res.status(400).json({ error: 'Enter a valid needed-by date.' });
    const db = getDb();
    const id = newId();
    const requestNumber = `EAR-${String(nextVal('employee_asset_request')).padStart(6, '0')}`;
    db.prepare(
      `INSERT INTO it_employee_asset_requests
       (id, request_number, requester_id, category, justification, needed_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, requestNumber, req.user.id, category, justification, neededBy, nowIso(), nowIso());
    for (const manager of db.prepare("SELECT id FROM users WHERE active = 1 AND role IN ('admin', 'it_asset_manager')").all()) {
      notify(manager.id, 'EMPLOYEE_ASSET_REQUEST', 'Asset request needs review', `${req.user.full_name} requested a ${category}.`, 'employee_asset_request', id);
    }
    audit(req.user.id, 'CREATE', 'employee_asset_request', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_employee_asset_requests WHERE id = ?').get(id));
  } catch (e) {
    next(e);
  }
});

router.put('/employee-requests/:id/review', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_employee_asset_requests WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Employee asset request not found.' });
    if (existing.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: 'This request has already been reviewed.' });
    const decision = req.body?.status;
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ error: 'Review status must be APPROVED or REJECTED.' });
    }
    const note = typeof req.body?.review_note === 'string' ? req.body.review_note.trim() : null;
    const now = nowIso();
    const result = db.prepare(
      `UPDATE it_employee_asset_requests
       SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'PENDING_APPROVAL'`,
    ).run(decision, req.user.id, note, now, now, existing.id);
    if (result.changes !== 1) return res.status(409).json({ error: 'This request has already been reviewed.' });
    notify(existing.requester_id, 'EMPLOYEE_ASSET_REQUEST_REVIEWED', `Asset request ${decision.toLowerCase()}`, `Your request ${existing.request_number} was ${decision.toLowerCase()}.${note ? ` ${note}` : ''}`, 'employee_asset_request', existing.id, `employee-asset-reviewed:${existing.id}`);
    audit(req.user.id, 'REVIEW', 'employee_asset_request', existing.id, 'SUCCESS', note, { status: decision });
    res.json(db.prepare('SELECT * FROM it_employee_asset_requests WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

router.get('/write-offs', (req, res, next) => {
  try {
    const db = getDb();
    const rows = ['admin', 'it_asset_manager'].includes(req.user.role)
      ? db.prepare(
          `SELECT w.*, a.asset_tag, a.manufacturer, a.model, a.status AS asset_status,
                  u.full_name AS requester_name, reviewer.full_name AS reviewer_name
           FROM it_write_off_requests w
           JOIN it_assets a ON a.id = w.asset_id
           JOIN users u ON u.id = w.requester_id
           LEFT JOIN users reviewer ON reviewer.id = w.reviewer_id
           ORDER BY w.created_at DESC`,
        ).all()
      : db.prepare(
          `SELECT w.*, a.asset_tag, a.manufacturer, a.model, a.status AS asset_status,
                  u.full_name AS requester_name, reviewer.full_name AS reviewer_name
           FROM it_write_off_requests w
           JOIN it_assets a ON a.id = w.asset_id
           JOIN users u ON u.id = w.requester_id
           LEFT JOIN users reviewer ON reviewer.id = w.reviewer_id
           WHERE w.requester_id = ? ORDER BY w.created_at DESC`,
        ).all(req.user.id);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/write-offs', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const assetId = typeof req.body?.asset_id === 'string' ? req.body.asset_id : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!assetId || !reason) return res.status(400).json({ error: 'An asset and write-off reason are required.' });
    const db = getDb();
    const asset = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(assetId);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (asset.status === 'RETIRED') return res.status(409).json({ error: 'This asset is already retired.' });
    if (db.prepare("SELECT id FROM it_write_off_requests WHERE asset_id = ? AND status = 'PENDING_APPROVAL'").get(assetId)) {
      return res.status(409).json({ error: 'This asset already has a write-off request awaiting review.' });
    }
    const id = newId();
    try {
      db.prepare(
      `INSERT INTO it_write_off_requests (id, asset_id, requester_id, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, assetId, req.user.id, reason, nowIso(), nowIso());
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'This asset already has a write-off request awaiting review.' });
      }
      throw e;
    }
    for (const admin of db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'admin'").all()) {
      notify(admin.id, 'ASSET_WRITE_OFF_REQUEST', 'Write-off approval required', `Asset ${asset.asset_tag}: ${reason}`, 'write_off_request', id);
    }
    audit(req.user.id, 'CREATE', 'write_off_request', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(id));
  } catch (e) {
    next(e);
  }
});

router.put('/write-offs/:id/review', requireRole('admin'), (req, res, next) => {
  const db = getDb();
  let transactionStarted = false;
  try {
    const existing = db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Write-off request not found.' });
    if (existing.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: 'This request has already been reviewed.' });
    const decision = req.body?.status;
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ error: 'Review status must be APPROVED or REJECTED.' });
    }
    const note = typeof req.body?.review_note === 'string' ? req.body.review_note.trim() : null;
    const now = nowIso();
    const asset = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(existing.asset_id);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (decision === 'APPROVED' && asset.status === 'RETIRED') {
      return res.status(409).json({ error: 'This asset has already been retired.' });
    }
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    const lockedRequest = db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(req.params.id);
    if (!lockedRequest || lockedRequest.status !== 'PENDING_APPROVAL') {
      db.exec('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'This request has already been reviewed.' });
    }
    const lockedAsset = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(lockedRequest.asset_id);
    if (!lockedAsset || (decision === 'APPROVED' && lockedAsset.status === 'RETIRED')) {
      db.exec('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'The asset can no longer be written off.' });
    }
    const result = db.prepare(
      `UPDATE it_write_off_requests
       SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'PENDING_APPROVAL'`,
    ).run(decision, req.user.id, note, now, now, lockedRequest.id);
    if (result.changes !== 1) {
      db.exec('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'This request has already been reviewed.' });
    }
    if (decision === 'APPROVED') {
      db.prepare("UPDATE it_assets SET status = 'RETIRED', updated_at = ? WHERE id = ?").run(now, lockedAsset.id);
      db.prepare(
        `INSERT INTO it_asset_events
         (id, asset_id, event_type, from_status, to_status, from_custodian, to_custodian, location, notes, actor_id, created_at)
         VALUES (?, ?, 'RETIRED', ?, 'RETIRED', ?, ?, ?, ?, ?, ?)`,
      ).run(newId(), lockedAsset.id, lockedAsset.status, lockedAsset.custodian, lockedAsset.custodian, lockedAsset.location, `Write-off approved: ${lockedRequest.reason}${note ? `. ${note}` : ''}`, req.user.id, now);
      db.prepare(
        `UPDATE it_maintenance_records SET status = 'CANCELLED', completed_at = ?
         WHERE asset_id = ? AND status IN ('OPEN', 'IN_PROGRESS')`,
      ).run(now, lockedAsset.id);
    }
    notify(lockedRequest.requester_id, `ASSET_WRITE_OFF_${decision}`, `Asset write-off ${decision.toLowerCase()}`, `The write-off request for ${lockedAsset.asset_tag} was ${decision.toLowerCase()}.${note ? ` ${note}` : ''}`, 'write_off_request', lockedRequest.id, `write-off-reviewed:${lockedRequest.id}`);
    audit(req.user.id, 'REVIEW', 'write_off_request', lockedRequest.id, 'SUCCESS', note, { status: decision });
    db.exec('COMMIT');
    transactionStarted = false;
    res.json(db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(lockedRequest.id));
  } catch (e) {
    if (transactionStarted) db.exec('ROLLBACK');
    next(e);
  }
});

export const assetWorkflowsRouter = router;
