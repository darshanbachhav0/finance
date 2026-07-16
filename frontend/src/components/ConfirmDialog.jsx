import { AlertTriangle, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import useAnimatedPresence from "../hooks/useAnimatedPresence.js";

export default function ConfirmDialog({
  open,
  title,
  description,
  details = [],
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  inputLabel,
  inputRequired = false,
  inputPlaceholder,
  loading = false,
  onConfirm,
  onClose
}) {
  const { t } = useLanguage();
  const [inputValue, setInputValue] = useState("");
  const confirmRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef(null);
  const contentRef = useRef({ title, description, details, confirmLabel, cancelLabel, tone, inputLabel, inputRequired, inputPlaceholder });
  const { shouldRender, phase } = useAnimatedPresence(open, 170);

  onCloseRef.current = onClose;
  if (open) contentRef.current = { title, description, details, confirmLabel, cancelLabel, tone, inputLabel, inputRequired, inputPlaceholder };
  const content = open
    ? { title, description, details, confirmLabel, cancelLabel, tone, inputLabel, inputRequired, inputPlaceholder }
    : contentRef.current;

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    setInputValue("");
    window.setTimeout(() => confirmRef.current?.focus(), 0);
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !loading) onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, loading]);

  useEffect(() => {
    if (!shouldRender) previousFocusRef.current?.focus?.({ preventScroll: true });
  }, [shouldRender]);

  if (!shouldRender) return null;

  const disabled = loading || (content.inputRequired && !inputValue.trim());

  return (
    <div className={`modal-backdrop motion-${phase}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && open && !loading && onClose()}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <header className="dialog-header">
          <div className={`dialog-icon tone-${content.tone}`}><AlertTriangle size={20} /></div>
          <div>
            <h2 id="confirm-title">{t(content.title)}</h2>
            {content.description && <p id="confirm-description">{t(content.description)}</p>}
          </div>
          <button type="button" className="icon-button quiet dialog-close" onClick={onClose} disabled={loading} aria-label={t("Close dialog")}>
            <X size={18} />
          </button>
        </header>
        {content.details.length > 0 && (
          <dl className="confirmation-summary">
            {content.details.map((detail) => (
              <div key={detail.label}>
                <dt>{t(detail.label)}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {content.inputLabel && (
          <label className="field">
            <span>{t(content.inputLabel)}{content.inputRequired ? " *" : ""}</span>
            <textarea
              rows="3"
              value={inputValue}
              placeholder={t(content.inputPlaceholder || "Add comments")}
              onChange={(event) => setInputValue(event.target.value)}
              required={content.inputRequired}
            />
            {content.inputRequired && !inputValue.trim() && <small className="field-hint">{t("A comment is required to continue.")}</small>}
          </label>
        )}
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={loading}>{t(content.cancelLabel)}</button>
          <button
            ref={confirmRef}
            type="button"
            className={content.tone === "danger" ? "danger-button" : "primary-button"}
            disabled={disabled}
            onClick={() => onConfirm(inputValue.trim())}
          >
            {loading && <Loader2 className="spin" size={16} />}
            <span>{t(loading ? "Processing..." : content.confirmLabel)}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
