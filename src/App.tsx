import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Activity,
  Archive,
  BadgeCheck,
  Bell,
  Bot,
  Box,
  ChevronDown,
  CircleDollarSign,
  ChevronRight,
  FileText,
  House,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { ApiError, api, auth, setOnUnauthorized, type AppUser } from '@/lib/api';
import type {
  Asset,
  DashboardData,
  DashboardMetrics,
  EmployeeAssetRequest,
  InventoryReceipt,
  Invoice,
  WorkspaceModule,
  WorkspaceNotification,
  WriteOffRequest,
} from '@/lib/types';
import { formatRelativeTime, initials, roleLabel } from '@/lib/format';
import { ErrorState, LoadingState } from '@/components/ui';
import { AssetsView, AssetModal } from '@/pages/Assets';
import { AssistantView } from '@/pages/Assistant';
import { DashboardView } from '@/pages/Dashboard';
import { DeletedRecordsView } from '@/pages/Deleted';
import { EmployeeAssetsView } from '@/pages/EmployeeAssets';
import { InvoicesView } from '@/pages/Invoices';
import { InventoryView } from '@/pages/Inventory';
import { InventoryHistoryView } from '@/pages/InventoryHistory';
import { NotificationsView } from '@/pages/Notifications';
import { ReportsView } from '@/pages/Reports';
import { SettingsView } from '@/pages/Settings';
import { UserManagementView } from '@/pages/UserManagement';
import { WarrantiesView } from '@/pages/Warranties';
import { WriteOffView } from '@/pages/WriteOff';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme: 'outline'; size: 'large'; text: 'signin_with'; shape: 'rectangular'; width: number },
          ) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const navItems: { label: WorkspaceModule; icon: LucideIcon }[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'AI Assistant', icon: Bot },
  { label: 'Invoices', icon: FileText },
  { label: 'Assets', icon: Box },
  { label: 'Emp Asset Mgmt', icon: Users },
  { label: 'Inventory', icon: Archive },
  { label: 'Inventory History', icon: Activity },
  { label: 'Warranties', icon: BadgeCheck },
  { label: 'Write-Off', icon: CircleDollarSign },
  { label: 'Notifications', icon: Bell },
  { label: 'Settings', icon: Settings2 },
  { label: 'User Management', icon: Users },
  { label: 'Deleted', icon: XCircle },
  { label: 'Reports', icon: FileText },
];

const navGroups: { label: string; items: WorkspaceModule[] }[] = [
  { label: 'Workspace', items: ['Dashboard', 'AI Assistant', 'Reports'] },
  { label: 'Asset operations', items: ['Assets', 'Emp Asset Mgmt', 'Inventory', 'Inventory History', 'Invoices', 'Warranties', 'Write-Off'] },
  { label: 'Administration', items: ['Notifications', 'User Management', 'Settings', 'Deleted'] },
];

const navLabels: Record<WorkspaceModule, string> = {
  Dashboard: 'Dashboard',
  'AI Assistant': 'AI Assistant',
  'User Management': 'User Management',
  Invoices: 'Invoices',
  Assets: 'Assets',
  'Emp Asset Mgmt': 'Employee assets',
  Inventory: 'Inventory',
  'Inventory History': 'Inventory History',
  Warranties: 'Warranties',
  'Write-Off': 'Write-Off',
  Notifications: 'Notifications',
  Settings: 'Settings',
  Deleted: 'Deleted',
  Reports: 'Reports',
};

function AuthLoading() {
  return (
    <div className="auth-shell">
      <div className="auth-loading">
        <Loader2 size={24} className="spin" />
        <span>Preparing your secure workspace</span>
      </div>
    </div>
  );
}

function AuthScreen({ onAuth }: { onAuth: (user: AppUser) => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [googleClientId, setGoogleClientId] = useState<string>(GOOGLE_CLIENT_ID || '');
  const googleButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    api
      .get<{ configured: boolean; clientId: string }>('/api/auth/google-config')
      .then((config) => {
        if (active) setGoogleClientId(config.clientId || '');
      })
      .catch(() => {
        if (active && !GOOGLE_CLIENT_ID) setGoogleClientId('');
      });
    return () => {
      active = false;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const signedInUser = mode === 'sign-in' ? await auth.signIn(email, password) : await auth.signUp(email, password, fullName);
      onAuth(signedInUser);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'We could not complete that request. Check your details and try again.');
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = useCallback(
    async (credential: string) => {
      setBusy(true);
      setMessage('');
      try {
        const signedInUser = await auth.signInWithGoogle(credential);
        onAuth(signedInUser);
      } catch (err) {
        setMessage(err instanceof ApiError ? err.message : 'Google sign-in failed. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [onAuth],
  );

  useEffect(() => {
    if (mode !== 'sign-in' || !googleClientId || !googleButtonRef.current) return;
    let active = true;
    const renderGoogleButton = () => {
      const google = window.google;
      const container = googleButtonRef.current;
      if (!active || !google || !container) return;
      container.replaceChildren();
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => void signInWithGoogle(response.credential),
      });
      google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        width: Math.max(240, Math.floor(container.getBoundingClientRect().width)),
      });
    };
    let script = document.getElementById('google-identity-services') as HTMLScriptElement | null;
    const onLoad = () => renderGoogleButton();
    const onError = () => setMessage('Google sign-in could not be loaded. Check your connection and try again.');
    if (window.google) {
      renderGoogleButton();
    } else {
      if (!script) {
        script = document.createElement('script');
        script.id = 'google-identity-services';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
      }
      script.addEventListener('load', onLoad);
      script.addEventListener('error', onError);
      if (!script.isConnected) document.head.appendChild(script);
    }
    return () => {
      active = false;
      script?.removeEventListener('load', onLoad);
      script?.removeEventListener('error', onError);
    };
  }, [mode, googleClientId, signInWithGoogle]);

  return (
    <div className="auth-shell">
      <div className="auth-visual">
        <div className="auth-brand">
          <img className="brand-logo auth-logo" src="/images/images.jpeg" alt="Bigbasket" />
          <div>
            <div className="brand-name">bigbasket</div>
            <div className="brand-subtitle">IT OPERATIONS</div>
          </div>
        </div>
        <div className="auth-visual-copy">
          <span className="eyebrow">Enterprise asset intelligence</span>
          <h1>
            Make every asset
            <br />
            <em>accountable.</em>
          </h1>
          <p>Control assets, inventory, service, and spend from one trusted operational record.</p>
          <div className="auth-signal">
            <span className="signal-dot" />
            <span>Secure workspace controls active</span>
            <ShieldCheck size={15} />
          </div>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-panel-inner">
          <div className="auth-mobile-brand">
            <img className="brand-logo auth-logo" src="/images/images.jpeg" alt="Bigbasket" />
            <div className="brand-name">bigbasket</div>
          </div>
          <span className="eyebrow">{mode === 'sign-in' ? 'Welcome back' : 'Create your workspace account'}</span>
          <h2>{mode === 'sign-in' ? 'Sign in to operations' : 'Start with your team'}</h2>
          <p className="auth-copy">{mode === 'sign-in' ? 'Access your organization’s asset and workflow records.' : 'Your first account becomes the workspace administrator.'}</p>
          <form onSubmit={submit} className="auth-form">
            {mode === 'sign-up' && (
              <label>
                Full name
                <input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" />
              </label>
            )}
            <label>
              Work email
              <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@bigbasket.com" />
            </label>
            <label>
              Password
              <input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" />
            </label>
            {message && (
              <div className="auth-message" role="alert">
                {message}
              </div>
            )}
            <button className="button button-primary auth-submit" disabled={busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
              {busy ? 'Working...' : mode === 'sign-in' ? 'Sign in securely' : 'Create account'}
            </button>
          </form>
          {mode === 'sign-in' && (
            <>
              <div className="auth-divider">
                <span>or continue with</span>
              </div>
              {googleClientId ? (
                <div className="google-signin" ref={googleButtonRef} aria-label="Sign in with Google" />
              ) : (
                <button
                  type="button"
                  className="button button-google"
                  onClick={() => setMessage('Google sign-in is not configured yet. Ask a workspace administrator to configure it under Settings → Email Settings.')}
                >
                  <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18">
                    <path
                      fill="#4285F4"
                      d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.9 6.1-15z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 44c5.5 0 10.1-1.8 13.5-4.9L30.9 34c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44z"
                    />
                    <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3z" />
                    <path
                      fill="#EA4335"
                      d="M24 11.9c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.8 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3c1.6-4.9 6.1-8.5 11.4-8.5z"
                    />
                  </svg>
                  Login with Google
                </button>
              )}
            </>
          )}
          <button
            className="auth-switch"
            onClick={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setMessage('');
            }}
          >
            {mode === 'sign-in' ? 'New to Bigbasket? Create an account' : 'Already have an account? Sign in'}
          </button>
          <div className="auth-footnote">
            <ShieldCheck size={14} /> Role-aware access, audit history, and private documents
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceModule>('Dashboard');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [employeeRequests, setEmployeeRequests] = useState<EmployeeAssetRequest[]>([]);
  const [writeOffRequests, setWriteOffRequests] = useState<WriteOffRequest[]>([]);
  const [inventoryReceipts, setInventoryReceipts] = useState<InventoryReceipt[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [dashboardActivity, setDashboardActivity] = useState<DashboardData>({ recent: [], daily: [] });
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOnUnauthorized(() => {
      auth.signOut();
      setUser(null);
    });
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!searchBoxRef.current?.contains(target)) setSearchOpen(false);
      if (!userMenuRef.current?.contains(target)) setUserMenuOpen(false);
      if (!notificationMenuRef.current?.contains(target)) setNotificationMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      } else if (event.key === 'Escape') {
        setSearchOpen(false);
        setUserMenuOpen(false);
        setNotificationMenuOpen(false);
        setMobileNavOpen(false);
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [assetData, invoiceData, employeeRequestData, writeOffData, receiptData, notificationData, dashboardData, metricsData] = await Promise.all([
        api.get<Asset[]>('/api/assets'),
        api.get<Invoice[]>('/api/invoices'),
        api.get<EmployeeAssetRequest[]>('/api/workflows/employee-requests'),
        api.get<WriteOffRequest[]>('/api/workflows/write-offs'),
        api.get<InventoryReceipt[]>('/api/receipts'),
        api.get<WorkspaceNotification[]>('/api/notifications'),
        api.get<DashboardData>('/api/dashboard/activity'),
        api.get<DashboardMetrics>('/api/dashboard/metrics'),
      ]);
      setAssets(assetData);
      setInvoices(invoiceData);
      setEmployeeRequests(employeeRequestData);
      setWriteOffRequests(writeOffData);
      setInventoryReceipts(receiptData);
      setNotifications(notificationData);
      setDashboardActivity(dashboardData);
      setDashboardMetrics(metricsData);
    } catch {
      setError('We could not load the workspace data. Please try again.');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    auth
      .me()
      .then((currentUser) => setUser(currentUser))
      .catch(() => null)
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (user) void loadData();
  }, [user, loadData]);

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const results: { id: string; title: string; detail: string; tab: WorkspaceModule; icon: LucideIcon }[] = [];
    for (const asset of assets) {
      if ([asset.asset_tag, asset.category, asset.manufacturer, asset.model, asset.serial_number, asset.custodian, asset.department].some((value) => value.toLowerCase().includes(term))) {
        results.push({ id: `asset-${asset.id}`, title: asset.asset_tag, detail: `${asset.manufacturer} ${asset.model} · ${asset.custodian}`, tab: 'Assets', icon: Box });
      }
    }
    for (const invoice of invoices) {
      if ([invoice.invoice_number, invoice.purchase_order, invoice.vendor].some((value) => value?.toLowerCase().includes(term))) {
        results.push({ id: `invoice-${invoice.id}`, title: invoice.invoice_number, detail: `${invoice.vendor} · ${invoice.purchase_order || 'No PO'}`, tab: 'Invoices', icon: FileText });
      }
    }
    return results.slice(0, 8);
  }, [assets, invoices, query]);

  const showTab = (tab: WorkspaceModule) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  const signOut = () => {
    auth.signOut();
    setUser(null);
  };

  const openAsset = (asset: Asset) => {
    setQuery(asset.asset_tag);
    setPendingAssetId(asset.id);
    showTab('Assets');
  };

  const unreadCount = notifications.filter((notification) => !notification.read_at).length;
  const invoiceExceptions = invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD').length;

  const markNotificationRead = async (id: string) => {
    await api.put(`/api/notifications/${encodeURIComponent(id)}/read`, {});
    setNotifications((current) => current.map((notification) => (notification.id === id ? { ...notification, read_at: new Date().toISOString() } : notification)));
  };

  const markAllNotificationsRead = async () => {
    await api.put('/api/notifications/read-all', {});
    setNotifications((current) => current.map((notification) => ({ ...notification, read_at: notification.read_at ?? new Date().toISOString() })));
  };

  const deleteNotification = async (id: string) => {
    await api.del(`/api/notifications/${encodeURIComponent(id)}`);
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  };

  if (authLoading) return <AuthLoading />;
  if (!user) return <AuthScreen onAuth={setUser} />;

  const canManageUsers = user.role === 'admin';
  const canViewDeleted = user.role === 'admin' || user.role === 'auditor';

  return (
    <div className="app-shell">
      {mobileNavOpen && <button className="navigation-backdrop" aria-label="Close navigation menu" onClick={() => setMobileNavOpen(false)} />}
      <aside id="workspace-navigation" className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`} aria-label="Workspace navigation">
        <div className="brand-row">
          <img className="brand-logo" src="/images/images.jpeg" alt="Bigbasket" />
          <div>
            <div className="brand-name">bigbasket</div>
            <div className="brand-subtitle">IT OPERATIONS</div>
          </div>
          <button className="sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation menu">
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-navigation-label">NAVIGATION</div>
        <div className="sidebar-navigation">
          {navGroups.map((group) => (
            <section className="nav-group" key={group.label}>
              <div className="nav-section-label">{group.label}</div>
              <nav className="main-nav sidebar-nav">
                {navItems
                  .filter(({ label }) => group.items.includes(label) && (label !== 'User Management' || canManageUsers) && (label !== 'Deleted' || canViewDeleted))
                  .map(({ label, icon: Icon }) => (
                    <button key={label} className={`nav-item ${activeTab === label ? 'active' : ''}`} aria-current={activeTab === label ? 'page' : undefined} onClick={() => showTab(label)}>
                      <Icon size={18} />
                      <span>{navLabels[label]}</span>
                      {label === 'Invoices' && invoiceExceptions > 0 && <span className="nav-count">{invoiceExceptions}</span>}
                      {label === 'Notifications' && unreadCount > 0 && <span className="nav-count">{unreadCount}</span>}
                    </button>
                  ))}
              </nav>
            </section>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="profile-row">
            <div className="avatar avatar-dark">{initials(user.full_name)}</div>
            <div className="profile-copy">
              <strong>{user.full_name}</strong>
              <span>{roleLabel(user.role)}</span>
            </div>
            <button className="more-dots" aria-label="Sign out" onClick={signOut}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="navigation-menu-button" aria-label="Open navigation menu" aria-controls="workspace-navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>
            <Menu size={21} />
            <span>Menu</span>
          </button>
          <div className="breadcrumbs">
            <button type="button" className="breadcrumb-home" onClick={() => showTab('Dashboard')} aria-label="Go to Dashboard">
              <House size={15} aria-hidden="true" />
              <span>Dashboard</span>
            </button>
            {activeTab !== 'Dashboard' && (
              <>
                <ChevronRight className="crumb-divider" size={15} aria-hidden="true" />
                <strong aria-current="page">{navLabels[activeTab]}</strong>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <button className="assistant-launch" onClick={() => showTab('AI Assistant')} aria-label="Ask, navigate, or implement with AI">
              <Sparkles size={16} />
              <span>Ask, navigate, or implement…</span>
              <kbd>AI</kbd>
            </button>
            <div className="global-search-wrap" ref={searchBoxRef}>
              <div className={`global-search ${searchOpen ? 'search-active' : ''}`}>
                <button type="button" className="search-trigger" aria-label="Open workspace search" onClick={() => setSearchOpen(true)}>
                  <Search size={17} />
                </button>
                <input
                  ref={searchInputRef}
                  value={query}
                  onFocus={() => setSearchOpen(true)}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSearchOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && searchResults[0]) {
                      showTab(searchResults[0].tab);
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="Search assets and invoices..."
                  aria-label="Search workspace"
                  aria-expanded={searchOpen}
                  aria-controls="workspace-search-results"
                />
                <kbd>Ctrl K</kbd>
                {query && (
                  <button
                    className="search-clear"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery('');
                      setSearchOpen(true);
                      searchInputRef.current?.focus();
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {searchOpen && query.trim() && (
                <div className="search-results" id="workspace-search-results" role="listbox" aria-label="Workspace search results">
                  {searchResults.map(({ id, title, detail, tab, icon: Icon }) => (
                    <button
                      key={id}
                      role="option"
                      aria-selected="false"
                      onClick={() => {
                        setQuery(query.trim());
                        showTab(tab);
                        setSearchOpen(false);
                      }}
                    >
                      <span className="search-result-icon">
                        <Icon size={15} />
                      </span>
                      <span className="search-result-copy">
                        <strong>{title}</strong>
                        <small>{detail}</small>
                      </span>
                      <span className="search-result-type">{navLabels[tab]}</span>
                    </button>
                  ))}
                  {searchResults.length === 0 && <div className="search-no-results">No matching assets or invoices.</div>}
                </div>
              )}
            </div>
            <div className="notification-menu-wrap" ref={notificationMenuRef}>
              <button
                className="icon-button notification-button"
                aria-label="Notifications"
                aria-expanded={notificationMenuOpen}
                aria-haspopup="true"
                onClick={() => {
                  setNotificationMenuOpen((open) => !open);
                  setUserMenuOpen(false);
                }}
              >
                <Bell size={19} />
                {unreadCount > 0 && <span />}
              </button>
              {notificationMenuOpen && (
                <div className="notification-popover" role="dialog" aria-label="Notifications">
                  <div className="notification-popover-heading">Notifications</div>
                  {notifications.length ? (
                    notifications.slice(0, 5).map((notification) => (
                      <button className="notification-popover-item" key={notification.id} onClick={() => { setNotificationMenuOpen(false); showTab('Notifications'); }}>
                        <strong>{notification.title}</strong>
                        <small>{formatRelativeTime(notification.created_at)}</small>
                      </button>
                    ))
                  ) : (
                    <div className="notification-popover-empty">You have no notifications yet.</div>
                  )}
                </div>
              )}
            </div>
            <div className="user-menu-wrap" ref={userMenuRef}>
              <button className="user-menu-trigger" aria-label={`User menu for ${user.full_name}`} aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen((open) => !open)}>
                <span className="avatar avatar-light">{initials(user.full_name)}</span>
                <ChevronDown size={13} />
              </button>
              {userMenuOpen && (
                <div className="user-menu-popover">
                  <div className="user-menu-heading">
                    <strong>{user.full_name}</strong>
                    <span>{user.email}</span>
                    <small>{roleLabel(user.role)}</small>
                  </div>
                  <button onClick={() => { setUserMenuOpen(false); showTab('Settings'); }}>
                    <Settings2 size={15} /> Account settings
                  </button>
                  {canManageUsers && (
                    <button onClick={() => { setUserMenuOpen(false); showTab('User Management'); }}>
                      <Users size={15} /> User management
                    </button>
                  )}
                  <button className="user-menu-signout" onClick={signOut}>
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="page-content">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState onRetry={() => void loadData()} />
          ) : (
            <>
              {activeTab === 'Dashboard' && (
                <DashboardView
                  assets={assets}
                  invoices={invoices}
                  employeeRequests={employeeRequests}
                  writeOffs={writeOffRequests}
                  receipts={inventoryReceipts}
                  metrics={dashboardMetrics}
                  activity={dashboardActivity}
                  onOpenAsset={openAsset}
                  onOpenAssets={() => showTab('Assets')}
                  onOpenEmployeeRequests={() => showTab('Emp Asset Mgmt')}
                  onOpenInvoices={() => showTab('Invoices')}
                  onOpenWarranties={() => showTab('Warranties')}
                  onOpenReports={() => showTab('Reports')}
                  onOpenWriteOffs={() => showTab('Write-Off')}
                  onOpenInventory={() => showTab('Inventory')}
                  onOpenDeleted={() => showTab('Deleted')}
                  onNavigate={(module) => showTab(module)}
                />
              )}
              {activeTab === 'Assets' && (
                <AssetsView
                  assets={assets}
                  user={user}
                  query={query}
                  openAssetId={pendingAssetId}
                  onAssetOpened={() => setPendingAssetId(null)}
                  onAdd={() => setAssetModalOpen(true)}
                  onRefresh={() => void loadData(true)}
                  onImportComplete={async () => {
                    setQuery('');
                    setRefreshing(true);
                    try {
                      setAssets(await api.get<Asset[]>('/api/assets'));
                    } finally {
                      setRefreshing(false);
                    }
                  }}
                  onOpenWarranties={() => showTab('Warranties')}
                />
              )}
              {activeTab === 'Invoices' && <InvoicesView invoices={invoices} user={user} query={query} onSaved={() => void loadData(true)} />}
              {activeTab === 'Emp Asset Mgmt' && <EmployeeAssetsView requests={employeeRequests} assets={assets} user={user} onSaved={() => void loadData(true)} />}
              {activeTab === 'Inventory' && <InventoryView assets={assets} receipts={inventoryReceipts} user={user} onSaved={() => void loadData(true)} />}
              {activeTab === 'Inventory History' && <InventoryHistoryView receipts={inventoryReceipts} />}
              {activeTab === 'Warranties' && (
                <WarrantiesView assets={assets} onOpenAssets={() => showTab('Assets')} onOpenInventory={() => showTab('Inventory')} onOpenAsset={openAsset} />
              )}
              {activeTab === 'Write-Off' && <WriteOffView assets={assets} requests={writeOffRequests} user={user} onSaved={() => void loadData(true)} />}
              {activeTab === 'Notifications' && (
                <NotificationsView notifications={notifications} onRead={markNotificationRead} onReadAll={markAllNotificationsRead} onDelete={deleteNotification} />
              )}
              {activeTab === 'User Management' && canManageUsers && <UserManagementView currentUser={user} />}
              {activeTab === 'Settings' && <SettingsView user={user} onSaved={setUser} />}
              {activeTab === 'Reports' && (
                <ReportsView assets={assets} invoices={invoices} requests={employeeRequests} receipts={inventoryReceipts} writeOffs={writeOffRequests} metrics={dashboardMetrics} />
              )}
              {activeTab === 'Deleted' && canViewDeleted && <DeletedRecordsView onRestored={() => void loadData(true)} />}
              {activeTab === 'AI Assistant' && <AssistantView onNavigate={(module) => showTab(module)} />}
            </>
          )}
        </div>
      </main>

      {assetModalOpen && (
        <AssetModal
          userName={user.full_name}
          department={user.department}
          onClose={() => setAssetModalOpen(false)}
          onSaved={() => {
            setAssetModalOpen(false);
            void loadData(true);
          }}
        />
      )}
      {refreshing && (
        <div className="refresh-indicator">
          <Loader2 size={15} className="spin" /> Updating workspace
        </div>
      )}
    </div>
  );
}

export default App;
