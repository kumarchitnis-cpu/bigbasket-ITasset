import { Router } from 'express';
import { audit, getDb } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

const defaults = {
  companyName: 'Your Company',
  companyEmail: '',
  companyPhone: '',
  companyAddress: '',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  logoUrl: '',
  primaryColor: '#1f5874',
  accentColor: '#e7ae56',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  approvalLevels: 2,
  defaultApproverRole: 'approver',
  autoApproveLimit: 0,
  notificationsEmail: false,
  notificationsInApp: true,
  notifyInvoices: true,
  notifyApprovals: true,
  notifySlaBreaches: true,
  apEscalationEnabled: true,
  apEscalationAfterHours: 48,
  apEscalationRepeatHours: 24,
  apEscalationEmail: '',
  slaLowResponseHours: 24,
  slaLowResolutionHours: 120,
  slaMediumResponseHours: 8,
  slaMediumResolutionHours: 48,
  slaHighResponseHours: 4,
  slaHighResolutionHours: 24,
  slaUrgentResponseHours: 1,
  slaUrgentResolutionHours: 8,
};

const stringFields = [
  'companyName', 'companyEmail', 'companyPhone', 'companyAddress', 'currency', 'timezone',
  'logoUrl', 'primaryColor', 'accentColor', 'googleClientId', 'defaultApproverRole',
  'apEscalationEmail',
];
const numberFields = [
  'approvalLevels', 'autoApproveLimit',
  'apEscalationAfterHours', 'apEscalationRepeatHours',
  'slaLowResponseHours', 'slaLowResolutionHours', 'slaMediumResponseHours', 'slaMediumResolutionHours',
  'slaHighResponseHours', 'slaHighResolutionHours', 'slaUrgentResponseHours', 'slaUrgentResolutionHours',
];
const booleanFields = [
  'notificationsEmail', 'notificationsInApp',
  'notifyInvoices', 'notifyApprovals', 'notifySlaBreaches', 'apEscalationEnabled',
];

function readSettings() {
  const row = getDb().prepare("SELECT settings FROM workspace_settings WHERE id = 'workspace'").get();
  if (!row) return defaults;
  const saved = JSON.parse(row.settings);
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, saved[key] ?? defaults[key]]));
}

function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return 'Settings must be an object.';
  }
  const allowedFields = new Set([...stringFields, ...numberFields, ...booleanFields]);
  if (Object.keys(settings).some((field) => !allowedFields.has(field))) return 'Settings contain an unsupported field.';
  for (const field of stringFields) {
    if (typeof settings[field] !== 'string') return `${field} must be text.`;
  }
  for (const field of numberFields) {
    if (!Number.isFinite(settings[field]) || settings[field] < 0) return `${field} must be a non-negative number.`;
  }
  for (const field of booleanFields) {
    if (typeof settings[field] !== 'boolean') return `${field} must be true or false.`;
  }
  if (!settings.companyName.trim()) return 'Company name is required.';
  if (settings.companyName.length > 120 || settings.companyAddress.length > 2000) {
    return 'Company name or address is too long.';
  }
  if (settings.googleClientId.length > 255 || (settings.googleClientId && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(settings.googleClientId))) {
    return 'Enter a valid Google OAuth Web Client ID.';
  }
  if (!/^[A-Z]{3}$/.test(settings.currency)) return 'Currency must be a 3-letter ISO code.';
  if (!Number.isInteger(settings.approvalLevels) || settings.approvalLevels < 1 || settings.approvalLevels > 5) {
    return 'Approval levels must be between 1 and 5.';
  }
  if (!['admin', 'approver', 'finance_officer'].includes(settings.defaultApproverRole)) {
    return 'Choose a valid default approver role.';
  }
  if (settings.apEscalationAfterHours < 1 || settings.apEscalationRepeatHours < 1) {
    return 'AP escalation intervals must be at least one hour.';
  }
  if (numberFields.some((field) => field.startsWith('sla') && (settings[field] < 1 || settings[field] > 720))) {
    return 'SLA targets must be between 1 and 720 hours.';
  }
  for (const field of ['primaryColor', 'accentColor']) {
    if (!/^#[0-9a-f]{6}$/i.test(settings[field])) return `${field} must be a valid hex color.`;
  }
  if (settings.logoUrl) {
    try {
      const logoUrl = new URL(settings.logoUrl);
      if (!['http:', 'https:'].includes(logoUrl.protocol)) return 'Logo URL must use HTTP or HTTPS.';
    } catch {
      return 'Logo URL must be a valid URL.';
    }
  }
  for (const field of ['companyEmail', 'apEscalationEmail']) {
    if (settings[field] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings[field])) {
      return `${field} must be a valid email address.`;
    }
  }
  return null;
}

router.get('/', (req, res, next) => {
  try {
    res.json(readSettings());
  } catch (error) {
    next(error);
  }
});

router.put('/', requireRole('admin'), (req, res, next) => {
  try {
    const settings = req.body?.settings;
    const validationError = validateSettings(settings);
    if (validationError) return res.status(400).json({ error: validationError });

    const db = getDb();
    const previous = readSettings();
    db.prepare(
      `INSERT INTO workspace_settings (id, settings, updated_at)
       VALUES ('workspace', ?, datetime('now'))
       ON CONFLICT (id) DO UPDATE SET settings = excluded.settings, updated_at = datetime('now')`,
    ).run(JSON.stringify(settings));
    audit(req.user.id, 'UPDATE', 'workspace_settings', 'workspace', 'SUCCESS', null, {
      changed_fields: Object.keys(settings).filter((key) => settings[key] !== previous[key]),
    });
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

export const settingsRouter = router;
