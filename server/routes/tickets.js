import { Router } from 'express';
import { audit, getDb, newId, nextVal } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED'];
const WRITABLE = ['title', 'category', 'priority', 'status', 'assignee', 'requester', 'due_label'];

router.get('/', (req, res, next) => {
  try {
    res.json(getDb().prepare('SELECT * FROM it_tickets ORDER BY created_at DESC').all());
  } catch (e) {
    next(e);
  }
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (!body.title || !String(body.title).trim()) {
      return res.status(400).json({ error: 'title is required.' });
    }
    const db = getDb();
    const ticketNumber = `TKT-${String(nextVal('ticket')).padStart(6, '0')}`;
    const id = newId();
    db.prepare(
      `INSERT INTO it_tickets (id, ticket_number, title, category, priority, status, assignee, requester, due_label, created_at)
       VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, datetime('now'))`,
    ).run(
      id, ticketNumber, body.title, body.category || 'Other', body.priority || 'MEDIUM',
      body.assignee || 'Service Desk', body.requester || req.user.full_name,
      body.due_label || 'Due in 3 days',
    );
    audit(req.user.id, 'CREATE', 'ticket', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_tickets WHERE id = ?').get(id));
  } catch (e) {
    next(e);
  }
});

router.put('/:id', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_tickets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Ticket not found.' });
    const body = req.body ?? {};
    const updates = {};
    for (const field of WRITABLE) {
      if (field in body) updates[field] = body[field];
    }
    if (updates.priority && !PRIORITIES.includes(updates.priority)) {
      return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
    }
    if (updates.status && !STATUSES.includes(updates.status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      db.prepare(`UPDATE it_tickets SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => updates[k]), existing.id);
    }
    audit(req.user.id, 'UPDATE', 'ticket', existing.id, 'SUCCESS');
    res.json(db.prepare('SELECT * FROM it_tickets WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_tickets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Ticket not found.' });
    db.prepare('DELETE FROM it_tickets WHERE id = ?').run(existing.id);
    audit(req.user.id, 'DELETE', 'ticket', existing.id, 'SUCCESS');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export const ticketsRouter = router;
