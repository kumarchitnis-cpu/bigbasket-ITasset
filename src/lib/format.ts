import type { Asset, WarrantyStatus } from '@/lib/types';

export const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const compactMoney = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });

export const WARRANTY_HORIZON_DAYS = 90;
export const WARRANTY_CRITICAL_DAYS = 30;

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

export function formatRelativeTime(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const diff = Date.now() - parsed.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30.4375);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export function initials(value: string) {
  return value
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function roleLabel(role: string) {
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function statusLabel(status: string) {
  return status
    .split('_')
    .join(' ')
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function formatActivity(value: string) {
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatInvoiceAmount(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || 'INR'} ${amount.toLocaleString('en-IN')}`;
  }
}

export function daysUntil(value: string | null | undefined, reference = new Date()) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const start = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  const end = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  return Math.round((end - start) / 86400000);
}

export function warrantyStatus(
  asset: Pick<Asset, 'warranty_end'>,
  reference = new Date(),
  horizonDays = WARRANTY_HORIZON_DAYS,
): WarrantyStatus {
  if (!asset.warranty_end) return 'UNKNOWN';
  const remaining = daysUntil(asset.warranty_end, reference);
  if (remaining === null) return 'UNKNOWN';
  if (remaining < 0) return 'EXPIRED';
  if (remaining <= horizonDays) return 'EXPIRING';
  return 'ACTIVE';
}

export function warrantyTone(status: WarrantyStatus) {
  if (status === 'ACTIVE') return 'COVERED';
  if (status === 'EXPIRING') return 'EXPIRING_SOON';
  return status;
}

export function csvCell(value: string | number | null | undefined) {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((row) => row.map((value) => csvCell(value)).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function makeDailySeries(
  values: string[],
  stored: { date: string; count: number }[] = [],
  days = 30,
) {
  const counts = new Map<string, number>();
  if (stored.length) {
    stored.forEach((item) => counts.set(item.date.slice(0, 10), item.count));
  } else {
    values.forEach((value) => {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        const key = value.slice(0, 10);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (days - 1 - index));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return {
      date: key,
      label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      value: counts.get(key) || 0,
    };
  });
}

export function groupCount<T>(items: T[], selector: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = selector(item) || 'Unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function uniqueSorted(values: (string | null | undefined)[]) {
  return [...new Set(values.map((value) => (value ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
