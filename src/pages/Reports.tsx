import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  Box,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  FileText,
  Package,
  Printer,
  TrendingUp,
  Users,
} from 'lucide-react';
import { BarChart, ChartLegend, DonutChart, HorizontalBars, TrendChart } from '@/components/charts';
import {
  EmptyState,
  FilterSelect,
  MetricCard,
  PageTitle,
  PanelHeader,
  SegmentedTabs,
  StatStrip,
  MiniStat,
} from '@/components/ui';
import { compactMoney, downloadCsv, formatDate, groupCount, money, warrantyStatus } from '@/lib/format';
import type {
  Asset,
  DashboardMetrics,
  EmployeeAssetRequest,
  InventoryReceipt,
  Invoice,
  WriteOffRequest,
} from '@/lib/types';

type ReportsProps = {
  assets: Asset[];
  invoices: Invoice[];
  requests: EmployeeAssetRequest[];
  receipts: InventoryReceipt[];
  writeOffs: WriteOffRequest[];
  metrics: DashboardMetrics | null;
};

type Range = '30' | '90' | '180' | '365';

const rangeOptions: { value: Range; label: string }[] = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
];

function monthBuckets(count: number) {
  const buckets: { key: string; label: string; from: Date; to: Date }[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(today);
    start.setUTCMonth(today.getUTCMonth() - offset, 1);
    const end = new Date(start);
    end.setUTCMonth(start.getUTCMonth() + 1, 0);
    buckets.push({
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      from: start,
      to: end,
    });
  }
  return buckets;
}

export function ReportsView({ assets, invoices, requests, receipts, writeOffs, metrics }: ReportsProps) {
  const [range, setRange] = useState<Range>('90');
  const [department, setDepartment] = useState('ALL');

  const departments = useMemo(
    () => [...new Set(assets.map((asset) => asset.department).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [assets],
  );

  const scopedAssets = useMemo(
    () => (department === 'ALL' ? assets : assets.filter((asset) => asset.department === department)),
    [assets, department],
  );

  const activeAssets = scopedAssets.filter((asset) => asset.status !== 'RETIRED');
  const warrantyCounts = {
    active: activeAssets.filter((asset) => warrantyStatus(asset) === 'ACTIVE').length,
    expiring: activeAssets.filter((asset) => warrantyStatus(asset) === 'EXPIRING').length,
    expired: activeAssets.filter((asset) => warrantyStatus(asset) === 'EXPIRED').length,
    unknown: activeAssets.filter((asset) => warrantyStatus(asset) === 'UNKNOWN').length,
  };

  const pendingInvoices = invoices.filter((invoice) => ['PENDING', 'UNDER_REVIEW', 'ON_HOLD'].includes(invoice.status));
  const pendingRequests = requests.filter((request) => request.status === 'PENDING_APPROVAL').length;
  const pendingWriteOffs = writeOffs.filter((request) => request.status === 'PENDING_APPROVAL').length;
  const invoiceSpend = invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const purchaseOrders = new Set(invoices.map((invoice) => invoice.purchase_order).filter(Boolean)).size;

  const statusBreakdown = useMemo(() => {
    const order: Asset['status'][] = ['ASSIGNED', 'AVAILABLE', 'UNDER_MAINTENANCE', 'QUARANTINED', 'RETIRED'];
    const counts = groupCount(scopedAssets, (asset) => asset.status);
    return order.map((status) => counts.find((entry) => entry.name === status) ?? { name: status, value: 0 });
  }, [scopedAssets]);

  const typeBreakdown = useMemo(() => groupCount(scopedAssets, (asset) => asset.category), [scopedAssets]);

  const spendByVendor = useMemo(
    () =>
      Object.entries(
        invoices.reduce<Record<string, number>>((accumulator, invoice) => {
          accumulator[invoice.vendor] = (accumulator[invoice.vendor] ?? 0) + Number(invoice.total || 0);
          return accumulator;
        }, {}),
      )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([label, value]) => ({ label, value })),
    [invoices],
  );

  const writeOffReasons = useMemo(
    () => groupCount(writeOffs, (request) => request.reason).slice(0, 8),
    [writeOffs],
  );

  const receiptTrend = useMemo(() => {
    const days = Number(range);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return Array.from({ length: Math.min(days, 30) }, (_, index) => {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() - (Math.min(days, 30) - 1 - index));
      const key = date.toISOString().slice(0, 10);
      const count = receipts.filter((receipt) => receipt.received_date?.slice(0, 10) === key).length;
      return { label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }), value: count };
    });
  }, [range, receipts]);

  const paymentTrend = useMemo(() => {
    const buckets = monthBuckets(12);
    return buckets.map((bucket) => {
      const total = invoices
        .filter((invoice) => {
          const date = new Date(invoice.invoice_date);
          return date >= bucket.from && date <= bucket.to;
        })
        .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
      return { label: bucket.label, value: total };
    });
  }, [invoices]);

  const purchaseOrderTrend = useMemo(() => {
    const buckets = monthBuckets(12);
    return buckets.map((bucket) => {
      const orders = new Set(
        invoices
          .filter((invoice) => {
            const date = new Date(invoice.invoice_date);
            return date >= bucket.from && date <= bucket.to;
          })
          .map((invoice) => invoice.purchase_order)
          .filter(Boolean),
      );
      return { label: bucket.label, value: orders.size };
    });
  }, [invoices]);

  const exportReport = () => {
    const rows: (string | number)[][] = [
      ['Report', 'Metric', 'Value'],
      ['Assets', 'Total registered', scopedAssets.length],
      ['Assets', 'Active', activeAssets.length],
      ['Assets', 'Available', scopedAssets.filter((asset) => asset.status === 'AVAILABLE').length],
      ['Assets', 'Assigned', scopedAssets.filter((asset) => asset.status === 'ASSIGNED').length],
      ['Assets', 'Retired', scopedAssets.filter((asset) => asset.status === 'RETIRED').length],
      ['Warranties', 'Active', warrantyCounts.active],
      ['Warranties', 'Expiring in 90 days', warrantyCounts.expiring],
      ['Warranties', 'Expired', warrantyCounts.expired],
      ['Warranties', 'Unknown', warrantyCounts.unknown],
      ['Invoices', 'Total records', invoices.length],
      ['Invoices', 'Pending review', pendingInvoices.length],
      ['Invoices', 'Total spend', invoiceSpend],
      ['Procurement', 'Purchase orders', purchaseOrders],
      ['Employee assets', 'Pending requests', pendingRequests],
      ['Write-offs', 'Pending approvals', pendingWriteOffs],
      ['Write-offs', 'Total requests', writeOffs.length],
      ['Inventory', 'Goods receipts', receipts.length],
      ['Inventory', 'Accepted units', receipts.reduce((sum, receipt) => sum + receipt.accepted_quantity, 0)],
      ['Inventory', 'Rejected units', receipts.reduce((sum, receipt) => sum + receipt.rejected_quantity, 0)],
    ];
    downloadCsv(`bigbasket-itam-report-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="fade-in reports-view">
      <PageTitle eyebrow="Workspace · Analytics" title="Reports" copy="Current asset, spend, warranty, and workflow summaries.">
        <button className="button button-secondary" onClick={() => window.print()}>
          <Printer size={16} /> Export as PDF
        </button>
        <button className="button button-primary" onClick={exportReport}>
          <Download size={16} /> Export CSV
        </button>
      </PageTitle>

      <div className="report-filter-bar">
        <FilterSelect label="Department" value={department} onChange={setDepartment}>
          <option value="ALL">All departments</option>
          {departments.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </FilterSelect>
        <SegmentedTabs value={range} onChange={setRange} options={rangeOptions} ariaLabel="Reporting period" />
      </div>

      <div className="metric-grid">
        <MetricCard label="Total assets" value={scopedAssets.length.toLocaleString()} note={`${activeAssets.length} active`} icon={Box} tone="blue" />
        <MetricCard label="Purchase orders" value={purchaseOrders.toLocaleString()} note={`${invoices.length} invoice records`} icon={FileText} tone="blue" />
        <MetricCard label="Total payments" value={compactMoney.format(invoiceSpend)} note={`${pendingInvoices.length} need review`} icon={CircleDollarSign} tone="teal" />
        <MetricCard label="Write-offs" value={writeOffs.length.toLocaleString()} note={`${pendingWriteOffs} awaiting approval`} icon={Package} tone="red" />
        <MetricCard label="Assigned assets" value={scopedAssets.filter((asset) => asset.status === 'ASSIGNED').length.toLocaleString()} note={`${scopedAssets.filter((asset) => asset.status === 'AVAILABLE').length} awaiting assignment`} icon={Users} tone="teal" />
        <MetricCard label="Asset types" value={typeBreakdown.length.toLocaleString()} note={`${metrics?.deletedItems ?? 0} deleted items`} icon={TrendingUp} tone="amber" />
      </div>

      <StatStrip className="reports-stats">
        <MiniStat label="Warranty active" value={warrantyCounts.active.toString()} tone="teal" />
        <MiniStat label="Warranty expiring" value={warrantyCounts.expiring.toString()} tone="amber" />
        <MiniStat label="Warranty expired" value={warrantyCounts.expired.toString()} tone="red" />
        <MiniStat label="Pending approvals" value={(pendingRequests + pendingWriteOffs).toString()} tone="blue" />
        <MiniStat label="Goods receipts" value={receipts.length.toString()} tone="gray" />
      </StatStrip>

      <div className="dashboard-reference-grid dashboard-chart-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Assets by status" subtitle="Registered assets by lifecycle status" />
          <div className="portfolio-content">
            <div className="donut-wrap">
              <DonutChart data={statusBreakdown} centerValue={scopedAssets.length.toLocaleString()} centerLabel="assets" size={168} thickness={28} />
            </div>
            <ChartLegend data={statusBreakdown} />
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Assets by type" subtitle="Registered assets by category" />
          <div className="portfolio-content">
            <div className="donut-wrap">
              <DonutChart data={typeBreakdown} centerValue={typeBreakdown.length.toString()} centerLabel="types" size={168} thickness={28} />
            </div>
            <ChartLegend data={typeBreakdown} />
          </div>
        </section>
      </div>

      <div className="dashboard-reference-grid dashboard-chart-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Purchase orders trend" subtitle="Distinct purchase orders per month" />
          <div className="dashboard-chart-body">
            <BarChart data={purchaseOrderTrend} height={200} emptyLabel="No purchase orders are recorded." />
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Payment trend" subtitle="Invoice value per month" />
          <div className="dashboard-chart-body">
            <TrendChart values={paymentTrend} color="#1f5874" height={200} emptyLabel="No invoice value is recorded." />
          </div>
        </section>
      </div>

      <div className="dashboard-reference-grid dashboard-chart-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Spend by supplier" subtitle="Top vendors by invoiced value" />
          <div className="dashboard-bar-list">
            <HorizontalBars data={spendByVendor} emptyLabel="No invoice spend is recorded." />
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Write-off reasons" subtitle="Why assets were disposed of" />
          <div className="dashboard-bar-list">
            <HorizontalBars data={writeOffReasons} emptyLabel="No write-off requests are recorded." />
          </div>
        </section>
      </div>

      <div className="dashboard-reference-grid dashboard-chart-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Goods received" subtitle="Receipts recorded per day in the selected period" />
          <div className="dashboard-chart-body">
            <BarChart data={receiptTrend} color="#4b9b93" height={190} emptyLabel="No goods receipts are recorded." />
          </div>
        </section>

        <section className="panel table-panel dashboard-panel">
          <PanelHeader title="Warranty outlook" subtitle="Coverage across non-retired assets" />
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Coverage</th>
                  <th>Assets</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Active</td>
                  <td>{warrantyCounts.active}</td>
                </tr>
                <tr>
                  <td>Expiring within 90 days</td>
                  <td>{warrantyCounts.expiring}</td>
                </tr>
                <tr>
                  <td>Expired</td>
                  <td>{warrantyCounts.expired}</td>
                </tr>
                <tr>
                  <td>Not recorded</td>
                  <td>{warrantyCounts.unknown}</td>
                </tr>
              </tbody>
            </table>
            {scopedAssets.length === 0 && <EmptyState text="No assets match this department filter." />}
          </div>
        </section>
      </div>

      <section className="panel dashboard-panel">
        <PanelHeader title="Asset register summary" subtitle={`Generated on ${formatDate(new Date().toISOString())}`} />
        <div className="dashboard-status-content">
          <div className="dashboard-status-grid">
            <div className="dashboard-status-card teal">
              <span>Register value</span>
              <strong>{money.format(activeAssets.reduce((sum, asset) => sum + Number(asset.purchase_cost || 0), 0))}</strong>
            </div>
            <div className="dashboard-status-card blue">
              <span>Purchase orders</span>
              <strong>{purchaseOrders}</strong>
            </div>
            <div className="dashboard-status-card amber">
              <span>Assigned assets</span>
              <strong>{scopedAssets.filter((asset) => asset.status === 'ASSIGNED').length}</strong>
            </div>
            <div className="dashboard-status-card gray">
              <span>Write-off requests</span>
              <strong>{writeOffs.length}</strong>
            </div>
          </div>
        </div>
      </section>

      <p className="dashboard-footnote">
        <BadgeCheck size={13} /> Warranty figures use a 90-day expiry horizon. Approvals and receipts reflect the live workspace register.
      </p>
    </div>
  );
}
