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

## Local Accounts

Deployment passwords are generated locally and stored in the git-ignored `deployment-credentials.txt` file. Do not publish this file or share credentials with unauthorized users.

## Temporary Cloudflare Sharing

MongoDB must be running. From the project root, run:

```bash
npm run share
```

This builds the production frontend, starts the local production server on port `5050` when needed, creates a new Cloudflare Quick Tunnel, and prints the public HTTPS link. The tunnel runs in the background and can coexist with the development API on port `5000`.

Show the current link again:

```bash
npm run share:status
```

Stop public access:

```bash
npm run share:stop
```

The link is temporary and changes whenever a new tunnel is created. Keep this PC, MongoDB, and the ERP server running while other people use the system.

### Stable Render Access Page

The free Render static site in `link-site/` provides one permanent access-page URL. Every `npm run share` updates `link-site/link.json` with the newest Cloudflare tunnel address.

Publish the current tunnel address after generating it:

```bash
npm run link:publish
```

Or generate a new tunnel and publish its address in one command:

```bash
npm run share:publish
```

Render redeploys the small static site automatically after GitHub receives the link update. The Render page is a stable pointer; the host PC and Cloudflare tunnel must still remain running.

For phones and other computers, share only the generated `https://...trycloudflare.com` address. Do not share `localhost`, port `5050`, or a `192.168.x.x` address because those are local-only. If a phone reports that the hostname cannot be found, switch from office Wi-Fi to mobile data or use Cloudflare DNS `1.1.1.1`; some office DNS servers temporarily cache new Quick Tunnel names as unavailable.

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
