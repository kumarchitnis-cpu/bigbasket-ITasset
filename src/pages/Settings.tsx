import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Bell,
  Building2,
  CircleAlert,
  ClipboardCheck,
  Loader2,
  Mail,
  Palette,
  RefreshCw,
  Send,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { ApiError, api, type AppUser, type WorkspaceSettings } from '@/lib/api';
import { roleLabel } from '@/lib/format';
import { Banner, InlineError, InlineSuccess, LoadingState, PageTitle, PanelHeader, SegmentedTabs } from '@/components/ui';

type SettingsSection = 'Company' | 'Branding' | 'Approvals' | 'Notifications' | 'AP Escalation' | 'SLA' | 'Email Settings' | 'ManageEngine';

type StringSetting = { [K in keyof WorkspaceSettings]: WorkspaceSettings[K] extends string ? K : never }[keyof WorkspaceSettings];
type NumberSetting = { [K in keyof WorkspaceSettings]: WorkspaceSettings[K] extends number ? K : never }[keyof WorkspaceSettings];
type BooleanSetting = { [K in keyof WorkspaceSettings]: WorkspaceSettings[K] extends boolean ? K : never }[keyof WorkspaceSettings];

const settingsSections: { label: SettingsSection; icon: LucideIcon }[] = [
  { label: 'Company', icon: Building2 },
  { label: 'Branding', icon: Palette },
  { label: 'Approvals', icon: ClipboardCheck },
  { label: 'Notifications', icon: Bell },
  { label: 'AP Escalation', icon: CircleAlert },
  { label: 'SLA', icon: ShieldCheck },
  { label: 'Email Settings', icon: Mail },
  { label: 'ManageEngine', icon: RefreshCw },
];

const adminOnlySections: SettingsSection[] = ['ManageEngine', 'Email Settings'];

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

export function SettingsView({ user, onSaved }: { user: AppUser; onSaved: (user: AppUser) => void }) {
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
    api
      .get<ManageEngineStatus>('/api/integrations/manageengine')
      .then(setManageEngineStatus)
      .catch((err: unknown) => setManageEngineError(err instanceof ApiError ? err.message : 'Could not load ManageEngine integration status.'));
  }, [section]);

  useEffect(() => {
    if (section !== 'Email Settings') return;
    setGmailError(null);
    api
      .get<GmailStatus>('/api/integrations/gmail')
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
    setSettings((current) => (current ? { ...current, [key]: value } : current));
    setMessage(null);
    setError(null);
  };

  const submitSettings = async (event: React.FormEvent<HTMLFormElement>) => {
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

  const submitProfile = async (event: React.FormEvent<HTMLFormElement>) => {
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

  if (loadingSettings) return <LoadingState label="Loading workspace settings" />;
  if (!settings) {
    return (
      <div className="state-card error-state">
        <CircleAlert size={25} />
        <strong>Settings unavailable</strong>
        <span>{error || 'We could not retrieve workspace settings.'}</span>
        <button className="button button-primary" onClick={() => void loadSettings()}>
          <RefreshCw size={16} /> Try again
        </button>
      </div>
    );
  }

  const textInput = (label: string, key: StringSetting, type = 'text', required = false) => (
    <label key={key}>
      {label}
      <input type={type} required={required} disabled={!isAdmin} value={settings[key]} onChange={(event) => updateSetting(key, event.target.value)} />
    </label>
  );

  const numberInput = (label: string, key: NumberSetting, min = 0, max?: number) => (
    <label key={key}>
      {label}
      <input type="number" min={min} max={max} step="1" required disabled={!isAdmin} value={settings[key]} onChange={(event) => updateSetting(key, Number(event.target.value))} />
    </label>
  );

  const checkbox = (label: string, key: BooleanSetting, description?: string) => (
    <label className="settings-toggle" key={key}>
      <input type="checkbox" disabled={!isAdmin} checked={settings[key]} onChange={(event) => updateSetting(key, event.target.checked)} />
      <span className="settings-toggle-copy">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  );

  const colorInput = (label: string, key: 'primaryColor' | 'accentColor') => (
    <label className="settings-color-field" key={key}>
      {label}
      <span>
        <input type="color" disabled={!isAdmin} value={settings[key]} onChange={(event) => updateSetting(key, event.target.value)} />
        <code>{settings[key]}</code>
      </span>
    </label>
  );

  let sectionContent: ReactNode;
  switch (section) {
    case 'Company':
      sectionContent = (
        <div className="settings-fields">
          {textInput('Name', 'companyName', 'text', true)}
          {textInput('Email', 'companyEmail', 'email')}
          {textInput('Phone', 'companyPhone', 'tel')}
          {textInput('Address', 'companyAddress')}
          <label>
            Currency
            <select disabled={!isAdmin} value={settings.currency} onChange={(event) => updateSetting('currency', event.target.value)}>
              <option value="INR">INR — Indian Rupee</option>
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British Pound</option>
              <option value="SGD">SGD — Singapore Dollar</option>
              <option value="AED">AED — UAE Dirham</option>
            </select>
          </label>
          {textInput('Timezone', 'timezone', 'text', true)}
        </div>
      );
      break;
    case 'Branding':
      sectionContent = (
        <>
          <div className="settings-fields">
            {textInput('Logo URL', 'logoUrl', 'url')}
            {colorInput('Primary color', 'primaryColor')}
            {colorInput('Accent color', 'accentColor')}
          </div>
          <p className="settings-help">Use a publicly accessible image URL for your company logo. Colors are saved for workspace branding.</p>
          {settings.logoUrl && (
            <div className="settings-brand-preview">
              <img src={settings.logoUrl} alt="Company logo preview" />
              <span>Logo preview</span>
            </div>
          )}
        </>
      );
      break;
    case 'Approvals':
      sectionContent = (
        <div className="settings-fields">
          {numberInput('Approval levels', 'approvalLevels', 1, 5)}
          <label>
            Default approver role
            <select disabled={!isAdmin} value={settings.defaultApproverRole} onChange={(event) => updateSetting('defaultApproverRole', event.target.value)}>
              <option value="approver">Approver</option>
              <option value="admin">Administrator</option>
              <option value="finance_officer">Finance officer</option>
            </select>
          </label>
          {numberInput('Auto-approve requests up to', 'autoApproveLimit')}
          <p className="settings-help">Set the approval chain depth and default workspace role used for routed requests.</p>
        </div>
      );
      break;
    case 'Notifications':
      sectionContent = (
        <div className="settings-option-list">
          {checkbox('Email notifications', 'notificationsEmail', 'Send supported workflow updates through the Gmail integration in Email Settings.')}
          {checkbox('In-app notifications', 'notificationsInApp', 'Show notification updates in the workspace.')}
          {checkbox('Invoice updates', 'notifyInvoices')}
          {checkbox('Approval activity', 'notifyApprovals')}
          {checkbox('SLA breach alerts', 'notifySlaBreaches')}
        </div>
      );
      break;
    case 'AP Escalation':
      sectionContent = (
        <div className="settings-fields">
          {checkbox('Enable AP escalation', 'apEscalationEnabled', 'Escalate invoices that remain pending review.')}
          {numberInput('Escalate after (hours)', 'apEscalationAfterHours', 1)}
          {numberInput('Repeat escalation every (hours)', 'apEscalationRepeatHours', 1)}
          {textInput('Escalation contact email', 'apEscalationEmail', 'email')}
        </div>
      );
      break;
    case 'SLA':
      sectionContent = (
        <div className="settings-sla-table">
          <div className="settings-sla-heading">
            <span>Priority</span>
            <span>Response target (hours)</span>
            <span>Resolution target (hours)</span>
          </div>
          {(['Low', 'Medium', 'High', 'Urgent'] as const).map((priority) => (
            <div className="settings-sla-row" key={priority}>
              <strong>{priority}</strong>
              {numberInput(`${priority} response target`, `sla${priority}ResponseHours` as NumberSetting, 1)}
              {numberInput(`${priority} resolution target`, `sla${priority}ResolutionHours` as NumberSetting, 1)}
            </div>
          ))}
        </div>
      );
      break;
    case 'Email Settings':
      sectionContent = (
        <div className="settings-integration">
          <div className="settings-integration-heading">
            <div>
              <h3>Google Account sign-in</h3>
              <p>Allow users to sign in to this workspace with their Google Account.</p>
            </div>
            <span className={`integration-status ${settings.googleClientId ? 'connected' : 'pending'}`}>{settings.googleClientId ? 'Configured' : 'Not configured'}</span>
          </div>
          <div className="settings-fields">{textInput('Google OAuth Web Client ID', 'googleClientId')}</div>
          <p className="settings-help">
            Create a Web application OAuth client in Google Cloud Console, add this app’s origin to its authorized JavaScript origins, then paste the client ID here and save. The client ID is public; account
            verification remains on the API server. Users can then choose Login with Google on the sign-in page.
          </p>
          <div className="settings-integration-heading">
            <div>
              <h3>Gmail integration</h3>
              <p>Send workspace notification emails through the configured Gmail account.</p>
            </div>
            <span className={`integration-status ${gmailStatus?.configured ? 'connected' : 'pending'}`}>{gmailStatus?.configured ? 'Credentials configured' : 'Not configured'}</span>
          </div>
          <div className="settings-fields">
            <label>
              Gmail sender account
              <input value={gmailStatus?.senderEmail || (gmailStatus ? 'Not configured' : 'Loading...')} readOnly />
            </label>
          </div>
          <div className="integration-scopes">
            <strong>Required Google OAuth scope</strong>
            <ul>
              {(gmailStatus?.requiredScopes ?? ['https://www.googleapis.com/auth/gmail.send']).map((scope) => (
                <li key={scope}>
                  <code>{scope}</code>
                </li>
              ))}
            </ul>
          </div>
          <p className="settings-help">
            Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_SENDER_EMAIL in the API server’s .env file, then restart the server. Grant the Gmail send scope when creating the refresh
            token. Credentials stay on the server. Enable Email notifications under Notifications to send workflow updates to the user’s registered work email.
          </p>
          {gmailStatus && !gmailStatus.configured && <p className="settings-help">Missing configuration: {gmailStatus.missing.join(', ')}</p>}
          {gmailError && <InlineError message={gmailError} />}
          {gmailMessage && <InlineSuccess message={gmailMessage} />}
          <div className="settings-integration-actions">
            <button type="button" className="button button-secondary" onClick={() => void testGmailConnection()} disabled={!isAdmin || !gmailStatus?.configured || gmailTesting}>
              {gmailTesting ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              {gmailTesting ? 'Sending test email...' : 'Send test email'}
            </button>
            <a className="text-button" href="https://developers.google.com/workspace/gmail/api/auth/scopes" target="_blank" rel="noreferrer">
              Gmail API scope documentation <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
      );
      break;
    case 'ManageEngine':
      sectionContent = (
        <div className="settings-integration">
          <div className="settings-integration-heading">
            <div>
              <h3>ManageEngine Endpoint Central</h3>
              <p>Connect your Endpoint Central Cloud tenant to prepare inventory, warranty, and user synchronization.</p>
            </div>
            <span className={`integration-status ${manageEngineStatus?.configured ? 'connected' : 'pending'}`}>{manageEngineStatus?.configured ? 'Credentials configured' : 'Not configured'}</span>
          </div>
          <div className="settings-fields">
            <label>
              Endpoint Central API URL
              <input value={manageEngineStatus?.apiBaseUrl ?? 'Loading...'} readOnly />
            </label>
            <label>
              Zoho OAuth URL
              <input value={manageEngineStatus?.oauthUrl ?? 'Loading...'} readOnly />
            </label>
          </div>
          <div className="integration-scopes">
            <strong>Required OAuth scopes</strong>
            <ul>
              {(manageEngineStatus?.requiredScopes ?? []).map((scope) => (
                <li key={scope}>
                  <code>{scope}</code>
                </li>
              ))}
            </ul>
          </div>
          <p className="settings-help">
            Configure the OAuth client ID, client secret, and refresh token in the API server’s .env file, then restart the server. Credentials are never sent to the browser. Endpoint Central exposes computer
            inventory, warranty, and assigned-user data for reading; asset and warranty write-back will remain disabled until its supported write API is provided.
          </p>
          {manageEngineError && <InlineError message={manageEngineError} />}
          {manageEngineMessage && <InlineSuccess message={manageEngineMessage} />}
          <div className="settings-integration-actions">
            <button type="button" className="button button-secondary" onClick={() => void testManageEngineConnection()} disabled={!isAdmin || !manageEngineStatus?.configured || manageEngineTesting}>
              {manageEngineTesting ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              {manageEngineTesting ? 'Testing...' : 'Test connection'}
            </button>
            <a className="text-button" href="https://www.manageengine.com/products/desktop-central/help/api/cloud/api-index.html" target="_blank" rel="noreferrer">
              Endpoint Central API documentation <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
      );
      break;
    default:
      sectionContent = null;
  }

  return (
    <div className="fade-in">
      <PageTitle eyebrow="Workspace / Preferences" title="Settings" copy="Company, notifications, and SLA" />

      {!isAdmin && <Banner tone="info" title="Read-only workspace settings">Only a workspace administrator can change company settings. You can still update your own profile below.</Banner>}

      <SegmentedTabs
        ariaLabel="Workspace setting categories"
        value={section}
        onChange={(value) => {
          setSection(value);
          setMessage(null);
          setError(null);
        }}
        options={settingsSections.filter(({ label }) => isAdmin || !adminOnlySections.includes(label)).map(({ label }) => ({ value: label, label }))}
      />

      <form className="panel settings-workspace-form" onSubmit={submitSettings}>
        <section role="tabpanel" aria-label={`${section} settings`} className="settings-section">
          {sectionContent}
        </section>
        {error && <InlineError message={error} />}
        {message && <InlineSuccess message={message} />}
        {isAdmin && section !== 'ManageEngine' && (
          <div className="settings-save-row">
            <button className="button button-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save settings'}
            </button>
          </div>
        )}
      </form>

      <div className="settings-profile-grid">
        <section className="panel settings-panel">
          <PanelHeader title="My profile" subtitle="These details appear in asset and workflow records." />
          <form className="settings-form" onSubmit={submitProfile}>
            <label>
              Full name
              <input required value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
            <label>
              Department
              <input required value={department} onChange={(event) => setDepartment(event.target.value)} />
            </label>
            <label>
              Work email
              <input value={user.email} disabled />
            </label>
            {profileError && <InlineError message={profileError} />}
            {profileMessage && <InlineSuccess message={profileMessage} />}
            <button className="button button-primary" disabled={savingProfile}>
              {savingProfile ? 'Saving...' : 'Save profile'}
            </button>
          </form>
        </section>
        <section className="panel settings-panel">
          <PanelHeader title="Account access" subtitle="Workspace role and sign-in details" />
          <div className="settings-account">
            <div>
              <span>Access role</span>
              <strong>{roleLabel(user.role)}</strong>
            </div>
            <div>
              <span>Department</span>
              <strong>{user.department}</strong>
            </div>
            <div>
              <span>Account status</span>
              <strong>{user.active ? 'Active' : 'Inactive'}</strong>
            </div>
            <p>Role changes are managed by a workspace administrator.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
