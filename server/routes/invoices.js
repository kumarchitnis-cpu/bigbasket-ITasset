import { Router } from 'express';
import { audit, getDb, newId } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';
import { extractInvoice } from '../openai.js';

const router = Router();
router.use(requireAuth);

const STATUSES = ['PENDING', 'UNDER_REVIEW', 'PROCESSED', 'ON_HOLD', 'REJECTED'];
const WRITABLE = ['invoice_number', 'vendor', 'purchase_order', 'total', 'status', 'confidence', 'issue', 'invoice_date', 'currency_code'];

router.get('/', (req, res, next) => {
  try {
    res.json(getDb().prepare('SELECT * FROM it_invoices ORDER BY created_at DESC').all());
  } catch (e) {
    next(e);
  }
});

router.post('/', requireRole('admin', 'finance_officer'), (req, res, next) => {
  try {
    const body = req.body ?? {};
    for (const field of ['invoice_number', 'vendor', 'purchase_order', 'total']) {
      if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
        return res.status(400).json({ error: `${field.replace(/_/g, ' ')} is required.` });
      }
    }
    const db = getDb();
    const id = newId();
    db.prepare(
      `INSERT INTO it_invoices (id, invoice_number, vendor, purchase_order, total, currency_code, status, confidence, issue, invoice_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, datetime('now'))`,
    ).run(
      id, body.invoice_number, body.vendor, body.purchase_order, Number(body.total),
      body.currency_code || 'INR', Number(body.confidence) || 0, body.issue || null,
      body.invoice_date || new Date().toISOString().slice(0, 10),
    );
    audit(req.user.id, 'CREATE', 'invoice', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_invoices WHERE id = ?').get(id));
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'An invoice with this number already exists.' });
    }
    next(e);
  }
});

router.put('/:id', requireRole('admin', 'finance_officer'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_invoices WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Invoice not found.' });
    const body = req.body ?? {};
    const updates = {};
    for (const field of WRITABLE) {
      if (field in body) updates[field] = body[field];
    }
    if (updates.status && !STATUSES.includes(updates.status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    const keys = Object.keys(updates);
    if (updates.status === 'PROCESSED' && existing.status !== 'PROCESSED') {
      keys.push('approved_at');
    }
    if (keys.length > 0) {
      db.prepare(`UPDATE it_invoices SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => (k === 'approved_at' ? new Date().toISOString() : updates[k])), existing.id);
    }
    audit(req.user.id, 'UPDATE', 'invoice', existing.id, 'SUCCESS');
    res.json(db.prepare('SELECT * FROM it_invoices WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_invoices WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Invoice not found.' });
    db.prepare('DELETE FROM it_invoices WHERE id = ?').run(existing.id);
    audit(req.user.id, 'DELETE', 'invoice', existing.id, 'SUCCESS');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.post('/process', requireAuth, async (req, res, next) => {
  try {
    const { imageDataUrl, filename, document_id } = req.body ?? {};
    if (!imageDataUrl || !String(imageDataUrl).startsWith('data:')) {
      return res.status(400).json({ error: 'A supported invoice document is required.' });
    }
    if (String(imageDataUrl).length > 15000000) {
      return res.status(413).json({ error: 'The invoice document is too large to review.' });
    }
    const extraction = await extractInvoice(imageDataUrl, filename);
    if (document_id) {
      const doc = getDb().prepare('SELECT * FROM app_documents WHERE id = ?').get(document_id);
      const canEdit = doc && (doc.uploaded_by === req.user.id || ['admin', 'finance_officer'].includes(req.user.role));
      if (canEdit) {
        const confidence = Math.max(0, Math.min(100, Number(extraction.confidence) || 0));
        const reviewReason = extraction.review_reason || null;
        getDb()
          .prepare(
            `UPDATE app_documents SET extraction_status = ?, extracted_fields = ?, confidence = ?, review_reason = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(
            confidence >= 85 && !reviewReason ? 'VALIDATED' : 'NEEDS_REVIEW',
            JSON.stringify(extraction),
            confidence,
            reviewReason,
            document_id,
          );
      }
    }
    res.json({ extraction });
  } catch (e) {
    next(e);
  }
});

export const invoicesRouter = router;
