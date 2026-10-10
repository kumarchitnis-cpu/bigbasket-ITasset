import { Router } from 'express';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import crypto from 'node:crypto';
import { audit, getDb, newId, nowIso, uploadsDir } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_TYPES = ['INVOICE', 'PURCHASE_ORDER', 'RECEIPT', 'WARRANTY', 'OTHER'];

const upload = multer({
  limits: { fileSize: 10485760 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Unsupported file type. Upload PDF, PNG, JPG, or WebP.'), false);
    }
    cb(null, true);
  },
});

function visibleTo(user, doc) {
  return doc.uploaded_by === user.id || ['admin', 'finance_officer', 'auditor'].includes(user.role);
}

function serialize(row) {
  let extractedFields = {};
  try {
    extractedFields = JSON.parse(row.extracted_fields || '{}');
  } catch {
    extractedFields = {};
  }
  return { ...row, extracted_fields: extractedFields };
}

router.get('/', (req, res, next) => {
  try {
    const canSeeAll = ['admin', 'finance_officer', 'auditor'].includes(req.user.role);
    const rows = canSeeAll
      ? getDb().prepare('SELECT * FROM app_documents ORDER BY created_at DESC').all()
      : getDb().prepare('SELECT * FROM app_documents WHERE uploaded_by = ? ORDER BY created_at DESC').all(req.user.id);
    res.json(rows.map(serialize));
  } catch (e) {
    next(e);
  }
});

router.post('/', upload.single('file'), (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'A file is required.' });
    const documentType = req.body.document_type || 'OTHER';
    if (!ALLOWED_TYPES.includes(documentType)) {
      return res.status(400).json({ error: `document_type must be one of: ${ALLOWED_TYPES.join(', ')}` });
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const storagePath = `${req.user.id}/${crypto.randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const fullPath = path.join(uploadsDir(), storagePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.buffer);
    const db = getDb();
    const id = newId();
    db.prepare(
      `INSERT INTO app_documents (id, storage_path, original_name, mime_type, file_size, sha256, document_type, extraction_status, uploaded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'UPLOADED', ?, datetime('now'), datetime('now'))`,
    ).run(id, storagePath, file.originalname, file.mimetype, file.size, sha256, documentType, req.user.id);
    audit(req.user.id, 'UPLOAD', 'document', id, 'SUCCESS');
    res.status(201).json(serialize(db.prepare('SELECT * FROM app_documents WHERE id = ?').get(id)));
  } catch (e) {
    next(e);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM app_documents WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Document not found.' });
    if (!visibleTo(req.user, existing)) {
      return res.status(403).json({ error: 'Forbidden: your role cannot edit this document.' });
    }
    const body = req.body ?? {};
    const updates = {};
    if ('extraction_status' in body && ['UPLOADED', 'EXTRACTING', 'NEEDS_REVIEW', 'VALIDATED', 'FAILED'].includes(body.extraction_status)) {
      updates.extraction_status = body.extraction_status;
    }
    if ('extracted_fields' in body) updates.extracted_fields = JSON.stringify(body.extracted_fields ?? {});
    if ('confidence' in body) updates.confidence = Number(body.confidence);
    if ('review_reason' in body) updates.review_reason = body.review_reason || null;
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      keys.push('updated_at');
      db.prepare(`UPDATE app_documents SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => (k === 'updated_at' ? nowIso() : updates[k])), existing.id);
    }
    res.json(serialize(db.prepare('SELECT * FROM app_documents WHERE id = ?').get(existing.id)));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM app_documents WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Document not found.' });
    if (!visibleTo(req.user, existing)) {
      return res.status(403).json({ error: 'Forbidden: your role cannot delete this document.' });
    }
    const filePath = path.join(uploadsDir(), existing.storage_path);
    if (existsSync(filePath)) {
      const { unlinkSync } = require('node:fs');
      unlinkSync(filePath);
    }
    db.prepare('DELETE FROM app_documents WHERE id = ?').run(existing.id);
    audit(req.user.id, 'DELETE', 'document', existing.id, 'SUCCESS');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.get('/:id/file', (req, res, next) => {
  try {
    const existing = getDb().prepare('SELECT * FROM app_documents WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Document not found.' });
    if (!visibleTo(req.user, existing)) {
      return res.status(403).json({ error: 'Forbidden: your role cannot access this document.' });
    }
    const filePath = path.join(uploadsDir(), existing.storage_path);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'Document file is missing.' });
    res.download(filePath, existing.original_name);
  } catch (e) {
    next(e);
  }
});

export const documentsRouter = router;
