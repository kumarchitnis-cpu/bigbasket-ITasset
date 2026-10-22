import { CHART_COLORS } from '@/lib/chart-colors';

export type ChartDatum = { name: string; value: number };

export function DonutChart({
  data,
  size = 190,
  thickness = 34,
  centerLabel,
  centerValue,
  emptyLabel = 'No data',
}: {
  data: ChartDatum[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  emptyLabel?: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="chart-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribution chart">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#eef2f3"
            strokeWidth={thickness}
          />
          {total > 0 &&
            data.map((item, index) => {
              const fraction = item.value / total;
              const length = circumference * fraction;
              const dash = `${length} ${circumference - length}`;
              const circle = (
                <circle
                  key={item.name}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={CHART_COLORS[index % CHART_COLORS.length]}
                  strokeWidth={thickness}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                >
                  <title>{`${item.name}: ${item.value}`}</title>
                </circle>
              );
              offset += length;
              return circle;
            })}
        </g>
      </svg>
      {(centerValue || centerLabel) && (
        <div className="chart-donut-center">
          {centerValue && <strong>{centerValue}</strong>}
          {centerLabel && <span>{centerLabel}</span>}
        </div>
      )}
      {total === 0 && <div className="chart-empty-overlay">{emptyLabel}</div>}
    </div>
  );
}

export function ChartLegend({ data }: { data: ChartDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="chart-legend">
      {data.map((item, index) => (
        <div className="chart-legend-row" key={item.name}>
          <span
            className="chart-legend-dot"
            style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
            aria-hidden="true"
          />
          <span className="chart-legend-label">{item.name}</span>
          <strong>{item.value}</strong>
          <span className="chart-legend-percent">
            {total ? Math.round((item.value / total) * 100) : 0}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function BarChart({
  data,
  color = '#1f5874',
  height = 210,
  emptyLabel = 'No data to display',
  valueSuffix = '',
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  emptyLabel?: string;
  valueSuffix?: string;
}) {
  const maximum = Math.max(...data.map((item) => item.value), 1);
  if (data.length === 0) {
    return <div className="chart-empty">{emptyLabel}</div>;
  }
  return (
    <div className="chart-bars" style={{ minHeight: height }}>
      {data.map((item) => (
        <div className="chart-bar-column" key={item.label}>
          <div className="chart-bar-track">
            <span
              style={{
                height: `${item.value ? Math.max((item.value / maximum) * 100, 3) : 0}%`,
                background: color,
              }}
              title={`${item.label}: ${item.value}${valueSuffix}`}
            />
          </div>
          <strong>{item.value}</strong>
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

export function StackedActivityChart({
  data,
  height = 200,
}: {
  data: { label: string; deleted: number; restored: number }[];
  height?: number;
}) {
  const maximum = Math.max(...data.map((item) => item.deleted + item.restored), 1);
  if (data.length === 0) {
    return <div className="chart-empty">No delete or restore activity recorded yet.</div>;
  }
  return (
    <div className="chart-stacked" style={{ minHeight: height }}>
      {data.map((item) => (
        <div className="chart-stacked-column" key={item.label} title={`${item.label}: ${item.deleted} deleted · ${item.restored} restored`}>
          <div className="chart-stacked-track">
            <span className="chart-stacked-restored" style={{ height: `${(item.restored / maximum) * 100}%` }} />
            <span className="chart-stacked-deleted" style={{ height: `${(item.deleted / maximum) * 100}%` }} />
          </div>
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({
  values,
  color = '#4b9b93',
  height = 170,
  emptyLabel = 'No activity recorded yet',
}: {
  values: { label: string; value: number }[];
  color?: string;
  height?: number;
  emptyLabel?: string;
}) {
  if (values.length === 0) {
    return <div className="chart-empty">{emptyLabel}</div>;
  }
  const maximum = Math.max(...values.map((item) => item.value), 1);
  const width = 100;
  const points = values.map((item, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = 100 - (item.value / maximum) * 92;
    return { x, y, item };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `0,100 ${line} ${width},100`;

  return (
    <div className="chart-trend" style={{ minHeight: height }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="chart-trend-svg" role="img">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#trendFill)" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-trend-axis">
        <span>{values[0]?.label}</span>
        <span>{values[Math.floor(values.length / 2)]?.label}</span>
        <span>{values[values.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export function HorizontalBars({
  data,
  emptyLabel = 'No data to display',
}: {
  data: { label: string; value: number; tone?: string }[];
  emptyLabel?: string;
}) {
  const maximum = Math.max(...data.map((item) => item.value), 1);
  if (data.length === 0) {
    return <div className="chart-empty">{emptyLabel}</div>;
  }
  return (
    <div className="chart-horizontal">
      {data.map((item) => (
        <div className="chart-horizontal-row" key={item.label}>
          <div className="chart-horizontal-label">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
          <div className="chart-horizontal-track">
            <span className={item.tone ?? ''} style={{ width: `${(item.value / maximum) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
