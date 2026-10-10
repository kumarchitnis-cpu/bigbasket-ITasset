import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Box,
  BriefcaseBusiness,
  CalendarClock,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  CreditCard,
  FileCheck2,
  FileText,
  Laptop,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  LogOut,
  Menu,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Ticket,
  X,
} from 'lucide-react';
import { ApiError, api, auth, setOnUnauthorized, supabase, type AppDocument, type AppUser } from '@/lib/api';

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
};

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

type Tab = 'Overview' | 'Assets' | 'Procurement' | 'Invoices' | 'Service desk';

const navItems: { label: Tab; icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Assets', icon: Box },
  { label: 'Procurement', icon: ClipboardList },
  { label: 'Invoices', icon: FileText },
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    setOnUnauthorized(() => {
      setUser(null);
    });

    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        void auth.me().then(setUser).catch(() => null).finally(() => setAuthLoading(false));
      } else {
        setAuthLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession: Session | null) => {
      if (!mounted) return;
      if (nextSession) {
        void auth.me().then(setUser).catch(() => null).finally(() => setAuthLoading(false));
      } else {
        setUser(null);
        setAuthLoading(false);
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [assetData, invoiceData, ticketData, requestData] = await Promise.all([
        api.getAssets(),
        api.getInvoices(),
        api.getTickets(),
        api.getPurchaseRequests(),
      ]);
      setAssets(assetData as Asset[]);
      setInvoices(invoiceData as Invoice[]);
      setTickets(ticketData as Ticket[]);
      setPurchaseRequests(requestData as PurchaseRequest[]);
    } catch {
      setError('We could not load the workspace data. Please try again.');
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    if (user) void loadData();
  }, [user]);

  const filteredAssets = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return assets;
    return assets.filter((asset) => [asset.asset_tag, asset.category, asset.model, asset.custodian, asset.department].some((value) => value.toLowerCase().includes(normalized)));
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
      approvals: purchaseRequests.filter((request) => request.status === 'PENDING_APPROVAL').length,
      openTickets: tickets.filter((ticket) => ticket.status !== 'RESOLVED').length,
      invoiceExceptions: invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD').length,
    };
  }, [assets, invoices, purchaseRequests, tickets]);

  const showTab = (tab: Tab) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  const signOut = () => {
    void auth.signOut();
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
        <nav className="main-nav">{navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activeTab === label ? 'active' : ''}`} onClick={() => showTab(label)}><Icon size={18} /><span>{label}</span>{label === 'Invoices' && metrics.invoiceExceptions > 0 && <span className="nav-count">{metrics.invoiceExceptions}</span>}</button>)}</nav>
        <div className="nav-section-label">Manage</div>
        <nav className="main-nav"><button className="nav-item"><ShieldCheck size={18} /><span>Access & security</span></button><button className="nav-item"><Activity size={18} /><span>Audit log</span></button><button className="nav-item"><Settings2 size={18} /><span>Settings</span></button></nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Sparkles size={16} /></div><strong>Need a hand?</strong><span>View the operations guide</span><button>Open guide <ArrowUpRight size={13} /></button></div><div className="profile-row"><div className="avatar avatar-dark">{initials(user.full_name)}</div><div className="profile-copy"><strong>{user.full_name}</strong><span>{roleLabel(user.role)}</span></div><button className="more-dots" aria-label="Sign out" onClick={signOut}><LogOut size={15} /></button></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={21} /></button><div className="breadcrumbs"><span>Operations</span><span className="crumb-divider">/</span><strong>{activeTab}</strong></div><div className="topbar-actions"><div className="global-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets, people, tickets..." /><kbd>⌘ K</kbd></div><button className="icon-button notification-button" aria-label="Notifications"><Bell size={19} /><span></span></button><div className="avatar avatar-light">{initials(user.full_name)}</div></div></header>

        <div className="page-content">
          {loading ? <LoadingState /> : error ? <ErrorState onRetry={() => void loadData()} /> : <>
            {activeTab === 'Overview' && <Overview assets={assets} invoices={invoices} metrics={metrics} userName={user.full_name} onOpenAssets={() => showTab('Assets')} onOpenInvoices={() => showTab('Invoices')} onOpenProcurement={() => showTab('Procurement')} onOpenServiceDesk={() => showTab('Service desk')} />}
            {activeTab === 'Assets' && <AssetsView assets={filteredAssets} onAdd={() => setAssetModalOpen(true)} query={query} />}
            {activeTab === 'Procurement' && <ProcurementView requests={purchaseRequests} userName={user.full_name} department={user.department} onSaved={() => void loadData(true)} />}
            {activeTab === 'Invoices' && <InvoicesView invoices={invoices} />}
            {activeTab === 'Service desk' && <ServiceDeskView tickets={tickets} userName={user.full_name} onSaved={() => void loadData(true)} />}
          </>}
        </div>
      </main>
      {assetModalOpen && <AssetModal userName={user.full_name} department={user.department} onClose={() => setAssetModalOpen(false)} onSaved={() => { setAssetModalOpen(false); void loadData(true); }} />}
      {refreshing && <div className="refresh-indicator"><Loader2 size={15} className="spin" /> Updating workspace</div>}
    </div>
  );
}

function Overview({ assets, invoices, metrics, userName, onOpenAssets, onOpenInvoices, onOpenProcurement, onOpenServiceDesk }: { assets: Asset[]; invoices: Invoice[]; metrics: Record<string, number>; userName: string; onOpenAssets: () => void; onOpenInvoices: () => void; onOpenProcurement: () => void; onOpenServiceDesk: () => void }) {
  const now = new Date();
  const todayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = userName.trim().split(' ')[0] || userName;
  const categoryCount = new Set(assets.map((asset) => asset.category)).size;
  const total = Math.max(metrics.total, 1);
  const assignedPct = (metrics.active / total) * 100;
  const availablePct = (metrics.available / total) * 100;
  const maintenancePct = (metrics.maintenance / total) * 100;
  const donutStyle = { background: `conic-gradient(#163e5a 0% ${assignedPct}%, #4b9b93 ${assignedPct}% ${assignedPct + availablePct}%, #e6aa4b ${assignedPct + availablePct}% ${assignedPct + availablePct + maintenancePct}%, #dfe7ea ${assignedPct + availablePct + maintenancePct}% 100%)` };
  const suggestion = useMemo(() => {
    const exception = invoices.find((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD');
    if (exception) return `Review the ${exception.vendor} invoice ${exception.invoice_number} before the next payment run.`;
    if (metrics.approvals > 0) return `${metrics.approvals} purchase request${metrics.approvals === 1 ? '' : 's'} waiting for approval in the procurement queue.`;
    if (metrics.openTickets > 0) return `${metrics.openTickets} open service ticket${metrics.openTickets === 1 ? '' : 's'} — clear urgent and high priority items first.`;
    return 'All operational queues are clear. Register new assets as they arrive.';
  }, [invoices, metrics]);
  return <div className="fade-in"><div className="page-heading"><div><p className="eyebrow">{todayLabel} <span className="live-dot"></span> Live workspace</p><h1>{greeting}, {firstName}</h1><p className="heading-copy">Here is what needs your attention across the operation today.</p></div><div className="heading-actions"><button className="button button-secondary"><CalendarClock size={16} /> This week <ChevronDown size={14} /></button><button className="button button-primary" onClick={onOpenAssets}><Plus size={17} /> Add asset</button></div></div>
    <div className="metric-grid"><MetricCard label="Total assets" value={metrics.total.toString()} note={`Across ${categoryCount} ${categoryCount === 1 ? 'category' : 'categories'}`} icon={Box} tone="blue" /><MetricCard label="Active / in use" value={metrics.active.toString()} note={`${Math.round((metrics.active / total) * 100)}% utilization`} icon={BriefcaseBusiness} tone="teal" /><MetricCard label="Available stock" value={metrics.available.toString()} note="Ready to assign" icon={PackageCheck} tone="amber" /><MetricCard label="Open exceptions" value={(metrics.invoiceExceptions + metrics.maintenance).toString()} note={`${metrics.invoiceExceptions} invoice · ${metrics.maintenance} maintenance`} icon={CircleAlert} tone="red" /></div>
    <div className="dashboard-grid"><section className="panel asset-panel"><PanelHeader title="Asset portfolio" action="View asset register" onAction={onOpenAssets} /><div className="portfolio-content"><div className="donut-wrap"><div className="donut" style={donutStyle}><div className="donut-hole"><strong>{metrics.total}</strong><span>Total</span></div></div></div><div className="legend-list"><LegendRow color="navy" label="Assigned / in use" value={metrics.active} total={metrics.total} /><LegendRow color="teal" label="Available stock" value={metrics.available} total={metrics.total} /><LegendRow color="amber" label="Under maintenance" value={metrics.maintenance} total={metrics.total} /><LegendRow color="gray" label="Other" value={metrics.total - metrics.active - metrics.available - metrics.maintenance} total={metrics.total} /></div></div><div className="portfolio-footer"><div><span className="footer-label">Portfolio value</span><strong>{compactMoney.format(assets.reduce((sum, asset) => sum + Number(asset.purchase_cost), 0))}</strong></div><div className="footer-divider"></div><div><span className="footer-label">Warranty attention</span><strong className="warning-text">{metrics.warranty} assets <ArrowUpRight size={14} /></strong></div></div></section>
      <section className="panel attention-panel"><PanelHeader title="Needs attention" action="View all" onAction={onOpenInvoices} /><div className="attention-list"><AttentionRow icon={FileCheck2} tone="amber" title={`${metrics.approvals} purchase request${metrics.approvals === 1 ? '' : 's'} awaiting approval`} detail="Approval queue · Procurement" action="Review" onAction={onOpenProcurement} /><AttentionRow icon={CreditCard} tone="red" title={`${metrics.invoiceExceptions} invoice exception${metrics.invoiceExceptions === 1 ? '' : 's'}`} detail="AI validation · Finance" action="Resolve" onAction={onOpenInvoices} /><AttentionRow icon={Ticket} tone="blue" title={`${metrics.openTickets} open service tickets`} detail="Service desk · SLA watch" action="Open desk" onAction={onOpenServiceDesk} /></div><div className="attention-tip"><Sparkles size={16} /><span><strong>Smart suggestion</strong> — {suggestion}</span></div></section></div>
    <div className="dashboard-grid lower-grid"><section className="panel table-panel"><PanelHeader title="Recent assets" subtitle="Latest register activity" action="See register" onAction={onOpenAssets} /><AssetTable assets={assets.slice(0, 5)} compact /></section><section className="panel table-panel"><PanelHeader title="Invoice queue" subtitle="AI processing and exceptions" action="Open invoices" onAction={onOpenInvoices} /><InvoiceTable invoices={invoices.slice(0, 4)} compact /></section></div>
  </div>;
}

function AssetsView({ assets, onAdd, query }: { assets: Asset[]; onAdd: () => void; query: string }) {
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ASSIGNED' | 'AVAILABLE' | 'UNDER_MAINTENANCE'>('ALL');
  const counts = useMemo(() => ({
    ALL: assets.length,
    ASSIGNED: assets.filter((asset) => asset.status === 'ASSIGNED').length,
    AVAILABLE: assets.filter((asset) => asset.status === 'AVAILABLE').length,
    UNDER_MAINTENANCE: assets.filter((asset) => asset.status === 'UNDER_MAINTENANCE').length,
  }), [assets]);
  const visibleAssets = statusFilter === 'ALL' ? assets : assets.filter((asset) => asset.status === statusFilter);
  const pills: { key: typeof statusFilter; label: string }[] = [
    { key: 'ALL', label: 'All assets' },
    { key: 'ASSIGNED', label: 'Assigned' },
    { key: 'AVAILABLE', label: 'Available' },
    { key: 'UNDER_MAINTENANCE', label: 'Maintenance' },
  ];
  return <div className="fade-in"><div className="page-heading"><div><p className="eyebrow">Asset lifecycle <span className="eyebrow-separator">/</span> Register</p><h1>Asset register</h1><p className="heading-copy">Every device, assignment, and lifecycle event in one place.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add asset</button></div><div className="subnav-row"><div className="tab-pills">{pills.map(({ key, label }) => <button key={key} className={statusFilter === key ? 'selected' : ''} onClick={() => setStatusFilter(key)}>{label} <span>{counts[key]}</span></button>)}</div><button className="button button-secondary"><Settings2 size={16} /> Customize</button></div>{query && <div className="filter-note"><Search size={14} /> Showing matches for “{query}”</div>}<section className="panel table-panel full-panel"><AssetTable assets={visibleAssets} /></section></div>;
}

function ProcurementView({ requests, userName, department, onSaved }: { requests: PurchaseRequest[]; userName: string; department: string; onSaved: () => void }) {
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const approvedThisMonth = requests.filter((request) => (request.status === 'APPROVED' || request.status === 'ORDERED') && request.created_at && request.created_at.slice(0, 7) === monthPrefix).length;
  return <div className="fade-in"><PageTitle eyebrow="Procurement / Requests" title="Purchase requests" copy="Move requests from need to approved purchase order with a clear audit trail." action="New request" icon={Plus} onAction={() => setRequestModalOpen(true)} /><div className="stat-strip"><MiniStat label="Pending approval" value={requests.filter((request) => request.status === 'PENDING_APPROVAL').length.toString()} tone="amber" /><MiniStat label="Approved this month" value={approvedThisMonth.toString()} tone="teal" /><MiniStat label="Committed spend" value={compactMoney.format(requests.reduce((sum, request) => sum + Number(request.amount), 0))} tone="blue" /></div><section className="panel table-panel full-panel"><PanelHeader title="Request pipeline" subtitle="Latest purchase requests and approvals" action="Export" /><div className="request-list">{requests.map((request) => <div className="request-row" key={request.id}><div className="request-icon"><ClipboardList size={17} /></div><div className="request-main"><strong>{request.title}</strong><span>{request.request_number} · {request.requester} · {request.department}</span></div><div className="request-amount">{money.format(request.amount)}</div><StatusBadge status={request.status} /><div className="request-date"><span>Needed by</span><strong>{formatDate(request.needed_by)}</strong></div><button className="row-more">•••</button></div>)}</div>{requests.length === 0 && <EmptyState text="No purchase requests yet. Create the first request to get started." />}</section>{requestModalOpen && <PurchaseRequestModal userName={userName} department={department} onClose={() => setRequestModalOpen(false)} onSaved={() => { setRequestModalOpen(false); onSaved(); }} />}</div>;
}

function InvoicesView({ invoices }: { invoices: Invoice[] }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  return <div className="fade-in"><div className="page-heading"><div><p className="eyebrow">Finance / AI processing</p><h1>Invoice queue</h1><p className="heading-copy">Review extracted values, exceptions, and three-way matching before payment.</p></div><button className="button button-primary" onClick={() => setUploadOpen(true)}><Plus size={17} /> Upload invoice</button></div><div className="stat-strip"><MiniStat label="In queue" value={invoices.filter((invoice) => invoice.status !== 'PROCESSED').length.toString()} tone="amber" /><MiniStat label="Needs review" value={invoices.filter((invoice) => invoice.status === 'UNDER_REVIEW' || invoice.status === 'ON_HOLD').length.toString()} tone="red" /><MiniStat label="Processed spend" value={compactMoney.format(invoices.filter((invoice) => invoice.status === 'PROCESSED').reduce((sum, invoice) => sum + Number(invoice.total), 0))} tone="teal" /></div><section className="panel table-panel full-panel"><InvoiceTable invoices={invoices} /></section>{uploadOpen && <InvoiceUploadModal onClose={() => setUploadOpen(false)} />}</div>;
}

function ServiceDeskView({ tickets, userName, onSaved }: { tickets: Ticket[]; userName: string; onSaved: () => void }) {
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  return <div className="fade-in"><PageTitle eyebrow="Operations / Support" title="Service desk" copy="Keep requests, incidents, and SLA commitments moving forward." action="Create ticket" icon={Plus} onAction={() => setTicketModalOpen(true)} /><div className="stat-strip"><MiniStat label="Open tickets" value={tickets.filter((ticket) => ticket.status === 'OPEN').length.toString()} tone="blue" /><MiniStat label="SLA at risk" value={tickets.filter((ticket) => ticket.priority === 'URGENT' || ticket.priority === 'HIGH').length.toString()} tone="red" /><MiniStat label="Resolved" value={tickets.filter((ticket) => ticket.status === 'RESOLVED').length.toString()} tone="teal" /></div><section className="panel table-panel full-panel"><PanelHeader title="Active work" subtitle="Incidents and requests assigned to your team" action="Filter" /><div className="ticket-list">{tickets.map((ticket) => <div className="ticket-row" key={ticket.id}><div className={`priority-bar ${ticket.priority.toLowerCase()}`}></div><div className="ticket-main"><div><span className="ticket-number">{ticket.ticket_number}</span><strong>{ticket.title}</strong></div><span>{ticket.category} · Requested by {ticket.requester}</span></div><PriorityBadge priority={ticket.priority} /><StatusBadge status={ticket.status} /><div className="ticket-assignee"><div className="avatar avatar-small">{initials(ticket.assignee)}</div><span>{ticket.assignee}</span></div><div className="ticket-due"><span>{ticket.status === 'RESOLVED' ? 'Completed' : 'SLA'}</span><strong>{ticket.due_label}</strong></div></div>)}</div>{tickets.length === 0 && <EmptyState text="No tickets in the queue. Create a ticket to report an issue or request." />}</section>{ticketModalOpen && <TicketModal userName={userName} onClose={() => setTicketModalOpen(false)} onSaved={() => { setTicketModalOpen(false); onSaved(); }} />}</div>;
}

function AssetTable({ assets, compact = false }: { assets: Asset[]; compact?: boolean }) { return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Asset</th><th>Category</th><th>Custodian</th><th>Location</th><th>Status</th>{!compact && <th>Warranty</th>}<th></th></tr></thead><tbody>{assets.map((asset) => <tr key={asset.id}><td><div className="asset-cell"><div className={`asset-type-icon ${asset.category.toLowerCase().replace(' ', '-')}`}><Laptop size={16} /></div><div><strong>{asset.asset_tag}</strong><span>{asset.manufacturer} {asset.model}</span></div></div></td><td>{asset.category}</td><td><div className="person-cell"><div className="avatar avatar-small">{initials(asset.custodian)}</div><span>{asset.custodian}</span></div></td><td>{asset.location}</td><td><StatusBadge status={asset.status} /></td>{!compact && <td>{asset.warranty_end ? formatDate(asset.warranty_end) : '—'}</td>}<td><button className="row-more">•••</button></td></tr>)}</tbody></table>{assets.length === 0 && <EmptyState text="No assets match this search." />}</div>; }

function InvoiceTable({ invoices, compact = false }: { invoices: Invoice[]; compact?: boolean }) { return <div className="data-table-wrap"><table className="data-table invoice-table"><thead><tr><th>Invoice</th><th>Vendor</th><th>PO reference</th><th>Total</th><th>AI confidence</th><th>Status</th><th></th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><div className="invoice-cell"><div className="document-icon"><FileText size={16} /></div><div><strong>{invoice.invoice_number}</strong><span>{formatDate(invoice.invoice_date)}</span></div></div></td><td>{invoice.vendor}</td><td className="muted-cell">{invoice.purchase_order}</td><td><strong>{money.format(invoice.total)}</strong></td><td><div className="confidence"><div className="confidence-track"><span style={{ width: `${invoice.confidence}%` }}></span></div><span>{invoice.confidence}%</span></div></td><td><StatusBadge status={invoice.status} /></td><td><button className="row-more">•••</button></td></tr>)}</tbody></table>{invoices.length === 0 && <EmptyState text="No invoices in the queue. Upload an invoice to start AI review." />}{!compact && invoices.some((invoice) => invoice.issue) && <div className="table-footnote"><CircleAlert size={14} /> Exception rows require a human review before approval.</div>}</div>; }

function MetricCard({ label, value, note, icon: Icon, tone, trend, down }: { label: string; value: string; note: string; icon: typeof Box; tone: string; trend?: string; down?: boolean }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value-row"><strong>{value}</strong>{trend && <span className={`trend ${down ? 'down' : ''}`}>{down ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{trend}</span>}</div><div className="metric-note">{note}</div></div>; }
function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="mini-stat"><span className={`mini-dot ${tone}`}></span><div><span>{label}</span><strong>{value}</strong></div></div>; }
function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) { return <div className="panel-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <button className="text-button" onClick={onAction}>{action} <ArrowUpRight size={14} /></button>}</div>; }
function PageTitle({ eyebrow, title, copy, action, icon: Icon, onAction }: { eyebrow: string; title: string; copy: string; action: string; icon: typeof Plus; onAction?: () => void }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="heading-copy">{copy}</p></div><button className="button button-primary" onClick={onAction}><Icon size={17} /> {action}</button></div>; }
function LegendRow({ color, label, value, total }: { color: string; label: string; value: number; total: number }) { return <div className="legend-row"><span className={`legend-dot ${color}`}></span><span className="legend-label">{label}</span><strong>{value}</strong><span className="legend-percent">{total ? Math.round((value / total) * 100) : 0}%</span></div>; }
function AttentionRow({ icon: Icon, tone, title, detail, action, onAction }: { icon: typeof FileText; tone: string; title: string; detail: string; action: string; onAction?: () => void }) { return <div className="attention-row"><div className={`attention-icon ${tone}`}><Icon size={17} /></div><div className="attention-copy"><strong>{title}</strong><span>{detail}</span></div><button className="small-button" onClick={onAction}>{action}</button></div>; }
function StatusBadge({ status }: { status: string }) { const label = status.split('_').join(' '); return <span className={`status-badge ${status.toLowerCase()}`}><span></span>{label.charAt(0) + label.slice(1).toLowerCase()}</span>; }
function PriorityBadge({ priority }: { priority: string }) { return <span className={`priority-badge ${priority.toLowerCase()}`}>{priority}</span>; }
function LoadingState() { return <div className="state-card"><Loader2 size={23} className="spin" /><strong>Loading your workspace</strong><span>Gathering the latest operational data...</span></div>; }
function ErrorState({ onRetry }: { onRetry: () => void }) { return <div className="state-card error-state"><CircleAlert size={25} /><strong>Workspace unavailable</strong><span>We could not retrieve the latest records.</span><button className="button button-primary" onClick={onRetry}><RefreshCw size={16} /> Try again</button></div>; }
function EmptyState({ text }: { text: string }) { return <div className="empty-state"><Tag size={18} /><span>{text}</span></div>; }
function initials(value: string) { return value.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)); }

function roleLabel(role: string) { return role.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }

function AuthLoading() { return <div className="auth-shell"><div className="auth-loading"><Loader2 size={24} className="spin" /><span>Preparing your secure workspace</span></div></div>; }

function AuthScreen({ onAuth }: { onAuth: (user: AppUser) => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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
  return <div className="auth-shell"><div className="auth-visual"><div className="auth-brand"><img className="brand-logo auth-logo" src="/images/images.jpeg" alt="Bigbasket" /><div><div className="brand-name">bigbasket</div><div className="brand-subtitle">IT OPERATIONS</div></div></div><div className="auth-visual-copy"><span className="eyebrow">Enterprise asset intelligence</span><h1>Make every asset<br /><em>accountable.</em></h1><p>Control procurement, inventory, service, and spend from one trusted operational record.</p><div className="auth-signal"><span className="signal-dot"></span><span>Secure workspace controls active</span><ShieldCheck size={15} /></div></div></div><div className="auth-panel"><div className="auth-panel-inner"><div className="auth-mobile-brand"><img className="brand-logo auth-logo" src="/images/images.jpeg" alt="Bigbasket" /><div className="brand-name">bigbasket</div></div><span className="eyebrow">{mode === 'sign-in' ? 'Welcome back' : 'Create your workspace account'}</span><h2>{mode === 'sign-in' ? 'Sign in to operations' : 'Start with your team'}</h2><p className="auth-copy">{mode === 'sign-in' ? 'Access your organization’s asset and workflow records.' : 'Your first account becomes the workspace administrator.'}</p><form onSubmit={submit} className="auth-form">{mode === 'sign-up' && <label>Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" /></label>}<label>Work email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@bigbasket.com" /></label><label>Password<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></label>{message && <div className="auth-message">{message}</div>}<button className="button button-primary auth-submit" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}{busy ? 'Working...' : mode === 'sign-in' ? 'Sign in securely' : 'Create account'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage(''); }}>{mode === 'sign-in' ? 'New to Bigbasket? Create an account' : 'Already have an account? Sign in'}</button><div className="auth-footnote"><ShieldCheck size={14} /> Role-aware access, audit history, and private documents</div></div></div></div>;
}

type InvoiceExtraction = {
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
};

function InvoiceUploadModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [extraction, setExtraction] = useState<InvoiceExtraction | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setMessage('');
    let documentId: string | null = null;
    try {
      const dataUrl = await readAsDataUrl(file);
      const document = await api.uploadDocument(file, 'INVOICE');
      documentId = document.id;
      const result = await api.processInvoice(dataUrl, file.name, documentId);
      setExtraction(result.extraction as InvoiceExtraction);
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'We could not process this document. Check the file and try again.';
      setMessage(errorMessage);
      if (documentId) {
        try {
          await api.updateDocument(documentId, { extraction_status: 'FAILED', review_reason: errorMessage });
        } catch {
          // Document status update is best-effort.
        }
      }
    } finally {
      setBusy(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card invoice-upload-card"><div className="modal-header"><div><p className="eyebrow">AI invoice review</p><h2>Upload and extract</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{extraction ? <div className="extraction-result"><div className="ai-result-banner"><Sparkles size={18} /><div><strong>Review complete</strong><span>{extraction.confidence}% confidence · Human approval still required</span></div></div><div className="extraction-grid"><ExtractionField label="Invoice number" value={extraction.invoice_number} /><ExtractionField label="Vendor" value={extraction.vendor} /><ExtractionField label="Purchase order" value={extraction.purchase_order} /><ExtractionField label="Invoice date" value={extraction.invoice_date} /><ExtractionField label="Currency" value={extraction.currency} /><ExtractionField label="Total" value={extraction.total === null ? null : money.format(extraction.total)} /></div>{extraction.review_reason && <div className="review-warning"><CircleAlert size={16} /><span>{extraction.review_reason}</span></div>}<div className="modal-actions"><button className="button button-primary" onClick={onClose}>Done</button></div></div> : <form onSubmit={submit}><label className="upload-drop"><FileText size={27} /><strong>{file ? file.name : 'Choose an invoice document'}</strong><span>{file ? `${Math.round(file.size / 1024)} KB ready for review` : 'PDF, PNG, JPG, or WebP · up to 10 MB'}</span><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>{message && <div className="auth-message">{message}</div>}<div className="ai-trust-note"><ShieldCheck size={15} /><span>Files stay private. AI suggestions are stored with confidence and routed to review when needed.</span></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!file || busy}>{busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {busy ? 'Reviewing...' : 'Review with AI'}</button></div></form>}</div></div>;
}

function ExtractionField({ label, value }: { label: string; value: string | number | null }) { return <div className="extraction-field"><span>{label}</span><strong>{value ?? 'Not found'}</strong></div>; }

function readAsDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read file')); reader.readAsDataURL(file); }); }

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
      await api.createAsset({ ...form, purchase_cost: Number(form.purchase_cost), warranty_end: form.warranty_end || null });
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
      await api.createTicket({ title: form.title, category: form.category, priority: form.priority, assignee: form.assignee, requester: form.requester, due_label: ticketDueLabels[form.priority] });
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
      await api.createPurchaseRequest({ title: form.title, requester: form.requester, department: form.department, amount, needed_by: form.needed_by });
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
