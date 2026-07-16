import { AlertTriangle, Download, Eye, FileDown, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import RequestQuickView from "../components/RequestQuickView.jsx";
import StatCard from "../components/StatCard.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { requestTypes } from "../utils/options.js";

export default function TreasuryQueue() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [rows, setRows] = useState([]);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState([]);
  const [quickViewId, setQuickViewId] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [queueResponse, historyResponse] = await Promise.all([api.get("/treasury/queue"), api.get("/treasury/bank-files")]);
      setRows(queueResponse.data.data);
      setHistory(historyResponse.data.data);
      setSelected((current) => current.filter((id) => queueResponse.data.data.some((row) => row._id === id)));
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const selectedRows = rows.filter((row) => selected.includes(row._id));
  const selectedTotals = useMemo(() => selectedRows.reduce((result, row) => {
    result[row.currency] = Number(((result[row.currency] || 0) + Number(row.totalAmount || 0)).toFixed(2));
    return result;
  }, {}), [selectedRows]);
  const queueTotals = useMemo(() => rows.reduce((result, row) => {
    result[row.currency] = Number(((result[row.currency] || 0) + Number(row.totalAmount || 0)).toFixed(2));
    return result;
  }, {}), [rows]);
  const missingBank = rows.filter((row) => !row.supplier?.cci && !row.supplier?.bankAccount).length;

  async function generate() {
    setProcessing(true);
    setError("");
    try {
      const response = await api.post("/treasury/bank-file", { requestIds: selected });
      setResult(response.data);
      setSelected([]);
      setConfirmOpen(false);
      notify("Bank TXT generated. Request statuses changed and payment entries were created.");
      await load();
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
      setConfirmOpen(false);
    } finally {
      setProcessing(false);
    }
  }

  const apiHost = `http://${window.location.hostname}:5000`;

  return (
    <section>
      <PageHeader title="Treasury Payment Queue" description="Review bank readiness, select payable requests, and generate controlled bank payment files." actions={<button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>} />
      <Message type="error">{error}</Message>

      <div className="stats-grid compact-stats">
        <StatCard label="Payable queue" value={rows.length} tone="amber" />
        <StatCard label="PEN waiting" value={`PEN ${(queueTotals.PEN || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone="teal" />
        <StatCard label="USD waiting" value={`USD ${(queueTotals.USD || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone="navy" />
        <StatCard label="Missing bank details" value={missingBank} tone={missingBank ? "red" : "green"} />
      </div>

      {missingBank > 0 && <div className="alert-strip error"><AlertTriangle size={20} /><div><strong>{t("Some payments are blocked")}</strong><p>{t("Requests without a supplier bank account or CCI cannot be selected or included in a bank file.")}</p></div></div>}

      {selected.length > 0 && (
        <div className="selection-bar" role="status">
          <div><strong>{t("{count} requests selected").replace("{count}", selected.length)}</strong><span>{Object.entries(selectedTotals).map(([currency, total]) => `${currency} ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`).join(" · ")}</span></div>
          <button type="button" className="primary-button" onClick={() => setConfirmOpen(true)}><FileDown size={16} /><span>{t("Review bank file")}</span></button>
        </div>
      )}

      {result && (
        <div className="success-result" role="status">
          <div><strong>{t("Bank file generated successfully")}</strong><span>{result.fileName} · {result.processed.length} {t("requests processed")}</span></div>
          <a className="primary-button" href={`${apiHost}${result.url}`} target="_blank" rel="noreferrer"><Download size={16} /><span>{t("Download TXT")}</span></a>
        </div>
      )}

      <div className="workspace-panel">
        <div className="section-heading"><div><h3>{t("Payable requests")}</h3><p>{t("Only rows with valid bank details can be selected.")}</p></div></div>
        <DataTable
          rows={rows}
          loading={loading}
          selection={{ selected, onChange: setSelected, isRowSelectable: (row) => Boolean(row.supplier?.cci || row.supplier?.bankAccount) }}
          filters={[
            { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] },
            { key: "requestType", label: "types", allLabel: "All types", options: requestTypes }
          ]}
          searchPlaceholder="Search request or supplier..."
          onRowClick={(row) => setQuickViewId(row._id)}
          rowActions={(row) => [{ label: "Quick view", icon: Eye, onClick: () => setQuickViewId(row._id) }]}
          columns={[
            { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
            { key: "supplier", label: "Supplier", getValue: (row) => row.supplier?.name, render: (row) => <div className="primary-cell"><strong>{row.supplier?.name}</strong><span>{row.supplier?.rucDni}</span></div> },
            { key: "bank", label: "Bank / CCI", getValue: (row) => row.supplier?.cci || row.supplier?.bankAccount, render: (row) => row.supplier?.cci || row.supplier?.bankAccount ? <div className="primary-cell"><strong>{row.supplier?.bankName || t("Bank")}</strong><span>{row.supplier?.cci || row.supplier?.bankAccount}</span></div> : <span className="inline-error"><AlertTriangle size={15} />{t("Missing bank details")}</span> },
            { key: "requestType", label: "Type" },
            { key: "currency", label: "Currency" },
            { key: "totalAmount", label: "Amount", align: "right", render: (row) => <strong>{Number(row.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> },
            { key: "updatedAt", label: "Approved", render: (row) => new Date(row.updatedAt).toLocaleDateString() }
          ]}
        />
      </div>

      <div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Generated bank-file history")}</h3><p>{t("Download previous files and review who generated them.")}</p></div></div>
        <DataTable rows={history} loading={loading} searchPlaceholder="Search file or request..." columns={[
          { key: "fileName", label: "File", render: (row) => <a href={`${apiHost}${row.url}`} target="_blank" rel="noreferrer">{row.fileName}</a> },
          { key: "rowCount", label: "Requests" },
          { key: "requestNumbers", label: "Included requests", getValue: (row) => row.requestNumbers?.join(" "), render: (row) => <span className="truncate-list" title={row.requestNumbers?.join(", ")}>{row.requestNumbers?.join(", ")}</span> },
          { key: "totals", label: "Totals", getValue: (row) => row.totals?.map((item) => `${item.currency} ${item.total}`).join(" "), render: (row) => row.totals?.map((item) => `${item.currency} ${Number(item.total).toFixed(2)}`).join(" · ") },
          { key: "generatedBy", label: "Generated by", getValue: (row) => row.generatedBy?.name, render: (row) => row.generatedBy?.name || "-" },
          { key: "createdAt", label: "Generated", render: (row) => new Date(row.createdAt).toLocaleString() },
          { key: "download", label: "", sortable: false, render: (row) => <a className="icon-button" href={`${apiHost}${row.url}`} target="_blank" rel="noreferrer" title={t("Download")}><Download size={16} /></a> }
        ]} />
      </div>

      <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
      <ConfirmDialog
        open={confirmOpen}
        title="Generate this bank TXT?"
        description="Generation is final for these requests: statuses will change and payment accounting entries will be created."
        details={[
          { label: "Selected requests", value: selected.length },
          ...Object.entries(selectedTotals).map(([currency, total]) => ({ label: `${currency} total`, value: `${currency} ${total.toFixed(2)}` })),
          { label: "Result", value: "A TXT file is saved, normal requests become PROCESADO_BANCO, advances become RENDICION_PENDIENTE, and payment entries are created." }
        ]}
        confirmLabel="Generate bank TXT"
        loading={processing}
        onClose={() => !processing && setConfirmOpen(false)}
        onConfirm={generate}
      />
    </section>
  );
}
