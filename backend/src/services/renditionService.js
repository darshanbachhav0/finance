import FinancialRequest from "../models/FinancialRequest.js";
import AccountsPayable from "../models/AccountsPayable.js";
import CostCenter from "../models/CostCenter.js";
import { createRenditionJournal } from "./accountingService.js";
import { validateAccountingDimensions } from "./accountingDimensionService.js";
import { clientIp, recordAudit, workflowEvent } from "./auditService.js";
import { guardAccountingPeriod } from "./periodService.js";
import { notifyRoles, notifyUser, resolveNotification } from "./notificationService.js";
import { parseRequestLines, requestPopulate } from "./requestService.js";
import { assertRequestLines } from "./requestRules.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import { runFinancialOperation } from "./transactionService.js";
import { evaluateConfiguredMobilityLines } from "./financeConfigurationService.js";
import { nextRenditionNumber } from "./sequenceService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../utils/constants.js";
import { addMoney, moneyEquals, multiplyMoney, subtractMoney, sumMoney } from "../utils/money.js";

function renditionAttachments(files, userId) {
  return (files.rendition || []).map((file) => ({
    kind: "RENDITION",
    originalName: file.originalname,
    filename: file.filename,
    path: file.path,
    url: file.url,
    mimetype: file.mimetype,
    size: file.size,
    checksum: file.checksum,
    uploadedBy: userId
  }));
}

function assertOwner(request, user) {
  const owner = request.requester || request.solicitor;
  if (user.role !== ROLES.ADMIN && String(owner) !== String(user._id)) {
    throw new AppError(403, "Only the requester can submit this rendition.", undefined, ERROR_CODES.FORBIDDEN);
  }
}

function parseOptionalArray(value, field) {
  if (value === undefined || value === null || value === "") return [];
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new AppError(422, `${field} must contain valid JSON.`, { field }, ERROR_CODES.VALIDATION_ERROR);
    }
  }
  if (!Array.isArray(parsed)) throw new AppError(422, `${field} must be an array.`, { field }, ERROR_CODES.VALIDATION_ERROR);
  return parsed;
}

export async function submitRendition({ requestId, payload, files, user, req }) {
  const request = await FinancialRequest.findById(requestId).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (request.requestType !== REQUEST_TYPE.ENTREGA_RENDIR || request.status !== REQUEST_STATUS.RENDITION_PENDING) {
    throw new AppError(409, "Rendition is only available for a paid Entrega a Rendir.", { requestType: request.requestType, status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  assertOwner(request, user);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "RENDITION", user, req, module: "RENDITION", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  const lines = parseRequestLines(payload.lines);
  assertRequestLines(lines);
  await validateAccountingDimensions({ requestType: REQUEST_TYPE.OPEX, expenseNature: request.expenseNature, lines, user });
  const amountRendered = sumMoney(lines.map((line) => line.totalAmount));
  const amountReturned = Number(payload.amountReturned || 0);
  if (!Number.isFinite(amountReturned) || amountReturned < 0) {
    throw new AppError(422, "Returned amount must be zero or greater.", { amountReturned: payload.amountReturned }, ERROR_CODES.VALIDATION_ERROR);
  }
  const amountAdvanced = request.rendition.amountAdvanced || request.payment.confirmedAmount || request.totalAmount;
  const balanceOutstanding = subtractMoney(subtractMoney(amountAdvanced, amountRendered), amountReturned);
  if (balanceOutstanding < 0) {
    throw new AppError(422, "Rendered plus returned amounts cannot exceed the advance.", { amountAdvanced, amountRendered, amountReturned }, ERROR_CODES.VALIDATION_ERROR);
  }
  let persisted = {};
  let requestSaved = false;
  try {
    persisted = await persistUploadedFiles(files, { domain: "requests", entityId: request._id });
    const attachments = renditionAttachments(persisted, user._id);
    if (!attachments.length && !(request.attachments || []).some((item) => item.kind === "RENDITION")) {
      throw new AppError(422, "At least one rendition evidence file is required.", undefined, ERROR_CODES.MISSING_REQUIRED_DOCUMENT);
    }
    const firstNewAttachment = request.attachments.length;
    request.attachments.push(...attachments);
    request.rendition.lines = lines.map((line) => ({
      ...line,
      currency: request.currency,
      exchangeRate: request.exchangeRate,
      penEquivalent: multiplyMoney(line.totalAmount, request.exchangeRate)
    }));
    request.rendition.documentIds.push(...request.attachments.slice(firstNewAttachment).map((item) => item._id));
    request.rendition.amountAdvanced = amountAdvanced;
    request.rendition.amountRendered = amountRendered;
    request.rendition.amountReturned = amountReturned;
    request.rendition.balanceOutstanding = balanceOutstanding;
    const mobilityLines = parseOptionalArray(payload.mobilityLines, "mobilityLines");
    const unsupportedExpenseLines = parseOptionalArray(payload.unsupportedExpenseLines, "unsupportedExpenseLines");
    if (payload.mobilityLines !== undefined) request.rendition.mobilityLines = mobilityLines;
    if (payload.unsupportedExpenseLines !== undefined) request.rendition.unsupportedExpenseLines = unsupportedExpenseLines;
    if (mobilityLines.length) {
      const evaluation = await evaluateConfiguredMobilityLines(mobilityLines, request.issueDate);
      request.rendition.limitEvaluation = evaluation.configured ? {
        configuration: evaluation.configurationId,
        key: evaluation.key,
        configuredValue: evaluation.configuredValue,
        currency: evaluation.currency,
        effectiveFrom: evaluation.effectiveFrom,
        effectiveTo: evaluation.effectiveTo,
        behavior: evaluation.behavior,
        evaluatedAt: new Date(),
        exceededLineCount: evaluation.exceededLineCount
      } : undefined;
      request.rendition.mobilityLines.forEach((line, index) => {
        line.limitExceeded = evaluation.lineResults[index]?.exceeded || false;
      });
    }
    request.rendition.number ||= await nextRenditionNumber(request.issueDate || new Date());
    const requesterCostCenter = request.requesterCostCenter
      ? await CostCenter.findById(request.requesterCostCenter).select("code name")
      : null;
    request.rendition.beneficiarySnapshot = {
      user: user._id,
      employeeCode: user.employeeCode,
      name: user.name,
      email: user.email,
      area: user.area,
      costCenter: requesterCostCenter?._id || request.requesterCostCenter,
      costCenterCode: requesterCostCenter?.code,
      costCenterName: requesterCostCenter?.name
    };
    request.rendition.status = "SUBMITTED";
    request.rendition.submittedAt = new Date();
    request.rendition.submittedBy = user._id;
    request.rendition.comments = payload.comments;
    const submissionEvent = workflowEvent({ action: "RENDITION_SUBMITTED", from: request.status, to: request.status, user, req, comments: payload.comments || "Rendition submitted for Accounting validation.", request });
    request.rendition.beneficiaryAcknowledgment = {
      type: "AUTHENTICATED_ELECTRONIC_SIGN_OFF",
      signer: user._id,
      signerName: user.name,
      signedAt: submissionEvent.createdAt,
      ip: clientIp(req),
      reference: submissionEvent.signature
    };
    request.approvalHistory.push(submissionEvent);
    await request.save();
    requestSaved = true;
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "RENDITION_SUBMITTED", user, req, module: "RENDITION", newValues: { amountAdvanced, amountRendered, amountReturned, balanceOutstanding } });
    await resolveNotification(`request:${request._id}:rendition`);
    await notifyRoles({ roles: [ROLES.ACCOUNTING], eventKey: `request:${request._id}:rendition-review`, type: "RENDITION_REVIEW", title: "Rendition ready for review", message: `${request.requestNumber} has submitted rendition evidence.`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
    await request.populate(requestPopulate);
    return request;
  } catch (error) {
    if (!requestSaved) await cleanupUploadedFiles(persisted);
    throw error;
  }
}

export async function reviewRendition({ requestId, action, comments, user, req }) {
  const request = await FinancialRequest.findById(requestId).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (request.status !== REQUEST_STATUS.RENDITION_PENDING || request.rendition?.status !== "SUBMITTED") {
    throw new AppError(409, "Only a submitted rendition can be reviewed.", { status: request.status, renditionStatus: request.rendition?.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "RENDITION", user, req, module: "RENDITION", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  if (action === "OBSERVE") {
    if (!String(comments || "").trim()) throw new AppError(422, "Observation comments are required.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
    request.rendition.status = "OBSERVED";
    request.rendition.comments = comments;
    request.approvalHistory.push(workflowEvent({ action: "RENDITION_OBSERVED", from: request.status, to: request.status, user, req, comments, request }));
    await request.save();
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "RENDITION_OBSERVED", user, req, module: "RENDITION", comments });
    await notifyUser({ userId: request.requester || request.solicitor, eventKey: `request:${request._id}:rendition-observed:${Date.now()}`, type: "RENDITION_OBSERVED", title: "Rendition observed", message: `${request.requestNumber}: ${comments}`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
    return request;
  }
  if (!moneyEquals(request.rendition.balanceOutstanding, 0)) {
    throw new AppError(422, "The full advance must be rendered or returned before validation.", { balanceOutstanding: request.rendition.balanceOutstanding }, ERROR_CODES.RENDITION_REQUIRED);
  }
  if (!(request.attachments || []).some((item) => item.kind === "RENDITION")) {
    throw new AppError(422, "Rendition evidence is missing.", undefined, ERROR_CODES.MISSING_REQUIRED_DOCUMENT);
  }
  const accountsPayable = await AccountsPayable.findOne({ request: request._id });
  return runFinancialOperation(async (session) => {
    const journal = await createRenditionJournal(request, accountsPayable, user._id, { session });
    request.rendition.status = "VALIDATED";
    request.rendition.validatedAt = new Date();
    request.rendition.validator = user._id;
    request.rendition.comments = comments || request.rendition.comments;
    request.approvalHistory.push(workflowEvent({ action: "RENDITION_VALIDATED", from: request.status, to: request.status, user, req, comments: comments || "Rendition validated and actual expense recognized.", request }));
    await request.save({ session });
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "RENDITION_VALIDATED", user, req, module: "RENDITION", newValues: { journal: journal.entryNumber, amountRendered: request.rendition.amountRendered, amountReturned: request.rendition.amountReturned }, session });
    await resolveNotification(`request:${request._id}:rendition-review`);
    await request.populate(requestPopulate);
    return { request, journal };
  });
}
