import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BadgeCheck,
  CircleAlert,
  Download,
  Loader2,
  Printer,
} from 'lucide-react';
import { BarChart, ChartLegend, DonutChart, HorizontalBars } from '@/components/charts';
import {
  Banner,
  EmptyState,
  FilterSelect,
  MiniStat,
  PageTitle,
  PanelHeader,
  RecordLink,
  SegmentedTabs,
  StatStrip,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  daysUntil,
  downloadCsv,
  formatDate,
  groupCount,
  warrantyStatus,
  warrantyTone,
  WARRANTY_CRITICAL_DAYS,
  WARRANTY_HORIZON_DAYS,
} from '@/lib/format';
import type { Asset, WarrantyStatus } from '@/lib/types';

type WarrantiesProps = {
  assets: Asset[];
  onOpenAssets: () => void;
  onOpenInventory: () => void;
  onOpenAsset: (asset: Asset) => void;
};

type ReportTab = 'COMPLIANCE' | 'FORECAST' | 'COVERAGE' | 'LIFECYCLE';

const reportTabs: { value: ReportTab; label: string }[] = [
  { value: 'COMPLIANCE', label: 'Compliance' },
  { value: 'FORECAST', label: 'Expiration Forecast' },
  { value: 'COVERAGE', label: 'Coverage by Manufacturer' },
  { value: 'LIFECYCLE', label: 'Lifecycle' },
];

export function WarrantiesView({ assets, onOpenAssets, onOpenInventory, onOpenAsset }: WarrantiesProps) {
  const [manufacturerFilter, setManufacturerFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | WarrantyStatus>('ALL');
  const [reportTab, setReportTab] = useState<ReportTab>('COMPLIANCE');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const reportAssets = useMemo(() => assets.filter((asset) => asset.status !== 'RETIRED'), [assets]);
  const manufacturers = useMemo(
    () => [...new Set(reportAssets.map((asset) => asset.manufacturer).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [reportAssets],
  );

  const filteredAssets = useMemo(
    () =>
      reportAssets
        .filter((asset) => manufacturerFilter === 'ALL' || asset.manufacturer === manufacturerFilter)
        .filter((asset) => statusFilter === 'ALL' || warrantyStatus(asset, today, WARRANTY_HORIZON_DAYS) === statusFilter)
        .sort(
          (left, right) =>
            (left.warranty_end || '9999-12-31').localeCompare(right.warranty_end || '9999-12-31') ||
            left.asset_tag.localeCompare(right.asset_tag),
        ),
    [manufacturerFilter, reportAssets, statusFilter, today],
  );

  const counts = useMemo(() => {
    const evaluate = (asset: Asset) => warrantyStatus(asset, today, WARRANTY_HORIZON_DAYS);
    return {
      total: filteredAssets.length,
      active: filteredAssets.filter((asset) => ['ACTIVE', 'EXPIRING'].includes(evaluate(asset))).length,
      expiring: filteredAssets.filter((asset) => evaluate(asset) === 'EXPIRING').length,
      expired: filteredAssets.filter((asset) => evaluate(asset) === 'EXPIRED').length,
      unknown: filteredAssets.filter((asset) => evaluate(asset) === 'UNKNOWN').length,
    };
  }, [filteredAssets, today]);

  const expiringSoon = useMemo(
    () =>
      filteredAssets
        .map((asset) => ({ asset, days: daysUntil(asset.warranty_end, today) }))
        .filter((entry): entry is { asset: Asset; days: number } => entry.days !== null && entry.days >= 0)
        .sort((left, right) => left.days - right.days)
        .slice(0, 10),
    [filteredAssets, today],
  );

  const criticalCount = expiringSoon.filter((entry) => entry.days <= WARRANTY_CRITICAL_DAYS).length;

  const monthlyForecast = useMemo(
    () =>
      Array.from({ length: 12 }, (_, monthOffset) => {
        const month = new Date(`${todayIso}T00:00:00.000Z`);
        month.setUTCDate(1);
        month.setUTCMonth(month.getUTCMonth() + monthOffset);
        const nextMonth = new Date(month);
        nextMonth.setUTCMonth(month.getUTCMonth() + 1);
        const from = monthOffset === 0 ? todayIso : month.toISOString().slice(0, 10);
        const to = new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10);
        const count = filteredAssets.filter((asset) => asset.warranty_end && asset.warranty_end >= from && asset.warranty_end <= to).length;
        return { label: month.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), count };
      }),
    [filteredAssets, todayIso],
  );

  const manufacturerCoverage = useMemo(
    () =>
      manufacturers
        .filter((manufacturer) => manufacturerFilter === 'ALL' || manufacturer === manufacturerFilter)
        .map((manufacturer) => {
          const group = filteredAssets.filter((asset) => asset.manufacturer === manufacturer);
          return {
            manufacturer,
            total: group.length,
            covered: group.filter((asset) => ['ACTIVE', 'EXPIRING'].includes(warrantyStatus(asset, today, WARRANTY_HORIZON_DAYS))).length,
            expired: group.filter((asset) => warrantyStatus(asset, today, WARRANTY_HORIZON_DAYS) === 'EXPIRED').length,
            unknown: group.filter((asset) => warrantyStatus(asset, today, WARRANTY_HORIZON_DAYS) === 'UNKNOWN').length,
          };
        })
        .filter((group) => group.total > 0),
    [filteredAssets, manufacturerFilter, manufacturers, today],
  );

  const lifecycleGroups = useMemo(() => {
    const bands = [
      { label: '<1yr', matches: (years: number) => years < 1 },
      { label: '1-3yr', matches: (years: number) => years >= 1 && years < 3 },
      { label: '3-5yr', matches: (years: number) => years >= 3 && years < 5 },
      { label: '5yr+', matches: (years: number) => years >= 5 },
    ];
    const groups = bands.map(({ label, matches }) => ({
      label,
      count: filteredAssets.filter(
        (asset) =>
          asset.warranty_start &&
          matches((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${asset.warranty_start}T00:00:00Z`)) / (365.25 * 86400000)),
      ).length,
    }));
    groups.push({ label: 'Unknown', count: filteredAssets.filter((asset) => !asset.warranty_start).length });
    return groups;
  }, [filteredAssets, todayIso]);

  const categoryCoverage = useMemo(() => groupCount(filteredAssets, (asset) => asset.manufacturer).slice(0, 8), [filteredAssets]);

  const exportCsv = () => {
    const headers = [
      'Asset Tag',
      'Manufacturer',
      'Model',
      'Serial Number',
      'Category',
      'Custodian',
      'Department',
      'Warranty Start',
      'Warranty End',
      'Asset Status',
      'Warranty Status',
      'Days Remaining',
    ];
    const rows = filteredAssets.map((asset) => [
      asset.asset_tag,
      asset.manufacturer,
      asset.model,
      asset.serial_number,
      asset.category,
      asset.custodian,
      asset.department,
      asset.warranty_start ?? '',
      asset.warranty_end ?? '',
      asset.status,
      warrantyStatus(asset, today, WARRANTY_HORIZON_DAYS),
      daysUntil(asset.warranty_end, today) ?? '',
    ]);
    downloadCsv('warranty-report.csv', [headers, ...rows]);
  };

  const downloadExcel = async () => {
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (manufacturerFilter !== 'ALL') params.set('manufacturer', manufacturerFilter);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const blob = await api.download(`/api/assets/warranty-report/export?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'warranty-report.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not download the warranty report.');
    } finally {
      setExporting(false);
    }
  };

  const panelTitle = {
    COMPLIANCE: 'Warranty Compliance',
    FORECAST: 'Expiration Forecast',
    COVERAGE: 'Coverage by Manufacturer',
    LIFECYCLE: 'Asset Lifecycle',
  }[reportTab];

  return (
    <div className="fade-in warranty-report">
      <PageTitle
        eyebrow="Asset lifecycle · Reports"
        title="Warranty Reports"
        copy="Compliance, forecast, coverage and lifecycle from your registered assets."
      >
        <button className="button button-secondary" onClick={onOpenInventory}>
          <BadgeCheck size={16} /> Inventory
        </button>
        <button className="button button-secondary" onClick={onOpenAssets}>
          Asset register
        </button>
      </PageTitle>

      {criticalCount > 0 && (
        <Banner tone="amber" title="Warranties expiring soon">
          {criticalCount} asset{criticalCount === 1 ? '' : 's'} expire within {WARRANTY_CRITICAL_DAYS} days. Plan renewals or replacement now.
        </Banner>
      )}

      <StatStrip className="warranty-report-stats">
        <MiniStat label="Total" value={counts.total.toString()} tone="blue" />
        <MiniStat label="Active" value={counts.active.toString()} tone="teal" />
        <MiniStat label={`Expiring ≤${WARRANTY_HORIZON_DAYS}d`} value={counts.expiring.toString()} tone="amber" />
        <MiniStat label="Expired" value={counts.expired.toString()} tone="red" />
        <MiniStat label="Unknown" value={counts.unknown.toString()} tone="gray" />
      </StatStrip>

      <section className="panel warranty-filter-panel">
        <FilterSelect label="Manufacturer" value={manufacturerFilter} onChange={setManufacturerFilter}>
          <option value="ALL">All manufacturers</option>
          {manufacturers.map((manufacturer) => (
            <option key={manufacturer} value={manufacturer}>
              {manufacturer}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Warranty Status" value={statusFilter} onChange={(value) => setStatusFilter(value as 'ALL' | WarrantyStatus)}>
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="EXPIRING">Expiring within {WARRANTY_HORIZON_DAYS} days</option>
          <option value="EXPIRED">Expired</option>
          <option value="UNKNOWN">Not recorded</option>
        </FilterSelect>
        <span className="warranty-scope-count">{filteredAssets.length} assets in scope</span>
      </section>

      <div className="dashboard-reference-grid dashboard-chart-grid">
        <section className="panel dashboard-panel">
          <PanelHeader title="Coverage by manufacturer" subtitle="Registered assets per manufacturer" />
          <div className="portfolio-content">
            <div className="donut-wrap">
              <DonutChart
                data={categoryCoverage}
                centerValue={counts.total.toString()}
                centerLabel="assets"
                size={168}
                thickness={28}
              />
            </div>
            <ChartLegend data={categoryCoverage} />
          </div>
        </section>

        <section className="panel dashboard-panel">
          <PanelHeader title="Expirations — next 12 months" subtitle="Warranty end dates by month" />
          <div className="dashboard-chart-body">
            <BarChart data={monthlyForecast} height={200} emptyLabel="No warranty end dates are recorded." />
          </div>
        </section>
      </div>

      {expiringSoon.length > 0 && (
        <section className="panel dashboard-panel">
          <PanelHeader title="Expiring soon" subtitle={`Warranties ending within ${WARRANTY_HORIZON_DAYS} days`} />
          <div className="warranty-expiring-list">
            {expiringSoon.map(({ asset, days }) => (
              <button type="button" className="warranty-expiring-row" key={asset.id} onClick={() => onOpenAsset(asset)}>
                <span className="warranty-expiring-copy">
                  <strong>
                    {asset.manufacturer} {asset.model}
                  </strong>
                  <small>{asset.serial_number}</small>
                </span>
                <span className={`warranty-expiring-badge ${days <= WARRANTY_CRITICAL_DAYS ? 'critical' : days <= 60 ? 'warning' : ''}`}>
                  {days}d · {formatDate(asset.warranty_end)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel warranty-report-panel">
        <SegmentedTabs value={reportTab} onChange={setReportTab} options={reportTabs} ariaLabel="Warranty report views" />
        <div className="warranty-report-body">
          <div className="warranty-report-panel-heading">
            <div>
              <h2>{panelTitle}</h2>
              <p>
                {reportTab === 'COMPLIANCE'
                  ? 'Registered asset coverage based on warranty dates.'
                  : reportTab === 'FORECAST'
                    ? 'Expirations grouped by month for the next 12 months.'
                    : reportTab === 'COVERAGE'
                      ? 'Coverage status grouped by manufacturer.'
                      : 'Age of warranty coverage, grouped by recorded warranty start.'}
              </p>
            </div>
            <div className="warranty-export-actions">
              <button className="button button-secondary" onClick={() => window.print()}>
                <Printer size={14} /> PDF
              </button>
              <button className="button button-secondary" onClick={() => void downloadExcel()} disabled={exporting}>
                {exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Excel
              </button>
              <button className="button button-secondary" onClick={exportCsv}>
                <Download size={14} /> CSV
              </button>
            </div>
          </div>
          {error && (
            <div className="auth-message module-error" role="alert">
              {error}
            </div>
          )}

          {reportTab === 'COMPLIANCE' && (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Make</th>
                    <th>Model</th>
                    <th>Serial</th>
                    <th>Warranty End</th>
                    <th>Asset Status</th>
                    <th>Coverage</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.map((asset) => {
                    const coverage = warrantyStatus(asset, today, WARRANTY_HORIZON_DAYS);
                    return (
                      <tr key={asset.id}>
                        <td>{asset.manufacturer}</td>
                        <td>{asset.model}</td>
                        <td>
                          <RecordLink onClick={() => onOpenAsset(asset)}>{asset.serial_number}</RecordLink>
                        </td>
                        <td>{asset.warranty_end ? formatDate(asset.warranty_end) : '—'}</td>
                        <td>
                          <StatusBadge status={asset.status} />
                        </td>
                        <td>
                          <StatusBadge status={warrantyTone(coverage)} />
                        </td>
                        <td>
                          <button className="row-action" onClick={() => onOpenAsset(asset)}>
                            <ArrowUpRight size={14} /> Open asset
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredAssets.length === 0 && <EmptyState text="No registered assets match these warranty filters." />}
            </div>
          )}

          {reportTab === 'FORECAST' && (
            <div className="warranty-forecast" aria-label="Asset warranty expirations by month">
              {monthlyForecast.map(({ label, count }) => (
                <div className="warranty-forecast-row" key={label}>
                  <span>{label}</span>
                  <div className="warranty-forecast-track">
                    <span style={{ width: `${count ? Math.max((count / Math.max(...monthlyForecast.map((item) => item.count), 1)) * 100, 4) : 0}%` }} />
                  </div>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          )}

          {reportTab === 'COVERAGE' && (
            <div className="warranty-group-list">
              {manufacturerCoverage.map((group) => (
                <article className="warranty-group-row" key={group.manufacturer}>
                  <div className="warranty-group-title">
                    <strong>{group.manufacturer}</strong>
                    <span>
                      {group.total} asset{group.total === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="warranty-group-track">
                    <span className="covered-segment" style={{ width: `${group.total ? (group.covered / group.total) * 100 : 0}%` }} />
                    <span className="expired-segment" style={{ width: `${group.total ? (group.expired / group.total) * 100 : 0}%` }} />
                  </div>
                  <div className="warranty-group-legend">
                    <span>
                      <i className="covered-segment" /> Covered {group.covered}
                    </span>
                    <span>
                      <i className="expired-segment" /> Expired {group.expired}
                    </span>
                    <span>Unknown {group.unknown}</span>
                  </div>
                </article>
              ))}
              {manufacturerCoverage.length === 0 && <EmptyState text="No manufacturers match these warranty filters." />}
            </div>
          )}

          {reportTab === 'LIFECYCLE' && (
            <div className="warranty-report-body">
              <HorizontalBars
                data={lifecycleGroups.map((group) => ({ label: group.label, value: group.count }))}
                emptyLabel="No warranty start dates are recorded."
              />
              <p className="warranty-report-note">
                <CircleAlert size={13} /> Coverage age is calculated from the recorded warranty start date.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
