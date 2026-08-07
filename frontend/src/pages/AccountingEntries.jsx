import { Download, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api, { apiAssetUrl } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

export default function AccountingEntries() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [entries, setEntries] = useState([]);
  const [preview, setPreview] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [entriesResponse, previewResponse, historyResponse] = await Promise.all([
        api.get("/accounting/entries", { params: { period } }),
        api.get("/accounting/consolidation", { params: { period } }),
        api.get("/accounting/exports")
      ]);
      setEntries(entriesResponse.data.data);
      setPreview(previewResponse.data.data);
      setHistory(historyResponse.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const totals = useMemo(() => entries.reduce((result, entry) => ({
    debit: result.debit + Number(entry.debit || 0),
    credit: result.credit + Number(entry.credit || 0)
  }), { debit: 0, credit: 0 }), [entries]);
  const consolidated = useMemo(() => preview.reduce((result, row) => ({
    requests: result.requests + Number(row.requestCount || 0),
    pen: result.pen + Number(row.penEquivalent || 0)
  }), { requests: 0, pen: 0 }), [preview]);

  async function exportCsv() {
    setExporting(true);
    try {
      const response = await api.get("/accounting/consolidation/export", { params: { period, format: "csv" }, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `consolidation-${period}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      notify("Consolidation CSV generated and added to export history.");
      const historyResponse = await api.get("/accounting/exports");
      setHistory(historyResponse.data.data);
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section>
      <PageHeader title="Accounting Entries" description="Review workflow-generated entries, reconcile totals, consolidate the period, and retain export history." actions={<Link className="secondary-button" to="/accounting/periods">{t("Manage periods")}</Link>} />
      <Message type="error">{error}</Message>

      <div className="period-toolbar">
        <label className="field compact-period"><span>{t("Accounting period")}</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        <button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Load period")}</span></button>
        <button type="button" className="primary-button" onClick={exportCsv} disabled={exporting || loading}><Download size={16} /><span>{t(exporting ? "Exporting..." : "Export consolidation CSV")}</span></button>
      </div>

      <div className="stats-grid compact-stats">
        <StatCard label="Entries" value={entries.length} tone="navy" />
        <StatCard label="Debit total" value={`PEN ${totals.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone="teal" />
        <StatCard label="Credit total" value={`PEN ${totals.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone="neutral" />
        <StatCard label="Consolidated PEN" value={`PEN ${consolidated.pen.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} tone="green" />
      </div>

      <div className="workspace-panel">
        <div className="section-heading"><div><h3>{t("Accounting entries")}</h3><p>{t("Provision, payment, and rendition entries created by the workflow.")}</p></div></div>
        <DataTable
          rows={entries}
          loading={loading}
          filters={[{ key: "type", label: "entry types", allLabel: "All entry types", options: ["PROVISION", "PAYMENT", "RENDITION"] }]}
          searchPlaceholder="Search entry, request, account, or description..."
          columns={[
            { key: "entryNumber", label: "Entry" },
            { key: "type", label: "Entry type", render: (row) => <span className={`entry-type entry-${row.type.toLowerCase()}`}>{t(row.type)}</span> },
            { key: "request", label: "Request", getValue: (row) => row.request?.requestNumber, render: (row) => row.request ? <Link to={`/requests/${row.request._id}`}>{row.request.requestNumber}</Link> : "-" },
            { key: "accountNumber", label: "Account" },
            { key: "costCenter", label: "Cost center", getValue: (row) => row.costCenter?.code, render: (row) => row.costCenter?.code || "-" },
            { key: "description", label: "Description" },
            { key: "debit", label: "Debit", align: "right", render: (row) => Number(row.debit || 0).toFixed(2) },
            { key: "credit", label: "Credit", align: "right", render: (row) => Number(row.credit || 0).toFixed(2) },
            { key: "createdAt", label: "Created", render: (row) => new Date(row.createdAt).toLocaleString() }
          ]}
        />
      </div>

      <div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Consolidation summary")}</h3><p>{t("Period totals grouped by cost center, expense account, and currency.")}</p></div><span className="section-count">{preview.length}</span></div>
        <DataTable rows={preview.map((row, index) => ({ ...row, id: `${row.costCenterCode}-${row.expenseAccount}-${row.currency}-${index}` }))} rowKey="id" loading={loading} filters={[{ key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }]} columns={[
          { key: "costCenterCode", label: "CeCo", render: (row) => <div className="primary-cell"><strong>{row.costCenterCode}</strong><span>{row.costCenterName}</span></div> },
          { key: "expenseAccount", label: "Account", render: (row) => <div className="primary-cell"><strong>{row.expenseAccount}</strong><span>{row.expenseTypeName}</span></div> },
          { key: "currency", label: "Currency" },
          { key: "netAmount", label: "Net", align: "right", render: (row) => Number(row.netAmount || 0).toFixed(2) },
          { key: "igvAmount", label: "IGV", align: "right", render: (row) => Number(row.igvAmount || 0).toFixed(2) },
          { key: "totalAmount", label: "Total", align: "right", render: (row) => <strong>{Number(row.totalAmount || 0).toFixed(2)}</strong> },
          { key: "penEquivalent", label: "PEN equivalent", align: "right", render: (row) => Number(row.penEquivalent || 0).toFixed(2) },
          { key: "requestCount", label: "Requests" }
        ]} />
      </div>

      <div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Export history")}</h3><p>{t("Previously generated consolidation reports remain available for download.")}</p></div></div>
        <DataTable rows={history} loading={loading} columns={[
          { key: "fileName", label: "File", render: (row) => <a href={apiAssetUrl(row.url)} target="_blank" rel="noreferrer">{row.fileName}</a> },
          { key: "period", label: "Period" },
          { key: "rowCount", label: "Rows" },
          { key: "generatedBy", label: "Generated by", getValue: (row) => row.generatedBy?.name, render: (row) => row.generatedBy?.name || "-" },
          { key: "createdAt", label: "Generated", render: (row) => new Date(row.createdAt).toLocaleString() },
          { key: "download", label: "", sortable: false, render: (row) => <a className="icon-button" href={apiAssetUrl(row.url)} target="_blank" rel="noreferrer" title={t("Download")}><Download size={16} /></a> }
        ]} />
      </div>
    </section>
  );
}
