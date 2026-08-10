export const ROLES = {
  ADMIN: "Admin",
  SOLICITOR: "Solicitor",
  APPROVER: "Approver",
  ACCOUNTING: "Accounting",
  TREASURY: "Treasury"
};

export const REQUEST_TYPES = [
  "OPEX",
  "CAPEX",
  "Entrega a Rendir",
  "Reembolso con Sustento",
  "Reembolso sin Sustento",
  "Pago con Cotización"
];

export const EXPENSE_NATURES = [
  "Compra de Bienes",
  "Contratación de Servicios",
  "Honorarios Profesionales",
  "Publicidad",
  "Viajes",
  "Equipamiento",
  "Tecnología",
  "Infraestructura",
  "Laboratorios",
  "Biblioteca",
  "Investigación",
  "Mantenimiento",
  "Caja Chica",
  "Reembolso / Liquidación"
];

export const REQUEST_PRIORITIES = ["BAJA", "MEDIA", "ALTA"];

export const APPROVAL_STAGES = {
  AREA_DIRECTOR: "AREA_DIRECTOR",
  VICE_RECTOR: "VICE_RECTOR",
  COMPLETE: "COMPLETE"
};

export const REQUEST_STATUS = {
  DRAFT: "BORRADOR",
  VALIDATION: "EN_VALIDACION",
  PENDING_APPROVAL: "PENDIENTE_APROBACION",
  OBSERVED: "OBSERVADO",
  RETURNED: "DEVUELTO",
  DIRECTOR_APPROVED: "APROBADO_DIRECTOR",
  VICE_RECTOR_APPROVED: "APROBADO_VICERRECTOR",
  BUDGET_COMMITTED: "COMPROMISO_PRESUPUESTAL",
  ACCOUNTED: "CONTABILIZADO",
  SCHEDULED: "PROGRAMADO",
  REJECTED: "RECHAZADO",
  APPROVED_PAYABLE: "APROBADO_POR_PAGAR",
  BANK_FILE_GENERATED: "TXT_GENERADO",
  BANK_PROCESSED: "PROCESADO_BANCO",
  PAID: "PAGADO",
  RECONCILED: "CONCILIADO",
  RENDITION_PENDING: "RENDICION_PENDIENTE",
  CLOSED: "LIQUIDADO_CERRADO",
  VOIDED: "ANULADO"
};

export const MANDATORY_XML_TYPES = ["Pago con Cotización", "Reembolso con Sustento"];

export const APPROVAL_SLA_HOURS = {
  [APPROVAL_STAGES.AREA_DIRECTOR]: 24,
  [APPROVAL_STAGES.VICE_RECTOR]: 24
};

export const CURRENCY = ["PEN", "USD"];

export const CLOSED_PERIOD_MESSAGE =
  "The accounting period is closed. Registrations and modifications are not allowed.";
