import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Box,
  CircleDollarSign,
  Download,
  FileText,
  Package,
  TrendingUp,
  Users,
} from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { BarChart, ChartLegend, DonutChart, HorizontalBars, TrendChart } from '@/components/charts';
import {
  EmptyState,
  FilterSelect,
  InlineError,
  MetricCard,
  Modal,
  PageTitle,
  PanelHeader,
  SegmentedTabs,
  StatStrip,
  MiniStat,
} from '@/components/ui';
import { compactMoney, downloadBlob, downloadCsv, formatDate, groupCount, money, warrantyStatus } from '@/lib/format';
import type {
  Asset,
  DashboardMetrics,
  EmployeeAssetAssignment,
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
type ReportType = 'all' | 'complete' | 'assets' | 'employees' | 'writeoffs' | 'summary';
type ExportFormat = 'csv' | 'pdf';
type ReportSection = { title: string; headers: string[]; rows: (string | number)[][] };
type ReportDocument = { title: string; sections: ReportSection[] };

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

function toExcelColumn(index: number) {
  let column = '';
  let remaining = index;
  while (remaining > 0) {
    remaining -= 1;
    column = String.fromCharCode(65 + (remaining % 26)) + column;
    remaining = Math.floor(remaining / 26);
  }
  return column;
}

export function ReportsView({ assets, invoices, requests, receipts, writeOffs, metrics }: ReportsProps) {
  const [range, setRange] = useState<Range>('90');
  const [department, setDepartment] = useState('ALL');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [reportType, setReportType] = useState<ReportType>('all');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [printReport, setPrintReport] = useState<(ReportDocument & { generatedAt: string }) | null>(null);

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
    () => groupCount(writeOffs, (request) => request.reason).slice(0, 8).map((group) => ({ label: group.name, value: group.value })),
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

  const assetSection = (): ReportSection => ({
    title: 'Asset Register Details',
    headers: ['Asset ID', 'Asset Tag', 'Barcode', 'Category', 'Manufacturer', 'Model', 'Serial Number', 'Status', 'Condition', 'Custodian', 'Location', 'Purchase Cost', 'Purchase Order', 'Warranty Start', 'Warranty End', 'Department', 'Last Audited At', 'Created At', 'Updated At'],
    rows: scopedAssets.map((asset) => [
      asset.id, asset.asset_tag, asset.barcode_value ?? '', asset.category, asset.manufacturer, asset.model,
      asset.serial_number, asset.status, asset.condition, asset.custodian, asset.location, asset.purchase_cost,
      asset.purchase_order ?? '', asset.warranty_start ?? '', asset.warranty_end ?? '', asset.department,
      asset.last_audited_at ?? '', asset.created_at ?? '', asset.updated_at ?? '',
    ]),
  });

  const employeeSection = (assignments: EmployeeAssetAssignment[]): ReportSection => {
    const scopedAssignments = department === 'ALL'
      ? assignments
      : assignments.filter((assignment) => assignment.department === department);
    return {
      title: 'Employee Assignment Details',
      headers: ['Employee Name', 'Employee ID', 'Designation', 'Department', 'Asset Model', 'Serial Number', 'Date of Joining', 'Remarks', 'Assignment Created At', 'Assignment Updated At'],
      rows: scopedAssignments.map((assignment) => [
        assignment.employee_name, assignment.employee_id, assignment.designation, assignment.department,
        assignment.asset_model, assignment.serial_number, assignment.doj, assignment.remarks,
        assignment.created_at ?? '', assignment.updated_at ?? '',
      ]),
    };
  };

  const writeOffSection = (writeOffRecords: WriteOffRequest[], assignments: EmployeeAssetAssignment[]): ReportSection => {
    const scopedAssetIds = new Set(scopedAssets.map((asset) => asset.id));
    const scopedWriteOffs = department === 'ALL'
      ? writeOffRecords
      : writeOffRecords.filter((request) => scopedAssetIds.has(request.asset_id));
    const assignmentsBySerial = new Map<string, EmployeeAssetAssignment[]>();
    for (const assignment of assignments) {
      const serialNumber = assignment.serial_number.trim().toLowerCase();
      if (!serialNumber) continue;
      assignmentsBySerial.set(serialNumber, [...(assignmentsBySerial.get(serialNumber) ?? []), assignment]);
    }
    return {
      title: 'Write-Off Requests',
      headers: ['Request ID', 'Asset Tag', 'Manufacturer', 'Model', 'Asset Status', 'Reason', 'Write-Off Date', 'Request Status', 'Requester', 'Requester ID', 'Buyback Employee Name', 'Buyback Employee ID', 'Buyback Employee Designation', 'Buyback Employee Department', 'Approved By', 'Review Note', 'Reviewer', 'Reviewed At', 'Created At', 'Updated At'],
      rows: scopedWriteOffs.map((request) => {
        const asset = assets.find((item) => item.id === request.asset_id);
        const matchingAssignments = asset
          ? assignmentsBySerial.get(asset.serial_number.trim().toLowerCase()) ?? []
          : [];
        const fallbackEmployee = request.reason === 'Buyback' && matchingAssignments.length === 1
          ? matchingAssignments[0]
          : undefined;
        return [
          request.id, request.asset_tag, request.manufacturer, request.model, request.asset_status, request.reason,
          request.write_off_date ?? '', request.status, request.requester_name, request.requester_id ?? '',
          request.buyback_employee_name || fallbackEmployee?.employee_name
            || (request.reason === 'Buyback' ? 'Not recorded on original request' : ''),
          request.buyback_employee_id || fallbackEmployee?.employee_id || '',
          request.buyback_employee_designation || fallbackEmployee?.designation || '',
          request.buyback_employee_department || fallbackEmployee?.department || '',
          request.approved_by ?? '', request.review_note ?? '', request.reviewer_name ?? '',
          request.reviewed_at ?? '', request.created_at, request.updated_at ?? '',
        ];
      }),
    };
  };

  const summarySection = (writeOffRecords: WriteOffRequest[]): ReportSection => ({
    title: 'Current Dashboard Summary',
    headers: ['Report', 'Metric', 'Value'],
    rows: [
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
      ['Write-offs', 'Pending approvals', writeOffRecords.filter((request) => request.status === 'PENDING_APPROVAL').length],
      ['Write-offs', 'Total requests', writeOffRecords.length],
      ['Inventory', 'Goods receipts', receipts.length],
      ['Inventory', 'Accepted units', receipts.reduce((sum, receipt) => sum + receipt.accepted_quantity, 0)],
      ['Inventory', 'Rejected units', receipts.reduce((sum, receipt) => sum + receipt.rejected_quantity, 0)],
    ],
  });

  const completeSection = (assignments: EmployeeAssetAssignment[]): ReportSection => {
    const assignmentBySerial = new Map<string, EmployeeAssetAssignment>();
    for (const assignment of assignments) {
      const serialNumber = assignment.serial_number.trim().toLowerCase();
      if (serialNumber && !assignmentBySerial.has(serialNumber)) assignmentBySerial.set(serialNumber, assignment);
    }
    return {
      title: 'Complete Asset and Employee Details',
      headers: ['Asset ID', 'Asset Tag', 'Barcode', 'Category', 'Manufacturer', 'Model', 'Serial Number', 'Asset Status', 'Condition', 'Custodian', 'Location', 'Purchase Cost', 'Purchase Order', 'Warranty Start', 'Warranty End', 'Asset Department', 'Last Audited At', 'Asset Created At', 'Asset Updated At', 'Employee Name', 'Employee ID', 'Employee Designation', 'Employee Department', 'Employee Asset Model', 'Employee Serial Number', 'Employee DoJ', 'Employee Remarks', 'Assignment Created At', 'Assignment Updated At'],
      rows: scopedAssets.map((asset) => {
        const assignment = assignmentBySerial.get(asset.serial_number.trim().toLowerCase());
        return [
          asset.id, asset.asset_tag, asset.barcode_value ?? '', asset.category, asset.manufacturer, asset.model,
          asset.serial_number, asset.status, asset.condition, asset.custodian, asset.location, asset.purchase_cost,
          asset.purchase_order ?? '', asset.warranty_start ?? '', asset.warranty_end ?? '', asset.department,
          asset.last_audited_at ?? '', asset.created_at ?? '', asset.updated_at ?? '',
          assignment?.employee_name ?? '', assignment?.employee_id ?? '', assignment?.designation ?? '',
          assignment?.department ?? '', assignment?.asset_model ?? '', assignment?.serial_number ?? '',
          assignment?.doj ?? '', assignment?.remarks ?? '', assignment?.created_at ?? '', assignment?.updated_at ?? '',
        ];
      }),
    };
  };

  const buildReportDocument = (assignments: EmployeeAssetAssignment[], writeOffRecords: WriteOffRequest[]): ReportDocument => {
    if (reportType === 'assets') return { title: 'Asset Register Details', sections: [assetSection()] };
    if (reportType === 'employees') return { title: 'Employee Assignment Details', sections: [employeeSection(assignments)] };
    if (reportType === 'writeoffs') return { title: 'Write-Off Requests', sections: [writeOffSection(writeOffRecords, assignments)] };
    if (reportType === 'complete') return { title: 'Complete Asset and Employee Details', sections: [completeSection(assignments)] };
    if (reportType === 'summary') return { title: 'Current Dashboard Summary', sections: [summarySection(writeOffRecords)] };
    return {
      title: 'All - Complete Report',
      sections: [assetSection(), employeeSection(assignments), writeOffSection(writeOffRecords, assignments), summarySection(writeOffRecords)],
    };
  };

  const generateReport = async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      const assignments = ['all', 'complete', 'employees', 'writeoffs'].includes(reportType)
        ? await api.get<EmployeeAssetAssignment[]>('/api/workflows/employee-assignments')
        : [];
      const writeOffRecords = ['all', 'writeoffs', 'summary'].includes(reportType)
        ? await api.get<WriteOffRequest[]>('/api/workflows/write-offs')
        : writeOffs;
      const report = buildReportDocument(assignments, writeOffRecords);
      if (exportFormat === 'csv') {
        if (reportType === 'all') {
          const { default: XlsxPopulate } = await import('xlsx-populate/browser/xlsx-populate.js');
          const workbook = await XlsxPopulate.fromBlankAsync();
          report.sections.forEach((section, index) => {
            const sheetName = section.title.slice(0, 31);
            const sheet = index === 0
              ? workbook.sheet(0).name(sheetName)
              : workbook.addSheet(sheetName);
            const lastColumn = toExcelColumn(section.headers.length);
            sheet.range(`A1:${lastColumn}1`).value([section.headers]);
            sheet.range(`A1:${lastColumn}1`).style({ bold: true, fill: '1F5874', fontColor: 'FFFFFF' });
            sheet.autoFilter(sheet.range(`A1:${lastColumn}${Math.max(section.rows.length + 1, 1)}`));
            sheet.freezePanes(0, 1);
            section.headers.forEach((header, columnIndex) => {
              sheet.column(toExcelColumn(columnIndex + 1)).width(Math.min(Math.max(header.length + 4, 16), 32));
            });
            if (section.rows.length) {
              sheet.range(`A2:${lastColumn}${section.rows.length + 1}`).value(section.rows);
            }
          });
          const blob = await workbook.outputAsync({ type: 'blob' });
          downloadBlob(
            `bigbasket-itam-all-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
            blob,
          );
          setExportDialogOpen(false);
          return;
        }
        const csvRows = report.sections.flatMap((section) => [
          [section.title],
          section.headers,
          ...section.rows,
          [],
        ]);
        downloadCsv(
          `bigbasket-itam-${reportType}-report-${new Date().toISOString().slice(0, 10)}.csv`,
          csvRows,
        );
        setExportDialogOpen(false);
      } else {
        setPrintReport({ ...report, generatedAt: new Date().toLocaleString() });
        setExportDialogOpen(false);
      }
    } catch (error) {
      setExportError(error instanceof ApiError ? error.message : 'Could not generate this report.');
    } finally {
      setExportBusy(false);
    }
  };

  useEffect(() => {
    if (!printReport) return;
    window.print();
    setPrintReport(null);
  }, [printReport]);

  return (
    <div className="fade-in reports-view">
      <PageTitle eyebrow="Workspace · Analytics" title="Reports" copy="Current asset, spend, warranty, and workflow summaries.">
        <button type="button" className="button button-primary" onClick={() => {
          setExportError(null);
          setExportDialogOpen(true);
        }}>
          <Download size={16} /> Export Report
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

      {exportDialogOpen && (
        <Modal
          title="Generate report"
          eyebrow="Reports"
          subtitle="Choose a report and export format."
          onClose={() => setExportDialogOpen(false)}
          busy={exportBusy}
          footer={(
            <>
              <button type="button" className="button button-secondary" disabled={exportBusy} onClick={() => setExportDialogOpen(false)}>Cancel</button>
              <button type="button" className="button button-primary" disabled={exportBusy} onClick={() => void generateReport()}>
                <Download size={15} /> {exportBusy ? 'Generating...' : 'Generate report'}
              </button>
            </>
          )}
        >
          <div className="form-grid report-export-grid">
            <label>
              Report
              <select value={reportType} disabled={exportBusy} onChange={(event) => setReportType(event.target.value as ReportType)}>
                <option value="all">All - Complete Report</option>
                <option value="complete">Complete asset + employee details</option>
                <option value="assets">Asset register details</option>
                <option value="employees">Employee assignment details</option>
                <option value="writeoffs">Write-Off requests</option>
                <option value="summary">Current dashboard summary</option>
              </select>
            </label>
            <label>
              Format
              <select value={exportFormat} disabled={exportBusy} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
                <option value="csv">{reportType === 'all' ? 'Spreadsheet (.xlsx, multiple sheets)' : 'CSV spreadsheet'}</option>
                <option value="pdf">PDF (print dialog)</option>
              </select>
            </label>
          </div>
          <p className="report-export-help">
            {reportType === 'all'
              ? 'Includes complete asset details, employee assignments, write-off requests, and dashboard summaries. Spreadsheet export downloads an Excel workbook with a separate sheet for each report.'
              : reportType === 'complete'
              ? 'Includes all asset fields and matching employee assignment details, linked by serial number.'
              : reportType === 'assets'
                ? 'Includes complete asset register details for the selected department.'
                : reportType === 'employees'
                  ? 'Includes employee assignment details for the selected department.'
                  : reportType === 'writeoffs'
                    ? 'Includes all write-off requests, review status, and Buyback employee details.'
                    : 'Includes current dashboard totals and workflow summaries.'}
            {exportFormat === 'pdf'
              ? ' The browser print dialog will open; choose Save as PDF.'
              : reportType !== 'all'
                ? ''
                : ' CSV cannot contain multiple sheets, so this report downloads as an .xlsx workbook.'}
          </p>
          {exportError && <InlineError message={exportError} />}
        </Modal>
      )}

      {printReport && (
        <section className="report-print-sheet" aria-hidden="true">
          <h1>{printReport.title}</h1>
          <p>Generated {printReport.generatedAt} · Department: {department === 'ALL' ? 'All departments' : department}</p>
          {printReport.sections.map((section) => (
            <section className="report-print-section" key={section.title}>
              <h2>{section.title}</h2>
              <table>
                <thead><tr>{section.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                <tbody>
                  {section.rows.length ? section.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={`${rowIndex}-${columnIndex}`}>{String(value)}</td>)}</tr>
                  )) : <tr><td colSpan={section.headers.length}>No records found for this section.</td></tr>}
                </tbody>
              </table>
            </section>
          ))}
        </section>
      )}
    </div>
  );
}
