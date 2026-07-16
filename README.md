# ERP Financial Request & Payment Control System

Complete local full-stack ERP module for financial requests, document validation, approval workflow, accounting provision, Treasury bank TXT generation, SIRE/RCE export preparation, and monthly closing controls.

## Requirements

- Node.js 18+
- MongoDB running locally
- MongoDB Compass optional for inspection

Default database:

```bash
mongodb://127.0.0.1:27017/erp_financial_system
```

## Install

From the project root:

```bash
npm install
```

Copy the backend environment file:

```bash
copy backend\.env.example backend\.env
```

Seed demo data:

```bash
npm run seed
```

Run backend and frontend together:

```bash
npm run dev
```

Frontend: `http://localhost:5174`

Backend: `http://localhost:5000`

For LAN access, use your machine IP on the same ports, for example:

```bash
http://192.168.5.168:5174
```

The platform includes an English/Spanish toggle on the login screen and top navigation bar. The selected language is saved in the browser.

## Demo Users

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@erp.local` | `Admin123!` |
| Solicitor | `solicitor@erp.local` | `User123!` |
| Approver | `approver@erp.local` | `Approver123!` |
| Accounting | `accounting@erp.local` | `Accounting123!` |
| Treasury | `treasury@erp.local` | `Treasury123!` |

## Main Workflow

1. Admin or Accounting maintains suppliers, cost centers, expense types, exchange rates, and accounting periods.
2. Solicitor creates a financial request with required CeCo and expense account on every line.
3. XML/PDF are mandatory for `Pago con Cotización` and `Reembolso con Sustento`.
4. XML is parsed as source of truth and compared against supplier RUC/DNI, net, IGV, and total amounts.
5. Solicitor submits the request to approval.
6. Approver approves or rejects with comments.
7. Approval moves the request to `APROBADO_POR_PAGAR` and generates provision accounting entries.
8. Treasury selects payable requests and generates the bank TXT file.
9. Bank file generation creates payment entries and moves requests to `PROCESADO_BANCO`, except `Entrega a Rendir`, which moves to `RENDICION_PENDIENTE`.
10. Entrega a Rendir closes after receipts/supporting files are uploaded, generating the real expense recognition entry.
11. Accounting can preview and export month-end consolidation and SIRE/RCE CSV/JSON files.
12. Closed periods block create, edit, delete, approval, payment, and closing operations for that period.

## Project Structure

```text
backend/
  src/
    config/
    controllers/
    middleware/
    models/
    routes/
    seed/
    services/
    uploads/
    utils/
  server.js
frontend/
  src/
    api/
    components/
    context/
    layouts/
    pages/
    routes/
    styles/
    utils/
```

Uploaded request files and generated bank TXT files are stored under `backend/uploads`.
