import { Router } from 'express';
import { audit, getDb, newId } from '../db.js';
import { hashPassword } from '../auth.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
const ROLES = ['admin', 'it_asset_manager', 'procurement_officer', 'finance_officer', 'approver', 'employee', 'auditor'];

router.use(requireAuth, requireRole('admin'));

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    department: user.department,
    active: !!user.active,
    created_at: user.created_at,
  };
}

router.get('/', (req, res, next) => {
  try {
    const users = getDb()
      .prepare('SELECT id, email, full_name, role, department, active, created_at FROM users ORDER BY created_at DESC')
      .all();
    res.json(users.map(publicUser));
  } catch (error) {
    next(error);
  }
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body ?? {};
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const department = typeof body.department === 'string' && body.department.trim()
      ? body.department.trim()
      : 'General';
    const role = typeof body.role === 'string' ? body.role : 'employee';

    if (!fullName) return res.status(400).json({ error: 'Full name is required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a valid workspace role.' });

    const db = getDb();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const id = newId();
    db.prepare(
      'INSERT INTO users (id, email, full_name, password_hash, role, department, active) VALUES (?, ?, ?, ?, ?, ?, 1)',
    ).run(id, email, fullName, hashPassword(password), role, department);
    audit(req.user.id, 'CREATE', 'user', id, 'SUCCESS', null, { role });
    const created = db.prepare(
      'SELECT id, email, full_name, role, department, active, created_at FROM users WHERE id = ?',
    ).get(id);
    res.status(201).json(publicUser(created));
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'User not found.' });

    const body = req.body ?? {};
    const updates = {};
    if ('role' in body) {
      if (typeof body.role !== 'string' || !ROLES.includes(body.role)) {
        return res.status(400).json({ error: 'Choose a valid workspace role.' });
      }
      updates.role = body.role;
    }
    if ('active' in body) {
      if (typeof body.active !== 'boolean') {
        return res.status(400).json({ error: 'Account status must be active or inactive.' });
      }
      updates.active = body.active ? 1 : 0;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Provide a role or account status to update.' });
    }

    const nextRole = updates.role ?? existing.role;
    const nextActive = updates.active ?? existing.active;
    if (req.params.id === req.user.id && (!nextActive || nextRole !== 'admin')) {
      return res.status(400).json({ error: 'You cannot deactivate yourself or remove your own admin role.' });
    }
    if (existing.active && existing.role === 'admin' && (!nextActive || nextRole !== 'admin')) {
      const otherActiveAdmins = db.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND id != ?",
      ).get(existing.id).count;
      if (otherActiveAdmins === 0) {
        return res.status(409).json({ error: 'The workspace must retain at least one active administrator.' });
      }
    }

    db.prepare(
      `UPDATE users SET ${Object.keys(updates).map((field) => `${field} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    ).run(...Object.values(updates), existing.id);
    audit(req.user.id, 'UPDATE', 'user', existing.id, 'SUCCESS', null, {
      before: { role: existing.role, active: !!existing.active },
      after: { role: nextRole, active: !!nextActive },
    });
    const updated = db.prepare(
      'SELECT id, email, full_name, role, department, active, created_at FROM users WHERE id = ?',
    ).get(existing.id);
    res.json(publicUser(updated));
  } catch (error) {
    next(error);
  }
});

export const usersRouter = router;
