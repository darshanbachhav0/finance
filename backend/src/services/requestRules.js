import { AppError } from "../utils/AppError.js";
import { MANDATORY_XML_TYPES } from "../utils/constants.js";

export function hasAttachment(request, kind) {
  return request.attachments?.some((attachment) => attachment.kind === kind);
}

export function assertMandatoryDocuments(request) {
  if (!MANDATORY_XML_TYPES.includes(request.requestType)) return;

  const missing = [];
  if (!hasAttachment(request, "XML")) missing.push("XML");
  if (!hasAttachment(request, "PDF")) missing.push("PDF");

  if (missing.length > 0) {
    throw new AppError(422, `Mandatory attachment(s) missing: ${missing.join(", ")}.`);
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
