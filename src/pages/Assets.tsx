import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Box,
  ClipboardCheck,
  Cloud,
  Download,
  FileText,
  Loader2,
  Plus,
  Search,
  Upload,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { ApiError, api, type AppUser } from '@/lib/api';
import type { Asset, AssetEvent, AssetEventType } from '@/lib/types';
import { downloadCsv, formatDate, formatDateTime, money, statusLabel } from '@/lib/format';
import {
  Avatar,
  Banner,
  DetailCell,
  DetailGrid,
  EmptyState,
  FilterSelect,
  InlineError,
  MetricCard,
  MiniStat,
  Modal,
  PageTitle,
  PanelHeader,
  RecordLink,
  SegmentedTabs,
  StatStrip,
  StatusBadge,
} from '@/components/ui';
import { ChartLegend, DonutChart } from '@/components/charts';
import { WarrantyLookupLink } from '@/components/warranty';

type AssetCategory = 'Server' | 'Laptop' | 'All';

const assetStatuses: Asset['status'][] = ['AVAILABLE', 'ASSIGNED', 'UNDER_MAINTENANCE', 'QUARANTINED', 'RETIRED'];

const assetActionLabels: Record<AssetEventType, string> = {
  REGISTERED: 'Register',
  ASSIGNED: 'Assign',
  RETURNED: 'Return to inventory',
  TRANSFERRED: 'Transfer',
  MAINTENANCE_STARTED: 'Start maintenance',
  MAINTENANCE_COMPLETED: 'Complete maintenance',
  QUARANTINED: 'Quarantine',
  RETIRED: 'Retire',
  AUDITED: 'Record audit',
};

function assetEventLabel(eventType: string) {
  return assetActionLabels[eventType as AssetEventType] ?? eventType.split('_').map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' ');
}

function assetEventDescription(event: AssetEvent) {
  const changes: string[] = [];
  if (event.from_status !== event.to_status && event.to_status) {
    changes.push(`Status: ${event.from_status?.replace(/_/g, ' ').toLowerCase() ?? 'new'} → ${event.to_status.replace(/_/g, ' ').toLowerCase()}`);
  }
  if (event.from_custodian !== event.to_custodian && event.to_custodian) changes.push(`Custodian: ${event.to_custodian}`);
  if (event.location) changes.push(`Location: ${event.location}`);
  return changes.join(' · ') || 'Asset condition and audit record updated.';
}

async function downloadAssetImportTemplate() {
  const blob = await api.download('/api/assets/template');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'asset-import-template.xlsx';
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseGoogleSheetLink(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid Google Sheets link.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') {
    throw new Error('Use a Google Sheets link from docs.google.com.');
  }
  const match = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('The link does not contain a Google spreadsheet ID.');
  const gid = url.searchParams.get('gid') ?? new URLSearchParams(url.hash.slice(1)).get('gid');
  if (gid !== null && !/^\d+$/.test(gid)) throw new Error('The sheet tab ID in this link is invalid.');
  return { spreadsheetId: match[1], sheetId: gid === null ? undefined : Number(gid) };
}

async function loadGoogleIdentityServices() {
  if (window.google?.accounts.oauth2) return;
  const existingScript = document.getElementById('google-identity-services') as HTMLScriptElement | null;
  const script = existingScript ?? document.createElement('script');
  if (!existingScript) {
    script.id = 'google-identity-services';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanup();
      if (window.google?.accounts.oauth2) resolve();
      else reject(new Error('Google Identity Services did not initialize.'));
    };
    const onError = () => {
      cleanup();
      reject(new Error('Google Identity Services could not be loaded.'));
    };
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    if (!existingScript) document.head.appendChild(script);
  });
}

function requestGoogleSheetsAccessToken(clientId: string) {
  return new Promise<string>((resolve, reject) => {
    const oauth2 = window.google?.accounts.oauth2;
    if (!oauth2) {
      reject(new Error('Google authorization is not ready. Try again.'));
      return;
    }
    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google authorization failed.'));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: (error) => reject(new Error(error.message || 'Google authorization failed.')),
    });
    tokenClient.requestAccessToken();
  });
}

async function googleSheetsRequest<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message || `Google Sheets request failed (${response.status}).`);
  }
  return data as T;
}

function assetActionIcon(action: AssetEventType): LucideIcon {
  if (action === 'MAINTENANCE_STARTED' || action === 'MAINTENANCE_COMPLETED') return Wrench;
  if (action === 'AUDITED') return ClipboardCheck;
  return Activity;
}

function AssetTable({
  assets,
  onManage,
  onOpenWarranties,
}: {
  assets: Asset[];
  onManage?: (asset: Asset) => void;
  onOpenWarranties?: () => void;
}) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Category</th>
            <th>Custodian</th>
            <th>Location</th>
            <th>Cost</th>
            <th>Status</th>
            <th>Warranty</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr key={asset.id}>
              <td>
                <div className="asset-cell">
                  <div className={`asset-type-icon ${asset.category.toLowerCase().replace(' ', '-')}`}>
                    <Box size={16} />
                  </div>
                  <div>
                    {onManage ? (
                      <RecordLink onClick={() => onManage(asset)}>{asset.asset_tag}</RecordLink>
                    ) : (
                      <strong>{asset.asset_tag}</strong>
                    )}
                    <span>
                      {asset.manufacturer} {asset.model}
                    </span>
                  </div>
                </div>
              </td>
              <td>{asset.category}</td>
              <td>
                <div className="person-cell">
                  <Avatar name={asset.custodian} />
                  <span>{asset.custodian}</span>
                </div>
              </td>
              <td>{asset.location}</td>
              <td>{money.format(asset.purchase_cost)}</td>
              <td>
                <StatusBadge status={asset.status} />
              </td>
              <td>
                {onOpenWarranties ? (
                  <button className="warranty-date-link" onClick={onOpenWarranties}>
                    {asset.warranty_end ? formatDate(asset.warranty_end) : 'Not recorded'}
                  </button>
                ) : asset.warranty_end ? (
                  formatDate(asset.warranty_end)
                ) : (
                  '—'
                )}
              </td>
              <td>
                {onManage ? (
                  <button className="row-action" onClick={() => onManage(asset)}>
                    <Activity size={14} /> History
                  </button>
                ) : (
                  <button className="row-more" aria-label={`More options for ${asset.asset_tag}`}>
                    •••
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {assets.length === 0 && <EmptyState text="No assets match this search." />}
    </div>
  );
}

function AssetLifecycleDialog({
  asset,
  canManage,
  onClose,
  onSaved,
}: {
  asset: Asset;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [currentAsset, setCurrentAsset] = useState(asset);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [action, setAction] = useState<AssetEventType | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    custodian: '',
    location: '',
    issue: '',
    provider: '',
    priority: 'MEDIUM',
    condition: asset.condition,
    notes: '',
  });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      setEvents(await api.get<AssetEvent[]>(`/api/assets/${encodeURIComponent(asset.id)}/events`));
    } catch (err) {
      setEventsError(err instanceof ApiError ? err.message : 'Could not load this asset’s history.');
    } finally {
      setEventsLoading(false);
    }
  }, [asset.id]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const actions: AssetEventType[] =
    currentAsset.status === 'AVAILABLE'
      ? ['ASSIGNED', 'MAINTENANCE_STARTED', 'QUARANTINED', 'AUDITED', 'RETIRED']
      : currentAsset.status === 'ASSIGNED'
        ? ['TRANSFERRED', 'RETURNED', 'MAINTENANCE_STARTED', 'QUARANTINED', 'AUDITED', 'RETIRED']
        : currentAsset.status === 'UNDER_MAINTENANCE'
          ? ['MAINTENANCE_COMPLETED', 'QUARANTINED', 'AUDITED', 'RETIRED']
          : currentAsset.status === 'QUARANTINED'
            ? ['AUDITED', 'RETIRED']
            : ['AUDITED'];

  const beginAction = (nextAction: AssetEventType) => {
    setError(null);
    setForm({ custodian: '', location: currentAsset.location, issue: '', provider: '', priority: 'MEDIUM', condition: currentAsset.condition, notes: '' });
    setAction(nextAction);
  };

  const submitAction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action) return;
    setBusy(true);
    setError(null);
    const body: Record<string, string> = { event_type: action };
    if (action === 'ASSIGNED' || action === 'RETURNED' || action === 'TRANSFERRED') body.custodian = form.custodian;
    if (action === 'TRANSFERRED' && form.location.trim() !== currentAsset.location) body.location = form.location;
    if (action === 'MAINTENANCE_STARTED') {
      body.issue = form.issue;
      body.provider = form.provider;
      body.priority = form.priority;
    }
    if (action === 'AUDITED') body.condition = form.condition;
    if (['QUARANTINED', 'RETIRED', 'AUDITED', 'MAINTENANCE_COMPLETED'].includes(action)) body.notes = form.notes;
    try {
      const updated = await api.post<Asset>(`/api/assets/${encodeURIComponent(asset.id)}/events`, body);
      setCurrentAsset(updated);
      setAction(null);
      await loadEvents();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record this asset action. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={currentAsset.asset_tag} eyebrow="Asset lifecycle" subtitle={`${currentAsset.manufacturer} ${currentAsset.model}`} onClose={onClose} width="wide">
      <DetailGrid>
        <DetailCell label="Status">
          <StatusBadge status={currentAsset.status} />
        </DetailCell>
        <DetailCell label="Custodian">{currentAsset.custodian}</DetailCell>
        <DetailCell label="Location">{currentAsset.location}</DetailCell>
        <DetailCell label="Condition">{currentAsset.condition.toLowerCase()}</DetailCell>
        <DetailCell label="Purchase cost">{money.format(currentAsset.purchase_cost)}</DetailCell>
        <DetailCell label="Last audited">{currentAsset.last_audited_at ? formatDate(currentAsset.last_audited_at) : 'Not audited'}</DetailCell>
        <DetailCell label="Warranty start">{currentAsset.warranty_start ? formatDate(currentAsset.warranty_start) : 'Not recorded'}</DetailCell>
        <DetailCell label="Warranty end">{currentAsset.warranty_end ? formatDate(currentAsset.warranty_end) : 'Not recorded'}</DetailCell>
      </DetailGrid>

      <WarrantyLookupLink manufacturer={currentAsset.manufacturer} serialNumber={currentAsset.serial_number} />

      {canManage && (
        <section className="lifecycle-actions">
          <div className="lifecycle-section-heading">
            <div>
              <strong>Available actions</strong>
              <span>Changes are recorded in the asset history.</span>
            </div>
          </div>
          <div className="lifecycle-action-list">
            {actions.map((item) => {
              const Icon = assetActionIcon(item);
              return (
                <button key={item} type="button" className="button button-secondary" onClick={() => beginAction(item)} disabled={busy}>
                  <Icon size={15} /> {assetActionLabels[item]}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {action && (
        <form className="lifecycle-form" onSubmit={submitAction}>
          <div className="lifecycle-section-heading">
            <div>
              <strong>{assetActionLabels[action]}</strong>
              <span>Enter the details to record this lifecycle event.</span>
            </div>
          </div>
          {(action === 'ASSIGNED' || action === 'RETURNED' || action === 'TRANSFERRED') && (
            <label>
              {action === 'RETURNED' ? 'Received by' : action === 'TRANSFERRED' ? 'New custodian' : 'Assign to'}
              <input required value={form.custodian} onChange={(event) => update('custodian', event.target.value)} placeholder="Full name or team" />
            </label>
          )}
          {action === 'TRANSFERRED' && (
            <label>
              New location (optional)
              <input value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="Building / floor / site" />
            </label>
          )}
          {action === 'MAINTENANCE_STARTED' && (
            <>
              <label>
                Issue or work required
                <input required value={form.issue} onChange={(event) => update('issue', event.target.value)} placeholder="Describe the maintenance issue" />
              </label>
              <div className="form-grid">
                <label>
                  Provider
                  <input value={form.provider} onChange={(event) => update('provider', event.target.value)} placeholder="In-house" />
                </label>
                <label>
                  Priority
                  <select value={form.priority} onChange={(event) => update('priority', event.target.value)}>
                    <option>LOW</option>
                    <option>MEDIUM</option>
                    <option>HIGH</option>
                    <option>URGENT</option>
                  </select>
                </label>
              </div>
            </>
          )}
          {action === 'AUDITED' && (
            <label>
              Condition
              <select value={form.condition} onChange={(event) => update('condition', event.target.value)}>
                <option>NEW</option>
                <option>GOOD</option>
                <option>DAMAGED</option>
              </select>
            </label>
          )}
          {['QUARANTINED', 'RETIRED', 'AUDITED', 'MAINTENANCE_COMPLETED'].includes(action) && (
            <label>
              {action === 'AUDITED' ? 'Audit notes' : action === 'MAINTENANCE_COMPLETED' ? 'Completion notes (optional)' : 'Reason'}
              <textarea
                required={action !== 'MAINTENANCE_COMPLETED'}
                value={form.notes}
                onChange={(event) => update('notes', event.target.value)}
                placeholder={action === 'MAINTENANCE_COMPLETED' ? 'Add repair notes if needed' : 'Add a concise reason for the record'}
              />
            </label>
          )}
          {error && <InlineError message={error} />}
          <div className="modal-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setAction(null);
                setError(null);
              }}
            >
              Cancel
            </button>
            <button className="button button-primary" disabled={busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <Activity size={16} />} {busy ? 'Saving...' : `Record ${assetActionLabels[action].toLowerCase()}`}
            </button>
          </div>
        </form>
      )}

      <section className="asset-history">
        <div className="lifecycle-section-heading">
          <div>
            <strong>Lifecycle history</strong>
            <span>Recorded asset actions, assignments, and audit checks.</span>
          </div>
        </div>
        {eventsLoading ? (
          <div className="history-state">
            <Loader2 size={17} className="spin" /> Loading history
          </div>
        ) : eventsError ? (
          <div className="history-error">
            <span>{eventsError}</span>
            <button className="text-button" onClick={() => void loadEvents()}>
              Retry
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="history-state">No lifecycle events recorded.</div>
        ) : (
          <ol className="asset-event-list">
            {events.map((item) => (
              <li key={item.id}>
                <span className="event-marker">
                  <Activity size={13} />
                </span>
                <div className="event-copy">
                  <strong>{assetEventLabel(item.event_type)}</strong>
                  <span>{assetEventDescription(item)}</span>
                  {item.notes && <p>{item.notes}</p>}
                  <small>
                    {item.actor_name} · {formatDateTime(item.created_at)}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </Modal>
  );
}

export function AssetImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  const downloadTemplate = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadAssetImportTemplate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not download the asset template.');
    } finally {
      setDownloading(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setRefreshError(null);
    try {
      const result = await api.upload<{ imported: number }>('/api/assets/import', file);
      setImported(result.imported);
      try {
        await onSaved();
      } catch (refreshFailure) {
        setRefreshError(refreshFailure instanceof ApiError ? refreshFailure.message : 'The assets were imported, but the register could not be refreshed.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not import the asset spreadsheet.');
    } finally {
      setBusy(false);
    }
  };

  const retryRefresh = async () => {
    setBusy(true);
    setRefreshError(null);
    try {
      await onSaved();
    } catch (err) {
      setRefreshError(err instanceof ApiError ? err.message : 'Could not refresh the Asset Register.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Upload assets from Excel" eyebrow="Asset register" onClose={onClose} busy={busy} width="wide">
      <form onSubmit={submit}>
        <p className="import-help">
          Download the template, fill in one asset per row, then upload the completed .xlsx file. Asset Tag, Category, Manufacturer, Model, Serial Number, Custodian, Location, and Department are required. New assets
          are added as Available and in New condition. The whole file is validated before anything is imported.
        </p>
        <button type="button" className="button button-secondary template-download" onClick={() => void downloadTemplate()} disabled={downloading || busy}>
          <Download size={16} />
          {downloading ? 'Preparing template...' : 'Download Template'}
        </button>
        {imported === null && (
          <label className="import-file-label">
            Excel workbook (.xlsx)
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError(null);
              }}
            />
          </label>
        )}
      {error && <InlineError message={error} />}
      {imported !== null && (
        <div className="import-success" role="status">
          Successfully imported {imported} {imported === 1 ? 'asset' : 'assets'}.
        </div>
      )}
      {refreshError && (
        <div className="auth-message import-error" role="alert">
          Import succeeded, but the Asset Register could not be refreshed: {refreshError}
          <button type="button" className="text-button" onClick={() => void retryRefresh()} disabled={busy}>
            Retry refresh
          </button>
        </div>
      )}
      <div className="modal-actions">
        {imported !== null ? (
          <button type="button" className="button button-primary" onClick={onClose} disabled={busy}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="button button-primary" disabled={!file || busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} {busy ? 'Uploading...' : 'Upload'}
            </button>
          </>
        )}
      </div>
      </form>
    </Modal>
  );
}

export function AssetModal({ userName, department, onClose, onSaved }: { userName: string; department: string; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    asset_tag: '',
    category: 'Laptop',
    manufacturer: '',
    model: '',
    serial_number: '',
    custodian: userName,
    location: '',
    department,
    purchase_cost: '',
    warranty_start: '',
    warranty_end: '',
  });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/assets', {
        ...form,
        purchase_cost: Number(form.purchase_cost),
        warranty_start: form.warranty_start || null,
        warranty_end: form.warranty_end || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the asset. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add new asset" eyebrow="Asset register" onClose={onClose} busy={saving} width="wide">
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Asset tag
            <input required value={form.asset_tag} onChange={(event) => update('asset_tag', event.target.value)} placeholder="IT-LAP-0007" />
          </label>
          <label>
            Category
            <select value={form.category} onChange={(event) => update('category', event.target.value)}>
              <option>Laptop</option>
              <option>Monitor</option>
              <option>Mobile</option>
              <option>Network device</option>
              <option>Server</option>
            </select>
          </label>
          <label>
            Manufacturer
            <input required value={form.manufacturer} onChange={(event) => update('manufacturer', event.target.value)} placeholder="Dell" />
          </label>
          <label>
            Model
            <input required value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="Latitude 7450" />
          </label>
          <label>
            Serial number
            <input required value={form.serial_number} onChange={(event) => update('serial_number', event.target.value)} placeholder="SN-000000" />
          </label>
          <label>
            Department
            <input required value={form.department} onChange={(event) => update('department', event.target.value)} placeholder="Engineering" />
          </label>
          <label>
            Custodian
            <input required value={form.custodian} onChange={(event) => update('custodian', event.target.value)} placeholder="Asset custodian" />
          </label>
          <label>
            Location
            <input required value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="HQ / Floor 1" />
          </label>
          <label>
            Purchase cost
            <input required type="number" min="0" value={form.purchase_cost} onChange={(event) => update('purchase_cost', event.target.value)} placeholder="0" />
          </label>
          <label>
            Warranty start
            <input type="date" max={form.warranty_end || undefined} value={form.warranty_start} onChange={(event) => update('warranty_start', event.target.value)} />
          </label>
          <label>
            Warranty end
            <input type="date" min={form.warranty_start || undefined} value={form.warranty_end} onChange={(event) => update('warranty_end', event.target.value)} />
          </label>
        </div>
        <div className="warranty-lookup-form-row">
          <span className="warranty-lookup-label">Manufacturer warranty lookup</span>
          <WarrantyLookupLink manufacturer={form.manufacturer} serialNumber={form.serial_number} />
        </div>
        {error && <InlineError message={error} />}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} {saving ? 'Saving...' : 'Add asset'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type GoogleSheetTab = { sheetId: number; title: string };
type GoogleSheetDuplicate = {
  rowNumber: number;
  assetTag: string;
  serialNumber: string;
  model: string;
  reasons: string[];
};
type GoogleSheetAnalysis = {
  total: number;
  duplicateCount: number;
  importable: number;
  duplicates: GoogleSheetDuplicate[];
};
type GoogleSheetImportResult = {
  imported: number;
  skipped: number;
  duplicates: GoogleSheetDuplicate[];
};

function GoogleSheetsImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [sheetUrl, setSheetUrl] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [configuring, setConfiguring] = useState(true);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [stage, setStage] = useState<'link' | 'sheets' | 'review'>('link');
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const [sheets, setSheets] = useState<GoogleSheetTab[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<number | null>(null);
  const [sheetValues, setSheetValues] = useState<unknown[][] | null>(null);
  const [analysis, setAnalysis] = useState<GoogleSheetAnalysis | null>(null);
  const [imported, setImported] = useState<GoogleSheetImportResult | null>(null);

  useEffect(() => {
    let active = true;
    const configure = async () => {
      try {
        const config = await api.get<{ configured: boolean; clientId: string }>('/api/auth/google-config');
        if (!config.clientId) throw new Error('Google OAuth is not configured. Ask an administrator to configure it in Settings.');
        await loadGoogleIdentityServices();
        if (active) setGoogleClientId(config.clientId);
      } catch (err) {
        if (active) setConfigurationError(err instanceof Error ? err.message : 'Google Sheets authorization could not be initialized.');
      } finally {
        if (active) setConfiguring(false);
      }
    };
    void configure();
    return () => {
      active = false;
    };
  }, []);

  const downloadTemplate = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadAssetImportTemplate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not download the asset template.');
    } finally {
      setDownloading(false);
    }
  };

  const findSheets = async () => {
    let sheetLink: ReturnType<typeof parseGoogleSheetLink>;
    try {
      sheetLink = parseGoogleSheetLink(sheetUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enter a valid Google Sheets link.');
      return;
    }

    setBusy(true);
    setError(null);
    setRefreshError(null);
    try {
      const accessToken = await requestGoogleSheetsAccessToken(googleClientId);
      const metadataUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sheetLink.spreadsheetId}`);
      metadataUrl.searchParams.set('fields', 'sheets.properties(sheetId,title)');
      const spreadsheet = await googleSheetsRequest<{
        sheets?: { properties?: { sheetId: number; title: string } }[];
      }>(metadataUrl.toString(), accessToken);
      const availableSheets = (spreadsheet.sheets ?? []).flatMap(({ properties }) => (
        properties && Number.isInteger(properties.sheetId) && properties.title
          ? [{ sheetId: properties.sheetId, title: properties.title }]
          : []
      ));
      if (!availableSheets.length) throw new Error('No readable sheet tabs were found in this spreadsheet.');
      if (sheetLink.sheetId !== undefined && !availableSheets.some(({ sheetId }) => sheetId === sheetLink.sheetId)) {
        throw new Error('The sheet tab from this link could not be found.');
      }

      setSpreadsheetId(sheetLink.spreadsheetId);
      setSheets(availableSheets);
      setSelectedSheetId(
        sheetLink.sheetId ?? (availableSheets.length === 1 ? availableSheets[0].sheetId : null),
      );
      setSheetValues(null);
      setAnalysis(null);
      setStage('sheets');
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not read the Google spreadsheet.');
    } finally {
      setBusy(false);
    }
  };

  const analyzeSelectedSheet = async () => {
    const selectedSheet = sheets.find(({ sheetId }) => sheetId === selectedSheetId);
    if (!spreadsheetId || !selectedSheet) {
      setError('Select a sheet tab to analyze.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const accessToken = await requestGoogleSheetsAccessToken(googleClientId);
      const range = `'${selectedSheet.title.replace(/'/g, "''")}'!A1:Z1002`;
      const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
      const sheetData = await googleSheetsRequest<{ values?: unknown[][] }>(valuesUrl, accessToken);
      if (!sheetData.values?.length) throw new Error('The selected Google Sheets tab is empty.');

      const result = await api.post<GoogleSheetAnalysis>('/api/assets/import/google-sheets/analyze', { values: sheetData.values });
      setSheetValues(sheetData.values);
      setAnalysis(result);
      setStage('review');
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not analyze the selected sheet.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stage === 'link') void findSheets();
    else if (stage === 'sheets') void analyzeSelectedSheet();
  };

  const importSheet = async () => {
    if (!sheetValues || !analysis) return;
    setBusy(true);
    setError(null);
    setRefreshError(null);
    try {
      const result = await api.post<GoogleSheetImportResult>('/api/assets/import/google-sheets', { values: sheetValues });
      setImported(result);
      try {
        await onSaved();
      } catch (refreshFailure) {
        setRefreshError(refreshFailure instanceof ApiError ? refreshFailure.message : 'The assets were imported, but the register could not be refreshed.');
      }
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not import the Google Sheet.');
    } finally {
      setBusy(false);
    }
  };

  const retryRefresh = async () => {
    setBusy(true);
    setRefreshError(null);
    try {
      await onSaved();
    } catch (err) {
      setRefreshError(err instanceof ApiError ? err.message : 'Could not refresh the Asset Register.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={stage === 'review' ? 'Review Google Sheet' : 'Import assets from Google Sheets'}
      eyebrow="Asset register"
      onClose={onClose}
      busy={busy}
      width="wide"
    >
      <form onSubmit={submit}>
        <p className="import-help">
          {stage === 'link'
            ? 'Paste a Google Sheets link. We’ll inspect its tabs and check the selected tab for duplicate assets before import.'
            : stage === 'sheets'
              ? `Found ${sheets.length} ${sheets.length === 1 ? 'sheet tab' : 'sheet tabs'}. Select which tab to analyze and upload.`
              : `Analysis complete for “${sheets.find(({ sheetId }) => sheetId === selectedSheetId)?.title ?? ''}”. Review duplicate rows before importing.`}
        </p>
        {stage !== 'review' && (
          <button type="button" className="button button-secondary template-download" onClick={() => void downloadTemplate()} disabled={downloading || busy}>
            <Download size={16} />
            {downloading ? 'Preparing template...' : 'Download Template'}
          </button>
        )}
        {stage === 'link' && (
          <label className="import-file-label">
            Google Sheets link
            <input
              type="url"
              required
              value={sheetUrl}
              disabled={busy || imported !== null}
              onChange={(event) => {
                setSheetUrl(event.target.value);
                setError(null);
              }}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </label>
        )}
        {stage === 'sheets' && (
          <label className="import-file-label">
            Sheet tab to upload
            <select
              required
              value={selectedSheetId ?? ''}
              disabled={busy}
              onChange={(event) => setSelectedSheetId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="" disabled>Select a sheet tab</option>
              {sheets.map((sheet) => <option key={sheet.sheetId} value={sheet.sheetId}>{sheet.title}</option>)}
            </select>
          </label>
        )}
        {configuring && <p className="import-help">Preparing Google authorization…</p>}
        {configurationError && <InlineError message={configurationError} />}
        {error && <InlineError message={error} />}
        {stage === 'review' && analysis && (
          <section className="google-sheet-review" aria-live="polite">
            <div className="google-sheet-review-summary">
              <strong>{analysis.importable} ready to import</strong>
              <span>{analysis.duplicateCount} duplicate {analysis.duplicateCount === 1 ? 'row' : 'rows'} will be skipped · {analysis.total} total rows</span>
            </div>
            {analysis.duplicates.length ? (
              <div className="google-sheet-duplicates">
                <h3>Duplicate data found</h3>
                <div className="google-sheet-duplicate-table">
                  <table className="data-table">
                    <thead>
                      <tr><th>Sheet row</th><th>Asset Tag</th><th>Serial Number</th><th>Model</th><th>Duplicate reason</th></tr>
                    </thead>
                    <tbody>
                      {analysis.duplicates.map((duplicate) => (
                        <tr key={duplicate.rowNumber}>
                          <td>{duplicate.rowNumber}</td>
                          <td><strong>{duplicate.assetTag}</strong></td>
                          <td>{duplicate.serialNumber}</td>
                          <td>{duplicate.model}</td>
                          <td>{duplicate.reasons.join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="import-success">No duplicate rows found. All {analysis.total} rows are ready to import.</div>
            )}
          </section>
        )}
        {imported && (
          <div className="import-success" role="status">
            Imported {imported.imported} {imported.imported === 1 ? 'asset' : 'assets'}; skipped {imported.skipped} duplicate {imported.skipped === 1 ? 'row' : 'rows'}.
          </div>
        )}
        {refreshError && (
          <div className="auth-message import-error" role="alert">
            Import succeeded, but the Asset Register could not be refreshed: {refreshError}
            <button type="button" className="text-button" onClick={() => void retryRefresh()} disabled={busy}>Retry refresh</button>
          </div>
        )}
        <div className="modal-actions">
          {imported ? (
            <button type="button" className="button button-primary" onClick={onClose} disabled={busy}>Done</button>
          ) : stage === 'link' ? (
            <>
              <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button>
              <button className="button button-primary" disabled={!sheetUrl || !googleClientId || configuring || busy}>
                {busy ? <Loader2 size={16} className="spin" /> : <FileText size={16} />} {busy ? 'Checking sheets...' : 'Import Google Sheet'}
              </button>
            </>
          ) : stage === 'sheets' ? (
            <>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => {
                setStage('link');
                setSheets([]);
                setSelectedSheetId(null);
              }}>Change link</button>
              <button className="button button-primary" disabled={selectedSheetId === null || busy}>
                {busy ? <Loader2 size={16} className="spin" /> : <FileText size={16} />} {busy ? 'Analyzing sheet...' : 'Analyze selected sheet'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button button-secondary" disabled={busy || imported !== null} onClick={() => {
                setStage('sheets');
                setAnalysis(null);
                setSheetValues(null);
                setError(null);
              }}>Back to sheet selection</button>
              <button type="button" className="button button-primary" disabled={!analysis?.importable || busy || imported !== null} onClick={() => void importSheet()}>
                {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} {busy ? 'Importing...' : `Import ${analysis?.importable ?? 0} non-duplicate assets`}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

export function AssetsView({
  assets,
  user,
  query,
  openAssetId,
  onAssetOpened,
  onAdd,
  onRefresh,
  onImportComplete,
  onOpenWarranties,
}: {
  assets: Asset[];
  user: AppUser;
  query: string;
  openAssetId: string | null;
  onAssetOpened: () => void;
  onAdd: () => void;
  onRefresh: () => void;
  onImportComplete: () => Promise<void>;
  onOpenWarranties: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<'ALL' | Asset['status']>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<AssetCategory>('All');
  const [custodianFilter, setCustodianFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [uploadMode, setUploadMode] = useState<'options' | 'excel' | 'sheets' | null>(null);
  const canManage = user.role === 'admin' || user.role === 'it_asset_manager';

  useEffect(() => {
    if (!openAssetId) return;
    const asset = assets.find((item) => item.id === openAssetId);
    if (asset) {
      setSelectedAsset(asset);
      onAssetOpened();
    }
  }, [assets, onAssetOpened, openAssetId]);

  const categories = useMemo(() => [...new Set(assets.map((asset) => asset.category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [assets]);
  const custodians = useMemo(() => [...new Set(assets.map((asset) => asset.custodian.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [assets]);
  const locations = useMemo(() => [...new Set(assets.map((asset) => asset.location.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [assets]);

  const visibleAssets = assets.filter((asset) => {
    const term = query.trim().toLowerCase();
    const matchesQuery = !term || [asset.asset_tag, asset.category, asset.manufacturer, asset.model, asset.serial_number, asset.custodian, asset.location, asset.department].some((value) => value.toLowerCase().includes(term));
    const matchesCategory = categoryFilter === 'All' || asset.category === categoryFilter;
    return (
      matchesQuery &&
      matchesCategory &&
      (custodianFilter === 'ALL' || asset.custodian === custodianFilter) &&
      (locationFilter === 'ALL' || asset.location === locationFilter) &&
      (statusFilter === 'ALL' || asset.status === statusFilter)
    );
  });

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of assets) counts.set(asset.status, (counts.get(asset.status) ?? 0) + 1);
    return counts;
  }, [assets]);

  const categoryBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of assets) counts.set(asset.category, (counts.get(asset.category) ?? 0) + 1);
    return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [assets]);

  const totalValue = visibleAssets.reduce((sum, asset) => sum + Number(asset.purchase_cost || 0), 0);

  const downloadReport = () => {
    downloadCsv('asset-register-report.csv', [
      ['Asset Tag', 'Category', 'Manufacturer', 'Model', 'Serial Number', 'Status', 'Condition', 'Custodian', 'Location', 'Department', 'Purchase Cost', 'Warranty Start', 'Warranty End'],
      ...visibleAssets.map((asset) => [
        asset.asset_tag,
        asset.category,
        asset.manufacturer,
        asset.model,
        asset.serial_number,
        asset.status,
        asset.condition,
        asset.custodian,
        asset.location,
        asset.department,
        asset.purchase_cost,
        asset.warranty_start ?? '',
        asset.warranty_end ?? '',
      ]),
    ]);
  };

  return (
    <div className="fade-in">
      <PageTitle eyebrow="Asset lifecycle / Register" title="Asset register" copy="Every device, assignment, and lifecycle event in one place.">
        <button className="button button-secondary" onClick={downloadReport}>
          <Download size={16} /> Download Report
        </button>
        <button className="button button-secondary" onClick={onOpenWarranties}>
          <BadgeCheck size={16} /> Warranty report
        </button>
        {canManage && (
          <>
            <button className="button button-secondary" onClick={() => setUploadMode('options')}>
              <Upload size={16} /> Upload Data
            </button>
            <button className="button button-primary" onClick={onAdd}>
              <Plus size={17} /> Add asset
            </button>
          </>
        )}
      </PageTitle>

      <StatStrip>
        <MiniStat label="Total assets" value={assets.length.toString()} tone="blue" />
        <MiniStat label="Available" value={(statusCounts.get('AVAILABLE') ?? 0).toString()} tone="teal" />
        <MiniStat label="Assigned" value={(statusCounts.get('ASSIGNED') ?? 0).toString()} tone="amber" />
        <MiniStat label="In maintenance" value={(statusCounts.get('UNDER_MAINTENANCE') ?? 0).toString()} tone="red" />
        <MiniStat label="Register value" value={money.format(totalValue)} tone="blue" />
      </StatStrip>

      {query && (
        <div className="filter-note">
          <Search size={14} /> Showing matches for “{query}”
        </div>
      )}

      <SegmentedTabs
        ariaLabel="Filter assets by lifecycle status"
        value={statusFilter}
        onChange={setStatusFilter}
        options={[
          { value: 'ALL', label: `All (${assets.length})` },
          ...assetStatuses.map((status) => ({ value: status, label: `${statusLabel(status)} (${statusCounts.get(status) ?? 0})` })),
        ]}
      />

      <div className="asset-filter-toolbar invoice-toolbar">
        <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter}>
          <option value="All">All categories</option>
          <option value="Server">Server Assets</option>
          <option value="Laptop">Laptop Assets</option>
          {categories.filter(c => c !== 'Server' && c !== 'Laptop').map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Custodian" value={custodianFilter} onChange={setCustodianFilter}>
          <option value="ALL">All custodians</option>
          {custodians.map((custodian) => (
            <option key={custodian} value={custodian}>
              {custodian}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Location" value={locationFilter} onChange={setLocationFilter}>
          <option value="ALL">All locations</option>
          {locations.map((location) => (
            <option key={location} value={location}>
              {location}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div className="dashboard-reference-grid dashboard-chart-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Category mix" subtitle="Registered assets by category" />
          <div className="dashboard-chart-body dashboard-chart-split">
            <DonutChart data={categoryBreakdown} centerValue={assets.length.toString()} centerLabel="assets" emptyLabel="No assets registered yet." />
            <ChartLegend data={categoryBreakdown} />
          </div>
        </section>
        <section className="panel dashboard-panel">
          <PanelHeader title="Lifecycle readiness" subtitle="Operational exposure across the register" />
          <div className="metric-grid">
            <MetricCard label="Available to deploy" value={(statusCounts.get('AVAILABLE') ?? 0).toString()} note="Ready for a new custodian" tone="teal" icon={Box} />
            <MetricCard label="Assigned in use" value={(statusCounts.get('ASSIGNED') ?? 0).toString()} note="Currently with employees" tone="blue" icon={Activity} />
            <MetricCard label="Needs attention" value={((statusCounts.get('UNDER_MAINTENANCE') ?? 0) + (statusCounts.get('QUARANTINED') ?? 0)).toString()} note="Maintenance or quarantine" tone="amber" icon={Wrench} />
          </div>
        </section>
      </div>

      {visibleAssets.length > 0 && visibleAssets.length < assets.length && (
        <Banner tone="info" title={`${visibleAssets.length} of ${assets.length} assets match the active filters.`} />
      )}

      <section className="panel table-panel full-panel">
        <PanelHeader title="Registered assets" subtitle={`${visibleAssets.length} assets · lifecycle actions are recorded to history`} />
        <AssetTable assets={visibleAssets} onManage={setSelectedAsset} onOpenWarranties={onOpenWarranties} />
      </section>

      {selectedAsset && <AssetLifecycleDialog asset={selectedAsset} canManage={canManage} onClose={() => setSelectedAsset(null)} onSaved={onRefresh} />}
      {uploadMode === 'options' && (
        <Modal title="Upload Data" eyebrow="Asset register" onClose={() => setUploadMode(null)}>
          <p className="import-help">Choose how you want to upload asset data.</p>
          <div className="modal-actions">
            <button type="button" className="button button-secondary" disabled title="Google Drive upload is not configured yet.">
              <Cloud size={16} /> Google Drive
            </button>
            <button type="button" className="button button-secondary" onClick={() => setUploadMode('sheets')}>
              <FileText size={16} /> Google Sheets
            </button>
            <button type="button" className="button button-primary" onClick={() => setUploadMode('excel')}>
              <Upload size={16} /> Upload via Excel
            </button>
          </div>
          <p className="import-help">Google Drive upload will be available after an administrator configures it.</p>
        </Modal>
      )}
      {uploadMode === 'excel' && (
        <AssetImportModal
          onClose={() => setUploadMode(null)}
          onSaved={async () => {
            setStatusFilter('ALL');
            setCategoryFilter('All');
            setCustodianFilter('ALL');
            setLocationFilter('ALL');
            await onImportComplete();
          }}
        />
      )}
      {uploadMode === 'sheets' && (
        <GoogleSheetsImportModal
          onClose={() => setUploadMode(null)}
          onSaved={async () => {
            setStatusFilter('ALL');
            setCategoryFilter('All');
            setCustodianFilter('ALL');
            setLocationFilter('ALL');
            await onImportComplete();
          }}
        />
      )}
    </div>
  );
}
