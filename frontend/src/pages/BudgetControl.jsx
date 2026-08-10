import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

const money = (value) => `PEN ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BudgetControl() {
  const { t } = useLanguage();
  const [period, setPeriod] = useState("");
  const [data, setData] = useState({ totals: {}, costCenters: [], commitments: [], warnings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await api.get("/budget/overview", { params: period ? { period } : {} });
      setData(response.data.data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <section>
      <PageHeader title="Budget Control" description="Monitor assigned, committed, executed, paid, and available institutional budget by cost center." />
      <Message type="error">{error}</Message>
      <div className="period-toolbar">
        <label className="field compact-period"><span>{t("Commitment period")}</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        <button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Apply")}</span></button>
      </div>

      <div className="stats-grid budget-stats">
        <StatCard label="Assigned budget" value={money(data.totals.assigned)} tone="navy" />
        <StatCard label="Committed budget" value={money(data.totals.committed)} tone="amber" />
        <StatCard label="Executed budget" value={money(data.totals.executed)} tone="teal" />
        <StatCard label="Paid budget" value={money(data.totals.paid)} tone="green" />
        <StatCard label="Available balance" value={money(data.totals.available)} tone="neutral" />
      </div>

      {data.warnings.length > 0 && <div className="alert-strip warning"><AlertTriangle size={20} /><div><strong>{t("Low budget availability")}</strong><p>{t("One or more active cost centers have less than 10% available.")}</p></div></div>}

      <div className="workspace-panel">
        <div className="section-heading"><div><h3>{t("Budget by cost center")}</h3><p>{t("Active budgets reserve funds before Accounting registers the payable.")}</p></div></div>
        <DataTable rows={data.costCenters} loading={loading} filters={[{ key: "budgetMode", label: "budget modes", allLabel: "All modes", options: ["ACTIVE", "TRANSITIONAL"] }]} searchPlaceholder="Search cost center or area..." columns={[
          { key: "code", label: "Cost center", render: (row) => <div className="primary-cell"><strong>{row.code}</strong><span>{row.name}</span></div> },
          { key: "area", label: "Area" },
          { key: "budgetMode", label: "Mode", render: (row) => <StatusBadge status={row.budgetMode} /> },
          { key: "annualBudget", label: "Assigned", align: "right", render: (row) => money(row.annualBudget) },
          { key: "committedAmount", label: "Committed", align: "right", render: (row) => money(row.committedAmount) },
          { key: "executedAmount", label: "Executed", align: "right", render: (row) => money(row.executedAmount) },
          { key: "paidAmount", label: "Paid", align: "right", render: (row) => money(row.paidAmount) },
          { key: "availableAmount", label: "Available", align: "right", render: (row) => <strong className={row.availableAmount < 0 ? "text-danger" : ""}>{money(row.availableAmount)}</strong> }
        ]} />
      </div>

      <div className="workspace-panel section-spacer">
        <div className="section-heading"><div><h3>{t("Budget commitments")}</h3><p>{t("Every reservation remains traceable to its originating request.")}</p></div><span className="section-count">{data.commitments.length}</span></div>
        <DataTable rows={data.commitments} loading={loading} filters={[{ key: "status", label: "statuses", allLabel: "All statuses", options: ["RESERVED", "WITHOUT_BUDGET", "EXECUTED", "RELEASED"] }]} searchPlaceholder="Search request or period..." columns={[
          { key: "requestNumber", label: "Request", render: (row) => row.request?._id ? <Link to={`/requests/${row.request._id}`}>{row.requestNumber}</Link> : row.requestNumber },
          { key: "period", label: "Period" },
          { key: "request", label: "Type", getValue: (row) => row.request?.requestType, render: (row) => row.request?.requestType || "-" },
          { key: "area", label: "Area", getValue: (row) => row.request?.requestingArea, render: (row) => row.request?.requestingArea || "-" },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
          { key: "totalAmount", label: "Committed amount", align: "right", render: (row) => <strong>{money(row.totalAmount)}</strong> },
          { key: "createdAt", label: "Created", render: (row) => new Date(row.createdAt).toLocaleString() }
        ]} />
      </div>
    </section>
  );
}
