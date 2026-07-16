import { useLanguage } from "../context/LanguageContext.jsx";

const classes = {
  BORRADOR: "badge badge-gray",
  EN_VALIDACION: "badge badge-blue",
  PENDIENTE_APROBACION: "badge badge-amber",
  RECHAZADO: "badge badge-red",
  APROBADO_POR_PAGAR: "badge badge-green",
  PROCESADO_BANCO: "badge badge-indigo",
  RENDICION_PENDIENTE: "badge badge-amber",
  LIQUIDADO_CERRADO: "badge badge-dark"
};

export default function StatusBadge({ status }) {
  const { t } = useLanguage();
  return <span className={classes[status] || "badge badge-gray"}>{t(status || "N/A")}</span>;
}
