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

export const REQUEST_STATUS = {
  DRAFT: "BORRADOR",
  VALIDATION: "EN_VALIDACION",
  PENDING_APPROVAL: "PENDIENTE_APROBACION",
  REJECTED: "RECHAZADO",
  APPROVED_PAYABLE: "APROBADO_POR_PAGAR",
  BANK_PROCESSED: "PROCESADO_BANCO",
  RENDITION_PENDING: "RENDICION_PENDIENTE",
  CLOSED: "LIQUIDADO_CERRADO"
};

export const MANDATORY_XML_TYPES = ["Pago con Cotización", "Reembolso con Sustento"];

export const CURRENCY = ["PEN", "USD"];

export const CLOSED_PERIOD_MESSAGE =
  "The accounting period is closed. Registrations and modifications are not allowed.";
