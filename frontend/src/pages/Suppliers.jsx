import { Building2, Edit3, Eye, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import SupplierDetail from "../components/suppliers/SupplierDetail.jsx";
import SupplierForm from "../components/suppliers/SupplierForm.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";

export default function Suppliers() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canPropose = ["Admin", "Accounting", "Solicitor"].includes(user.role);
  const canFinance = ["Admin", "Accounting"].includes(user.role);
  const suppliers = usePaginatedResource("/suppliers", { persistKey: "official-supplier-master", initialPageSize: 10 });
  const [drawer, setDrawer] = useState({ open: false, mode: "view" });
  const [detail, setDetail] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [identifier, setIdentifier] = useState("");
  const [lookup, setLookup] = useState({ checked: false, loading: false, result: null, error: "" });
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    if (searchParams.get("mode") === "new" && canPropose) startCreate();
  }, []);

  const columns = useMemo(() => [
    {
      key: "supplierCode",
      label: "PRV Code",
      width: "110px",
      render: (row) => <strong className="mono-reference">{row.supplierCode || "-"}</strong>
    },
    {
      key: "legalName",
      label: "Supplier",
      render: (row) => <div className="table-primary-cell"><strong>{row.legalName || row.name}</strong><span>{row.commercialName && row.commercialName !== row.legalName ? row.commercialName : row.rucDni}</span></div>
    },
    { key: "rucDni", label: "RUC / DNI", width: "130px" },
    { key: "homologationStatus", label: "Homologation Status", width: "160px", render: (row) => <StatusBadge status={row.homologationStatus} /> },
    { key: "financeReview", label: "Finance Review", width: "140px", getValue: (row) => row.complianceReview?.result || "PENDING", render: (row) => <StatusBadge status={row.complianceReview?.result || "PENDING"} /> },
    {
      key: "bankReadiness",
      label: "Bank Accounts",
      width: "130px",
      sortable: false,
      render: (row) => <div className="table-primary-cell numeric-cell"><strong>{row.activeBankAccountCount || 0}</strong><span>{t("{count} verified").replace("{count}", row.verifiedBankAccountCount || 0)}</span></div>
    }
  ], [t]);

  async function loadSupplier(id, mode = "view") {
    setDrawer({ open: true, mode });
    setLoadingDetail(true);
    try {
      const [detailResponse, readinessResponse] = await Promise.all([
        api.get(`/suppliers/${id}`),
        api.get(`/suppliers/${id}/homologation-readiness`)
      ]);
      setDetail(detailResponse.data.data);
      setReadiness(readinessResponse.data.data);
    } catch (error) {
      notify(error.message, "error");
      setDrawer({ open: false, mode: "view" });
    } finally {
      setLoadingDetail(false);
    }
  }

  async function refreshOpenSupplier() {
    if (!detail?._id) return;
    const [detailResponse, readinessResponse] = await Promise.all([
      api.get(`/suppliers/${detail._id}`),
      api.get(`/suppliers/${detail._id}/homologation-readiness`)
    ]);
    setDetail(detailResponse.data.data);
    setReadiness(readinessResponse.data.data);
  }

  async function mutate(work, successMessage) {
    if (saving) return;
    setSaving(true);
    try {
      await work();
      await refreshOpenSupplier();
      suppliers.reload();
      notify(successMessage, "success");
      return true;
    } catch (error) {
      notify(error.message, "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function startCreate() {
    setIdentifier("");
    setLookup({ checked: false, loading: false, result: null, error: "" });
    setDetail(null);
    setReadiness(null);
    setDrawer({ open: true, mode: "create" });
  }

  async function lookupIdentifier(event) {
    event.preventDefault();
    const normalized = identifier.replace(/\D/g, "");
    if (!/^\d{8}$|^\d{11}$/.test(normalized)) {
      setLookup({ checked: false, loading: false, result: null, error: t("Enter a valid 11-digit RUC or supported 8-digit DNI.") });
      return;
    }
    setLookup({ checked: false, loading: true, result: null, error: "" });
    try {
      const response = await api.get(`/suppliers/lookup/${normalized}`);
      setIdentifier(response.data.normalizedIdentifier);
      setLookup({ checked: true, loading: false, result: response.data.found ? response.data.data : null, error: "" });
    } catch (error) {
      setLookup({ checked: false, loading: false, result: null, error: error.message });
    }
  }

  async function createSupplier(formData) {
    setSaving(true);
    try {
      const response = await api.post("/suppliers", formData);
      notify("Supplier proposal created. No PRV was assigned yet.", "success");
      suppliers.reload();
      const returnTo = searchParams.get("returnTo");
      if (returnTo?.startsWith("/requests/")) {
        navigate(returnTo, { state: { createdSupplierId: response.data.data._id } });
        return true;
      }
      await loadSupplier(response.data.data._id, "view");
      return true;
    } catch (error) {
      notify(error.message, "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function updateSupplier(formData) {
    const success = await mutate(() => api.patch(`/suppliers/${detail._id}/proposal`, formData), "Supplier corrections saved and returned to the review queue.");
    if (success) setDrawer((current) => ({ ...current, mode: "view" }));
    return success;
  }

  function confirmAction(config) {
    setConfirmation({ ...config, loading: false });
  }

  async function runConfirmedAction() {
    const action = confirmation?.action;
    if (!action) return;
    setConfirmation((current) => ({ ...current, loading: true }));
    try {
      const completed = await action();
      if (completed !== false) setConfirmation(null);
      else setConfirmation((current) => ({ ...current, loading: false }));
    } catch {
      setConfirmation((current) => ({ ...current, loading: false }));
    }
  }

  function requestFinanceReview(review) {
    const descriptions = {
      APPROVED: "Records Finance approval. It does not assign a PRV until every homologation control passes.",
      OBSERVED: "Marks the supplier as observed and returns permitted proposal fields for correction.",
      REJECTED: "Rejects this onboarding record. No PRV will be assigned and the identifier cannot be recreated to bypass rejection.",
      PENDING: "Returns the Finance review to pending without homologating the supplier."
    };
    confirmAction({
      title: "Confirm Finance review",
      description: descriptions[review.result],
      confirmLabel: "Record Finance review",
      tone: review.result === "REJECTED" ? "danger" : "primary",
      details: [{ label: "Result", value: t(review.result) }, { label: "Supplier", value: detail.legalName || detail.name }],
      action: () => mutate(() => api.post(`/suppliers/${detail._id}/review`, review), "Finance review recorded.")
    });
  }

  const rowActions = (row) => [
    { label: "View supplier record", icon: Eye, onClick: () => loadSupplier(row._id, "view") },
    { label: "Edit proposal", icon: Edit3, hidden: !row.permissions?.canEditProposal, onClick: () => loadSupplier(row._id, "edit") },
    { label: "Open Finance review", icon: ShieldCheck, hidden: !canFinance, onClick: () => loadSupplier(row._id, "view") }
  ];

  const drawerTitle = drawer.mode === "create"
    ? "New Supplier Proposal"
    : drawer.mode === "edit"
      ? "Correct Supplier Proposal"
      : detail?.legalName || detail?.name || "Supplier Record";

  return (
    <div className="page-shell supplier-page">
      <PageHeader
        title="Supplier Master & Homologation"
        description="RCO-FOR-002 onboarding, protected evidence, Finance review, banking history and controlled PRV assignment."
        actions={<>{<button type="button" className="secondary-button" onClick={suppliers.reload}><RefreshCw size={16} /><span>{t("Refresh")}</span></button>}{canPropose && <button type="button" className="primary-button" onClick={startCreate}><Plus size={16} /><span>{t("New supplier")}</span></button>}</>}
      />

      {suppliers.error && <div className="inline-alert alert-error" role="alert">{t("Supplier records could not be loaded.")} {suppliers.error}</div>}

      <DataTable
        tableId="official-supplier-master"
        caption="Supplier Master and Homologation"
        columns={columns}
        rows={suppliers.rows}
        loading={suppliers.loading}
        remote={suppliers.remote}
        rowActions={rowActions}
        onRowClick={(row) => loadSupplier(row._id, "view")}
        filters={[
          { key: "homologationStatus", label: "Homologation Status", allLabel: "All homologation statuses", options: ["PENDING_VALIDATION", "HOMOLOGATED", "OBSERVED", "REJECTED", "INACTIVE"] },
          { key: "complianceReviewResult", label: "Finance Review", allLabel: "All Finance review results", options: ["PENDING", "APPROVED", "OBSERVED", "REJECTED"] }
        ]}
        searchPlaceholder="Search by PRV, RUC, legal or commercial name..."
        exportable
        emptyDescription="No suppliers match the current search and filters."
      />

      <Drawer
        open={drawer.open}
        size="xlarge"
        title={drawerTitle}
        description={drawer.mode === "create" ? "Lookup the identifier before creating a new supplier record." : "Official supplier onboarding and homologation record."}
        onClose={() => !saving && setDrawer({ open: false, mode: "view" })}
      >
        {drawer.mode === "create" && !lookup.checked && (
          <div className="supplier-lookup-step">
            <div className="lookup-illustration"><Building2 size={22} /><div><strong>{t("Search Supplier Master first")}</strong><span>{t("An existing pending, observed, rejected, inactive or homologated identifier must be opened instead of duplicated.")}</span></div></div>
            <form className="supplier-lookup-form" onSubmit={lookupIdentifier}>
              <label className="field"><span>{t("RUC / identifier")}</span><input autoFocus value={identifier} onChange={(event) => setIdentifier(event.target.value)} inputMode="numeric" placeholder={t("Enter 11-digit RUC or supported 8-digit DNI")} /></label>
              <button type="submit" className="primary-button" disabled={lookup.loading}>{lookup.loading ? t("Searching...") : t("Search Supplier Master")}</button>
            </form>
            {lookup.error && <div className="inline-alert alert-error" role="alert">{lookup.error}</div>}
          </div>
        )}

        {drawer.mode === "create" && lookup.checked && lookup.result && (
          <div className="supplier-existing-result">
            <div className="inline-alert alert-info"><Building2 size={18} /><div><strong>{t("Supplier already exists")}</strong><span>{t("Open the existing record. A duplicate will not be created.")}</span></div></div>
            <dl className="supplier-detail-grid">
              <div><dt>{t("Legal Name")}</dt><dd>{lookup.result.legalName}</dd></div>
              <div><dt>{t("RUC / identifier")}</dt><dd>{lookup.result.rucDni}</dd></div>
              <div><dt>{t("PRV Code")}</dt><dd>{lookup.result.supplierCode || "-"}</dd></div>
              <div><dt>{t("Homologation Status")}</dt><dd><StatusBadge status={lookup.result.homologationStatus} /></dd></div>
            </dl>
            <div className="supplier-form-actions"><button type="button" className="secondary-button" onClick={() => setLookup({ checked: false, loading: false, result: null, error: "" })}>{t("Search another identifier")}</button><button type="button" className="primary-button" onClick={() => loadSupplier(lookup.result._id, lookup.result.permissions?.canEditProposal ? "edit" : "view")}>{t("Open existing supplier")}</button></div>
          </div>
        )}

        {drawer.mode === "create" && lookup.checked && !lookup.result && (
          <SupplierForm key={`create-${identifier}`} identifier={identifier} includeInitialBank loading={saving} onSubmit={createSupplier} onCancel={() => setDrawer({ open: false, mode: "view" })} />
        )}

        {drawer.mode === "edit" && detail && (
          <SupplierForm key={`edit-${detail._id}-${detail.updatedAt}`} supplier={detail} loading={saving} onSubmit={updateSupplier} onCancel={() => setDrawer((current) => ({ ...current, mode: "view" }))} />
        )}

        {drawer.mode === "view" && loadingDetail && <div className="supplier-detail-loading"><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line" /></div>}

        {drawer.mode === "view" && detail && !loadingDetail && (
          <SupplierDetail
            key={`${detail._id}-${detail.updatedAt}`}
            supplier={detail}
            readiness={readiness}
            loading={saving}
            onEdit={() => setDrawer((current) => ({ ...current, mode: "edit" }))}
            onAddBank={(bank) => mutate(() => api.post(`/suppliers/${detail._id}/bank-accounts`, bank), "Pending bank account added without removing account history.")}
            onReviewBank={(account, review) => mutate(() => api.post(`/suppliers/${detail._id}/bank-accounts/${account._id}/verify`, review), "Bank verification and ownership review recorded.")}
            onPreferred={(account) => mutate(() => api.post(`/suppliers/${detail._id}/bank-accounts/${account._id}/preferred`), "Preferred bank account changed. Previous accounts were retained.")}
            onDeactivateBank={(account) => confirmAction({ title: "Deactivate bank account?", description: "The account becomes inactive and cannot be preferred. Its history remains available.", confirmLabel: "Deactivate account", tone: "danger", details: [{ label: "Bank", value: account.bank }, { label: "Account", value: account.accountNumber }], action: () => mutate(() => api.delete(`/suppliers/${detail._id}/bank-accounts/${account._id}`), "Bank account deactivated and retained in history.") })}
            onTaxValidation={(validation) => mutate(() => api.post(`/suppliers/${detail._id}/taxpayer-validation`, validation), "Taxpayer validation source and result recorded.")}
            onFinanceReview={requestFinanceReview}
            onHomologate={() => confirmAction({ title: "Homologate supplier and assign PRV?", description: "This assigns one immutable PRV code, activates the supplier, and makes it available to the existing request workflow. It does not create a payment or change Treasury transactions.", confirmLabel: "Homologate and assign PRV", details: [{ label: "Supplier", value: detail.legalName || detail.name }, { label: "Result", value: t("Active homologated supplier") }], action: () => mutate(() => api.post(`/suppliers/${detail._id}/homologate`), "Supplier homologated and immutable PRV assigned.") })}
            onDeactivateSupplier={() => confirmAction({ title: "Deactivate supplier?", description: "The supplier and its active bank accounts become inactive. Historical requests, payments and audit records remain unchanged.", confirmLabel: "Deactivate supplier", tone: "danger", details: [{ label: "Supplier", value: detail.legalName || detail.name }, { label: "PRV Code", value: detail.supplierCode || "-" }], action: () => mutate(() => api.delete(`/suppliers/${detail._id}`), "Supplier deactivated. Historical records were preserved.") })}
          />
        )}
      </Drawer>

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title}
        description={confirmation?.description}
        confirmLabel={confirmation?.confirmLabel}
        tone={confirmation?.tone}
        details={confirmation?.details || []}
        loading={confirmation?.loading}
        onConfirm={runConfirmedAction}
        onClose={() => !confirmation?.loading && setConfirmation(null)}
      />
    </div>
  );
}
