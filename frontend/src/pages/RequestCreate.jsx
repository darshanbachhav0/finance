import { AlertTriangle, ChevronLeft, ChevronRight, FileCheck2, FileText, Plus, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client.js";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SearchSelect from "../components/SearchSelect.jsx";
import WorkflowStepper from "../components/WorkflowStepper.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { currencies, requestTypes } from "../utils/options.js";

const steps = ["Basic information", "Accounting lines", "Documents", "Review and submit"];
const emptyLine = () => ({ clientId: `${Date.now()}-${Math.random()}`, costCenter: "", expenseType: "", netAmount: "", igvAmount: "", totalAmount: "" });

function initialForm() {
  const today = new Date().toISOString().slice(0, 10);
  return { requestType: "OPEX", issueDate: today, accountingPeriod: today.slice(0, 7), currency: "PEN", supplier: "", description: "" };
}

export default function RequestCreate() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const draftKey = `erp_request_autosave_${user._id}_${id || "new"}`;
  const [masters, setMasters] = useState({ suppliers: [], costCenters: [], expenseTypes: [] });
  const [form, setForm] = useState(initialForm);
  const [lines, setLines] = useState([emptyLine()]);
  const [files, setFiles] = useState({ xml: [], pdf: [], quotation: [], supporting: [] });
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [savedStatus, setSavedStatus] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const calls = [api.get("/suppliers"), api.get("/cost-centers"), api.get("/expense-types")];
        if (isEditing) calls.push(api.get(`/requests/${id}`));
        const [suppliers, costCenters, expenseTypes, requestResponse] = await Promise.all(calls);
        setMasters({
          suppliers: suppliers.data.data.filter((item) => item.status === "ACTIVE"),
          costCenters: costCenters.data.data.filter((item) => item.active),
          expenseTypes: expenseTypes.data.data.filter((item) => item.active)
        });

        if (requestResponse) {
          const request = requestResponse.data.data;
          if (!["BORRADOR", "RECHAZADO"].includes(request.status) || (user.role !== "Admin" && request.solicitor?._id !== user._id)) {
            navigate(`/requests/${id}`, { replace: true });
            return;
          }
          const serverForm = {
            requestType: request.requestType,
            issueDate: request.issueDate.slice(0, 10),
            accountingPeriod: request.accountingPeriod,
            currency: request.currency,
            supplier: request.supplier?._id || request.supplier,
            description: request.description
          };
          const serverLines = request.lines.map((line) => ({
            clientId: line._id,
            costCenter: line.costCenter?._id || line.costCenter,
            expenseType: line.expenseType?._id || line.expenseType,
            netAmount: line.netAmount,
            igvAmount: line.igvAmount,
            totalAmount: line.totalAmount
          }));
          const localDraft = localStorage.getItem(draftKey);
          const parsed = localDraft ? JSON.parse(localDraft) : null;
          const useLocal = parsed?.savedAt && new Date(parsed.savedAt) > new Date(request.updatedAt);
          setForm(useLocal ? parsed.form : serverForm);
          setLines(useLocal && parsed.lines?.length ? parsed.lines : serverLines);
          if (useLocal) setSavedStatus(t("Recovered local draft"));
          setExistingAttachments(request.attachments || []);
        } else {
          const localDraft = localStorage.getItem(draftKey);
          if (localDraft) {
            const parsed = JSON.parse(localDraft);
            setForm(parsed.form || initialForm());
            setLines(parsed.lines?.length ? parsed.lines : [emptyLine()]);
            setSavedStatus(t("Recovered local draft"));
          }
        }
        setHydrated(true);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  useEffect(() => {
    if (!hydrated) return undefined;
    setSavedStatus(t("Saving locally..."));
    const timer = window.setTimeout(() => {
      localStorage.setItem(draftKey, JSON.stringify({ form, lines, savedAt: new Date().toISOString() }));
      setSavedStatus(`${t("Saved locally")} · ${new Date().toLocaleTimeString(language === "es" ? "es-PE" : "en-US", { hour: "2-digit", minute: "2-digit" })}`);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [form, lines, hydrated, draftKey, language]);

  const selectedSupplier = masters.suppliers.find((supplier) => supplier._id === form.supplier);
  const mandatoryDocuments = [requestTypes[3], requestTypes[5]].includes(form.requestType);
  const totals = useMemo(() => lines.reduce((result, line) => ({
    net: result.net + Number(line.netAmount || 0),
    igv: result.igv + Number(line.igvAmount || 0),
    total: result.total + Number(line.totalAmount || 0)
  }), { net: 0, igv: 0, total: 0 }), [lines]);
  const difference = Number((totals.net + totals.igv - totals.total).toFixed(2));

  function updateLine(index, patch) {
    setLines((current) => current.map((line, currentIndex) => currentIndex === index ? { ...line, ...patch } : line));
  }

  function fieldError(name) {
    return errors[name];
  }

  function validateStep(index, submitting = false) {
    const next = {};
    if (index === 0) {
      ["requestType", "issueDate", "accountingPeriod", "currency", "supplier", "description"].forEach((field) => {
        if (!String(form[field] || "").trim()) next[field] = "This field is required.";
      });
      if (form.accountingPeriod && !/^\d{4}-\d{2}$/.test(form.accountingPeriod)) next.accountingPeriod = "Use YYYY-MM format.";
    }
    if (index === 1) {
      if (!lines.length) next.lines = "At least one request line is required.";
      lines.forEach((line, lineIndex) => {
        if (!line.costCenter) next[`lines.${lineIndex}.costCenter`] = "Select a cost center.";
        if (!line.expenseType) next[`lines.${lineIndex}.expenseType`] = "Select an expense account.";
        if (line.netAmount === "" || Number(line.netAmount) < 0) next[`lines.${lineIndex}.netAmount`] = "Enter a valid net amount.";
        if (line.igvAmount === "" || Number(line.igvAmount) < 0) next[`lines.${lineIndex}.igvAmount`] = "Enter a valid IGV amount.";
        if (line.totalAmount === "" || Number(line.totalAmount) <= 0) next[`lines.${lineIndex}.totalAmount`] = "Total must be greater than zero.";
      });
    }
    if (index === 2 && submitting && mandatoryDocuments) {
      const hasXml = existingAttachments.some((item) => item.kind === "XML") || files.xml.length > 0;
      const hasPdf = existingAttachments.some((item) => item.kind === "PDF") || files.pdf.length > 0;
      if (!hasXml) next.xml = "XML is required for this request type.";
      if (!hasPdf) next.pdf = "PDF is required for this request type.";
    }
    setErrors((current) => ({ ...current, ...next }));
    return Object.keys(next).length === 0;
  }

  function nextStep() {
    setErrors({});
    if (!validateStep(step, false)) {
      notify("Review the highlighted fields before continuing.", "error");
      return;
    }
    setErrors({});
    setCompletedSteps((current) => [...new Set([...current, step])]);
    setStep((current) => Math.min(3, current + 1));
    setMaxStep((current) => Math.max(current, step + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToStep(next) {
    if (next <= maxStep) {
      setStep(next);
      setErrors({});
    }
  }

  function appendFiles(kind, fileList) {
    setFiles((current) => ({ ...current, [kind]: Array.from(fileList || []) }));
  }

  async function save(sendForApproval) {
    setErrors({});
    const valid = [0, 1, 2].every((index) => validateStep(index, sendForApproval));
    if (!valid) {
      const firstInvalid = [0, 1, 2].find((index) => !validateStep(index, sendForApproval));
      setStep(firstInvalid ?? 0);
      notify("Review the highlighted fields before continuing.", "error");
      return;
    }

    setSaving(true);
    setError("");
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    data.append("lines", JSON.stringify(lines.map(({ clientId, ...line }) => line)));
    data.append("submit", String(sendForApproval));
    Object.entries(files).forEach(([key, selectedFiles]) => selectedFiles.forEach((file) => data.append(key, file)));

    try {
      const response = isEditing
        ? await api.put(`/requests/${id}`, data, { headers: { "Content-Type": "multipart/form-data" } })
        : await api.post("/requests", data, { headers: { "Content-Type": "multipart/form-data" } });
      localStorage.removeItem(draftKey);
      notify(sendForApproval ? "Request submitted for approval." : isEditing ? "Draft request updated." : "Draft request created.");
      navigate(`/requests/${response.data.data._id}`);
    } catch (err) {
      const details = err.details?.errors ? err.details.errors.join(" ") : "";
      setError(`${err.message}${details ? ` ${details}` : ""}`);
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="page-loader">{t(isEditing ? "Loading request..." : "Loading form data...")}</div>;

  return (
    <section>
      <PageHeader title={isEditing ? "Edit request" : "Create request"} description="Complete each step. Your form data is saved locally while you work." actions={<span className="autosave-status" role="status"><FileCheck2 size={15} />{savedStatus || t("Autosave ready")}</span>} />
      <Message type="error">{error}</Message>
      <div className="request-wizard">
        <WorkflowStepper steps={steps} current={step} completedSteps={completedSteps} maxAccessible={maxStep} onSelect={goToStep} />

        <div className="wizard-workspace">
          {step === 0 && (
            <div className="wizard-step" aria-labelledby="basic-heading">
              <div className="section-heading"><div><h3 id="basic-heading">{t("Basic information")}</h3><p>{t("Identify the supplier, request type, period, and purpose.")}</p></div></div>
              <div className="form-grid two-column-form">
                <label className={`field${fieldError("requestType") ? " field-error" : ""}`}><span>{t("Request type")} *</span><select value={form.requestType} onChange={(event) => setForm({ ...form, requestType: event.target.value })}>{requestTypes.map((type) => <option key={type} value={type}>{t(type)}</option>)}</select>{fieldError("requestType") && <small className="field-error-text">{t(fieldError("requestType"))}</small>}</label>
                <label className={`field${fieldError("issueDate") ? " field-error" : ""}`}><span>{t("Issue date")} *</span><input type="date" value={form.issueDate} onChange={(event) => setForm({ ...form, issueDate: event.target.value, accountingPeriod: event.target.value.slice(0, 7) })} />{fieldError("issueDate") && <small className="field-error-text">{t(fieldError("issueDate"))}</small>}</label>
                <label className={`field${fieldError("accountingPeriod") ? " field-error" : ""}`}><span>{t("Accounting period")} *</span><input type="month" value={form.accountingPeriod} onChange={(event) => setForm({ ...form, accountingPeriod: event.target.value })} />{fieldError("accountingPeriod") && <small className="field-error-text">{t(fieldError("accountingPeriod"))}</small>}<small className="field-hint">{t("Closed periods cannot be used.")}</small></label>
                <label className="field"><span>{t("Currency")} *</span><select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select><small className="field-hint">{form.currency === "USD" ? t("A SUNAT selling rate is required for this date or period.") : t("Exchange rate is fixed at 1.00.")}</small></label>
                <div className="form-span-two">
                  <SearchSelect
                    label="Supplier"
                    value={form.supplier}
                    options={masters.suppliers}
                    onChange={(value) => setForm({ ...form, supplier: value })}
                    getOptionLabel={(supplier) => `${supplier.rucDni} · ${supplier.name}`}
                    error={fieldError("supplier")}
                    required
                    searchPlaceholder="Search by supplier name or RUC/DNI..."
                  />
                  {selectedSupplier && (!selectedSupplier.cci && !selectedSupplier.bankAccount) && <div className="inline-warning"><AlertTriangle size={16} /><span>{t("This supplier has no bank account or CCI. Treasury will not be able to generate payment.")}</span></div>}
                </div>
                <label className={`field form-span-two${fieldError("description") ? " field-error" : ""}`}><span>{t("Description")} *</span><textarea rows="4" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={t("Describe the business purpose and what is being paid.")} />{fieldError("description") && <small className="field-error-text">{t(fieldError("description"))}</small>}</label>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-step" aria-labelledby="lines-heading">
              <div className="section-heading"><div><h3 id="lines-heading">{t("Accounting lines")}</h3><p>{t("Assign every amount to a cost center and expense account.")}</p></div><button type="button" className="secondary-button" onClick={() => setLines((current) => [...current, emptyLine()])}><Plus size={16} /><span>{t("Add line")}</span></button></div>
              <div className="accounting-lines">
                {lines.map((line, index) => {
                  const lineDifference = Number((Number(line.netAmount || 0) + Number(line.igvAmount || 0) - Number(line.totalAmount || 0)).toFixed(2));
                  return (
                    <div className="accounting-line" key={line.clientId}>
                      <div className="line-number">{index + 1}</div>
                      <SearchSelect label="Cost center" value={line.costCenter} options={masters.costCenters} onChange={(value) => updateLine(index, { costCenter: value })} getOptionLabel={(item) => `${item.code} · ${item.name}`} error={fieldError(`lines.${index}.costCenter`)} required searchPlaceholder="Search cost center..." />
                      <SearchSelect label="Expense type / account" value={line.expenseType} options={masters.expenseTypes} onChange={(value) => updateLine(index, { expenseType: value })} getOptionLabel={(item) => `${item.accountNumber} · ${item.name}`} error={fieldError(`lines.${index}.expenseType`)} required searchPlaceholder="Search expense account..." />
                      <label className={`field${fieldError(`lines.${index}.netAmount`) ? " field-error" : ""}`}><span>{t("Net")}</span><input type="number" min="0" step="0.01" value={line.netAmount} onChange={(event) => updateLine(index, { netAmount: event.target.value })} />{fieldError(`lines.${index}.netAmount`) && <small className="field-error-text">{t(fieldError(`lines.${index}.netAmount`))}</small>}</label>
                      <label className={`field${fieldError(`lines.${index}.igvAmount`) ? " field-error" : ""}`}><span>{t("IGV")}</span><input type="number" min="0" step="0.01" value={line.igvAmount} onChange={(event) => updateLine(index, { igvAmount: event.target.value })} />{fieldError(`lines.${index}.igvAmount`) && <small className="field-error-text">{t(fieldError(`lines.${index}.igvAmount`))}</small>}</label>
                      <label className={`field${fieldError(`lines.${index}.totalAmount`) ? " field-error" : ""}`}><span>{t("Total")}</span><input type="number" min="0" step="0.01" value={line.totalAmount} onChange={(event) => updateLine(index, { totalAmount: event.target.value })} />{fieldError(`lines.${index}.totalAmount`) && <small className="field-error-text">{t(fieldError(`lines.${index}.totalAmount`))}</small>}</label>
                      <button type="button" className="icon-button danger line-delete" onClick={() => setLines((current) => current.filter((_, currentIndex) => currentIndex !== index))} disabled={lines.length === 1} title={lines.length === 1 ? t("At least one line is required.") : t("Remove line")}><Trash2 size={17} /></button>
                      {lineDifference !== 0 && <div className="line-warning"><AlertTriangle size={15} /><span>{t("Net + IGV differs from Total by {amount}.").replace("{amount}", Math.abs(lineDifference).toFixed(2))}</span></div>}
                    </div>
                  );
                })}
              </div>
              <div className="totals-bar">
                <div><span>{t("Net amount")}</span><strong>{form.currency} {totals.net.toFixed(2)}</strong></div>
                <div><span>{t("IGV amount")}</span><strong>{form.currency} {totals.igv.toFixed(2)}</strong></div>
                <div className="grand-total"><span>{t("Total amount")}</span><strong>{form.currency} {totals.total.toFixed(2)}</strong></div>
                {difference !== 0 && <div className="totals-warning"><AlertTriangle size={16} /><span>{t("Combined Net + IGV does not equal Total.")}</span></div>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step" aria-labelledby="documents-heading">
              <div className="section-heading"><div><h3 id="documents-heading">{t("Documents")}</h3><p>{t(mandatoryDocuments ? "XML and PDF are required for this request type before submission." : "Attach the documents needed to support this request.")}</p></div></div>
              <div className={`document-requirement ${mandatoryDocuments ? "required" : "optional"}`}><FileText size={20} /><div><strong>{t(mandatoryDocuments ? "Mandatory invoice validation" : "Supporting documentation")}</strong><p>{t(mandatoryDocuments ? "The XML supplier RUC/DNI and amounts will be checked against this request. The PDF is also required." : "XML and PDF are optional for this request type. Add quotations or other support when applicable.")}</p></div></div>
              <div className="document-grid">
                {[
                  { key: "xml", label: "Invoice XML", accept: ".xml", multiple: false, required: mandatoryDocuments },
                  { key: "pdf", label: "Invoice PDF", accept: ".pdf", multiple: false, required: mandatoryDocuments },
                  { key: "quotation", label: "Quotations", accept: ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png", multiple: true },
                  { key: "supporting", label: "Supporting documents", accept: ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.csv,.txt", multiple: true }
                ].map((document) => {
                  const existing = existingAttachments.filter((item) => item.kind === document.key.toUpperCase() || (document.key === "quotation" && item.kind === "QUOTATION") || (document.key === "supporting" && item.kind === "SUPPORTING"));
                  return (
                    <label className={`document-upload${fieldError(document.key) ? " field-error" : ""}`} key={document.key}>
                      <FileText size={22} />
                      <span><strong>{t(document.label)}{document.required ? " *" : ""}</strong><small>{t("Choose file")}</small></span>
                      <input type="file" accept={document.accept} multiple={document.multiple} onChange={(event) => appendFiles(document.key, event.target.files)} />
                      <div className="file-list">
                        {existing.map((file) => <span key={file._id}>{file.originalName} · {t("Already uploaded")}</span>)}
                        {files[document.key].map((file) => <span key={`${file.name}-${file.size}`}>{file.name} · {(file.size / 1024).toFixed(0)} KB</span>)}
                      </div>
                      {fieldError(document.key) && <small className="field-error-text">{t(fieldError(document.key))}</small>}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-step" aria-labelledby="review-heading">
              <div className="section-heading"><div><h3 id="review-heading">{t("Review and submit")}</h3><p>{t("Confirm the request details before sending it into the approval workflow.")}</p></div></div>
              <div className="review-layout">
                <div className="review-section"><div className="section-heading compact"><h3>{t("Basic information")}</h3><button type="button" className="text-button" onClick={() => goToStep(0)}>{t("Edit")}</button></div><dl className="detail-grid"><div><dt>{t("Request type")}</dt><dd>{t(form.requestType)}</dd></div><div><dt>{t("Supplier")}</dt><dd>{selectedSupplier ? `${selectedSupplier.rucDni} · ${selectedSupplier.name}` : "-"}</dd></div><div><dt>{t("Issue date")}</dt><dd>{form.issueDate}</dd></div><div><dt>{t("Accounting period")}</dt><dd>{form.accountingPeriod}</dd></div><div><dt>{t("Currency")}</dt><dd>{form.currency}</dd></div><div className="wide"><dt>{t("Description")}</dt><dd>{form.description}</dd></div></dl></div>
                <div className="review-section"><div className="section-heading compact"><h3>{t("Accounting lines")}</h3><button type="button" className="text-button" onClick={() => goToStep(1)}>{t("Edit")}</button></div><div className="review-lines">{lines.map((line, index) => { const costCenter = masters.costCenters.find((item) => item._id === line.costCenter); const expense = masters.expenseTypes.find((item) => item._id === line.expenseType); return <div key={line.clientId}><span>{index + 1}</span><div><strong>{costCenter?.code} · {costCenter?.name}</strong><small>{expense?.accountNumber} · {expense?.name}</small></div><strong>{form.currency} {Number(line.totalAmount || 0).toFixed(2)}</strong></div>; })}</div><div className="review-total"><span>{t("Total amount")}</span><strong>{form.currency} {totals.total.toFixed(2)}</strong></div></div>
                <div className="review-section"><div className="section-heading compact"><h3>{t("Documents")}</h3><button type="button" className="text-button" onClick={() => goToStep(2)}>{t("Edit")}</button></div><div className="review-documents">{existingAttachments.map((file) => <span key={file._id}><FileText size={15} />{file.kind}: {file.originalName}</span>)}{Object.entries(files).flatMap(([kind, selectedFiles]) => selectedFiles.map((file) => <span key={`${kind}-${file.name}`}><FileText size={15} />{kind.toUpperCase()}: {file.name}</span>))}{!existingAttachments.length && !Object.values(files).some((selectedFiles) => selectedFiles.length) && <p>{t("No files attached.")}</p>}</div></div>
              </div>
              {difference !== 0 && <div className="inline-warning"><AlertTriangle size={17} /><span>{t("Net + IGV does not equal Total. You may save a draft, but verify amounts before submission.")}</span></div>}
            </div>
          )}

          <footer className="wizard-actions">
            <button type="button" className="secondary-button" disabled={step === 0 || saving} onClick={() => setStep((current) => Math.max(0, current - 1))}><ChevronLeft size={16} /><span>{t("Back")}</span></button>
            <div className="wizard-actions-right">
              <button type="button" className="secondary-button" disabled={saving} onClick={() => save(false)}><Save size={16} /><span>{t(saving ? "Saving..." : "Save draft")}</span></button>
              {step < 3 ? <button type="button" className="primary-button" onClick={nextStep}><span>{t("Continue")}</span><ChevronRight size={16} /></button> : <button type="button" className="primary-button" disabled={saving} onClick={() => save(true)}><Send size={16} /><span>{t(saving ? "Submitting..." : "Submit for approval")}</span></button>}
            </div>
          </footer>
        </div>
      </div>
    </section>
  );
}
