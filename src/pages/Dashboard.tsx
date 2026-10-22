import { useMemo } from 'react';
import {
  Activity,
  Archive,
  BadgeCheck,
  Bell,
  Box,
  CircleAlert,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  Package,
  Trash2,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react';
import { BarChart, ChartLegend, DonutChart, HorizontalBars, TrendChart } from '@/components/charts';
import {
  Banner,
  EmptyState,
  MetricCard,
  MiniStat,
  PageTitle,
  PanelHeader,
  StatStrip,
  StatusBadge,
} from '@/components/ui';
import {
  compactMoney,
  formatActivity,
  formatDate,
  formatDateTime,
  groupCount,
  makeDailySeries,
  money,
  warrantyStatus,
} from '@/lib/format';
import type {
  Asset,
  DashboardData,
  DashboardMetrics,
  EmployeeAssetRequest,
  InventoryReceipt,
  Invoice,
  WriteOffRequest,
  WorkspaceModule,
} from '@/lib/types';

type DashboardProps = {
  assets: Asset[];
  invoices: Invoice[];
  employeeRequests: EmployeeAssetRequest[];
  writeOffs: WriteOffRequest[];
  receipts: InventoryReceipt[];
  metrics: DashboardMetrics | null;
  activity: DashboardData;
  onOpenAsset: (asset: Asset) => void;
  onOpenAssets: () => void;
  onOpenEmployeeRequests: () => void;
  onOpenInvoices: () => void;
  onOpenWarranties: () => void;
  onOpenReports: () => void;
  onOpenWriteOffs: () => void;
  onOpenInventory: () => void;
  onOpenDeleted: () => void;
  onNavigate: (module: WorkspaceModule) => void;
};

export function DashboardView({
  assets,
  invoices,
  employeeRequests,
  writeOffs,
  receipts,
  metrics,
  activity,
  onOpenAsset,
  onOpenAssets,
  onOpenEmployeeRequests,
  onOpenInvoices,
  onOpenWarranties,
  onOpenReports,
  onOpenWriteOffs,
  onOpenInventory,
  onOpenDeleted,
  onNavigate,
}: DashboardProps) {
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  const totals = useMemo(() => {
    const active = assets.filter((asset) => asset.status !== 'RETIRED');
    const registerValue = assets.reduce((sum, asset) => sum + Number(asset.purchase_cost || 0), 0);
    const underWarranty = active.filter((asset) => ['ACTIVE', 'EXPIRING'].includes(warrantyStatus(asset))).length;
    const outOfWarranty = active.filter((asset) => warrantyStatus(asset) === 'EXPIRED').length;
    const pendingApprovals =
      employeeRequests.filter((request) => request.status === 'PENDING_APPROVAL').length +
      writeOffs.filter((request) => request.status === 'PENDING_APPROVAL').length;
    const invoiceSpend = invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    const invoiceExceptions = invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD').length;
    return {
      active,
      registerValue,
      underWarranty,
      outOfWarranty,
      pendingApprovals,
      invoiceSpend,
      invoiceExceptions,
      retired: assets.length - active.length,
    };
  }, [assets, employeeRequests, invoices, writeOffs]);

  const statusBreakdown = useMemo(() => {
    const order: Asset['status'][] = ['ASSIGNED', 'AVAILABLE', 'UNDER_MAINTENANCE', 'QUARANTINED', 'RETIRED'];
    const counts = groupCount(assets, (asset) => asset.status);
    return order
      .map((status) => counts.find((entry) => entry.name === status) ?? { name: status, value: 0 })
      .filter((entry) => entry.value > 0);
  }, [assets]);

  const categoryBreakdown = useMemo(() => groupCount(assets, (asset) => asset.category).slice(0, 7), [assets]);

  const trendValues = useMemo(() => makeDailySeries([], activity.daily, 30), [activity.daily]);

  const employeeRequestStatuses = [
    { label: 'Awaiting approval', value: employeeRequests.filter((request) => request.status === 'PENDING_APPROVAL').length, color: 'amber' },
    { label: 'Approved', value: employeeRequests.filter((request) => request.status === 'APPROVED').length, color: 'teal' },
    { label: 'Rejected', value: employeeRequests.filter((request) => request.status === 'REJECTED').length, color: 'gray' },
  ];

  const invoiceStatuses = [
    { label: 'Pending', value: invoices.filter((invoice) => invoice.status === 'PENDING').length, color: 'amber' },
    { label: 'Under review', value: invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW').length, color: 'blue' },
    { label: 'Processed', value: invoices.filter((invoice) => invoice.status === 'PROCESSED').length, color: 'teal' },
    { label: 'On hold', value: invoices.filter((invoice) => invoice.status === 'ON_HOLD').length, color: 'amber' },
    { label: 'Rejected', value: invoices.filter((invoice) => invoice.status === 'REJECTED').length, color: 'gray' },
  ];

  const deletedItems = metrics?.deletedItems ?? 0;
  const warrantyTotal = totals.active.length;

  return (
    <div className="fade-in operations-dashboard">
      <PageTitle
        eyebrow="Workspace overview · Live data"
        title="Operations Dashboard"
        copy={`${today} · Asset, inventory, spend and workflow overview.`}
      />

      <div className="metric-grid dashboard-metrics">
        <MetricCard
          label="Total assets"
          value={assets.length.toLocaleString()}
          note={`${totals.active.length.toLocaleString()} active · ${totals.retired.toLocaleString()} retired`}
          icon={Box}
          tone="blue"
          onClick={onOpenAssets}
        />
        <MetricCard
          label="Register value"
          value={compactMoney.format(totals.registerValue)}
          note="Purchase cost of registered assets"
          icon={CircleDollarSign}
          tone="teal"
          onClick={onOpenReports}
        />
        <MetricCard
          label="Invoice spend"
          value={compactMoney.format(totals.invoiceSpend)}
          note={`${invoices.length.toLocaleString()} invoices · ${totals.invoiceExceptions} need review`}
          icon={FileText}
          tone="blue"
          onClick={onOpenInvoices}
        />
        <MetricCard
          label="Pending approvals"
          value={totals.pendingApprovals.toLocaleString()}
          note="Employee requests and write-offs"
          icon={ClipboardCheck}
          tone="amber"
          onClick={onOpenEmployeeRequests}
        />
        <MetricCard
          label="Deleted items"
          value={deletedItems.toLocaleString()}
          note="Restorable from the deleted register"
          icon={Trash2}
          tone="red"
          onClick={onOpenDeleted}
        />
      </div>

      {totals.invoiceExceptions > 0 && (
        <Banner tone="amber" title={`${totals.invoiceExceptions} invoice${totals.invoiceExceptions === 1 ? '' : 's'} need a human review`}>
          Invoices under review or on hold cannot be processed until a finance officer clears the exception.
        </Banner>
      )}

      <div className="dashboard-reference-grid dashboard-overview-grid">
        <section className="panel dashboard-panel">
          <PanelHeader
            title="Employee asset requests"
            subtitle="Equipment requests awaiting a decision"
            action="View requests"
            onAction={onOpenEmployeeRequests}
          />
          <div className="dashboard-status-content">
            <div className="dashboard-status-grid">
              {employeeRequestStatuses.map((item) => (
                <div className={`dashboard-status-card ${item.color}`} key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
              <div className="dashboard-status-card blue">
                <span>Write-off approvals</span>
                <strong>{writeOffs.filter((request) => request.status === 'PENDING_APPROVAL').length}</strong>
              </div>
            </div>
            <p>{employeeRequests.length} equipment request{employeeRequests.length === 1 ? '' : 's'} recorded</p>
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader
            title="Invoice pipeline"
            subtitle="Invoices by processing status"
            action="Open invoices"
            onAction={onOpenInvoices}
          />
          <div className="dashboard-status-content">
            <div className="dashboard-status-grid">
              {invoiceStatuses.map((item) => (
                <div className={`dashboard-status-card ${item.color}`} key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            <p>{compactMoney.format(totals.invoiceSpend)} total register value</p>
          </div>
        </section>
      </div>

      <div className="dashboard-reference-grid dashboard-chart-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Asset portfolio" subtitle="Registered assets by lifecycle status" action="Asset register" onAction={onOpenAssets} />
          <div className="portfolio-content">
            <div className="donut-wrap">
              <DonutChart
                data={statusBreakdown}
                centerValue={assets.length.toLocaleString()}
                centerLabel="assets"
                size={168}
                thickness={28}
              />
            </div>
            <ChartLegend data={statusBreakdown} />
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Activity trend" subtitle="Successful workspace actions over the last 30 days" />
          <div className="dashboard-chart-body">
            <TrendChart values={trendValues} color="#4b9b93" height={190} />
          </div>
        </section>
      </div>

      <div className="dashboard-reference-grid dashboard-breakdown-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Top categories" subtitle="Registered assets by category" action="Inventory" onAction={onOpenInventory} />
          <div className="dashboard-bar-list">
            <HorizontalBars
              data={categoryBreakdown.map((entry) => ({ label: entry.name, value: entry.value }))}
              emptyLabel="No assets are registered yet."
            />
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Warranty coverage" subtitle="Coverage across non-retired assets" action="Warranty report" onAction={onOpenWarranties} />
          <div className="dashboard-status-content">
            <div className="dashboard-status-grid">
              <div className="dashboard-status-card teal">
                <span>Under warranty</span>
                <strong>{totals.underWarranty.toLocaleString()}</strong>
              </div>
              <div className="dashboard-status-card amber">
                <span>Out of warranty</span>
                <strong>{totals.outOfWarranty.toLocaleString()}</strong>
              </div>
              <div className="dashboard-status-card blue">
                <span>Coverage rate</span>
                <strong>{warrantyTotal ? Math.round((totals.underWarranty / warrantyTotal) * 100) : 0}%</strong>
              </div>
              <div className="dashboard-status-card gray">
                <span>Assets tracked</span>
                <strong>{warrantyTotal.toLocaleString()}</strong>
              </div>
            </div>
            <p>{totals.active.length - totals.underWarranty - totals.outOfWarranty} assets have no warranty date recorded.</p>
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Stock & receipts" subtitle="Inventory position and goods receiving" action="Inventory" onAction={onOpenInventory} />
          <div className="dashboard-status-content">
            <div className="dashboard-status-grid">
              <div className="dashboard-status-card teal">
                <span>Available assets</span>
                <strong>{assets.filter((asset) => asset.status === 'AVAILABLE').length}</strong>
              </div>
              <div className="dashboard-status-card amber">
                <span>In maintenance</span>
                <strong>{assets.filter((asset) => asset.status === 'UNDER_MAINTENANCE').length}</strong>
              </div>
              <div className="dashboard-status-card blue">
                <span>Goods receipts</span>
                <strong>{receipts.length}</strong>
              </div>
              <div className="dashboard-status-card gray">
                <span>Units accepted</span>
                <strong>{receipts.reduce((sum, receipt) => sum + receipt.accepted_quantity, 0)}</strong>
              </div>
            </div>
            <p>{receipts.filter((receipt) => receipt.status === 'DISCREPANCY').length} receipts are flagged with a discrepancy.</p>
          </div>
        </section>
      </div>

      <div className="dashboard-reference-grid dashboard-recent-grid">
        <section className="panel table-panel dashboard-panel">
          <PanelHeader title="Recent assets" subtitle="Latest registered devices" action="View all" onAction={onOpenAssets} />
          <div className="data-table-wrap">
            <table className="data-table dashboard-assets-table">
              <thead>
                <tr>
                  <th>Make</th>
                  <th>Model</th>
                  <th>Serial number</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {assets.slice(0, 6).map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.manufacturer}</td>
                    <td>{asset.model}</td>
                    <td>
                      <button type="button" className="record-link" onClick={() => onOpenAsset(asset)}>
                        {asset.serial_number}
                      </button>
                    </td>
                    <td>
                      <StatusBadge status={asset.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {assets.length === 0 && <EmptyState text="No assets have been registered yet." />}
          </div>
        </section>

        <section className="panel dashboard-panel dashboard-activity-panel">
          <PanelHeader title="Recent activity" subtitle="Latest successful workspace actions" />
          <div className="dashboard-activity-list">
            {activity.recent.map((item, index) => (
              <div className="dashboard-activity-item" key={`${item.action}-${item.entity_type}-${item.created_at}-${index}`}>
                <span className="dashboard-activity-mark">
                  <Activity size={14} />
                </span>
                <div>
                  <strong>
                    {formatActivity(item.action)} · {formatActivity(item.entity_type)}
                  </strong>
                  <small>{formatDateTime(item.created_at)}</small>
                </div>
              </div>
            ))}
            {activity.recent.length === 0 && <EmptyState text="Workspace activity will appear here." />}
          </div>
        </section>
      </div>

      <section className="panel dashboard-panel dashboard-quick-actions">
        <PanelHeader title="Jump to a module" subtitle="Common workspace destinations" />
        <div className="dashboard-bar-list">
          <div className="dashboard-quick-grid">
            <button type="button" onClick={onOpenAssets}>
              <Box size={16} />
              <span>Asset register</span>
            </button>
            <button type="button" onClick={onOpenInventory}>
              <Archive size={16} />
              <span>Inventory</span>
            </button>
            <button type="button" onClick={onOpenEmployeeRequests}>
              <Users size={16} />
              <span>Employee assets</span>
            </button>
            <button type="button" onClick={onOpenWarranties}>
              <BadgeCheck size={16} />
              <span>Warranties</span>
            </button>
            <button type="button" onClick={onOpenInvoices}>
              <FileText size={16} />
              <span>Invoices</span>
            </button>
            <button type="button" onClick={onOpenWriteOffs}>
              <Package size={16} />
              <span>Write-off</span>
            </button>
            <button type="button" onClick={onOpenReports}>
              <TrendingUp size={16} />
              <span>Reports</span>
            </button>
            <button type="button" onClick={() => onNavigate('Notifications')}>
              <Bell size={16} />
              <span>Notifications</span>
            </button>
            <button type="button" onClick={() => onNavigate('AI Assistant')}>
              <Wrench size={16} />
              <span>AI Assistant</span>
            </button>
          </div>
          <p>
            <CircleAlert size={13} /> {metrics ? `${metrics.pendingInvoices} invoices and ${metrics.pendingApprovals} approvals are waiting on a decision.` : 'Workspace counters are loading.'}
          </p>
        </div>
      </section>

      <div className="dashboard-reference-grid dashboard-recent-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Inventory snapshot" subtitle="Value held in registered hardware" />
          <div className="dashboard-status-content">
            <StatStrip>
              <MiniStat label="Register value" value={money.format(totals.registerValue)} tone="teal" />
              <MiniStat label="In stock" value={assets.filter((asset) => asset.status === 'AVAILABLE').length.toString()} tone="blue" />
              <MiniStat label="Deployed" value={assets.filter((asset) => asset.status === 'ASSIGNED').length.toString()} tone="teal" />
              <MiniStat label="Retired" value={totals.retired.toString()} tone="gray" />
            </StatStrip>
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Receipts by supplier" subtitle="Accepted units per vendor" action="Inventory history" onAction={() => onNavigate('Inventory History')} />
          <div className="dashboard-bar-list">
            <BarChart
              data={Object.entries(
                receipts.reduce<Record<string, number>>((accumulator, receipt) => {
                  accumulator[receipt.vendor] = (accumulator[receipt.vendor] ?? 0) + receipt.accepted_quantity;
                  return accumulator;
                }, {}),
              )
                .sort((left, right) => right[1] - left[1])
                .slice(0, 6)
                .map(([label, value]) => ({ label, value }))}
              height={150}
              emptyLabel="No goods receipts have been recorded."
            />
          </div>
        </section>
      </div>

      <p className="dashboard-footnote">
        Last refreshed {formatDate(new Date().toISOString())} · Figures are derived from the live workspace register.
      </p>
    </div>
  );
}
