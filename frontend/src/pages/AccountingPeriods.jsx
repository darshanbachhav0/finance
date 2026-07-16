import ResourceManager from "../components/ResourceManager.jsx";

export default function AccountingPeriods() {
  return (
    <ResourceManager
      title="Accounting Periods"
      description="Closed periods block creation, edits, approvals, payments, and closing changes."
      endpoint="/accounting-periods"
      duplicateFields={["period"]}
      confirmSubmit={(form, editing) => {
        if (!editing || form.status === editing.status) return null;
        const closing = form.status === "CLOSED";
        return {
          title: closing ? "Close accounting period?" : "Reopen accounting period?",
          description: closing
            ? "Closing the period will block request creation, edits, approvals, payments, renditions, and closures for this period."
            : "Reopening the period will allow workflow and accounting changes again.",
          confirmLabel: closing ? "Close period" : "Reopen period",
          tone: closing ? "danger" : "primary",
          details: [{ label: "Period", value: form.period }, { label: "Result", value: closing ? "Status changes to CLOSED" : "Status changes to OPEN" }]
        };
      }}
      fields={[
        { name: "period", label: "Period", required: true },
        { name: "status", label: "Status", type: "select", defaultValue: "OPEN", options: ["OPEN", "CLOSED"] },
        { name: "closingDate", label: "Closing date", type: "date" }
      ]}
      columns={[
        { key: "period", label: "Period" },
        { key: "status", label: "Status" },
        { key: "closingDate", label: "Closing date", render: (row) => (row.closingDate ? row.closingDate.slice(0, 10) : "") },
        { key: "closedBy", label: "Closed by", render: (row) => row.closedBy?.name || "" }
      ]}
    />
  );
}
