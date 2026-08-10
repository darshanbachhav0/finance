import ResourceManager from "../components/ResourceManager.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { apiAssetUrl } from "../api/client.js";
import { Download } from "lucide-react";

export default function Suppliers() {
  const { user } = useAuth();
  const canHomologate = ["Admin", "Accounting"].includes(user.role);

  return (
    <ResourceManager
      title="Suppliers"
      description="Search the local RUC/DNI register, onboard missing suppliers, and control document-based homologation before payment use."
      endpoint="/suppliers"
      readOnly={!canHomologate}
      allowCreate={["Admin", "Accounting", "Solicitor"].includes(user.role)}
      allowEdit={canHomologate}
      allowDelete={canHomologate}
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
            <div><dt>Fiscal address</dt><dd>{supplier.fiscalAddress || "-"}</dd></div>
            <div><dt>Legal representative</dt><dd>{supplier.legalRepresentative || "-"}</dd></div>
            <div><dt>Taxpayer status</dt><dd>{supplier.compliance?.taxpayerActive ? "ACTIVE" : "PENDING"}</dd></div>
            <div><dt>Compliance</dt><dd>{supplier.compliance?.compliant ? "COMPLIANT" : "PENDING"}</dd></div>
          </dl>
          <div><h3>Homologation documents</h3><div className="attachment-list">{(supplier.documents || []).map((item) => <a key={item._id} href={apiAssetUrl(item.url)} target="_blank" rel="noreferrer"><Download size={15} /><span>{item.kind}: {item.originalName}</span></a>)}{!supplier.documents?.length && <p>No homologation documents uploaded.</p>}</div></div>
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
        { name: "fiscalAddress", label: "Fiscal address" },
        { name: "legalRepresentative", label: "Legal representative" },
        { name: "email", label: "Email", type: "email" },
        { name: "contactName", label: "Contact name" },
        { name: "supplierType", label: "Supplier type", defaultValue: "General" },
        { name: "currency", label: "Currency", type: "select", defaultValue: "PEN", options: ["PEN", "USD"] },
        { name: "bankName", label: "Bank name" },
        { name: "bankAccount", label: "Bank account" },
        { name: "cci", label: "CCI" },
        { name: "rucFile", label: "RUC file", type: "file", accept: ".pdf,.jpg,.jpeg,.png", placeholder: "Required for homologation" },
        { name: "bankCertificate", label: "Bank certificate", type: "file", accept: ".pdf,.jpg,.jpeg,.png", placeholder: "Required for homologation" },
        { name: "legalRepId", label: "Legal representative ID", type: "file", accept: ".pdf,.jpg,.jpeg,.png", placeholder: "Required for homologation" },
        ...(canHomologate ? [
          { name: "taxpayerActive", label: "Active taxpayer", type: "checkbox", getValue: (row) => row.compliance?.taxpayerActive },
          { name: "compliant", label: "Compliance approved", type: "checkbox", getValue: (row) => row.compliance?.compliant },
          { name: "complianceComments", label: "Compliance comments", getValue: (row) => row.compliance?.comments },
          { name: "status", label: "Homologation status", type: "select", defaultValue: "PENDING_VALIDATION", options: ["PENDING_VALIDATION", "ACTIVE", "OBSERVED", "INACTIVE"] }
        ] : [])
      ]}
      columns={[
        { key: "rucDni", label: "RUC/DNI" },
        { key: "name", label: "Name" },
        { key: "bankName", label: "Bank" },
        { key: "supplierType", label: "Type" },
        { key: "cci", label: "CCI" },
        { key: "status", label: "Status" }
      ]}
    />
  );
}
