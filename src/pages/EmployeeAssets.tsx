import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Download,
  Loader2,
  Pencil,
  Plus,
  Search,
  Users,
  ArrowUpRight,
  X,
  XCircle,
} from 'lucide-react';
import { ApiError, api, type AppUser } from '@/lib/api';
import { Asset, EmployeeAssetAssignment, EmployeeAssetRequest } from '@/lib/types';
import { formatDate } from '@/lib/format';
import {
  EmptyState,
  MiniStat,
  PageTitle,
  PanelHeader,
  StatStrip,
  StatusBadge,
} from '@/components/ui';

export function EmployeeAssetsView(props: {
  requests: EmployeeAssetRequest[];
  assets: Asset[];
  user: AppUser;
  onSaved: () => void;
}): JSX.Element {
  const { requests, assets, user, onSaved } = props;
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<EmployeeAssetAssignment | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeAssetAssignment | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<EmployeeAssetAssignment | null>(null);
  const [assignments, setAssignments] = useState<EmployeeAssetAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const [assignmentActionError, setAssignmentActionError] = useState<string | null>(null);
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [assignmentBusy, setAssignmentBusy] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const canReview = user.role === 'admin' || user.role === 'it_asset_manager';
  const visibleAssignments = assignments.filter((assignment) =>
    [assignment.employee_name, assignment.employee_id, assignment.designation, assignment.department, assignment.asset_model, assignment.serial_number, assignment.remarks]
      .some((value) => value.toLowerCase().includes(assignmentSearch.trim().toLowerCase())),
  );
  const loadAssignments = useCallback(async () => {
    setAssignmentsLoading(true);
    setAssignmentsError(null);
    try {
      setAssignments(await api.get<EmployeeAssetAssignment[]>('/api/workflows/employee-assignments'));
    } catch (err) {
      setAssignmentsError(err instanceof ApiError ? err.message : 'Could not load employee asset assignments.');
    } finally {
      setAssignmentsLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);
  const review = async (request: EmployeeAssetRequest, status: 'APPROVED' | 'REJECTED') => {
    setReviewError(null);
    try {
      await api.put(`/api/workflows/employee-requests/${encodeURIComponent(request.id)}/review`, { status });
      onSaved();
    } catch (error) {
      setReviewError(error instanceof ApiError ? error.message : 'Could not review the asset request.');
    }
  };
  const downloadAssignments = async () => {
    setAssignmentActionError(null);
    try {
      const file = await api.download('/api/workflows/employee-assignments/export');
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'employee-asset-assignments.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAssignmentActionError(err instanceof ApiError ? err.message : 'Could not download the employee assignment spreadsheet.');
    }
  };
  const deleteAssignment = async (assignment: EmployeeAssetAssignment) => {
    if (!window.confirm(`Delete the asset assignment for ${assignment.employee_name} (${assignment.serial_number})?`)) return;
    setAssignmentBusy(assignment.id);
    setAssignmentActionError(null);
    try {
      await api.del(`/api/workflows/employee-assignments/${encodeURIComponent(assignment.id)}`);
      setAssignments((current) => current.filter((item) => item.id !== assignment.id));
    } catch (err) {
      setAssignmentActionError(err instanceof ApiError ? err.message : 'Could not delete this employee asset assignment.');
    } finally {
      setAssignmentBusy(null);
    }
  };

  const uniqueEmployees = useMemo(() => {
    const map = new Map<string, { name: string; id: string; designation: string; department: string; count: number; sample: EmployeeAssetAssignment }>();
    for (const a of assignments) {
      const key = a.employee_id || a.employee_name;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { name: a.employee_name, id: a.employee_id, designation: a.designation, department: a.department, count: 1, sample: a });
      }
    }
    return Array.from(map.values());
  }, [assignments]);

  const unassignedStock = assets.filter((a) => a.status === 'AVAILABLE' && !assignments.some((asg) => asg.serial_number === a.serial_number));

  return (
    <div className="fade-in">
      <PageTitle eyebrow="Employee services / Equipment" title="Employee Asset Management" copy={canReview ? 'Manage employee asset assignments and equipment requests.' : 'View your assigned equipment and follow asset request status.'} action={canReview ? 'New Assignment' : 'Request asset'} icon={Plus} onAction={canReview ? () => { setEditingAssignment(null); setAssignmentModalOpen(true); } : () => setRequestModalOpen(true)} />
      <div className="heading-actions">{canReview && <button className="button button-secondary" onClick={() => void downloadAssignments()}><Download size={16} /> Download Excel</button>}</div>
      {assignmentActionError && <div className="auth-message module-error" role="alert">{assignmentActionError}</div>}
      <StatStrip>
        <MiniStat label="Total assignments" value={assignments.length.toString()} tone="blue" />
        <MiniStat label="Unique employees" value={uniqueEmployees.length.toString()} tone="teal" />
        <MiniStat label="Assets awaiting assignment" value={unassignedStock.length.toString()} tone="amber" />
        <MiniStat label="Pending requests" value={requests.filter((r) => r.status === 'PENDING_APPROVAL').length.toString()} tone="amber" />
        <MiniStat label="Approved this period" value={requests.filter((r) => r.status === 'APPROVED').length.toString()} tone="teal" />
      </StatStrip>
      {canReview && (
        <section className="panel table-panel full-panel employee-assignment-panel">
          <div className="employee-assignment-toolbar">
            <div><h2>Employee asset assignments</h2><p>Assigned equipment by employee</p></div>
            <label className="employee-assignment-search"><Search size={15} /><input value={assignmentSearch} onChange={(event) => setAssignmentSearch(event.target.value)} placeholder="Search employee, asset, or serial number" aria-label="Search employee asset assignments" /></label>
          </div>
          {assignmentsError && <div className="auth-message module-error employee-assignment-error" role="alert">{assignmentsError}<button type="button" className="text-button" onClick={() => void loadAssignments()}>Retry</button></div>}
          {assignmentsLoading ? <div className="history-state"><Loader2 size={17} className="spin" /> Loading employee assignments</div> : assignmentsError ? null : visibleAssignments.length === 0 ? <EmptyState text={assignments.length ? 'No assignments match your search.' : 'No employee asset assignments have been recorded yet.'} /> : (
            <div className="data-table-wrap employee-assignment-table-wrap">
              <table className="data-table employee-assignment-table">
                <thead><tr><th>Employee Name</th><th>Employee ID</th><th>Designation</th><th>Department</th><th>Asset Model</th><th>Serial Number</th><th>DoJ</th><th>Remarks</th><th>Actions</th></tr></thead>
                <tbody>
                  {visibleAssignments.map((assignment) => (
                    <tr key={assignment.id}>
                      <td><button type="button" className="record-link" onClick={() => setSelectedEmployee(assignment)}>{assignment.employee_name}</button></td>
                      <td>{assignment.employee_id}</td>
                      <td>{assignment.designation}</td>
                      <td>{assignment.department}</td>
                      <td>{assignment.asset_model}</td>
                      <td><button type="button" className="employee-serial-number" onClick={() => setSelectedAssignment(assignment)} aria-label={`View asset and assignment details for serial number ${assignment.serial_number}`}>{assignment.serial_number}</button></td>
                      <td>{formatDate(assignment.doj)}</td>
                      <td>{assignment.remarks || '—'}</td>
                      <td><div className="employee-assignment-actions"><button type="button" className="button button-secondary" disabled={assignmentBusy === assignment.id} onClick={() => { setEditingAssignment(assignment); setAssignmentModalOpen(true); }}><Pencil size={13} /> Edit</button><button type="button" className="button employee-assignment-delete" disabled={assignmentBusy === assignment.id} onClick={() => void deleteAssignment(assignment)}>{assignmentBusy === assignment.id ? <Loader2 size={13} className="spin" /> : <XCircle size={13} />} Delete</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <div className="employee-assignment-panel">
        <section className="panel table-panel full-panel">
          <PanelHeader title="Employee directory" subtitle="Unique employees derived from assignments" />
          {uniqueEmployees.length === 0 ? <EmptyState text="No employees recorded yet." /> : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr><th>Employee</th><th>Employee ID</th><th>Designation</th><th>Department</th><th>Equipment count</th></tr></thead>
                <tbody>
                  {uniqueEmployees.map((emp) => (
                    <tr key={emp.id || emp.name}>
                      <td><button type="button" className="record-link" onClick={() => setSelectedEmployee(emp.sample)}>{emp.name}</button></td>
                      <td>{emp.id}</td>
                      <td>{emp.designation}</td>
                      <td>{emp.department}</td>
                      <td>{emp.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel table-panel full-panel module-panel-gap">
          <PanelHeader title="Unassigned stock" subtitle="Available assets with no assignment" />
          <p className="heading-copy">Count: {unassignedStock.length}. Open the Assets module to assign.</p>
        </section>
      </div>
      <div className="stat-strip employee-request-stats">
        <MiniStat label="Pending review" value={requests.filter((request) => request.status === 'PENDING_APPROVAL').length.toString()} tone="amber" />
        <MiniStat label="Approved" value={requests.filter((request) => request.status === 'APPROVED').length.toString()} tone="teal" />
        <MiniStat label="Requests shown" value={requests.length.toString()} tone="blue" />
      </div>
      {reviewError && <div className="auth-message module-error">{reviewError}</div>}
      <section className="panel table-panel full-panel">
        <PanelHeader title={canReview ? 'Employee equipment requests' : 'My asset requests'} subtitle={canReview ? 'Requests across the workspace' : 'Requests are visible only to you and asset managers'} />
        <div className="request-list">
          {requests.map((request) => {
            const employeeAssignment = assignments.find((item) => item.employee_id === request.requester_id || item.employee_name.trim().toLowerCase() === request.requester_name.trim().toLowerCase());
            return (
              <div className="request-row employee-request-row" key={request.id}>
                <div className="request-icon"><Users size={17} /></div>
                <div className="request-main">
                  <strong>{request.category} · {request.request_number}</strong>
                  <span>{employeeAssignment ? <button type="button" className="record-link" onClick={() => setSelectedEmployee(employeeAssignment)}>{request.requester_name}</button> : request.requester_name} · {request.department} · Needed by {formatDate(request.needed_by)}</span>
                  <small>{request.justification}</small>
                </div>
                <StatusBadge status={request.status} />
                {canReview && request.status === 'PENDING_APPROVAL' && (
                  <div className="request-review-actions">
                    <button className="icon-button approve-action" aria-label={`Approve ${request.request_number}`} onClick={() => void review(request, 'APPROVED')}><Check size={17} /></button>
                    <button className="icon-button reject-action" aria-label={`Reject ${request.request_number}`} onClick={() => void review(request, 'REJECTED')}><XCircle size={17} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {requests.length === 0 && <EmptyState text={canReview ? 'No employee asset requests are waiting.' : 'You have not submitted an asset request yet.'} />}
      </section>
      {requestModalOpen && <EmployeeAssetRequestModal user={user} onClose={() => setRequestModalOpen(false)} onSaved={() => { setRequestModalOpen(false); onSaved(); }} />}
      {assignmentModalOpen && <EmployeeAssetAssignmentModal assignment={editingAssignment} assets={assets} onClose={() => setAssignmentModalOpen(false)} onSaved={(assignment) => { setAssignments((current) => current.some((item) => item.id === assignment.id || item.serial_number === assignment.serial_number) ? current.map((item) => item.id === assignment.id || item.serial_number === assignment.serial_number ? assignment : item) : [...current, assignment].sort((a, b) => a.employee_name.localeCompare(b.employee_name))); setAssignmentModalOpen(false); onSaved(); }} />}
      {selectedEmployee && <EmployeeProfileDialog assignment={selectedEmployee} assignments={assignments.filter((item) => item.employee_id === selectedEmployee.employee_id)} onClose={() => setSelectedEmployee(null)} onOpenAsset={(assignment) => { setSelectedEmployee(null); setSelectedAssignment(assignment); }} />}
      {selectedAssignment && <EmployeeAssetDetailsDialog assignment={selectedAssignment} asset={assets.find((item) => item.serial_number === selectedAssignment.serial_number)} onClose={() => setSelectedAssignment(null)} />}
    </div>
  );
}

function EmployeeProfileDialog({ assignment, assignments, onClose, onOpenAsset }: { assignment: EmployeeAssetAssignment; assignments: EmployeeAssetAssignment[]; onClose: () => void; onOpenAsset: (assignment: EmployeeAssetAssignment) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card record-details-card" role="dialog" aria-modal="true" aria-labelledby="employee-profile-title">
        <div className="modal-header"><div><p className="eyebrow">Employee profile</p><h2 id="employee-profile-title">{assignment.employee_name}</h2><span className="asset-modal-model">{assignment.employee_id}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close employee details"><X size={18} /></button></div>
        <div className="asset-detail-grid"><div><span>Designation</span><strong>{assignment.designation || 'Not recorded'}</strong></div><div><span>Department</span><strong>{assignment.department || 'Not recorded'}</strong></div><div><span>Date of joining</span><strong>{assignment.doj ? formatDate(assignment.doj) : 'Not recorded'}</strong></div></div>
        <section className="record-details-section"><h3>Assigned equipment</h3>{assignments.length ? <div className="record-related-list">{assignments.map((item) => <button type="button" className="record-related-row" key={item.id} onClick={() => onOpenAsset(item)}><span><strong>{item.serial_number}</strong><small>{item.asset_model}</small></span><ArrowUpRight size={15} /></button>)}</div> : <span className="invoice-detail-empty">No equipment assignments are recorded.</span>}</section>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function EmployeeAssetDetailsDialog({ assignment, asset, onClose }: { assignment: EmployeeAssetAssignment; asset: Asset | undefined; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card employee-asset-details-card" role="dialog" aria-modal="true" aria-labelledby="employee-asset-details-title">
        <div className="modal-header"><div><p className="eyebrow">Employee asset details</p><h2 id="employee-asset-details-title">{assignment.serial_number}</h2><span className="asset-modal-model">{assignment.asset_model}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close asset details"><X size={18} /></button></div>
        <section className="employee-asset-details-section"><h3>Asset details</h3>{asset ? <div className="asset-detail-grid"><div><span>Asset tag</span><strong>{asset.asset_tag}</strong></div><div><span>Category</span><strong>{asset.category}</strong></div><div><span>Manufacturer</span><strong>{asset.manufacturer}</strong></div><div><span>Model</span><strong>{asset.model}</strong></div><div><span>Serial number</span><strong>{asset.serial_number}</strong></div><div><span>Condition</span><strong>{asset.condition}</strong></div><div><span>Location</span><strong>{asset.location}</strong></div><div><span>Asset status</span><StatusBadge status={asset.status} /></div></div> : <div className="auth-message" role="status">Asset details are not available for this serial number.</div>}</section>
        <section className="employee-asset-details-section"><h3>Assigned user</h3><div className="asset-detail-grid"><div><span>Name</span><strong>{assignment.employee_name}</strong></div><div><span>Employee ID</span><strong>{assignment.employee_id}</strong></div><div><span>Designation</span><strong>{assignment.designation || 'Not recorded'}</strong></div><div><span>Department</span><strong>{assignment.department || 'Not recorded'}</strong></div><div><span>Date of joining</span><strong>{assignment.doj ? formatDate(assignment.doj) : 'Not recorded'}</strong></div><div className="employee-asset-detail-wide"><span>Remarks</span><strong>{assignment.remarks || 'None'}</strong></div></div></section>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function EmployeeAssetAssignmentModal({ assignment, assets, onClose, onSaved }: { assignment: EmployeeAssetAssignment | null; assets: Asset[]; onClose: () => void; onSaved: (assignment: EmployeeAssetAssignment) => void }) {
  const selectableAssets = assets.filter((asset) => asset.status === 'AVAILABLE' || asset.serial_number === assignment?.serial_number);
  const assetTypes = Array.from(new Set(selectableAssets.map((asset) => asset.category))).sort((a, b) => a.localeCompare(b));
  const currentAsset = assets.find((asset) => asset.serial_number === assignment?.serial_number);
  const [form, setForm] = useState({
    employee_name: assignment?.employee_name ?? '',
    employee_id: assignment?.employee_id ?? '',
    designation: assignment?.designation ?? '',
    department: assignment?.department ?? '',
    asset_type: currentAsset?.category ?? '',
    asset_model: currentAsset?.model ?? assignment?.asset_model ?? '',
    serial_number: assignment?.serial_number ?? '',
    doj: assignment?.doj ?? '',
    remarks: assignment?.remarks ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serialMissing, setSerialMissing] = useState(false);
  const assetsForType = selectableAssets.filter((asset) => !form.asset_type || asset.category.trim().toLowerCase() === form.asset_type.trim().toLowerCase());
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.serial_number) {
      setSerialMissing(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        employee_name: form.employee_name,
        employee_id: form.employee_id,
        designation: form.designation,
        department: form.department,
        asset_model: form.asset_model,
        serial_number: form.serial_number,
        doj: form.doj,
        remarks: form.remarks,
      };
      const saved = assignment
        ? await api.put<EmployeeAssetAssignment>(`/api/workflows/employee-assignments/${encodeURIComponent(assignment.id)}`, payload)
        : await api.post<EmployeeAssetAssignment>('/api/workflows/employee-assignments', payload);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this employee asset assignment.');
    } finally {
      setBusy(false);
    }
  };
  const fields: { key: keyof typeof form; label: string; required?: boolean; type?: string }[] = [
    { key: 'employee_name', label: 'Employee Name', required: true },
    { key: 'employee_id', label: 'Employee ID', required: true },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' },
    { key: 'doj', label: 'Date of Joining', type: 'date' },
  ];
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form className="modal-card employee-assignment-modal" onSubmit={submit}>
        <div className="modal-header"><div><p className="eyebrow">Employee services / Equipment</p><h2>{assignment ? 'Edit Employee Asset' : 'New Employee Asset'}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close assignment form" disabled={busy}><X size={18} /></button></div>
        <div className="form-grid employee-assignment-form">
          {fields.slice(0, 4).map(({ key, label, required, type }) => (
            <label key={key}>{label}{required && ' *'}<input required={required} type={type ?? 'text'} value={form[key]} onChange={(event) => update(key, event.target.value)} /></label>
          ))}
          <label className="span-2">Asset Type
            <select value={form.asset_type} onChange={(event) => { setForm((current) => ({ ...current, asset_type: event.target.value, serial_number: '', asset_model: '' })); setSerialMissing(false); setError(null); }}>
              <option value="">All asset types</option>
              {assetTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="span-2">Serial Number *
            <select required value={form.serial_number} aria-invalid={serialMissing && !form.serial_number} aria-describedby="assignment-serial-hint" onChange={(event) => { const selected = assetsForType.find((asset) => asset.serial_number === event.target.value); setForm((current) => ({ ...current, serial_number: event.target.value, asset_model: selected?.model ?? '' })); setSerialMissing(false); setError(null); }}>
              <option value="">Select a serial number</option>
              {assetsForType.map((asset) => <option key={asset.id} value={asset.serial_number}>{asset.serial_number} · {asset.manufacturer} {asset.model}</option>)}
            </select>
          </label>
          <label className="span-2">Remarks<textarea value={form.remarks} onChange={(event) => update('remarks', event.target.value)} /></label>
        </div>
        {error && <div className="auth-message">{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button></div>
      </form>
    </div>
  );
}

function EmployeeAssetRequestModal({ user, onClose, onSaved }: { user: AppUser; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ category: 'Laptop', justification: '', needed_by: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/workflows/employee-requests', form);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the asset request.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal-card" onSubmit={submit}>
        <div className="modal-header"><div><p className="eyebrow">Employee equipment</p><h2>Request an asset</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="form-grid">
          <label>Equipment category<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}><option>Laptop</option><option>Monitor</option><option>Mobile</option><option>Keyboard / mouse</option><option>Other</option></select></label>
          <label>Needed by<input required type="date" value={form.needed_by} onChange={(event) => setForm((current) => ({ ...current, needed_by: event.target.value }))} /></label>
          <label className="span-2">Business justification<textarea required value={form.justification} onChange={(event) => setForm((current) => ({ ...current, justification: event.target.value }))} placeholder={`Explain why you need this equipment, ${user.full_name}.`} /></label>
        </div>
        {error && <div className="auth-message">{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Submitting...' : 'Submit request'}</button></div>
      </form>
    </div>
  );
}
