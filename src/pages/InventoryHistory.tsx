import { useMemo, useState } from 'react';
import { InventoryReceipt } from '@/lib/types';
import { downloadCsv, formatDate } from '@/lib/format';
import { EmptyState, MiniStat, PageTitle, PanelHeader, SegmentedTabs, StatStrip, StatusBadge } from '@/components/ui';
import { BarChart, HorizontalBars } from '@/components/charts';

export function InventoryHistoryView(props: { receipts: InventoryReceipt[] }): JSX.Element {
  const { receipts } = props;
  const [vendorFilter, setVendorFilter] = useState('');
  const [poFilter, setPoFilter] = useState('');
  const [range, setRange] = useState<'30' | '90' | 'all'>('all');

  const vendors = Array.from(new Set(receipts.map((r) => r.vendor))).sort();
  const pos = Array.from(new Set(receipts.map((r) => r.purchase_order))).sort();

  const cutoff = range === 'all' ? null : new Date(Date.now() - Number(range) * 86400000);
  const filtered = receipts.filter((r) => {
    if (vendorFilter && r.vendor !== vendorFilter) return false;
    if (poFilter && r.purchase_order !== poFilter) return false;
    if (cutoff) {
      const d = new Date(r.received_date);
      if (d < cutoff) return false;
    }
    return true;
  });

  const barData = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const day = r.received_date.slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered]);

  const topSuppliers = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) map.set(r.vendor, (map.get(r.vendor) ?? 0) + r.accepted_quantity);
    return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const downloadHistory = () => {
    const rows: (string | number)[][] = [['Receipt', 'PO', 'Supplier', 'Received', 'Accepted', 'Rejected', 'Ordered', 'Status']];
    for (const r of filtered) rows.push([r.receipt_number, r.purchase_order, r.vendor, r.received_date, r.accepted_quantity, r.rejected_quantity, r.ordered_quantity, r.status]);
    downloadCsv('inventory-history.csv', rows);
  };

  return (
    <div className="fade-in">
      <PageTitle eyebrow="Inventory / Audit trail" title="Inventory History" copy="A complete timeline of goods received against purchase orders." />
      <StatStrip>
        <MiniStat label="Receipts recorded" value={filtered.length.toLocaleString()} tone="blue" />
        <MiniStat label="Units accepted" value={filtered.reduce((s, r) => s + r.accepted_quantity, 0).toLocaleString()} tone="teal" />
        <MiniStat label="Units rejected" value={filtered.reduce((s, r) => s + r.rejected_quantity, 0).toLocaleString()} tone="amber" />
      </StatStrip>
      <div className="filter-note">
        <label>Vendor<select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}><option value="">All vendors</option>{vendors.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <label>PO<select value={poFilter} onChange={(e) => setPoFilter(e.target.value)}><option value="">All POs</option>{pos.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <SegmentedTabs value={range} onChange={setRange} options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: 'all', label: 'All' }]} ariaLabel="Range" />
        <button className="button button-secondary" onClick={downloadHistory}>Download CSV</button>
      </div>
      <section className="panel table-panel full-panel">
        <PanelHeader title="Goods receipt history" subtitle="Receipt numbers, suppliers, quantities, and receiving status" />
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Receipt</th><th>Purchase order</th><th>Supplier</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Ordered</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map((receipt) => <tr key={receipt.id}><td><strong>{receipt.receipt_number}</strong></td><td>{receipt.purchase_order}</td><td>{receipt.vendor}</td><td>{formatDate(receipt.received_date)}</td><td>{receipt.accepted_quantity}</td><td>{receipt.rejected_quantity}</td><td>{receipt.ordered_quantity}</td><td><StatusBadge status={receipt.status} /></td></tr>)}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState text="Goods receipt history will appear here." />}
        </div>
      </section>
      <section className="panel table-panel full-panel module-panel-gap">
        <PanelHeader title="Receipts over time" subtitle="Receipts per day" />
        <BarChart data={barData} />
      </section>
      <section className="panel table-panel full-panel module-panel-gap">
        <PanelHeader title="Top suppliers" subtitle="Accepted units per vendor" />
        <HorizontalBars data={topSuppliers} />
      </section>
    </div>
  );
}
