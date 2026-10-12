import { Router } from 'express';
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
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
    res.status(201).json({ token: signToken(user, req.hostname), user: publicUser(user) });
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
    res.json({ token: signToken(user, req.hostname), user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/google', async (req, res, next) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
  if (!clientId) return res.status(503).json({ error: 'Google sign-in is not configured. Contact your workspace administrator.' });
  if (!credential) return res.status(400).json({ error: 'A Google credential is required.' });

  let profile;
  try {
    const idTokenPayload = await new OAuth2Client().verifyIdToken({ idToken: credential, audience: clientId });
    profile = idTokenPayload.getPayload();
    if (!profile?.sub || !profile.email || profile.email_verified !== true) {
      return res.status(401).json({ error: 'Google sign-in requires a verified Google email address.' });
    }
  } catch {
    return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
  }

  try {
    const db = getDb();
    const email = profile.email.toLowerCase().trim();
    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(profile.sub);
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (user?.google_sub && user.google_sub !== profile.sub) {
        return res.status(409).json({ error: 'This workspace account is linked to a different Google account.' });
      }
      if (user && !user.active) {
        return res.status(401).json({ error: 'Your account is inactive. Contact your workspace administrator.' });
      }
      if (!user) {
        const role = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0 ? 'admin' : 'employee';
        const id = newId();
        const passwordHash = hashPassword(crypto.randomBytes(32).toString('hex'));
        db.prepare(
          'INSERT INTO users (id, email, full_name, password_hash, google_sub, role, department, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        ).run(id, email, profile.name?.trim() || 'Google user', passwordHash, profile.sub, role, 'General');
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        audit(id, 'GOOGLE_SIGNUP', 'user', id, 'SUCCESS');
      } else {
        db.prepare('UPDATE users SET google_sub = ?, updated_at = ? WHERE id = ?').run(profile.sub, nowIso(), user.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      }
    }

    if (!user.active) {
      return res.status(401).json({ error: 'Your account is inactive. Contact your workspace administrator.' });
    }
    if (user.email !== email) {
      return res.status(401).json({ error: 'The Google account email no longer matches this workspace account.' });
    }
    audit(user.id, 'GOOGLE_SIGNIN', 'user', user.id, 'SUCCESS');
    return res.json({ token: signToken(user, req.hostname), user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

router.post('/signout', (req, res) => {
  res.json({ ok: true });
});

export const authRouter = router;
