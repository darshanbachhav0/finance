import ResourceManager from "../components/ResourceManager.jsx";

export default function ExpenseTypes() {
  return (
    <ResourceManager
      title="Expense Types"
      description="Accounting account catalog for OPEX, CAPEX, and non-deductible request lines."
      endpoint="/expense-types"
      duplicateFields={["code", "accountNumber"]}
      fields={[
        { name: "code", label: "Code", required: true },
        { name: "name", label: "Name", required: true },
        { name: "category", label: "Category", type: "select", required: true, options: ["OPEX", "CAPEX", "Non-deductible"] },
        { name: "accountingClass", label: "Accounting class", type: "select", required: true, options: ["Class 6", "Class 3", "Account 99"] },
        { name: "accountNumber", label: "Account number", required: true },
        { name: "active", label: "Active", type: "checkbox", defaultValue: true }
      ]}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "category", label: "Category" },
        { key: "accountingClass", label: "Class" },
        { key: "accountNumber", label: "Account" },
        { key: "active", label: "Active", render: (row) => (row.active ? "Yes" : "No") }
      ]}
    />
  );
}
