# bigbasket ITAM

Internal IT asset management workspace for Bigbasket — asset register and lifecycle, employee equipment requests, inventory, warranties, write-offs, procurement, invoices, document OCR, notifications, and service desk. Self-hosted: Node.js API + SQLite.

## Stack

- **Frontend**: React 18 + TypeScript + Vite 5 + Tailwind CSS
- **Backend**: Node.js + Express API server (`server/`)
- **Database**: SQLite (`server-data/itam.db`) — file-based, zero-config
- **Auth**: email + password with scrypt hashing and signed JWT sessions (7-day expiry outside localhost; no expiry on localhost), plus Google Identity Services sign-in
- **Document OCR**: Tesseract.js CPU OCR + local field rules for invoices, purchase orders, and asset/serial documents; no OpenAI dependency
- **Optional AI Assistant**: OpenAI (gpt-4o-mini) for aggregate-only operational Q&A, called server-side when configured

## Setup

```bash
npm install
npm run dev
```

`npm run dev` starts both the API server (port 3001) and the Vite dev server. The first account you create is automatically assigned the `admin` role; every later signup becomes `employee`.

Open **Document Scanner** after signing in to scan invoices, purchase orders, warranty/asset records, and other asset documents. Upload a PDF or a PNG/JPG/WebP scan (up to 10 MB); selectable-text PDFs are parsed directly, while image-only PDFs and scans use Tesseract.js on the API server CPU. Review the extracted JSON and OCR text, correct any fields, and save. Invoice upload uses the same local scanner and then lets finance roles add the reviewed result to the invoice register. Documents are not sent to OpenAI or another OCR service.

The first scan downloads the English OCR model and caches it in `DATA_DIR/tesseract-cache`; later scans use that local cache. To preinstall the model on a connected server for a network-isolated machine, run one scan, then copy the `tesseract-cache` directory together with the app's `DATA_DIR`. Alternatively, place `eng.traineddata` in a local folder and set `TESSDATA_DIR` to that folder before starting the API. Scanned PDFs are rendered and OCR'd for up to the first five pages. Processing uses one reusable OCR worker at a time to limit CPU contention.

For a local PC/server deployment, use Node.js 22, run `npm install`, then `npm run dev`. The API and OCR processing run on the same machine; keep `DATA_DIR` on persistent storage and restrict its access because it contains uploaded source documents and extracted text. No GPU, OpenAI API key, or external OCR executable is required. `OPENAI_API_KEY` remains optional for the separate AI Assistant only.

Google sign-in requires an OAuth 2.0 **Web application** client ID from Google Cloud Console. Set that same client ID as both `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` in `.env`, and add each app origin (for local development, `http://localhost:5173`) under **Authorized JavaScript origins** in the OAuth client. Restart the API and Vite after configuration. The Google Identity Services button verifies the user's Google ID token on the API; successful sign-in creates or links an account by verified email and opens the Operations dashboard. New Google accounts follow the normal first-user-admin / later-user-employee policy. Without a configured client ID, the login page explains the required setup.

## Environment (`.env`)

Copy `.env.example` to `.env`:

- `PORT` — API server port (default 3001)
- `VITE_API_URL` — API base URL used by the frontend
- `JWT_SECRET` — strong random secret for session signing (generated for you in `.env`)
- `DATA_DIR` — where the SQLite database and uploaded files live (git-ignored)
- `GOOGLE_CLIENT_ID` — Google OAuth Web Client ID used by the API to verify Google ID tokens
- `VITE_GOOGLE_CLIENT_ID` — the same Google OAuth Web Client ID, exposed to the browser by Vite
- `TESSDATA_DIR` — optional local directory containing uncompressed `eng.traineddata` for offline OCR model provisioning
- `OPENAI_API_KEY` — optional server-side key for the separate AI Assistant only; invoice and document scanning never call OpenAI
- `MANAGEENGINE_CLIENT_ID`, `MANAGEENGINE_CLIENT_SECRET`, `MANAGEENGINE_REFRESH_TOKEN` — optional server-side Zoho OAuth credentials for Endpoint Central Cloud. These must never use a `VITE_` prefix.
- `MANAGEENGINE_API_BASE_URL` — optional Endpoint Central API base URL (defaults to `https://endpointcentral.manageengine.in`)
- `MANAGEENGINE_OAUTH_URL` — optional Zoho OAuth token URL (defaults to `https://accounts.zoho.in/oauth/v2/token`)

The ManageEngine integration status and connection test are available to workspace admins under **Settings → ManageEngine**. Configure credentials in the API server's `.env` and restart the server. The connection test verifies read access to computer inventory and the user directory. Asset/warranty data write-back is not enabled until the supported Endpoint Central write API is confirmed.

## Roles

`admin`, `it_asset_manager`, `procurement_officer`, `finance_officer`, `approver`, `employee`, `auditor` — enforced by the API on every endpoint, mirroring the original row-level security model:

- **Read** operational data: any active signed-in user
- **Assets**: write = admin / it_asset_manager, delete = admin
- **Invoices**: create, update, and local OCR extraction = admin / finance_officer; delete = admin
- **Employee asset requests**: submit = active employee / admin / asset manager; review = admin / asset manager; employees see only their own requests
- **Employee asset assignments**: create, update, delete, and Excel export = admin / asset manager; employees can view their own assignments
- **Write-offs**: request = admin / asset manager; final approve/reject = admin; approval retires the asset and writes an asset event
- **Inventory receipts**: create/update = admin / asset manager / procurement officer
- **Tickets**: create = any active user, update = admin / it_asset_manager, delete = admin
- **Purchase requests**: create = admin / procurement_officer / employee, update = admin / procurement_officer / approver, delete = admin
- **Vendor onboarding**: create/update = admin / procurement_officer; review = admin / approver; suspend = admin
- **Documents**: private per-user; admin / finance_officer / auditor can read all
- **Audit log**: admin / auditor read-only
- **User management**: admin only; admins can create users, assign workspace roles, and deactivate/reactivate accounts. The workspace always retains at least one active administrator, and account changes retain the user's operational history.

## Production notes

- **Render API deployment**: create a new Blueprint from this repository and use `render.yaml`. It provisions the Express API on Node 22 with a 1 GB persistent disk mounted at `/var/data`; SQLite, uploads, and the cached OCR model are stored there. The blueprint generates `JWT_SECRET`. Set `GOOGLE_CLIENT_ID` and `OPENAI_API_KEY` only if those optional services are configured. After deployment, verify `https://<service>.onrender.com/api/health` returns `{"ok":true,"service":"itam-api"}`. Add the API origin to the frontend's `VITE_API_URL` build setting, and set `VITE_GOOGLE_CLIENT_ID` to the same Google client ID if enabling browser Google sign-in; then rebuild and redeploy the frontend. Persistent-disk plans are required; without the disk, SQLite data, uploaded documents, and the cached OCR model will not survive instance replacement.
- Record numbers (`TKT-000001…`, `PR-000001…`, `GR-000001…`) are issued by the server from sequences — clients never invent identifiers.
- Asset registration and lifecycle actions write timestamped events with the acting user. Asset managers can assign, return, transfer, quarantine, retire, audit, and record maintenance start/completion from the asset history.
- Admins and asset managers can bulk-register assets from the Asset register using the downloadable Excel template. Imports validate the complete `.xlsx` file and reject invalid rows or duplicate asset tags before saving any assets.
- Lifecycle status and custodian changes use the asset event endpoint so they cannot bypass the history record; audit and maintenance updates are committed together with the asset change.
- Employee asset management includes an employee assignment register (employee ID, designation, department, asset model and serial, ticket, date of joining, and remarks) with admin/asset-manager create, edit, delete, and Excel export. Employee equipment requests retain their separate approval queue and notify asset managers. Write-offs require admin review; approval retires the asset and adds a traceable lifecycle event.
- Vendor onboarding stores supplier contact, tax, address, category, and notes data; submissions remain pending until an admin or approver accepts or rejects them. Procurement officers and admins can manage onboarding, and admins can suspend approved vendors. The Vendors workspace links directly to purchase requests and invoices.
- Inventory shows available registered assets alongside goods receipt history. Asset registration and Excel imports capture warranty start and end dates; the API validates their format and ordering. Warranty Reports derives active, expiring, expired, and unknown coverage from non-retired registered assets, with manufacturer/status filters, a 12-month forecast, lifecycle-age views, and PDF/Excel/CSV exports. Report rows link to asset history, and the asset register, dashboard, and operations guide link back to warranty reporting. Dell, Lenovo, HP, and Apple assets include a shortcut to the official lookup page that copies the serial number for manual verification; this does not automatically retrieve or save warranty information because the linked consumer portals do not expose a configured API integration.
- Profile settings update the signed-in user's name and department. Workspace administrators can configure company details, branding, procurement and approval defaults, notification preferences, AP escalation, and priority-based service-level targets; these settings are stored in SQLite. In-app notification preferences control which supported workspace events are generated; email delivery requires an email service. Notifications are per-user, with read state stored in SQLite.
- User management creates accounts with an admin-assigned role and password; deactivated accounts cannot sign in, and their asset/workflow/audit history remains intact.
- AI Assistant answers using aggregate workspace counts only; it does not receive employee-level records and cannot change data. Configure `OPENAI_API_KEY` in the API server environment and restart the server to enable it. Its connection indicator reports whether a key is configured, not whether that key is valid. Document scanning never uses this key.
- Document Scanner runs Tesseract.js on the local CPU and rule-based extraction for invoices, purchase orders, and asset/serial-number documents. Scanned PDF pages are rasterized locally (up to five pages). Extracted text and fields are stored with the private document for review; OCR confidence is a heuristic, so confirm identifiers, amounts, and dates against the source. Invoice review and manual entry are available to finance roles; bank details are returned only to finance officers and admins, while invoice files remain subject to document access rules.
- Uploaded documents are stored under `DATA_DIR/uploads/` with SHA-256 checksums and are served only to permitted roles.
- For production, run behind HTTPS, set a strong `JWT_SECRET`, restrict `DATA_DIR` permissions, and back up `server-data/`. To move to PostgreSQL later, the schema maps 1:1 (TEXT ids replace UUIDs, REAL replaces numeric, TEXT stores ISO timestamps/JSON).

## Verify

```bash
npm run lint
npm run typecheck
npm run build
```
