# bigbasket ITAM

Internal IT asset management workspace for Bigbasket — asset register, procurement, AI-assisted invoice review, and service desk. Self-hosted: Node.js API + SQLite, no external backend services required.

## Stack

- **Frontend**: React 18 + TypeScript + Vite 5 + Tailwind CSS
- **Backend**: Node.js + Express API server (`server/`)
- **Database**: SQLite (`server-data/itam.db`) — file-based, zero-config
- **Auth**: email + password with scrypt hashing and signed JWT sessions (7-day expiry)
- **AI**: OpenAI (gpt-4o-mini) for invoice field extraction, called server-side

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
- `OPENAI_API_KEY` — optional; invoice AI returns a clear "not configured" error when absent

## Roles

`admin`, `it_asset_manager`, `procurement_officer`, `finance_officer`, `approver`, `employee`, `auditor` — enforced by the API on every endpoint, mirroring the original row-level security model:

- **Read** operational data: any active signed-in user
- **Assets**: write = admin / it_asset_manager, delete = admin
- **Invoices**: write = admin / finance_officer, delete = admin
- **Tickets**: create = any active user, update = admin / it_asset_manager, delete = admin
- **Purchase requests**: create = admin / procurement_officer / employee, update = admin / procurement_officer / approver, delete = admin
- **Documents**: private per-user; admin / finance_officer / auditor can read all
- **Audit log**: admin / auditor read-only

## Production notes

- Record numbers (`TKT-000001…`, `PR-000001…`, `GR-000001…`) are issued by the server from sequences — clients never invent identifiers.
- Asset registration automatically writes a `REGISTERED` lifecycle event.
- Uploaded documents are stored under `DATA_DIR/uploads/` with SHA-256 checksums and are served only to permitted roles.
- For production, run behind HTTPS, set a strong `JWT_SECRET`, restrict `DATA_DIR` permissions, and back up `server-data/`. To move to PostgreSQL later, the schema maps 1:1 (TEXT ids replace UUIDs, REAL replaces numeric, TEXT stores ISO timestamps/JSON).

## Verify

```bash
npm run lint
npm run typecheck
npm run build
```
