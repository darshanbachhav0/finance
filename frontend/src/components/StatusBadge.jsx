import { useLanguage } from "../context/LanguageContext.jsx";

const classes = {
  BORRADOR: "badge badge-gray",
  EN_VALIDACION: "badge badge-blue",
  PENDIENTE_APROBACION: "badge badge-amber",
  OBSERVADO: "badge badge-red",
  DEVUELTO: "badge badge-amber",
  APROBADO_DIRECTOR: "badge badge-blue",
  APROBADO_VICERRECTOR: "badge badge-blue",
  COMPROMISO_PRESUPUESTAL: "badge badge-amber",
  CONTABILIZADO: "badge badge-blue",
  PROGRAMADO: "badge badge-blue",
  RECHAZADO: "badge badge-red",
  APROBADO_POR_PAGAR: "badge badge-green",
  TXT_GENERADO: "badge badge-indigo",
  PROCESADO_BANCO: "badge badge-indigo",
  PAGADO: "badge badge-green",
  CONCILIADO: "badge badge-green",
  RENDICION_PENDIENTE: "badge badge-amber",
  LIQUIDADO_CERRADO: "badge badge-dark",
  ANULADO: "badge badge-red",
  PENDING_VALIDATION: "badge badge-amber",
  OBSERVED: "badge badge-red",
  TRANSITIONAL: "badge badge-gray",
  ACTIVE: "badge badge-green",
  RESERVED: "badge badge-amber",
  WITHOUT_BUDGET: "badge badge-gray",
  EXECUTED: "badge badge-green",
  RELEASED: "badge badge-blue"
};

export default function StatusBadge({ status }) {
  const { t } = useLanguage();
  return <span className={classes[status] || "badge badge-gray"}>{t(status || "N/A")}</span>;
}
