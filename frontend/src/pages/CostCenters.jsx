import ResourceManager from "../components/ResourceManager.jsx";

const numberPayload = (form) => ({
  ...form,
  annualBudget: Number(form.annualBudget || 0),
  executedAmount: Number(form.executedAmount || 0)
});

export default function CostCenters() {
  return (
    <ResourceManager
      title="Cost Centers"
      description="Phase 1 tracks assigned, executed, and available budgets without blocking requests."
      endpoint="/cost-centers"
      duplicateFields={["code"]}
      transformSubmit={numberPayload}
      fields={[
        { name: "code", label: "Code", required: true },
        { name: "name", label: "Name", required: true },
        { name: "area", label: "Area", required: true },
        { name: "annualBudget", label: "Annual assigned budget", type: "number", step: "0.01", defaultValue: 0 },
        { name: "executedAmount", label: "Executed amount", type: "number", step: "0.01", defaultValue: 0 },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ]}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "area", label: "Area" },
        { key: "annualBudget", label: "Budget", render: (row) => Number(row.annualBudget || 0).toFixed(2) },
        { key: "executedAmount", label: "Executed", render: (row) => Number(row.executedAmount || 0).toFixed(2) },
        { key: "availableAmount", label: "Available", render: (row) => Number(row.availableAmount || 0).toFixed(2) },
        { key: "active", label: "Active", render: (row) => (row.active ? "Yes" : "No") }
      ]}
    />
  );
}
