import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArchiveRestore,
  CircleAlert,
  Loader2,
  Trash2,
} from 'lucide-react';
import { StackedActivityChart } from '@/components/charts';
import {
  Banner,
  EmptyState,
  ErrorState,
  InlineError,
  LoadingState,
  MiniStat,
  PageTitle,
  PanelHeader,
  SegmentedTabs,
  StatStrip,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import type { DeletedActivityPoint, DeletedRecord } from '@/lib/types';

type DeletedProps = {
  onRestored: () => void;
};

type Range = '7' | '14' | '30';

const rangeOptions: { value: Range; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
];

type DeletedPayload = {
  records: DeletedRecord[];
  totals: { deleted: number; restored: number; pending: number };
};

export function DeletedRecordsView({ onRestored }: DeletedProps) {
  const [records, setRecords] = useState<DeletedRecord[]>([]);
  const [totals, setTotals] = useState({ deleted: 0, restored: 0, pending: 0 });
  const [activity, setActivity] = useState<DeletedActivityPoint[]>([]);
  const [range, setRange] = useState<Range>('30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.get<DeletedPayload>('/api/deleted');
      setRecords(payload.records);
      setTotals(payload.totals);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load the deleted record register.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadActivity = useCallback(async (days: Range) => {
    try {
      setActivity(await api.get<DeletedActivityPoint[]>(`/api/deleted/activity?days=${days}`));
    } catch {
      setActivity([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadActivity(range);
  }, [loadActivity, range]);

  const restore = async (record: DeletedRecord) => {
    setBusyId(record.audit_id);
    setError(null);
    setMessage(null);
    try {
      await api.post('/api/deleted/restore', { entity_type: record.entity_type, entity_id: record.entity_id });
      setMessage(`${record.label || 'Record'} restored successfully.`);
      await load();
      onRestored();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not restore this record.');
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (record: DeletedRecord) => {
    if (!window.confirm(`Permanently remove the deletion entry for ${record.label || record.entity_id}? This cannot be undone.`)) return;
    setBusyId(record.audit_id);
    setError(null);
    setMessage(null);
    try {
      await api.del(`/api/deleted/${encodeURIComponent(record.audit_id)}`);
      setMessage('Deletion entry permanently removed.');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not remove this deletion entry.');
    } finally {
      setBusyId(null);
    }
  };

  const restorableCount = useMemo(() => records.filter((record) => record.restorable).length, [records]);

  return (
    <div className="fade-in deleted-view">
      <PageTitle
        eyebrow="Administration · Audit"
        title="Deleted Records"
        copy="View and restore deleted records from every module in the workspace."
      />

      {error && <InlineError message={error} onRetry={() => void load()} />}
      {message && (
        <div className="settings-success" role="status">
          {message}
        </div>
      )}

      <StatStrip className="deleted-stats">
        <MiniStat label="Total deletions" value={totals.deleted.toLocaleString()} tone="blue" />
        <MiniStat label="Restorable" value={restorableCount.toLocaleString()} tone="teal" />
        <MiniStat label="Restored" value={totals.restored.toLocaleString()} tone="gray" />
        <MiniStat label="Pending restore" value={totals.pending.toLocaleString()} tone="amber" />
      </StatStrip>

      {totals.pending > 0 && (
        <Banner tone="info" title="Deleted records are recoverable">
          {totals.pending} deletion{totals.pending === 1 ? '' : 's'} still hold a restorable snapshot. Restoring re-inserts the original record with its
          identifiers intact.
        </Banner>
      )}

      <section className="panel dashboard-panel">
        <div className="warranty-report-panel-heading">
          <div>
            <h2>Delete &amp; restore activity</h2>
            <p>Deletions and restores recorded in the workspace audit log.</p>
          </div>
          <SegmentedTabs value={range} onChange={setRange} options={rangeOptions} ariaLabel="Activity period" />
        </div>
        <div className="dashboard-chart-body">
          {loading ? <LoadingState label="Loading deleted records" /> : <StackedActivityChart data={activity} height={210} />}
        </div>
      </section>

      <section className="panel table-panel full-panel deleted-panel">
        <PanelHeader title="Deletion history" subtitle="Successful deletions recorded in the audit log" />
        {loading ? (
          <LoadingState label="Loading deleted records" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Record type</th>
                  <th>Record</th>
                  <th>Deleted by</th>
                  <th>Deleted</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.audit_id}>
                    <td>{record.entity_type.replace(/_/g, ' ')}</td>
                    <td>
                      <strong>{record.label || record.entity_id}</strong>
                      {record.detail && <span className="muted-cell">{record.detail}</span>}
                    </td>
                    <td>{record.deleted_by || 'Former user'}</td>
                    <td title={formatDateTime(record.deleted_at)}>{formatRelativeTime(record.deleted_at)}</td>
                    <td>
                      <StatusBadge status={record.restored ? 'RESTORED' : record.restorable ? 'RESTORABLE' : 'NOT_RESTORABLE'} />
                    </td>
                    <td>
                      <div className="employee-assignment-actions">
                        {record.restorable && (
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={busyId === record.audit_id}
                            onClick={() => void restore(record)}
                          >
                            {busyId === record.audit_id ? <Loader2 size={13} className="spin" /> : <ArchiveRestore size={13} />} Restore
                          </button>
                        )}
                        <button
                          type="button"
                          className="button employee-assignment-delete"
                          disabled={busyId === record.audit_id}
                          onClick={() => void purge(record)}
                          aria-label={`Permanently remove the deletion entry for ${record.label || record.entity_id}`}
                        >
                          <Trash2 size={13} /> Purge
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length === 0 && <EmptyState text="No deletion events are present in the audit history." />}
          </div>
        )}
        <p className="table-footnote">
          <CircleAlert size={14} /> Purging removes the audit entry only. It does not delete the restored record.
        </p>
      </section>
    </div>
  );
}
