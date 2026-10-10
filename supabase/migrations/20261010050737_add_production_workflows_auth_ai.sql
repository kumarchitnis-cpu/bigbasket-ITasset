/*
# Add production workflow, identity, and document foundations

1. New Tables
- `app_profiles`: signed-in workspace identities with organization role and department.
- `it_asset_events`: immutable lifecycle history for assignments, returns, maintenance, transfers, and retirement.
- `it_goods_receipts`: purchase-order receiving records with accepted/rejected quantities and discrepancy notes.
- `it_maintenance_records`: service history, cost, downtime, and resolution for assets.
- `app_notifications`: durable in-app alerts with deduplication keys and read state.
- `app_audit_log`: security and workflow audit records with actor, action, entity, and metadata.
- `app_documents`: private uploaded document metadata, checksum, extraction state, and AI review output.

2. Modified Tables
- Existing IT tables now require an authenticated workspace profile for access.
- Existing asset and invoice records receive lifecycle/document workflow fields without deleting existing data.

3. Security
- RLS is enabled on all new tables.
- Existing shared demo access is replaced with authenticated access.
- Read access requires a signed-in profile; write access is restricted by role where applicable.
- Private document metadata is profile-scoped and uploaded files use a private storage bucket.
- A secure auth trigger creates a profile for each new account and makes the first account an administrator.

4. Important Notes
- The browser never chooses its own audit actor; actor identity is taken from the authenticated session.
- Document files are private and are not exposed through permanent public URLs.
- The AI extraction state is a review aid only; approval and payment decisions remain workflow actions.
*/

CREATE TABLE IF NOT EXISTS app_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT 'Workspace user',
  role text NOT NULL CHECK (role IN ('admin', 'it_asset_manager', 'procurement_officer', 'finance_officer', 'approver', 'employee', 'auditor')) DEFAULT 'employee',
  department text NOT NULL DEFAULT 'General',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS it_asset_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES it_assets(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('REGISTERED', 'ASSIGNED', 'RETURNED', 'TRANSFERRED', 'MAINTENANCE_STARTED', 'MAINTENANCE_COMPLETED', 'QUARANTINED', 'RETIRED', 'AUDITED')),
  from_status text,
  to_status text,
  from_custodian text,
  to_custodian text,
  location text,
  notes text,
  actor_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS it_goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  purchase_order text NOT NULL,
  vendor text NOT NULL,
  received_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  ordered_quantity integer NOT NULL CHECK (ordered_quantity >= 0),
  accepted_quantity integer NOT NULL CHECK (accepted_quantity >= 0),
  rejected_quantity integer NOT NULL CHECK (rejected_quantity >= 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'DISCREPANCY')) DEFAULT 'DRAFT',
  discrepancy_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (accepted_quantity + rejected_quantity <= ordered_quantity)
);

CREATE TABLE IF NOT EXISTS it_maintenance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES it_assets(id) ON DELETE RESTRICT,
  issue text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')) DEFAULT 'OPEN',
  priority text NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')) DEFAULT 'MEDIUM',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  downtime_hours numeric(8,2) NOT NULL DEFAULT 0 CHECK (downtime_hours >= 0),
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  entity_type text,
  entity_id uuid,
  dedupe_key text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS app_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'REJECTED', 'FAILED')),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  sha256 text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('INVOICE', 'PURCHASE_ORDER', 'RECEIPT', 'WARRANTY', 'OTHER')) DEFAULT 'OTHER',
  extraction_status text NOT NULL CHECK (extraction_status IN ('UPLOADED', 'EXTRACTING', 'NEEDS_REVIEW', 'VALIDATED', 'FAILED')) DEFAULT 'UPLOADED',
  extracted_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,2) CHECK (confidence >= 0 AND confidence <= 100),
  review_reason text,
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS warranty_start date;
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS purchase_order text;
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS last_audited_at timestamptz;
ALTER TABLE it_invoices ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'VALIDATED';
ALTER TABLE it_invoices ADD COLUMN IF NOT EXISTS matched_at timestamptz;
ALTER TABLE it_invoices ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE INDEX IF NOT EXISTS it_asset_events_asset_idx ON it_asset_events(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS it_goods_receipts_po_idx ON it_goods_receipts(purchase_order);
CREATE INDEX IF NOT EXISTS it_maintenance_asset_idx ON it_maintenance_records(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_notifications_recipient_idx ON app_notifications(recipient_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS app_audit_log_entity_idx ON app_audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_documents_status_idx ON app_documents(extraction_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_new_workspace_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  assigned_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_profiles) THEN
    assigned_role := 'admin';
  ELSE
    assigned_role := 'employee';
  END IF;

  INSERT INTO public.app_profiles (id, email, full_name, role)
  VALUES (new.id, coalesce(new.email, 'workspace-user'), coalesce(new.raw_user_meta_data->>'full_name', 'Workspace user'), assigned_role)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_workspace_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_workspace_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_workspace_profile();

ALTER TABLE app_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_asset_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_maintenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace profiles select" ON app_profiles;
CREATE POLICY "workspace profiles select" ON app_profiles FOR SELECT TO authenticated USING (id = auth.uid() OR EXISTS (SELECT 1 FROM app_profiles viewer WHERE viewer.id = auth.uid() AND viewer.role IN ('admin', 'it_asset_manager', 'auditor')));
DROP POLICY IF EXISTS "workspace profiles update own" ON app_profiles;
CREATE POLICY "workspace profiles update own" ON app_profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS "workspace profiles insert trigger" ON app_profiles;
CREATE POLICY "workspace profiles insert trigger" ON app_profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS "workspace profiles delete admin" ON app_profiles;
CREATE POLICY "workspace profiles delete admin" ON app_profiles FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles viewer WHERE viewer.id = auth.uid() AND viewer.role = 'admin'));

DROP POLICY IF EXISTS "workspace asset events select" ON it_asset_events;
CREATE POLICY "workspace asset events select" ON it_asset_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND active));
DROP POLICY IF EXISTS "workspace asset events insert" ON it_asset_events;
CREATE POLICY "workspace asset events insert" ON it_asset_events FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid() AND EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager')));
DROP POLICY IF EXISTS "workspace asset events update" ON it_asset_events;
CREATE POLICY "workspace asset events update" ON it_asset_events FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "workspace asset events delete" ON it_asset_events;
CREATE POLICY "workspace asset events delete" ON it_asset_events FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "workspace receipts select" ON it_goods_receipts;
CREATE POLICY "workspace receipts select" ON it_goods_receipts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND active));
DROP POLICY IF EXISTS "workspace receipts insert" ON it_goods_receipts;
CREATE POLICY "workspace receipts insert" ON it_goods_receipts FOR INSERT TO authenticated WITH CHECK (received_by = auth.uid() AND EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager', 'procurement_officer')));
DROP POLICY IF EXISTS "workspace receipts update" ON it_goods_receipts;
CREATE POLICY "workspace receipts update" ON it_goods_receipts FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager', 'procurement_officer'))) WITH CHECK (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager', 'procurement_officer')));
DROP POLICY IF EXISTS "workspace receipts delete" ON it_goods_receipts;
CREATE POLICY "workspace receipts delete" ON it_goods_receipts FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "workspace maintenance select" ON it_maintenance_records;
CREATE POLICY "workspace maintenance select" ON it_maintenance_records FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND active));
DROP POLICY IF EXISTS "workspace maintenance insert" ON it_maintenance_records;
CREATE POLICY "workspace maintenance insert" ON it_maintenance_records FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager')));
DROP POLICY IF EXISTS "workspace maintenance update" ON it_maintenance_records;
CREATE POLICY "workspace maintenance update" ON it_maintenance_records FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager'))) WITH CHECK (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager')));
DROP POLICY IF EXISTS "workspace maintenance delete" ON it_maintenance_records;
CREATE POLICY "workspace maintenance delete" ON it_maintenance_records FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "workspace notifications select" ON app_notifications;
CREATE POLICY "workspace notifications select" ON app_notifications FOR SELECT TO authenticated USING (recipient_id = auth.uid());
DROP POLICY IF EXISTS "workspace notifications insert" ON app_notifications;
CREATE POLICY "workspace notifications insert" ON app_notifications FOR INSERT TO authenticated WITH CHECK (recipient_id = auth.uid());
DROP POLICY IF EXISTS "workspace notifications update" ON app_notifications;
CREATE POLICY "workspace notifications update" ON app_notifications FOR UPDATE TO authenticated USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());
DROP POLICY IF EXISTS "workspace notifications delete" ON app_notifications;
CREATE POLICY "workspace notifications delete" ON app_notifications FOR DELETE TO authenticated USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "workspace audit select" ON app_audit_log;
CREATE POLICY "workspace audit select" ON app_audit_log FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'auditor')));
DROP POLICY IF EXISTS "workspace audit insert" ON app_audit_log;
CREATE POLICY "workspace audit insert" ON app_audit_log FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());
DROP POLICY IF EXISTS "workspace audit update" ON app_audit_log;
CREATE POLICY "workspace audit update" ON app_audit_log FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "workspace audit delete" ON app_audit_log;
CREATE POLICY "workspace audit delete" ON app_audit_log FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "workspace documents select" ON app_documents;
CREATE POLICY "workspace documents select" ON app_documents FOR SELECT TO authenticated USING (uploaded_by = auth.uid() OR EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'finance_officer', 'auditor')));
DROP POLICY IF EXISTS "workspace documents insert" ON app_documents;
CREATE POLICY "workspace documents insert" ON app_documents FOR INSERT TO authenticated WITH CHECK (uploaded_by = auth.uid());
DROP POLICY IF EXISTS "workspace documents update" ON app_documents;
CREATE POLICY "workspace documents update" ON app_documents FOR UPDATE TO authenticated USING (uploaded_by = auth.uid() OR EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'finance_officer'))) WITH CHECK (uploaded_by = auth.uid() OR EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'finance_officer')));
DROP POLICY IF EXISTS "workspace documents delete" ON app_documents;
CREATE POLICY "workspace documents delete" ON app_documents FOR DELETE TO authenticated USING (uploaded_by = auth.uid() OR EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "workspace select it assets" ON it_assets;
CREATE POLICY "workspace select it assets" ON it_assets FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND active));
DROP POLICY IF EXISTS "workspace insert it assets" ON it_assets;
CREATE POLICY "workspace insert it assets" ON it_assets FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager')));
DROP POLICY IF EXISTS "workspace update it assets" ON it_assets;
CREATE POLICY "workspace update it assets" ON it_assets FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager'))) WITH CHECK (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager')));
DROP POLICY IF EXISTS "workspace delete it assets" ON it_assets;
CREATE POLICY "workspace delete it assets" ON it_assets FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "workspace select it invoices" ON it_invoices;
CREATE POLICY "workspace select it invoices" ON it_invoices FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND active));
DROP POLICY IF EXISTS "workspace insert it invoices" ON it_invoices;
CREATE POLICY "workspace insert it invoices" ON it_invoices FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'finance_officer')));
DROP POLICY IF EXISTS "workspace update it invoices" ON it_invoices;
CREATE POLICY "workspace update it invoices" ON it_invoices FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'finance_officer'))) WITH CHECK (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'finance_officer')));
DROP POLICY IF EXISTS "workspace delete it invoices" ON it_invoices;
CREATE POLICY "workspace delete it invoices" ON it_invoices FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "workspace select it tickets" ON it_tickets;
CREATE POLICY "workspace select it tickets" ON it_tickets FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND active));
DROP POLICY IF EXISTS "workspace insert it tickets" ON it_tickets;
CREATE POLICY "workspace insert it tickets" ON it_tickets FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND active));
DROP POLICY IF EXISTS "workspace update it tickets" ON it_tickets;
CREATE POLICY "workspace update it tickets" ON it_tickets FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager'))) WITH CHECK (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'it_asset_manager')));
DROP POLICY IF EXISTS "workspace delete it tickets" ON it_tickets;
CREATE POLICY "workspace delete it tickets" ON it_tickets FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role = 'admin'));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('it-documents', 'it-documents', false, 10485760, ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

DROP POLICY IF EXISTS "workspace documents storage read" ON storage.objects;
CREATE POLICY "workspace documents storage read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'it-documents' AND EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND active));
DROP POLICY IF EXISTS "workspace documents storage insert" ON storage.objects;
CREATE POLICY "workspace documents storage insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'it-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "workspace documents storage update" ON storage.objects;
CREATE POLICY "workspace documents storage update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'it-documents' AND (storage.foldername(name))[1] = auth.uid()::text) WITH CHECK (bucket_id = 'it-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "workspace documents storage delete" ON storage.objects;
CREATE POLICY "workspace documents storage delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'it-documents' AND (storage.foldername(name))[1] = auth.uid()::text);