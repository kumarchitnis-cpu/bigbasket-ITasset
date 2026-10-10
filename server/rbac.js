import { getDb } from './db.js';
import { verifyToken } from './auth.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token, req.hostname) : null;
  if (!payload) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  const user = getDb()
    .prepare('SELECT id, email, full_name, role, department, active FROM users WHERE id = ?')
    .get(payload.sub);
  if (!user || !user.active) {
    return res.status(401).json({ error: 'This account is inactive or no longer exists.' });
  }
  req.user = { ...user, active: !!user.active };
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: your role cannot perform this action.' });
    }
    next();
  };
}
