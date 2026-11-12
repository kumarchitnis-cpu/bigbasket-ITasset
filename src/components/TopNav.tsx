import { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard,
  Bot,
  FileText,
  Box,
  Users,
  Archive,
  Activity,
  BadgeCheck,
  CircleDollarSign,
  Bell,
  Settings2,
  XCircle,
  ChevronDown,
  Search,
  Sparkles,
  LogOut,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceModule } from '@/lib/types';
import type { AppUser } from '@/lib/api';
import { roleLabel } from '@/lib/format';
import { initials } from '@/lib/format';

type NavGroup = {
  label: string;
  icon: LucideIcon;
  items: { label: WorkspaceModule; icon: LucideIcon; badge?: number }[];
};

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    icon: LayoutDashboard,
    items: [
      { label: 'Dashboard', icon: LayoutDashboard },
      { label: 'AI Assistant', icon: Bot },
      { label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Assets & Operations',
    icon: Box,
    items: [
      { label: 'Assets', icon: Box },
      { label: 'Emp Asset Mgmt', icon: Users },
      { label: 'Inventory', icon: Archive },
      { label: 'Inventory History', icon: Activity },
      { label: 'Warranties', icon: BadgeCheck },
      { label: 'Write-Off', icon: CircleDollarSign },
      { label: 'Server Assets', icon: Box, badge: 0 },
      { label: 'Laptop Assets', icon: Box, badge: 0 },
    ],
  },
  {
    label: 'Finance',
    icon: FileText,
    items: [
      { label: 'Invoices', icon: FileText, badge: 0 },
      { label: 'Procurement', icon: Archive },
    ],
  },
  {
    label: 'Administration',
    icon: Settings2,
    items: [
      { label: 'Notifications', icon: Bell, badge: 0 },
      { label: 'User Management', icon: Users },
      { label: 'Settings', icon: Settings2 },
      { label: 'Deleted', icon: XCircle },
    ],
  },
];

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

type TopNavProps = {
  activeTab: WorkspaceModule;
  onNavigate: (tab: WorkspaceModule) => void;
  user: AppUser;
  canManageUsers: boolean;
  canViewDeleted: boolean;
  unreadNotificationCount: number;
  onToggleMobileNav: () => void;
  mobileNavOpen: boolean;
  onSearch: (query: string) => void;
  onOpenSearch: () => void;
  searchQuery: string;
  searchOpen: boolean;
  onOpenNotifications: () => void;
  onOpenUserMenu: () => void;
  notificationMenuOpen: boolean;
  userMenuOpen: boolean;
  onSignOut: () => void;
};

export function TopNav({
  activeTab,
  onNavigate,
  user,
  canManageUsers,
  canViewDeleted,
  unreadNotificationCount,
  onToggleMobileNav,
  mobileNavOpen,
  onSearch,
  onOpenSearch,
  searchQuery,
  searchOpen,
  onOpenNotifications,
  onOpenUserMenu,
  notificationMenuOpen,
  userMenuOpen,
  onSignOut,
}: TopNavProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      let clickedInside = false;
      Object.values(groupRefs.current).forEach((ref) => {
        if (ref?.contains(target)) clickedInside = true;
      });
      if (!clickedInside) setOpenGroup(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const toggleGroup = (label: string) => {
    setOpenGroup(openGroup === label ? null : label);
  };

  const handleGroupItemClick = (tab: WorkspaceModule) => {
    onNavigate(tab);
    setOpenGroup(null);
  };

  const filteredGroups = navGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.label === 'User Management') return canManageUsers;
      if (item.label === 'Deleted') return canViewDeleted;
      if (item.label === 'Server Assets' || item.label === 'Laptop Assets') return true;
      if (item.label === 'Procurement') return true;
      return true;
    }),
  })).filter((group) => group.items.length > 0);
  const headerGroups = filteredGroups.filter((group) => !['Finance', 'Overview', 'Assets & Operations', 'Administration'].includes(group.label));

  return (
    <>
      <header className="top-nav" role="banner">
        <div className="top-nav-inner">
          <div className="top-nav-brand">
            <img className="brand-logo top-nav-logo" src="/images/images.jpeg" alt="Bigbasket" />
            <div>
              <div className="brand-name top-nav-brand-name">bigbasket</div>
              <div className="brand-subtitle top-nav-brand-subtitle">IT OPERATIONS</div>
            </div>
          </div>

          <button
            type="button"
            className="top-nav-trigger"
            aria-controls="workspace-navigation"
            aria-expanded={mobileNavOpen}
            aria-label={`${mobileNavOpen ? 'Hide' : 'Show'} workspace navigation`}
            onClick={onToggleMobileNav}
          >
            <Menu size={17} aria-hidden="true" />
            <span>Navigation</span>
          </button>

          <nav className="top-nav-menu" aria-label="Main navigation">
            {headerGroups.map((group) => (
              <div key={group.label} className="top-nav-item" ref={(el) => { groupRefs.current[group.label] = el; }}>
                <button
                  type="button"
                  className={`top-nav-dropdown-trigger ${openGroup === group.label ? 'open' : ''}`}
                  aria-haspopup="true"
                  aria-expanded={openGroup === group.label}
                  aria-label={`${group.label} menu`}
                  onClick={() => toggleGroup(group.label)}
                >
                  <group.icon size={17} className="top-nav-dropdown-icon" />
                  <span>{group.label}</span>
                  <ChevronDown className={`top-nav-chevron ${openGroup === group.label ? 'open' : ''}`} size={13} />
                </button>
                {openGroup === group.label && (
                  <div className="top-nav-dropdown" role="menu">
                    <div className="top-nav-dropdown-inner">
                      <div className="top-nav-group">
                        <div className="top-nav-group-label">{group.label}</div>
                        <div className="top-nav-grid">
                          {group.items.map((item) => {
                            const isActive = activeTab === item.label;
                            return (
                              <button
                                key={item.label}
                                type="button"
                                role="menuitem"
                                aria-selected={isActive}
                                className={`top-nav-option ${isActive ? 'active' : ''}`}
                                onClick={() => handleGroupItemClick(item.label)}
                              >
                                <span className="top-nav-option-icon">
                                  <item.icon size={15} />
                                </span>
                                <span className="top-nav-option-label">{navLabels[item.label]}</span>
                                {item.badge !== undefined && item.badge > 0 && (
                                  <span className="top-nav-option-badge">{item.badge}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </nav>

          <div className="top-nav-actions">
            <div className="global-search-wrap" ref={searchInputRef}>
              <div className={`global-search ${searchOpen ? 'search-active' : ''}`}>
                <button type="button" className="search-trigger" aria-label="Open workspace search" onClick={onOpenSearch}>
                  <Search size={17} />
                </button>
                {activeTab !== 'Dashboard' && (
                  <button type="button" className="search-trigger ai-trigger" aria-label="Open AI assistant" onClick={() => onNavigate('AI Assistant')}>
                    <Sparkles size={15} />
                  </button>
                )}
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onFocus={onOpenSearch}
                  onChange={(event) => onSearch(event.target.value)}
                  placeholder="Search assets, invoices…"
                  aria-label="Search workspace"
                  aria-expanded={searchOpen}
                />
                <kbd>Ctrl K</kbd>
                {searchQuery && (
                  <button className="search-clear" aria-label="Clear search" onClick={() => { onSearch(''); onOpenSearch(); searchInputRef.current?.focus(); }}>
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              aria-expanded={notificationMenuOpen}
              aria-haspopup="true"
              onClick={onOpenNotifications}
            >
              <Bell size={19} />
              {unreadNotificationCount > 0 && <span />}
            </button>

            <div className="user-menu-wrap">
              <button
                className="user-menu-trigger"
                aria-label={`User menu for ${user.full_name}`}
                aria-expanded={userMenuOpen}
                onClick={onOpenUserMenu}
              >
                <span className="avatar avatar-light">{initials(user.full_name)}</span>
                <ChevronDown size={13} />
              </button>
              {userMenuOpen && (
                <div className="user-menu-popover" role="dialog" aria-label="User menu">
                  <div className="user-menu-heading">
                    <strong>{user.full_name}</strong>
                    <span>{user.email}</span>
                    <small>{roleLabel(user.role)}</small>
                  </div>
                  <button onClick={() => { onOpenUserMenu(); onNavigate('Settings'); }}>
                    <Settings2 size={15} /> Account settings
                  </button>
                  {canManageUsers && (
                    <button onClick={() => { onOpenUserMenu(); onNavigate('User Management'); }}>
                      <Users size={15} /> User management
                    </button>
                  )}
                  <button className="user-menu-signout" onClick={onSignOut}>
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <aside id="workspace-navigation" className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`} aria-label="Workspace navigation">
        <button className="sidebar-close" onClick={onToggleMobileNav} aria-label="Close navigation menu">
          <X size={18} />
        </button>
        <div className="sidebar-brand">
          <img className="brand-logo" src="/images/images.jpeg" alt="Bigbasket" />
          <div>
            <div className="brand-name">bigbasket</div>
            <div className="brand-subtitle">IT OPERATIONS</div>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Mobile navigation">
          {filteredGroups.map((group) => (
            <section className="nav-group" key={group.label}>
              <div className="nav-section-label">{group.label}</div>
              <div className="main-nav sidebar-nav">
                {group.items.map(({ label, icon: Icon, badge }) => (
                  <button
                    key={label}
                    className={`nav-item ${activeTab === label ? 'active' : ''}`}
                    aria-current={activeTab === label ? 'page' : undefined}
                    onClick={() => { handleGroupItemClick(label); }}
                  >
                    <Icon size={18} />
                    <span>{navLabels[label]}</span>
                    {badge !== undefined && badge > 0 && (
                      <span className="nav-count">{badge}</span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-row">
            <div className="avatar avatar-dark">{initials(user.full_name)}</div>
            <div className="profile-copy">
              <strong>{user.full_name}</strong>
              <span>{roleLabel(user.role)}</span>
            </div>
            <button className="more-dots" aria-label="Sign out" onClick={onSignOut}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {mobileNavOpen && <button className="navigation-backdrop" aria-label="Close navigation menu" onClick={onToggleMobileNav} />}
    </>
  );
}