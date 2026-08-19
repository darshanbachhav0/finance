import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CornerUpLeft,
  Download,
  FileCheck2,
  FileText,
  MessageSquareWarning,
  Pencil,
  Printer,
  Send,
  Trash2,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/client.js";
import ApprovalTimeline from "../components/ApprovalTimeline.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import OfficialRenditionWorkspace from "../components/rendition/OfficialRenditionWorkspace.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { expenseNatureLabels, optionLabel, requestTypeLabels } from "../utils/options.js";

const workflow = ["BORRADOR", "PENDIENTE_APROBACION", "COMPROMISO_PRESUPUESTAL", "CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PAGADO", "CONCILIADO", "CERRADO"];
const statusPosition = {
  EN_VALIDACION: 1,
  ENVIADO: 1,
  APROBADO_DIRECTOR: 1,
  APROBADO_VICERRECTOR: 2,
  RENDICION_PENDIENTE: 6
};
const interruptionStatuses = ["OBSERVADO", "DEVUELTO", "RECHAZADO", "ANULADO"];
const emptyRelated = { accountsPayable: [], journalEntries: [], paymentBatches: [], reconciliation: null, audit: [], budgetPreview: { status: "PENDING_VALIDATION", lines: [] } };

function RequestStatusFlow({ request }) {
  const { t } = useLanguage();
  const currentIndex = statusPosition[request.status] ?? workflow.indexOf(request.status);
  return <ol className="status-flow" aria-label={t("Request workflow status")}>
    {workflow.map((status, index) => <li key={status} className={`${index < currentIndex ? "completed" : ""} ${index === currentIndex ? "active" : ""}`}><span className="status-flow-dot">{index < currentIndex ? <Check size={14} /> : index + 1}</span><span>{t(status)}</span></li>)}
    {interruptionStatuses.includes(request.status) && <li className="rejected active"><span className="status-flow-dot"><XCircle size={14} /></span><span>{t(request.status)}</span></li>}
  </ol>;
}

export default function RequestDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [request, setRequest] = useState(null);
  const [related, setRelated] = useState(emptyRelated);
  const [requirements, setRequirements] = useState([]);
  const [masters, setMasters] = useState({ costCenters: [], expenseTypes: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [confirm, setConfirm] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const response = await api.get(`/requests/${id}`);
      const nextRequest = response.data.data;
      setRequest(nextRequest);
      setRelated(response.data.related || emptyRelated);
      const [requirementsResponse, centersResponse, expensesResponse] = await Promise.all([
        api.get("/requests/document-requirements", { params: { requestType: nextRequest.requestType, expenseNature: nextRequest.expenseNature } }),
        api.get("/cost-centers", { params: { pageSize: 100, active: true } }),
        api.get("/expense-types", { params: { pageSize: 100, active: true } })
      ]);
      setRequirements(requirementsResponse.data.data || []);
      setMasters({ costCenters: centersResponse.data.data || [], expenseTypes: expensesResponse.data.data || [] });
      setError("");
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]);

  const permissions = useMemo(() => {
    if (!request) return {};
    const ownerId = request.requester?._id || request.solicitor?._id || request.requester || request.solicitor;
    const owner = String(ownerId) === String(user._id);
    const modifiable = ["BORRADOR", "RECHAZADO", "OBSERVADO", "DEVUELTO"].includes(request.status) && (user.role === "Admin" || owner);
    return {
      owner,
      modifiable,
      deletable: ["BORRADOR", "RECHAZADO"].includes(request.status) && (user.role === "Admin" || owner),
      canApprove: ["PENDIENTE_APROBACION", "APROBADO_DIRECTOR", "APROBADO_VICERRECTOR"].includes(request.status) && ["Admin", "Approver", "Management"].includes(user.role) && (user.role === "Admin" || user.approvalLevel === request.approvalStage),
      canCommitBudget: request.status === "APROBADO_VICERRECTOR" && ["Admin", "Budget"].includes(user.role),
      canClose: request.status === "CONCILIADO" && ["Admin", "Accounting"].includes(user.role),
      canVoid: !["BORRADOR", "CERRADO", "ANULADO"].includes(request.status) && ["Admin", "Accounting"].includes(user.role)
    };
  }, [request, user]);

  const missingDocuments = useMemo(() => requirements.map((rule) => {
    const present = request?.attachments?.filter((item) => item.kind === rule.kind).length || 0;
    return { ...rule, present };
  }).filter((rule) => rule.present < rule.minCount), [requirements, request]);
  const journalLines = useMemo(() => (related.journalEntries || []).flatMap((journal) => (journal.lines || []).map((line) => ({ ...line, _id: line._id || `${journal._id}-${line.accountNumber}`, entryNumber: journal.entryNumber, entryType: journal.entryType, period: journal.period, createdAt: journal.createdAt }))), [related.journalEntries]);

  async function runAction(type, comments = "") {
    setProcessing(true);
    try {
      if (["approve", "observe", "return", "reject"].includes(type)) await api.post(`/approvals/${id}/${type}`, { comments });
      if (type === "budget") await api.post(`/budget/requests/${id}/commit`);
      if (type === "close") await api.post(`/requests/${id}/close`, { comments });
      if (type === "void") await api.post(`/requests/${id}/void`, { comments });
      if (type === "delete") {
        await api.delete(`/requests/${id}`);
        notify("Draft request permanently deleted.");
        navigate("/requests");
        return;
      }
      notify({ approve: "Electronic approval recorded.", observe: "Request observed.", return: "Request returned for correction.", reject: "Request rejected.", budget: "Budget control completed.", close: "Request closed.", void: "Request annulled and any reservation was released." }[type]);
      setConfirm(null);
      await load();
    } catch (err) { setError(`${err.message}${err.code ? ` (${err.code})` : ""}`); notify(err.message, "error"); setConfirm(null); } finally { setProcessing(false); }
  }

  async function submitRequest() {
    setProcessing(true);
    try { await api.post(`/requests/${id}/submit`); notify("Request submitted for approval."); await load(); }
    catch (err) { setError(err.message); notify(err.message, "error"); } finally { setProcessing(false); }
  }

  function decision(type) {
    const details = { label: "Request", value: request.requestNumber };
    const actions = {
      approve: { title: "Approve this request?", description: "Record an authenticated electronic sign-off and advance the configured route.", confirmLabel: "Approve request", inputLabel: "Approval comments", details: [details, { label: "Result", value: "The configured route advances; budget remains a separate controlled stage." }] },
      observe: { title: "Observe this request?", description: "Return it for documented corrections without erasing history.", confirmLabel: "Observe request", tone: "danger", inputLabel: "Observation comments", inputRequired: true, details: [details, { label: "Result", value: "Status changes to OBSERVADO." }] },
      return: { title: "Return this request?", description: "Return it to its owner with a mandatory explanation.", confirmLabel: "Return request", tone: "danger", inputLabel: "Return comments", inputRequired: true, details: [details, { label: "Result", value: "Status changes to DEVUELTO." }] },
      reject: { title: "Reject this request?", description: "Reject it and preserve the complete decision record.", confirmLabel: "Reject request", tone: "danger", inputLabel: "Rejection comments", inputRequired: true, details: [details, { label: "Result", value: "Status changes to RECHAZADO." }] }
    };
    setConfirm({ type, ...actions[type] });
  }

  if (loading && !request) return <div className="page-loader">{t("Loading request...")}</div>;
  return <section>
    <PageHeader title={request?.requestNumber || "Request details"} description={request ? `${t(optionLabel(request.requestType, requestTypeLabels))} - ${request.supplier?.legalName || request.supplier?.name || ""}` : ""} actions={<div className="page-actions"><Link className="secondary-button" to="/requests"><ArrowLeft size={16} /><span>{t("Back to list")}</span></Link><button type="button" className="secondary-button" onClick={() => window.print()}><Printer size={16} /><span>{t("Print record")}</span></button>{permissions.modifiable && <Link className="secondary-button" to={`/requests/${id}/edit`}><Pencil size={16} /><span>{t("Edit request")}</span></Link>}{permissions.deletable && <button type="button" className="danger-button subtle" onClick={() => setConfirm({ type: "delete", title: "Permanently delete this request?", description: "Only a permitted draft or rejected record can be deleted.", confirmLabel: "Delete permanently", tone: "danger", details: [{ label: "Request", value: request.requestNumber }, { label: "Result", value: "The draft record and stored draft files are removed." }] })}><Trash2 size={16} /><span>{t("Delete")}</span></button>}</div>} />
    <Message type="error">{error}</Message>
    {request && <>
      <div className="request-summary-header"><div className="request-summary-main"><StatusBadge status={request.status} /><div><span>{t("Supplier")}</span><strong>{request.supplier?.legalName || request.supplier?.name}</strong><small>{[request.supplier?.supplierCode, request.supplier?.rucDni].filter(Boolean).join(" · ")}</small></div><div><span>{t("Requested by")}</span><strong>{request.requester?.name || request.solicitor?.name}</strong><small>{request.requesterArea || request.requestingArea}</small></div></div><div className="request-amount-summary"><span>{t("Total amount")}</span><strong>{request.currency} {Number(request.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong><small>{t("PEN equivalent")}: {Number(request.totalPENEquivalent ?? request.penEquivalent ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</small></div></div>
      <div className="workspace-panel status-workspace"><RequestStatusFlow request={request} /></div>
      <div className="request-detail-layout"><div className="request-detail-main">
        <div className="workspace-panel detail-section">
          <div className="section-heading"><div><h3>{t("General information")}</h3><p>{request.title || request.description}</p></div></div>
          <dl className="detail-grid">
            <div><dt>{t("Request type")}</dt><dd>{t(optionLabel(request.requestType, requestTypeLabels))}</dd></div>
            <div><dt>{t("Expense nature")}</dt><dd>{t(optionLabel(request.expenseNature, expenseNatureLabels))}</dd></div>
            <div><dt>{t("Priority")}</dt><dd><span className={`priority priority-${String(request.priority || "MEDIA").toLowerCase()}`}>{t(request.priority || "MEDIA")}</span></dd></div>
            <div><dt>{t("Area correlative")}</dt><dd>{request.areaCorrelative || "-"}</dd></div>
            <div><dt>{t("Area")}</dt><dd>{request.requesterArea || request.requestingArea || "-"}</dd></div>
            <div><dt>{t("School / department")}</dt><dd>{request.schoolOrDepartment || "-"}</dd></div>
            <div><dt>{t("Cost Center / CECO")}</dt><dd>{request.requesterCostCenter ? `${request.requesterCostCenter.code} - ${request.requesterCostCenter.name}` : "-"}</dd></div>
            <div><dt>{t("Issue date")}</dt><dd>{request.issueDate?.slice(0, 10)}</dd></div>
            <div><dt>{t("Accounting period")}</dt><dd>{request.accountingPeriod}</dd></div>
            <div><dt>{t("Exchange rate")}</dt><dd>{Number(request.exchangeRate || 1).toFixed(4)} ({request.exchangeRateSource || "PEN"})</dd></div>
            <div><dt>{t("Approval level")}</dt><dd>{request.approvalStage || "-"}</dd></div>
            <div><dt>{t("SLA due")}</dt><dd>{request.approvalDueAt ? new Date(request.approvalDueAt).toLocaleString() : "-"}</dd></div>
          </dl>
        </div>

        {(request.title || request.businessJustification || request.nonApprovalRisk) && <div className="workspace-panel detail-section">
          <div className="section-heading"><div><h3>{t("Requirement and justification")}</h3><p>{t("Official RCO-FOR-001 decision information.")}</p></div></div>
          <dl className="detail-grid narrative-grid">
            <div className="wide"><dt>{t("Requirement title")}</dt><dd>{request.title || "-"}</dd></div>
            <div className="wide"><dt>{t("Detailed description")}</dt><dd>{request.detailedDescription || request.description || "-"}</dd></div>
            <div className="wide"><dt>{t("Business justification")}</dt><dd>{request.businessJustification || "-"}</dd></div>
            <div className="wide"><dt>{t("Risk if not approved")}</dt><dd>{request.nonApprovalRisk || "-"}</dd></div>
          </dl>
        </div>}

        {request.requestType === "CAPEX" && <div className="workspace-panel detail-section"><div className="section-heading"><div><h3>{t("CAPEX financial information")}</h3><p>{t("Planning values supplied with the requirement; no automatic investment calculation is implied.")}</p></div></div><dl className="detail-grid"><div><dt>{t("Project / PEP")}</dt><dd>{request.capexDetails?.projectSnapshot?.code ? `${request.capexDetails.projectSnapshot.code} - ${request.capexDetails.projectSnapshot.name}` : request.capexDetails?.projectPep || request.project || "-"}</dd></div><div><dt>{t("Fixed asset category")}</dt><dd>{t(request.capexDetails?.assetCategory || "-")}</dd></div><div><dt>{t("Useful life (years)")}</dt><dd>{request.capexDetails?.usefulLifeYears ?? "-"}</dd></div><div><dt>{t("NPV / VAN")}</dt><dd>{request.capexDetails?.npv?.amount === undefined ? "-" : `${request.capexDetails.npv.currency || request.currency} ${Number(request.capexDetails.npv.amount).toFixed(2)}`}</dd></div><div><dt>{t("Payback")}</dt><dd>{request.capexDetails?.payback?.value === undefined ? "-" : `${request.capexDetails.payback.value} ${t(request.capexDetails.payback.unit)}`}</dd></div></dl></div>}
        {request.requestType === "OPEX" && request.opexDetails?.expenseFrequency && <div className="workspace-panel detail-section"><div className="section-heading"><div><h3>{t("OPEX financial information")}</h3><p>{t("The expense account remains controlled by the accounting line master.")}</p></div></div><dl className="detail-grid"><div><dt>{t("Expense frequency")}</dt><dd>{t(request.opexDetails.expenseFrequency)}</dd></div></dl></div>}

        <div className="workspace-panel detail-section"><div className="section-heading"><div><h3>{t("Item / service breakdown")}</h3><p>{t("Commercial information and validated accounting dimensions on the same lines.")}</p></div><span className="section-count">{request.lines?.length || 0}</span></div><DataTable controls={false} rows={request.lines || []} columns={[{ key: "itemDescription", label: "Item / service", render: (row) => row.itemDescription || "-" }, { key: "quantity", label: "Quantity", align: "right", render: (row) => row.quantity ?? "-" }, { key: "unitOfMeasure", label: "Unit", render: (row) => row.unitOfMeasure || "-" }, { key: "unitPrice", label: "Unit price", align: "right", render: (row) => row.unitPrice === undefined ? "-" : Number(row.unitPrice).toFixed(2) }, { key: "commercialTotal", label: "Commercial total", align: "right", render: (row) => Number(row.commercialTotal || 0).toFixed(2) }, { key: "costCenter", label: "Cost center", render: (row) => <div className="primary-cell"><strong>{row.costCenter?.code}</strong><span>{row.costCenter?.name}</span></div> }, { key: "expenseType", label: "Expense account", render: (row) => <div className="primary-cell"><strong>{row.expenseType?.accountNumber}</strong><span>{row.expenseType?.name}</span></div> }, { key: "netAmount", label: "Net", align: "right", render: (row) => Number(row.netAmount || 0).toFixed(2) }, { key: "igvAmount", label: "IGV", align: "right", render: (row) => Number(row.igvAmount || 0).toFixed(2) }, { key: "totalAmount", label: "Accounting total", align: "right", render: (row) => <strong>{Number(row.totalAmount || 0).toFixed(2)}</strong> }, { key: "penEquivalent", label: "PEN equivalent", align: "right", render: (row) => Number(row.penEquivalent || 0).toFixed(2) }]} /><div className="official-totals detail-totals"><div><span>{t("Commercial total")}</span><strong>{request.currency} {Number(request.totalCommercialAmount || 0).toFixed(2)}</strong></div><div><span>{t("Accounting total")}</span><strong>{request.currency} {Number(request.totalAmount || 0).toFixed(2)}</strong></div><div><span>{t("Difference")}</span><strong>{request.currency} {Number(request.commercialTotalDifference || 0).toFixed(2)}</strong></div><div><span>{t("Reconciliation status")}</span><StatusBadge status={request.commercialTotalStatus} /></div></div></div>

        {request.quotations?.length > 0 && <div className="workspace-panel detail-section"><div className="section-heading"><div><h3>{t("Supplier quotations")}</h3><p>{t("Structured supplier comparison and protected evidence.")}</p></div><span className="section-count">{request.quotations.length}</span></div><DataTable controls={false} rows={request.quotations} columns={[{ key: "supplier", label: "Supplier", render: (row) => <div className="primary-cell"><strong>{row.supplier?.legalName || row.supplier?.name || row.supplierSnapshot?.legalName}</strong><span>{row.supplier?.rucDni || row.supplierSnapshot?.identifier}{row.supplier?.supplierCode ? ` - ${row.supplier.supplierCode}` : ""}</span></div> }, { key: "status", label: "Status", render: (row) => <StatusBadge status={row.supplier?.homologationStatus || "PENDING_VALIDATION"} /> }, { key: "amount", label: "Amount", align: "right", render: (row) => `${row.currency} ${Number(row.amount || 0).toFixed(2)}` }, { key: "deliveryPeriod", label: "Delivery period" }, { key: "paymentConditions", label: "Payment conditions" }, { key: "commercialConditions", label: "Commercial conditions" }, { key: "recommended", label: "Recommended", render: (row) => row.recommended ? <span className="text-success">{t("Yes")}</span> : t("No") }, { key: "evidence", label: "Evidence", sortable: false, render: (row) => { const evidence = request.attachments?.find((item) => String(item._id) === String(row.attachment)); return evidence ? <ProtectedAssetButton className="asset-button-link" resourcePath={evidence.url} fileName={evidence.originalName} preview title={t("Preview or download")}><Download size={15} />{t("Open evidence")}</ProtectedAssetButton> : <span className="text-warning">{t("Evidence missing")}</span>; } }]} /><div className="recommended-supplier-detail"><div><span>{t("Recommended supplier")}</span><strong>{request.supplier?.legalName || request.supplier?.name}</strong><small>{request.supplier?.supplierCode || t("Supplier homologation pending")}</small></div><StatusBadge status={request.supplier?.homologationStatus || request.supplierSnapshot?.homologationStatus} /><p>{request.supplierSelectionReason || "-"}</p></div></div>}

        <div className="workspace-panel detail-section"><div className="section-heading"><div><h3>{t("Budget preview")}</h3><p>{t("Read-only visibility from the existing Budget service; this section does not reserve funds.")}</p></div><StatusBadge status={related.budgetPreview?.status || "PENDING_VALIDATION"} /></div>{related.budgetPreview?.lines?.length ? <div className="budget-preview-lines">{related.budgetPreview.lines.map((line, index) => <div key={`${line.costCenter}-${line.expenseType}-${index}`}><div><strong>{line.costCenterSnapshot?.code}</strong><span>{line.budgetItem || t("No budget item")}</span></div><span>{t("Requested")}: PEN {Number(line.amount || 0).toFixed(2)}</span><span>{t("Available")}: {line.available === undefined ? "-" : `PEN ${Number(line.available).toFixed(2)}`}</span><span>{t("Projected")}: {line.projectedBalance === undefined ? "-" : `PEN ${Number(line.projectedBalance).toFixed(2)}`}</span><StatusBadge status={line.status} /></div>)}</div> : <p className="empty-inline">{t("Pending Budget Validation")}</p>}</div>

        <div className="workspace-panel detail-section"><div className="section-heading"><div><h3>{t("Documents and fiscal validation")}</h3><p>{t("Physical files remain separate from extracted XML metadata.")}</p></div><span className="section-count">{request.attachments?.length || 0}</span></div><div className="document-requirement"><FileCheck2 size={20} /><div><strong>{missingDocuments.length ? t("Required evidence incomplete") : t("Required evidence complete")}</strong><p>{requirements.length ? requirements.map((rule) => `${t(rule.labelKey)} ${request.attachments.filter((item) => item.kind === rule.kind).length}/${rule.minCount}`).join(" - ") : t("No additional configured evidence for this classification.")}</p></div></div><DataTable controls={false} rows={request.attachments || []} columns={[{ key: "kind", label: "Kind", render: (row) => <span className="file-kind"><FileText size={15} />{t(row.kind)}</span> }, { key: "originalName", label: "File" }, { key: "size", label: "Size", render: (row) => row.size ? `${(row.size / 1024).toFixed(0)} KB` : "-" }, { key: "uploadedAt", label: "Uploaded", render: (row) => row.uploadedAt ? new Date(row.uploadedAt).toLocaleString() : "-" }, { key: "download", label: "", sortable: false, render: (row) => <ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.originalName} preview title="Preview or download"><Download size={16} /></ProtectedAssetButton> }]} /><div className={`xml-result ${request.xmlValidation?.validated ? "valid" : request.xmlValidation?.status === "INVALID" ? "invalid" : "neutral"}`}><FileCheck2 size={19} /><div><strong>{t(request.xmlValidation?.validated ? "XML validation passed" : "XML validation not passed")}</strong><p>{request.xmlValidation ? ["supplierMatch", "documentNumberMatch", "dateMatch", "netMatch", "igvMatch", "totalMatch"].map((key) => `${t(key)}: ${request.xmlValidation[key] === true ? t("Yes") : request.xmlValidation[key] === false ? t("No") : "-"}`).join(" - ") : t("No XML validation result is stored.")}</p>{request.xmlValidation?.errors?.length > 0 && <p className="text-danger">{request.xmlValidation.errors.join(" ")}</p>}</div></div></div>

        <div className="workspace-panel detail-section"><div className="section-heading"><div><h3>{t("Financial control records")}</h3><p>{t("Budget, purchase order, CXP, journals, bank batches, payment, and reconciliation remain independently traceable.")}</p></div></div><dl className="detail-grid"><div><dt>{t("Budget status")}</dt><dd><StatusBadge status={request.budgetCommitment?.status || "NO_BUDGET"} /></dd></div><div><dt>{t("Budget amount")}</dt><dd>{request.budgetCommitment ? `PEN ${Number(request.budgetCommitment.totalAmount || 0).toFixed(2)}` : "-"}</dd></div><div><dt>{t("Purchase order")}</dt><dd>{request.purchaseOrder?.poNumber || "-"}</dd></div><div><dt>{t("Fiscal voucher")}</dt><dd>{request.fiscalData?.voucherType || request.fiscalData?.documentType ? `${request.fiscalData.voucherType || request.fiscalData.documentType} ${request.fiscalData.series}-${request.fiscalData.number}` : "-"}</dd></div><div><dt>{t("CXP status")}</dt><dd>{related.accountsPayable?.[0] ? <StatusBadge status={related.accountsPayable[0].status} /> : "-"}</dd></div><div><dt>{t("Bank batch")}</dt><dd>{related.paymentBatches?.[0]?.batchNumber || request.paymentBatch?.batchNumber || "-"}</dd></div><div><dt>{t("Payment operation")}</dt><dd>{request.payment?.operationNumber || "-"}</dd></div><div><dt>{t("Reconciliation")}</dt><dd>{related.reconciliation ? `${related.reconciliation.bankReference} / ${Number(related.reconciliation.difference || 0).toFixed(2)}` : "-"}</dd></div></dl>
          {journalLines.length > 0 && <DataTable controls={false} rows={journalLines} columns={[{ key: "entryNumber", label: "Entry" }, { key: "entryType", label: "Type" }, { key: "accountNumber", label: "Account" }, { key: "description", label: "Description" }, { key: "debit", label: "Debit", align: "right", render: (row) => Number(row.debit || 0).toFixed(2) }, { key: "credit", label: "Credit", align: "right", render: (row) => Number(row.credit || 0).toFixed(2) }, { key: "period", label: "Period" }]} />}
        </div>

        {["ENTREGA_RENDIR", "REEMBOLSO_SIN_SUSTENTO"].includes(request.requestType) && <OfficialRenditionWorkspace request={request} masters={masters} user={user} onReload={load} />}
      </div>

      <aside className="request-detail-side">
        {(permissions.modifiable || permissions.canApprove || permissions.canCommitBudget || permissions.canClose || permissions.canVoid) && <div className="workspace-panel action-panel"><div className="section-heading"><div><h3>{t("Available actions")}</h3><p>{t("The backend revalidates permission, period, status, documents, supplier, fiscal, and budget controls.")}</p></div></div>
          {permissions.modifiable && <div className="action-item"><div><strong>{t("Submit for approval")}</strong><span>{missingDocuments.length ? t("Required documents are incomplete.") : t("Starts the configured approval route.")}</span></div><button type="button" className="primary-button" disabled={processing || missingDocuments.length > 0} title={missingDocuments.length ? t("Upload all required documents before submission.") : undefined} onClick={submitRequest}><Send size={16} /><span>{t("Submit")}</span></button></div>}
          {permissions.canApprove && <div className="action-buttons"><button type="button" className="primary-button" onClick={() => decision("approve")}><CheckCircle2 size={16} /><span>{t("Approve")}</span></button><button type="button" className="secondary-button" onClick={() => decision("observe")}><MessageSquareWarning size={16} /><span>{t("Observe")}</span></button><button type="button" className="secondary-button" onClick={() => decision("return")}><CornerUpLeft size={16} /><span>{t("Return")}</span></button><button type="button" className="danger-button subtle" onClick={() => decision("reject")}><XCircle size={16} /><span>{t("Reject")}</span></button></div>}
          {permissions.canCommitBudget && <button type="button" className="primary-button" onClick={() => setConfirm({ type: "budget", title: "Commit this request budget?", description: "The backend will validate every budget dimension and exception rule before reserving funds.", confirmLabel: "Commit budget", details: [{ label: "Request", value: request.requestNumber }, { label: "Result", value: "Successful commitment changes the request to COMPROMISO_PRESUPUESTAL." }] })}><CheckCircle2 size={16} /><span>{t("Commit budget")}</span></button>}
          {permissions.canClose && <button type="button" className="primary-button" onClick={() => setConfirm({ type: "close", title: "Close this request?", description: "Only a reconciled request in an open permitted period can be closed.", confirmLabel: "Close request", inputLabel: "Closing comments", details: [{ label: "Request", value: request.requestNumber }, { label: "Result", value: "Status changes from CONCILIADO to CERRADO." }] })}><CheckCircle2 size={16} /><span>{t("Close request")}</span></button>}
          {permissions.canVoid && <button type="button" className="danger-button subtle" onClick={() => setConfirm({ type: "void", title: "Annul this request?", description: "Any unexecuted reservation is released idempotently and the action is audited.", confirmLabel: "Annul request", tone: "danger", inputLabel: "Annulment reason", inputRequired: true, details: [{ label: "Request", value: request.requestNumber }, { label: "Result", value: "Status changes to ANULADO." }] })}><Trash2 size={16} /><span>{t("Annul request")}</span></button>}
        </div>}

        <div className="workspace-panel timeline-panel"><div className="section-heading"><div><h3>{t("Approval timeline")}</h3><p>{t("Electronic sign-offs, SLA dates, and workflow decisions.")}</p></div></div><ApprovalTimeline history={[...(request.approvalHistory || [])].reverse()} /></div>
        <div className="workspace-panel timeline-panel"><div className="section-heading"><div><h3>{t("Immutable audit")}</h3><p>{t("Application audit records are append-only.")}</p></div></div><div className="compact-lines">{(related.audit || []).slice().reverse().map((item) => <div key={item._id}><span>{new Date(item.createdAt).toLocaleString()} - {item.user?.name || "System"}</span><strong>{item.action}</strong></div>)}{!related.audit?.length && <p>{t("No audit events available.")}</p>}</div></div>
      </aside></div>
    </>}
    <ConfirmDialog open={Boolean(confirm)} title={confirm?.title} description={confirm?.description} details={confirm?.details} confirmLabel={confirm?.confirmLabel} tone={confirm?.tone} inputLabel={confirm?.inputLabel} inputRequired={confirm?.inputRequired} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={(comments) => runAction(confirm.type, comments)} />
  </section>;
}
