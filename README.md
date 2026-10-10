# bigbasket ITAM

Internal IT asset management workspace for Bigbasket — asset register, procurement, AI-assisted invoice review, and service desk, backed by Supabase.

## Stack

- React 18 + TypeScript + Vite 5 + Tailwind CSS
- Supabase: Auth (email + Google OAuth), Postgres with RLS, private storage, Edge Function
- OpenAI (gpt-4o-mini) for invoice field extraction

## Setup

1. **Supabase project**
   - Create a project and run all migrations in `supabase/migrations/` in order.
   - The database ships with **no seed data** — the workspace starts empty and records are created through the app.
   - Ensure the `it-documents` storage bucket exists (created by the workflow migration) and is private.

2. **Environment**
   - Copy `.env.example` to `.env` and fill in your project credentials:
     - `VITE_SUPABASE_URL` — Project URL (Settings > API)
     - `VITE_SUPABASE_ANON_KEY` — anon public key (Settings > API)
   - Set the `OPENAI_API_KEY` secret on the `process-invoice` edge function (Supabase > Functions > Secrets). Invoice upload degrades gracefully to a review-failed state when the key is absent.

3. **Auth**
   - The first account to sign up is automatically assigned the `admin` role; subsequent signups become `employee`.
   - Enable Google as an OAuth provider in Supabase Auth settings if you want SSO.

4. **Run**
   ```bash
   npm install
   npm run dev
   ```

5. **Verify**
   ```bash
   npm run lint
   npm run typecheck
   npm run build
   ```

## Roles

`admin`, `it_asset_manager`, `procurement_officer`, `finance_officer`, `approver`, `employee`, `auditor` — enforced by Postgres RLS policies on every table. Write access is role-gated; audit, document, and lifecycle-event tables are append-only for clients.

## Edge function

`supabase/functions/process-invoice` receives a data-URL image, extracts structured invoice fields with OpenAI, and returns a confidence score plus review reasons. Extraction results are stored on `app_documents` and routed to human review when confidence is below 85% or fields are missing.
