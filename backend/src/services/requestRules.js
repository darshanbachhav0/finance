import { AppError } from "../utils/AppError.js";
import { MANDATORY_XML_TYPES } from "../utils/constants.js";

export function hasAttachment(request, kind) {
  return request.attachments?.some((attachment) => attachment.kind === kind);
}

export function requiredDocumentsFor(request) {
  const rules = [];
  if (MANDATORY_XML_TYPES.includes(request.requestType)) {
    rules.push({ kind: "XML", min: 1, label: "invoice XML" }, { kind: "PDF", min: 1, label: "invoice PDF" });
  }

  const byNature = {
    "Compra de Bienes": [
      { kind: "QUOTATION", min: 3, label: "three quotations" },
      { kind: "PDF", min: 1, label: "invoice or receipt" }
    ],
    "Contratación de Servicios": [
      { kind: "PDF", min: 1, label: "electronic invoice" },
      { kind: "CONTRACT", min: 1, label: "signed contract" },
      { kind: "CONFORMITY", min: 1, label: "service conformity report" }
    ],
    "Honorarios Profesionales": [
      { kind: "PDF", min: 1, label: "professional-fee receipt" },
      { kind: "CONTRACT", min: 1, label: "service agreement" },
      { kind: "ACTIVITY_REPORT", min: 1, label: "activity report" }
    ],
    "Caja Chica": [{ kind: "SUPPORTING", min: 1, label: "digitized receipts" }],
    "Reembolso / Liquidación": [{ kind: "SUPPORTING", min: 1, label: "validated expense support" }]
  };

  for (const rule of byNature[request.expenseNature] || []) {
    if (!rules.some((existing) => existing.kind === rule.kind)) rules.push(rule);
  }
  return rules;
}

export function assertMandatoryDocuments(request) {
  const missing = requiredDocumentsFor(request).filter((rule) =>
    (request.attachments || []).filter((attachment) => attachment.kind === rule.kind).length < rule.min
  );

  if (missing.length > 0) {
    throw new AppError(422, `Mandatory attachment(s) missing: ${missing.map((item) => item.label).join(", ")}.`);
  }
}

export function assertRequestLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new AppError(422, "At least one request line is required.");
  }

  for (const [index, line] of lines.entries()) {
    if (!line.costCenter || !line.expenseType) {
      throw new AppError(422, `Line ${index + 1} must include Cost Center and Expense Type / Accounting Account.`);
    }
  }
}
