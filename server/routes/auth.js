import { Router } from 'express';
import crypto from 'node:crypto';
import { audit, getDb, newId, nowIso } from '../db.js';
import { hashPassword, signToken, verifyPassword } from '../auth.js';
import { requireAuth } from '../rbac.js';

const router = Router();

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    department: row.department,
    active: !!row.active,
  };
}

router.post('/signup', (req, res, next) => {
  try {
    const { email, password, full_name } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const db = getDb();
    const normalized = String(email).toLowerCase().trim();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(normalized)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    const role = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0 ? 'admin' : 'employee';
    const id = newId();
    db.prepare(
      'INSERT INTO users (id, email, full_name, password_hash, role, department, active) VALUES (?, ?, ?, ?, ?, ?, 1)',
    ).run(id, normalized, full_name ? String(full_name).trim() : 'Workspace user', hashPassword(password), role, 'General');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    audit(id, 'SIGNUP', 'user', id, 'SUCCESS');
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/signin', (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'That email and password combination did not match. Please verify your credentials and try again.' });
    }
    if (!user.active) {
      return res.status(401).json({ error: 'Your account is inactive. Contact your workspace administrator.' });
    }
    audit(user.id, 'SIGNIN', 'user', user.id, 'SUCCESS');
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

router.post('/signout', (req, res) => {
  res.json({ ok: true });
});

export const authRouter = router;
