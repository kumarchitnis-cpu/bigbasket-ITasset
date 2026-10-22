import { useMemo, useState } from 'react';
import { Bell, BellOff, CheckCheck, Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import type { WorkspaceNotification } from '@/lib/types';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { EmptyState, InlineError, MiniStat, PageTitle, PanelHeader, SegmentedTabs, StatStrip } from '@/components/ui';

const notificationTypeLabels: Record<string, string> = {
  ASSET_ASSIGNED: 'Assignment',
  ASSET_RETURNED: 'Return',
  ASSET_TRANSFERRED: 'Transfer',
  ASSET_QUARANTINED: 'Quarantine',
  ASSET_RETIRED: 'Retirement',
  MAINTENANCE_STARTED: 'Maintenance',
  MAINTENANCE_COMPLETED: 'Maintenance',
  INVOICE_UPLOADED: 'Invoice',
  INVOICE_PROCESSED: 'Invoice',
  EMPLOYEE_REQUEST: 'Employee request',
  WRITE_OFF_REQUEST: 'Write-off',
  WRITE_OFF_APPROVED: 'Write-off',
  WRITE_OFF_REJECTED: 'Write-off',
  ASSET_CREATED: 'Asset',
  ASSET_UPDATED: 'Asset',
  USER_ROLE_CHANGED: 'Access',
};

export function NotificationsView({
  notifications,
  onRead,
  onReadAll,
  onDelete,
}: {
  notifications: WorkspaceNotification[];
  onRead: (id: string) => Promise<void>;
  onReadAll: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'ALL' | 'UNREAD' | 'READ'>('ALL');

  const unreadCount = notifications.filter((notification) => !notification.read_at).length;
  const visible = useMemo(() => notifications.filter((notification) => (tab === 'ALL' ? true : tab === 'UNREAD' ? !notification.read_at : Boolean(notification.read_at))), [notifications, tab]);

  const markRead = async (id: string) => {
    setError(null);
    setBusy(id);
    try {
      await onRead(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark this notification as read.');
    } finally {
      setBusy(null);
    }
  };

  const markAllRead = async () => {
    setError(null);
    setBusy('all');
    try {
      await onReadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark all notifications as read.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    setBusy(id);
    try {
      await onDelete(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this notification.');
    } finally {
      setBusy(null);
    }
  };

  const typeGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const notification of notifications) {
      const key = notificationTypeLabels[notification.event_type] ?? 'Workspace';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [notifications]);

  return (
    <div className="fade-in">
      <PageTitle eyebrow="Workspace / Activity" title="Notifications" copy="Requests and workflow updates relevant to your account.">
        {unreadCount > 0 && (
          <button className="button button-secondary" onClick={() => void markAllRead()} disabled={busy === 'all'}>
            <CheckCheck size={16} /> Mark all read
          </button>
        )}
      </PageTitle>

      <StatStrip>
        <MiniStat label="Total" value={notifications.length.toString()} tone="blue" />
        <MiniStat label="Unread" value={unreadCount.toString()} tone="amber" />
        <MiniStat label="Read" value={(notifications.length - unreadCount).toString()} tone="teal" />
        <MiniStat label="Categories" value={typeGroups.length.toString()} tone="blue" />
      </StatStrip>

      {error && <InlineError message={error} />}

      <SegmentedTabs
        ariaLabel="Filter notifications by read state"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ALL', label: `All (${notifications.length})` },
          { value: 'UNREAD', label: `Unread (${unreadCount})` },
          { value: 'READ', label: `Read (${notifications.length - unreadCount})` },
        ]}
      />

      <section className="panel table-panel full-panel module-panel-gap">
        <PanelHeader title="Recent notifications" subtitle={`${unreadCount} unread`} />
        <div className="notification-list">
          {visible.map((notification) => (
            <article className={`notification-row ${notification.read_at ? '' : 'unread'}`} key={notification.id}>
              <div className="notification-icon">
                <Bell size={16} />
              </div>
              <div className="notification-copy">
                <strong>{notification.title}</strong>
                <span>{notification.body}</span>
                <small>
                  <span className="notification-type">{notificationTypeLabels[notification.event_type] ?? 'Workspace'}</span>
                  {formatDateTime(notification.created_at)} · {formatRelativeTime(notification.created_at)}
                </small>
              </div>
              {!notification.read_at && (
                <button className="button button-secondary mark-read-button" onClick={() => void markRead(notification.id)} disabled={busy === notification.id}>
                  Mark read
                </button>
              )}
              <button className="notification-delete-button" aria-label={`Delete notification ${notification.title}`} onClick={() => void remove(notification.id)} disabled={busy === notification.id}>
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </div>
        {visible.length === 0 && <EmptyState icon={notifications.length ? BellOff : Bell} text={notifications.length ? 'No notifications match this filter.' : 'You have no notifications yet.'} />}
      </section>
    </div>
  );
}
