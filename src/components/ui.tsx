import { type FormEvent, type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  CircleAlert,
  Loader2,
  RefreshCw,
  Search,
  Tag,
  X,
} from 'lucide-react';

export function StatusBadge({ status }: { status: string }) {
  const label = status.split('_').join(' ');
  return (
    <span className={`status-badge ${status.toLowerCase()}`}>
      <span aria-hidden="true" />
      {label.charAt(0) + label.slice(1).toLowerCase()}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  note,
  icon: Icon,
  tone = 'blue',
  trend,
  down,
  onClick,
}: {
  label: string;
  value: string;
  note?: string;
  icon?: React.ComponentType<{ size?: number }>;
  tone?: string;
  trend?: string;
  down?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      {Icon && (
        <div className={`metric-icon ${tone}`}>
          <Icon size={18} />
        </div>
      )}
      <div className="metric-label">{label}</div>
      <div className="metric-value-row">
        <strong>{value}</strong>
        {trend && (
          <span className={`trend ${down ? 'down' : ''}`}>
            {trend}
          </span>
        )}
      </div>
      {note && <div className="metric-note">{note}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="metric-card metric-card-link" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="metric-card">{content}</div>;
}

export function MiniStat({ label, value, tone = 'blue', note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="mini-stat">
      <span className={`mini-dot ${tone}`} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {note && <small>{note}</small>}
      </div>
    </div>
  );
}

export function StatStrip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`stat-strip ${className}`}>{children}</div>;
}

export function PanelHeader({
  title,
  subtitle,
  action,
  onAction,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="panel-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && onAction && (
        <button type="button" className="text-button" onClick={onAction}>
          {action} <ArrowUpRight size={14} />
        </button>
      )}
      {children}
    </div>
  );
}

export function PageTitle({
  eyebrow,
  title,
  copy,
  action,
  icon: Icon,
  onAction,
  children,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action?: string;
  icon?: React.ComponentType<{ size?: number }>;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="heading-copy">{copy}</p>
      </div>
      <div className="heading-actions">
        {children}
        {action && Icon && onAction && (
          <button className="button button-primary" onClick={onAction}>
            <Icon size={17} /> {action}
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ text, icon: Icon = Tag }: { text: string; icon?: React.ComponentType<{ size?: number }> }) {
  return (
    <div className="empty-state">
      <Icon size={18} />
      <span>{text}</span>
    </div>
  );
}

export function LoadingState({ label = 'Loading your workspace' }: { label?: string }) {
  return (
    <div className="state-card">
      <Loader2 size={23} className="spin" />
      <strong>{label}</strong>
      <span>Gathering the latest operational data...</span>
    </div>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  return (
    <div className="state-card error-state">
      <CircleAlert size={25} />
      <strong>Workspace unavailable</strong>
      <span>{message || 'We could not retrieve the latest records.'}</span>
      {onRetry && (
        <button className="button button-primary" onClick={onRetry}>
          <RefreshCw size={16} /> Try again
        </button>
      )}
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="auth-message module-error" role="alert">
      {message}
      {onRetry && (
        <button type="button" className="text-button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function InlineSuccess({ message }: { message: string }) {
  return (
    <div className="settings-success" role="status">
      {message}
    </div>
  );
}

export function Banner({
  tone = 'amber',
  title,
  children,
}: {
  tone?: 'amber' | 'info' | 'danger';
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`module-banner ${tone}`}>
      <CircleAlert size={16} />
      <div>
        <strong>{title}</strong>
        {children && <span>{children}</span>}
      </div>
    </div>
  );
}

export function Avatar({ name, size = 'small' }: { name: string; size?: 'small' | 'dark' | 'light' }) {
  const letters = name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return <div className={`avatar avatar-${size}`}>{letters}</div>;
}

export function RecordLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="record-link" onClick={onClick}>
      {children}
    </button>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="invoice-search">
      <Search size={16} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="invoice-filter-label">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {children}
      </select>
    </label>
  );
}

export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div className="segmented-tabs" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  eyebrow,
  subtitle,
  onClose,
  children,
  footer,
  width = 'default',
  busy,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'default' | 'wide' | 'narrow';
  busy?: boolean;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`modal-card modal-card-${width}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
            {subtitle && <span className="asset-modal-model">{subtitle}</span>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ModalForm({
  onSubmit,
  children,
  className = '',
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form className={className} onSubmit={onSubmit}>
      {children}
    </form>
  );
}

export function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="asset-detail-grid">{children}</div>;
}

export function DetailCell({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'record-details-wide' : undefined}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}
