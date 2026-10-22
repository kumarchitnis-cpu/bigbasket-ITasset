import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Box,
  ClipboardCheck,
  Download,
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
      const blob = await api.download('/api/assets/template');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'asset-import-template.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);
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
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [custodianFilter, setCustodianFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
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
    return (
      matchesQuery &&
      (categoryFilter === 'ALL' || asset.category === categoryFilter) &&
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
            <button className="button button-secondary" onClick={() => setUploadOpen(true)}>
              <Upload size={16} /> Upload Excel
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
          <option value="ALL">All categories</option>
          {categories.map((category) => (
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
      {uploadOpen && (
        <AssetImportModal
          onClose={() => setUploadOpen(false)}
          onSaved={async () => {
            setStatusFilter('ALL');
            setCategoryFilter('ALL');
            setCustodianFilter('ALL');
            setLocationFilter('ALL');
            await onImportComplete();
          }}
        />
      )}
    </div>
  );
}
