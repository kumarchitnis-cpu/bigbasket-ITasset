import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Check,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  ClipboardList,
  ClipboardCheck,
  Download,
  FileText,
  Laptop,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Ticket,
  Users,
  UserMinus,
  UserPlus,
  X,
  XCircle,
  Wrench,
} from 'lucide-react';
import { ApiError, api, auth, setOnUnauthorized, type AppDocument, type AppUser } from '@/lib/api';

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

type Ticket = {
  id: string;
  ticket_number: string;
  title: string;
  category: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED';
  assignee: string;
  requester: string;
  due_label: string;
  created_at: string;
};

type PurchaseRequest = {
  id: string;
  request_number: string;
  title: string;
  requester: string;
  department: string;
  amount: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'RETURNED' | 'ORDERED';
  needed_by: string;
  created_at: string;
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
  'procurement_officer',
  'finance_officer',
  'approver',
  'employee',
  'auditor',
];

const invoiceStatuses: Invoice['status'][] = ['PENDING', 'UNDER_REVIEW', 'PROCESSED', 'ON_HOLD', 'REJECTED'];

type Tab = 'Overview' | 'Assets' | 'Procurement' | 'Invoices' | 'Emp Asset Mgmt' | 'Inventory' | 'Warranties' | 'Write-Off' | 'Notifications' | 'Settings' | 'AI Assistant' | 'Service desk' | 'User Management';

const navItems: { label: Tab; icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'AI Assistant', icon: Bot },
  { label: 'Procurement', icon: ClipboardList },
  { label: 'Invoices', icon: FileText },
  { label: 'Assets', icon: Box },
  { label: 'Emp Asset Mgmt', icon: Users },
  { label: 'Inventory', icon: Archive },
  { label: 'Warranties', icon: BadgeCheck },
  { label: 'Write-Off', icon: CircleDollarSign },
  { label: 'Notifications', icon: Bell },
  { label: 'Settings', icon: Settings2 },
  { label: 'User Management', icon: Users },
  { label: 'Service desk', icon: LifeBuoy },
];

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const compactMoney = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [employeeRequests, setEmployeeRequests] = useState<EmployeeAssetRequest[]>([]);
  const [writeOffRequests, setWriteOffRequests] = useState<WriteOffRequest[]>([]);
  const [inventoryReceipts, setInventoryReceipts] = useState<InventoryReceipt[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [dashboardActivity, setDashboardActivity] = useState<DashboardData>({ recent: [], daily: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [assetModalOpen, setAssetModalOpen] = useState(false);
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
      const [assetData, invoiceData, ticketData, requestData, employeeRequestData, writeOffData, receiptData, notificationData, dashboardData] = await Promise.all([
        api.get<Asset[]>('/api/assets'),
        api.get<Invoice[]>('/api/invoices'),
        api.get<Ticket[]>('/api/tickets'),
        api.get<PurchaseRequest[]>('/api/purchase-requests'),
        api.get<EmployeeAssetRequest[]>('/api/workflows/employee-requests'),
        api.get<WriteOffRequest[]>('/api/workflows/write-offs'),
        api.get<InventoryReceipt[]>('/api/receipts'),
        api.get<WorkspaceNotification[]>('/api/notifications'),
        api.get<DashboardData>('/api/dashboard/activity'),
      ]);
      setAssets(assetData);
      setInvoices(invoiceData);
      setTickets(ticketData);
      setPurchaseRequests(requestData);
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

  const filteredTickets = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return tickets;
    return tickets.filter((ticket) => [ticket.ticket_number, ticket.title, ticket.category, ticket.requester, ticket.assignee].some((value) => value.toLowerCase().includes(normalized)));
  }, [tickets, query]);

  const metrics = useMemo(() => {
    const endOfYear = new Date(new Date().getFullYear(), 11, 31);
    const warrantyCount = assets.filter((asset) => asset.warranty_end && new Date(asset.warranty_end) <= endOfYear).length;
    return {
      total: assets.length,
      active: assets.filter((asset) => asset.status === 'ASSIGNED').length,
      available: assets.filter((asset) => asset.status === 'AVAILABLE').length,
      maintenance: assets.filter((asset) => asset.status === 'UNDER_MAINTENANCE').length,
      warranty: warrantyCount,
      approvals: purchaseRequests.filter((request) => request.status === 'PENDING_APPROVAL').length,
      openTickets: tickets.filter((ticket) => ticket.status !== 'RESOLVED').length,
      invoiceExceptions: invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD').length,
      unreadNotifications: notifications.filter((notification) => !notification.read_at).length,
    };
  }, [assets, invoices, notifications, purchaseRequests, tickets]);

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
    for (const ticket of tickets) {
      if ([ticket.ticket_number, ticket.title, ticket.category, ticket.requester, ticket.assignee]
        .some((value) => value.toLowerCase().includes(term))) {
        results.push({ id: `ticket-${ticket.id}`, title: `${ticket.ticket_number} · ${ticket.title}`, detail: `${ticket.category} · ${ticket.status.toLowerCase().replace(/_/g, ' ')}`, tab: 'Service desk', icon: Ticket });
      }
    }
    return results.slice(0, 8);
  }, [assets, invoices, query, tickets]);

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
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <img className="brand-logo" src="/images/images.jpeg" alt="Bigbasket" />
          <div><div className="brand-name">bigbasket</div><div className="brand-subtitle">IT OPERATIONS</div></div>
          <button className="sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <div className="workspace-switcher"><img className="workspace-logo" src="/images/images.jpeg" alt="Bigbasket" /><div className="workspace-copy"><span>Bigbasket</span><small>Operations workspace</small></div><ChevronDown size={15} /></div>
        <div className="nav-section-label">Workspace</div>
        <nav className="main-nav sidebar-nav">{navItems.filter(({ label }) => label !== 'User Management' || user.role === 'admin').map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activeTab === label ? 'active' : ''}`} onClick={() => showTab(label)}><Icon size={18} /><span>{label}</span>{label === 'Invoices' && metrics.invoiceExceptions > 0 && <span className="nav-count">{metrics.invoiceExceptions}</span>}{label === 'Notifications' && metrics.unreadNotifications > 0 && <span className="nav-count">{metrics.unreadNotifications}</span>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Sparkles size={16} /></div><strong>Need a hand?</strong><span>View the operations guide</span><button>Open guide <ArrowUpRight size={13} /></button></div><div className="profile-row"><div className="avatar avatar-dark">{initials(user.full_name)}</div><div className="profile-copy"><strong>{user.full_name}</strong><span>{roleLabel(user.role)}</span></div><button className="more-dots" aria-label="Sign out" onClick={signOut}><LogOut size={15} /></button></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={21} /></button><div className="breadcrumbs"><span>Operations</span><span className="crumb-divider">/</span><strong>{activeTab}</strong></div><div className="topbar-actions"><button className="assistant-launch" onClick={() => showTab('AI Assistant')} aria-label="Ask, navigate, or implement with AI"><Sparkles size={16} /><span>Ask, navigate, or implement…</span><kbd>AI</kbd></button><div className="global-search-wrap" ref={searchBoxRef}><div className={`global-search ${searchOpen ? 'search-active' : ''}`}><button type="button" className="search-trigger" aria-label="Open workspace search" onClick={() => setSearchOpen(true)}><Search size={17} /></button><input ref={searchInputRef} value={query} onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onKeyDown={(event) => { if (event.key === 'Enter' && searchResults[0]) { showTab(searchResults[0].tab); setSearchOpen(false); } }} placeholder="Search assets, invoices, tickets..." aria-label="Search workspace" aria-expanded={searchOpen} aria-controls="workspace-search-results" /><kbd>Ctrl K</kbd>{query && <button className="search-clear" aria-label="Clear search" onClick={() => { setQuery(''); setSearchOpen(true); searchInputRef.current?.focus(); }}><X size={14} /></button>}</div>{searchOpen && query.trim() && <div className="search-results" id="workspace-search-results" role="listbox" aria-label="Workspace search results">{searchResults.map(({ id, title, detail, tab, icon: Icon }) => <button key={id} role="option" aria-selected="false" onClick={() => { setQuery(query.trim()); showTab(tab); setSearchOpen(false); }}><span className="search-result-icon"><Icon size={15} /></span><span className="search-result-copy"><strong>{title}</strong><small>{detail}</small></span><span className="search-result-type">{tab}</span></button>)}{searchResults.length === 0 && <div className="search-no-results">No matching assets, invoices, or tickets.</div>}</div>}</div><button className="icon-button notification-button" aria-label="Notifications" onClick={() => showTab('Notifications')}><Bell size={19} />{metrics.unreadNotifications > 0 && <span></span>}</button><div className="user-menu-wrap" ref={userMenuRef}><button className="user-menu-trigger" aria-label={`User menu for ${user.full_name}`} aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen((open) => !open)}><span className="avatar avatar-light">{initials(user.full_name)}</span><ChevronDown size={13} /></button>{userMenuOpen && <div className="user-menu-popover"><div className="user-menu-heading"><strong>{user.full_name}</strong><span>{user.email}</span><small>{roleLabel(user.role)}</small></div><button onClick={() => { setUserMenuOpen(false); showTab('Settings'); }}><Settings2 size={15} /> Account settings</button>{user.role === 'admin' && <button onClick={() => { setUserMenuOpen(false); showTab('User Management'); }}><Users size={15} /> User management</button>}<button className="user-menu-signout" onClick={signOut}><LogOut size={15} /> Sign out</button></div>}</div></div></header>

        <div className="page-content">
          {loading ? <LoadingState /> : error ? <ErrorState onRetry={() => void loadData()} /> : <>
            {activeTab === 'Overview' && <Overview assets={assets} invoices={invoices} tickets={tickets} requests={purchaseRequests} employeeRequests={employeeRequests} activity={dashboardActivity} onOpenAssets={() => showTab('Assets')} onOpenInvoices={() => showTab('Invoices')} onOpenProcurement={() => showTab('Procurement')} onOpenServiceDesk={() => showTab('Service desk')} />}
            {activeTab === 'Assets' && <AssetsView assets={filteredAssets} user={user} onAdd={() => setAssetModalOpen(true)} onRefresh={() => void loadData(true)} query={query} />}
            {activeTab === 'Procurement' && <ProcurementView requests={purchaseRequests} userName={user.full_name} department={user.department} onSaved={() => void loadData(true)} />}
            {activeTab === 'Invoices' && <InvoicesView invoices={invoices} user={user} query={query} onSaved={() => void loadData(true)} />}
            {activeTab === 'Emp Asset Mgmt' && <EmployeeAssetsView requests={employeeRequests} user={user} onSaved={() => void loadData(true)} />}
            {activeTab === 'Inventory' && <InventoryView assets={assets} receipts={inventoryReceipts} user={user} onSaved={() => void loadData(true)} />}
            {activeTab === 'Warranties' && <WarrantiesView assets={assets} />}
            {activeTab === 'Write-Off' && <WriteOffView assets={assets} requests={writeOffRequests} user={user} onSaved={() => void loadData(true)} />}
            {activeTab === 'Notifications' && <NotificationsView notifications={notifications} onRead={async (id) => { await api.put(`/api/notifications/${id}/read`, {}); setNotifications((current) => current.map((notification) => notification.id === id ? { ...notification, read_at: new Date().toISOString() } : notification)); }} />}
            {activeTab === 'Settings' && <SettingsView user={user} onSaved={setUser} />}
            {activeTab === 'User Management' && user.role === 'admin' && <UserManagementView currentUser={user} />}
            {activeTab === 'AI Assistant' && <AssistantView onNavigate={showTab} />}
            {activeTab === 'Service desk' && <ServiceDeskView tickets={filteredTickets} userName={user.full_name} onSaved={() => void loadData(true)} />}
          </>}
        </div>
      </main>
      {assetModalOpen && <AssetModal userName={user.full_name} department={user.department} onClose={() => setAssetModalOpen(false)} onSaved={() => { setAssetModalOpen(false); void loadData(true); }} />}
      {refreshing && <div className="refresh-indicator"><Loader2 size={15} className="spin" /> Updating workspace</div>}
    </div>
  );
}

function Overview({ assets, invoices, tickets, requests, employeeRequests, activity, onOpenAssets, onOpenInvoices, onOpenProcurement, onOpenServiceDesk }: {
  assets: Asset[];
  invoices: Invoice[];
  tickets: Ticket[];
  requests: PurchaseRequest[];
  employeeRequests: EmployeeAssetRequest[];
  activity: DashboardData;
  onOpenAssets: () => void;
  onOpenInvoices: () => void;
  onOpenProcurement: () => void;
  onOpenServiceDesk: () => void;
}) {
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const activeAssets = assets.filter((asset) => asset.status !== 'RETIRED').length;
  const orderedRequests = requests.filter((request) => request.status === 'ORDERED').length;
  const openTickets = tickets.filter((ticket) => ticket.status !== 'RESOLVED').length;
  const requestStatuses = [
    { label: 'Awaiting approval', value: requests.filter((request) => request.status === 'PENDING_APPROVAL').length, color: 'amber' },
    { label: 'Approved', value: requests.filter((request) => request.status === 'APPROVED').length, color: 'teal' },
    { label: 'Ordered', value: orderedRequests, color: 'blue' },
    { label: 'Returned', value: requests.filter((request) => request.status === 'RETURNED').length, color: 'gray' },
  ];
  const ticketStatuses = [
    { label: 'Open', value: tickets.filter((ticket) => ticket.status === 'OPEN').length, color: 'blue' },
    { label: 'In progress', value: tickets.filter((ticket) => ticket.status === 'IN_PROGRESS').length, color: 'teal' },
    { label: 'Waiting', value: tickets.filter((ticket) => ticket.status === 'WAITING').length, color: 'amber' },
    { label: 'Resolved', value: tickets.filter((ticket) => ticket.status === 'RESOLVED').length, color: 'gray' },
  ];
  const priorityItems = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => ({
    label: priority === 'URGENT' ? 'Critical' : priority[0] + priority.slice(1).toLowerCase(),
    value: tickets.filter((ticket) => ticket.priority === priority).length,
    color: priority.toLowerCase(),
  }));
  const departmentItems = Array.from(new Set(requests.map((request) => request.department)))
    .map((department) => ({ label: department, value: requests.filter((request) => request.department === department).length, color: 'blue' }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const ticketCategoryItems = Array.from(new Set(tickets.map((ticket) => ticket.category)))
    .map((category) => ({ label: category, value: tickets.filter((ticket) => ticket.category === category).length, color: 'teal' }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const ticketTrend = makeDailySeries(tickets.map((ticket) => ticket.created_at));
  const activityTrend = makeDailySeries(activity.daily.map((item) => item.date), activity.daily);

  return <div className="fade-in operations-dashboard">
    <div className="page-heading">
      <div><p className="eyebrow">Workspace overview <span className="live-dot"></span> Live data</p><h1>Operations Dashboard</h1><p className="heading-copy">{today} · Asset, procurement, and service overview.</p></div>
      <div className="heading-actions"><button className="button button-secondary" onClick={onOpenInvoices}><FileText size={16} /> Invoice register <ArrowUpRight size={14} /></button><button className="button button-primary" onClick={onOpenAssets}><Plus size={17} /> Add asset</button></div>
    </div>

    <div className="metric-grid dashboard-metrics">
      <MetricCard label="Total assets" value={assets.length.toLocaleString()} note="Registered in workspace" icon={Box} tone="blue" />
      <MetricCard label="Active assets" value={activeAssets.toLocaleString()} note={`${assets.length - activeAssets} retired`} icon={BriefcaseBusiness} tone="teal" />
      <MetricCard label="Purchase orders" value={orderedRequests.toLocaleString()} note={`${requests.length} purchase requests`} icon={ClipboardList} tone="amber" />
      <MetricCard label="Invoice records" value={invoices.length.toLocaleString()} note="Tracked in invoice register" icon={FileText} tone="blue" />
      <MetricCard label="Open tickets" value={openTickets.toLocaleString()} note={`${tickets.length} total tickets`} icon={Ticket} tone="red" />
    </div>

    <div className="dashboard-reference-grid dashboard-overview-grid">
      <section className="panel dashboard-panel"><PanelHeader title="Purchase Requests by Status" action="View procurement" onAction={onOpenProcurement} /><DashboardBarList items={requestStatuses} emptyLabel="No purchase requests yet." /></section>
      <section className="panel dashboard-panel"><PanelHeader title="Ticket Overview" action="Open service desk" onAction={onOpenServiceDesk} /><DashboardStatusGrid items={ticketStatuses} footer={`${employeeRequests.length} asset allocation request${employeeRequests.length === 1 ? '' : 's'}`} /></section>
    </div>

    <div className="dashboard-reference-grid dashboard-chart-grid">
      <section className="panel dashboard-panel"><PanelHeader title="Ticket Trend" subtitle="Tickets created over the last 30 days" /><DashboardTrend values={ticketTrend} color="blue" /></section>
      <section className="panel dashboard-panel"><PanelHeader title="Activity Trend" subtitle="Successful workspace actions over the last 30 days" /><DashboardTrend values={activityTrend} color="teal" /></section>
    </div>

    <div className="dashboard-reference-grid dashboard-breakdown-grid">
      <section className="panel dashboard-panel"><PanelHeader title="Tickets by Priority" action="View tickets" onAction={onOpenServiceDesk} /><DashboardBarList items={priorityItems} emptyLabel="No tickets yet." /></section>
      <section className="panel dashboard-panel"><PanelHeader title="Requests by Department" action="View procurement" onAction={onOpenProcurement} /><DashboardBarList items={departmentItems} emptyLabel="No purchase requests yet." /></section>
      <section className="panel dashboard-panel"><PanelHeader title="Tickets by Type" action="View tickets" onAction={onOpenServiceDesk} /><DashboardBarList items={ticketCategoryItems} emptyLabel="No tickets yet." /></section>
    </div>

    <div className="dashboard-reference-grid dashboard-recent-grid">
      <section className="panel table-panel dashboard-panel"><PanelHeader title="Recent Assets" subtitle="Latest registered devices" action="View all" onAction={onOpenAssets} /><div className="data-table-wrap"><table className="data-table dashboard-assets-table"><thead><tr><th>Make</th><th>Model</th><th>Serial number</th><th>Status</th></tr></thead><tbody>{assets.slice(0, 6).map((asset) => <tr key={asset.id}><td>{asset.manufacturer}</td><td>{asset.model}</td><td>{asset.serial_number}</td><td><StatusBadge status={asset.status} /></td></tr>)}</tbody></table>{assets.length === 0 && <EmptyState text="No assets have been registered yet." />}</div></section>
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

function DashboardBarList({ items, emptyLabel }: { items: { label: string; value: number; color: string }[]; emptyLabel: string }) {
  const maximum = Math.max(...items.map((item) => item.value), 0);
  if (maximum === 0) return <div className="dashboard-chart-empty">{emptyLabel}</div>;
  return <div className="dashboard-bar-list">{items.map((item) => <div className="dashboard-bar-row" key={item.label}><div className="dashboard-bar-label"><span>{item.label}</span><strong>{item.value}</strong></div><div className="dashboard-bar-track"><span className={item.color} style={{ width: `${Math.max((item.value / maximum) * 100, 3)}%` }} /></div></div>)}</div>;
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

function AssetsView({ assets, user, onAdd, onRefresh, query }: { assets: Asset[]; user: AppUser; onAdd: () => void; onRefresh: () => void; query: string }) {
  const [statusFilter, setStatusFilter] = useState<'ALL' | Asset['status']>('ALL');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const canManage = user.role === 'admin' || user.role === 'it_asset_manager';
  const counts = useMemo(() => ({
    ALL: assets.length,
    ASSIGNED: assets.filter((asset) => asset.status === 'ASSIGNED').length,
    AVAILABLE: assets.filter((asset) => asset.status === 'AVAILABLE').length,
    UNDER_MAINTENANCE: assets.filter((asset) => asset.status === 'UNDER_MAINTENANCE').length,
    QUARANTINED: assets.filter((asset) => asset.status === 'QUARANTINED').length,
    RETIRED: assets.filter((asset) => asset.status === 'RETIRED').length,
  }), [assets]);
  const visibleAssets = statusFilter === 'ALL' ? assets : assets.filter((asset) => asset.status === statusFilter);
  const pills: { key: typeof statusFilter; label: string }[] = [
    { key: 'ALL', label: 'All assets' },
    { key: 'ASSIGNED', label: 'Assigned' },
    { key: 'AVAILABLE', label: 'Available' },
    { key: 'UNDER_MAINTENANCE', label: 'Maintenance' },
    { key: 'QUARANTINED', label: 'Quarantined' },
    { key: 'RETIRED', label: 'Retired' },
  ];
  return <div className="fade-in"><div className="page-heading"><div><p className="eyebrow">Asset lifecycle <span className="eyebrow-separator">/</span> Register</p><h1>Asset register</h1><p className="heading-copy">Every device, assignment, and lifecycle event in one place.</p></div>{canManage && <button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add asset</button>}</div><div className="subnav-row"><div className="tab-pills">{pills.map(({ key, label }) => <button key={key} className={statusFilter === key ? 'selected' : ''} onClick={() => setStatusFilter(key)}>{label} <span>{counts[key]}</span></button>)}</div><div className="asset-workflow-note"><Activity size={15} /> Lifecycle actions are recorded to the asset history</div></div>{query && <div className="filter-note"><Search size={14} /> Showing matches for “{query}”</div>}<section className="panel table-panel full-panel"><AssetTable assets={visibleAssets} onManage={setSelectedAsset} /></section>{selectedAsset && <AssetLifecycleDialog asset={selectedAsset} canManage={canManage} onClose={() => setSelectedAsset(null)} onSaved={onRefresh} />}</div>;
}

function ProcurementView({ requests, userName, department, onSaved }: { requests: PurchaseRequest[]; userName: string; department: string; onSaved: () => void }) {
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const approvedThisMonth = requests.filter((request) => (request.status === 'APPROVED' || request.status === 'ORDERED') && request.created_at && request.created_at.slice(0, 7) === monthPrefix).length;
  return <div className="fade-in"><PageTitle eyebrow="Procurement / Requests" title="Purchase requests" copy="Move requests from need to approved purchase order with a clear audit trail." action="New request" icon={Plus} onAction={() => setRequestModalOpen(true)} /><div className="stat-strip"><MiniStat label="Pending approval" value={requests.filter((request) => request.status === 'PENDING_APPROVAL').length.toString()} tone="amber" /><MiniStat label="Approved this month" value={approvedThisMonth.toString()} tone="teal" /><MiniStat label="Committed spend" value={compactMoney.format(requests.reduce((sum, request) => sum + Number(request.amount), 0))} tone="blue" /></div><section className="panel table-panel full-panel"><PanelHeader title="Request pipeline" subtitle="Latest purchase requests and approvals" action="Export" /><div className="request-list">{requests.map((request) => <div className="request-row" key={request.id}><div className="request-icon"><ClipboardList size={17} /></div><div className="request-main"><strong>{request.title}</strong><span>{request.request_number} · {request.requester} · {request.department}</span></div><div className="request-amount">{money.format(request.amount)}</div><StatusBadge status={request.status} /><div className="request-date"><span>Needed by</span><strong>{formatDate(request.needed_by)}</strong></div><button className="row-more">•••</button></div>)}</div>{requests.length === 0 && <EmptyState text="No purchase requests yet. Create the first request to get started." />}</section>{requestModalOpen && <PurchaseRequestModal userName={userName} department={department} onClose={() => setRequestModalOpen(false)} onSaved={() => { setRequestModalOpen(false); onSaved(); }} />}</div>;
}

function InvoicesView({ invoices, user, query, onSaved }: { invoices: Invoice[]; user: AppUser; query: string; onSaved: () => void }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [filter, setFilter] = useState<'ALL' | Invoice['status']>('ALL');
  const [search, setSearch] = useState(query);
  const [tableError, setTableError] = useState<string | null>(null);
  const canManage = user.role === 'admin' || user.role === 'finance_officer';
  useEffect(() => {
    setSearch(query);
  }, [query]);
  const visibleInvoices = invoices.filter((invoice) => {
    const matchesStatus = filter === 'ALL' || invoice.status === filter;
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [invoice.invoice_number, invoice.purchase_order, invoice.vendor].some((value) => value?.toLowerCase().includes(term));
    return matchesStatus && matchesSearch;
  });
  const updateStatus = async (invoice: Invoice, status: Invoice['status']) => {
    setTableError(null);
    try {
      await api.put(`/api/invoices/${encodeURIComponent(invoice.id)}`, { status });
      onSaved();
    } catch (err) {
      setTableError(err instanceof ApiError ? err.message : 'Could not update invoice status.');
    }
  };
  const deleteInvoice = async (invoice: Invoice) => {
    if (!window.confirm(`Delete invoice ${invoice.invoice_number}? This does not delete its uploaded document.`)) return;
    setTableError(null);
    try {
      await api.del(`/api/invoices/${encodeURIComponent(invoice.id)}`);
      onSaved();
    } catch (err) {
      setTableError(err instanceof ApiError ? err.message : 'Could not delete this invoice.');
    }
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
    } catch (err) {
      setTableError(err instanceof ApiError ? err.message : 'Could not download the invoice file.');
    }
  };
  return <div className="fade-in">
    <PageTitle eyebrow="Finance / Payables" title="Invoices" copy="Review invoice details, supporting files, and processing status." />
    <div className="invoice-toolbar">
      <div className="invoice-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice, PO, or vendor" aria-label="Search invoices" /></div>
      <label className="invoice-filter-label">Status<select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter invoices by status"><option value="ALL">All statuses</option>{invoiceStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
      {canManage && <div className="invoice-toolbar-actions"><button className="button button-secondary" onClick={() => setManualOpen(true)}><Plus size={16} /> Manual Entry</button><button className="button button-primary" onClick={() => setUploadOpen(true)}><FileText size={16} /> Upload Invoice</button></div>}
    </div>
    <div className="stat-strip"><MiniStat label="In queue" value={invoices.filter((invoice) => invoice.status !== 'PROCESSED').length.toString()} tone="amber" /><MiniStat label="Needs review" value={invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD').length.toString()} tone="red" /><MiniStat label="Processed spend" value={compactMoney.format(invoices.filter((invoice) => invoice.status === 'PROCESSED').reduce((sum, invoice) => sum + Number(invoice.total), 0))} tone="teal" /></div>
    {tableError && <div className="auth-message module-error invoice-table-error">{tableError}</div>}
    <section className="panel table-panel full-panel"><InvoiceTable invoices={visibleInvoices} canManage={canManage} canDelete={user.role === 'admin'} onStatusChange={(invoice, status) => void updateStatus(invoice, status)} onDelete={(invoice) => void deleteInvoice(invoice)} onDownload={(invoice) => void downloadInvoice(invoice)} /></section>
    {uploadOpen && <InvoiceUploadModal onClose={() => setUploadOpen(false)} onSaved={() => { setUploadOpen(false); onSaved(); }} />}
    {manualOpen && <ManualInvoiceModal onClose={() => setManualOpen(false)} onSaved={() => { setManualOpen(false); onSaved(); }} />}
  </div>;
}

function ServiceDeskView({ tickets, userName, onSaved }: { tickets: Ticket[]; userName: string; onSaved: () => void }) {
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  return <div className="fade-in"><PageTitle eyebrow="Operations / Support" title="Service desk" copy="Keep requests, incidents, and SLA commitments moving forward." action="Create ticket" icon={Plus} onAction={() => setTicketModalOpen(true)} /><div className="stat-strip"><MiniStat label="Open tickets" value={tickets.filter((ticket) => ticket.status === 'OPEN').length.toString()} tone="blue" /><MiniStat label="SLA at risk" value={tickets.filter((ticket) => ticket.priority === 'URGENT' || ticket.priority === 'HIGH').length.toString()} tone="red" /><MiniStat label="Resolved" value={tickets.filter((ticket) => ticket.status === 'RESOLVED').length.toString()} tone="teal" /></div><section className="panel table-panel full-panel"><PanelHeader title="Active work" subtitle="Incidents and requests assigned to your team" action="Filter" /><div className="ticket-list">{tickets.map((ticket) => <div className="ticket-row" key={ticket.id}><div className={`priority-bar ${ticket.priority.toLowerCase()}`}></div><div className="ticket-main"><div><span className="ticket-number">{ticket.ticket_number}</span><strong>{ticket.title}</strong></div><span>{ticket.category} · Requested by {ticket.requester}</span></div><PriorityBadge priority={ticket.priority} /><StatusBadge status={ticket.status} /><div className="ticket-assignee"><div className="avatar avatar-small">{initials(ticket.assignee)}</div><span>{ticket.assignee}</span></div><div className="ticket-due"><span>{ticket.status === 'RESOLVED' ? 'Completed' : 'SLA'}</span><strong>{ticket.due_label}</strong></div></div>)}</div>{tickets.length === 0 && <EmptyState text="No tickets in the queue. Create a ticket to report an issue or request." />}</section>{ticketModalOpen && <TicketModal userName={userName} onClose={() => setTicketModalOpen(false)} onSaved={() => { setTicketModalOpen(false); onSaved(); }} />}</div>;
}

function EmployeeAssetsView({ requests, user, onSaved }: { requests: EmployeeAssetRequest[]; user: AppUser; onSaved: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const canReview = user.role === 'admin' || user.role === 'it_asset_manager';
  const review = async (request: EmployeeAssetRequest, status: 'APPROVED' | 'REJECTED') => {
    setReviewError(null);
    try {
      await api.put(`/api/workflows/employee-requests/${encodeURIComponent(request.id)}/review`, { status });
      onSaved();
    } catch (error) {
      setReviewError(error instanceof ApiError ? error.message : 'Could not review the asset request.');
    }
  };
  return <div className="fade-in"><PageTitle eyebrow="Employee services / Equipment" title="Employee asset management" copy={canReview ? 'Review employee equipment requests and track request outcomes.' : 'Request the equipment you need and follow its approval status.'} action="Request asset" icon={Plus} onAction={() => setModalOpen(true)} /><div className="stat-strip"><MiniStat label="Pending review" value={requests.filter((request) => request.status === 'PENDING_APPROVAL').length.toString()} tone="amber" /><MiniStat label="Approved" value={requests.filter((request) => request.status === 'APPROVED').length.toString()} tone="teal" /><MiniStat label="Requests shown" value={requests.length.toString()} tone="blue" /></div>{reviewError && <div className="auth-message module-error">{reviewError}</div>}<section className="panel table-panel full-panel"><PanelHeader title={canReview ? 'Employee requests' : 'My asset requests'} subtitle={canReview ? 'Requests across the workspace' : 'Requests are visible only to you and asset managers'} /><div className="request-list">{requests.map((request) => <div className="request-row employee-request-row" key={request.id}><div className="request-icon"><Users size={17} /></div><div className="request-main"><strong>{request.category} · {request.request_number}</strong><span>{request.requester_name} · {request.department} · Needed by {formatDate(request.needed_by)}</span><small>{request.justification}</small></div><StatusBadge status={request.status} />{canReview && request.status === 'PENDING_APPROVAL' && <div className="request-review-actions"><button className="icon-button approve-action" aria-label={`Approve ${request.request_number}`} onClick={() => void review(request, 'APPROVED')}><Check size={17} /></button><button className="icon-button reject-action" aria-label={`Reject ${request.request_number}`} onClick={() => void review(request, 'REJECTED')}><XCircle size={17} /></button></div>}</div>)}</div>{requests.length === 0 && <EmptyState text={canReview ? 'No employee asset requests are waiting.' : 'You have not submitted an asset request yet.'} />}</section>{modalOpen && <EmployeeAssetRequestModal user={user} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); onSaved(); }} />}</div>;
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
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Inventory / Receiving</p><h2>Record goods receipt</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label>Purchase order<input required value={form.purchase_order} onChange={(event) => update('purchase_order', event.target.value)} /></label><label>Vendor<input required value={form.vendor} onChange={(event) => update('vendor', event.target.value)} /></label><label>Received date<input required type="date" value={form.received_date} onChange={(event) => update('received_date', event.target.value)} /></label><label>Ordered quantity<input required min="0" type="number" value={form.ordered_quantity} onChange={(event) => update('ordered_quantity', event.target.value)} /></label><label>Accepted quantity<input required min="0" type="number" value={form.accepted_quantity} onChange={(event) => update('accepted_quantity', event.target.value)} /></label><label>Rejected quantity<input required min="0" type="number" value={form.rejected_quantity} onChange={(event) => update('rejected_quantity', event.target.value)} /></label><label className="span-2">Discrepancy note<textarea value={form.discrepancy_note} onChange={(event) => update('discrepancy_note', event.target.value)} placeholder="Optional notes about rejected or missing items" /></label></div>{error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving...' : 'Save receipt'}</button></div></form></div>;
}

function InventoryView({ assets, receipts, user, onSaved }: { assets: Asset[]; receipts: InventoryReceipt[]; user: AppUser; onSaved: () => void }) {
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const stock = assets.filter((asset) => asset.status === 'AVAILABLE');
  const categories = [...new Set(stock.map((asset) => asset.category))];
  const canReceive = ['admin', 'it_asset_manager', 'procurement_officer'].includes(user.role);
  return <div className="fade-in"><PageTitle eyebrow="Inventory / Stock operations" title="Inventory" copy="Available assets and goods receipt activity from your operational register." action={canReceive ? 'Record goods receipt' : undefined} icon={Plus} onAction={canReceive ? () => setReceiptModalOpen(true) : undefined} /><div className="stat-strip"><MiniStat label="Available assets" value={stock.length.toString()} tone="teal" /><MiniStat label="Categories in stock" value={categories.length.toString()} tone="blue" /><MiniStat label="Goods receipts" value={receipts.length.toString()} tone="amber" /></div><section className="panel table-panel full-panel"><PanelHeader title="Available stock" subtitle="Registered assets ready to assign" /><AssetTable assets={stock} /></section><section className="panel table-panel full-panel module-panel-gap"><PanelHeader title="Recent goods receipts" subtitle="Received and accepted quantities recorded against purchase orders" /><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Receipt</th><th>Purchase order</th><th>Vendor</th><th>Received</th><th>Accepted / ordered</th><th>Status</th></tr></thead><tbody>{receipts.map((receipt) => <tr key={receipt.id}><td><strong>{receipt.receipt_number}</strong></td><td>{receipt.purchase_order}</td><td>{receipt.vendor}</td><td>{formatDate(receipt.received_date)}</td><td>{receipt.accepted_quantity} / {receipt.ordered_quantity}</td><td><StatusBadge status={receipt.status} /></td></tr>)}</tbody></table>{receipts.length === 0 && <EmptyState text="No goods receipts recorded yet." />}</div></section>{receiptModalOpen && <GoodsReceiptModal onClose={() => setReceiptModalOpen(false)} onSaved={() => { setReceiptModalOpen(false); onSaved(); }} />}</div>;
}

function WarrantiesView({ assets }: { assets: Asset[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 90);
  const warrantyAssets = assets.filter((asset) => asset.status !== 'RETIRED' && asset.warranty_end).sort((a, b) => String(a.warranty_end).localeCompare(String(b.warranty_end)));
  const expired = warrantyAssets.filter((asset) => new Date(`${asset.warranty_end}T00:00:00`) < today);
  const expiring = warrantyAssets.filter((asset) => {
    const end = new Date(`${asset.warranty_end}T00:00:00`);
    return end >= today && end <= horizon;
  });
  return <div className="fade-in"><PageTitle eyebrow="Asset lifecycle / Coverage" title="Warranties" copy="Monitor expired coverage and warranties ending in the next 90 days." /><div className="stat-strip"><MiniStat label="Tracked warranties" value={warrantyAssets.length.toString()} tone="blue" /><MiniStat label="Expiring in 90 days" value={expiring.length.toString()} tone="amber" /><MiniStat label="Expired" value={expired.length.toString()} tone="red" /></div><section className="panel table-panel full-panel"><PanelHeader title="Warranty register" subtitle="Coverage is calculated from each asset’s recorded warranty end date" /><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Asset</th><th>Model</th><th>Custodian</th><th>Department</th><th>Warranty ends</th><th>Coverage</th></tr></thead><tbody>{warrantyAssets.map((asset) => { const end = new Date(`${asset.warranty_end}T00:00:00`); const isExpired = end < today; const isExpiring = !isExpired && end <= horizon; return <tr key={asset.id}><td><strong>{asset.asset_tag}</strong></td><td>{asset.manufacturer} {asset.model}</td><td>{asset.custodian}</td><td>{asset.department}</td><td>{formatDate(asset.warranty_end!)}</td><td><StatusBadge status={isExpired ? 'EXPIRED' : isExpiring ? 'EXPIRING_SOON' : 'COVERED'} /></td></tr>; })}</tbody></table>{warrantyAssets.length === 0 && <EmptyState text="No warranty dates are recorded on active assets." />}</div></section></div>;
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

function SettingsView({ user, onSaved }: { user: AppUser; onSaved: (user: AppUser) => void }) {
  const [fullName, setFullName] = useState(user.full_name);
  const [department, setDepartment] = useState(user.department);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await api.put<AppUser>(`/api/profiles/${encodeURIComponent(user.id)}`, { full_name: fullName, department });
      onSaved(updated);
      setMessage('Profile settings saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save profile settings.');
    } finally {
      setSaving(false);
    }
  };
  return <div className="fade-in"><PageTitle eyebrow="Workspace / Preferences" title="Settings" copy="Manage your profile details and account information." /><div className="settings-grid"><section className="panel settings-panel"><PanelHeader title="Profile" subtitle="These details appear in asset and workflow records." /><form className="settings-form" onSubmit={submit}><label>Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label><label>Department<input required value={department} onChange={(event) => setDepartment(event.target.value)} /></label><label>Work email<input value={user.email} disabled /></label><label>Role<input value={roleLabel(user.role)} disabled /></label>{error && <div className="auth-message">{error}</div>}{message && <div className="settings-success">{message}</div>}<button className="button button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save profile'}</button></form></section><section className="panel settings-panel"><PanelHeader title="Account access" subtitle="Workspace role and sign-in details" /><div className="settings-account"><div><span>Access role</span><strong>{roleLabel(user.role)}</strong></div><div><span>Department</span><strong>{user.department}</strong></div><div><span>Account status</span><strong>{user.active ? 'Active' : 'Inactive'}</strong></div><p>Role changes are managed by a workspace administrator.</p></div></section></div></div>;
}

function UserManagementView({ currentUser }: { currentUser: AppUser }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  return <div className="fade-in">
    <PageTitle eyebrow="Workspace / Administration" title="User Management" copy="Manage workspace accounts, role assignments, and access." action="Add User" icon={UserPlus} onAction={() => { setFormError(null); setModalOpen(true); }} />
    <section className="panel user-management-panel">
      <PanelHeader title="Workspace users" subtitle={`${users.length} account${users.length === 1 ? '' : 's'} · Role changes take effect immediately`} />
      {error && <div className="auth-message module-error user-management-error">{error}<button type="button" className="text-button" onClick={() => void loadUsers()}>Retry</button></div>}
      {loadingUsers ? <div className="history-state"><Loader2 size={17} className="spin" /> Loading users</div> : <div className="data-table-wrap"><table className="data-table user-table">
        <thead><tr><th>User</th><th>Current role</th><th>Change role</th><th>Joined</th><th>Account</th><th>Actions</th></tr></thead>
        <tbody>{users.map((managedUser) => <tr key={managedUser.id}>
          <td><div className="user-cell"><div className="avatar avatar-small">{initials(managedUser.full_name)}</div><div><strong>{managedUser.full_name}{managedUser.id === currentUser.id && <small className="user-you-label">You</small>}</strong><span>{managedUser.email}</span></div></div></td>
          <td><span className={`role-badge role-${managedUser.role}`}>{roleLabel(managedUser.role)}</span></td>
          <td><select aria-label={`Change role for ${managedUser.full_name}`} value={managedUser.role} disabled={busyUser === managedUser.id || managedUser.id === currentUser.id} onChange={(event) => void changeUser(managedUser, { role: event.target.value })}>{workspaceRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></td>
          <td>{formatDate(managedUser.created_at)}</td>
          <td><span className={`user-status ${managedUser.active ? 'active' : 'inactive'}`}>{managedUser.active ? 'Active' : 'Inactive'}</span></td>
          <td><button type="button" className={`user-access-button ${managedUser.active ? 'deactivate' : 'reactivate'}`} disabled={busyUser === managedUser.id || managedUser.id === currentUser.id} onClick={() => void changeUser(managedUser, { active: !managedUser.active })} title={managedUser.active ? 'Deactivate account' : 'Reactivate account'} aria-label={`${managedUser.active ? 'Deactivate' : 'Reactivate'} ${managedUser.full_name}`}><UserMinus size={16} />{managedUser.active ? 'Deactivate' : 'Reactivate'}</button></td>
        </tr>)}</tbody>
      </table>{users.length === 0 && !error && <EmptyState text="No workspace users found." />}</div>}
    </section>
    <section className="panel user-permissions-panel"><PanelHeader title="Role permissions" subtitle="Access is enforced by the server for every request." /><div className="user-permissions-grid">
      <p><strong>Admin</strong><span>Full workspace access, including user management and account roles.</span></p>
      <p><strong>IT asset manager</strong><span>Manage assets and lifecycle, employee requests, write-offs, receipts, and service tickets.</span></p>
      <p><strong>Procurement officer</strong><span>Manage procurement requests and inventory receipts.</span></p>
      <p><strong>Finance officer</strong><span>Manage invoices and view finance-approved documents.</span></p>
      <p><strong>Approver</strong><span>Review and update purchase request approvals.</span></p>
      <p><strong>Employee</strong><span>Submit purchase and equipment requests and create service tickets.</span></p>
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
    { label: 'Procurement', tab: 'Procurement', icon: ClipboardList },
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

function AssetTable({ assets, compact = false, onManage }: { assets: Asset[]; compact?: boolean; onManage?: (asset: Asset) => void }) { return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Asset</th><th>Category</th><th>Custodian</th><th>Location</th><th>Status</th>{!compact && <th>Warranty</th>}<th></th></tr></thead><tbody>{assets.map((asset) => <tr key={asset.id}><td><div className="asset-cell"><div className={`asset-type-icon ${asset.category.toLowerCase().replace(' ', '-')}`}><Laptop size={16} /></div><div><strong>{asset.asset_tag}</strong><span>{asset.manufacturer} {asset.model}</span></div></div></td><td>{asset.category}</td><td><div className="person-cell"><div className="avatar avatar-small">{initials(asset.custodian)}</div><span>{asset.custodian}</span></div></td><td>{asset.location}</td><td><StatusBadge status={asset.status} /></td>{!compact && <td>{asset.warranty_end ? formatDate(asset.warranty_end) : '—'}</td>}<td>{onManage ? <button className="row-action" onClick={() => onManage(asset)}><Activity size={14} /> History</button> : <button className="row-more" aria-label={`More options for ${asset.asset_tag}`}>•••</button>}</td></tr>)}</tbody></table>{assets.length === 0 && <EmptyState text="No assets match this search." />}</div>; }

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

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card asset-lifecycle-card" role="dialog" aria-modal="true" aria-labelledby="asset-lifecycle-title">
    <div className="modal-header"><div><p className="eyebrow">Asset lifecycle</p><h2 id="asset-lifecycle-title">{currentAsset.asset_tag}</h2><span className="asset-modal-model">{currentAsset.manufacturer} {currentAsset.model}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close asset history"><X size={18} /></button></div>
    <div className="asset-detail-grid"><div><span>Status</span><StatusBadge status={currentAsset.status} /></div><div><span>Custodian</span><strong>{currentAsset.custodian}</strong></div><div><span>Location</span><strong>{currentAsset.location}</strong></div><div><span>Condition</span><strong>{currentAsset.condition.toLowerCase()}</strong></div><div><span>Last audited</span><strong>{currentAsset.last_audited_at ? formatDate(currentAsset.last_audited_at) : 'Not audited'}</strong></div><div><span>Warranty end</span><strong>{currentAsset.warranty_end ? formatDate(currentAsset.warranty_end) : 'Not recorded'}</strong></div></div>
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
  </div></div>;
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
  const noItems = invoices.length === 0;
  if (compact) return <div className="data-table-wrap"><table className="data-table invoice-table"><thead><tr><th>Invoice</th><th>Vendor</th><th>PO reference</th><th>Total</th><th>AI confidence</th><th>Status</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><div className="invoice-cell"><div className="document-icon"><FileText size={16} /></div><div><strong>{invoice.invoice_number}</strong><span>{formatDate(invoice.invoice_date)}</span></div></div></td><td>{invoice.vendor}</td><td className="muted-cell">{invoice.purchase_order}</td><td><strong>{money.format(invoice.total)}</strong></td><td><div className="confidence"><div className="confidence-track"><span style={{ width: `${invoice.confidence}%` }}></span></div><span>{invoice.confidence}%</span></div></td><td><StatusBadge status={invoice.status} /></td></tr>)}</tbody></table>{noItems && <EmptyState text="No invoices in the queue." />}</div>;
  return <div className="data-table-wrap invoice-table-wrap"><table className="data-table invoice-table"><thead><tr><th>Invoice Number</th><th>PO Number</th><th>Vendor Name</th><th>Invoice Date</th><th>Description</th><th>HSN</th><th>QTY</th><th>Unit Price</th><th>Total Amount</th><th>Bank Details</th><th>File</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>{invoices.map((invoice) => {
      const items = Array.isArray(invoice.extracted_fields?.line_items) ? invoice.extracted_fields.line_items : [];
      const details = invoice.extracted_fields?.bank_details;
      const description = items.map((item) => item.description).filter(Boolean).join(', ');
      const hsn = [...new Set(items.map((item) => item.hsn).filter(Boolean))].join(', ');
      const quantity = items.reduce((sum, item) => sum + (typeof item.quantity === 'number' ? item.quantity : 0), 0);
      const unitPrices = [...new Set(items.map((item) => item.unit_price).filter((price): price is number => typeof price === 'number'))];
      const bankSummary = details ? [details.name, details.account ? `••••${details.account.slice(-4)}` : null, details.ifsc].filter(Boolean).join(' · ') : '';
      return <tr key={invoice.id}>
        <td><div className="invoice-cell"><div className="document-icon"><FileText size={16} /></div><div><strong>{invoice.invoice_number}</strong>{invoice.issue && <span className="invoice-issue">{invoice.issue}</span>}</div></div></td>
        <td className="muted-cell">{invoice.purchase_order || '—'}</td><td>{invoice.vendor}</td><td>{formatDate(invoice.invoice_date)}</td>
        <td className="invoice-truncate" title={description}>{description || '—'}</td><td>{hsn || '—'}</td><td>{items.length ? (quantity || items.length) : '—'}</td>
        <td>{unitPrices.length ? unitPrices.map((price) => formatInvoiceAmount(price, invoice.currency_code)).join(', ') : '—'}</td><td><strong>{formatInvoiceAmount(invoice.total, invoice.currency_code)}</strong></td>
        <td className="invoice-bank-cell" title={bankSummary}>{bankSummary || '—'}</td>
        <td>{invoice.document_id && invoice.file_visible ? <button className="invoice-file-button" onClick={() => onDownload?.(invoice)} title={`Download ${invoice.file_name}`}><Download size={14} />{invoice.file_name || 'Download'}</button> : invoice.document_id ? <span className="muted-cell">Private</span> : '—'}</td>
        <td>{canManage ? <select className="invoice-status-select" aria-label={`Status for ${invoice.invoice_number}`} value={invoice.status} onChange={(event) => onStatusChange?.(invoice, event.target.value as Invoice['status'])}>{invoiceStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select> : <StatusBadge status={invoice.status} />}</td>
        <td>{canDelete ? <button className="invoice-delete-button" onClick={() => onDelete?.(invoice)} aria-label={`Delete invoice ${invoice.invoice_number}`} title="Delete invoice"><XCircle size={16} /></button> : <span className="muted-cell">—</span>}</td>
      </tr>;
    })}</tbody></table>
    {noItems && <EmptyState text="No invoices match these filters. Upload an invoice or use manual entry to begin." />}
    {invoices.some((invoice) => invoice.issue) && <div className="table-footnote"><CircleAlert size={14} /> Exception rows require a human review before approval.</div>}
  </div>;
}

function MetricCard({ label, value, note, icon: Icon, tone, trend, down }: { label: string; value: string; note: string; icon: typeof Box; tone: string; trend?: string; down?: boolean }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value-row"><strong>{value}</strong>{trend && <span className={`trend ${down ? 'down' : ''}`}>{down ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{trend}</span>}</div><div className="metric-note">{note}</div></div>; }
function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="mini-stat"><span className={`mini-dot ${tone}`}></span><div><span>{label}</span><strong>{value}</strong></div></div>; }
function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) { return <div className="panel-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <button className="text-button" onClick={onAction}>{action} <ArrowUpRight size={14} /></button>}</div>; }
function PageTitle({ eyebrow, title, copy, action, icon: Icon, onAction }: { eyebrow: string; title: string; copy: string; action?: string; icon?: typeof Plus; onAction?: () => void }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="heading-copy">{copy}</p></div>{action && Icon && <button className="button button-primary" onClick={onAction}><Icon size={17} /> {action}</button>}</div>; }
function StatusBadge({ status }: { status: string }) { const label = status.split('_').join(' '); return <span className={`status-badge ${status.toLowerCase()}`}><span></span>{label.charAt(0) + label.slice(1).toLowerCase()}</span>; }
function PriorityBadge({ priority }: { priority: string }) { return <span className={`priority-badge ${priority.toLowerCase()}`}>{priority}</span>; }
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
  const googleButtonRef = useRef<HTMLDivElement>(null);
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
    if (mode !== 'sign-in' || !GOOGLE_CLIENT_ID || !googleButtonRef.current) return;
    let active = true;
    const renderGoogleButton = () => {
      const google = window.google;
      const container = googleButtonRef.current;
      if (!active || !google || !container) return;
      container.replaceChildren();
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
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
  }, [mode, signInWithGoogle]);
  return <div className="auth-shell"><div className="auth-visual"><div className="auth-brand"><img className="brand-logo auth-logo" src="/images/images.jpeg" alt="Bigbasket" /><div><div className="brand-name">bigbasket</div><div className="brand-subtitle">IT OPERATIONS</div></div></div><div className="auth-visual-copy"><span className="eyebrow">Enterprise asset intelligence</span><h1>Make every asset<br /><em>accountable.</em></h1><p>Control procurement, inventory, service, and spend from one trusted operational record.</p><div className="auth-signal"><span className="signal-dot"></span><span>Secure workspace controls active</span><ShieldCheck size={15} /></div></div></div><div className="auth-panel"><div className="auth-panel-inner"><div className="auth-mobile-brand"><img className="brand-logo auth-logo" src="/images/images.jpeg" alt="Bigbasket" /><div className="brand-name">bigbasket</div></div><span className="eyebrow">{mode === 'sign-in' ? 'Welcome back' : 'Create your workspace account'}</span><h2>{mode === 'sign-in' ? 'Sign in to operations' : 'Start with your team'}</h2><p className="auth-copy">{mode === 'sign-in' ? 'Access your organization’s asset and workflow records.' : 'Your first account becomes the workspace administrator.'}</p><form onSubmit={submit} className="auth-form">{mode === 'sign-up' && <label>Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" /></label>}<label>Work email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@bigbasket.com" /></label><label>Password<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></label>{message && <div className="auth-message" role="alert">{message}</div>}<button className="button button-primary auth-submit" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}{busy ? 'Working...' : mode === 'sign-in' ? 'Sign in securely' : 'Create account'}</button></form>{mode === 'sign-in' && <><div className="auth-divider"><span>or continue with</span></div>{GOOGLE_CLIENT_ID ? <div className="google-signin" ref={googleButtonRef} aria-label="Sign in with Google" /> : <button type="button" className="button button-google" onClick={() => setMessage('Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_ID to the server and frontend environment, then restart the app.')}><svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.9 6.1-15z" /><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9L30.9 34c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44z" /><path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3z" /><path fill="#EA4335" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.8 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3c1.6-4.9 6.1-8.5 11.4-8.5z" /></svg>Login with Google</button>}</>}<button className="auth-switch" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage(''); }}>{mode === 'sign-in' ? 'New to Bigbasket? Create an account' : 'Already have an account? Sign in'}</button><div className="auth-footnote"><ShieldCheck size={14} /> Role-aware access, audit history, and private documents</div></div></div></div>;
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
    <div className="modal-header"><div><p className="eyebrow">AI invoice processing</p><h2 id="invoice-upload-title">Upload Invoice</h2><span className="invoice-modal-subtitle">AI will scan and extract invoice details for your review.</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={busy}><X size={18} /></button></div>
    {extraction ? <div className="extraction-result">
      <div className="ai-result-banner"><Sparkles size={18} /><div><strong>Review extracted details</strong><span>{extraction.confidence}% confidence · Check the fields before adding the invoice</span></div></div>
      <div className="form-grid invoice-review-fields"><label>Invoice number<input required value={draft.invoice_number} onChange={(event) => setDraft({ ...draft, invoice_number: event.target.value })} /></label><label>Vendor name<input required value={draft.vendor} onChange={(event) => setDraft({ ...draft, vendor: event.target.value })} /></label><label>PO number<input value={draft.purchase_order} onChange={(event) => setDraft({ ...draft, purchase_order: event.target.value })} /></label><label>Invoice date<input type="date" value={draft.invoice_date} onChange={(event) => setDraft({ ...draft, invoice_date: event.target.value })} /></label><label>Total amount<input required type="number" min="0" step="0.01" value={draft.total} onChange={(event) => setDraft({ ...draft, total: event.target.value })} /></label><label>Currency<input value={extraction.currency || 'INR'} readOnly /></label></div>
      {extraction.review_reason && <div className="review-warning"><CircleAlert size={16} /><span>{extraction.review_reason}</span></div>}
      <div className="invoice-extraction-details">
        <strong>Line items</strong>{lineItems.length ? <div className="invoice-line-item-list">{lineItems.map((item, index) => <div key={`${item.hsn || 'item'}-${index}`}><span>{item.description || 'Item description not found'}{item.hsn ? ` · HSN ${item.hsn}` : ''}</span><small>{item.quantity ?? '—'} × {item.unit_price === null ? '—' : money.format(item.unit_price)}</small></div>)}</div> : <span className="invoice-detail-empty">No line items were found.</span>}
        <strong>Bank details</strong>{bankDetails && Object.values(bankDetails).some(Boolean) ? <span>{[bankDetails.name, bankDetails.account ? `Account ending ${bankDetails.account.slice(-4)}` : null, bankDetails.ifsc, bankDetails.branch].filter(Boolean).join(' · ')}</span> : <span className="invoice-detail-empty">No bank details found.</span>}
        <strong>Asset details</strong>{assetDetails.length ? <span>{assetDetails.map((asset) => [asset.manufacturer, asset.model, asset.serial_number].filter(Boolean).join(' · ') || 'Asset details incomplete').join('; ')}</span> : <span className="invoice-detail-empty">No asset serial details found.</span>}
      </div>
      {message && <div className="auth-message">{message}</div>}
      <div className="ai-trust-note"><ShieldCheck size={15} /><span>Invoice contents are sent to the configured OpenAI service for extraction. Uploaded documents stay access-controlled in this workspace.</span></div>
      <div className="modal-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button button-primary" disabled={busy} onClick={() => void saveInvoice()}>{busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{busy ? 'Saving...' : 'Add to invoice register'}</button></div>
    </div> : <form onSubmit={submit}>
      <div className="invoice-extract-summary"><strong>AI will automatically scan and extract:</strong><ul><li>Invoice number, PO number, date, currency, and total</li><li>Vendor line items, HSN, quantity, and unit price</li><li>Bank details and asset make, model, and serial number when present</li></ul></div>
      <label className="invoice-pdf-label">Select invoice file<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setMessage(''); }} /></label>
      <span className="invoice-file-hint">{file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : 'PDF, PNG, JPG, or WebP · maximum 10 MB'}</span>
      {message && <div className="auth-message">{message}</div>}
      <div className="ai-trust-note"><ShieldCheck size={15} /><span>Invoice content is sent to the configured OpenAI service. The uploaded file remains private to authorized workspace roles.</span></div>
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!file || busy}>{busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {busy ? 'Upload & scan' : 'Upload & scan'}</button></div>
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
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="modal-card manual-invoice-card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Finance / Payables</p><h2>Manual invoice entry</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={busy}><X size={18} /></button></div><div className="form-grid"><label>Invoice number<input required value={form.invoice_number} onChange={(event) => setForm({ ...form, invoice_number: event.target.value })} /></label><label>PO number<input value={form.purchase_order} onChange={(event) => setForm({ ...form, purchase_order: event.target.value })} /></label><label>Vendor name<input required value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} /></label><label>Invoice date<input required type="date" value={form.invoice_date} onChange={(event) => setForm({ ...form, invoice_date: event.target.value })} /></label><label>Total amount<input required type="number" min="0" step="0.01" value={form.total} onChange={(event) => setForm({ ...form, total: event.target.value })} /></label><label>Currency<input required maxLength={3} value={form.currency_code} onChange={(event) => setForm({ ...form, currency_code: event.target.value.toUpperCase() })} /></label></div>{error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}{busy ? 'Saving...' : 'Add invoice'}</button></div></form></div>;
}

function readAsDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read the selected file. Try opening it and saving a new PDF or image copy.')); reader.readAsDataURL(file); }); }

function AssetModal({ userName, department, onClose, onSaved }: { userName: string; department: string; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ asset_tag: '', category: 'Laptop', manufacturer: '', model: '', serial_number: '', custodian: userName, location: '', department, purchase_cost: '', warranty_end: '' });
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/assets', { ...form, purchase_cost: Number(form.purchase_cost), warranty_end: form.warranty_end || null });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the asset. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Asset register</p><h2>Add new asset</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label>Asset tag<input required value={form.asset_tag} onChange={(event) => update('asset_tag', event.target.value)} placeholder="IT-LAP-0007" /></label><label>Category<select value={form.category} onChange={(event) => update('category', event.target.value)}><option>Laptop</option><option>Monitor</option><option>Mobile</option><option>Network device</option><option>Server</option></select></label><label>Manufacturer<input required value={form.manufacturer} onChange={(event) => update('manufacturer', event.target.value)} placeholder="Dell" /></label><label>Model<input required value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="Latitude 7450" /></label><label>Serial number<input required value={form.serial_number} onChange={(event) => update('serial_number', event.target.value)} placeholder="SN-000000" /></label><label>Department<input required value={form.department} onChange={(event) => update('department', event.target.value)} placeholder="Engineering" /></label><label>Custodian<input required value={form.custodian} onChange={(event) => update('custodian', event.target.value)} placeholder="Asset custodian" /></label><label>Location<input required value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="HQ / Floor 1" /></label><label>Purchase cost<input required type="number" min="0" value={form.purchase_cost} onChange={(event) => update('purchase_cost', event.target.value)} placeholder="0" /></label><label>Warranty end<input type="date" value={form.warranty_end} onChange={(event) => update('warranty_end', event.target.value)} /></label></div>{error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} {saving ? 'Saving...' : 'Add asset'}</button></div></form></div>;
}

const ticketDueLabels: Record<Ticket['priority'], string> = { URGENT: 'Due today', HIGH: 'Due tomorrow', MEDIUM: 'Due in 3 days', LOW: 'Due next week' };

function TicketModal({ userName, onClose, onSaved }: { userName: string; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', category: 'Hardware', priority: 'MEDIUM' as Ticket['priority'], requester: userName, assignee: 'Service Desk' });
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/tickets', { title: form.title, category: form.category, priority: form.priority, assignee: form.assignee, requester: form.requester, due_label: ticketDueLabels[form.priority] });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the ticket. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Service desk</p><h2>Create ticket</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label className="span-2">Title<input required value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="Describe the issue or request" /></label><label>Category<select value={form.category} onChange={(event) => update('category', event.target.value)}><option>Hardware</option><option>Software</option><option>Network</option><option>Access</option><option>Onboarding</option><option>Other</option></select></label><label>Priority<select value={form.priority} onChange={(event) => update('priority', event.target.value)}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label><label>Requester<input required value={form.requester} onChange={(event) => update('requester', event.target.value)} /></label><label>Assignee<input required value={form.assignee} onChange={(event) => update('assignee', event.target.value)} /></label></div>{error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} {saving ? 'Creating...' : 'Create ticket'}</button></div></form></div>;
}

function PurchaseRequestModal({ userName, department, onClose, onSaved }: { userName: string; department: string; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', requester: userName, department, amount: '', needed_by: '' });
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const amount = Number(form.amount);
    if (!form.amount || !Number.isFinite(amount) || amount <= 0) {
      setSaving(false);
      setError('Enter an estimated amount greater than zero.');
      return;
    }
    try {
      await api.post('/api/purchase-requests', { title: form.title, requester: form.requester, department: form.department, amount, needed_by: form.needed_by });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the request. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-card" onSubmit={submit}><div className="modal-header"><div><p className="eyebrow">Procurement</p><h2>New purchase request</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label className="span-2">Title<input required value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="What do you need to purchase?" /></label><label>Requester<input required value={form.requester} onChange={(event) => update('requester', event.target.value)} /></label><label>Department<input required value={form.department} onChange={(event) => update('department', event.target.value)} /></label><label>Estimated amount (₹)<input required type="number" min="1" step="0.01" value={form.amount} onChange={(event) => update('amount', event.target.value)} placeholder="0" /></label><label>Needed by<input required type="date" min={new Date().toISOString().slice(0, 10)} value={form.needed_by} onChange={(event) => update('needed_by', event.target.value)} /></label></div>{error && <div className="auth-message">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} {saving ? 'Submitting...' : 'Submit request'}</button></div></form></div>;
}

export default App;
