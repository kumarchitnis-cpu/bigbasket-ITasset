import { Router } from 'express';
import { audit, getDb, newId, nowIso } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

const vendorRoles = ['admin', 'procurement_officer'];
const reviewRoles = ['admin', 'approver'];
const writableFields = ['legal_name', 'contact_name', 'email', 'phone', 'tax_id', 'address', 'categories', 'notes'];
const reviewStatuses = ['APPROVED', 'REJECTED'];

function parseVendor(body) {
  const vendor = {};
  for (const field of writableFields) {
    const value = typeof body?.[field] === 'string' ? body[field].trim() : '';
    if (field === 'legal_name' && !value) return { error: 'Vendor legal name is required.' };
    if (value.length > (field === 'address' || field === 'notes' ? 1000 : 200)) {
      return { error: `${field.replace(/_/g, ' ')} exceeds its maximum length.` };
    }
    vendor[field] = value;
  }
  if (vendor.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vendor.email)) {
    return { error: 'Enter a valid vendor email address.' };
  }
  return { vendor };
}

function isVendorNameConflict(error) {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed: it_vendors.legal_name');
}

router.get('/', requireRole(...vendorRoles, ...reviewRoles), (req, res, next) => {
  try {
    res.json(getDb().prepare(
      `SELECT v.*, submitted.full_name AS submitted_by_name, reviewed.full_name AS reviewed_by_name
       FROM it_vendors v
       JOIN users submitted ON submitted.id = v.submitted_by
       LEFT JOIN users reviewed ON reviewed.id = v.reviewed_by
       ORDER BY CASE v.status WHEN 'PENDING_REVIEW' THEN 0 ELSE 1 END, v.legal_name COLLATE NOCASE`,
    ).all());
  } catch (error) {
    next(error);
  }
});

router.post('/', requireRole(...vendorRoles), (req, res, next) => {
  try {
    const parsed = parseVendor(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const db = getDb();
    const id = newId();
    const columns = writableFields;
    db.prepare(
      `INSERT INTO it_vendors (id, ${columns.join(', ')}, submitted_by)
       VALUES (?, ${columns.map(() => '?').join(', ')}, ?)`,
    ).run(id, ...columns.map((field) => parsed.vendor[field]), req.user.id);
    audit(req.user.id, 'CREATE', 'vendor', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_vendors WHERE id = ?').get(id));
  } catch (error) {
    if (isVendorNameConflict(error)) return res.status(409).json({ error: 'A vendor with this legal name is already registered.' });
    next(error);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_vendors WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Vendor not found.' });
    const body = req.body ?? {};
    if ('status' in body) {
      if (!reviewRoles.includes(req.user.role)) return res.status(403).json({ error: 'Only admins and approvers can review vendor onboarding.' });
      if (!reviewStatuses.includes(body.status) || existing.status !== 'PENDING_REVIEW') {
        return res.status(400).json({ error: 'Only pending vendors can be approved or rejected.' });
      }
      if (body.review_note !== undefined && (typeof body.review_note !== 'string' || body.review_note.length > 1000)) {
        return res.status(400).json({ error: 'Review notes must be 1000 characters or fewer.' });
      }
      db.prepare('UPDATE it_vendors SET status = ?, reviewed_by = ?, updated_at = ? WHERE id = ?')
        .run(body.status, req.user.id, nowIso(), existing.id);
      audit(req.user.id, 'REVIEW', 'vendor', existing.id, 'SUCCESS', body.review_note || null);
      return res.json(db.prepare('SELECT * FROM it_vendors WHERE id = ?').get(existing.id));
    }
    if (!vendorRoles.includes(req.user.role)) return res.status(403).json({ error: 'Your role cannot update vendor records.' });
    const parsed = parseVendor({ ...existing, ...body });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    db.prepare(
      `UPDATE it_vendors SET ${writableFields.map((field) => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ).run(...writableFields.map((field) => parsed.vendor[field]), nowIso(), existing.id);
    audit(req.user.id, 'UPDATE', 'vendor', existing.id, 'SUCCESS');
    res.json(db.prepare('SELECT * FROM it_vendors WHERE id = ?').get(existing.id));
  } catch (error) {
    if (isVendorNameConflict(error)) return res.status(409).json({ error: 'A vendor with this legal name is already registered.' });
    next(error);
  }
});

router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM it_vendors WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Vendor not found.' });
    db.prepare("UPDATE it_vendors SET status = 'SUSPENDED', updated_at = ? WHERE id = ?").run(nowIso(), existing.id);
    audit(req.user.id, 'SUSPEND', 'vendor', existing.id, 'SUCCESS');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export const vendorsRouter = router;
