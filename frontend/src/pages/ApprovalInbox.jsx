import { CheckCircle2, Eye, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import RequestQuickView from "../components/RequestQuickView.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { requestTypes } from "../utils/options.js";

export default function ApprovalInbox() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [rows, setRows] = useState([]);
  const [quickViewId, setQuickViewId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await api.get("/approvals/inbox");
      setRows(response.data.data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const summary = useMemo(() => ({
    total: rows.length,
    amount: rows.reduce((sum, row) => sum + Number(row.penEquivalent || 0), 0),
    oldest: rows.length ? Math.max(...rows.map((row) => Math.floor((Date.now() - new Date(row.createdAt).getTime()) / 86400000))) : 0
  }), [rows]);

  async function decide(comments) {
    setProcessing(true);
    try {
      if (confirm.type === "approve") await api.post(`/approvals/${confirm.row._id}/approve`, { comments });
      else await api.post(`/approvals/${confirm.row._id}/reject`, { comments });
      notify(confirm.type === "approve"
        ? confirm.row.approvalStage === "AREA_DIRECTOR" ? "Director approval recorded and sent to Vice Rector." : "Vice Rector approval recorded and budget commitment created."
        : "Request rejected and returned to the solicitor.");
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err.details?.errors ? `${err.message} ${err.details.errors.join(" ")}` : err.message);
      notify(err.message, "error");
      setConfirm(null);
    } finally {
      setProcessing(false);
    }
  }

  function openDecision(row, type) {
    const approve = type === "approve";
    const directorStage = row.approvalStage === "AREA_DIRECTOR";
    setConfirm({
      row,
      type,
      title: approve ? "Approve this request?" : "Reject this request?",
      description: approve
        ? directorStage
          ? "This records the Area Director electronic approval and sends the request to the Vice Rector stage."
          : "This records the Vice Rector electronic approval and reserves the available budget before Accounting processing."
        : "Rejection returns the request to the solicitor for correction. A comment is required.",
      confirmLabel: approve ? "Approve request" : "Reject request",
      tone: approve ? "primary" : "danger",
      inputLabel: approve ? "Approval comments" : "Rejection comments",
      inputRequired: !approve,
      details: [
        { label: "Request", value: row.requestNumber },
        { label: "Supplier", value: row.supplier?.name },
        { label: "Amount", value: `${row.currency} ${Number(row.totalAmount || 0).toFixed(2)}` },
        { label: "Approval level", value: row.approvalStage },
        { label: "Result", value: approve ? directorStage ? "Status changes to APROBADO_DIRECTOR and the Vice Rector SLA starts." : "Budget is validated and reserved; the request moves to COMPROMISO_PRESUPUESTAL for Accounting." : "Status changes to RECHAZADO and editing is enabled for the solicitor." }
      ]
    });
  }

  return (
    <section>
      <PageHeader title="Approval Inbox" description="Review pending requests in oldest-first order and record a clear approval decision." actions={<button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>} />
      <Message type="error">{error}</Message>
      <div className="stats-grid compact-stats">
        <StatCard label="Pending approval" value={summary.total} tone="amber" />
        <StatCard label="PEN equivalent waiting" value={`PEN ${summary.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone="teal" />
        <StatCard label="Oldest request age" value={summary.oldest} suffix="days" tone="navy" />
      </div>
      <div className="workspace-panel">
        <DataTable
          rows={rows}
          loading={loading}
          filters={[{ key: "requestType", label: "types", allLabel: "All types", options: requestTypes }]}
          searchPlaceholder="Search request, supplier, or solicitor..."
          onRowClick={(row) => setQuickViewId(row._id)}
          rowActions={(row) => [
            { label: "Quick view", icon: Eye, onClick: () => setQuickViewId(row._id) },
            { label: "Approve", icon: CheckCircle2, onClick: () => openDecision(row, "approve") },
            { label: "Reject", icon: XCircle, tone: "danger", onClick: () => openDecision(row, "reject") }
          ]}
          columns={[
            { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
            { key: "requestType", label: "Type" },
            { key: "priority", label: "Priority", render: (row) => <span className={`priority priority-${String(row.priority || "MEDIA").toLowerCase()}`}>{t(row.priority || "MEDIA")}</span> },
            { key: "approvalStage", label: "Approval level", render: (row) => t(row.approvalStage || "AREA_DIRECTOR") },
            { key: "supplier", label: "Supplier", getValue: (row) => row.supplier?.name, render: (row) => <div className="primary-cell"><strong>{row.supplier?.name}</strong><span>{row.supplier?.rucDni}</span></div> },
            { key: "solicitor", label: "Solicitor", getValue: (row) => row.solicitor?.name, render: (row) => <div className="primary-cell"><strong>{row.solicitor?.name}</strong><span>{row.solicitor?.area}</span></div> },
            { key: "approvalDueAt", label: "SLA due", render: (row) => <div className="primary-cell"><strong className={row.approvalDueAt && new Date(row.approvalDueAt) < new Date() ? "text-danger" : ""}>{row.approvalDueAt ? new Date(row.approvalDueAt).toLocaleString() : "-"}</strong><span>{row.approvalDueAt && new Date(row.approvalDueAt) < new Date() ? t("Overdue") : t("On time")}</span></div> },
            { key: "totalAmount", label: "Amount", align: "right", render: (row) => <strong>{row.currency} {Number(row.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> },
            { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
            { key: "decision", label: "Decision", sortable: false, render: (row) => <div className="row-actions"><button type="button" className="icon-button approve" title={t("Approve")} onClick={() => openDecision(row, "approve")}><CheckCircle2 size={17} /></button><button type="button" className="icon-button danger" title={t("Reject")} onClick={() => openDecision(row, "reject")}><XCircle size={17} /></button></div> }
          ]}
        />
      </div>
      <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
      <ConfirmDialog open={Boolean(confirm)} {...confirm} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={decide} />
    </section>
  );
}
