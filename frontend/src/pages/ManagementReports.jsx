import { Download, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import api, { apiAssetUrl } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

const money = (value) => `PEN ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function BarList({ title, rows, emptyLabel }) {
  const { t } = useLanguage();
  const maximum = Math.max(1, ...rows.map((row) => Number(row.total || 0)));
  return <div className="report-panel"><div className="section-heading"><div><h3>{t(title)}</h3></div></div>{rows.length ? <div className="report-bars">{rows.map((row) => <div className="report-bar-row" key={row._id || "Unassigned"}><div><span>{row._id || t("Unassigned")}</span><strong>{money(row.total)}</strong></div><div className="report-track"><span style={{ width: `${Math.max(2, Number(row.total || 0) / maximum * 100)}%` }} /></div></div>)}</div> : <p className="muted-empty">{t(emptyLabel)}</p>}</div>;
}

export default function ManagementReports() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [period, setPeriod] = useState("");
  const [data, setData] = useState({ byType: [], byMonth: [], byArea: [], byProject: [], payable: [], budget: {}, accounting: {}, costCenters: [], exports: [], overdue: 0 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await api.get("/reports/management", { params: period ? { period } : {} });
      setData(response.data.data);
      setError("");
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const payableTotal = useMemo(() => data.payable.reduce((sum, item) => sum + Number(item.total || 0), 0), [data.payable]);

  async function exportReport() {
    setExporting(true);
    try {
      const response = await api.get("/reports/management/export", { params: period ? { period } : {}, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `management-report-${period || "all"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      notify("Management report generated.");
      await load();
    } catch (err) { setError(err.message); notify(err.message, "error"); } finally { setExporting(false); }
  }

  return <section>
    <PageHeader title="Management Reports" description="Review CAPEX, OPEX, budget execution, accounts payable, approval SLA, and institutional spending trends." />
    <Message type="error">{error}</Message>
    <div className="period-toolbar"><label className="field compact-period"><span>{t("Accounting period")}</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label><button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Apply")}</span></button><button type="button" className="primary-button" onClick={exportReport} disabled={loading || exporting}><Download size={16} /><span>{t(exporting ? "Exporting..." : "Export management CSV")}</span></button></div>
    <div className="stats-grid"><StatCard label="Assigned budget" value={money(data.budget.assigned)} tone="navy" /><StatCard label="Budget available" value={money(data.budget.available)} tone="green" /><StatCard label="Accounts payable" value={money(payableTotal)} tone="teal" /><StatCard label="Overdue approvals" value={data.overdue} tone={data.overdue ? "red" : "green"} /><StatCard label="Accounting entries" value={data.accounting.count || 0} tone="neutral" /></div>
    <div className="reports-grid"><BarList title="CAPEX and OPEX" rows={data.byType} emptyLabel="No request data available." /><BarList title="Monthly expenditure" rows={data.byMonth} emptyLabel="No request data available." /><BarList title="Spending by area" rows={data.byArea} emptyLabel="No area data available." /><BarList title="Spending by project" rows={data.byProject} emptyLabel="No project data available." /></div>
    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Budget execution matrix")}</h3><p>{t("Assigned versus committed, executed, paid, and available balances.")}</p></div></div><DataTable rows={data.costCenters} loading={loading} searchPlaceholder="Search cost center..." columns={[
      { key: "code", label: "Cost center", render: (row) => <div className="primary-cell"><strong>{row.code}</strong><span>{row.name}</span></div> }, { key: "area", label: "Area" }, { key: "annualBudget", label: "Assigned", align: "right", render: (row) => money(row.annualBudget) }, { key: "committedAmount", label: "Committed", align: "right", render: (row) => money(row.committedAmount) }, { key: "executedAmount", label: "Executed", align: "right", render: (row) => money(row.executedAmount) }, { key: "paidAmount", label: "Paid", align: "right", render: (row) => money(row.paidAmount) }, { key: "availableAmount", label: "Available", align: "right", render: (row) => <strong>{money(row.availableAmount)}</strong> }
    ]} /></div>
    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Report history")}</h3><p>{t("Previously generated management exports remain available.")}</p></div></div><DataTable rows={data.exports} loading={loading} columns={[{ key: "fileName", label: "File", render: (row) => <a href={apiAssetUrl(row.url)} target="_blank" rel="noreferrer">{row.fileName}</a> }, { key: "period", label: "Period", render: (row) => row.period || t("All periods") }, { key: "rowCount", label: "Rows" }, { key: "generatedBy", label: "Generated by", getValue: (row) => row.generatedBy?.name, render: (row) => row.generatedBy?.name || "-" }, { key: "createdAt", label: "Generated", render: (row) => new Date(row.createdAt).toLocaleString() }]} /></div>
  </section>;
}
