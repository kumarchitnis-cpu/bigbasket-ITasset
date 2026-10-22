import type { AppUser } from '@/lib/api';

export type AssetStatus = 'ASSIGNED' | 'AVAILABLE' | 'UNDER_MAINTENANCE' | 'QUARANTINED' | 'RETIRED';

export type Asset = {
  id: string;
  asset_tag: string;
  category: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  status: AssetStatus;
  condition: string;
  custodian: string;
  location: string;
  purchase_cost: number;
  purchase_order: string | null;
  warranty_start: string | null;
  warranty_end: string | null;
  department: string;
  last_audited_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AssetEventType =
  | 'REGISTERED'
  | 'ASSIGNED'
  | 'RETURNED'
  | 'TRANSFERRED'
  | 'MAINTENANCE_STARTED'
  | 'MAINTENANCE_COMPLETED'
  | 'QUARANTINED'
  | 'RETIRED'
  | 'AUDITED';

export type AssetEvent = {
  id: string;
  asset_id?: string;
  event_type: AssetEventType | string;
  from_status: AssetStatus | null;
  to_status: AssetStatus | null;
  from_custodian: string | null;
  to_custodian: string | null;
  location: string | null;
  notes: string | null;
  actor_name: string;
  created_at: string;
};

export type InvoiceStatus = 'PENDING' | 'UNDER_REVIEW' | 'PROCESSED' | 'ON_HOLD' | 'REJECTED';

export type InvoiceExtraction = {
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

export type Invoice = {
  id: string;
  invoice_number: string;
  vendor: string;
  purchase_order: string;
  total: number;
  status: InvoiceStatus;
  confidence: number;
  issue: string | null;
  invoice_date: string;
  currency_code: string;
  extracted_fields: InvoiceExtraction;
  document_id: string | null;
  file_name: string | null;
  file_visible: boolean;
  matched_at?: string | null;
  approved_at?: string | null;
  created_at?: string;
};

export type EmployeeAssetRequest = {
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
  reviewed_at?: string | null;
  created_at: string;
};

export type EmployeeAssetAssignment = {
  id: string;
  employee_name: string;
  employee_id: string;
  designation: string;
  department: string;
  asset_model: string;
  serial_number: string;
  doj: string;
  remarks: string;
  created_at?: string;
  updated_at?: string;
};

export type WriteOffStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export type WriteOffRequest = {
  id: string;
  asset_id: string;
  asset_tag: string;
  manufacturer: string;
  model: string;
  asset_status: AssetStatus;
  requester_name: string;
  requester_id?: string;
  reason: string;
  write_off_date?: string | null;
  approved_by?: string | null;
  status: WriteOffStatus;
  review_note: string | null;
  reviewer_name?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at?: string;
};

export type InventoryReceipt = {
  id: string;
  receipt_number: string;
  purchase_order: string;
  vendor: string;
  received_date: string;
  ordered_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  status: string;
  discrepancy_note?: string | null;
  created_at?: string;
};

export type WorkspaceNotification = {
  id: string;
  event_type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type DashboardActivity = {
  action: string;
  entity_type: string;
  created_at: string;
};

export type DashboardData = {
  recent: DashboardActivity[];
  daily: { date: string; count: number }[];
};

export type DashboardMetrics = {
  totalAssets: number;
  activeAssets: number;
  availableAssets: number;
  maintenanceAssets: number;
  retiredAssets: number;
  assignedAssets: number;
  totalInvoices: number;
  invoiceSpend: number;
  pendingInvoices: number;
  purchaseOrders: number;
  deletedItems: number;
  pendingApprovals: number;
  warrantyActive: number;
  warrantyExpiring: number;
  warrantyExpired: number;
  warrantyUnknown: number;
};

export type AuditEntry = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_name: string | null;
  created_at: string;
  outcome: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type DeletedRecord = {
  audit_id: string;
  entity_type: string;
  entity_id: string;
  label: string;
  detail: string;
  deleted_by: string | null;
  deleted_at: string;
  restorable: boolean;
  restored_at?: string | null;
};

export type DeletedActivityPoint = {
  date: string;
  label: string;
  deleted: number;
  restored: number;
};

export type DeletedSummary = {
  records: DeletedRecord[];
  activity: DeletedActivityPoint[];
  totals: { deleted: number; restored: number; pending: number };
};

export type ManagedUser = AppUser & { created_at: string };

export type WarrantyStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'UNKNOWN';

export type NotificationPriority = 'normal' | 'urgent';

export type WorkspaceModule =
  | 'Dashboard'
  | 'AI Assistant'
  | 'User Management'
  | 'Invoices'
  | 'Assets'
  | 'Emp Asset Mgmt'
  | 'Inventory'
  | 'Inventory History'
  | 'Warranties'
  | 'Write-Off'
  | 'Notifications'
  | 'Settings'
  | 'Deleted'
  | 'Reports';
