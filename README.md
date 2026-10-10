# bigbasket ITAM

Internal IT asset management workspace for Bigbasket — asset register and lifecycle, employee equipment requests, inventory, warranties, write-offs, procurement, invoices, notifications, and service desk. Self-hosted: Node.js API + SQLite, no external backend services required.

## Stack

- **Frontend**: React 18 + TypeScript + Vite 5 + Tailwind CSS
- **Backend**: Node.js + Express API server (`server/`)
- **Database**: SQLite (`server-data/itam.db`) — file-based, zero-config
- **Auth**: email + password with scrypt hashing and signed JWT sessions (7-day expiry)
- **AI**: OpenAI (gpt-4o-mini) for invoice field extraction and aggregate-only operational Q&A, called server-side

## Setup

```bash
npm install
npm run dev
```

`npm run dev` starts both the API server (port 3001) and the Vite dev server. The first account you create is automatically assigned the `admin` role; every later signup becomes `employee`.

## Environment (`.env`)

Copy `.env.example` to `.env`:

- `PORT` — API server port (default 3001)
- `VITE_API_URL` — API base URL used by the frontend
- `JWT_SECRET` — strong random secret for session signing (generated for you in `.env`)
- `DATA_DIR` — where the SQLite database and uploaded files live (git-ignored)
- `OPENAI_API_KEY` — server-side key used for AI Assistant and invoice extraction; set it in the API server environment (a GitHub Actions secret is not automatically available to a running server)

## Roles

`admin`, `it_asset_manager`, `procurement_officer`, `finance_officer`, `approver`, `employee`, `auditor` — enforced by the API on every endpoint, mirroring the original row-level security model:

- **Read** operational data: any active signed-in user
- **Assets**: write = admin / it_asset_manager, delete = admin
- **Invoices**: create, update, and AI extraction = admin / finance_officer; delete = admin
- **Employee asset requests**: submit = active employee / admin / asset manager; review = admin / asset manager; employees see only their own requests
- **Write-offs**: request = admin / asset manager; final approve/reject = admin; approval retires the asset and writes an asset event
- **Inventory receipts**: create/update = admin / asset manager / procurement officer
- **Tickets**: create = any active user, update = admin / it_asset_manager, delete = admin
- **Purchase requests**: create = admin / procurement_officer / employee, update = admin / procurement_officer / approver, delete = admin
- **Documents**: private per-user; admin / finance_officer / auditor can read all
- **Audit log**: admin / auditor read-only
- **User management**: admin only; admins can create users, assign workspace roles, and deactivate/reactivate accounts. The workspace always retains at least one active administrator, and account changes retain the user's operational history.

## Production notes

- Record numbers (`TKT-000001…`, `PR-000001…`, `GR-000001…`) are issued by the server from sequences — clients never invent identifiers.
- Asset registration and lifecycle actions write timestamped events with the acting user. Asset managers can assign, return, transfer, quarantine, retire, audit, and record maintenance start/completion from the asset history.
- Lifecycle status and custodian changes use the asset event endpoint so they cannot bypass the history record; audit and maintenance updates are committed together with the asset change.
- Employee equipment requests have their own approval queue and notify asset managers. Write-offs require admin review; approval retires the asset and adds a traceable lifecycle event.
- Inventory shows available registered assets alongside goods receipt history. The warranty register derives coverage from the warranty dates stored on assets.
- Profile settings update the signed-in user's name and department. Notifications are per-user, with read state stored in SQLite.
- User management creates accounts with an admin-assigned role and password; deactivated accounts cannot sign in, and their asset/workflow/audit history remains intact.
- AI Assistant answers using aggregate workspace counts only; it does not receive employee-level records and cannot change data. Configure `OPENAI_API_KEY` in the API server environment and restart the server to enable it. Its connection indicator reports whether a key is configured, not whether that key is valid. Invoice extraction uses the same key.
- Invoice review supports AI extraction and manual entry; extracted line items and document references are saved with the invoice. Bank details are returned only to finance officers and admins, while invoice files remain subject to document access rules.
- Uploaded documents are stored under `DATA_DIR/uploads/` with SHA-256 checksums and are served only to permitted roles.
- For production, run behind HTTPS, set a strong `JWT_SECRET`, restrict `DATA_DIR` permissions, and back up `server-data/`. To move to PostgreSQL later, the schema maps 1:1 (TEXT ids replace UUIDs, REAL replaces numeric, TEXT stores ISO timestamps/JSON).

## Verify

```bash
npm run lint
npm run typecheck
npm run build
```
