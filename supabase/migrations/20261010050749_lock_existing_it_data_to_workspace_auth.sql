/*
# Remove anonymous access from IT operational data

1. Security
- Removes the original single-tenant anonymous CRUD policies from existing IT tables.
- Leaves the authenticated workspace policies from the production workflow migration in place.

2. Important Notes
- Existing rows are preserved.
- Signed-in workspace users continue to access records according to their role.
- Anonymous clients no longer receive operational data.
*/

DROP POLICY IF EXISTS "shared select it assets" ON it_assets;
DROP POLICY IF EXISTS "shared insert it assets" ON it_assets;
DROP POLICY IF EXISTS "shared update it assets" ON it_assets;
DROP POLICY IF EXISTS "shared delete it assets" ON it_assets;
DROP POLICY IF EXISTS "shared select it invoices" ON it_invoices;
DROP POLICY IF EXISTS "shared insert it invoices" ON it_invoices;
DROP POLICY IF EXISTS "shared update it invoices" ON it_invoices;
DROP POLICY IF EXISTS "shared delete it invoices" ON it_invoices;
DROP POLICY IF EXISTS "shared select it tickets" ON it_tickets;
DROP POLICY IF EXISTS "shared insert it tickets" ON it_tickets;
DROP POLICY IF EXISTS "shared update it tickets" ON it_tickets;
DROP POLICY IF EXISTS "shared delete it tickets" ON it_tickets;
DROP POLICY IF EXISTS "shared select it purchase requests" ON it_purchase_requests;
DROP POLICY IF EXISTS "shared insert it purchase requests" ON it_purchase_requests;
DROP POLICY IF EXISTS "shared update it purchase requests" ON it_purchase_requests;
DROP POLICY IF EXISTS "shared delete it purchase requests" ON it_purchase_requests;