import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import RequestQuickView from "../components/RequestQuickView.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { requestStatuses, requestTypes } from "../utils/options.js";

export default function RequestsList() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [quickViewId, setQuickViewId] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/requests");
      setRows(response.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const periods = useMemo(() => [...new Set(rows.map((row) => row.accountingPeriod))].sort().reverse(), [rows]);
  const canCreate = ["Admin", "Solicitor"].includes(user.role);

  function canModify(row) {
    return ["BORRADOR", "RECHAZADO"].includes(row.status) && (user.role === "Admin" || row.solicitor?._id === user._id);
  }

  async function removeRequest() {
    setDeleting(true);
    try {
      await api.delete(`/requests/${deleteRow._id}`);
      notify("Draft request permanently deleted.");
      setDeleteRow(null);
      await load();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section>
      <PageHeader
        title="Requests"
        description="Create, track, submit, and review financial requests by status and accounting period."
        actions={canCreate && <Link className="primary-button" to="/requests/new"><Plus size={16} /><span>{t("New request")}</span></Link>}
      />
      <Message type="error">{error}</Message>
      <div className="workspace-panel">
        <DataTable
          rows={rows}
          loading={loading}
          filters={[
            { key: "status", label: "statuses", allLabel: "All statuses", options: requestStatuses },
            { key: "requestType", label: "types", allLabel: "All types", options: requestTypes },
            { key: "accountingPeriod", label: "periods", allLabel: "All periods", options: periods }
          ]}
          initialFilters={{ status: searchParams.get("status") || "" }}
          searchPlaceholder="Search request, supplier, solicitor..."
          onRowClick={(row) => setQuickViewId(row._id)}
          rowActions={(row) => [
            { label: "Quick view", icon: Eye, onClick: () => setQuickViewId(row._id) },
            { label: "Open full details", icon: Eye, onClick: () => navigate(`/requests/${row._id}`) },
            { label: "Edit request", icon: Pencil, hidden: !canModify(row), onClick: () => navigate(`/requests/${row._id}/edit`) },
            { label: "Delete permanently", icon: Trash2, tone: "danger", hidden: !canModify(row), onClick: () => setDeleteRow(row) }
          ]}
          columns={[
            { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
            { key: "requestType", label: "Type" },
            { key: "supplier", label: "Supplier", getValue: (row) => row.supplier?.name, render: (row) => <div className="primary-cell"><strong>{row.supplier?.name || "-"}</strong><span>{row.supplier?.rucDni}</span></div> },
            { key: "solicitor", label: "Solicitor", getValue: (row) => row.solicitor?.name, render: (row) => row.solicitor?.name || "-" },
            { key: "accountingPeriod", label: "Period" },
            { key: "totalAmount", label: "Amount", align: "right", render: (row) => <strong>{row.currency} {Number(row.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> },
            { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
            { key: "updatedAt", label: "Updated", render: (row) => new Date(row.updatedAt).toLocaleDateString() }
          ]}
        />
      </div>

      <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
      <ConfirmDialog
        open={Boolean(deleteRow)}
        title="Permanently delete this request?"
        description="Only draft or rejected requests can be deleted. This action cannot be undone."
        details={deleteRow ? [{ label: "Request", value: deleteRow.requestNumber }, { label: "Result", value: "The request and its draft data will be permanently removed." }] : []}
        confirmLabel="Delete permanently"
        tone="danger"
        loading={deleting}
        onClose={() => setDeleteRow(null)}
        onConfirm={removeRequest}
      />
    </section>
  );
}
