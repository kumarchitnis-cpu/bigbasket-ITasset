import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import { ApiError, api, type AppUser } from '@/lib/api';
import type { ManagedUser } from '@/lib/types';
import { formatDate, roleLabel } from '@/lib/format';
import {
  Avatar,
  Banner,
  EmptyState,
  FilterSelect,
  InlineError,
  MiniStat,
  Modal,
  PageTitle,
  PanelHeader,
  SearchInput,
  StatStrip,
} from '@/components/ui';

const workspaceRoles = [
  'admin',
  'it_asset_manager',
  'finance_officer',
  'approver',
  'employee',
  'auditor',
];

const roleDescriptions: { role: string; summary: string }[] = [
  { role: 'admin', summary: 'Full workspace access, including user management and account roles.' },
  { role: 'it_asset_manager', summary: 'Manage assets and lifecycle, employee requests, write-offs, and receipts.' },
  { role: 'finance_officer', summary: 'Manage invoices and view finance-approved documents.' },
  { role: 'approver', summary: 'Review routed workflow approvals.' },
  { role: 'employee', summary: 'Submit equipment requests.' },
  { role: 'auditor', summary: 'Read-only access to the audit log and permitted documents.' },
];

export function UserManagementView({ currentUser }: { currentUser: AppUser }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [accountFilter, setAccountFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: '', email: '', password: '', department: 'General', role: 'employee' });

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setForm({ full_name: '', email: '', password: '', department: 'General', role: 'employee' });
    setFormError(null);
  };

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setError(null);
    try {
      setUsers(await api.get<ManagedUser[]>('/api/users'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load workspace users.');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const changeUser = async (managedUser: ManagedUser, changes: { role?: string; active?: boolean }) => {
    setBusyUser(managedUser.id);
    setError(null);
    try {
      const updated = await api.patch<ManagedUser>(`/api/users/${encodeURIComponent(managedUser.id)}`, changes);
      setUsers((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this user.');
    } finally {
      setBusyUser(null);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const created = await api.post<ManagedUser>('/api/users', form);
      setUsers((current) => [created, ...current]);
      setModalOpen(false);
      setForm({ full_name: '', email: '', password: '', department: 'General', role: 'employee' });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create this user.');
    } finally {
      setSaving(false);
    }
  };

  const visibleUsers = useMemo(
    () =>
      users.filter((managedUser) => {
        const term = search.trim().toLowerCase();
        const matchesSearch = !term || [managedUser.full_name, managedUser.email, managedUser.department].some((value) => value.toLowerCase().includes(term));
        const matchesRole = roleFilter === 'ALL' || managedUser.role === roleFilter;
        const matchesStatus = accountFilter === 'ALL' || (accountFilter === 'ACTIVE' ? managedUser.active : !managedUser.active);
        return matchesSearch && matchesRole && matchesStatus;
      }),
    [accountFilter, roleFilter, search, users],
  );

  const activeUsers = users.filter((managedUser) => managedUser.active).length;
  const inactiveUsers = users.length - activeUsers;
  const adminUsers = users.filter((managedUser) => managedUser.role === 'admin').length;
  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const managedUser of users) counts.set(managedUser.role, (counts.get(managedUser.role) ?? 0) + 1);
    return counts;
  }, [users]);

  return (
    <div className="fade-in">
      <PageTitle eyebrow="Workspace / Administration" title="User Management" copy="Manage workspace accounts, role assignments, and access.">
        <button
          className="button button-primary"
          onClick={() => {
            setFormError(null);
            setModalOpen(true);
          }}
        >
          <UserPlus size={17} /> Add User
        </button>
      </PageTitle>

      <StatStrip className="user-management-stats">
        <MiniStat label="Total accounts" value={users.length.toString()} tone="blue" />
        <MiniStat label="Active" value={activeUsers.toString()} tone="teal" />
        <MiniStat label="Inactive" value={inactiveUsers.toString()} tone="red" />
        <MiniStat label="Administrators" value={adminUsers.toString()} tone="amber" />
      </StatStrip>

      {inactiveUsers > 0 && <Banner tone="amber" title={`${inactiveUsers} account${inactiveUsers === 1 ? '' : 's'} deactivated`}>Deactivated accounts keep their history but cannot sign in to the workspace.</Banner>}

      <section className="panel user-management-panel">
        <PanelHeader title="Workspace users" subtitle={`${visibleUsers.length} of ${users.length} accounts · Role changes take effect immediately`} />
        {error && <InlineError message={error} onRetry={() => void loadUsers()} />}
        {!loadingUsers && (
          <div className="user-management-toolbar">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, email, or department" label="Search workspace users" />
            <FilterSelect label="Role" value={roleFilter} onChange={setRoleFilter}>
              <option value="ALL">All roles</option>
              {workspaceRoles.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Account" value={accountFilter} onChange={(value) => setAccountFilter(value as typeof accountFilter)}>
              <option value="ALL">All accounts</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </FilterSelect>
          </div>
        )}
        {loadingUsers ? (
          <div className="history-state">
            <Loader2 size={17} className="spin" /> Loading users
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table user-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Current role</th>
                  <th>Change role</th>
                  <th>Joined</th>
                  <th>Account</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((managedUser) => (
                  <tr key={managedUser.id}>
                    <td>
                      <div className="user-cell">
                        <Avatar name={managedUser.full_name} />
                        <div>
                          <strong>
                            {managedUser.full_name}
                            {managedUser.id === currentUser.id && <small className="user-you-label">You</small>}
                          </strong>
                          <span>{managedUser.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`role-badge role-${managedUser.role}`}>{roleLabel(managedUser.role)}</span>
                    </td>
                    <td>
                      <select
                        aria-label={`Change role for ${managedUser.full_name}`}
                        value={managedUser.role}
                        disabled={busyUser === managedUser.id || managedUser.id === currentUser.id}
                        onChange={(event) => void changeUser(managedUser, { role: event.target.value })}
                      >
                        {workspaceRoles.map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{formatDate(managedUser.created_at)}</td>
                    <td>
                      <span className={`user-status ${managedUser.active ? 'active' : 'inactive'}`}>{managedUser.active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`user-access-button ${managedUser.active ? 'deactivate' : 'reactivate'}`}
                        disabled={busyUser === managedUser.id || managedUser.id === currentUser.id}
                        onClick={() => void changeUser(managedUser, { active: !managedUser.active })}
                        title={managedUser.active ? 'Deactivate account' : 'Reactivate account'}
                        aria-label={`${managedUser.active ? 'Deactivate' : 'Reactivate'} ${managedUser.full_name}`}
                      >
                        {managedUser.active ? <UserMinus size={16} /> : <UserPlus size={16} />}
                        {managedUser.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && !error ? (
              <EmptyState text="No workspace users found. Add a user to grant workspace access." />
            ) : visibleUsers.length === 0 && !error ? (
              <EmptyState text="No users match these search and filter settings." />
            ) : null}
          </div>
        )}
      </section>

      <section className="panel user-permissions-panel">
        <PanelHeader title="Role permissions" subtitle="Access is enforced by the server for every request." />
        <div className="user-permissions-grid">
          {roleDescriptions.map((entry) => (
            <p key={entry.role}>
              <strong>
                <ShieldCheck size={14} /> {roleLabel(entry.role)}
                <span className="role-count-badge">{roleCounts.get(entry.role) ?? 0}</span>
              </strong>
              <span>{entry.summary}</span>
            </p>
          ))}
        </div>
      </section>

      {modalOpen && (
        <Modal title="Add new user" eyebrow="Workspace access" onClose={closeModal} busy={saving}>
          <form onSubmit={submit}>
            <div className="form-grid">
              <label>
                Full name
                <input required autoComplete="name" value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} />
              </label>
              <label>
                Email
                <input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </label>
              <label>
                Temporary password
                <input required type="password" minLength={6} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
                <small>At least 6 characters. Share it with the user securely.</small>
              </label>
              <label>
                Department
                <input required value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} />
              </label>
              <label>
                Role
                <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                  {workspaceRoles.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {formError && <InlineError message={formError} />}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" disabled={saving} onClick={closeModal}>
                Cancel
              </button>
              <button className="button button-primary" disabled={saving}>
                {saving ? <Loader2 size={16} className="spin" /> : <UserPlus size={16} />} {saving ? 'Creating...' : 'Create user'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
