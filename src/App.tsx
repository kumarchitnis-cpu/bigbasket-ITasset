import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ChevronRight,
  House,
  Loader2,
  ShieldCheck,
  Sparkles,
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
import { ErrorState, LoadingState } from '@/components/ui';
import { TopNav } from '@/components/TopNav';
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
import { ProcurementView } from '@/pages/Procurement';

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

const navLabels: Record<WorkspaceModule, string> = {
  Dashboard: 'Dashboard',
  'AI Assistant': 'AI Assistant',
  'User Management': 'User Management',
  Invoices: 'Invoices',
  Assets: 'Assets',
  'Emp Asset Mgmt': 'Employee Assets',
  Inventory: 'Inventory',
  'Inventory History': 'Inventory History',
  Warranties: 'Warranties',
  'Write-Off': 'Write-Off',
  Notifications: 'Notifications',
  Settings: 'Settings',
  Deleted: 'Deleted',
  Reports: 'Reports',
  Procurement: 'Procurement',
  'Server Assets': 'Server Assets',
  'Laptop Assets': 'Laptop Assets',
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
          <p className="auth-copy">{mode === 'sign-in' ? 'Access your organization\'s asset and workflow records.' : 'Your first account becomes the workspace administrator.'}</p>
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
                  onClick={() => setMessage('Google sign-in is not configured yet. Ask a workspace administrator to configure it under Settings \u2192 Email Settings.')}
                >
                  <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18">
                    <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.9 6.1-15z" />
                    <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9L30.9 34c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44z" />
                    <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3z" />
                    <path fill="#EA4335" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.8 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3c1.6-4.9 6.1-8.5 11.4-8.5z" />
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

  const showTab = (tab: WorkspaceModule) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
    setSearchOpen(false);
  };

  const toggleNavigation = () => {
    setMobileNavOpen((open) => !open);
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

  const handleSearch = (searchQuery: string) => {
    setQuery(searchQuery);
  };

  const handleOpenSearch = () => {
    setSearchOpen(true);
  };

  const handleOpenNotifications = () => {
    setNotificationMenuOpen((open) => !open);
    setUserMenuOpen(false);
  };

  const handleOpenUserMenu = () => {
    setUserMenuOpen((open) => !open);
    setNotificationMenuOpen(false);
  };

  return (
    <div className={`app-shell ${mobileNavOpen ? 'mobile-nav-open' : ''}`}>
      <TopNav
        activeTab={activeTab}
        onNavigate={showTab}
        user={user}
        canManageUsers={canManageUsers}
        canViewDeleted={canViewDeleted}
        unreadNotificationCount={unreadCount}
        onToggleMobileNav={toggleNavigation}
        mobileNavOpen={mobileNavOpen}
        onSearch={handleSearch}
        onOpenSearch={handleOpenSearch}
        searchQuery={query}
        searchOpen={searchOpen}
        onOpenNotifications={handleOpenNotifications}
        onOpenUserMenu={handleOpenUserMenu}
        notificationMenuOpen={notificationMenuOpen}
        userMenuOpen={userMenuOpen}
        onSignOut={signOut}
      />

      <main className="main-area">
        <header className="topbar">
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
              <span>Ask, navigate, or implement\u2026</span>
              <kbd>AI</kbd>
            </button>
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
              {activeTab === 'Server Assets' && (
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
                  initialCategory="Server"
                />
              )}
              {activeTab === 'Laptop Assets' && (
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
                  initialCategory="Laptop"
                />
              )}
              {activeTab === 'Invoices' && <InvoicesView invoices={invoices} user={user} query={query} onSaved={() => void loadData(true)} />}
              {activeTab === 'Procurement' && (
                <ProcurementView
                  invoices={invoices}
                  receipts={inventoryReceipts}
                  metrics={dashboardMetrics}
                  activity={dashboardActivity}
                  onOpenInvoices={() => showTab('Invoices')}
                  onOpenWarranties={() => showTab('Warranties')}
                  onOpenReports={() => showTab('Reports')}
                  onOpenWriteOffs={() => showTab('Write-Off')}
                  onOpenInventory={() => showTab('Inventory')}
                  onNavigate={(module) => showTab(module)}
                />
              )}
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