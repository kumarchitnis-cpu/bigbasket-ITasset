import { useMemo } from 'react';
import {
  BadgeCheck,
  CircleAlert,
  CircleDollarSign,
  FileText,
  Package,
  TrendingUp,
  Truck,
} from 'lucide-react';
import { BarChart, ChartLegend, DonutChart } from '@/components/charts';
import {
  Banner,
  EmptyState,
  MetricCard,
  PageTitle,
  PanelHeader,
  StatusBadge,
} from '@/components/ui';
import {
  compactMoney,
  formatDate,
  groupCount,
  makeDailySeries,
  money,
} from '@/lib/format';
import type { DashboardData, DashboardMetrics, InventoryReceipt, Invoice, WorkspaceModule } from '@/lib/types';

type ProcurementProps = {
  invoices: Invoice[];
  receipts: InventoryReceipt[];
  metrics: DashboardMetrics | null;
  activity: DashboardData;
  onOpenInvoices: () => void;
  onOpenWarranties: () => void;
  onOpenReports: () => void;
  onOpenWriteOffs: () => void;
  onOpenInventory: () => void;
  onNavigate: (module: WorkspaceModule) => void;
};

export function ProcurementView({
  invoices,
  receipts,
  metrics,
  activity,
  onOpenInvoices,
  onOpenWarranties,
  onOpenReports,
  onOpenWriteOffs,
  onOpenInventory,
  onNavigate,
}: ProcurementProps) {
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  const invoiceReviewCount = invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD').length;
  const pendingInvoices = invoices.filter((invoice) => invoice.status !== 'PROCESSED').length;
  const processedSpend = invoices.filter((invoice) => invoice.status === 'PROCESSED').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const pendingSpend = invoices.filter((invoice) => invoice.status !== 'PROCESSED').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const discrepancyReceipts = receipts.filter((receipt) => receipt.status === 'DISCREPANCY').length;
  const totalAccepted = receipts.reduce((sum, receipt) => sum + receipt.accepted_quantity, 0);
  const totalOrdered = receipts.reduce((sum, receipt) => sum + receipt.ordered_quantity, 0);

  const invoiceStatusBreakdown = useMemo(() => {
    const counts = groupCount(invoices, (invoice) => invoice.status);
    return counts.map((entry) => ({ label: entry.name, value: entry.value }));
  }, [invoices]);

  const vendorSpend = useMemo(() => {
    const totals = new Map<string, number>();
    for (const invoice of invoices) totals.set(invoice.vendor, (totals.get(invoice.vendor) ?? 0) + Number(invoice.total || 0));
    return [...totals.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [invoices]);

  const receiptVendorBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const receipt of receipts) totals.set(receipt.vendor, (totals.get(receipt.vendor) ?? 0) + receipt.accepted_quantity);
    return [...totals.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [receipts]);

  const trendValues = useMemo(() => makeDailySeries([], activity.daily, 30), [activity.daily]);

  const recentInvoices = invoices
    .slice()
    .sort((a, b) => new Date(b.created_at || b.invoice_date).getTime() - new Date(a.created_at || a.invoice_date).getTime())
    .slice(0, 5);

  const recentReceipts = receipts
    .slice()
    .sort((a, b) => new Date(b.created_at || b.received_date).getTime() - new Date(a.created_at || a.received_date).getTime())
    .slice(0, 5);

  return (
    <div className="fade-in operations-dashboard">
      <PageTitle
        eyebrow="Finance / Procurement overview"
        title="Procurement"
        copy={`${today} · Invoices, goods receipts, and payables pipeline.`}
      />

      {invoiceReviewCount > 0 && (
        <Banner tone="amber" title={`${invoiceReviewCount} invoice${invoiceReviewCount === 1 ? '' : 's'} need a human review`}>
          Invoices under review or on hold cannot be processed until a finance officer clears the exception.
        </Banner>
      )}

      <div className="metric-grid dashboard-metrics">
        <MetricCard
          label="Total invoices"
          value={invoices.length.toLocaleString()}
          note={`${pendingInvoices} pending · ${invoiceReviewCount} need review`}
          icon={FileText}
          tone="blue"
          onClick={onOpenInvoices}
        />
        <MetricCard
          label="Processed spend"
          value={compactMoney.format(processedSpend)}
          note="Settled invoice value"
          icon={CircleDollarSign}
          tone="teal"
          onClick={onOpenInvoices}
        />
        <MetricCard
          label="Open payable value"
          value={compactMoney.format(pendingSpend)}
          note="Awaiting processing or approval"
          icon={CircleDollarSign}
          tone="amber"
          onClick={onOpenInvoices}
        />
        <MetricCard
          label="Goods receipts"
          value={receipts.length.toLocaleString()}
          note={`${totalAccepted.toLocaleString()} of ${totalOrdered.toLocaleString()} units accepted`}
          icon={Truck}
          tone="blue"
          onClick={onOpenInventory}
        />
        <MetricCard
          label="Discrepancies"
          value={discrepancyReceipts.toLocaleString()}
          note="Receipts flagged for review"
          icon={CircleAlert}
          tone={discrepancyReceipts > 0 ? 'red' : 'teal'}
          onClick={onOpenInventory}
        />
      </div>

      <div className="dashboard-reference-grid dashboard-overview-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Invoice pipeline" subtitle="Invoices by processing status" action="Open invoices" onAction={onOpenInvoices} />
          <div className="dashboard-status-content">
            <div className="dashboard-status-grid">
              {invoiceStatusBreakdown.map((item) => (
                <div className={`dashboard-status-card ${item.label === 'PENDING' ? 'amber' : item.label === 'UNDER_REVIEW' ? 'blue' : item.label === 'PROCESSED' ? 'teal' : item.label === 'ON_HOLD' ? 'amber' : 'gray'}`} key={item.label}>
                  <span>{item.label.replace('_', ' ')}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            <p>{compactMoney.format(processedSpend)} processed · {compactMoney.format(pendingSpend)} pending</p>
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Receipt pipeline" subtitle="Goods receipts by status" action="Open inventory" onAction={onOpenInventory} />
          <div className="dashboard-status-content">
            <div className="dashboard-status-grid">
              <div className="dashboard-status-card teal">
                <span>Accepted</span>
                <strong>{totalAccepted.toLocaleString()}</strong>
              </div>
              <div className="dashboard-status-card amber">
                <span>Ordered</span>
                <strong>{totalOrdered.toLocaleString()}</strong>
              </div>
              <div className="dashboard-status-card blue">
                <span>Receipts</span>
                <strong>{receipts.length}</strong>
              </div>
              <div className={`dashboard-status-card ${discrepancyReceipts > 0 ? 'red' : 'gray'}`}>
                <span>Discrepancies</span>
                <strong>{discrepancyReceipts}</strong>
              </div>
            </div>
            <p>{receipts.filter((r) => r.status === 'COMPLETED').length} completed · {receipts.filter((r) => r.status === 'PARTIAL').length} partial</p>
          </div>
        </section>
      </div>

      <div className="dashboard-reference-grid dashboard-chart-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Spend by supplier" subtitle="Top invoice value contributors" action="Invoices" onAction={onOpenInvoices} />
          <div className="dashboard-chart-body dashboard-chart-split">
            <DonutChart data={vendorSpend} centerValue={compactMoney.format(vendorSpend.reduce((sum, entry) => sum + entry.value, 0))} centerLabel="top spend" emptyLabel="No invoice spend is recorded." />
            <ChartLegend data={vendorSpend} />
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Receipts by supplier" subtitle="Accepted units per vendor" action="Inventory history" onAction={onOpenInventory} />
          <div className="dashboard-chart-body dashboard-chart-split">
            <DonutChart data={receiptVendorBreakdown} centerValue={totalAccepted.toLocaleString()} centerLabel="units" emptyLabel="No goods receipts are recorded." />
            <ChartLegend data={receiptVendorBreakdown} />
          </div>
        </section>
      </div>

      <div className="dashboard-reference-grid dashboard-breakdown-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Invoice status trend" subtitle="Processing health over 30 days" />
          <div className="dashboard-chart-body">
            <BarChart data={invoiceStatusBreakdown} height={180} emptyLabel="No invoice status data." />
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Activity trend" subtitle="Procurement actions over the last 30 days" />
          <div className="dashboard-chart-body">
            <TrendingUp size={16} />
            <TrendChart values={trendValues} color="#4b9b93" height={180} />
          </div>
        </section>
      </div>

      <div className="dashboard-reference-grid dashboard-recent-grid">
        <section className="panel table-panel dashboard-panel">
          <PanelHeader title="Recent invoices" subtitle="Latest invoice activity" action="View all" onAction={onOpenInvoices} />
          <div className="data-table-wrap">
            <table className="data-table dashboard-assets-table">
              <thead>
                <tr>
                  <th>Invoice Number</th>
                  <th>PO Number</th>
                  <th>Supplier</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <button type="button" className="record-link" onClick={() => onNavigate('Invoices')}>
                        {invoice.invoice_number}
                      </button>
                    </td>
                    <td className="muted-cell">{invoice.purchase_order || '—'}</td>
                    <td>{invoice.vendor}</td>
                    <td>{formatDate(invoice.invoice_date)}</td>
                    <td><strong>{money.format(invoice.total)}</strong></td>
                    <td><StatusBadge status={invoice.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {invoices.length === 0 && <EmptyState text="No invoices have been recorded yet." />}
          </div>
        </section>

        <section className="panel table-panel dashboard-panel">
          <PanelHeader title="Recent goods receipts" subtitle="Latest receiving activity" action="View all" onAction={onOpenInventory} />
          <div className="data-table-wrap">
            <table className="data-table dashboard-assets-table">
              <thead>
                <tr>
                  <th>Receipt Number</th>
                  <th>PO Number</th>
                  <th>Supplier</th>
                  <th>Received</th>
                  <th>Accepted / Ordered</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentReceipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>
                      <button type="button" className="record-link" onClick={() => onNavigate('Inventory')}>
                        {receipt.receipt_number}
                      </button>
                    </td>
                    <td className="muted-cell">{receipt.purchase_order}</td>
                    <td>{receipt.vendor}</td>
                    <td>{formatDate(receipt.received_date)}</td>
                    <td>{receipt.accepted_quantity} / {receipt.ordered_quantity}</td>
                    <td><StatusBadge status={receipt.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {receipts.length === 0 && <EmptyState text="No goods receipts have been recorded yet." />}
          </div>
        </section>
      </div>

      <section className="panel dashboard-panel dashboard-quick-actions">
        <PanelHeader title="Jump to a module" subtitle="Common procurement destinations" />
        <div className="dashboard-bar-list">
          <div className="dashboard-quick-grid">
            <button type="button" onClick={onOpenInvoices}>
              <FileText size={16} />
              <span>Invoices</span>
            </button>
            <button type="button" onClick={onOpenInventory}>
              <Truck size={16} />
              <span>Inventory / Receipts</span>
            </button>
            <button type="button" onClick={() => onNavigate('Assets')}>
              <Package size={16} />
              <span>Asset Register</span>
            </button>
            <button type="button" onClick={onOpenWarranties}>
              <BadgeCheck size={16} />
              <span>Warranties</span>
            </button>
            <button type="button" onClick={onOpenWriteOffs}>
              <CircleDollarSign size={16} />
              <span>Write-Off</span>
            </button>
            <button type="button" onClick={onOpenReports}>
              <TrendingUp size={16} />
              <span>Reports</span>
            </button>
            <button type="button" onClick={() => onNavigate('Notifications')}>
              <BadgeCheck size={16} />
              <span>Notifications</span>
            </button>
            <button type="button" onClick={() => onNavigate('AI Assistant')}>
              <Package size={16} />
              <span>AI Assistant</span>
            </button>
          </div>
          <p>
            {metrics ? `${metrics.pendingInvoices} invoices and ${metrics.pendingApprovals} approvals are waiting on a decision.` : 'Workspace counters are loading.'}
          </p>
        </div>
      </section>

      <p className="dashboard-footnote">
        Last refreshed {formatDate(new Date().toISOString())} · Figures are derived from the live workspace register.
      </p>
    </div>
  );
}

function TrendChart({ values, color, height }: { values: { date: string; label: string; value: number }[]; color: string; height: number }) {
  const maxValue = Math.max(...values.map((v) => v.value), 1);
  return (
    <div className="chart-trend" style={{ height }}>
      <svg className="chart-trend-svg" viewBox={`0 0 ${values.length * 20} ${maxValue * 1.5}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="trend-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path
          d={values
            .map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * 20 + 10} ${maxValue * 1.5 - v.value * 1.5}`)
            .join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={`${values
            .map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * 20 + 10} ${maxValue * 1.5 - v.value * 1.5}`)
            .join(' ')} L ${(values.length - 1) * 20 + 10} ${maxValue * 1.5} L ${10} ${maxValue * 1.5} Z`}
          fill="url(#trend-gradient)"
        />
      </svg>
      <div className="chart-trend-axis">
        {values.filter((_, i) => i % 5 === 0 || i === values.length - 1).map((v) => (
          <span key={v.date} style={{ left: `${(values.indexOf(v) / (values.length - 1)) * 100}%` }}>{v.label}</span>
        ))}
      </div>
    </div>
  );
}