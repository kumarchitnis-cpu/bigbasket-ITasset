/*
# Purge demo seed data from operational tables

1. Purpose
- Removes the illustrative demo rows that shipped with the original core migration
  so the workspace starts empty and operates only on real records.

2. Targeted Rows
- Only rows created by the original seed script are removed, matched on the exact
  asset tags, invoice numbers, ticket numbers, and request numbers that the seed
  inserted. Real records entered through the application are never touched.

3. Important Notes
- Safe to run multiple times; deletes are exact-match and idempotent.
- Run this once against any environment where the seed data was applied.
- Fresh environments built from the cleaned core migration have no demo rows.
*/

DELETE FROM it_assets
WHERE asset_tag = ANY (ARRAY['IT-LAP-0001', 'IT-MON-0001', 'IT-LAP-0002', 'IT-NET-0001', 'IT-LAP-0003', 'IT-PHN-0001']);

DELETE FROM it_invoices
WHERE invoice_number = ANY (ARRAY['INV-DEMO-101', 'INV-DEMO-102', 'INV-DEMO-103', 'INV-DEMO-104']);

DELETE FROM it_tickets
WHERE ticket_number = ANY (ARRAY['INC-2048', 'REQ-1192', 'INC-2044', 'REQ-1188']);

DELETE FROM it_purchase_requests
WHERE request_number = ANY (ARRAY['PR-0041', 'PR-0040', 'PR-0039']);
