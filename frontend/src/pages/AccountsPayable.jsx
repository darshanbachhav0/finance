import { Eye, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";

const money = (currency, value) => `${currency || "PEN"} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AccountsPayable() {
  const { t } = useLanguage();
  const [selected, setSelected] = useState(null);
  const payableTable = usePaginatedResource("/accounting/accounts-payable");
  const { rows, loading } = payableTable;
  const summary = useMemo(() => ({
    total: Number(payableTable.payload.summary?.originalPEN || 0),
    outstanding: Number(payableTable.payload.summary?.outstandingPEN || 0),
    paid: Number(payableTable.payload.summary?.paidPEN || 0)
  }), [payableTable.payload.summary]);

  return (
    <section>
      <PageHeader title="Accounts Payable" description="Review CXP balances, vouchers, payment batches, and settlement status independently from the request workflow." actions={<button type="button" className="secondary-button" onClick={payableTable.reload} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>} />
      <Message type="error">{payableTable.error}</Message>
      <div className="stats-grid compact-stats">
        <StatCard label="CXP records" value={payableTable.pagination.total} tone="navy" />
        <StatCard label="Original amount" value={money("PEN", summary.total)} tone="teal" />
        <StatCard label="Outstanding amount" value={money("PEN", summary.outstanding)} tone="amber" />
        <StatCard label="Paid amount" value={money("PEN", summary.paid)} tone="green" />
      </div>
      <div className="workspace-panel">
        <DataTable
          rows={rows}
          loading={loading}
          remote={payableTable.remote}
          filters={[
            { key: "status", label: "statuses", allLabel: "All statuses", options: ["OPEN", "SCHEDULED", "PAYMENT_FILE_CREATED", "PAID", "CANCELLED"] },
            { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }
          ]}
          searchPlaceholder="Search request, supplier, voucher, or batch..."
          rowActions={(row) => [{ label: "View CXP details", icon: Eye, onClick: () => setSelected(row) }]}
          columns={[
            { key: "request", label: "Request", sortable: false, getValue: (row) => row.request?.requestNumber, render: (row) => row.request ? <Link to={`/requests/${row.request._id}`}>{row.request.requestNumber}</Link> : "-" },
            { key: "supplier", label: "Supplier", sortable: false, getValue: (row) => row.supplier?.legalName || row.supplier?.name, render: (row) => <div className="primary-cell"><strong>{row.supplier?.legalName || row.supplier?.name || "-"}</strong><span>{row.supplierIdentifierSnapshot}</span></div> },
            { key: "voucher", label: "Voucher", sortable: false, getValue: (row) => `${row.voucher?.voucherType || row.voucher?.documentType || ""} ${row.voucher?.series || ""}-${row.voucher?.number || ""}`, render: (row) => `${row.voucher?.voucherType || row.voucher?.documentType || "-"} ${row.voucher?.series || ""}-${row.voucher?.number || ""}` },
            { key: "currency", label: "Currency" },
            { key: "originalAmount", label: "Original", align: "right", render: (row) => money(row.currency, row.originalAmount) },
            { key: "outstandingAmount", label: "Outstanding", align: "right", render: (row) => <strong>{money(row.currency, row.outstandingAmount)}</strong> },
            { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
            { key: "paymentTerms", label: "Payment Terms", sortable: false, getValue: (row) => row.paymentTermsSnapshot?.days, render: (row) => row.paymentTermsSnapshot?.option ? `${t(row.paymentTermsSnapshot.option)} · ${row.paymentTermsSnapshot.days || 0} ${t("days")}` : "-" },
            { key: "dueDate", label: "Due date", render: (row) => row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "-" }
          ]}
        />
      </div>
      <Drawer open={Boolean(selected)} title="Accounts payable record" description={selected?.request?.requestNumber || ""} onClose={() => setSelected(null)}>
        {selected && <div className="detail-stack">
          <dl className="detail-grid">
            <div><dt>{t("Status")}</dt><dd><StatusBadge status={selected.status} /></dd></div>
            <div><dt>{t("Supplier")}</dt><dd>{selected.supplier?.legalName || selected.supplier?.name}</dd></div>
            <div><dt>{t("Original amount")}</dt><dd>{money(selected.currency, selected.originalAmount)}</dd></div>
            <div><dt>{t("Outstanding amount")}</dt><dd>{money(selected.currency, selected.outstandingAmount)}</dd></div>
            <div><dt>{t("PEN equivalent")}</dt><dd>{money("PEN", selected.penEquivalent)}</dd></div>
            <div><dt>{t("Payment Terms")}</dt><dd>{selected.paymentTermsSnapshot?.option ? `${t(selected.paymentTermsSnapshot.option)} · ${selected.paymentTermsSnapshot.days || 0} ${t("days")}` : "-"}</dd></div>
            <div><dt>{t("Due date")}</dt><dd>{selected.dueDate ? new Date(selected.dueDate).toLocaleDateString() : "-"}</dd></div>
            <div><dt>{t("Payment Destination Snapshot")}</dt><dd>{selected.bankAccountSnapshot?.bank ? `${selected.bankAccountSnapshot.bank} · ${t(selected.bankAccountSnapshot.sourceType || "SUPPLIER")}` : "-"}</dd></div>
            <div><dt>{t("Payment batch")}</dt><dd>{selected.paymentBatch?.batchNumber || "-"}</dd></div>
            <div><dt>{t("Provision entry")}</dt><dd>{selected.provisionJournal?.entryNumber || "-"}</dd></div>
            <div><dt>{t("Payment entry")}</dt><dd>{selected.paymentJournal?.entryNumber || "-"}</dd></div>
          </dl>
          <div className="detail-section"><h3>{t("CXP history")}</h3><div className="compact-lines">{(selected.history || []).map((item) => <div key={item._id || `${item.status}-${item.at}`}><span>{new Date(item.at).toLocaleString()} - {item.comments || t(item.status)}</span><StatusBadge status={item.status} /></div>)}</div></div>
        </div>}
      </Drawer>
    </section>
  );
}
