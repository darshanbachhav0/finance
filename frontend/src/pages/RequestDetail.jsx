import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  FileCheck2,
  FileText,
  FileUp,
  Pencil,
  Send,
  Trash2,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api, { apiAssetUrl } from "../api/client.js";
import ApprovalTimeline from "../components/ApprovalTimeline.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

const standardFlow = ["BORRADOR", "PENDIENTE_APROBACION", "APROBADO_POR_PAGAR", "PROCESADO_BANCO", "LIQUIDADO_CERRADO"];
const renditionFlow = ["BORRADOR", "PENDIENTE_APROBACION", "APROBADO_POR_PAGAR", "RENDICION_PENDIENTE", "LIQUIDADO_CERRADO"];

function RequestStatusFlow({ request }) {
  const { t } = useLanguage();
  const flow = request.requestType === "Entrega a Rendir" ? renditionFlow : standardFlow;
  const effectiveStatus = request.status === "RECHAZADO" ? "PENDIENTE_APROBACION" : request.status;
  const currentIndex = flow.indexOf(effectiveStatus);
  return (
    <ol className="status-flow" aria-label={t("Request workflow status")}>
      {flow.map((status, index) => {
        const completed = index < currentIndex || request.status === "LIQUIDADO_CERRADO";
        const active = index === currentIndex;
        return (
          <li key={status} className={`${completed ? "completed" : ""} ${active ? "active" : ""}`}>
            <span className="status-flow-dot">{completed ? <Check size={14} /> : index + 1}</span>
            <span>{t(status)}</span>
          </li>
        );
      })}
      {request.status === "RECHAZADO" && <li className="rejected active"><span className="status-flow-dot"><XCircle size={14} /></span><span>{t("RECHAZADO")}</span></li>}
    </ol>
  );
}

export default function RequestDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [request, setRequest] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [renditionFiles, setRenditionFiles] = useState([]);
  const [renditionComments, setRenditionComments] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/requests/${id}`);
      setRequest(response.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  const permissions = useMemo(() => {
    if (!request) return {};
    const owner = request.solicitor?._id === user._id;
    const modifiable = ["BORRADOR", "RECHAZADO"].includes(request.status) && (user.role === "Admin" || owner);
    return {
      owner,
      modifiable,
      canApprove: request.status === "PENDIENTE_APROBACION" && ["Admin", "Approver"].includes(user.role),
      canClose: ["APROBADO_POR_PAGAR", "PROCESADO_BANCO"].includes(request.status) && ["Admin", "Accounting"].includes(user.role),
      canRendition: request.status === "RENDICION_PENDIENTE" && (owner || ["Admin", "Accounting"].includes(user.role))
    };
  }, [request, user]);

  const missingSubmitDocs = request && ["Pago con Cotización", "Reembolso con Sustento"].includes(request.requestType)
    ? ["XML", "PDF"].filter((kind) => !request.attachments?.some((item) => item.kind === kind))
    : [];

  async function runAction(type, comments = "") {
    setProcessing(true);
    setError("");
    try {
      if (type === "approve") await api.post(`/approvals/${id}/approve`, { comments });
      if (type === "reject") await api.post(`/approvals/${id}/reject`, { comments });
      if (type === "close") await api.post(`/requests/${id}/close`, { comments });
      if (type === "delete") {
        await api.delete(`/requests/${id}`);
        notify("Draft request permanently deleted.");
        navigate("/requests");
        return;
      }
      const messages = {
        approve: "Request approved and provision entries generated.",
        reject: "Request rejected and returned to the solicitor.",
        close: "Request closed. Its status is now LIQUIDADO_CERRADO."
      };
      notify(messages[type]);
      setConfirm(null);
      await load();
    } catch (err) {
      const details = err.details?.errors ? err.details.errors.join(" ") : "";
      setError(`${err.message}${details ? ` ${details}` : ""}`);
      notify(err.message, "error");
      setConfirm(null);
    } finally {
      setProcessing(false);
    }
  }

  async function submitRequest() {
    setProcessing(true);
    try {
      await api.post(`/requests/${id}/submit`);
      notify("Request submitted for approval.");
      await load();
    } catch (err) {
      setError(err.details?.errors ? `${err.message} ${err.details.errors.join(" ")}` : err.message);
      notify(err.message, "error");
    } finally {
      setProcessing(false);
    }
  }

  async function submitRendition() {
    if (!renditionFiles.length) {
      notify("Select at least one rendition document.", "error");
      return;
    }
    setProcessing(true);
    const data = new FormData();
    renditionFiles.forEach((file) => data.append("rendition", file));
    data.append("comments", renditionComments);
    try {
      await api.post(`/requests/${id}/rendition`, data, { headers: { "Content-Type": "multipart/form-data" } });
      notify("Rendition submitted, accounting entries generated, and request closed.");
      setRenditionFiles([]);
      setRenditionComments("");
      await load();
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
    } finally {
      setProcessing(false);
    }
  }


  if (loading && !request) return <div className="page-loader">{t("Loading request...")}</div>;

  return (
    <section>
      <PageHeader
        title={request?.requestNumber || "Request details"}
        description={request ? `${t(request.requestType)} · ${request.supplier?.name || ""}` : ""}
        actions={
          <div className="page-actions">
            <Link className="secondary-button" to="/requests"><ArrowLeft size={16} /><span>{t("Back to list")}</span></Link>
            {permissions.modifiable && <Link className="secondary-button" to={`/requests/${id}/edit`}><Pencil size={16} /><span>{t("Edit request")}</span></Link>}
            {permissions.modifiable && <button type="button" className="danger-button subtle" onClick={() => setConfirm({ type: "delete", title: "Permanently delete this request?", description: "This draft or rejected request will be removed and cannot be restored.", confirmLabel: "Delete permanently", tone: "danger", details: [{ label: "Request", value: request.requestNumber }, { label: "Result", value: "The request is permanently removed." }] })}><Trash2 size={16} /><span>{t("Delete")}</span></button>}
          </div>
        }
      />
      <Message type="error">{error}</Message>

      {request && (
        <>
          <div className="request-summary-header">
            <div className="request-summary-main">
              <StatusBadge status={request.status} />
              <div><span>{t("Supplier")}</span><strong>{request.supplier?.name}</strong><small>{request.supplier?.rucDni}</small></div>
              <div><span>{t("Requested by")}</span><strong>{request.solicitor?.name}</strong><small>{request.solicitor?.area}</small></div>
            </div>
            <div className="request-amount-summary"><span>{t("Total amount")}</span><strong>{request.currency} {Number(request.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong><small>{t("PEN equivalent")}: {Number(request.penEquivalent || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</small></div>
          </div>

          <div className="workspace-panel status-workspace"><RequestStatusFlow request={request} /></div>

          <div className="request-detail-layout">
            <div className="request-detail-main">
              <div className="workspace-panel detail-section">
                <div className="section-heading"><div><h3>{t("Request summary")}</h3><p>{request.description}</p></div></div>
                <dl className="detail-grid">
                  <div><dt>{t("Request type")}</dt><dd>{t(request.requestType)}</dd></div>
                  <div><dt>{t("Issue date")}</dt><dd>{request.issueDate?.slice(0, 10)}</dd></div>
                  <div><dt>{t("Accounting period")}</dt><dd>{request.accountingPeriod}</dd></div>
                  <div><dt>{t("Currency")}</dt><dd>{request.currency}</dd></div>
                  <div><dt>{t("Exchange rate")}</dt><dd>{Number(request.exchangeRate || 1).toFixed(4)}</dd></div>
                  <div><dt>{t("Updated")}</dt><dd>{new Date(request.updatedAt).toLocaleString()}</dd></div>
                </dl>
              </div>

              <div className="workspace-panel detail-section">
                <div className="section-heading"><div><h3>{t("Accounting lines")}</h3><p>{t("Cost centers, expense accounts, and validated request amounts.")}</p></div><span className="section-count">{request.lines.length}</span></div>
                <DataTable controls={false} rows={request.lines} columns={[
                  { key: "costCenter", label: "Cost center", getValue: (row) => row.costCenter?.code, render: (row) => <div className="primary-cell"><strong>{row.costCenter?.code}</strong><span>{row.costCenter?.name}</span></div> },
                  { key: "expenseType", label: "Expense account", getValue: (row) => row.expenseType?.accountNumber, render: (row) => <div className="primary-cell"><strong>{row.expenseType?.accountNumber}</strong><span>{row.expenseType?.name}</span></div> },
                  { key: "netAmount", label: "Net", align: "right", render: (row) => Number(row.netAmount || 0).toFixed(2) },
                  { key: "igvAmount", label: "IGV", align: "right", render: (row) => Number(row.igvAmount || 0).toFixed(2) },
                  { key: "totalAmount", label: "Total", align: "right", render: (row) => <strong>{Number(row.totalAmount || 0).toFixed(2)}</strong> },
                  { key: "penEquivalent", label: "PEN equivalent", align: "right", render: (row) => Number(row.penEquivalent || 0).toFixed(2) }
                ]} />
              </div>

              <div className="workspace-panel detail-section">
                <div className="section-heading"><div><h3>{t("Attachments")}</h3><p>{t("Supporting files and invoice validation documents.")}</p></div><span className="section-count">{request.attachments.length}</span></div>
                <DataTable controls={false} rows={request.attachments} columns={[
                  { key: "kind", label: "Kind", render: (row) => <span className="file-kind"><FileText size={15} />{t(row.kind)}</span> },
                  { key: "originalName", label: "File" },
                  { key: "size", label: "Size", render: (row) => row.size ? `${(row.size / 1024).toFixed(0)} KB` : "-" },
                  { key: "uploadedAt", label: "Uploaded", render: (row) => new Date(row.uploadedAt).toLocaleString() },
                  { key: "download", label: "", sortable: false, render: (row) => <a className="icon-button" href={apiAssetUrl(row.url)} target="_blank" rel="noreferrer" title={t("Preview or download")}><Download size={16} /></a> }
                ]} />
                <div className={`xml-result ${request.xmlValidation?.validated ? "valid" : "neutral"}`}>
                  <FileCheck2 size={19} />
                  <div><strong>{t(request.xmlValidation?.validated ? "XML validation passed" : "No validated XML")}</strong><p>{t(request.xmlValidation?.validated ? "Supplier RUC/DNI and invoice amounts match this request." : "XML validation is only required for applicable request types.")}</p></div>
                </div>
              </div>

              {(request.bankFile?.fileName || request.rendition?.submittedAt) && (
                <div className="workspace-panel detail-section">
                  <div className="section-heading"><h3>{t("Payment and rendition information")}</h3></div>
                  <dl className="detail-grid">
                    {request.bankFile?.fileName && <><div><dt>{t("Bank file")}</dt><dd><a href={apiAssetUrl(request.bankFile.url)} target="_blank" rel="noreferrer">{request.bankFile.fileName}</a></dd></div><div><dt>{t("Generated")}</dt><dd>{new Date(request.bankFile.generatedAt).toLocaleString()}</dd></div><div><dt>{t("Generated by")}</dt><dd>{request.bankFile.generatedBy?.name || "-"}</dd></div></>}
                    {request.rendition?.submittedAt && <><div><dt>{t("Rendition submitted")}</dt><dd>{new Date(request.rendition.submittedAt).toLocaleString()}</dd></div><div><dt>{t("Submitted by")}</dt><dd>{request.rendition.submittedBy?.name || "-"}</dd></div><div className="wide"><dt>{t("Comments")}</dt><dd>{request.rendition.comments || "-"}</dd></div></>}
                  </dl>
                </div>
              )}
            </div>

            <aside className="request-detail-side">
              {(permissions.modifiable || permissions.canApprove || permissions.canClose || permissions.canRendition) && (
                <div className="workspace-panel action-panel">
                  <div className="section-heading"><div><h3>{t("Available actions")}</h3><p>{t("Actions allowed for your role and this status.")}</p></div></div>
                  {permissions.modifiable && (
                    <div className="action-item">
                      <div><strong>{t("Submit for approval")}</strong><span>{missingSubmitDocs.length ? t("Required documents are missing: {documents}.").replace("{documents}", missingSubmitDocs.join(", ")) : t("Moves this request to the approval inbox.")}</span></div>
                      <button type="button" className="primary-button" disabled={processing || missingSubmitDocs.length > 0} title={missingSubmitDocs.length ? t("Upload the required XML and PDF before submission.") : undefined} onClick={submitRequest}><Send size={16} /><span>{t("Submit")}</span></button>
                    </div>
                  )}
                  {permissions.canApprove && (
                    <div className="action-buttons">
                      <button type="button" className="primary-button" onClick={() => setConfirm({ type: "approve", title: "Approve this request?", description: "Approval will move the request to the Treasury payable queue and create provision accounting entries.", confirmLabel: "Approve request", details: [{ label: "Request", value: request.requestNumber }, { label: "Amount", value: `${request.currency} ${Number(request.totalAmount).toFixed(2)}` }, { label: "Result", value: "Status changes to APROBADO_POR_PAGAR and provision entries are created." }] })}><CheckCircle2 size={16} /><span>{t("Approve")}</span></button>
                      <button type="button" className="danger-button subtle" onClick={() => setConfirm({ type: "reject", title: "Reject this request?", description: "The request will return to the solicitor for correction. A rejection comment is required.", confirmLabel: "Reject request", tone: "danger", inputLabel: "Rejection comments", inputRequired: true, details: [{ label: "Request", value: request.requestNumber }, { label: "Result", value: "Status changes to RECHAZADO and the solicitor can edit it." }] })}><XCircle size={16} /><span>{t("Reject")}</span></button>
                    </div>
                  )}
                  {permissions.canClose && <button type="button" className="primary-button" onClick={() => setConfirm({ type: "close", title: "Close this request?", description: "Closing completes the request workflow. The accounting period must still be open.", confirmLabel: "Close request", inputLabel: "Closing comments", details: [{ label: "Request", value: request.requestNumber }, { label: "Result", value: "Status changes to LIQUIDADO_CERRADO." }] })}><CheckCircle2 size={16} /><span>{t("Close request")}</span></button>}
                  {permissions.canRendition && (
                    <div className="rendition-form">
                      <label className="field"><span>{t("Rendition documents")} *</span><input type="file" multiple onChange={(event) => setRenditionFiles(Array.from(event.target.files || []))} /><small className="field-hint">{renditionFiles.length ? t("{count} files selected").replace("{count}", renditionFiles.length) : t("Receipts and supporting documents are required.")}</small></label>
                      <label className="field"><span>{t("Comments")}</span><textarea rows="3" value={renditionComments} onChange={(event) => setRenditionComments(event.target.value)} /></label>
                      <button type="button" className="primary-button" disabled={processing || !renditionFiles.length} title={!renditionFiles.length ? t("Select at least one rendition document.") : undefined} onClick={submitRendition}><FileUp size={16} /><span>{t("Submit rendition")}</span></button>
                    </div>
                  )}
                </div>
              )}

              <div className="workspace-panel timeline-panel">
                <div className="section-heading"><div><h3>{t("Approval and audit timeline")}</h3><p>{t("Every workflow decision recorded for this request.")}</p></div></div>
                <ApprovalTimeline history={[...(request.approvalHistory || [])].reverse()} />
              </div>
            </aside>
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        description={confirm?.description}
        details={confirm?.details}
        confirmLabel={confirm?.confirmLabel}
        tone={confirm?.tone}
        inputLabel={confirm?.inputLabel}
        inputRequired={confirm?.inputRequired}
        loading={processing}
        onClose={() => !processing && setConfirm(null)}
        onConfirm={(comments) => runAction(confirm.type, comments)}
      />
    </section>
  );
}
