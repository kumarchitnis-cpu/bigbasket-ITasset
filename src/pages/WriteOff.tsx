import { useMemo, useState } from 'react';
import { Archive, Check, CircleAlert, Trash2 } from 'lucide-react';
import { ApiError, api, type AppUser } from '@/lib/api';
import type { Asset, WriteOffRequest } from '@/lib/types';
import { formatDate } from '@/lib/format';
import {
  Banner,
  EmptyState,
  InlineError,
  MiniStat,
  PageTitle,
  PanelHeader,
  SegmentedTabs,
  StatStrip,
  StatusBadge,
} from '@/components/ui';

export function WriteOffView({ assets, requests, user, onSaved }: { assets: Asset[]; requests: WriteOffRequest[]; user: AppUser; onSaved: () => void }) {
  const [assetId, setAssetId] = useState('');
  const [reason, setReason] = useState('');
  const [writeOffDate, setWriteOffDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'ALL' | WriteOffRequest['status']>('ALL');
  const canRequest = user.role === 'admin' || user.role === 'it_asset_manager';
  const canApprove = user.role === 'admin';

  const visibleRequests = useMemo(() => requests.filter((request) => tab === 'ALL' || request.status === tab), [requests, tab]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/workflows/write-offs', { asset_id: assetId, reason, write_off_date: writeOffDate });
      setAssetId('');
      setReason('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the write-off request.');
    } finally {
      setBusy(false);
    }
  };

  const review = async (request: WriteOffRequest, status: 'APPROVED' | 'REJECTED') => {
    setError(null);
    try {
      await api.put(`/api/workflows/write-offs/${encodeURIComponent(request.id)}/review`, { status });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not review the write-off request.');
    }
  };

  const removeRequest = async (request: WriteOffRequest) => {
    if (!window.confirm(`Delete the write-off request for ${request.asset_tag}? The asset stays in the register.`)) return;
    setError(null);
    try {
      await api.del(`/api/workflows/write-offs/${encodeURIComponent(request.id)}`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this write-off request.');
    }
  };

  const pendingCount = requests.filter((request) => request.status === 'PENDING_APPROVAL').length;
  const approvedValue = requests.filter((request) => request.status === 'APPROVED').length;

  return (
    <div className="fade-in">
      <PageTitle eyebrow="Asset lifecycle / Disposal" title="Write-Off" copy="Submit assets for disposal review; approved requests retire the asset with a permanent lifecycle record." />

      <StatStrip>
        <MiniStat label="Awaiting approval" value={pendingCount.toString()} tone="amber" />
        <MiniStat label="Approved" value={approvedValue.toString()} tone="teal" />
        <MiniStat label="Rejected" value={requests.filter((request) => request.status === 'REJECTED').length.toString()} tone="red" />
        <MiniStat label="Total requests" value={requests.length.toString()} tone="blue" />
      </StatStrip>

      {pendingCount > 0 && canApprove && <Banner tone="amber" title={`${pendingCount} write-off request${pendingCount === 1 ? '' : 's'} awaiting your approval`}>Approved requests retire the asset immediately and record the disposal date and approver.</Banner>}

      {canRequest && (
        <section className="panel module-form-panel">
          <PanelHeader title="Request an asset write-off" subtitle="Admin approval is required before an asset is retired." />
          <form className="writeoff-form" onSubmit={submit}>
            <label>
              Asset
              <select required value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                <option value="">Select an asset</option>
                {assets.filter((asset) => asset.status !== 'RETIRED').map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.asset_tag} · {asset.manufacturer} {asset.model}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Proposed write-off date
              <input type="date" value={writeOffDate} onChange={(event) => setWriteOffDate(event.target.value)} />
            </label>
            <label>
              Reason
              <textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain damage, end of life, loss, or other disposal reason" />
            </label>
            <button className="button button-primary" disabled={busy || !assetId}>
              {busy ? 'Submitting...' : 'Submit for approval'}
            </button>
          </form>
        </section>
      )}

      {error && <InlineError message={error} />}

      <SegmentedTabs
        ariaLabel="Filter write-off requests by status"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ALL', label: `All (${requests.length})` },
          { value: 'PENDING_APPROVAL', label: `Pending (${pendingCount})` },
          { value: 'APPROVED', label: `Approved (${approvedValue})` },
          { value: 'REJECTED', label: `Rejected (${requests.length - pendingCount - approvedValue})` },
        ]}
      />

      <section className="panel table-panel full-panel module-panel-gap">
        <PanelHeader title={canRequest ? 'Write-off approvals' : 'My write-off requests'} subtitle={canRequest ? 'All workspace requests; only admins can approve or reject' : 'Request status and reviewer notes'} />
        <div className="request-list">
          {visibleRequests.map((request) => (
            <div className="request-row employee-request-row" key={request.id}>
              <div className="request-icon">
                <Archive size={17} />
              </div>
              <div className="request-main">
                <strong>
                  {request.asset_tag} · {request.manufacturer} {request.model}
                </strong>
                <span>
                  {request.requester_name} · {formatDate(request.created_at)}
                  {request.write_off_date ? ` · Write-off date ${formatDate(request.write_off_date)}` : ''}
                </span>
                <small>
                  {request.reason}
                  {request.review_note ? ` · Review: ${request.review_note}` : ''}
                  {request.approved_by ? ` · Approved by ${request.approved_by}` : ''}
                </small>
              </div>
              <StatusBadge status={request.status} />
              {canApprove && request.status === 'PENDING_APPROVAL' && (
                <div className="request-review-actions">
                  <button className="icon-button approve-action" aria-label={`Approve write-off for ${request.asset_tag}`} onClick={() => void review(request, 'APPROVED')}>
                    <Check size={17} />
                  </button>
                  <button className="icon-button reject-action" aria-label={`Reject write-off for ${request.asset_tag}`} onClick={() => void review(request, 'REJECTED')}>
                    <CircleAlert size={17} />
                  </button>
                </div>
              )}
              {canApprove && request.status !== 'PENDING_APPROVAL' && (
                <button className="invoice-delete-button" aria-label={`Delete write-off request for ${request.asset_tag}`} onClick={() => void removeRequest(request)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
        {visibleRequests.length === 0 && <EmptyState text="No write-off requests yet." />}
      </section>
    </div>
  );
}
