import { Router } from 'express';
import { audit, getDb, newId, nextVal } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

const STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'RETURNED', 'ORDERED'];
const WRITABLE = ['title', 'requester', 'department', 'amount', 'status', 'needed_by'];

router.get('/', (req, res, next) => {
  try {
    res.json(getDb().prepare('SELECT * FROM it_purchase_requests ORDER BY created_at DESC').all());
  } catch (e) {
    next(e);
  }
});

router.post('/', requireRole('admin', 'procurement_officer', 'employee'), (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (!body.title || !String(body.title).trim()) {
      return res.status(400).json({ error: 'title is required.' });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Enter an estimated amount greater than zero.' });
    }
    if (!body.needed_by) {
      return res.status(400).json({ error: 'needed_by date is required.' });
    }
    const db = getDb();
    const requestNumber = `PR-${String(nextVal('purchase_request')).padStart(6, '0')}`;
    const id = newId();
    db.prepare(
      `INSERT INTO it_purchase_requests (id, request_number, title, requester, department, amount, status, needed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?, datetime('now'))`,
    ).run(id, requestNumber, body.title, body.requester || req.user.full_name, body.department || req.user.department, amount, body.needed_by);
    audit(req.user.id, 'CREATE', 'purchase_request', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_purchase_requests WHERE id = ?').get(id));
  } catch (e) {
    next(e);
  }
});

router.put('/:id', requireRole('admin', 'procurement_officer', 'approver'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_purchase_requests WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Purchase request not found.' });
    const body = req.body ?? {};
    const updates = {};
    for (const field of WRITABLE) {
      if (field in body) updates[field] = body[field];
    }
    if (updates.status && !STATUSES.includes(updates.status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      db.prepare(`UPDATE it_purchase_requests SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => updates[k]), existing.id);
    }
    audit(req.user.id, 'UPDATE', 'purchase_request', existing.id, 'SUCCESS');
    res.json(db.prepare('SELECT * FROM it_purchase_requests WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_purchase_requests WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Purchase request not found.' });
    db.prepare('DELETE FROM it_purchase_requests WHERE id = ?').run(existing.id);
    audit(req.user.id, 'DELETE', 'purchase_request', existing.id, 'SUCCESS');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export const purchaseRequestsRouter = router;
