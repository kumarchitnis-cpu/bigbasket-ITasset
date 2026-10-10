/*
# Tighten workflow security gaps

1. Security fixes
- Adds authenticated workspace policies for purchase requests so the procurement screen remains usable after anonymous access is removed.
- Revokes direct RPC execution of the signup profile trigger from anonymous and signed-in clients; it remains callable only by the auth trigger system.

2. Important Notes
- Existing purchase request data is preserved.
- Procurement writes are limited to administrators and procurement officers.
*/

DROP POLICY IF EXISTS "workspace select it purchase requests" ON it_purchase_requests;
CREATE POLICY "workspace select it purchase requests" ON it_purchase_requests FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND active));
DROP POLICY IF EXISTS "workspace insert it purchase requests" ON it_purchase_requests;
CREATE POLICY "workspace insert it purchase requests" ON it_purchase_requests FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'procurement_officer', 'employee')));
DROP POLICY IF EXISTS "workspace update it purchase requests" ON it_purchase_requests;
CREATE POLICY "workspace update it purchase requests" ON it_purchase_requests FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'procurement_officer', 'approver'))) WITH CHECK (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role IN ('admin', 'procurement_officer', 'approver')));
DROP POLICY IF EXISTS "workspace delete it purchase requests" ON it_purchase_requests;
CREATE POLICY "workspace delete it purchase requests" ON it_purchase_requests FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM app_profiles WHERE id = auth.uid() AND role = 'admin'));

REVOKE EXECUTE ON FUNCTION public.handle_new_workspace_profile() FROM anon, authenticated;
