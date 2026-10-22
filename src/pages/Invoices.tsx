import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, Download, FileText, Loader2, Plus, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { ApiError, api, type AppDocument, type AppUser } from '@/lib/api';
import type { Invoice, InvoiceExtraction } from '@/lib/types';
import { compactMoney, downloadBlob, formatDate, formatInvoiceAmount, money, statusLabel } from '@/lib/format';
import {
  DetailCell,
  DetailGrid,
  EmptyState,
  InlineError,
  MetricCard,
  MiniStat,
  Modal,
  PageTitle,
  PanelHeader,
  RecordLink,
  SearchInput,
  SegmentedTabs,
  StatStrip,
  StatusBadge,
} from '@/components/ui';
import { ChartLegend, DonutChart } from '@/components/charts';

const invoiceStatuses: Invoice['status'][] = ['PENDING', 'UNDER_REVIEW', 'PROCESSED', 'ON_HOLD', 'REJECTED'];

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected file. Try opening it and saving a new PDF or image copy.'));
    reader.readAsDataURL(file);
  });
}

function InvoiceDetailsDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const fields = invoice.extracted_fields;
  const items = Array.isArray(fields?.line_items) ? fields.line_items : [];
  const bank = fields?.bank_details;

  return (
    <Modal title={invoice.invoice_number} eyebrow="Invoice record" subtitle={`${formatDate(invoice.invoice_date)} · ${formatInvoiceAmount(invoice.total, invoice.currency_code)}`} onClose={onClose} width="wide">
      <DetailGrid>
        <DetailCell label="Status">
          <StatusBadge status={invoice.status} />
        </DetailCell>
        <DetailCell label="Purchase order">{invoice.purchase_order || 'Not linked'}</DetailCell>
        <DetailCell label="Invoice date">{formatDate(invoice.invoice_date)}</DetailCell>
        <DetailCell label="Supplier">{invoice.vendor || 'Not recorded'}</DetailCell>
        <DetailCell label="Total amount">{formatInvoiceAmount(invoice.total, invoice.currency_code)}</DetailCell>
        <DetailCell label="Extraction confidence">{invoice.confidence}%</DetailCell>
      </DetailGrid>

      {invoice.issue && (
        <div className="review-warning">
          <CircleAlert size={16} />
          <span>{invoice.issue}</span>
        </div>
      )}

      <section className="record-details-section">
        <h3>Line items</h3>
        {items.length ? (
          <div className="invoice-line-item-list">
            {items.map((item, index) => (
              <div key={`${item.hsn || 'item'}-${index}`}>
                <span>
                  {item.description || 'Item description not found'}
                  {item.hsn ? ` · HSN ${item.hsn}` : ''}
                </span>
                <small>
                  {item.quantity ?? '—'} × {item.unit_price === null ? '—' : formatInvoiceAmount(item.unit_price, invoice.currency_code)}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <span className="invoice-detail-empty">No line items were recorded.</span>
        )}
      </section>

      <section className="record-details-section">
        <h3>Bank details</h3>
        <span>
          {bank
            ? [bank.name, bank.account ? `Account ending ${bank.account.slice(-4)}` : null, bank.ifsc, bank.branch].filter(Boolean).join(' · ') || 'No bank details were recorded.'
            : 'No bank details were recorded.'}
        </span>
      </section>

      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function InvoiceTable({
  invoices,
  canManage = false,
  canDelete = false,
  onStatusChange,
  onDelete,
  onDownload,
}: {
  invoices: Invoice[];
  canManage?: boolean;
  canDelete?: boolean;
  onStatusChange?: (invoice: Invoice, status: Invoice['status']) => void;
  onDelete?: (invoice: Invoice) => void;
  onDownload?: (invoice: Invoice) => void;
}) {
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  return (
    <>
      <div className="data-table-wrap invoice-table-wrap">
        <table className="data-table invoice-table">
          <thead>
            <tr>
              <th>Invoice Number</th>
              <th>PO Number</th>
              <th>Supplier</th>
              <th>Invoice Date</th>
              <th>Description</th>
              <th>HSN</th>
              <th>QTY</th>
              <th>Unit Price</th>
              <th>Total Amount</th>
              <th>Bank Details</th>
              <th>File</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => {
              const items = Array.isArray(invoice.extracted_fields?.line_items) ? invoice.extracted_fields.line_items : [];
              const details = invoice.extracted_fields?.bank_details;
              const description = items.map((item) => item.description).filter(Boolean).join(', ');
              const hsn = [...new Set(items.map((item) => item.hsn).filter(Boolean))].join(', ');
              const quantity = items.reduce((sum, item) => sum + (typeof item.quantity === 'number' ? item.quantity : 0), 0);
              const unitPrices = [...new Set(items.map((item) => item.unit_price).filter((price): price is number => typeof price === 'number'))];
              const bankSummary = details ? [details.name, details.account ? `••••${details.account.slice(-4)}` : null, details.ifsc].filter(Boolean).join(' · ') : '';

              return (
                <tr key={invoice.id}>
                  <td>
                    <div className="invoice-cell">
                      <div className="document-icon">
                        <FileText size={16} />
                      </div>
                      <div>
                        <RecordLink onClick={() => setSelectedInvoice(invoice)}>{invoice.invoice_number}</RecordLink>
                        {invoice.issue && <span className="invoice-issue">{invoice.issue}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="muted-cell">{invoice.purchase_order || '—'}</td>
                  <td>{invoice.vendor}</td>
                  <td>{formatDate(invoice.invoice_date)}</td>
                  <td className="invoice-truncate" title={description}>
                    {description || '—'}
                  </td>
                  <td>{hsn || '—'}</td>
                  <td>{items.length ? quantity || items.length : '—'}</td>
                  <td>{unitPrices.length ? unitPrices.map((price) => formatInvoiceAmount(price, invoice.currency_code)).join(', ') : '—'}</td>
                  <td>
                    <strong>{formatInvoiceAmount(invoice.total, invoice.currency_code)}</strong>
                  </td>
                  <td className="invoice-bank-cell" title={bankSummary}>
                    {bankSummary || '—'}
                  </td>
                  <td>
                    {invoice.document_id && invoice.file_visible ? (
                      <button className="invoice-file-button" onClick={() => onDownload?.(invoice)} title={`Download ${invoice.file_name}`}>
                        <Download size={14} />
                        {invoice.file_name || 'Download'}
                      </button>
                    ) : invoice.document_id ? (
                      <span className="muted-cell">Private</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {canManage ? (
                      <select className="invoice-status-select" aria-label={`Status for ${invoice.invoice_number}`} value={invoice.status} onChange={(event) => onStatusChange?.(invoice, event.target.value as Invoice['status'])}>
                        {invoiceStatuses.map((status) => (
                          <option key={status} value={status}>
                            {statusLabel(status)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <StatusBadge status={invoice.status} />
                    )}
                  </td>
                  <td>
                    {canDelete ? (
                      <button className="invoice-delete-button" onClick={() => onDelete?.(invoice)} aria-label={`Delete invoice ${invoice.invoice_number}`} title="Delete invoice">
                        <XCircle size={16} />
                      </button>
                    ) : (
                      <span className="muted-cell">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {invoices.length === 0 && <EmptyState text="No invoices match these filters. Upload an invoice or use manual entry to begin." />}
        {invoices.some((invoice) => invoice.issue) && (
          <div className="table-footnote">
            <CircleAlert size={14} /> Exception rows require a human review before approval.
          </div>
        )}
      </div>
      {selectedInvoice && <InvoiceDetailsDialog invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
    </>
  );
}

function InvoiceUploadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [extraction, setExtraction] = useState<InvoiceExtraction | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ invoice_number: '', vendor: '', purchase_order: '', invoice_date: '', total: '' });

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setMessage('The invoice document exceeds the 10 MB upload limit.');
      return;
    }
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setMessage('Upload a PDF, PNG, JPG, or WebP invoice document.');
      return;
    }
    setBusy(true);
    setMessage('');
    let uploadedDocumentId: string | null = null;
    try {
      const dataUrl = await readAsDataUrl(file);
      if (!dataUrl.startsWith(`data:${file.type};base64,`)) {
        throw new Error('The selected file could not be read in a supported format.');
      }
      const document = await api.upload<AppDocument>('/api/documents', file, { document_type: 'INVOICE' });
      uploadedDocumentId = document.id;
      const result = await api.post<{ extraction: InvoiceExtraction }>('/api/invoices/process', {
        document_id: uploadedDocumentId,
        fileDataUrl: dataUrl,
        filename: file.name,
      });
      setExtraction(result.extraction);
      setDocumentId(uploadedDocumentId);
      setDraft({
        invoice_number: result.extraction.invoice_number || '',
        vendor: result.extraction.vendor || '',
        purchase_order: result.extraction.purchase_order || '',
        invoice_date: result.extraction.invoice_date || '',
        total: result.extraction.total === null ? '' : String(result.extraction.total),
      });
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'We could not process this document. Check the file and try again.';
      setMessage(errorMessage);
      if (uploadedDocumentId) {
        try {
          await api.put(`/api/documents/${uploadedDocumentId}`, { extraction_status: 'FAILED', review_reason: errorMessage });
        } catch (statusError) {
          const statusMessage = statusError instanceof ApiError ? statusError.message : 'The uploaded document status could not be updated.';
          setMessage(`${errorMessage} ${statusMessage}`);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const saveInvoice = async () => {
    if (!extraction || !documentId) return;
    const total = Number(draft.total);
    if (!draft.invoice_number.trim() || !draft.vendor.trim() || !Number.isFinite(total) || total < 0) {
      setMessage('Enter an invoice number, vendor, and valid total before saving.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.post('/api/invoices', {
        invoice_number: draft.invoice_number.trim(),
        vendor: draft.vendor.trim(),
        purchase_order: draft.purchase_order.trim(),
        invoice_date: draft.invoice_date || new Date().toISOString().slice(0, 10),
        total,
        currency_code: extraction.currency || 'INR',
        confidence: extraction.confidence,
        issue: extraction.review_reason,
        status: extraction.confidence < 85 || extraction.review_reason ? 'UNDER_REVIEW' : 'PENDING',
        extracted_fields: extraction,
        document_id: documentId,
      });
      onSaved();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not add this invoice to the register.');
    } finally {
      setBusy(false);
    }
  };

  const lineItems = extraction?.line_items ?? [];
  const bankDetails = extraction?.bank_details;
  const assetDetails = extraction?.asset_details ?? [];

  return (
    <Modal title="Upload Invoice" eyebrow="Local document scanning" subtitle={extraction ? 'Review the scanned invoice details before adding them to the register.' : 'The scanner will extract invoice details for your review.'} onClose={onClose} busy={busy} width="wide">
      {extraction ? (
        <div className="extraction-result">
          <div className="ai-result-banner">
            <Sparkles size={18} />
            <div>
              <strong>Review extracted details</strong>
              <span>{extraction.confidence}% confidence · Check the fields before adding the invoice</span>
            </div>
          </div>
          <div className="form-grid invoice-review-fields">
            <label>
              Invoice number
              <input required value={draft.invoice_number} onChange={(event) => setDraft({ ...draft, invoice_number: event.target.value })} />
            </label>
            <label>
              Supplier name
              <input required value={draft.vendor} onChange={(event) => setDraft({ ...draft, vendor: event.target.value })} />
            </label>
            <label>
              PO number
              <input value={draft.purchase_order} onChange={(event) => setDraft({ ...draft, purchase_order: event.target.value })} />
            </label>
            <label>
              Invoice date
              <input type="date" value={draft.invoice_date} onChange={(event) => setDraft({ ...draft, invoice_date: event.target.value })} />
            </label>
            <label>
              Total amount
              <input required type="number" min="0" step="0.01" value={draft.total} onChange={(event) => setDraft({ ...draft, total: event.target.value })} />
            </label>
            <label>
              Currency
              <input value={extraction.currency || 'INR'} readOnly />
            </label>
          </div>
          {extraction.review_reason && (
            <div className="review-warning">
              <CircleAlert size={16} />
              <span>{extraction.review_reason}</span>
            </div>
          )}
          <div className="invoice-extraction-details">
            <strong>Line items</strong>
            {lineItems.length ? (
              <div className="invoice-line-item-list">
                {lineItems.map((item, index) => (
                  <div key={`${item.hsn || 'item'}-${index}`}>
                    <span>
                      {item.description || 'Item description not found'}
                      {item.hsn ? ` · HSN ${item.hsn}` : ''}
                    </span>
                    <small>
                      {item.quantity ?? '—'} × {item.unit_price === null ? '—' : money.format(item.unit_price)}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <span className="invoice-detail-empty">No line items were found.</span>
            )}
            <strong>Bank details</strong>
            {bankDetails && Object.values(bankDetails).some(Boolean) ? (
              <span>{[bankDetails.name, bankDetails.account ? `Account ending ${bankDetails.account.slice(-4)}` : null, bankDetails.ifsc, bankDetails.branch].filter(Boolean).join(' · ')}</span>
            ) : (
              <span className="invoice-detail-empty">No bank details found.</span>
            )}
            <strong>Asset details</strong>
            {assetDetails.length ? (
              <span>{assetDetails.map((asset) => [asset.manufacturer, asset.model, asset.serial_number].filter(Boolean).join(' · ') || 'Asset details incomplete').join('; ')}</span>
            ) : (
              <span className="invoice-detail-empty">No asset serial details found.</span>
            )}
          </div>
          {message && <InlineError message={message} />}
          <div className="ai-trust-note">
            <ShieldCheck size={15} />
            <span>Invoice files are scanned locally and stay access-controlled in this workspace.</span>
          </div>
          <div className="modal-actions">
            <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="button button-primary" disabled={busy} onClick={() => void saveInvoice()}>
              {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} {busy ? 'Saving...' : 'Add to invoice register'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="invoice-extract-summary">
            <strong>Local scanning will automatically extract:</strong>
            <ul>
              <li>Invoice number, PO number, date, currency, and total</li>
              <li>Supplier, line items, HSN, quantity, and unit price</li>
              <li>Bank details (name, account, IFSC, branch)</li>
              <li>Asset details including make, model, and serial number</li>
            </ul>
          </div>
          <label className="invoice-pdf-label">
            Select invoice file
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setMessage('');
              }}
            />
          </label>
          <span className="invoice-file-hint">{file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : 'PDF, PNG, JPG, or WebP · maximum 10 MB'}</span>
          {message && <InlineError message={message} />}
          <div className="ai-trust-note">
            <ShieldCheck size={15} />
            <span>Invoice files are scanned locally. Uploaded documents remain private to authorized workspace roles.</span>
          </div>
          <div className="modal-actions">
            <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="button button-primary" disabled={!file || busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {busy ? 'Scanning...' : 'Upload & Scan'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ManualInvoiceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ invoice_number: '', purchase_order: '', vendor: '', invoice_date: new Date().toISOString().slice(0, 10), total: '', currency_code: 'INR' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/invoices', { ...form, total: Number(form.total), confidence: 0, status: 'PENDING' });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invoice.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Manual invoice entry" eyebrow="Finance / Payables" onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Invoice number
            <input required value={form.invoice_number} onChange={(event) => setForm({ ...form, invoice_number: event.target.value })} />
          </label>
          <label>
            PO number
            <input value={form.purchase_order} onChange={(event) => setForm({ ...form, purchase_order: event.target.value })} />
          </label>
          <label>
            Supplier name
            <input required value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} />
          </label>
          <label>
            Invoice date
            <input required type="date" value={form.invoice_date} onChange={(event) => setForm({ ...form, invoice_date: event.target.value })} />
          </label>
          <label>
            Total amount
            <input required type="number" min="0" step="0.01" value={form.total} onChange={(event) => setForm({ ...form, total: event.target.value })} />
          </label>
          <label>
            Currency
            <input required maxLength={3} value={form.currency_code} onChange={(event) => setForm({ ...form, currency_code: event.target.value.toUpperCase() })} />
          </label>
        </div>
        {error && <InlineError message={error} />}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} {busy ? 'Saving...' : 'Add invoice'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function InvoicesView({ invoices, user, query, onSaved }: { invoices: Invoice[]; user: AppUser; query: string; onSaved: () => void }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [filter, setFilter] = useState<'ALL' | Invoice['status']>('ALL');
  const [search, setSearch] = useState(query);
  const [tableError, setTableError] = useState<string | null>(null);
  const canManage = user.role === 'admin' || user.role === 'finance_officer';

  useEffect(() => setSearch(query), [query]);

  const visibleInvoices = invoices.filter((invoice) => {
    const matchesStatus = filter === 'ALL' || invoice.status === filter;
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [invoice.invoice_number, invoice.purchase_order, invoice.vendor].some((value) => value?.toLowerCase().includes(term));
    return matchesStatus && matchesSearch;
  });

  const statusBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const invoice of invoices) counts.set(invoice.status, (counts.get(invoice.status) ?? 0) + 1);
    return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [invoices]);

  const vendorSpend = useMemo(() => {
    const totals = new Map<string, number>();
    for (const invoice of invoices) totals.set(invoice.vendor, (totals.get(invoice.vendor) ?? 0) + Number(invoice.total || 0));
    return [...totals.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [invoices]);

  const updateStatus = async (invoice: Invoice, status: Invoice['status']) => {
    setTableError(null);
    try {
      await api.put(`/api/invoices/${encodeURIComponent(invoice.id)}`, { status });
      onSaved();
    } catch (err) {
      setTableError(err instanceof ApiError ? err.message : 'Could not update invoice status.');
    }
  };

  const deleteInvoice = async (invoice: Invoice) => {
    if (!window.confirm(`Delete invoice ${invoice.invoice_number}? This does not delete its uploaded document.`)) return;
    setTableError(null);
    try {
      await api.del(`/api/invoices/${encodeURIComponent(invoice.id)}`);
      onSaved();
    } catch (err) {
      setTableError(err instanceof ApiError ? err.message : 'Could not delete this invoice.');
    }
  };

  const downloadInvoice = async (invoice: Invoice) => {
    if (!invoice.document_id || !invoice.file_visible) return;
    setTableError(null);
    try {
      const file = await api.download(`/api/documents/${encodeURIComponent(invoice.document_id)}/file`);
      downloadBlob(invoice.file_name || 'invoice', file);
    } catch (err) {
      setTableError(err instanceof ApiError ? err.message : 'Could not download the invoice file.');
    }
  };

  const pendingSpend = invoices.filter((invoice) => invoice.status !== 'PROCESSED').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);

  return (
    <div className="fade-in">
      <PageTitle eyebrow="Finance / Payables" title="Invoices" copy="Review invoice details, supporting files, and processing status.">
        {canManage && (
          <>
            <button className="button button-secondary" onClick={() => setManualOpen(true)}>
              <Plus size={16} /> Manual Entry
            </button>
            <button className="button button-primary" onClick={() => setUploadOpen(true)}>
              <FileText size={16} /> Upload Invoice
            </button>
          </>
        )}
      </PageTitle>

      <StatStrip>
        <MiniStat label="Total invoices" value={invoices.length.toString()} tone="blue" />
        <MiniStat label="In queue" value={invoices.filter((invoice) => invoice.status !== 'PROCESSED').length.toString()} tone="amber" />
        <MiniStat label="Needs review" value={invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD').length.toString()} tone="red" />
        <MiniStat label="Processed spend" value={compactMoney.format(invoices.filter((invoice) => invoice.status === 'PROCESSED').reduce((sum, invoice) => sum + Number(invoice.total), 0))} tone="teal" />
        <MiniStat label="Open payable value" value={compactMoney.format(pendingSpend)} tone="blue" />
      </StatStrip>

      <div className="invoice-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search invoice, PO, or supplier" label="Search invoices" />
      </div>

      <SegmentedTabs
        ariaLabel="Filter invoices by status"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'ALL', label: `All (${invoices.length})` },
          ...invoiceStatuses.map((status) => ({ value: status, label: `${statusLabel(status)} (${statusBreakdown.find((entry) => entry.name === status)?.value ?? 0})` })),
        ]}
      />

      <div className="dashboard-reference-grid dashboard-chart-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Spend by supplier" subtitle="Top invoice value contributors" />
          <div className="dashboard-chart-body dashboard-chart-split">
            <DonutChart data={vendorSpend} centerValue={compactMoney.format(vendorSpend.reduce((sum, entry) => sum + entry.value, 0))} centerLabel="top spend" emptyLabel="No invoice spend is recorded." />
            <ChartLegend data={vendorSpend} />
          </div>
        </section>
        <section className="panel dashboard-panel">
          <PanelHeader title="Processing health" subtitle="Where the payables queue stands" />
          <div className="metric-grid">
            <MetricCard label="Awaiting processing" value={invoices.filter((invoice) => invoice.status === 'PENDING').length.toString()} note="Queued for review" tone="amber" icon={FileText} />
            <MetricCard label="Under review" value={invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW').length.toString()} note="Needs a human decision" tone="red" icon={CircleAlert} />
            <MetricCard label="Processed" value={invoices.filter((invoice) => invoice.status === 'PROCESSED').length.toString()} note="Settled invoices" tone="teal" icon={ShieldCheck} />
          </div>
        </section>
      </div>

      {tableError && <InlineError message={tableError} />}

      <section className="panel table-panel full-panel">
        <PanelHeader title="Invoice register" subtitle={`${visibleInvoices.length} invoices in the current view`} />
        <InvoiceTable invoices={visibleInvoices} canManage={canManage} canDelete={user.role === 'admin'} onStatusChange={(invoice, status) => void updateStatus(invoice, status)} onDelete={(invoice) => void deleteInvoice(invoice)} onDownload={(invoice) => void downloadInvoice(invoice)} />
      </section>

      {uploadOpen && <InvoiceUploadModal onClose={() => setUploadOpen(false)} onSaved={() => { setUploadOpen(false); onSaved(); }} />}
      {manualOpen && <ManualInvoiceModal onClose={() => setManualOpen(false)} onSaved={() => { setManualOpen(false); onSaved(); }} />}
    </div>
  );
}
