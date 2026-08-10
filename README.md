# UMA Integrated CAPEX / OPEX / Accounts Payable Management System

Production-oriented, modular ERP for controlling the institutional expenditure lifecycle from request intake through approval, budget commitment, Accounts Payable, Treasury, payment confirmation, reconciliation, close, and audit.

The application upgrades the existing React/Vite + Express/MongoDB project in place. Uploaded evidence and generated files remain on the local host.

## Architecture

- Frontend: React 18, Vite, React Router, Axios, Lucide icons, Floating UI.
- Backend: Node.js, Express, Mongoose, JWT, bcrypt, Helmet, CORS, rate limiting.
- Database: MongoDB.
- Storage: `backend/uploads` and `backend/generated`, with metadata stored in MongoDB.
- Languages: English and Spanish.

## Functional Areas

1. CAPEX/OPEX and special-flow requests.
2. Supplier master, homologation, and bank-account history.
3. Document rules and XML fiscal consistency validation.
4. Configurable hierarchical approvals, authenticated sign-off, and SLA.
5. Dimensional budget allocation, commitment, exception, release, execution, and payment control.
6. Fiscal processing, balanced journals, and explicit Accounts Payable records.
7. Treasury scheduling, bank-file batches, actual payment confirmation, and reconciliation.
8. SIRE/RCE preparation, month-end consolidation, reports, dashboards, and immutable audit history.

## Canonical Workflow

```text
BORRADOR -> EN_VALIDACION -> ENVIADO -> PENDIENTE_APROBACION
-> APROBADO_DIRECTOR -> APROBADO_VICERRECTOR
-> COMPROMISO_PRESUPUESTAL -> CONTABILIZADO -> PROGRAMADO
-> TXT_GENERADO -> PAGADO -> CONCILIADO -> CERRADO
```

`OBSERVADO`, `DEVUELTO`, `RECHAZADO`, and `ANULADO` are controlled exception states. `ENTREGA_RENDIR` moves from confirmed payment to `RENDICION_PENDIENTE`; it cannot close until the rendition is validated.

Important: generating a bank TXT creates a payment instruction and changes the request to `TXT_GENERADO`. It does **not** settle Accounts Payable. Treasury must record the real bank operation, date, and confirmed amount before the request becomes `PAGADO`.

## Roles

- `Admin`: technical administration, users, master data, and audited override capability.
- `Solicitor`: own requests, drafts/corrections, supplier proposals, and renditions.
- `Approver`: assigned Director or Vice Rector approvals, SLA, budget visibility, and reports.
- `Accounting`: supplier homologation, fiscal processing, CXP, journals, periods, SIRE, FX, and audit.
- `Treasury`: payable scheduling, bank batches, payment confirmation, reconciliation, and bank-detail viewing.
- `Budget`: allocations, commitments, exceptions, and budget reporting.
- `Management`: executive reporting and configured extraordinary approvals.

Backend permission checks are authoritative. Frontend navigation only reflects those permissions.

## Requirements and Installation

- Node.js 18 or newer.
- MongoDB available locally or through the configured connection string.

```powershell
npm install
Copy-Item backend\.env.example backend\.env
npm run seed
npm run dev
```

- Frontend: `http://localhost:5174`
- Backend health: `http://localhost:5000/health`

Set a strong `JWT_SECRET` before any shared or production-style use. Update `CLIENT_URLS` with every allowed frontend origin.

## Development Demo Users

These credentials are created only by the development seed and must not be used in production.

| Profile | Email | Password |
|---|---|---|
| Admin | `admin@erp.local` | `Admin12345!` |
| Solicitor | `solicitor@erp.local` | `User123456!` |
| Area Director | `director@erp.local` | `Director123!` |
| Vice Rector | `vicerector@erp.local` | `ViceRector123!` |
| Accounting | `accounting@erp.local` | `Accounting123!` |
| Treasury | `treasury@erp.local` | `Treasury123!` |
| Budget | `budget@erp.local` | `Budget12345!` |
| Management | `management@erp.local` | `Management123!` |

The seed is idempotent and includes representative master data and lifecycle scenarios. To reset only a database whose name clearly identifies it as development:

```powershell
npm run seed:reset
npm run seed
```

The reset command is disabled when `NODE_ENV=production` and requires its built-in confirmation flag.

## Tests and Build

```powershell
npm test
npm run build
npm run verify
```

The backend suite covers the 33 critical financial controls, plus security and contract tests. The frontend suite covers canonical contracts, role navigation, remote table queries, and accessible row-menu keyboard behavior. There is no separate lint script in the current repository.

## Existing-Data Migration

Back up first, inspect the dry-run report, then apply once approved:

```powershell
npm run backup
npm run migrate:workflow
npm run migrate:workflow:apply
npm run verify:data
```

Migration reports are written under `backend/migration-reports`. Ambiguous historical accounting/payment records are reported for manual review instead of being silently reinterpreted. No collection is dropped and historical request numbers are retained.

## Local Storage and Backup

- Request evidence: `backend/uploads/requests/{requestId}`
- Supplier evidence: `backend/uploads/suppliers/{supplierId}`
- Bank files: `backend/generated/bank-files`
- Reports: `backend/generated/reports`
- Accounting exports: `backend/generated/accounting`

`npm run backup` exports MongoDB collections as Extended JSON and copies both upload and generated-file directories into a timestamped `backend/backups` folder. A usable recovery point requires all three parts.

## External Integration Limits

- SUNAT: provider abstraction with `MOCK`, authorized `MANUAL`, and unconfigured production placeholder modes. No production endpoint or credentials are fabricated.
- Exchange rates: PEN is 1. USD requires an exact dated record. Optional BCRP online retrieval is editable reference data and is not labelled as the authoritative SUNAT selling rate.
- SIRE/RCE: validated preparation and CSV export only; there is no direct SUNAT submission.
- Banks: BCP, BBVA, Interbank, and Scotiabank adapters are `DEMO / NOT CERTIFIED` until UMA supplies approved field specifications.
- Sign-off: authenticated electronic approval with user, role, IP, timestamp, reference, and request hash; it is not described as a certified legal digital signature.

See `docs/EXTERNAL_INTEGRATIONS.md` for configuration and certification requirements.

## Temporary Cloudflare Sharing

With MongoDB and this PC running:

```powershell
npm run share
npm run share:status
npm run share:stop
```

The generated `trycloudflare.com` URL is temporary. `npm run share:publish` also publishes the current tunnel URL to the stable Render access page. The local PC, ERP server, MongoDB, and tunnel must remain running.

## Documentation

- `docs/GAP_ANALYSIS.md`: baseline comparison made before implementation.
- `docs/IMPLEMENTATION_PLAN.md`: phased implementation record.
- `docs/REQUIREMENTS_TRACEABILITY.md`: requirement-to-code/test mapping.
- `docs/EXTERNAL_INTEGRATIONS.md`: honest integration capabilities and limits.
- `docs/ARCHITECTURE.md`: system and domain architecture.
- `docs/MIGRATION_AND_OPERATIONS.md`: migration, backup, seed, run, and recovery procedures.
- `docs/USER_MANUAL.md`: English/Spanish operator manual source.
- `documentation/UMA_Integrated_ERP_User_and_Operations_Manual_EN_ES.docx`: polished bilingual Word manual.
