import { Menu } from 'lucide-react';

type TopNavProps = {
  navigationExpanded: boolean;
  onToggleNavigation: () => void;
};

export function TopNav({ navigationExpanded, onToggleNavigation }: TopNavProps) {
  return (
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
          aria-expanded={navigationExpanded}
          aria-label={`${navigationExpanded ? 'Hide' : 'Show'} workspace navigation`}
          onClick={onToggleNavigation}
        >
          <Menu size={17} aria-hidden="true" />
          <span>Navigation</span>
        </button>
      </div>
    </header>
  );
}
