import ResourceManager from "../components/ResourceManager.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function Suppliers() {
  const { user } = useAuth();
  const readOnly = !["Admin", "Accounting"].includes(user.role);

  return (
    <ResourceManager
      title="Suppliers"
      description="Maintain unique RUC/DNI records and bank details used by Treasury payment files."
      endpoint="/suppliers"
      readOnly={readOnly}
      deleteMode="deactivate"
      duplicateFields={["rucDni", "bankAccount", "cci"]}
      detailsTitle="Supplier bank history"
      renderDetails={(supplier) => (
        <div className="detail-stack">
          <dl className="detail-grid">
            <div><dt>RUC/DNI</dt><dd>{supplier.rucDni}</dd></div>
            <div><dt>Name</dt><dd>{supplier.name}</dd></div>
            <div><dt>Current bank</dt><dd>{supplier.bankName || "-"}</dd></div>
            <div><dt>Account / CCI</dt><dd>{supplier.cci || supplier.bankAccount || "Missing"}</dd></div>
          </dl>
          <div>
            <h3>Bank change history</h3>
            <div className="history-list">
              {[...(supplier.bankHistory || [])].reverse().map((item, index) => (
                <div className="history-row" key={`${item.changedAt}-${index}`}>
                  <div><strong>{item.bankName || "Bank not recorded"}</strong><span>{item.cci || item.bankAccount || "No account"}</span></div>
                  <div><span className={`badge ${item.status === "ACTIVE" ? "badge-green" : "badge-gray"}`}>{item.status}</span><small>{item.changedAt ? new Date(item.changedAt).toLocaleString() : ""}</small></div>
                </div>
              ))}
              {!supplier.bankHistory?.length && <p>No bank changes recorded.</p>}
            </div>
          </div>
        </div>
      )}
      fields={[
        { name: "rucDni", label: "RUC/DNI", required: true },
        { name: "name", label: "Supplier name", required: true },
        { name: "bankName", label: "Bank name" },
        { name: "bankAccount", label: "Bank account" },
        { name: "cci", label: "CCI" },
        { name: "status", label: "Status", type: "select", defaultValue: "ACTIVE", options: ["ACTIVE", "INACTIVE"] }
      ]}
      columns={[
        { key: "rucDni", label: "RUC/DNI" },
        { key: "name", label: "Name" },
        { key: "bankName", label: "Bank" },
        { key: "bankAccount", label: "Account" },
        { key: "cci", label: "CCI" },
        { key: "status", label: "Status" }
      ]}
    />
  );
}
