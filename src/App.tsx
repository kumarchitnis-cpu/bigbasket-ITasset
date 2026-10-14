import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Archive,
  BadgeCheck,
  Bell,
  Box,
  BriefcaseBusiness,
  Bot,
  Building2,
  Check,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  FileText,
  Laptop,
  LayoutDashboard,
  Mail,
  Loader2,
  LogOut,
  Menu,
  Pencil,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Upload,
  Users,
  UserMinus,
  UserPlus,
  X,
  XCircle,
  Wrench,
} from 'lucide-react';
import { ApiError, api, auth, setOnUnauthorized, type AppDocument, type AppUser, type WorkspaceSettings } from '@/lib/api';

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

type Asset = {
  id: string;
  asset_tag: string;
  category: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  status: 'ASSIGNED' | 'AVAILABLE' | 'UNDER_MAINTENANCE' | 'QUARANTINED' | 'RETIRED';
  condition: string;
  custodian: string;
  location: string;
  purchase_cost: number;
  warranty_start: string | null;
  warranty_end: string | null;
  department: string;
  last_audited_at?: string | null;
  created_at?: string;
};

type AssetEvent = {
  id: string;
  event_type: string;
  from_status: Asset['status'] | null;
  to_status: Asset['status'] | null;
  from_custodian: string | null;
  to_custodian: string | null;
  location: string | null;
  notes: string | null;
  actor_name: string;
  created_at: string;
};

type AssetEventType = 'ASSIGNED' | 'RETURNED' | 'TRANSFERRED' | 'MAINTENANCE_STARTED' | 'MAINTENANCE_COMPLETED' | 'QUARANTINED' | 'RETIRED' | 'AUDITED';

type Invoice = {
  id: string;
  invoice_number: string;
  vendor: string;
  purchase_order: string;
  total: number;
  status: 'PENDING' | 'UNDER_REVIEW' | 'PROCESSED' | 'ON_HOLD' | 'REJECTED';
  confidence: number;
  issue: string | null;
  invoice_date: string;
  currency_code: string;
  extracted_fields: InvoiceExtraction;
  document_id: string | null;
  file_name: string | null;
  file_visible: boolean;
};

type EmployeeAssetRequest = {
  id: string;
  request_number: string;
  requester_id: string;
  requester_name: string;
  department: string;
  category: string;
  justification: string;
  needed_by: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  review_note: string | null;
  created_at: string;
};

type EmployeeAssetAssignment = {
  id: string;
  employee_name: string;
  employee_id: string;
  designation: string;
  department: string;
  asset_model: string;
  serial_number: string;
  doj: string;
  remarks: string;
};

type WriteOffRequest = {
  id: string;
  asset_id: string;
  asset_tag: string;
  manufacturer: string;
  model: string;
  asset_status: Asset['status'];
  requester_name: string;
  reason: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  review_note: string | null;
  created_at: string;
};

type InventoryReceipt = {
  id: string;
  receipt_number: string;
  purchase_order: string;
  vendor: string;
  received_date: string;
  ordered_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  status: string;
};

type WorkspaceNotification = {
  id: string;
  event_type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

type DashboardActivity = {
  action: string;
  entity_type: string;
  created_at: string;
};

type DashboardData = {
  recent: DashboardActivity[];
  daily: { date: string; count: number }[];
};

type ManagedUser = AppUser & { created_at: string };

const workspaceRoles = [
  'admin',
  'it_asset_manager',
  'finance_officer',
  'approver',
  'employee',
  'auditor',
];

const invoiceStatuses: Invoice['status'][] = ['PENDING', 'UNDER_REVIEW', 'PROCESSED', 'ON_HOLD', 'REJECTED'];

type Tab = 'Overview' | 'Assets' | 'Invoices' | 'Emp Asset Mgmt' | 'Inventory' | 'Warranties' | 'Write-Off' | 'Notifications' | 'Settings' | 'AI Assistant' | 'User Management';

const navItems: { label: Tab; icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'AI Assistant', icon: Bot },
  { label: 'Invoices', icon: FileText },
  { label: 'Assets', icon: Box },
  { label: 'Emp Asset Mgmt', icon: Users },
  { label: 'Inventory', icon: Archive },
  { label: 'Warranties', icon: BadgeCheck },
  { label: 'Write-Off', icon: CircleDollarSign },
  { label: 'Notifications', icon: Bell },
  { label: 'Settings', icon: Settings2 },
  { label: 'User Management', icon: Users },
];

const navGroups: { label: string; items: Tab[] }[] = [
  { label: 'Workspace', items: ['Overview', 'AI Assistant'] },
  { label: 'Asset operations', items: ['Assets', 'Emp Asset Mgmt', 'Inventory', 'Invoices', 'Warranties', 'Write-Off'] },
  { label: 'Administration', items: ['Notifications', 'User Management', 'Settings'] },
];

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const compactMoney = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
type WarrantyStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'UNKNOWN';

function warrantyStatus(asset: Pick<Asset, 'warranty_end'>, today = new Date().toISOString().slice(0, 10)): WarrantyStatus {
  if (!asset.warranty_end) return 'UNKNOWN';
  if (asset.warranty_end < today) return 'EXPIRED';
  const horizon = new Date(`${today}T00:00:00.000Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 30);
  return asset.warranty_end <= horizon.toISOString().slice(0, 10) ? 'EXPIRING' : 'ACTIVE';
}

function warrantyPortal(manufacturer: string) {
  const make = manufacturer.trim().toLowerCase();
  if (make.includes('dell')) return { name: 'Dell', url: 'https://www.dell.com/support/contractservices/en-in' };
  if (make.includes('lenovo')) return { name: 'Lenovo', url: 'https://pcsupport.lenovo.com/in/en/warranty-lookup#/' };
  if (make === 'hp' || make.startsWith('hp ') || make.includes('hewlett')) return { name: 'HP', url: 'https://support.hp.com/in-en/check-warranty' };
  if (make.includes('apple')) return { name: 'Apple', url: 'https://checkcoverage.apple.com/?locale=en_IN' };
  return null;
}

function WarrantyLookupLink({ manufacturer, serialNumber }: { manufacturer: string; serialNumber: string }) {
  const [message, setMessage] = useState('');
  const portal = warrantyPortal(manufacturer);
  if (!portal) return null;
  const serial = serialNumber.trim();
  return <div className="warranty-lookup-control">
    <a
      className={`button button-secondary ${!serial ? 'warranty-lookup-disabled' : ''}`}
      href={portal.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!serial}
      onClick={(event) => {
        if (!serial) {
          event.preventDefault();
          return;
        }
        setMessage('');
        if (!navigator.clipboard?.writeText) {
          setMessage('The lookup page opened, but clipboard access is unavailable. Copy the serial manually.');
          return;
        }
        void navigator.clipboard.writeText(serial)
          .then(() => setMessage('Serial copied. Paste it into the manufacturer lookup page.'))
          .catch(() => setMessage('The lookup page opened, but the serial could not be copied. Copy it manually.'));
      }}
    >
      <ArrowUpRight size={14} /> Check on {portal.name}
    </a>
    <span className="warranty-lookup-note" aria-live="polite">{message || (serial ? 'Opens the official lookup and copies the serial.' : 'Enter a serial number to enable lookup.')}</span>
  </div>;
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [employeeRequests, setEmployeeRequests] = useState<EmployeeAssetRequest[]>([]);
  const [writeOffRequests, setWriteOffRequests] = useState<WriteOffRequest[]>([]);
  const [inventoryReceipts, setInventoryReceipts] = useState<InventoryReceipt[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [dashboardActivity, setDashboardActivity] = useState<DashboardData>({ recent: [], daily: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
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
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      } else if (event.key === 'Escape') {
        setSearchOpen(false);
        setUserMenuOpen(false);
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

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [assetData, invoiceData, employeeRequestData, writeOffData, receiptData, notificationData, dashboardData] = await Promise.all([
        api.get<Asset[]>('/api/assets'),
        api.get<Invoice[]>('/api/invoices'),
        api.get<EmployeeAssetRequest[]>('/api/workflows/employee-requests'),
        api.get<WriteOffRequest[]>('/api/workflows/write-offs'),
        api.get<InventoryReceipt[]>('/api/receipts'),
        api.get<WorkspaceNotification[]>('/api/notifications'),
        api.get<DashboardData>('/api/dashboard/activity'),
      ]);
      setAssets(assetData);
      setInvoices(invoiceData);
      setEmployeeRequests(employeeRequestData);
      setWriteOffRequests(writeOffData);
      setInventoryReceipts(receiptData);
      setNotifications(notificationData);
      setDashboardActivity(dashboardData);
    } catch {
      setError('We could not load the workspace data. Please try again.');
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    auth
      .me()
      .then((currentUser) => setUser(currentUser))
      .catch(() => null)
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (user) void loadData();
  }, [user]);

  const filteredAssets = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return assets;
    return assets.filter((asset) => [asset.asset_tag, asset.category, asset.manufacturer, asset.model, asset.serial_number, asset.custodian, asset.department].some((value) => value.toLowerCase().includes(normalized)));
  }, [assets, query]);

  const metrics = useMemo(() => {
    const endOfYear = new Date(new Date().getFullYear(), 11, 31);
    const warrantyCount = assets.filter((asset) => asset.warranty_end && new Date(asset.warranty_end) <= endOfYear).length;
    return {
      total: assets.length,
      active: assets.filter((asset) => asset.status === 'ASSIGNED').length,
      available: assets.filter((asset) => asset.status === 'AVAILABLE').length,
      maintenance: assets.filter((asset) => asset.status === 'UNDER_MAINTENANCE').length,
      warranty: warrantyCount,
      invoiceExceptions: invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD').length,
      unreadNotifications: notifications.filter((notification) => !notification.read_at).length,
    };
  }, [assets, invoices, notifications]);

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const results: { id: string; title: string; detail: string; tab: Tab; icon: typeof Box }[] = [];
    for (const asset of assets) {
      if ([asset.asset_tag, asset.category, asset.manufacturer, asset.model, asset.serial_number, asset.custodian, asset.department]
        .some((value) => value.toLowerCase().includes(term))) {
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

  const showTab = (tab: Tab) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  const signOut = () => {
    auth.signOut();
    setUser(null);
  };

  if (authLoading) return <AuthLoading />;
  if (!user) return <AuthScreen onAuth={setUser} />;

  return (
    <div className="app-shell">
      {mobileNavOpen && <button className="navigation-backdrop" aria-label="Close navigation menu" onClick={() => setMobileNavOpen(false)} />}
      <aside id="workspace-navigation" className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`} aria-label="Workspace navigation">
        <div className="brand-row">
          <img className="brand-logo" src="/images/images.jpeg" alt="Bigbasket" />
          <div><div className="brand-name">bigbasket</div><div className="brand-subtitle">IT OPERATIONS</div></div>
          <button className="sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation menu"><X size={18} /></button>
        </div>
        <div className="sidebar-navigation-label">NAVIGATION</div>
        <div className="sidebar-navigation">{navGroups.map((group) => <section className="nav-group" key={group.label}><div className="nav-section-label">{group.label}</div><nav className="main-nav sidebar-nav">{navItems.filter(({ label }) => group.items.includes(label) && (label !== 'User Management' || user.role === 'admin')).map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activeTab === label ? 'active' : ''}`} aria-current={activeTab === label ? 'page' : undefined} onClick={() => showTab(label)}><Icon size={18} /><span>{label === 'Emp Asset Mgmt' ? 'Employee assets' : label}</span>{label === 'Invoices' && metrics.invoiceExceptions > 0 && <span className="nav-count">{metrics.invoiceExceptions}</span>}{label === 'Notifications' && metrics.unreadNotifications > 0 && <span className="nav-count">{metrics.unreadNotifications}</span>}</button>)}</nav></section>)}</div>
        <div className="sidebar-bottom"><div className="profile-row"><div className="avatar avatar-dark">{initials(user.full_name)}</div><div className="profile-copy"><strong>{user.full_name}</strong><span>{roleLabel(user.role)}</span></div><button className="more-dots" aria-label="Sign out" onClick={signOut}><LogOut size={15} /></button></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><button className="navigation-menu-button" aria-label="Open navigation menu" aria-controls="workspace-navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Menu size={21} /><span>Menu</span></button><div className="breadcrumbs"><span>Operations</span><span className="crumb-divider">/</span><strong>{activeTab}</strong></div><div className="topbar-actions"><button className="assistant-launch" onClick={() => showTab('AI Assistant')} aria-label="Ask, navigate, or implement with AI"><Sparkles size={16} /><span>Ask, navigate, or implement…</span><kbd>AI</kbd></button><div className="global-search-wrap" ref={searchBoxRef}><div className={`global-search ${searchOpen ? 'search-active' : ''}`}><button type="button" className="search-trigger" aria-label="Open workspace search" onClick={() => setSearchOpen(true)}><Search size={17} /></button><input ref={searchInputRef} value={query} onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onKeyDown={(event) => { if (event.key === 'Enter' && searchResults[0]) { showTab(searchResults[0].tab); setSearchOpen(false); } }} placeholder="Search assets and invoices..." aria-label="Search workspace" aria-expanded={searchOpen} aria-controls="workspace-search-results" /><kbd>Ctrl K</kbd>{query && <button className="search-clear" aria-label="Clear search" onClick={() => { setQuery(''); setSearchOpen(true); searchInputRef.current?.focus(); }}><X size={14} /></button>}</div>{searchOpen && query.trim() && <div className="search-results" id="workspace-search-results" role="listbox" aria-label="Workspace search results">{searchResults.map(({ id, title, detail, tab, icon: Icon }) => <button key={id} role="option" aria-selected="false" onClick={() => { setQuery(query.trim()); showTab(tab); setSearchOpen(false); }}><span className="search-result-icon"><Icon size={15} /></span><span className="search-result-copy"><strong>{title}</strong><small>{detail}</small></span><span className="search-result-type">{tab}</span></button>)}{searchResults.length === 0 && <div className="search-no-results">No matching assets or invoices.</div>}</div>}</div><button className="icon-button notification-button" aria-label="Notifications" onClick={() => showTab('Notifications')}><Bell size={19} />{metrics.unreadNotifications > 0 && <span></span>}</button><div className="user-menu-wrap" ref={userMenuRef}><button className="user-menu-trigger" aria-label={`User menu for ${user.full_name}`} aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen((open) => !open)}><span className="avatar avatar-light">{initials(user.full_name)}</span><ChevronDown size={13} /></button>{userMenuOpen && <div className="user-menu-popover"><div className="user-menu-heading"><strong>{user.full_name}</strong><span>{user.email}</span><small>{roleLabel(user.role)}</small></div><button onClick={() => { setUserMenuOpen(false); showTab('Settings'); }}><Settings2 size={15} /> Account settings</button>{user.role === 'admin' && <button onClick={() => { setUserMenuOpen(false); showTab('User Management'); }}><Users size={15} /> User management</button>}<button className="user-menu-signout" onClick={signOut}><LogOut size={15} /> Sign out</button></div>}</div></div></header>

        <div className="page-content">
          {activeTab === 'Settings' ? <SettingsView user={user} onSaved={setUser} /> : loading ? <LoadingState /> : error ? <ErrorState onRetry={() => void loadData()} /> : <>
            {activeTab === 'Overview' && <Overview assets={assets} invoices={invoices} employeeRequests={employeeRequests} activity={dashboardActivity} onOpenAsset={(asset) => { setQuery(asset.asset_tag); setPendingAssetId(asset.id); showTab('Assets'); }} onOpenAssets={() => showTab('Assets')} onOpenEmployeeRequests={() => showTab('Emp Asset Mgmt')} />}
            {activeTab === 'Assets' && <AssetsView assets={filteredAssets} user={user} onAdd={() => setAssetModalOpen(true)} onRefresh={() => void loadData(true)} onImportComplete={async () => { setQuery(''); setRefreshing(true); try { setAssets(await api.get<Asset[]>('/api/assets')); } finally { setRefreshing(false); } }} query={query} openAssetId={pendingAssetId} onAssetOpened={() => setPendingAssetId(null)} onOpenWarranties={() => showTab('Warranties')} />}
            {activeTab === 'Invoices' && <InvoicesView invoices={invoices} user={user} query={query} onSaved={() => void loadData(true)} />}
            {activeTab === 'Emp Asset Mgmt' && <EmployeeAssetsView requests={employeeRequests} assets={assets} user={user} onSaved={() => void loadData(true)} />}
            {activeTab === 'Inventory' && <InventoryView assets={assets} receipts={inventoryReceipts} user={user} onSaved={() => void loadData(true)} />}
            {activeTab === 'Warranties' && <WarrantiesView assets={assets} onOpenAssets={() => showTab('Assets')} onOpenInventory={() => showTab('Inventory')} onOpenAsset={(asset) => { setQuery(asset.asset_tag); setPendingAssetId(asset.id); showTab('Assets'); }} />}
            {activeTab === 'Write-Off' && <WriteOffView assets={assets} requests={writeOffRequests} user={user} onSaved={() => void loadData(true)} />}
            {activeTab === 'Notifications' && <NotificationsView notifications={notifications} onRead={async (id) => { await api.put(`/api/notifications/${id}/read`, {}); setNotifications((current) => current.map((notification) => notification.id === id ? { ...notification, read_at: new Date().toISOString() } : notification)); }} />}
            {activeTab === 'User Management' && user.role === 'admin' && <UserManagementView currentUser={user} />}
            {activeTab === 'AI Assistant' && <AssistantView onNavigate={showTab} />}
          </>}
        </div>
      </main>
      {assetModalOpen && <AssetModal userName={user.full_name} department={user.department} onClose={() => setAssetModalOpen(false)} onSaved={() => { setAssetModalOpen(false); void loadData(true); }} />}
      {refreshing && <div className="refresh-indicator"><Loader2 size={15} className="spin" /> Updating workspace</div>}
    </div>
  );
}

function Overview({ assets, invoices, employeeRequests, activity, onOpenAsset, onOpenAssets, onOpenEmployeeRequests }: {
  assets: Asset[];
  invoices: Invoice[];
  employeeRequests: EmployeeAssetRequest[];
  activity: DashboardData;
  onOpenAsset: (asset: Asset) => void;
  onOpenAssets: () => void;
  onOpenEmployeeRequests: () => void;
}) {
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const activeAssets = assets.filter((asset) => asset.status !== 'RETIRED').length;
  const warrantyAssets = assets.filter((asset) => asset.status !== 'RETIRED');
  const underWarrantyCount = warrantyAssets.filter((asset) => ['ACTIVE', 'EXPIRING'].includes(warrantyStatus(asset))).length;
  const outOfWarrantyCount = warrantyAssets.filter((asset) => warrantyStatus(asset) === 'EXPIRED').length;
  const employeeRequestStatuses = [
    { label: 'Awaiting approval', value: employeeRequests.filter((request) => request.status === 'PENDING_APPROVAL').length, color: 'amber' },
    { label: 'Approved', value: employeeRequests.filter((request) => request.status === 'APPROVED').length, color: 'teal' },
    { label: 'Rejected', value: employeeRequests.filter((request) => request.status === 'REJECTED').length, color: 'gray' },
  ];
  const activityTrend = makeDailySeries(activity.daily.map((item) => item.date), activity.daily);

  return <div className="fade-in operations-dashboard">
    <div className="page-heading">
      <div><p className="eyebrow">Workspace overview <span className="live-dot"></span> Live data</p><h1>Operations Dashboard</h1><p className="heading-copy">{today} · Asset and operations overview.</p></div>
    </div>

    <div className="metric-grid dashboard-metrics">
      <MetricCard label="Total assets" value={assets.length.toLocaleString()} note="Registered in workspace" icon={Box} tone="blue" />
      <MetricCard label="Active assets" value={activeAssets.toLocaleString()} note={`${assets.length - activeAssets} retired`} icon={BriefcaseBusiness} tone="teal" />
      <MetricCard label="Invoice records" value={invoices.length.toLocaleString()} note="Tracked in invoice register" icon={FileText} tone="blue" />
      <div className="metric-card dashboard-warranty-card"><div className="metric-icon teal"><BadgeCheck size={18} /></div><div className="metric-label">Warranty coverage</div><div className="dashboard-warranty-counts"><div><span>Under warranty</span><strong>{underWarrantyCount.toLocaleString()}</strong></div><div><span>Out of warranty</span><strong>{outOfWarrantyCount.toLocaleString()}</strong></div></div></div>
    </div>

    <div className="dashboard-reference-grid dashboard-overview-grid">
      <section className="panel dashboard-panel"><PanelHeader title="Employee Asset Requests" action="View requests" onAction={onOpenEmployeeRequests} /><DashboardStatusGrid items={employeeRequestStatuses} footer={`${employeeRequests.length} equipment request${employeeRequests.length === 1 ? '' : 's'}`} /></section>
    </div>

    <div className="dashboard-reference-grid dashboard-chart-grid">
      <section className="panel dashboard-panel"><PanelHeader title="Activity Trend" subtitle="Successful workspace actions over the last 30 days" /><DashboardTrend values={activityTrend} color="teal" /></section>
    </div>

    <div className="dashboard-reference-grid dashboard-recent-grid">
      <section className="panel table-panel dashboard-panel"><PanelHeader title="Recent Assets" subtitle="Latest registered devices" action="View all" onAction={onOpenAssets} /><div className="data-table-wrap"><table className="data-table dashboard-assets-table"><thead><tr><th>Make</th><th>Model</th><th>Serial number</th><th>Status</th></tr></thead><tbody>{assets.slice(0, 6).map((asset) => <tr key={asset.id}><td>{asset.manufacturer}</td><td>{asset.model}</td><td><button type="button" className="record-link" onClick={() => onOpenAsset(asset)}>{asset.serial_number}</button></td><td><StatusBadge status={asset.status} /></td></tr>)}</tbody></table>{assets.length === 0 && <EmptyState text="No assets have been registered yet." />}</div></section>
      <section className="panel dashboard-panel dashboard-activity-panel"><PanelHeader title="Recent Activity" subtitle="Latest successful workspace actions" /><div className="dashboard-activity-list">{activity.recent.map((item, index) => <div className="dashboard-activity-item" key={`${item.action}-${item.entity_type}-${item.created_at}-${index}`}><span className="dashboard-activity-mark"><Activity size={14} /></span><div><strong>{formatActivity(item.action)} · {formatActivity(item.entity_type)}</strong><small>{formatDateTime(item.created_at)}</small></div></div>)}{activity.recent.length === 0 && <EmptyState text="Workspace activity will appear here." />}</div></section>
    </div>
  </div>;
}

function makeDailySeries(values: string[], stored: { date: string; count: number }[] = []) {
  const counts = new Map<string, number>();
  if (stored.length) {
    stored.forEach((item) => counts.set(item.date.slice(0, 10), item.count));
  } else {
    values.forEach((value) => {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        const key = value.slice(0, 10);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (29 - index));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return { date: key, label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }), value: counts.get(key) || 0 };
  });
}

function formatActivity(value: string) {
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DashboardStatusGrid({ items, footer }: { items: { label: string; value: number; color: string }[]; footer: string }) {
  return <div className="dashboard-status-content"><div className="dashboard-status-grid">{items.map((item) => <div className={`dashboard-status-card ${item.color}`} key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div><p>{footer}</p></div>;
}

function DashboardTrend({ values, color }: { values: { date: string; label: string; value: number }[]; color: string }) {
  const maximum = Math.max(...values.map((item) => item.value), 1);
  return <div className="dashboard-trend" role="img" aria-label={`Daily activity chart, ${values.reduce((sum, item) => sum + item.value, 0)} total over 30 days`}>
    <div className="dashboard-trend-y"><span>{maximum}</span><span>{Math.ceil(maximum / 2)}</span><span>0</span></div>
    <div className="dashboard-trend-plot">{values.map((item) => <div className={`dashboard-trend-column ${color}`} key={item.date} title={`${item.label}: ${item.value}`}><span style={{ height: `${item.value ? Math.max((item.value / maximum) * 100, 4) : 0}%` }} /></div>)}</div>
    <div className="dashboard-trend-x"><span>{values[0]?.label}</span><span>{values[14]?.label}</span><span>{values[29]?.label}</span></div>
  </div>;
}

function AssetsView({ assets, user, onAdd, onRefresh, onImportComplete, query, openAssetId, onAssetOpened, onOpenWarranties }: { assets: Asset[]; user: AppUser; onAdd: () => void; onRefresh: () => void; onImportComplete: () => Promise<void>; query: string; openAssetId: string | null; onAssetOpened: () => void; onOpenWarranties: () => void }) {
  const [statusFilter, setStatusFilter] = useState<'ALL' | Asset['status']>('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [custodianFilter, setCustodianFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const canManage = user.role === 'admin' || user.role === 'it_asset_manager';
  useEffect(() => {
    if (!openAssetId) return;
    const asset = assets.find((item) => item.id === openAssetId);
    if (asset) {
      setSelectedAsset(asset);
      onAssetOpened();
    }
  }, [assets, onAssetOpened, openAssetId]);
  const categories = useMemo(() => [...new Set(assets.map((asset) => asset.category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [assets]);
  const custodians = useMemo(() => [...new Set(assets.map((asset) => asset.custodian.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [assets]);
  const locations = useMemo(() => [...new Set(assets.map((asset) => asset.location.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [assets]);
  const visibleAssets = assets.filter((asset) => {
    const term = query.trim().toLowerCase();
    const matchesQuery = !term || [asset.asset_tag, asset.category, asset.manufacturer, asset.model, asset.serial_number, asset.custodian, asset.location, asset.department].some((value) => value.toLowerCase().includes(term));
    return matchesQuery
      && (categoryFilter === 'ALL' || asset.category === categoryFilter)
      && (custodianFilter === 'ALL' || asset.custodian === custodianFilter)
      && (locationFilter === 'ALL' || asset.location === locationFilter)
      && (statusFilter === 'ALL' || asset.status === statusFilter);
  });
  const downloadReport = () => {
    const headers = ['Asset Tag', 'Category', 'Manufacturer', 'Model', 'Serial Number', 'Status', 'Condition', 'Custodian', 'Location', 'Department', 'Purchase Cost', 'Warranty Start', 'Warranty End'];
    const rows = visibleAssets.map((asset) => [
      asset.asset_tag, asset.category, asset.manufacturer, asset.model, asset.serial_number, asset.status,
      asset.condition, asset.custodian, asset.location, asset.department, String(asset.purchase_cost),
      asset.warranty_start || '', asset.warranty_end || '',
    ]);
    const escapeCell = (value: string) => {
      const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safeValue.replace(/"/g, '""')}"`;
    };
    const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'asset-register-report.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <div className="fade-in"><div className="page-heading"><div><p className="eyebrow">Asset lifecycle <span className="eyebrow-separator">/</span> Register</p><h1>Asset register</h1><p className="heading-copy">Every device, assignment, and lifecycle event in one place.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={downloadReport}><Download size={16} /> Download Report</button><button className="button button-secondary" onClick={onOpenWarranties}><BadgeCheck size={16} /> Warranty report</button>{canManage && <><button className="button button-secondary" onClick={() => setUploadOpen(true)}><Upload size={16} /> Upload Excel</button><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add asset</button></>}</div></div><div className="subnav-row"><div className="asset-workflow-note"><Activity size={15} /> Lifecycle actions are recorded to the asset history</div></div>{query && <div className="filter-note"><Search size={14} /> Showing matches for “{query}”</div>}<div className="asset-filter-toolbar invoice-toolbar"><label className="invoice-filter-label">Category<select aria-label="Filter assets by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="ALL">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label className="invoice-filter-label">Custodian<select aria-label="Filter assets by custodian" value={custodianFilter} onChange={(event) => setCustodianFilter(event.target.value)}><option value="ALL">All custodians</option>{custodians.map((custodian) => <option key={custodian} value={custodian}>{custodian}</option>)}</select></label><label className="invoice-filter-label">Location<select aria-label="Filter assets by location" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="ALL">All locations</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select></label><label className="invoice-filter-label">Status<select aria-label="Filter assets by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="ALL">All statuses</option>{(['ASSIGNED', 'AVAILABLE', 'UNDER_MAINTENANCE', 'QUARANTINED', 'RETIRED'] as const).map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label></div><section className="panel table-panel full-panel"><AssetTable assets={visibleAssets} onManage={setSelectedAsset} onOpenWarranties={onOpenWarranties} /></section>{selectedAsset && <AssetLifecycleDialog asset={selectedAsset} canManage={canManage} onClose={() => setSelectedAsset(null)} onSaved={onRefresh} />}{uploadOpen && <AssetImportModal onClose={() => setUploadOpen(false)} onSaved={async () => { setStatusFilter('ALL'); setCategoryFilter('ALL'); setCustodianFilter('ALL'); setLocationFilter('ALL'); await onImportComplete(); }} />}</div>;
}

function AssetImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  const downloadTemplate = async () => {
    setDownloading(true);
    setError(null);
    try {
      const blob = await api.download('/api/assets/template');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'asset-import-template.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not download the asset template.');
    } finally {
      setDownloading(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setRefreshError(null);
    try {
      const result = await api.upload<{ imported: number }>('/api/assets/import', file);
      setImported(result.imported);
      try {
        await onSaved();
      } catch (refreshFailure) {
        setRefreshError(refreshFailure instanceof ApiError ? refreshFailure.message : 'The assets were imported, but the register could not be refreshed.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not import the asset spreadsheet.');
    } finally {
      setBusy(false);
    }
  };

  const retryRefresh = async () => {
    setBusy(true);
    setRefreshError(null);
    try {
      await onSaved();
    } catch (err) {
      setRefreshError(err instanceof ApiError ? err.message : 'Could not refresh the Asset Register.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal-card asset-import-card" onSubmit={submit}>
      <div className="modal-header"><div><p className="eyebrow">Asset register</p><h2>Upload assets from Excel</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={busy}><X size={18} /></button></div>
      <p className="import-help">Download the template, fill in one asset per row, then upload the completed .xlsx file. Asset Tag, Category, Manufacturer, Model, Serial Number, Custodian, Location, and Department are required. New assets are added as Available and in New condition. The whole file is validated before anything is imported.</p>
      <button type="button" className="button button-secondary template-download" onClick={() => void downloadTemplate()} disabled={downloading || busy}><Download size={16} />{downloading ? 'Preparing template...' : 'Download Template'}</button>
      {imported === null && <label className="import-file-label">Excel workbook (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(null); }} /></label>}
      {error && <div className="auth-message import-error">{error}</div>}
      {imported !== null && <div className="import-success" role="status">Successfully imported {imported} {imported === 1 ? 'asset' : 'assets'}.</div>}
      {refreshError && <div className="auth-message import-error" role="alert">Import succeeded, but the Asset Register could not be refreshed: {refreshError}<button type="button" className="text-button" onClick={() => void retryRefresh()} disabled={busy}>Retry refresh</button></div>}
      <div className="modal-actions">
        {imported !== null ? <button type="button" className="button button-primary" onClick={onClose} disabled={busy}>Done</button> : <><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!file || busy}>{busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}{busy ? 'Uploading...' : 'Upload'}</button></>}
      </div>
    </form>
  </div>;
}

function InvoicesView({ invoices, user, query, onSaved }: { invoices: Invoice[]; user: AppUser; query: string; onSaved: () => void }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [filter, setFilter] = useState<'ALL' | Invoice['status']>('ALL');
  const [search, setSearch] = useState(query);
  const [tableError, setTableError] = useState<string | null>(null);
  const canManage = user.role === 'admin' || user.role === 'finance_officer';
  useEffect(() => setSearch(query), [query]);
  const visibleInvoices = invoices.filter((invoice) => {
    const matchesStatus = filter === 'ALL' || invoice.status === filter;
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [invoice.invoice_number, invoice.purchase_order, invoice.vendor].some((value) => value?.toLowerCase().includes(term));
    return matchesStatus && matchesSearch;
  });
  const updateStatus = async (invoice: Invoice, status: Invoice['status']) => {
    setTableError(null);
    try { await api.put(`/api/invoices/${encodeURIComponent(invoice.id)}`, { status }); onSaved(); }
    catch (err) { setTableError(err instanceof ApiError ? err.message : 'Could not update invoice status.'); }
  };
  const deleteInvoice = async (invoice: Invoice) => {
    if (!window.confirm(`Delete invoice ${invoice.invoice_number}? This does not delete its uploaded document.`)) return;
    setTableError(null);
    try { await api.del(`/api/invoices/${encodeURIComponent(invoice.id)}`); onSaved(); }
    catch (err) { setTableError(err instanceof ApiError ? err.message : 'Could not delete this invoice.'); }
  };
  const downloadInvoice = async (invoice: Invoice) => {
    if (!invoice.document_id || !invoice.file_visible) return;
    setTableError(null);
    try {
      const file = await api.download(`/api/documents/${encodeURIComponent(invoice.document_id)}/file`);
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = invoice.file_name || 'invoice';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setTableError(err instanceof ApiError ? err.message : 'Could not download the invoice file.'); }
  };
  return <div className="fade-in">
    <PageTitle eyebrow="Finance / Payables" title="Invoices" copy="Review invoice details, supporting files, and processing status." />
    <div className="invoice-toolbar"><div className="invoice-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice, PO, or supplier" aria-label="Search invoices" /></div><label className="invoice-filter-label">Status<select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter invoices by status"><option value="ALL">All statuses</option>{invoiceStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>{canManage && <div className="invoice-toolbar-actions"><button className="button button-secondary" onClick={() => setManualOpen(true)}><Plus size={16} /> Manual Entry</button><button className="button button-primary" onClick={() => setUploadOpen(true)}><FileText size={16} /> Upload Invoice</button></div>}</div>
    <div className="stat-strip"><MiniStat label="In queue" value={invoices.filter((invoice) => invoice.status !== 'PROCESSED').length.toString()} tone="amber" /><MiniStat label="Needs review" value={invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD').length.toString()} tone="red" /><MiniStat label="Processed spend" value={compactMoney.format(invoices.filter((invoice) => invoice.status === 'PROCESSED').reduce((sum, invoice) => sum + Number(invoice.total), 0))} tone="teal" /></div>
    {tableError && <div className="auth-message module-error invoice-table-error">{tableError}</div>}
    <section className="panel table-panel full-panel"><InvoiceTable invoices={visibleInvoices} canManage={canManage} canDelete={user.role === 'admin'} onStatusChange={(invoice, status) => void updateStatus(invoice, status)} onDelete={(invoice) => void deleteInvoice(invoice)} onDownload={(invoice) => void downloadInvoice(invoice)} /></section>
    {uploadOpen && <InvoiceUploadModal onClose={() => setUploadOpen(false)} onSaved={() => { setUploadOpen(false); onSaved(); }} />}
    {manualOpen && <ManualInvoiceModal onClose={() => setManualOpen(false)} onSaved={() => { setManualOpen(false); onSaved(); }} />}
  </div>;
}

function EmployeeAssetsView({ requests, assets, user, onSaved }: { requests: EmployeeAssetRequest[]; assets: Asset[]; user: AppUser; onSaved: () => void }) {
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<EmployeeAssetAssignment | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeAssetAssignment | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<EmployeeAssetAssignment | null>(null);
  const [assignments, setAssignments] = useState<EmployeeAssetAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const [assignmentActionError, setAssignmentActionError] = useState<string | null>(null);
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [assignmentBusy, setAssignmentBusy] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const canReview = user.role === 'admin' || user.role === 'it_asset_manager';
  const visibleAssignments = assignments.filter((assignment) =>
    [assignment.employee_name, assignment.employee_id, assignment.designation, assignment.department, assignment.asset_model, assignment.serial_number, assignment.remarks]
      .some((value) => value.toLowerCase().includes(assignmentSearch.trim().toLowerCase())),
  );
  const loadAssignments = useCallback(async () => {
    setAssignmentsLoading(true);
    setAssignmentsError(null);
    try {
      setAssignments(await api.get<EmployeeAssetAssignment[]>('/api/workflows/employee-assignments'));
    } catch (err) {
      setAssignmentsError(err instanceof ApiError ? err.message : 'Could not load employee asset assignments.');
    } finally {
      setAssignmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const review = async (request: EmployeeAssetRequest, status: 'APPROVED' | 'REJECTED') => {
    setReviewError(null);
    try {
      await api.put(`/api/workflows/employee-requests/${encodeURIComponent(request.id)}/review`, { status });
      onSaved();
    } catch (error) {
      setReviewError(error instanceof ApiError ? error.message : 'Could not review the asset request.');
    }
  };
  const downloadAssignments = async () => {
    setAssignmentActionError(null);
    try {
      const file = await api.download('/api/workflows/employee-assignments/export');
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'employee-asset-assignments.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAssignmentActionError(err instanceof ApiError ? err.message : 'Could not download the employee assignment spreadsheet.');
    }
  };
  const deleteAssignment = async (assignment: EmployeeAssetAssignment) => {
    if (!window.confirm(`Delete the asset assignment for ${assignment.employee_name} (${assignment.serial_number})?`)) return;
    setAssignmentBusy(assignment.id);
    setAssignmentActionError(null);
    try {
      await api.del(`/api/workflows/employee-assignments/${encodeURIComponent(assignment.id)}`);
      setAssignments((current) => current.filter((item) => item.id !== assignment.id));
    } catch (err) {
      setAssignmentActionError(err instanceof ApiError ? err.message : 'Could not delete this employee asset assignment.');
    } finally {
      setAssignmentBusy(null);
    }
  };

  return <div className="fade-in">
    <div className="page-heading employee-assets-heading"><div><p className="eyebrow">Employee services / Equipment</p><h1>Employee Asset Management</h1><p className="heading-copy">{canReview ? 'Manage employee asset assignments and equipment requests.' : 'View your assigned equipment and follow asset request status.'}</p></div><div className="heading-actions">{canReview && <button className="button button-secondary" onClick={() => void downloadAssignments()}><Download size={16} /> Download Excel</button>}{canReview ? <button className="button button-primary" onClick={() => { setEditingAssignment(null); setAssignmentModalOpen(true); }}><Plus size={17} /> New Assignment</button> : <button className="button button-primary" onClick={() => setRequestModalOpen(true)}><Plus size={17} /> Request asset</button>}</div></div>
    {assignmentActionError && <div className="auth-message module-error" role="alert">{assignmentActionError}</div>}
    {canReview && <section className="panel table-panel full-panel employee-assignment-panel">
      <div className="employee-assignment-toolbar"><div><h2>Employee asset assignments</h2><p>Assigned equipment by employee</p></div><label className="employee-assignment-search"><Search size={15} /><input value={assignmentSearch} onChange={(event) => setAssignmentSearch(event.target.value)} placeholder="Search employee, asset, or serial number" aria-label="Search employee asset assignments" /></label></div>
      {assignmentsError && <div className="auth-message module-error employee-assignment-error" role="alert">{assignmentsError}<button type="button" className="text-button" onClick={() => void loadAssignments()}>Retry</button></div>}
      {assignmentsLoading ? <div className="history-state"><Loader2 size={17} className="spin" /> Loading employee assignments</div> : assignmentsError ? null : visibleAssignments.length === 0 ? <EmptyState text={assignments.length ? 'No assignments match your search.' : 'No employee asset assignments have been recorded yet.'} /> : <div className="data-table-wrap employee-assignment-table-wrap"><table className="data-table employee-assignment-table"><thead><tr><th>Employee Name</th><th>Employee ID</th><th>Designation</th><th>Department</th><th>Asset Model</th><th>Serial Number</th><th>DoJ</th><th>Remarks</th><th>Actions</th></tr></thead><tbody>{visibleAssignments.map((assignment) => <tr key={assignment.id}><td><button type="button" className="record-link" onClick={() => setSelectedEmployee(assignment)}>{assignment.employee_name}</button></td><td>{assignment.employee_id}</td><td>{assignment.designation}</td><td>{assignment.department}</td><td>{assignment.asset_model}</td><td><button type="button" className="employee-serial-number" onClick={() => setSelectedAssignment(assignment)} aria-label={`View asset and assignment details for serial number ${assignment.serial_number}`}>{assignment.serial_number}</button></td><td>{formatDate(assignment.doj)}</td><td>{assignment.remarks || '—'}</td><td><div className="employee-assignment-actions"><button type="button" className="button button-secondary" disabled={assignmentBusy === assignment.id} onClick={() => { setEditingAssignment(assignment); setAssignmentModalOpen(true); }}><Pencil size={13} /> Edit</button><button type="button" className="button employee-assignment-delete" disabled={assignmentBusy === assignment.id} onClick={() => void deleteAssignment(assignment)}>{assignmentBusy === assignment.id ? <Loader2 size={13} className="spin" /> : <XCircle size={13} />} Delete</button></div></td></tr>)}</tbody></table></div>}
    </section>}
    <div className="stat-strip employee-request-stats"><MiniStat label="Pending review" value={requests.filter((request) => request.status === 'PENDING_APPROVAL').length.toString()} tone="amber" /><MiniStat label="Approved" value={requests.filter((request) => request.status === 'APPROVED').length.toString()} tone="teal" /><MiniStat label="Requests shown" value={requests.length.toString()} tone="blue" /></div>
    {reviewError && <div className="auth-message module-error">{reviewError}</div>}
    <section className="panel table-panel full-panel"><PanelHeader title={canReview ? 'Employee equipment requests' : 'My asset requests'} subtitle={canReview ? 'Requests across the workspace' : 'Requests are visible only to you and asset managers'} /><div className="request-list">{requests.map((request) => {
      const employeeAssignment = assignments.find((item) => item.employee_id === request.requester_id || item.employee_name.trim().toLowerCase() === request.requester_name.trim().toLowerCase());
      return <div className="request-row employee-request-row" key={request.id}><div className="request-icon"><Users size={17} /></div><div className="request-main"><strong>{request.category} · {request.request_number}</strong><span>{employeeAssignment ? <button type="button" className="record-link" onClick={() => setSelectedEmployee(employeeAssignment)}>{request.requester_name}</button> : request.requester_name} · {request.department} · Needed by {formatDate(request.needed_by)}</span><small>{request.justification}</small></div><StatusBadge status={request.status} />{canReview && request.status === 'PENDING_APPROVAL' && <div className="request-review-actions"><button className="icon-button approve-action" aria-label={`Approve ${request.request_number}`} onClick={() => void review(request, 'APPROVED')}><Check size={17} /></button><button className="icon-button reject-action" aria-label={`Reject ${request.request_number}`} onClick={() => void review(request, 'REJECTED')}><XCircle size={17} /></button></div>}</div>;
    })}</div>{requests.length === 0 && <EmptyState text={canReview ? 'No employee asset requests are waiting.' : 'You have not submitted an asset request yet.'} />}</section>
    {requestModalOpen && <EmployeeAssetRequestModal user={user} onClose={() => setRequestModalOpen(false)} onSaved={() => { setRequestModalOpen(false); onSaved(); }} />}
    {assignmentModalOpen && <EmployeeAssetAssignmentModal assignment={editingAssignment} assets={assets} assignments={assignments} onClose={() => setAssignmentModalOpen(false)} onSaved={(assignment) => { setAssignments((current) => current.some((item) => item.id === assignment.id || item.serial_number === assignment.serial_number) ? current.map((item) => item.id === assignment.id || item.serial_number === assignment.serial_number ? assignment : item) : [...current, assignment].sort((a, b) => a.employee_name.localeCompare(b.employee_name))); setAssignmentModalOpen(false); onSaved(); }} />}
    {selectedEmployee && <EmployeeProfileDialog assignment={selectedEmployee} assignments={assignments.filter((item) => item.employee_id === selectedEmployee.employee_id)} onClose={() => setSelectedEmployee(null)} onOpenAsset={(assignment) => { setSelectedEmployee(null); setSelectedAssignment(assignment); }} />}
    {selectedAssignment && <EmployeeAssetDetailsDialog assignment={selectedAssignment} asset={assets.find((item) => item.serial_number === selectedAssignment.serial_number)} onClose={() => setSelectedAssignment(null)} />}
  </div>;
}

function EmployeeProfileDialog({ assignment, assignments, onClose, onOpenAsset }: { assignment: EmployeeAssetAssignment; assignments: EmployeeAssetAssignment[]; onClose: () => void; onOpenAsset: (assignment: EmployeeAssetAssignment) => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card record-details-card" role="dialog" aria-modal="true" aria-labelledby="employee-profile-title">
    <div className="modal-header"><div><p className="eyebrow">Employee profile</p><h2 id="employee-profile-title">{assignment.employee_name}</h2><span className="asset-modal-model">{assignment.employee_id}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close employee details"><X size={18} /></button></div>
    <div className="asset-detail-grid"><div><span>Designation</span><strong>{assignment.designation || 'Not recorded'}</strong></div><div><span>Department</span><strong>{assignment.department || 'Not recorded'}</strong></div><div><span>Date of joining</span><strong>{assignment.doj ? formatDate(assignment.doj) : 'Not recorded'}</strong></div></div>
    <section className="record-details-section"><h3>Assigned equipment</h3>{assignments.length ? <div className="record-related-list">{assignments.map((item) => <button type="button" className="record-related-row" key={item.id} onClick={() => onOpenAsset(item)}><span><strong>{item.serial_number}</strong><small>{item.asset_model}</small></span><ArrowUpRight size={15} /></button>)}</div> : <span className="invoice-detail-empty">No equipment assignments are recorded.</span>}</section>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button></div>
  </div></div>;
}

function EmployeeAssetDetailsDialog({ assignment, asset, onClose }: { assignment: EmployeeAssetAssignment; asset: Asset | undefined; onClose: () => void }) {
  const coverage = asset ? warrantyStatus(asset) : 'UNKNOWN';
  const coverageLabel = coverage === 'ACTIVE' ? 'COVERED' : coverage === 'EXPIRING' ? 'EXPIRING_SOON' : coverage;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card employee-asset-details-card" role="dialog" aria-modal="true" aria-labelledby="employee-asset-details-title">
    <div className="modal-header"><div><p className="eyebrow">Employee asset details</p><h2 id="employee-asset-details-title">{assignment.serial_number}</h2><span className="asset-modal-model">{assignment.asset_model}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close asset details"><X size={18} /></button></div>
    <section className="employee-asset-details-section"><h3>Asset details</h3>{asset ? <div className="asset-detail-grid"><div><span>Asset tag</span><strong>{asset.asset_tag}</strong></div><div><span>Category</span><strong>{asset.category}</strong></div><div><span>Manufacturer</span><strong>{asset.manufacturer}</strong></div><div><span>Model</span><strong>{asset.model}</strong></div><div><span>Serial number</span><strong>{asset.serial_number}</strong></div><div><span>Condition</span><strong>{asset.condition}</strong></div><div><span>Location</span><strong>{asset.location}</strong></div><div><span>Asset status</span><StatusBadge status={asset.status} /></div></div> : <div className="auth-message" role="status">Asset details are not available for this serial number.</div>}</section>
    <section className="employee-asset-details-section"><h3>Assigned user</h3><div className="asset-detail-grid"><div><span>Name</span><strong>{assignment.employee_name}</strong></div><div><span>Employee ID</span><strong>{assignment.employee_id}</strong></div><div><span>Designation</span><strong>{assignment.designation || 'Not recorded'}</strong></div><div><span>Department</span><strong>{assignment.department || 'Not recorded'}</strong></div><div><span>Date of joining</span><strong>{assignment.doj ? formatDate(assignment.doj) : 'Not recorded'}</strong></div><div className="employee-asset-detail-wide"><span>Remarks</span><strong>{assignment.remarks || 'None'}</strong></div></div></section>
    <section className="employee-asset-details-section"><h3>Warranty details</h3>{asset ? <div className="asset-detail-grid"><div><span>Warranty start</span><strong>{asset.warranty_start ? formatDate(asset.warranty_start) : 'Not recorded'}</strong></div><div><span>Warranty end</span><strong>{asset.warranty_end ? formatDate(asset.warranty_end) : 'Not recorded'}</strong></div><div><span>Coverage status</span><StatusBadge status={coverageLabel} /></div></div> : <div className="asset-detail-grid"><div><span>Coverage status</span><StatusBadge status="UNKNOWN" /></div></div>}</section>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button></div>
  </div></div>;
}

function EmployeeAssetAssignmentModal({ assignment, assets, assignments, onClose, onSaved }: { assignment: EmployeeAssetAssignment | null; assets: Asset[]; assignments: EmployeeAssetAssignment[]; onClose: () => void; onSaved: (assignment: EmployeeAssetAssignment) => void }) {
  const selectableAssets = assets.filter((asset) =>
    asset.status === 'AVAILABLE' || asset.serial_number === assignment?.serial_number,
  );
  const assetTypes = Array.from(new Set(selectableAssets.map((asset) => asset.category))).sort((a, b) => a.localeCompare(b));
  const currentAsset = assets.find((asset) => asset.serial_number === assignment?.serial_number);
  const [form, setForm] = useState({
    employee_name: assignment?.employee_name ?? '',
    employee_id: assignment?.employee_id ?? '',
    designation: assignment?.designation ?? '',
    department: assignment?.department ?? '',
    asset_type: currentAsset?.category ?? '',
    asset_model: currentAsset?.model ?? assignment?.asset_model ?? '',
    serial_number: assignment?.serial_number ?? '',
    doj: assignment?.doj ?? '',
    remarks: assignment?.remarks ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serialMissing, setSerialMissing] = useState(false);
  const assetsForType = selectableAssets.filter((asset) => !form.asset_type || asset.category.trim().toLowerCase() === form.asset_type.trim().toLowerCase());
  const existingAssignment = assignments.find((item) => item.serial_number === form.serial_number && item.id !== assignment?.id);
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.serial_number) {
      setSerialMissing(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        employee_name: form.employee_name,
        employee_id: form.employee_id,
        designation: form.designation,
        department: form.department,
        asset_model: form.asset_model,
        serial_number: form.serial_number,
        doj: form.doj,
        remarks: form.remarks,
      };
      const saved = assignment
        ? await api.put<EmployeeAssetAssignment>(`/api/workflows/employee-assignments/${encodeURIComponent(assignment.id)}`, payload)
        : await api.post<EmployeeAssetAssignment>('/api/workflows/employee-assignments', payload);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this employee asset assignment.');
    } finally {
      setBusy(false);
    }
  };
  const fields: { key: keyof typeof form; label: string; required?: boolean; type?: string }[] = [
    { key: 'employee_name', label: 'Employee Name', required: true },
    { key: 'employee_id', label: 'Employee ID', required: true },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' },
    { key: 'doj', label: 'Date of Joining', type: 'date' },
  ];
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="modal-card employee-assignment-modal" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Employee services / Equipment</p><h2>{assignment ? 'Edit Employee Asset' : 'New Employee Asset'}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close assignment form" disabled={busy}><X size={18} /></button></div><div className="form-grid employee-assignment-form">{fields.slice(0, 4).map(({ key, label, required, type }) => <label key={key}>{label}{required && ' *'}<input required={required} type={type ?? 'text'} value={form[key]} onChange={(event) => update(key, event.target.value)} /></label>)}<label className="span-2">Asset Type<select value={form.asset_type} onChange={(event) => { setForm((current) => ({ ...current, asset_type: event.target.value, serial_number: '', asset_model: '' })); setSerialMissing(false); setError(null); }}><option value="">All asset types</option>{assetTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label className="span-2">Serial Number *<select required value={form.serial_number} aria-invalid={serialMissing && !form.serial_number} aria-describedby="assignment-serial-hint" onChange={(event) => { const selected = assetsForType.find((asset) => asset.serial_number === event.target.value); setForm((current) => ({ ...current, serial_number: event.target.value, asset_model: selected?.model ?? '' })); setSerialMissing(false); setError(null); }}><option value="">Select a serial number</option>{assetsForType.map((asset) => <option key={asset.id} value={asset.serial_number}>{asset.serial_number} · {asset.manufacturer} {asset.model}{assignments.some((item) => item.serial_number === asset.serial_number && item.id !== assignment?.id) ? ' · Reassign' : ''}</option>)}</select>{existingAssignment && <small className="assignment-serial-hint">This available asset is already listed for {existingAssignment.employee_name}; saving will update its assignment.</small>}{(!assetsForType.length || serialMissing) && <small className="assignment-serial-hint" id="assignment-serial-hint">{assetsForType.length ? 'Serial number is required — pick one from the dropdown below.' : 'No available serial numbers match this asset type.'}</small>}</label>{fields.slice(4).map(({ key, label, required, type }) => <label key={key}>{label}{required && ' *'}<input required={required} type={type ?? 'text'} value={form[key]} onChange={(event) => update(key, event.target.value)} /></label>)}<label className="span-2">Remarks<textarea maxLength={1000} value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} placeholder="Optional assignment notes" /></label></div>{error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving...' : assignment ? 'Save changes' : 'Create assignment'}</button></div></form></div>;
}

function EmployeeAssetRequestModal({ user, onClose, onSaved }: { user: AppUser; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ category: 'Laptop', justification: '', needed_by: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/workflows/employee-requests', form);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the asset request.');
    } finally {
      setBusy(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Employee equipment</p><h2>Request an asset</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label>Equipment category<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}><option>Laptop</option><option>Monitor</option><option>Mobile</option><option>Keyboard / mouse</option><option>Other</option></select></label><label>Needed by<input required type="date" value={form.needed_by} onChange={(event) => setForm((current) => ({ ...current, needed_by: event.target.value }))} /></label><label className="span-2">Business justification<textarea required value={form.justification} onChange={(event) => setForm((current) => ({ ...current, justification: event.target.value }))} placeholder={`Explain why you need this equipment, ${user.full_name}.`} /></label></div>{error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Submitting...' : 'Submit request'}</button></div></form></div>;
}

function GoodsReceiptModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ purchase_order: '', vendor: '', received_date: new Date().toISOString().slice(0, 10), ordered_quantity: '1', accepted_quantity: '1', rejected_quantity: '0', discrepancy_note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/receipts', { ...form, ordered_quantity: Number(form.ordered_quantity), accepted_quantity: Number(form.accepted_quantity), rejected_quantity: Number(form.rejected_quantity) });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the goods receipt.');
    } finally {
      setBusy(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Inventory / Receiving</p><h2>Record goods receipt</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label>Purchase order<input required value={form.purchase_order} onChange={(event) => update('purchase_order', event.target.value)} /></label><label>Supplier<input required value={form.vendor} onChange={(event) => update('vendor', event.target.value)} /></label><label>Received date<input required type="date" value={form.received_date} onChange={(event) => update('received_date', event.target.value)} /></label><label>Ordered quantity<input required min="0" type="number" value={form.ordered_quantity} onChange={(event) => update('ordered_quantity', event.target.value)} /></label><label>Accepted quantity<input required min="0" type="number" value={form.accepted_quantity} onChange={(event) => update('accepted_quantity', event.target.value)} /></label><label>Rejected quantity<input required min="0" type="number" value={form.rejected_quantity} onChange={(event) => update('rejected_quantity', event.target.value)} /></label><label className="span-2">Discrepancy note<textarea value={form.discrepancy_note} onChange={(event) => update('discrepancy_note', event.target.value)} placeholder="Optional notes about rejected or missing items" /></label></div>{error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving...' : 'Save receipt'}</button></div></form></div>;
}

function InventoryView({ assets, receipts, user, onSaved }: { assets: Asset[]; receipts: InventoryReceipt[]; user: AppUser; onSaved: () => void }) {
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const stock = assets.filter((asset) => asset.status === 'AVAILABLE');
  const categories = [...new Set(stock.map((asset) => asset.category))];
  const canReceive = ['admin', 'it_asset_manager'].includes(user.role);
  return <div className="fade-in">
    <PageTitle eyebrow="Inventory / Stock operations" title="Inventory" copy="Available assets and goods receipt activity from your operational register." action={canReceive ? 'Record goods receipt' : undefined} icon={Plus} onAction={canReceive ? () => setReceiptModalOpen(true) : undefined} />
    <div className="stat-strip"><MiniStat label="Available assets" value={stock.length.toString()} tone="teal" /><MiniStat label="Categories in stock" value={categories.length.toString()} tone="blue" /><MiniStat label="Goods receipts" value={receipts.length.toString()} tone="amber" /></div>
    <section className="panel table-panel full-panel"><PanelHeader title="Available stock" subtitle="Registered assets ready to assign" /><AssetTable assets={stock} /></section>
    <section className="panel table-panel full-panel module-panel-gap"><PanelHeader title="Recent goods receipts" subtitle="Received and accepted quantities recorded against purchase orders" /><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Receipt</th><th>Purchase order</th><th>Supplier</th><th>Received</th><th>Accepted / ordered</th><th>Status</th></tr></thead><tbody>{receipts.map((receipt) => <tr key={receipt.id}><td><strong>{receipt.receipt_number}</strong></td><td>{receipt.purchase_order}</td><td>{receipt.vendor}</td><td>{formatDate(receipt.received_date)}</td><td>{receipt.accepted_quantity} / {receipt.ordered_quantity}</td><td><StatusBadge status={receipt.status} /></td></tr>)}</tbody></table>{receipts.length === 0 && <EmptyState text="No goods receipts recorded yet." />}</div></section>
    {receiptModalOpen && <GoodsReceiptModal onClose={() => setReceiptModalOpen(false)} onSaved={() => { setReceiptModalOpen(false); onSaved(); }} />}
  </div>;
}

function WarrantiesView({ assets, onOpenAssets, onOpenInventory, onOpenAsset }: { assets: Asset[]; onOpenAssets: () => void; onOpenInventory: () => void; onOpenAsset: (asset: Asset) => void }) {
  const [manufacturerFilter, setManufacturerFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | WarrantyStatus>('ALL');
  const [reportTab, setReportTab] = useState<'COMPLIANCE' | 'FORECAST' | 'MANUFACTURER' | 'LIFECYCLE'>('COMPLIANCE');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const reportAssets = assets.filter((asset) => asset.status !== 'RETIRED');
  const manufacturers = [...new Set(reportAssets.map((asset) => asset.manufacturer))].sort((a, b) => a.localeCompare(b));
  const filteredAssets = reportAssets
    .filter((asset) => manufacturerFilter === 'ALL' || asset.manufacturer === manufacturerFilter)
    .filter((asset) => statusFilter === 'ALL' || warrantyStatus(asset, today) === statusFilter)
    .sort((a, b) => (a.warranty_end || '9999-12-31').localeCompare(b.warranty_end || '9999-12-31') || a.asset_tag.localeCompare(b.asset_tag));
  const counts = {
    total: filteredAssets.length,
    active: filteredAssets.filter((asset) => ['ACTIVE', 'EXPIRING'].includes(warrantyStatus(asset, today))).length,
    expiring: filteredAssets.filter((asset) => warrantyStatus(asset, today) === 'EXPIRING').length,
    expired: filteredAssets.filter((asset) => warrantyStatus(asset, today) === 'EXPIRED').length,
    unknown: filteredAssets.filter((asset) => warrantyStatus(asset, today) === 'UNKNOWN').length,
  };
  const monthlyForecast = Array.from({ length: 12 }, (_, monthOffset) => {
    const month = new Date(`${today}T00:00:00.000Z`);
    month.setUTCDate(1);
    month.setUTCMonth(month.getUTCMonth() + monthOffset);
    const nextMonth = new Date(month);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const from = monthOffset === 0 ? today : month.toISOString().slice(0, 10);
    const to = new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10);
    const count = filteredAssets.filter((asset) => asset.warranty_end && asset.warranty_end >= from && asset.warranty_end <= to).length;
    return { label: month.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), count };
  });
  const maxForecast = Math.max(...monthlyForecast.map(({ count }) => count), 1);
  const manufacturerCoverage = manufacturers
    .filter((manufacturer) => manufacturerFilter === 'ALL' || manufacturer === manufacturerFilter)
    .map((manufacturer) => {
      const group = filteredAssets.filter((asset) => asset.manufacturer === manufacturer);
      return {
        manufacturer,
        total: group.length,
        covered: group.filter((asset) => ['ACTIVE', 'EXPIRING'].includes(warrantyStatus(asset, today))).length,
        expired: group.filter((asset) => warrantyStatus(asset, today) === 'EXPIRED').length,
        unknown: group.filter((asset) => warrantyStatus(asset, today) === 'UNKNOWN').length,
      };
    }).filter((group) => group.total > 0);
  const lifecycleGroups = [
    { label: '<1yr', matches: (years: number) => years < 1 },
    { label: '1-3yr', matches: (years: number) => years >= 1 && years < 3 },
    { label: '3-5yr', matches: (years: number) => years >= 3 && years < 5 },
    { label: '5yr+', matches: (years: number) => years >= 5 },
  ].map(({ label, matches }) => ({
    label,
    count: filteredAssets.filter((asset) => asset.warranty_start && matches((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${asset.warranty_start}T00:00:00Z`)) / (365.25 * 86400000))).length,
  }));
  lifecycleGroups.push({ label: 'Unknown', count: filteredAssets.filter((asset) => !asset.warranty_start).length });
  const exportRows = filteredAssets.map((asset) => [
    asset.asset_tag, asset.manufacturer, asset.model, asset.serial_number, asset.category, asset.custodian,
    asset.department, asset.warranty_start || '', asset.warranty_end || '', asset.status, warrantyStatus(asset, today),
  ]);
  const exportHeaders = ['Asset Tag', 'Manufacturer', 'Model', 'Serial Number', 'Category', 'Custodian', 'Department', 'Warranty Start', 'Warranty End', 'Asset Status', 'Warranty Status'];
  const downloadCsv = () => {
    const escapeCell = (value: string) => {
      const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safeValue.replace(/"/g, '""')}"`;
    };
    const csv = [exportHeaders, ...exportRows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'warranty-report.csv';
    anchor.click();
    URL.revokeObjectURL(url);
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not download the warranty report.');
    } finally {
      setExporting(false);
    }
  };
  const panelTitle = {
    COMPLIANCE: 'Warranty Compliance',
    FORECAST: 'Expiration Forecast',
    MANUFACTURER: 'Coverage by Manufacturer',
    LIFECYCLE: 'Asset Lifecycle',
  }[reportTab];

  return <div className="fade-in warranty-report">
    <div className="page-heading">
      <div><p className="eyebrow">Asset lifecycle <span className="eyebrow-separator">/</span> Reports</p><h1>Warranty Reports</h1><p className="heading-copy">Compliance, forecast, coverage and lifecycle from your registered assets.</p></div>
      <div className="heading-actions warranty-interlinks"><button className="button button-secondary" onClick={onOpenInventory}><Archive size={16} /> Inventory</button><button className="button button-secondary" onClick={onOpenAssets}><Box size={16} /> Asset register</button></div>
    </div>
    <section className="panel warranty-filter-panel">
      <label>Manufacturer<select value={manufacturerFilter} onChange={(event) => setManufacturerFilter(event.target.value)}><option value="ALL">All manufacturers</option>{manufacturers.map((manufacturer) => <option key={manufacturer}>{manufacturer}</option>)}</select></label>
      <label>Warranty Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'ALL' | WarrantyStatus)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="EXPIRING">Expiring within 30 days</option><option value="EXPIRED">Expired</option><option value="UNKNOWN">Unknown</option></select></label>
      <span className="warranty-scope-count">{filteredAssets.length} assets in scope</span>
    </section>
    <div className="stat-strip warranty-report-stats">
      <MiniStat label="Total" value={counts.total.toString()} tone="blue" />
      <MiniStat label="Active" value={counts.active.toString()} tone="teal" />
      <MiniStat label="Expiring ≤30d" value={counts.expiring.toString()} tone="amber" />
      <MiniStat label="Expired" value={counts.expired.toString()} tone="red" />
      <MiniStat label="Unknown" value={counts.unknown.toString()} tone="gray" />
    </div>
    <section className="panel warranty-report-panel">
      <div className="warranty-report-tabs" role="tablist" aria-label="Warranty report views">
        {([
          ['COMPLIANCE', 'Compliance'],
          ['FORECAST', 'Expiration Forecast'],
          ['MANUFACTURER', 'Coverage by Manufacturer'],
          ['LIFECYCLE', 'Lifecycle'],
        ] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={reportTab === key} className={reportTab === key ? 'selected' : ''} onClick={() => setReportTab(key)}>{label}</button>)}
      </div>
      <div className="warranty-report-body" role="tabpanel">
        <div className="warranty-report-panel-heading"><div><h2>{panelTitle}</h2><p>{reportTab === 'COMPLIANCE' ? 'Registered asset coverage based on warranty dates.' : reportTab === 'FORECAST' ? 'Expirations grouped by month for the next 12 months.' : reportTab === 'MANUFACTURER' ? 'Coverage status grouped by manufacturer.' : 'Age of warranty coverage, grouped by recorded warranty start.'}</p></div><div className="warranty-export-actions"><button className="button button-secondary" onClick={() => window.print()}>PDF</button><button className="button button-secondary" onClick={() => void downloadExcel()} disabled={exporting}>{exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Excel</button><button className="button button-secondary" onClick={downloadCsv}><Download size={14} /> CSV</button></div></div>
        {error && <div className="auth-message module-error" role="alert">{error}</div>}
        {reportTab === 'COMPLIANCE' && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Make</th><th>Model</th><th>Serial</th><th>Warranty End</th><th>Asset Status</th><th>Coverage</th><th></th></tr></thead><tbody>{filteredAssets.map((asset) => { const coverage = warrantyStatus(asset, today); return <tr key={asset.id}><td>{asset.manufacturer}</td><td>{asset.model}</td><td><button type="button" className="record-link" onClick={() => onOpenAsset(asset)}>{asset.serial_number}</button></td><td>{asset.warranty_end ? formatDate(asset.warranty_end) : '—'}</td><td><StatusBadge status={asset.status} /></td><td><StatusBadge status={coverage === 'ACTIVE' ? 'COVERED' : coverage === 'EXPIRING' ? 'EXPIRING_SOON' : coverage} /></td><td><button className="row-action" onClick={() => onOpenAsset(asset)}><ArrowUpRight size={14} /> Open asset</button></td></tr>; })}</tbody></table>{filteredAssets.length === 0 && <EmptyState text="No registered assets match these warranty filters." />}</div>}
        {reportTab === 'FORECAST' && <div className="warranty-forecast" aria-label="Asset warranty expirations by month">{monthlyForecast.map(({ label, count }) => <div className="warranty-forecast-row" key={label}><span>{label}</span><div className="warranty-forecast-track"><span style={{ width: `${count ? Math.max((count / maxForecast) * 100, 4) : 0}%` }} /></div><strong>{count}</strong></div>)}</div>}
        {reportTab === 'MANUFACTURER' && <div className="warranty-group-list">{manufacturerCoverage.map((group) => <article className="warranty-group-row" key={group.manufacturer}><div className="warranty-group-title"><strong>{group.manufacturer}</strong><span>{group.total} asset{group.total === 1 ? '' : 's'}</span></div><div className="warranty-group-track"><span className="covered-segment" style={{ width: `${group.total ? (group.covered / group.total) * 100 : 0}%` }} /><span className="expired-segment" style={{ width: `${group.total ? (group.expired / group.total) * 100 : 0}%` }} /></div><div className="warranty-group-legend"><span><i className="covered-segment" /> Covered {group.covered}</span><span><i className="expired-segment" /> Expired {group.expired}</span><span>Unknown {group.unknown}</span></div></article>)}{manufacturerCoverage.length === 0 && <EmptyState text="No manufacturers match these warranty filters." />}</div>}
        {reportTab === 'LIFECYCLE' && <div className="warranty-forecast" aria-label="Assets by warranty start age">{lifecycleGroups.map(({ label, count }) => <div className="warranty-forecast-row" key={label}><span>{label}</span><div className="warranty-forecast-track"><span style={{ width: `${count ? Math.max((count / Math.max(...lifecycleGroups.map((item) => item.count), 1)) * 100, 4) : 0}%` }} /></div><strong>{count}</strong></div>)}</div>}
      </div>
    </section>
  </div>;
}

function WriteOffView({ assets, requests, user, onSaved }: { assets: Asset[]; requests: WriteOffRequest[]; user: AppUser; onSaved: () => void }) {
  const [assetId, setAssetId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRequest = user.role === 'admin' || user.role === 'it_asset_manager';
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/workflows/write-offs', { asset_id: assetId, reason });
      setAssetId('');
      setReason('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the write-off request.');
    } finally {
      setBusy(false);
    }
  };
  const review = async (request: WriteOffRequest, status: 'APPROVED' | 'REJECTED') => {
    setError(null);
    try {
      await api.put(`/api/workflows/write-offs/${encodeURIComponent(request.id)}/review`, { status });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not review the write-off request.');
    }
  };
  return <div className="fade-in"><PageTitle eyebrow="Asset lifecycle / Disposal" title="Write-Off" copy="Submit assets for disposal review; approved requests retire the asset with a permanent lifecycle record." /><div className="stat-strip"><MiniStat label="Awaiting approval" value={requests.filter((request) => request.status === 'PENDING_APPROVAL').length.toString()} tone="amber" /><MiniStat label="Approved" value={requests.filter((request) => request.status === 'APPROVED').length.toString()} tone="teal" /><MiniStat label="Rejected" value={requests.filter((request) => request.status === 'REJECTED').length.toString()} tone="red" /></div>{canRequest && <section className="panel module-form-panel"><PanelHeader title="Request an asset write-off" subtitle="Admin approval is required before an asset is retired." /><form className="writeoff-form" onSubmit={submit}><label>Asset<select required value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Select an asset</option>{assets.filter((asset) => asset.status !== 'RETIRED').map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_tag} · {asset.manufacturer} {asset.model}</option>)}</select></label><label>Reason<textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain damage, end of life, loss, or other disposal reason" /></label><button className="button button-primary" disabled={busy || !assetId}>{busy ? 'Submitting...' : 'Submit for approval'}</button></form></section>}{error && <div className="auth-message module-error">{error}</div>}<section className="panel table-panel full-panel module-panel-gap"><PanelHeader title={canRequest ? 'Write-off approvals' : 'My write-off requests'} subtitle={canRequest ? 'All workspace requests; only admins can approve or reject' : 'Request status and reviewer notes'} /><div className="request-list">{requests.map((request) => <div className="request-row employee-request-row" key={request.id}><div className="request-icon"><Archive size={17} /></div><div className="request-main"><strong>{request.asset_tag} · {request.manufacturer} {request.model}</strong><span>{request.requester_name} · {formatDate(request.created_at)}</span><small>{request.reason}{request.review_note ? ` · Review: ${request.review_note}` : ''}</small></div><StatusBadge status={request.status} />{user.role === 'admin' && request.status === 'PENDING_APPROVAL' && <div className="request-review-actions"><button className="icon-button approve-action" aria-label={`Approve write-off for ${request.asset_tag}`} onClick={() => void review(request, 'APPROVED')}><Check size={17} /></button><button className="icon-button reject-action" aria-label={`Reject write-off for ${request.asset_tag}`} onClick={() => void review(request, 'REJECTED')}><XCircle size={17} /></button></div>}</div>)}</div>{requests.length === 0 && <EmptyState text="No write-off requests yet." />}</section></div>;
}

function NotificationsView({ notifications, onRead }: { notifications: WorkspaceNotification[]; onRead: (id: string) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const markRead = async (id: string) => {
    setError(null);
    try {
      await onRead(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark this notification as read.');
    }
  };
  return <div className="fade-in"><PageTitle eyebrow="Workspace / Activity" title="Notifications" copy="Requests and workflow updates relevant to your account." />{error && <div className="auth-message module-error">{error}</div>}<section className="panel table-panel full-panel"><PanelHeader title="Recent notifications" subtitle={`${notifications.filter((notification) => !notification.read_at).length} unread`} /><div className="notification-list">{notifications.map((notification) => <article className={`notification-row ${notification.read_at ? '' : 'unread'}`} key={notification.id}><div className="notification-icon"><Bell size={16} /></div><div className="notification-copy"><strong>{notification.title}</strong><span>{notification.body}</span><small>{formatDateTime(notification.created_at)}</small></div>{!notification.read_at && <button className="button button-secondary mark-read-button" onClick={() => void markRead(notification.id)}>Mark read</button>}</article>)}</div>{notifications.length === 0 && <EmptyState text="You have no notifications yet." />}</section></div>;
}

type SettingsSection = 'Company' | 'Branding' | 'Approvals' | 'Notifications' | 'AP Escalation' | 'SLA' | 'Email Settings' | 'ManageEngine';
type StringSetting = { [K in keyof WorkspaceSettings]: WorkspaceSettings[K] extends string ? K : never }[keyof WorkspaceSettings];
type NumberSetting = { [K in keyof WorkspaceSettings]: WorkspaceSettings[K] extends number ? K : never }[keyof WorkspaceSettings];
type BooleanSetting = { [K in keyof WorkspaceSettings]: WorkspaceSettings[K] extends boolean ? K : never }[keyof WorkspaceSettings];

const settingsSections: { label: SettingsSection; icon: typeof LayoutDashboard }[] = [
  { label: 'Company', icon: Building2 },
  { label: 'Branding', icon: Palette },
  { label: 'Approvals', icon: ClipboardCheck },
  { label: 'Notifications', icon: Bell },
  { label: 'AP Escalation', icon: CircleAlert },
  { label: 'SLA', icon: ShieldCheck },
  { label: 'Email Settings', icon: Mail },
  { label: 'ManageEngine', icon: RefreshCw },
];

type ManageEngineStatus = {
  configured: boolean;
  apiBaseUrl: string;
  oauthUrl: string;
  requiredScopes: string[];
  assetWarrantyWriteBackAvailable: boolean;
};

type GmailStatus = {
  configured: boolean;
  senderEmail: string;
  missing: string[];
  requiredScopes: string[];
};

function SettingsView({ user, onSaved }: { user: AppUser; onSaved: (user: AppUser) => void }) {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [section, setSection] = useState<SettingsSection>('Company');
  const [fullName, setFullName] = useState(user.full_name);
  const [department, setDepartment] = useState(user.department);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [manageEngineStatus, setManageEngineStatus] = useState<ManageEngineStatus | null>(null);
  const [manageEngineTesting, setManageEngineTesting] = useState(false);
  const [manageEngineMessage, setManageEngineMessage] = useState<string | null>(null);
  const [manageEngineError, setManageEngineError] = useState<string | null>(null);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailTesting, setGmailTesting] = useState(false);
  const [gmailMessage, setGmailMessage] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const isAdmin = user.role === 'admin';

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    setError(null);
    try {
      setSettings(await api.get<WorkspaceSettings>('/api/settings'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load workspace settings.');
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (section !== 'ManageEngine') return;
    setManageEngineError(null);
    api.get<ManageEngineStatus>('/api/integrations/manageengine')
      .then(setManageEngineStatus)
      .catch((err: unknown) => setManageEngineError(err instanceof ApiError ? err.message : 'Could not load ManageEngine integration status.'));
  }, [section]);

  useEffect(() => {
    if (section !== 'Email Settings') return;
    setGmailError(null);
    api.get<GmailStatus>('/api/integrations/gmail')
      .then(setGmailStatus)
      .catch((err: unknown) => setGmailError(err instanceof ApiError ? err.message : 'Could not load Gmail integration status.'));
  }, [section]);

  const testManageEngineConnection = async () => {
    setManageEngineTesting(true);
    setManageEngineError(null);
    setManageEngineMessage(null);
    try {
      const result = await api.post<{ connected: boolean; checked: string[] }>('/api/integrations/manageengine/test-connection', {});
      setManageEngineMessage(`Connected. Verified ${result.checked.join(' and ')} access.`);
    } catch (err) {
      setManageEngineError(err instanceof ApiError ? err.message : 'Could not connect to ManageEngine.');
    } finally {
      setManageEngineTesting(false);
    }
  };

  const testGmailConnection = async () => {
    setGmailTesting(true);
    setGmailError(null);
    setGmailMessage(null);
    try {
      const result = await api.post<{ sent: boolean; recipient: string }>('/api/integrations/gmail/test', {});
      setGmailMessage(`Test email sent to ${result.recipient}.`);
    } catch (err) {
      setGmailError(err instanceof ApiError ? err.message : 'Could not send a Gmail test email.');
    } finally {
      setGmailTesting(false);
    }
  };

  const updateSetting = <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
    setSettings((current) => current ? { ...current, [key]: value } : current);
    setMessage(null);
    setError(null);
  };

  const submitSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings || !isAdmin) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await api.put<WorkspaceSettings>('/api/settings', { settings });
      setSettings(updated);
      setMessage('Workspace settings saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save workspace settings.');
    } finally {
      setSaving(false);
    }
  };

  const submitProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const updated = await api.put<AppUser>(`/api/profiles/${encodeURIComponent(user.id)}`, { full_name: fullName, department });
      onSaved(updated);
      setProfileMessage('Profile settings saved.');
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Could not save profile settings.');
    } finally {
      setSavingProfile(false);
    }
  };

  if (loadingSettings) return <LoadingState />;
  if (!settings) return <div className="state-card error-state"><CircleAlert size={25} /><strong>Settings unavailable</strong><span>{error || 'We could not retrieve workspace settings.'}</span><button className="button button-primary" onClick={() => void loadSettings()}><RefreshCw size={16} /> Try again</button></div>;

  const textInput = (label: string, key: StringSetting, type = 'text', required = false) => (
    <label key={key}>{label}<input type={type} required={required} disabled={!isAdmin} value={settings[key]} onChange={(event) => updateSetting(key, event.target.value)} /></label>
  );
  const numberInput = (label: string, key: NumberSetting, min = 0, max?: number) => (
    <label key={key}>{label}<input type="number" min={min} max={max} step="1" required disabled={!isAdmin} value={settings[key]} onChange={(event) => updateSetting(key, Number(event.target.value))} /></label>
  );
  const checkbox = (label: string, key: BooleanSetting, description?: string) => (
    <label className="settings-toggle" key={key}><input type="checkbox" disabled={!isAdmin} checked={settings[key]} onChange={(event) => updateSetting(key, event.target.checked)} /><span className="settings-toggle-copy"><strong>{label}</strong>{description && <small>{description}</small>}</span></label>
  );
  const colorInput = (label: string, key: 'primaryColor' | 'accentColor') => (
    <label className="settings-color-field" key={key}>{label}<span><input type="color" disabled={!isAdmin} value={settings[key]} onChange={(event) => updateSetting(key, event.target.value)} /><code>{settings[key]}</code></span></label>
  );

  let sectionContent: JSX.Element;
  switch (section) {
    case 'Company':
      sectionContent = <><div className="settings-fields">{textInput('Name', 'companyName', 'text', true)}{textInput('Email', 'companyEmail', 'email')}{textInput('Phone', 'companyPhone', 'tel')}{textInput('Address', 'companyAddress')}<label>Currency<select disabled={!isAdmin} value={settings.currency} onChange={(event) => updateSetting('currency', event.target.value)}><option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — British Pound</option><option value="SGD">SGD — Singapore Dollar</option><option value="AED">AED — UAE Dirham</option></select></label>{textInput('Timezone', 'timezone', 'text', true)}</div></>;
      break;
    case 'Branding':
      sectionContent = <><div className="settings-fields">{textInput('Logo URL', 'logoUrl', 'url')}{colorInput('Primary color', 'primaryColor')}{colorInput('Accent color', 'accentColor')}</div><p className="settings-help">Use a publicly accessible image URL for your company logo. Colors are saved for workspace branding.</p>{settings.logoUrl && <div className="settings-brand-preview"><img src={settings.logoUrl} alt="Company logo preview" /><span>Logo preview</span></div>}</>;
      break;
    case 'Approvals':
      sectionContent = <div className="settings-fields">{numberInput('Approval levels', 'approvalLevels', 1, 5)}<label>Default approver role<select disabled={!isAdmin} value={settings.defaultApproverRole} onChange={(event) => updateSetting('defaultApproverRole', event.target.value)}><option value="approver">Approver</option><option value="admin">Administrator</option><option value="finance_officer">Finance officer</option></select></label>{numberInput('Auto-approve requests up to', 'autoApproveLimit')}<p className="settings-help">Set the approval chain depth and default workspace role used for routed requests.</p></div>;
      break;
    case 'Notifications':
      sectionContent = <div className="settings-option-list">{checkbox('Email notifications', 'notificationsEmail', 'Send supported workflow updates through the Gmail integration in Email Settings.')}{checkbox('In-app notifications', 'notificationsInApp', 'Show notification updates in the workspace.')}{checkbox('Invoice updates', 'notifyInvoices')}{checkbox('Approval activity', 'notifyApprovals')}{checkbox('SLA breach alerts', 'notifySlaBreaches')}</div>;
      break;
    case 'AP Escalation':
      sectionContent = <div className="settings-fields">{checkbox('Enable AP escalation', 'apEscalationEnabled', 'Escalate invoices that remain pending review.')}{numberInput('Escalate after (hours)', 'apEscalationAfterHours', 1)}{numberInput('Repeat escalation every (hours)', 'apEscalationRepeatHours', 1)}{textInput('Escalation contact email', 'apEscalationEmail', 'email')}</div>;
      break;
    case 'SLA':
      sectionContent = <div className="settings-sla-table"><div className="settings-sla-heading"><span>Priority</span><span>Response target (hours)</span><span>Resolution target (hours)</span></div>{(['Low', 'Medium', 'High', 'Urgent'] as const).map((priority) => {
        return <div className="settings-sla-row" key={priority}><strong>{priority}</strong>{numberInput(`${priority} response target`, `sla${priority}ResponseHours` as NumberSetting, 1)}{numberInput(`${priority} resolution target`, `sla${priority}ResolutionHours` as NumberSetting, 1)}</div>;
      })}</div>;
      break;
    case 'Email Settings':
      sectionContent = <div className="settings-integration">
        <div className="settings-integration-heading"><div><h3>Google Account sign-in</h3><p>Allow users to sign in to this workspace with their Google Account.</p></div><span className={`integration-status ${settings.googleClientId ? 'connected' : 'pending'}`}>{settings.googleClientId ? 'Configured' : 'Not configured'}</span></div>
        <div className="settings-fields">{textInput('Google OAuth Web Client ID', 'googleClientId')}</div>
        <p className="settings-help">Create a Web application OAuth client in Google Cloud Console, add this app's origin to its authorized JavaScript origins, then paste the client ID here and save. The client ID is public; account verification remains on the API server. Users can then choose Login with Google on the sign-in page.</p>
        <div className="settings-integration-heading"><div><h3>Gmail integration</h3><p>Send workspace notification emails through the configured Gmail account.</p></div><span className={`integration-status ${gmailStatus?.configured ? 'connected' : 'pending'}`}>{gmailStatus?.configured ? 'Credentials configured' : 'Not configured'}</span></div>
        <div className="settings-fields"><label>Gmail sender account<input value={gmailStatus?.senderEmail || (gmailStatus ? 'Not configured' : 'Loading...')} readOnly /></label></div>
        <div className="integration-scopes"><strong>Required Google OAuth scope</strong><ul>{(gmailStatus?.requiredScopes ?? ['https://www.googleapis.com/auth/gmail.send']).map((scope) => <li key={scope}><code>{scope}</code></li>)}</ul></div>
        <p className="settings-help">Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_SENDER_EMAIL in the API server's .env file, then restart the server. Grant the Gmail send scope when creating the refresh token. Credentials stay on the server. Enable Email notifications under Notifications to send workflow updates to the user's registered work email.</p>
        {gmailStatus && !gmailStatus.configured && <p className="settings-help">Missing configuration: {gmailStatus.missing.join(', ')}</p>}
        {gmailError && <div className="auth-message" role="alert">{gmailError}</div>}
        {gmailMessage && <div className="settings-success" role="status">{gmailMessage}</div>}
        <div className="settings-integration-actions"><button type="button" className="button button-secondary" onClick={() => void testGmailConnection()} disabled={!isAdmin || !gmailStatus?.configured || gmailTesting}>{gmailTesting ? <Loader2 size={16} className="spin" /> : <Send size={16} />}{gmailTesting ? 'Sending test email...' : 'Send test email'}</button><a className="text-button" href="https://developers.google.com/workspace/gmail/api/auth/scopes" target="_blank" rel="noreferrer">Gmail API scope documentation <ArrowUpRight size={14} /></a></div>
      </div>;
      break;
    case 'ManageEngine':
      sectionContent = <div className="settings-integration">
        <div className="settings-integration-heading"><div><h3>ManageEngine Endpoint Central</h3><p>Connect your Endpoint Central Cloud tenant to prepare inventory, warranty, and user synchronization.</p></div><span className={`integration-status ${manageEngineStatus?.configured ? 'connected' : 'pending'}`}>{manageEngineStatus?.configured ? 'Credentials configured' : 'Not configured'}</span></div>
        <div className="settings-fields">
          <label>Endpoint Central API URL<input value={manageEngineStatus?.apiBaseUrl ?? 'Loading...'} readOnly /></label>
          <label>Zoho OAuth URL<input value={manageEngineStatus?.oauthUrl ?? 'Loading...'} readOnly /></label>
        </div>
        <div className="integration-scopes"><strong>Required OAuth scopes</strong><ul>{(manageEngineStatus?.requiredScopes ?? []).map((scope) => <li key={scope}><code>{scope}</code></li>)}</ul></div>
        <p className="settings-help">Configure the OAuth client ID, client secret, and refresh token in the API server's .env file, then restart the server. Credentials are never sent to the browser. Endpoint Central exposes computer inventory, warranty, and assigned-user data for reading; asset and warranty write-back will remain disabled until its supported write API is provided.</p>
        {manageEngineError && <div className="auth-message" role="alert">{manageEngineError}</div>}
        {manageEngineMessage && <div className="settings-success" role="status">{manageEngineMessage}</div>}
        <div className="settings-integration-actions"><button type="button" className="button button-secondary" onClick={() => void testManageEngineConnection()} disabled={!isAdmin || !manageEngineStatus?.configured || manageEngineTesting}>{manageEngineTesting ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}{manageEngineTesting ? 'Testing...' : 'Test connection'}</button><a className="text-button" href="https://www.manageengine.com/products/desktop-central/help/api/cloud/api-index.html" target="_blank" rel="noreferrer">Endpoint Central API documentation <ArrowUpRight size={14} /></a></div>
      </div>;
      break;
  }

  return <div className="fade-in"><PageTitle eyebrow="Workspace / Preferences" title="Settings" copy="Company, notifications, and SLA" />
    <div className="settings-tabs" role="tablist" aria-label="Workspace setting categories">{settingsSections.filter(({ label }) => !['ManageEngine', 'Email Settings'].includes(label) || isAdmin).map(({ label, icon: Icon }) => <button type="button" role="tab" aria-selected={section === label} className={`settings-tab ${section === label ? 'active' : ''}`} key={label} onClick={() => { setSection(label); setMessage(null); setError(null); }}><Icon size={16} />{label}</button>)}</div>
    <form className="panel settings-workspace-form" onSubmit={submitSettings}><section role="tabpanel" aria-label={`${section} settings`} className="settings-section">{sectionContent}</section>
      {!isAdmin && <p className="settings-help">Only a workspace administrator can change company settings.</p>}
      {error && <div className="auth-message">{error}</div>}{message && <div className="settings-success" role="status">{message}</div>}
      {isAdmin && section !== 'ManageEngine' && <div className="settings-save-row"><button className="button button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</button></div>}
    </form>
    <div className="settings-profile-grid"><section className="panel settings-panel"><PanelHeader title="My profile" subtitle="These details appear in asset and workflow records." /><form className="settings-form" onSubmit={submitProfile}><label>Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label><label>Department<input required value={department} onChange={(event) => setDepartment(event.target.value)} /></label><label>Work email<input value={user.email} disabled /></label>{profileError && <div className="auth-message">{profileError}</div>}{profileMessage && <div className="settings-success" role="status">{profileMessage}</div>}<button className="button button-primary" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save profile'}</button></form></section>
      <section className="panel settings-panel"><PanelHeader title="Account access" subtitle="Workspace role and sign-in details" /><div className="settings-account"><div><span>Access role</span><strong>{roleLabel(user.role)}</strong></div><div><span>Department</span><strong>{user.department}</strong></div><div><span>Account status</span><strong>{user.active ? 'Active' : 'Inactive'}</strong></div><p>Role changes are managed by a workspace administrator.</p></div></section></div>
  </div>;
}

function UserManagementView({ currentUser }: { currentUser: AppUser }) {
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

  const changeUser = async (user: ManagedUser, changes: { role?: string; active?: boolean }) => {
    setBusyUser(user.id);
    setError(null);
    try {
      const updated = await api.patch<ManagedUser>(`/api/users/${encodeURIComponent(user.id)}`, changes);
      setUsers((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this user.');
    } finally {
      setBusyUser(null);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
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

  const visibleUsers = users.filter((managedUser) => {
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [managedUser.full_name, managedUser.email, managedUser.department]
      .some((value) => value.toLowerCase().includes(term));
    const matchesRole = roleFilter === 'ALL' || managedUser.role === roleFilter;
    const matchesStatus = accountFilter === 'ALL' || (accountFilter === 'ACTIVE' ? managedUser.active : !managedUser.active);
    return matchesSearch && matchesRole && matchesStatus;
  });
  const activeUsers = users.filter((managedUser) => managedUser.active).length;
  const inactiveUsers = users.length - activeUsers;
  const adminUsers = users.filter((managedUser) => managedUser.role === 'admin').length;

  return <div className="fade-in">
    <PageTitle eyebrow="Workspace / Administration" title="User Management" copy="Manage workspace accounts, role assignments, and access." action="Add User" icon={UserPlus} onAction={() => { setFormError(null); setModalOpen(true); }} />
    <div className="stat-strip user-management-stats">
      <MiniStat label="Total accounts" value={users.length.toString()} tone="blue" />
      <MiniStat label="Active" value={activeUsers.toString()} tone="teal" />
      <MiniStat label="Inactive" value={inactiveUsers.toString()} tone="red" />
      <MiniStat label="Administrators" value={adminUsers.toString()} tone="amber" />
    </div>
    <section className="panel user-management-panel">
      <PanelHeader title="Workspace users" subtitle={`${visibleUsers.length} of ${users.length} accounts · Role changes take effect immediately`} />
      {error && <div className="auth-message module-error user-management-error">{error}<button type="button" className="text-button" onClick={() => void loadUsers()}>Retry</button></div>}
      {!loadingUsers && <div className="user-management-toolbar">
        <label className="invoice-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, or department" aria-label="Search workspace users" /></label>
        <label className="invoice-filter-label">Role<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="Filter users by role"><option value="ALL">All roles</option>{workspaceRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>
        <label className="invoice-filter-label">Account<select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value as typeof accountFilter)} aria-label="Filter users by account status"><option value="ALL">All accounts</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
      </div>}
      {loadingUsers ? <div className="history-state"><Loader2 size={17} className="spin" /> Loading users</div> : <div className="data-table-wrap"><table className="data-table user-table">
        <thead><tr><th>User</th><th>Current role</th><th>Change role</th><th>Joined</th><th>Account</th><th>Actions</th></tr></thead>
        <tbody>{visibleUsers.map((managedUser) => <tr key={managedUser.id}>
          <td><div className="user-cell"><div className="avatar avatar-small">{initials(managedUser.full_name)}</div><div><strong>{managedUser.full_name}{managedUser.id === currentUser.id && <small className="user-you-label">You</small>}</strong><span>{managedUser.email}</span></div></div></td>
          <td><span className={`role-badge role-${managedUser.role}`}>{roleLabel(managedUser.role)}</span></td>
          <td><select aria-label={`Change role for ${managedUser.full_name}`} value={managedUser.role} disabled={busyUser === managedUser.id || managedUser.id === currentUser.id} onChange={(event) => void changeUser(managedUser, { role: event.target.value })}>{workspaceRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></td>
          <td>{formatDate(managedUser.created_at)}</td>
          <td><span className={`user-status ${managedUser.active ? 'active' : 'inactive'}`}>{managedUser.active ? 'Active' : 'Inactive'}</span></td>
          <td><button type="button" className={`user-access-button ${managedUser.active ? 'deactivate' : 'reactivate'}`} disabled={busyUser === managedUser.id || managedUser.id === currentUser.id} onClick={() => void changeUser(managedUser, { active: !managedUser.active })} title={managedUser.active ? 'Deactivate account' : 'Reactivate account'} aria-label={`${managedUser.active ? 'Deactivate' : 'Reactivate'} ${managedUser.full_name}`}>{managedUser.active ? <UserMinus size={16} /> : <UserPlus size={16} />}{managedUser.active ? 'Deactivate' : 'Reactivate'}</button></td>
        </tr>)}</tbody>
      </table>{users.length === 0 && !error ? <EmptyState text="No workspace users found. Add a user to grant workspace access." /> : visibleUsers.length === 0 && !error ? <EmptyState text="No users match these search and filter settings." /> : null}</div>}
    </section>
    <section className="panel user-permissions-panel"><PanelHeader title="Role permissions" subtitle="Access is enforced by the server for every request." /><div className="user-permissions-grid">
      <p><strong>Admin</strong><span>Full workspace access, including user management and account roles.</span></p>
      <p><strong>IT asset manager</strong><span>Manage assets and lifecycle, employee requests, write-offs, and receipts.</span></p>
      <p><strong>Finance officer</strong><span>Manage invoices and view finance-approved documents.</span></p>
      <p><strong>Approver</strong><span>Review routed workflow approvals.</span></p>
      <p><strong>Employee</strong><span>Submit equipment requests.</span></p>
      <p><strong>Auditor</strong><span>Read-only access to the audit log and permitted documents.</span></p>
    </div></section>
    {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}><form className="modal-card user-create-card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Workspace access</p><h2>Add new user</h2></div><button type="button" className="icon-button" onClick={closeModal} aria-label="Close" disabled={saving}><X size={18} /></button></div><div className="form-grid"><label>Full name<input required autoComplete="name" value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></label><label>Email<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Temporary password<input required type="password" minLength={6} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><small>At least 6 characters. Share it with the user securely.</small></label><label>Department<input required value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} /></label><label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{workspaceRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label></div>{formError && <div className="auth-message">{formError}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" disabled={saving} onClick={closeModal}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spin" /> : <UserPlus size={16} />}{saving ? 'Creating...' : 'Create user'}</button></div></form></div>}
  </div>;
}

function AssistantView({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const ask = async (value: string) => {
    const submitted = value.trim();
    if (!submitted || busy) return;
    setMessages((current) => [...current, { role: 'user', content: submitted }]);
    setQuestion('');
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ answer: string }>('/api/assistant/chat', { question: submitted });
      setMessages((current) => [...current, { role: 'assistant', content: result.answer }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The assistant could not answer. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    api.get<{ configured: boolean; model: string }>('/api/assistant/status')
      .then((status) => setConfigured(status.configured))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not check AI Assistant configuration.'));
  }, []);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);
  const suggestedQuestions = [
    'How many assets are awaiting assignment?',
    'Which warranties expire in the next 90 days?',
    'Summarize the invoice review queue.',
    'What approvals need attention?',
  ];
  const shortcuts: { label: string; tab: Tab; icon: typeof Box }[] = [
    { label: 'Assets', tab: 'Assets', icon: Box },
    { label: 'Invoices', tab: 'Invoices', icon: FileText },
    { label: 'Warranties', tab: 'Warranties', icon: BadgeCheck },
  ];
  return <div className="fade-in">
    <PageTitle eyebrow="Workspace / AI" title="AI Assistant" copy="Ask a workspace question or jump directly to a module." />
    <section className="panel assistant-panel">
      <div className="assistant-command-header"><div className="assistant-command-mark"><Sparkles size={20} /></div><div><h2>How can I help?</h2><span>Ask about workspace operations, or navigate to a module.</span></div><span className={`assistant-status ${configured ? 'ready' : configured === false ? 'not-configured' : 'checking'}`}><i />{configured === null ? 'Checking connection' : configured ? 'AI connected' : 'AI not configured'}</span></div>
      <div className="assistant-shortcuts" aria-label="Quick navigation">{shortcuts.map(({ label, tab, icon: Icon }) => <button key={tab} onClick={() => onNavigate(tab)}><Icon size={15} />{label}<ArrowUpRight size={13} /></button>)}</div>
      <div className="assistant-messages" aria-live="polite">
        {messages.length === 0 ? <div className="assistant-welcome"><div className="assistant-empty"><Bot size={28} /><strong>Ask about your workspace</strong><span>Answers use operational summaries, not private employee or invoice details. AI cannot make changes.</span></div><div className="assistant-suggestions">{suggestedQuestions.map((suggestion) => <button key={suggestion} disabled={busy || !configured} onClick={() => void ask(suggestion)}>{suggestion}<ArrowUpRight size={13} /></button>)}</div></div> : messages.map((message, index) => <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === 'user' ? 'You' : 'Operations assistant'}</span><p>{message.content}</p></div>)}
        {busy && <div className="assistant-thinking"><Loader2 size={15} className="spin" /> Checking workspace summary</div>}
        <div ref={messagesEnd} />
      </div>
      {configured === false && <div className="assistant-config-note"><CircleAlert size={16} /><span>AI chat is unavailable until <code>OPENAI_API_KEY</code> is configured in the API server environment and the server is restarted. A GitHub Actions secret alone does not configure this server.</span></div>}
      {error && <div className="auth-message module-error">{error}</div>}
      <form className="assistant-form" onSubmit={(event) => { event.preventDefault(); void ask(question); }}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} placeholder={configured === false ? 'Configure the server API key to ask a question...' : 'Ask, navigate, or implement…'} aria-label="Question for AI assistant" disabled={configured === false || busy} /><button className="button button-primary" disabled={busy || !question.trim() || configured !== true} aria-label="Send question">{busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}{busy ? 'Thinking...' : 'Ask AI'}</button></form>
      <div className="assistant-disclaimer">AI responses may be inaccurate. Verify important decisions against source records. The assistant can answer summary questions and provide navigation; it cannot edit data.</div>
    </section>
  </div>;
}

function AssetTable({ assets, compact = false, onManage, onOpenWarranties }: { assets: Asset[]; compact?: boolean; onManage?: (asset: Asset) => void; onOpenWarranties?: () => void }) {
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Asset</th><th>Category</th><th>Custodian</th><th>Location</th><th>Status</th>{!compact && <th>Warranty</th>}<th></th></tr></thead><tbody>{assets.map((asset) => <tr key={asset.id}><td><div className="asset-cell"><div className={`asset-type-icon ${asset.category.toLowerCase().replace(' ', '-')}`}><Laptop size={16} /></div><div>{onManage ? <button type="button" className="record-link" onClick={() => onManage(asset)}>{asset.asset_tag}</button> : <strong>{asset.asset_tag}</strong>}<span>{asset.manufacturer} {asset.model}</span></div></div></td><td>{asset.category}</td><td><div className="person-cell"><div className="avatar avatar-small">{initials(asset.custodian)}</div><span>{asset.custodian}</span></div></td><td>{asset.location}</td><td><StatusBadge status={asset.status} /></td>{!compact && <td>{onOpenWarranties ? <button className="warranty-date-link" onClick={onOpenWarranties}>{asset.warranty_end ? formatDate(asset.warranty_end) : 'Not recorded'}</button> : asset.warranty_end ? formatDate(asset.warranty_end) : '—'}</td>}<td>{onManage ? <button className="row-action" onClick={() => onManage(asset)}><Activity size={14} /> History</button> : <button className="row-more" aria-label={`More options for ${asset.asset_tag}`}>•••</button>}</td></tr>)}</tbody></table>{assets.length === 0 && <EmptyState text="No assets match this search." />}</div>;
}

const assetActionLabels: Record<AssetEventType, string> = {
  ASSIGNED: 'Assign',
  RETURNED: 'Return to inventory',
  TRANSFERRED: 'Transfer',
  MAINTENANCE_STARTED: 'Start maintenance',
  MAINTENANCE_COMPLETED: 'Complete maintenance',
  QUARANTINED: 'Quarantine',
  RETIRED: 'Retire',
  AUDITED: 'Record audit',
};

function AssetLifecycleDialog({ asset, canManage, onClose, onSaved }: { asset: Asset; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const [currentAsset, setCurrentAsset] = useState(asset);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [action, setAction] = useState<AssetEventType | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ custodian: '', location: '', issue: '', provider: '', priority: 'MEDIUM', condition: asset.condition, notes: '' });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      setEvents(await api.get<AssetEvent[]>(`/api/assets/${encodeURIComponent(asset.id)}/events`));
    } catch (err) {
      setEventsError(err instanceof ApiError ? err.message : 'Could not load this asset’s history.');
    } finally {
      setEventsLoading(false);
    }
  }, [asset.id]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const actions: AssetEventType[] = currentAsset.status === 'AVAILABLE'
    ? ['ASSIGNED', 'MAINTENANCE_STARTED', 'QUARANTINED', 'AUDITED', 'RETIRED']
    : currentAsset.status === 'ASSIGNED'
      ? ['TRANSFERRED', 'RETURNED', 'MAINTENANCE_STARTED', 'QUARANTINED', 'AUDITED', 'RETIRED']
      : currentAsset.status === 'UNDER_MAINTENANCE'
        ? ['MAINTENANCE_COMPLETED', 'QUARANTINED', 'AUDITED', 'RETIRED']
        : currentAsset.status === 'QUARANTINED'
          ? ['AUDITED', 'RETIRED']
          : ['AUDITED'];

  const beginAction = (nextAction: AssetEventType) => {
    setError(null);
    setForm({ custodian: '', location: currentAsset.location, issue: '', provider: '', priority: 'MEDIUM', condition: currentAsset.condition, notes: '' });
    setAction(nextAction);
  };

  const submitAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action) return;
    setBusy(true);
    setError(null);
    const body: Record<string, string> = { event_type: action };
    if (action === 'ASSIGNED' || action === 'RETURNED' || action === 'TRANSFERRED') body.custodian = form.custodian;
    if (action === 'TRANSFERRED' && form.location.trim() !== currentAsset.location) body.location = form.location;
    if (action === 'MAINTENANCE_STARTED') {
      body.issue = form.issue;
      body.provider = form.provider;
      body.priority = form.priority;
    }
    if (action === 'AUDITED') body.condition = form.condition;
    if (['QUARANTINED', 'RETIRED', 'AUDITED', 'MAINTENANCE_COMPLETED'].includes(action)) body.notes = form.notes;
    try {
      const updated = await api.post<Asset>(`/api/assets/${encodeURIComponent(asset.id)}/events`, body);
      setCurrentAsset(updated);
      setAction(null);
      await loadEvents();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record this asset action. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(<div className="modal-backdrop asset-lifecycle-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card asset-lifecycle-card" role="dialog" aria-modal="true" aria-labelledby="asset-lifecycle-title">
    <div className="modal-header"><div><p className="eyebrow">Asset lifecycle</p><h2 id="asset-lifecycle-title">{currentAsset.asset_tag}</h2><span className="asset-modal-model">{currentAsset.manufacturer} {currentAsset.model}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close asset history"><X size={18} /></button></div>
    <div className="asset-detail-grid"><div><span>Status</span><StatusBadge status={currentAsset.status} /></div><div><span>Custodian</span><strong>{currentAsset.custodian}</strong></div><div><span>Location</span><strong>{currentAsset.location}</strong></div><div><span>Condition</span><strong>{currentAsset.condition.toLowerCase()}</strong></div><div><span>Last audited</span><strong>{currentAsset.last_audited_at ? formatDate(currentAsset.last_audited_at) : 'Not audited'}</strong></div><div><span>Warranty start</span><strong>{currentAsset.warranty_start ? formatDate(currentAsset.warranty_start) : 'Not recorded'}</strong></div><div><span>Warranty end</span><strong>{currentAsset.warranty_end ? formatDate(currentAsset.warranty_end) : 'Not recorded'}</strong></div></div>
    <WarrantyLookupLink manufacturer={currentAsset.manufacturer} serialNumber={currentAsset.serial_number} />
    {canManage && <section className="lifecycle-actions"><div className="lifecycle-section-heading"><div><strong>Available actions</strong><span>Changes are recorded in the asset history.</span></div></div><div className="lifecycle-action-list">{actions.map((item) => <button key={item} className="button button-secondary" onClick={() => beginAction(item)} disabled={busy}>{item === 'MAINTENANCE_STARTED' || item === 'MAINTENANCE_COMPLETED' ? <Wrench size={15} /> : item === 'AUDITED' ? <ClipboardCheck size={15} /> : <Activity size={15} />}{assetActionLabels[item]}</button>)}</div></section>}
    {action && <form className="lifecycle-form" onSubmit={submitAction}><div className="lifecycle-section-heading"><div><strong>{assetActionLabels[action]}</strong><span>Enter the details to record this lifecycle event.</span></div></div>
      {(action === 'ASSIGNED' || action === 'RETURNED' || action === 'TRANSFERRED') && <label>{action === 'RETURNED' ? 'Received by' : action === 'TRANSFERRED' ? 'New custodian' : 'Assign to'}<input required value={form.custodian} onChange={(event) => update('custodian', event.target.value)} placeholder="Full name or team" /></label>}
      {action === 'TRANSFERRED' && <label>New location (optional)<input value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="Building / floor / site" /></label>}
      {action === 'MAINTENANCE_STARTED' && <><label>Issue or work required<input required value={form.issue} onChange={(event) => update('issue', event.target.value)} placeholder="Describe the maintenance issue" /></label><div className="form-grid"><label>Provider<input value={form.provider} onChange={(event) => update('provider', event.target.value)} placeholder="In-house" /></label><label>Priority<select value={form.priority} onChange={(event) => update('priority', event.target.value)}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option></select></label></div></>}
      {action === 'AUDITED' && <label>Condition<select value={form.condition} onChange={(event) => update('condition', event.target.value)}><option>NEW</option><option>GOOD</option><option>DAMAGED</option></select></label>}
      {['QUARANTINED', 'RETIRED', 'AUDITED', 'MAINTENANCE_COMPLETED'].includes(action) && <label>{action === 'AUDITED' ? 'Audit notes' : action === 'MAINTENANCE_COMPLETED' ? 'Completion notes (optional)' : 'Reason'}<textarea required={action !== 'MAINTENANCE_COMPLETED'} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder={action === 'MAINTENANCE_COMPLETED' ? 'Add repair notes if needed' : 'Add a concise reason for the record'} /></label>}
      {error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => { setAction(null); setError(null); }}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Activity size={16} />}{busy ? 'Saving...' : `Record ${assetActionLabels[action].toLowerCase()}`}</button></div>
    </form>}
    <section className="asset-history"><div className="lifecycle-section-heading"><div><strong>Lifecycle history</strong><span>Recorded asset actions, assignments, and audit checks.</span></div></div>{eventsLoading ? <div className="history-state"><Loader2 size={17} className="spin" /> Loading history</div> : eventsError ? <div className="history-error"><span>{eventsError}</span><button className="text-button" onClick={() => void loadEvents()}>Retry</button></div> : events.length === 0 ? <div className="history-state">No lifecycle events recorded.</div> : <ol className="asset-event-list">{events.map((item) => <li key={item.id}><span className="event-marker"><Activity size={13} /></span><div className="event-copy"><strong>{assetEventLabel(item.event_type)}</strong><span>{assetEventDescription(item)}</span>{item.notes && <p>{item.notes}</p>}<small>{item.actor_name} · {formatDateTime(item.created_at)}</small></div></li>)}</ol>}</section>
    <div className="modal-actions lifecycle-close"><button className="button button-secondary" onClick={onClose}>Close</button></div>
  </div></div>, document.body);
}

function assetEventLabel(eventType: string) {
  return assetActionLabels[eventType as AssetEventType] ?? eventType.split('_').map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' ');
}

function assetEventDescription(event: AssetEvent) {
  const changes = [];
  if (event.from_status !== event.to_status && event.to_status) changes.push(`Status: ${event.from_status?.replace(/_/g, ' ').toLowerCase() ?? 'new'} → ${event.to_status.replace(/_/g, ' ').toLowerCase()}`);
  if (event.from_custodian !== event.to_custodian && event.to_custodian) changes.push(`Custodian: ${event.to_custodian}`);
  if (event.location) changes.push(`Location: ${event.location}`);
  return changes.join(' · ') || 'Asset condition and audit record updated.';
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function InvoiceTable({ invoices, compact = false, canManage = false, canDelete = false, onStatusChange, onDelete, onDownload }: { invoices: Invoice[]; compact?: boolean; canManage?: boolean; canDelete?: boolean; onStatusChange?: (invoice: Invoice, status: Invoice['status']) => void; onDelete?: (invoice: Invoice) => void; onDownload?: (invoice: Invoice) => void }) {
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const noItems = invoices.length === 0;
  if (compact) return <div className="data-table-wrap"><table className="data-table invoice-table"><thead><tr><th>Invoice</th><th>Supplier</th><th>PO reference</th><th>Total</th><th>AI confidence</th><th>Status</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><div className="invoice-cell"><div className="document-icon"><FileText size={16} /></div><div><button type="button" className="record-link" onClick={() => setSelectedInvoice(invoice)}>{invoice.invoice_number}</button><span>{formatDate(invoice.invoice_date)}</span></div></div></td><td>{invoice.vendor}</td><td className="muted-cell">{invoice.purchase_order}</td><td><strong>{money.format(invoice.total)}</strong></td><td><div className="confidence"><div className="confidence-track"><span style={{ width: `${invoice.confidence}%` }}></span></div><span>{invoice.confidence}%</span></div></td><td><StatusBadge status={invoice.status} /></td></tr>)}</tbody></table>{noItems && <EmptyState text="No invoices in the queue." />}{selectedInvoice && <InvoiceDetailsDialog invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}</div>;
  return <><div className="data-table-wrap invoice-table-wrap"><table className="data-table invoice-table"><thead><tr><th>Invoice Number</th><th>PO Number</th><th>Supplier</th><th>Invoice Date</th><th>Description</th><th>HSN</th><th>QTY</th><th>Unit Price</th><th>Total Amount</th><th>Bank Details</th><th>File</th><th>Status</th><th>Actions</th></tr></thead><tbody>{invoices.map((invoice) => {
    const items = Array.isArray(invoice.extracted_fields?.line_items) ? invoice.extracted_fields.line_items : [];
    const details = invoice.extracted_fields?.bank_details;
    const description = items.map((item) => item.description).filter(Boolean).join(', ');
    const hsn = [...new Set(items.map((item) => item.hsn).filter(Boolean))].join(', ');
    const quantity = items.reduce((sum, item) => sum + (typeof item.quantity === 'number' ? item.quantity : 0), 0);
    const unitPrices = [...new Set(items.map((item) => item.unit_price).filter((price): price is number => typeof price === 'number'))];
    const bankSummary = details ? [details.name, details.account ? `••••${details.account.slice(-4)}` : null, details.ifsc].filter(Boolean).join(' · ') : '';
    return <tr key={invoice.id}><td><div className="invoice-cell"><div className="document-icon"><FileText size={16} /></div><div><button type="button" className="record-link" onClick={() => setSelectedInvoice(invoice)}>{invoice.invoice_number}</button>{invoice.issue && <span className="invoice-issue">{invoice.issue}</span>}</div></div></td><td className="muted-cell">{invoice.purchase_order || '—'}</td><td>{invoice.vendor}</td><td>{formatDate(invoice.invoice_date)}</td><td className="invoice-truncate" title={description}>{description || '—'}</td><td>{hsn || '—'}</td><td>{items.length ? (quantity || items.length) : '—'}</td><td>{unitPrices.length ? unitPrices.map((price) => formatInvoiceAmount(price, invoice.currency_code)).join(', ') : '—'}</td><td><strong>{formatInvoiceAmount(invoice.total, invoice.currency_code)}</strong></td><td className="invoice-bank-cell" title={bankSummary}>{bankSummary || '—'}</td><td>{invoice.document_id && invoice.file_visible ? <button className="invoice-file-button" onClick={() => onDownload?.(invoice)} title={`Download ${invoice.file_name}`}><Download size={14} />{invoice.file_name || 'Download'}</button> : invoice.document_id ? <span className="muted-cell">Private</span> : '—'}</td><td>{canManage ? <select className="invoice-status-select" aria-label={`Status for ${invoice.invoice_number}`} value={invoice.status} onChange={(event) => onStatusChange?.(invoice, event.target.value as Invoice['status'])}>{invoiceStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select> : <StatusBadge status={invoice.status} />}</td><td>{canDelete ? <button className="invoice-delete-button" onClick={() => onDelete?.(invoice)} aria-label={`Delete invoice ${invoice.invoice_number}`} title="Delete invoice"><XCircle size={16} /></button> : <span className="muted-cell">—</span>}</td></tr>;
  })}</tbody></table>{noItems && <EmptyState text="No invoices match these filters. Upload an invoice or use manual entry to begin." />}{invoices.some((invoice) => invoice.issue) && <div className="table-footnote"><CircleAlert size={14} /> Exception rows require a human review before approval.</div>}{selectedInvoice && <InvoiceDetailsDialog invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}</div></>;
}
function InvoiceDetailsDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const fields = invoice.extracted_fields;
  const items = Array.isArray(fields?.line_items) ? fields.line_items : [];
  const bank = fields?.bank_details;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card record-details-card" role="dialog" aria-modal="true" aria-labelledby="invoice-details-title">
    <div className="modal-header"><div><p className="eyebrow">Invoice record</p><h2 id="invoice-details-title">{invoice.invoice_number}</h2><span className="asset-modal-model">{formatDate(invoice.invoice_date)} · {formatInvoiceAmount(invoice.total, invoice.currency_code)}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close invoice details"><X size={18} /></button></div>
    <div className="asset-detail-grid"><div><span>Status</span><StatusBadge status={invoice.status} /></div><div><span>Purchase order</span><strong>{invoice.purchase_order || 'Not linked'}</strong></div><div><span>Invoice date</span><strong>{formatDate(invoice.invoice_date)}</strong></div><div><span>Supplier</span><strong>{invoice.vendor || 'Not recorded'}</strong></div><div><span>Total amount</span><strong>{formatInvoiceAmount(invoice.total, invoice.currency_code)}</strong></div><div><span>Extraction confidence</span><strong>{invoice.confidence}%</strong></div></div>
    {invoice.issue && <div className="review-warning"><CircleAlert size={16} /><span>{invoice.issue}</span></div>}
    <section className="record-details-section"><h3>Line items</h3>{items.length ? <div className="invoice-line-item-list">{items.map((item, index) => <div key={`${item.hsn || 'item'}-${index}`}><span>{item.description || 'Item description not found'}{item.hsn ? ` · HSN ${item.hsn}` : ''}</span><small>{item.quantity ?? '—'} × {item.unit_price === null ? '—' : formatInvoiceAmount(item.unit_price, invoice.currency_code)}</small></div>)}</div> : <span className="invoice-detail-empty">No line items were recorded.</span>}</section>
    <section className="record-details-section"><h3>Bank details</h3><span>{bank ? [bank.name, bank.account ? `Account ending ${bank.account.slice(-4)}` : null, bank.ifsc, bank.branch].filter(Boolean).join(' · ') || 'No bank details were recorded.' : 'No bank details were recorded.'}</span></section>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button></div>
  </div></div>;
}
function MetricCard({ label, value, note, icon: Icon, tone, trend, down }: { label: string; value: string; note: string; icon: typeof Box; tone: string; trend?: string; down?: boolean }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value-row"><strong>{value}</strong>{trend && <span className={`trend ${down ? 'down' : ''}`}>{down ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{trend}</span>}</div><div className="metric-note">{note}</div></div>; }
function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="mini-stat"><span className={`mini-dot ${tone}`}></span><div><span>{label}</span><strong>{value}</strong></div></div>; }
function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) { return <div className="panel-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <button className="text-button" onClick={onAction}>{action} <ArrowUpRight size={14} /></button>}</div>; }
function PageTitle({ eyebrow, title, copy, action, icon: Icon, onAction }: { eyebrow: string; title: string; copy: string; action?: string; icon?: typeof Plus; onAction?: () => void }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="heading-copy">{copy}</p></div>{action && Icon && <button className="button button-primary" onClick={onAction}><Icon size={17} /> {action}</button>}</div>; }
function StatusBadge({ status }: { status: string }) { const label = status.split('_').join(' '); return <span className={`status-badge ${status.toLowerCase()}`}><span></span>{label.charAt(0) + label.slice(1).toLowerCase()}</span>; }
function LoadingState() { return <div className="state-card"><Loader2 size={23} className="spin" /><strong>Loading your workspace</strong><span>Gathering the latest operational data...</span></div>; }
function ErrorState({ onRetry }: { onRetry: () => void }) { return <div className="state-card error-state"><CircleAlert size={25} /><strong>Workspace unavailable</strong><span>We could not retrieve the latest records.</span><button className="button button-primary" onClick={onRetry}><RefreshCw size={16} /> Try again</button></div>; }
function EmptyState({ text }: { text: string }) { return <div className="empty-state"><Tag size={18} /><span>{text}</span></div>; }
function initials(value: string) { return value.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function formatDate(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed); }

function roleLabel(role: string) { return role.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }
function statusLabel(status: string) { return status.split('_').map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' '); }
function formatInvoiceAmount(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency || 'INR'} ${amount.toLocaleString('en-IN')}`;
  }
}

function AuthLoading() { return <div className="auth-shell"><div className="auth-loading"><Loader2 size={24} className="spin" /><span>Preparing your secure workspace</span></div></div>; }

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
    api.get<{ configured: boolean; clientId: string }>('/api/auth/google-config')
      .then((config) => { if (active) setGoogleClientId(config.clientId || ''); })
      .catch(() => { if (active && !GOOGLE_CLIENT_ID) setGoogleClientId(''); });
    return () => { active = false; };
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const user = mode === 'sign-in'
        ? await auth.signIn(email, password)
        : await auth.signUp(email, password, fullName);
      onAuth(user);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'We could not complete that request. Check your details and try again.');
    } finally {
      setBusy(false);
    }
  };
  const signInWithGoogle = useCallback(async (credential: string) => {
    setBusy(true);
    setMessage('');
    try {
      const user = await auth.signInWithGoogle(credential);
      onAuth(user);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Google sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [onAuth]);
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
  return <div className="auth-shell"><div className="auth-visual"><div className="auth-brand"><img className="brand-logo auth-logo" src="/images/images.jpeg" alt="Bigbasket" /><div><div className="brand-name">bigbasket</div><div className="brand-subtitle">IT OPERATIONS</div></div></div><div className="auth-visual-copy"><span className="eyebrow">Enterprise asset intelligence</span><h1>Make every asset<br /><em>accountable.</em></h1><p>Control assets, inventory, service, and spend from one trusted operational record.</p><div className="auth-signal"><span className="signal-dot"></span><span>Secure workspace controls active</span><ShieldCheck size={15} /></div></div></div><div className="auth-panel"><div className="auth-panel-inner"><div className="auth-mobile-brand"><img className="brand-logo auth-logo" src="/images/images.jpeg" alt="Bigbasket" /><div className="brand-name">bigbasket</div></div><span className="eyebrow">{mode === 'sign-in' ? 'Welcome back' : 'Create your workspace account'}</span><h2>{mode === 'sign-in' ? 'Sign in to operations' : 'Start with your team'}</h2><p className="auth-copy">{mode === 'sign-in' ? 'Access your organization’s asset and workflow records.' : 'Your first account becomes the workspace administrator.'}</p><form onSubmit={submit} className="auth-form">{mode === 'sign-up' && <label>Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" /></label>}<label>Work email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@bigbasket.com" /></label><label>Password<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></label>{message && <div className="auth-message" role="alert">{message}</div>}<button className="button button-primary auth-submit" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}{busy ? 'Working...' : mode === 'sign-in' ? 'Sign in securely' : 'Create account'}</button></form>{mode === 'sign-in' && <><div className="auth-divider"><span>or continue with</span></div>{googleClientId ? <div className="google-signin" ref={googleButtonRef} aria-label="Sign in with Google" /> : <button type="button" className="button button-google" onClick={() => setMessage('Google sign-in is not configured yet. Ask a workspace administrator to configure it under Settings → Email Settings.')}><svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.9 6.1-15z" /><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9L30.9 34c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44z" /><path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3z" /><path fill="#EA4335" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.8 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3c1.6-4.9 6.1-8.5 11.4-8.5z" /></svg>Login with Google</button>}</>}<button className="auth-switch" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage(''); }}>{mode === 'sign-in' ? 'New to Bigbasket? Create an account' : 'Already have an account? Sign in'}</button><div className="auth-footnote"><ShieldCheck size={14} /> Role-aware access, audit history, and private documents</div></div></div></div>;
}

type InvoiceExtraction = {
  [key: string]: unknown;
  invoice_number: string | null;
  vendor: string | null;
  purchase_order: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  confidence: number;
  review_reason: string | null;
  line_items?: { description: string | null; hsn: string | null; quantity: number | null; unit_price: number | null; total: number | null }[];
  bank_details?: { name: string | null; account: string | null; ifsc: string | null; branch: string | null } | null;
  asset_details?: { manufacturer: string | null; model: string | null; serial_number: string | null }[];
};

function InvoiceUploadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [extraction, setExtraction] = useState<InvoiceExtraction | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ invoice_number: '', vendor: '', purchase_order: '', invoice_date: '', total: '' });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setMessage('The invoice document exceeds the 10 MB upload limit.');
      return;
    }
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setMessage('Upload a PDF, PNG, JPG, or WebP invoice document.');
      return;
    }
    setBusy(true);
    setMessage('');
    let documentId: string | null = null;
    try {
      const dataUrl = await readAsDataUrl(file);
      if (!dataUrl.startsWith(`data:${file.type};base64,`)) {
        throw new Error('The selected file could not be read in a supported format.');
      }
      const document = await api.upload<AppDocument>('/api/documents', file, { document_type: 'INVOICE' });
      documentId = document.id;
      const result = await api.post<{ extraction: InvoiceExtraction }>('/api/invoices/process', {
        document_id: documentId,
        fileDataUrl: dataUrl,
        filename: file.name,
      });
      setExtraction(result.extraction);
      setDocumentId(documentId);
      setDraft({
        invoice_number: result.extraction.invoice_number || '',
        vendor: result.extraction.vendor || '',
        purchase_order: result.extraction.purchase_order || '',
        invoice_date: result.extraction.invoice_date || '',
        total: result.extraction.total === null ? '' : String(result.extraction.total),
      });
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'We could not process this document. Check the file and try again.';
      setMessage(errorMessage);
      if (documentId) {
        try {
          await api.put(`/api/documents/${documentId}`, { extraction_status: 'FAILED', review_reason: errorMessage });
        } catch (statusError) {
          const statusMessage = statusError instanceof ApiError
            ? statusError.message
            : 'The uploaded document status could not be updated.';
          setMessage(`${errorMessage} ${statusMessage}`);
        }
      }
    } finally {
      setBusy(false);
    }
  };
  const saveInvoice = async () => {
    if (!extraction || !documentId) return;
    const total = Number(draft.total);
    if (!draft.invoice_number.trim() || !draft.vendor.trim() || !Number.isFinite(total) || total < 0) {
      setMessage('Enter an invoice number, vendor, and valid total before saving.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.post('/api/invoices', {
        invoice_number: draft.invoice_number.trim(),
        vendor: draft.vendor.trim(),
        purchase_order: draft.purchase_order.trim(),
        invoice_date: draft.invoice_date || new Date().toISOString().slice(0, 10),
        total,
        currency_code: extraction.currency || 'INR',
        confidence: extraction.confidence,
        issue: extraction.review_reason,
        status: extraction.confidence < 85 || extraction.review_reason ? 'UNDER_REVIEW' : 'PENDING',
        extracted_fields: extraction,
        document_id: documentId,
      });
      onSaved();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not add this invoice to the register.');
    } finally {
      setBusy(false);
    }
  };
  const lineItems = extraction?.line_items ?? [];
  const bankDetails = extraction?.bank_details;
  const assetDetails = extraction?.asset_details ?? [];
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="modal-card invoice-upload-card" role="dialog" aria-modal="true" aria-labelledby="invoice-upload-title">
    <div className="modal-header"><div><p className="eyebrow">Local document scanning</p><h2 id="invoice-upload-title">Upload Invoice</h2><span className="invoice-modal-subtitle">{extraction ? 'Review the scanned invoice details before adding them to the register.' : 'The scanner will extract invoice details for your review.'}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={busy}><X size={18} /></button></div>
    {extraction ? <div className="extraction-result">
      <div className="ai-result-banner"><Sparkles size={18} /><div><strong>Review extracted details</strong><span>{extraction.confidence}% confidence · Check the fields before adding the invoice</span></div></div>
      <div className="form-grid invoice-review-fields"><label>Invoice number<input required value={draft.invoice_number} onChange={(event) => setDraft({ ...draft, invoice_number: event.target.value })} /></label><label>Supplier name<input required value={draft.vendor} onChange={(event) => setDraft({ ...draft, vendor: event.target.value })} /></label><label>PO number<input value={draft.purchase_order} onChange={(event) => setDraft({ ...draft, purchase_order: event.target.value })} /></label><label>Invoice date<input type="date" value={draft.invoice_date} onChange={(event) => setDraft({ ...draft, invoice_date: event.target.value })} /></label><label>Total amount<input required type="number" min="0" step="0.01" value={draft.total} onChange={(event) => setDraft({ ...draft, total: event.target.value })} /></label><label>Currency<input value={extraction.currency || 'INR'} readOnly /></label></div>
      {extraction.review_reason && <div className="review-warning"><CircleAlert size={16} /><span>{extraction.review_reason}</span></div>}
      <div className="invoice-extraction-details">
        <strong>Line items</strong>{lineItems.length ? <div className="invoice-line-item-list">{lineItems.map((item, index) => <div key={`${item.hsn || 'item'}-${index}`}><span>{item.description || 'Item description not found'}{item.hsn ? ` · HSN ${item.hsn}` : ''}</span><small>{item.quantity ?? '—'} × {item.unit_price === null ? '—' : money.format(item.unit_price)}</small></div>)}</div> : <span className="invoice-detail-empty">No line items were found.</span>}
        <strong>Bank details</strong>{bankDetails && Object.values(bankDetails).some(Boolean) ? <span>{[bankDetails.name, bankDetails.account ? `Account ending ${bankDetails.account.slice(-4)}` : null, bankDetails.ifsc, bankDetails.branch].filter(Boolean).join(' · ')}</span> : <span className="invoice-detail-empty">No bank details found.</span>}
        <strong>Asset details</strong>{assetDetails.length ? <span>{assetDetails.map((asset) => [asset.manufacturer, asset.model, asset.serial_number].filter(Boolean).join(' · ') || 'Asset details incomplete').join('; ')}</span> : <span className="invoice-detail-empty">No asset serial details found.</span>}
      </div>
      {message && <div className="auth-message">{message}</div>}
      <div className="ai-trust-note"><ShieldCheck size={15} /><span>Invoice files are scanned locally and stay access-controlled in this workspace.</span></div>
      <div className="modal-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button button-primary" disabled={busy} onClick={() => void saveInvoice()}>{busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{busy ? 'Saving...' : 'Add to invoice register'}</button></div>
    </div> : <form onSubmit={submit}>
      <div className="invoice-extract-summary"><strong>Local scanning will automatically extract:</strong><ul><li>Invoice number, PO number, date, currency, and total</li><li>Supplier, line items, HSN, quantity, and unit price</li><li>Bank details (name, account, IFSC, branch)</li><li>Asset details including make, model, and serial number</li></ul></div>
      <label className="invoice-pdf-label">Select invoice file<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setMessage(''); }} /></label>
      <span className="invoice-file-hint">{file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : 'PDF, PNG, JPG, or WebP · maximum 10 MB'}</span>
      {message && <div className="auth-message">{message}</div>}
      <div className="ai-trust-note"><ShieldCheck size={15} /><span>Invoice files are scanned locally. Uploaded documents remain private to authorized workspace roles.</span></div>
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" disabled={!file || busy}>{busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {busy ? 'Scanning...' : 'Upload & Scan'}</button></div>
    </form>}
  </div></div>;
}

function ManualInvoiceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ invoice_number: '', purchase_order: '', vendor: '', invoice_date: new Date().toISOString().slice(0, 10), total: '', currency_code: 'INR' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/invoices', { ...form, total: Number(form.total), confidence: 0, status: 'PENDING' });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invoice.');
    } finally {
      setBusy(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="modal-card manual-invoice-card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Finance / Payables</p><h2>Manual invoice entry</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={busy}><X size={18} /></button></div><div className="form-grid"><label>Invoice number<input required value={form.invoice_number} onChange={(event) => setForm({ ...form, invoice_number: event.target.value })} /></label><label>PO number<input value={form.purchase_order} onChange={(event) => setForm({ ...form, purchase_order: event.target.value })} /></label><label>Supplier name<input required value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} /></label><label>Invoice date<input required type="date" value={form.invoice_date} onChange={(event) => setForm({ ...form, invoice_date: event.target.value })} /></label><label>Total amount<input required type="number" min="0" step="0.01" value={form.total} onChange={(event) => setForm({ ...form, total: event.target.value })} /></label><label>Currency<input required maxLength={3} value={form.currency_code} onChange={(event) => setForm({ ...form, currency_code: event.target.value.toUpperCase() })} /></label></div>{error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{busy ? 'Saving...' : 'Add invoice'}</button></div></form></div>;
}

function readAsDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read the selected file. Try opening it and saving a new PDF or image copy.')); reader.readAsDataURL(file); }); }

function AssetModal({ userName, department, onClose, onSaved }: { userName: string; department: string; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ asset_tag: '', category: 'Laptop', manufacturer: '', model: '', serial_number: '', custodian: userName, location: '', department, purchase_cost: '', warranty_start: '', warranty_end: '' });
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/assets', { ...form, purchase_cost: Number(form.purchase_cost), warranty_start: form.warranty_start || null, warranty_end: form.warranty_end || null });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the asset. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Asset register</p><h2>Add new asset</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label>Asset tag<input required value={form.asset_tag} onChange={(event) => update('asset_tag', event.target.value)} placeholder="IT-LAP-0007" /></label><label>Category<select value={form.category} onChange={(event) => update('category', event.target.value)}><option>Laptop</option><option>Monitor</option><option>Mobile</option><option>Network device</option><option>Server</option></select></label><label>Manufacturer<input required value={form.manufacturer} onChange={(event) => update('manufacturer', event.target.value)} placeholder="Dell" /></label><label>Model<input required value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="Latitude 7450" /></label><label>Serial number<input required value={form.serial_number} onChange={(event) => update('serial_number', event.target.value)} placeholder="SN-000000" /></label><label>Department<input required value={form.department} onChange={(event) => update('department', event.target.value)} placeholder="Engineering" /></label><label>Custodian<input required value={form.custodian} onChange={(event) => update('custodian', event.target.value)} placeholder="Asset custodian" /></label><label>Location<input required value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="HQ / Floor 1" /></label><label>Purchase cost<input required type="number" min="0" value={form.purchase_cost} onChange={(event) => update('purchase_cost', event.target.value)} placeholder="0" /></label><label>Warranty start<input type="date" max={form.warranty_end || undefined} value={form.warranty_start} onChange={(event) => update('warranty_start', event.target.value)} /></label><label>Warranty end<input type="date" min={form.warranty_start || undefined} value={form.warranty_end} onChange={(event) => update('warranty_end', event.target.value)} /></label><div className="warranty-lookup-form-row"><span className="warranty-lookup-label">Manufacturer warranty lookup</span><WarrantyLookupLink manufacturer={form.manufacturer} serialNumber={form.serial_number} /></div></div>{error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} {saving ? 'Saving...' : 'Add asset'}</button></div></form></div>;
}

export default App;
