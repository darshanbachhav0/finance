import { AlertTriangle, CircleCheckBig, Download, Eye, FileDown, RefreshCw, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import RequestQuickView from "../components/RequestQuickView.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { banks, requestTypes } from "../utils/options.js";

const amountOf = (row) => Number(row.accountsPayable?.outstandingAmount ?? row.totalAmount ?? 0);
const money = (currency, value) => `${currency || "PEN"} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TreasuryQueue() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [selected, setSelected] = useState([]);
  const [quickViewId, setQuickViewId] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [actionError, setActionError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [bank, setBank] = useState("BCP");
  const [currency, setCurrency] = useState("PEN");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentRow, setPaymentRow] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ operationNumber: "", paidAt: new Date().toISOString().slice(0, 10), confirmedAmount: "", comments: "" });
  const [reconciliationRow, setReconciliationRow] = useState(null);
  const [reconciliationForm, setReconciliationForm] = useState({ bankReference: "", statementAmount: "", comments: "" });
  const queueTable = usePaginatedResource("/treasury/queue");
  const historyTable = usePaginatedResource("/treasury/bank-files");
  const confirmationTable = usePaginatedResource("/treasury/payment-confirmations");
  const reconciliationTable = usePaginatedResource("/treasury/reconciliation");
  const rows = queueTable.rows;
  const history = historyTable.rows;
  const confirmations = confirmationTable.rows;
  const reconciliationRows = reconciliationTable.rows;
  const loading = queueTable.loading || historyTable.loading || confirmationTable.loading || reconciliationTable.loading;
  const resourceError = queueTable.error || historyTable.error || confirmationTable.error || reconciliationTable.error;

  function reloadAll() {
    queueTable.reload();
    historyTable.reload();
    confirmationTable.reload();
    reconciliationTable.reload();
  }

  useEffect(() => {
    setSelected((current) => current.filter((id) => rows.some((row) => row._id === id)));
  }, [rows]);

  const selectedRows = rows.filter((row) => selected.includes(row._id));
  const selectedTotal = useMemo(() => selectedRows.reduce((sum, row) => sum + amountOf(row), 0), [selectedRows]);
  const queueTotals = useMemo(() => Object.fromEntries(Object.entries(queueTable.payload.summary?.totalsByCurrency || {}).map(([key, value]) => [key, Number(value.total || 0)])), [queueTable.payload.summary]);
  const hasBankAccount = (row) => row.activeBankAccounts?.some((account) => account.active && account.bank === bank && account.currency === currency);
  const missingBank = Number(queueTable.payload.summary?.missingBankDetails || 0);

  async function generate() {
    setProcessing(true);
    try {
      const response = await api.post("/treasury/bank-file", { requestIds: selected, bank, currency, paymentDate });
      setResult(response.data);
      setSelected([]);
      setConfirmOpen(false);
      notify("Bank TXT instruction created. Payment remains unconfirmed.");
      setActionError("");
      reloadAll();
    } catch (err) { setActionError(err.message); notify(err.message, "error"); setConfirmOpen(false); } finally { setProcessing(false); }
  }

  function openPaymentConfirmation(row) {
    setPaymentRow(row);
    setPaymentForm({ operationNumber: "", paidAt: new Date().toISOString().slice(0, 10), confirmedAmount: String(row.accountsPayable?.outstandingAmount ?? row.totalAmount ?? ""), comments: "" });
  }
  async function confirmPayment(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/treasury/requests/${paymentRow._id}/confirm-payment`, paymentForm);
      notify("Actual bank payment confirmed; CXP was settled and the payment journal was posted.");
      setPaymentRow(null);
      setActionError("");
      reloadAll();
    } catch (err) { setActionError(err.message); notify(err.message, "error"); } finally { setProcessing(false); }
  }

  function openReconciliation(row) {
    setReconciliationRow(row);
    setReconciliationForm({ bankReference: row.payment?.operationNumber || "", statementAmount: String(row.payment?.confirmedAmount ?? ""), comments: "" });
  }
  async function reconcile(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/treasury/requests/${reconciliationRow._id}/reconcile`, reconciliationForm);
      notify("Payment reconciled. The request is ready for Accounting closure.");
      setReconciliationRow(null);
      setActionError("");
      reloadAll();
    } catch (err) { setActionError(err.message); notify(err.message, "error"); } finally { setProcessing(false); }
  }

  function chooseBank(next) { setBank(next); setSelected([]); }
  function chooseCurrency(next) { setCurrency(next); setSelected([]); }

  return <section>
    <PageHeader title="Treasury Payment Queue" description="Schedule eligible CXP, create bank instructions, confirm actual execution, and reconcile payments." actions={<button type="button" className="secondary-button" onClick={reloadAll} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>} />
    <Message type="error">{actionError || resourceError}</Message>
    <div className="stats-grid"><StatCard label="Payable queue" value={queueTable.pagination.total} tone="amber" /><StatCard label="PEN waiting" value={money("PEN", queueTotals.PEN)} tone="teal" /><StatCard label="USD waiting" value={money("USD", queueTotals.USD)} tone="navy" /><StatCard label="Missing bank details" value={missingBank} tone={missingBank ? "red" : "green"} /><StatCard label="Awaiting payment confirmation" value={confirmationTable.pagination.total} tone={confirmationTable.pagination.total ? "amber" : "green"} /><StatCard label="Awaiting reconciliation" value={reconciliationTable.pagination.total} tone={reconciliationTable.pagination.total ? "amber" : "green"} /></div>
    {missingBank > 0 && <div className="alert-strip error"><AlertTriangle size={20} /><div><strong>{t("Some payments are blocked")}</strong><p>{t("A request needs an active supplier bank account for the selected bank and currency before file generation.")}</p></div></div>}

    {selected.length > 0 && <div className="selection-bar" role="status"><div><strong>{t("{count} requests selected").replace("{count}", selected.length)}</strong><span>{money(currency, selectedTotal)}</span></div><div className="selection-controls"><label className="field compact-control"><span>{t("Payment date")}</span><input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label><button type="button" className="primary-button" onClick={() => setConfirmOpen(true)}><FileDown size={16} /><span>{t("Review bank file")}</span></button></div></div>}
    {result && <div className="success-result" role="status"><div><strong>{t("Bank instruction generated")}</strong><span>{result.fileName} - {result.processed.length} {t("requests")} - {t("Payment is not yet confirmed")}</span></div><ProtectedAssetButton className="primary-button" resourcePath={result.url} fileName={result.fileName}><Download size={16} /><span>{t("Download TXT")}</span></ProtectedAssetButton></div>}

    <div className="workspace-panel"><div className="section-heading"><div><h3>{t("Eligible CXP")}</h3><p>{t("One bank file contains one bank and one currency. Only matching active accounts are selectable.")}</p></div></div><div className="treasury-file-controls"><div className="bank-selector" role="group" aria-label={t("Bank file format")}>{banks.map((item) => <button type="button" key={item} className={bank === item ? "active" : ""} aria-pressed={bank === item} onClick={() => chooseBank(item)}>{item}</button>)}</div><div className="bank-selector compact" role="group" aria-label={t("Currency")}>{["PEN", "USD"].map((item) => <button type="button" key={item} className={currency === item ? "active" : ""} aria-pressed={currency === item} onClick={() => chooseCurrency(item)}>{item}</button>)}</div></div><DataTable rows={rows} loading={queueTable.loading} remote={queueTable.remote} selection={{ selected, onChange: setSelected, isRowSelectable: (row) => row.currency === currency && hasBankAccount(row) }} filters={[{ key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }, { key: "requestType", label: "types", allLabel: "All types", options: requestTypes }]} searchPlaceholder="Search request, supplier, voucher, or Cost Center..." onRowClick={(row) => setQuickViewId(row._id)} rowActions={(row) => [{ label: "Quick view", icon: Eye, onClick: () => setQuickViewId(row._id) }]} columns={[
      { key: "requestNumber", label: "Request", sortable: false, render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> }, { key: "supplier", label: "Supplier", sortable: false, getValue: (row) => row.supplier?.legalName || row.supplier?.name, render: (row) => <div className="primary-cell"><strong>{row.supplier?.legalName || row.supplier?.name}</strong><span>{row.supplier?.rucDni}</span></div> },
      { key: "bank", label: "Selected bank account", sortable: false, getValue: (row) => row.activeBankAccounts?.map((account) => `${account.bank} ${account.cci}`).join(" "), render: (row) => { const account = row.activeBankAccounts?.find((item) => item.bank === bank && item.currency === currency); return account ? <div className="primary-cell"><strong>{account.bank} - {account.currency}</strong><span>{account.cci || account.accountNumber}</span></div> : <span className="inline-error"><AlertTriangle size={15} />{t("No matching active account")}</span>; } },
      { key: "requestType", label: "Type", sortable: false }, { key: "currency", label: "Currency" }, { key: "accountsPayable", label: "CXP status", sortable: false, getValue: (row) => row.accountsPayable?.status, render: (row) => <StatusBadge status={row.accountsPayable?.status} /> }, { key: "amount", sortKey: "outstandingAmount", label: "Outstanding", align: "right", getValue: amountOf, render: (row) => <strong>{money(row.currency, amountOf(row))}</strong> }, { key: "dueDate", label: "Due date", getValue: (row) => row.accountsPayable?.dueDate, render: (row) => row.accountsPayable?.dueDate ? new Date(row.accountsPayable.dueDate).toLocaleDateString() : "-" }
    ]} /></div>

    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Payment confirmation")}</h3><p>{t("Confirm only after the bank has actually executed the instruction.")}</p></div><span className="section-count">{confirmationTable.pagination.total}</span></div><DataTable rows={confirmations} loading={confirmationTable.loading} remote={confirmationTable.remote} rowActions={(row) => [{ label: "Confirm payment", icon: CircleCheckBig, onClick: () => openPaymentConfirmation(row) }]} columns={[
      { key: "requestNumber", label: "Request", sortable: false, render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> }, { key: "supplier", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name }, { key: "batch", label: "Bank batch", sortable: false, getValue: (row) => row.accountsPayable?.paymentBatch?.batchNumber, render: (row) => `${row.accountsPayable?.paymentBatch?.batchNumber || "-"} / ${row.accountsPayable?.paymentBatch?.bank || "-"}` }, { key: "status", label: "Request status", sortable: false, render: (row) => <StatusBadge status={row.status} /> }, { key: "amount", sortKey: "outstandingAmount", label: "Amount", align: "right", getValue: amountOf, render: (row) => <strong>{money(row.currency, amountOf(row))}</strong> }
    ]} /></div>

    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Reconciliation")}</h3><p>{t("Match the confirmed payment to the bank statement before Accounting closure.")}</p></div><span className="section-count">{reconciliationTable.pagination.total}</span></div><DataTable rows={reconciliationRows} loading={reconciliationTable.loading} remote={reconciliationTable.remote} rowActions={(row) => [{ label: "Reconcile payment", icon: Scale, onClick: () => openReconciliation(row) }]} columns={[
      { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> }, { key: "supplier", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name }, { key: "operation", sortKey: "payment.operationNumber", label: "Operation number", getValue: (row) => row.payment?.operationNumber, render: (row) => row.payment?.operationNumber || "-" }, { key: "paidAt", sortKey: "payment.paidAt", label: "Paid date", getValue: (row) => row.payment?.paidAt, render: (row) => row.payment?.paidAt ? new Date(row.payment.paidAt).toLocaleDateString() : "-" }, { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }, { key: "amount", sortKey: "payment.confirmedAmount", label: "Confirmed", align: "right", getValue: (row) => row.payment?.confirmedAmount, render: (row) => <strong>{money(row.currency, row.payment?.confirmedAmount)}</strong> }
    ]} /></div>

    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Generated bank-file history")}</h3><p>{t("Every batch retains its checksum, adapter mode, items, and generation user.")}</p></div></div><DataTable rows={history} loading={historyTable.loading} remote={historyTable.remote} filters={[{ key: "bank", label: "banks", allLabel: "All banks", options: banks }, { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }]} columns={[
      { key: "batchNumber", label: "Batch" }, { key: "fileName", label: "File", render: (row) => <ProtectedAssetButton resourcePath={row.url} fileName={row.fileName}>{row.fileName}</ProtectedAssetButton> }, { key: "bank", label: "Bank" }, { key: "currency", label: "Currency" }, { key: "items", label: "Requests", sortable: false, getValue: (row) => row.items?.map((item) => item.requestNumber).join(" "), render: (row) => row.items?.length || 0 }, { key: "totalAmount", label: "Total", align: "right", render: (row) => money(row.currency, row.totalAmount) }, { key: "adapterMode", label: "Format", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.adapterMode}</strong><span>{row.specificationVersion}</span></div> }, { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }, { key: "generatedAt", label: "Generated", render: (row) => new Date(row.generatedAt).toLocaleString() }, { key: "download", label: "", sortable: false, render: (row) => <ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.fileName} title="Download"><Download size={16} /></ProtectedAssetButton> }
    ]} /></div>

    <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
    <ConfirmDialog open={confirmOpen} title="Generate this bank TXT instruction?" description="This creates a DEMO / NOT CERTIFIED payment instruction and changes selected requests to TXT_GENERADO. It does not settle CXP or confirm payment." details={[{ label: "Selected requests", value: selected.length }, { label: "Bank", value: bank }, { label: "Currency", value: currency }, { label: "Payment date", value: paymentDate }, { label: "Total", value: money(currency, selectedTotal) }, { label: "Result", value: "A persistent batch and TXT are created; payment confirmation remains a separate required action." }]} confirmLabel="Generate bank TXT" loading={processing} onClose={() => !processing && setConfirmOpen(false)} onConfirm={generate} />
    <Drawer open={Boolean(paymentRow)} title="Confirm actual bank payment" description={paymentRow ? `${paymentRow.requestNumber} - ${paymentRow.supplier?.legalName || paymentRow.supplier?.name}` : ""} onClose={() => !processing && setPaymentRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setPaymentRow(null)}>{t("Cancel")}</button><button type="submit" form="payment-confirmation-form" className="primary-button" disabled={processing}><CircleCheckBig size={16} /><span>{t(processing ? "Processing..." : "Confirm payment")}</span></button></>}><div className="document-requirement required"><AlertTriangle size={20} /><div><strong>{t("This settles Accounts Payable")}</strong><p>{t("Confirmation posts the payment journal, updates budget paid figures, and cannot be inferred from a downloaded TXT.")}</p></div></div><form id="payment-confirmation-form" className="form-grid" onSubmit={confirmPayment}><label className="field"><span>{t("Operation number")} *</span><input required value={paymentForm.operationNumber} onChange={(event) => setPaymentForm({ ...paymentForm, operationNumber: event.target.value })} /></label><label className="field"><span>{t("Actual payment date")} *</span><input required type="date" value={paymentForm.paidAt} onChange={(event) => setPaymentForm({ ...paymentForm, paidAt: event.target.value })} /></label><label className="field"><span>{t("Confirmed amount")} *</span><input required type="number" min="0.01" step="0.01" value={paymentForm.confirmedAmount} onChange={(event) => setPaymentForm({ ...paymentForm, confirmedAmount: event.target.value })} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={paymentForm.comments} onChange={(event) => setPaymentForm({ ...paymentForm, comments: event.target.value })} /></label></form></Drawer>
    <Drawer open={Boolean(reconciliationRow)} title="Reconcile bank payment" description={reconciliationRow?.requestNumber || ""} onClose={() => !processing && setReconciliationRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setReconciliationRow(null)}>{t("Cancel")}</button><button type="submit" form="reconciliation-form" className="primary-button" disabled={processing}><Scale size={16} /><span>{t(processing ? "Processing..." : "Reconcile")}</span></button></>}><form id="reconciliation-form" className="form-grid" onSubmit={reconcile}><label className="field"><span>{t("Bank reference")} *</span><input required value={reconciliationForm.bankReference} onChange={(event) => setReconciliationForm({ ...reconciliationForm, bankReference: event.target.value })} /></label><label className="field"><span>{t("Statement amount")} *</span><input required type="number" min="0.01" step="0.01" value={reconciliationForm.statementAmount} onChange={(event) => setReconciliationForm({ ...reconciliationForm, statementAmount: event.target.value })} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={reconciliationForm.comments} onChange={(event) => setReconciliationForm({ ...reconciliationForm, comments: event.target.value })} /></label></form></Drawer>
  </section>;
}
