import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { ApiError, api, type AppUser } from '@/lib/api';
import { Asset, InventoryReceipt } from '@/lib/types';
import { formatDate, groupCount, uniqueSorted } from '@/lib/format';
import { Banner, EmptyState, FilterSelect, MiniStat, PageTitle, PanelHeader, StatStrip, StatusBadge } from '@/components/ui';
import { HorizontalBars } from '@/components/charts';

function GoodsReceiptModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ purchase_order: '', vendor: '', received_date: new Date().toISOString().slice(0, 10), ordered_quantity: '1', accepted_quantity: '1', rejected_quantity: '0', discrepancy_note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/receipts', { ...form, ordered_quantity: Number(form.ordered_quantity), accepted_quantity: Number(form.accepted_quantity), rejected_quantity: Number(form.rejected_quantity) });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the goods receipt.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal-card" onSubmit={submit}>
        <div className="modal-header"><div><p className="eyebrow">Inventory / Receiving</p><h2>Record goods receipt</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="form-grid">
          <label>Purchase order<input required value={form.purchase_order} onChange={(event) => update('purchase_order', event.target.value)} /></label>
          <label>Supplier<input required value={form.vendor} onChange={(event) => update('vendor', event.target.value)} /></label>
          <label>Received date<input required type="date" value={form.received_date} onChange={(event) => update('received_date', event.target.value)} /></label>
          <label>Ordered quantity<input required min="0" type="number" value={form.ordered_quantity} onChange={(event) => update('ordered_quantity', event.target.value)} /></label>
          <label>Accepted quantity<input required min="0" type="number" value={form.accepted_quantity} onChange={(event) => update('accepted_quantity', event.target.value)} /></label>
          <label>Rejected quantity<input required min="0" type="number" value={form.rejected_quantity} onChange={(event) => update('rejected_quantity', event.target.value)} /></label>
          <label className="span-2">Discrepancy note<textarea value={form.discrepancy_note} onChange={(event) => update('discrepancy_note', event.target.value)} placeholder="Optional notes about rejected or missing items" /></label>
        </div>
        {error && <div className="auth-message">{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving...' : 'Save receipt'}</button></div>
      </form>
    </div>
  );
}

export function InventoryView(props: {
  assets: Asset[];
  receipts: InventoryReceipt[];
  user: AppUser;
  onSaved: () => void;
}): JSX.Element {
  const { assets, receipts, user, onSaved } = props;
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const stock = assets.filter((asset) => asset.status === 'AVAILABLE');
  const filteredStock = stock.filter((a) => (!categoryFilter || a.category === categoryFilter) && (!locationFilter || a.location === locationFilter));
  const categories = uniqueSorted(stock.map((a) => a.category));
  const locations = uniqueSorted(stock.map((a) => a.location));
  const canReceive = ['admin', 'it_asset_manager'].includes(user.role);
  const discrepancyCount = receipts.filter((r) => r.status === 'DISCREPANCY').length;
  const categoryBars = groupCount(stock, (a) => a.category).map((g) => ({ label: g.key, value: g.count }));
  const locationBars = groupCount(stock, (a) => a.location).map((g) => ({ label: g.key, value: g.count }));
  const downloadCsv = () => {
    const rows: (string | number)[][] = [['Asset Tag', 'Category', 'Manufacturer', 'Model', 'Serial', 'Location']];
    for (const a of filteredStock) rows.push([a.asset_tag, a.category, a.manufacturer, a.model, a.serial_number, a.location]);
    const csv = rows.map((row) => row.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inventory-stock.csv';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="fade-in">
      <PageTitle eyebrow="Inventory / Stock operations" title="Inventory" copy="Available assets and goods receipt activity from your operational register." action={canReceive ? 'Record goods receipt' : undefined} icon={Plus} onAction={canReceive ? () => setReceiptModalOpen(true) : undefined} />
      <StatStrip>
        <MiniStat label="Available assets" value={stock.length.toString()} tone="teal" />
        <MiniStat label="Categories in stock" value={categories.length.toString()} tone="blue" />
        <MiniStat label="Open receipts" value={receipts.length.toString()} tone="amber" />
        <MiniStat label="Units received this month" value={receipts.reduce((s, r) => s + r.accepted_quantity, 0).toString()} tone="teal" />
        <MiniStat label="Discrepancy receipts" value={discrepancyCount.toString()} tone="amber" />
      </StatStrip>
      {discrepancyCount > 0 && <Banner tone="amber" title={`${discrepancyCount} receipt(s) need supplier follow-up`} />}
      <div className="filter-note">
        <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </FilterSelect>
        <FilterSelect label="Location" value={locationFilter} onChange={setLocationFilter}>
          <option value="">All locations</option>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </FilterSelect>
        <button className="button button-secondary" onClick={downloadCsv}>Download CSV</button>
      </div>
      <section className="panel table-panel full-panel">
        <PanelHeader title="Available stock" subtitle="Registered assets ready to assign" />
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Asset Tag</th><th>Category</th><th>Manufacturer</th><th>Model</th><th>Serial</th><th>Location</th></tr></thead>
            <tbody>
              {filteredStock.map((a) => <tr key={a.id}><td>{a.asset_tag}</td><td>{a.category}</td><td>{a.manufacturer}</td><td>{a.model}</td><td>{a.serial_number}</td><td>{a.location}</td></tr>)}
            </tbody>
          </table>
          {filteredStock.length === 0 && <EmptyState text="No stock matches the filters." />}
        </div>
      </section>
      <section className="panel table-panel full-panel module-panel-gap">
        <PanelHeader title="Stock by category" subtitle="Count per category" />
        <HorizontalBars data={categoryBars} />
      </section>
      <section className="panel table-panel full-panel module-panel-gap">
        <PanelHeader title="Stock by location" subtitle="Count per location" />
        <HorizontalBars data={locationBars} />
      </section>
      <section className="panel table-panel full-panel module-panel-gap">
        <PanelHeader title="Recent goods receipts" subtitle="Received and accepted quantities recorded against purchase orders" />
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Receipt</th><th>Purchase order</th><th>Supplier</th><th>Received</th><th>Accepted / ordered</th><th>Status</th></tr></thead>
            <tbody>
              {receipts.map((receipt) => <tr key={receipt.id}><td><strong>{receipt.receipt_number}</strong></td><td>{receipt.purchase_order}</td><td>{receipt.vendor}</td><td>{formatDate(receipt.received_date)}</td><td>{receipt.accepted_quantity} / {receipt.ordered_quantity}</td><td><StatusBadge status={receipt.status} /></td></tr>)}
            </tbody>
          </table>
          {receipts.length === 0 && <EmptyState text="No goods receipts recorded yet." />}
        </div>
      </section>
      {receiptModalOpen && <GoodsReceiptModal onClose={() => setReceiptModalOpen(false)} onSaved={() => { setReceiptModalOpen(false); onSaved(); }} />}
    </div>
  );
}
