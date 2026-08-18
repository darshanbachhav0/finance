import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import AccountsPayable from "../models/AccountsPayable.js";
import JournalEntry from "../models/JournalEntry.js";
import PaymentBatch from "../models/PaymentBatch.js";
import Reconciliation from "../models/Reconciliation.js";
import { recordAudit, workflowEvent } from "./auditService.js";
import { validateAccountingDimensions } from "./accountingDimensionService.js";
import { initializeApprovalRoute } from "./approvalRuleService.js";
import { assertConfiguredDocuments, configuredDocumentRequirements } from "./documentRuleService.js";
import { applyExchangeRate } from "./exchangeRateService.js";
import { guardAccountingPeriod, periodFromDate } from "./periodService.js";
import { notifyRoles, resolveNotification } from "./notificationService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "./queryService.js";
import { assertRequestLines } from "./requestRules.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import { assertSupplierUsable } from "./supplierService.js";
import { transitionRequest } from "./workflowService.js";
import { validateXmlAgainstRequest } from "./xmlValidationService.js";
import { releaseBudget } from "./budgetService.js";
import { AppError } from "../utils/AppError.js";
import {
  ERROR_CODES,
  MANDATORY_XML_TYPES,
  REQUEST_STATUS,
  ROLES
} from "../utils/constants.js";
import { canModifyRequest, canViewRequest } from "../utils/permissions.js";

export const requestPopulate = [
  { path: "supplier" },
  { path: "requester", select: "name email role area costCenter authorizedCostCenters" },
  { path: "solicitor", select: "name email role area costCenter authorizedCostCenters" },
  { path: "requesterCostCenter" },
  { path: "lines.costCenter" },
  { path: "lines.expenseType" },
  { path: "quotations.supplier", select: "supplierCode name commercialName legalName rucDni normalizedIdentifier homologationStatus" },
  { path: "approvalHistory.actor", select: "name email role approvalLevel" },
  { path: "approvalRouteSnapshot.completedBy", select: "name email role approvalLevel" },
  { path: "budgetCommitment" },
  { path: "accountsPayable" },
  { path: "purchaseOrder" },
  { path: "paymentBatch" },
  { path: "reconciliation" },
  { path: "fiscalData.processedBy", select: "name email role" },
  { path: "payment.confirmedBy", select: "name email role" },
  { path: "rendition.submittedBy", select: "name email role" },
  { path: "rendition.validator", select: "name email role" }
];

export const requestListSelect = [
  "requestNumber", "issueDate", "accountingPeriod", "requester", "solicitor", "requesterArea", "requestingArea",
  "schoolOrDepartment", "requestType", "expenseNature", "priority", "project", "areaCorrelative", "title", "currency", "exchangeRate",
  "totalNet", "totalIGV", "totalAmount", "totalPENEquivalent", "supplier", "supplierSnapshot", "status",
  "description", "approvalStage", "approvalDueAt", "createdAt", "updatedAt"
].join(" ");

export const requestListPopulate = [
  { path: "supplier", select: "supplierCode name commercialName legalName rucDni normalizedIdentifier homologationStatus active" },
  { path: "requester", select: "name email role area" },
  { path: "solicitor", select: "name email role area" }
];

const attachmentKinds = Object.freeze({
  xml: "XML",
  pdf: "PDF",
  quotation: "QUOTATION",
  purchaseOrder: "PURCHASE_ORDER",
  contract: "CONTRACT",
  conformity: "CONFORMITY",
  activityReport: "ACTIVITY_REPORT",
  supporting: "SUPPORTING",
  rendition: "RENDITION",
  returnReceipt: "RETURN_RECEIPT"
});

function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

function parseJson(value, field) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value || "null");
  } catch {
    throw new AppError(400, `${field} must contain valid JSON.`, { field }, ERROR_CODES.VALIDATION_ERROR);
  }
}

export function parseRequestLines(value) {
  const parsed = parseJson(value, "lines") || [];
  if (!Array.isArray(parsed)) throw new AppError(400, "lines must be an array.", { field: "lines" }, ERROR_CODES.VALIDATION_ERROR);
  return parsed.map((line) => ({
    itemDescription: line.itemDescription || "",
    quantity: line.quantity === "" || line.quantity === undefined || line.quantity === null ? undefined : Number(line.quantity),
    unitOfMeasure: line.unitOfMeasure || "",
    unitPrice: line.unitPrice === "" || line.unitPrice === undefined || line.unitPrice === null ? undefined : Number(line.unitPrice),
    costCenter: line.costCenter?._id || line.costCenter,
    expenseType: line.expenseType?._id || line.expenseType,
    budgetItem: line.budgetItem || line.budgetItemId || "",
    projectId: line.projectId || "",
    subAccount: line.subAccount || "",
    netAmount: Number(line.netAmount ?? line.net ?? 0),
    igvAmount: Number(line.igvAmount ?? line.igv ?? 0),
    totalAmount: Number(line.totalAmount ?? line.total ?? 0)
  }));
}

function parseQuotations(value) {
  const parsed = parseJson(value, "quotations") || [];
  if (!Array.isArray(parsed)) throw new AppError(400, "quotations must be an array.", { field: "quotations" }, ERROR_CODES.VALIDATION_ERROR);
  return parsed.map((quotation) => ({
    supplier: quotation.supplier?._id || quotation.supplier,
    amount: quotation.amount === "" || quotation.amount === undefined || quotation.amount === null ? undefined : Number(quotation.amount),
    currency: quotation.currency,
    deliveryPeriod: quotation.deliveryPeriod || "",
    paymentConditions: quotation.paymentConditions || "",
    commercialConditions: quotation.commercialConditions || "",
    attachment: quotation.attachment?._id || quotation.attachment,
    recommended: parseBoolean(quotation.recommended)
  }));
}

function mapAttachments(files, userId) {
  return Object.entries(attachmentKinds).flatMap(([field, kind]) =>
    (files[field] || []).map((file) => ({
      kind,
      originalName: file.originalname,
      filename: file.filename,
      path: file.path,
      url: file.url,
      mimetype: file.mimetype,
      size: file.size,
      checksum: file.checksum,
      uploadedBy: userId
    }))
  );
}

function supplierSnapshot(supplier) {
  return {
    identifierType: supplier.identifierType,
    identifier: supplier.normalizedIdentifier || supplier.rucDni,
    legalName: supplier.legalName || supplier.name,
    homologationStatus: supplier.homologationStatus || supplier.status
  };
}

async function applyQuotationSnapshots(request) {
  const supplierIds = (request.quotations || []).map((quotation) => quotation.supplier?._id || quotation.supplier).filter(Boolean);
  if (!supplierIds.length) return;
  const suppliers = await Supplier.find({ _id: { $in: supplierIds } }).select("identifierType normalizedIdentifier rucDni legalName name");
  const byId = new Map(suppliers.map((supplier) => [String(supplier._id), supplier]));
  for (const quotation of request.quotations || []) {
    const supplier = byId.get(String(quotation.supplier?._id || quotation.supplier || ""));
    if (!supplier) continue;
    quotation.supplierSnapshot = {
      identifierType: supplier.identifierType,
      identifier: supplier.normalizedIdentifier || supplier.rucDni,
      legalName: supplier.legalName || supplier.name
    };
  }
}

function applyEditableFields(request, payload) {
  const fields = [
    "requestType",
    "expenseNature",
    "priority",
    "schoolOrDepartment",
    "project",
    "areaCorrelative",
    "title",
    "detailedDescription",
    "businessJustification",
    "nonApprovalRisk",
    "supplierSelectionReason",
    "issueDate",
    "accountingPeriod",
    "currency",
    "supplier",
    "description"
  ];
  for (const field of fields) if (payload[field] !== undefined) request[field] = payload[field];
  if (payload.capexDetails !== undefined) request.capexDetails = parseJson(payload.capexDetails, "capexDetails") || {};
  if (payload.opexDetails !== undefined) request.opexDetails = parseJson(payload.opexDetails, "opexDetails") || {};
  if (payload.quotations !== undefined) request.quotations = parseQuotations(payload.quotations);
}

async function prepareRequest(request, { user, files = {}, validateSubmission = false }) {
  assertRequestLines(request.lines);
  await validateAccountingDimensions({
    requestType: request.requestType,
    expenseNature: request.expenseNature,
    lines: request.lines,
    user
  });
  const supplier = await Supplier.findById(request.supplier?._id || request.supplier);
  if (!supplier) throw new AppError(404, "Supplier not found.", { supplier: request.supplier }, ERROR_CODES.NOT_FOUND);
  request.supplierSnapshot = supplierSnapshot(supplier);
  await applyQuotationSnapshots(request);
  request.requesterCostCenter ||= user.costCenter;
  await applyExchangeRate(request);
  await request.validate();

  const xmlAttachment = [...(request.attachments || [])].reverse().find((attachment) => attachment.kind === "XML");
  if (xmlAttachment) {
    request.xmlValidation = await validateXmlAgainstRequest(xmlAttachment.path, {
      supplier,
      fiscalData: request.fiscalData,
      totalNet: request.totalNet,
      totalIGV: request.totalIGV,
      totalAmount: request.totalAmount,
      issueDate: request.issueDate
    }, {
      request,
      requestNumber: request.requestNumber,
      supplier,
      user,
      fileName: xmlAttachment.originalName
    });
    request.xmlValidationHistory.push(request.xmlValidation);
  }

  if (validateSubmission) {
    assertSupplierUsable(supplier);
    await assertConfiguredDocuments(request);
    if (MANDATORY_XML_TYPES.includes(request.requestType) && !request.xmlValidation?.validated) {
      throw new AppError(422, "A valid XML fiscal document is required.", { requestType: request.requestType }, ERROR_CODES.XML_VALIDATION_FAILED);
    }
  }
  return { supplier, files };
}

async function submitPreparedRequest(request, { user, req, comments }) {
  await initializeApprovalRoute(request);
  request.rejectionReason = "";
  await request.save();
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.VALIDATION, user, req, action: "VALIDATION_STARTED", comments });
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.SENT, user, req, action: "SUBMITTED", comments });
  await transitionRequest({
    request,
    targetStatus: REQUEST_STATUS.PENDING_APPROVAL,
    user,
    req,
    action: "APPROVAL_REQUESTED",
    comments: comments || "Submitted for approval.",
    nextApprovalStage: request.approvalStage,
    dueAt: request.approvalDueAt
  });
  await notifyRoles({
    roles: ["Approver", "Management"],
    approvalLevel: request.approvalStage,
    areas: request.approvalStage === "AREA_DIRECTOR" ? [request.requesterArea || request.requestingArea] : undefined,
    eventKey: `request:${request._id}:approval:${request.approvalStage}`,
    type: "APPROVAL_PENDING",
    title: "Approval pending",
    message: `${request.requestNumber} is waiting for ${request.approvalStage} approval.`,
    path: `/approvals?request=${request._id}`,
    entityType: "FinancialRequest",
    entityId: request._id
  });
  return request;
}

export async function listRequestsPage(queryParams, user) {
  const query = {};
  if (user.role === ROLES.SOLICITOR) query.$or = [{ requester: user._id }, { solicitor: user._id }];
  if ([ROLES.APPROVER, ROLES.MANAGEMENT].includes(user.role)) query.status = { $ne: REQUEST_STATUS.DRAFT };
  if (queryParams.status) query.status = queryParams.status;
  if ([ROLES.APPROVER, ROLES.MANAGEMENT].includes(user.role) && queryParams.status === REQUEST_STATUS.DRAFT) query.status = "__FORBIDDEN_DRAFT__";
  if (queryParams.type || queryParams.requestType) query.requestType = queryParams.type || queryParams.requestType;
  if (queryParams.expenseNature) query.expenseNature = queryParams.expenseNature;
  if (queryParams.priority) query.priority = queryParams.priority;
  if (queryParams.period) query.accountingPeriod = queryParams.period;
  if (queryParams.currency) query.currency = queryParams.currency;
  if (queryParams.supplier) query.supplier = queryParams.supplier;
  if (queryParams.project) query.project = queryParams.project;
  if (queryParams.costCenter) query["lines.costCenter"] = queryParams.costCenter;
  if (queryParams.area) query.$and = [...(query.$and || []), { $or: [{ requesterArea: queryParams.area }, { requestingArea: queryParams.area }] }];
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    const [supplierIds, userIds] = await Promise.all([
      Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { normalizedIdentifier: search }, { rucDni: search }] }),
      User.distinct("_id", { $or: [{ name: search }, { email: search }, { area: search }] })
    ]);
    query.$and = [...(query.$and || []), { $or: [
      { requestNumber: search },
      { areaCorrelative: search },
      { title: search },
      { description: search },
      { requesterArea: search },
      { requestingArea: search },
      { "supplierSnapshot.legalName": search },
      { "supplierSnapshot.identifier": search },
      { supplier: { $in: supplierIds } },
      { requester: { $in: userIds } },
      { solicitor: { $in: userIds } }
    ] }];
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["requestNumber", "requestType", "expenseNature", "priority", "issueDate", "accountingPeriod", "status", "totalAmount", "totalPENEquivalent", "createdAt", "updatedAt"], { createdAt: -1 });
  const [data, total] = await Promise.all([
    FinancialRequest.find(query).select(requestListSelect).populate(requestListPopulate).sort(sort).skip(skip).limit(pageSize),
    FinancialRequest.countDocuments(query)
  ]);
  return paginatedPayload(data, total, page, pageSize);
}

export async function getRequestDetail(id, user) {
  const request = await FinancialRequest.findById(id).populate(requestPopulate);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canViewRequest(request, user)) throw new AppError(403, "You do not have permission to view this request.", undefined, ERROR_CODES.FORBIDDEN);
  const [accountsPayable, journalEntries, paymentBatches, reconciliation, audit] = await Promise.all([
    AccountsPayable.find({ request: request._id }).populate("supplier", "name legalName rucDni").sort({ createdAt: 1 }),
    JournalEntry.find({ request: request._id }).sort({ accountingDate: 1, createdAt: 1 }),
    PaymentBatch.find({ "items.request": request._id }).select("-filePath").sort({ generatedAt: -1 }),
    Reconciliation.findOne({ request: request._id }).populate("reconciledBy", "name email role"),
    AuditLog.find({ $or: [{ requestId: request._id }, { entityType: "FinancialRequest", entityId: request._id }] })
      .populate("user", "name email role").sort({ createdAt: 1 })
  ]);
  return { request, accountsPayable, journalEntries, paymentBatches, reconciliation, audit };
}

export async function createFinancialRequest({ payload, files, user, req }) {
  const lines = parseRequestLines(payload.lines);
  const accountingPeriod = payload.accountingPeriod || periodFromDate(payload.issueDate);
  await guardAccountingPeriod({ period: accountingPeriod, action: "CREATE", user, req, module: "REQUESTS", entityType: "FinancialRequest" });
  const request = new FinancialRequest({
    requestType: payload.requestType,
    expenseNature: payload.expenseNature,
    priority: payload.priority,
    requester: user._id,
    solicitor: user._id,
    requesterArea: user.area,
    requestingArea: user.area,
    requesterCostCenter: user.costCenter,
    schoolOrDepartment: payload.schoolOrDepartment || user.area,
    project: payload.project,
    issueDate: payload.issueDate,
    accountingPeriod,
    currency: payload.currency,
    supplier: payload.supplier,
    description: payload.description,
    areaCorrelative: payload.areaCorrelative,
    title: payload.title,
    detailedDescription: payload.detailedDescription,
    businessJustification: payload.businessJustification,
    nonApprovalRisk: payload.nonApprovalRisk,
    capexDetails: parseJson(payload.capexDetails, "capexDetails") || {},
    opexDetails: parseJson(payload.opexDetails, "opexDetails") || {},
    quotations: parseQuotations(payload.quotations),
    supplierSelectionReason: payload.supplierSelectionReason,
    lines,
    draftSavedAt: new Date()
  });
  let persistedFiles = {};
  let saved = false;
  try {
    persistedFiles = await persistUploadedFiles(files, { domain: "requests", entityId: request._id });
    request.attachments.push(...mapAttachments(persistedFiles, user._id));
    const submit = parseBoolean(payload.submit);
    await prepareRequest(request, { user, files: persistedFiles, validateSubmission: submit });
    request.approvalHistory.push(workflowEvent({ action: "CREATED", to: REQUEST_STATUS.DRAFT, user, req, comments: "Draft created.", request }));
    await request.save();
    saved = true;
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "CREATED", user, req, module: "REQUESTS", newValues: { status: request.status } });
    if (submit) await submitPreparedRequest(request, { user, req, comments: payload.comments });
    await request.populate(requestPopulate);
    return request;
  } catch (error) {
    if (!saved) await cleanupUploadedFiles(persistedFiles);
    throw error;
  }
}

export async function updateFinancialRequest({ id, payload, files, user, req }) {
  const request = await FinancialRequest.findById(id).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canModifyRequest(request, user)) throw new AppError(403, "This request cannot be modified in its current state.", { status: request.status }, ERROR_CODES.FORBIDDEN);
  const nextPeriod = payload.accountingPeriod || request.accountingPeriod;
  await guardAccountingPeriod({ period: nextPeriod, action: "UPDATE", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  const oldValues = { status: request.status, supplier: request.supplier, totalAmount: request.totalAmount, accountingPeriod: request.accountingPeriod };
  if (payload.lines !== undefined) request.lines = parseRequestLines(payload.lines);
  applyEditableFields(request, payload);
  request.draftSavedAt = new Date();
  let persistedFiles = {};
  let saved = false;
  try {
    persistedFiles = await persistUploadedFiles(files, { domain: "requests", entityId: request._id });
    request.attachments.push(...mapAttachments(persistedFiles, user._id));
    const submit = parseBoolean(payload.submit);
    await prepareRequest(request, { user, files: persistedFiles, validateSubmission: submit });
    await request.save();
    saved = true;
    await recordAudit({
      entityType: "FinancialRequest",
      entity: request,
      action: "UPDATED",
      user,
      req,
      module: "REQUESTS",
      oldValues,
      newValues: { supplier: request.supplier, totalAmount: request.totalAmount, accountingPeriod: request.accountingPeriod }
    });
    if (submit) await submitPreparedRequest(request, { user, req, comments: payload.comments });
    await request.populate(requestPopulate);
    return request;
  } catch (error) {
    if (!saved) await cleanupUploadedFiles(persistedFiles);
    throw error;
  }
}

export async function submitFinancialRequest({ id, user, req, comments }) {
  const request = await FinancialRequest.findById(id).select("+attachments.path").populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canModifyRequest(request, user)) throw new AppError(403, "This request cannot be submitted.", { status: request.status }, ERROR_CODES.FORBIDDEN);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "SUBMIT", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await prepareRequest(request, { user, validateSubmission: true });
  await submitPreparedRequest(request, { user, req, comments });
  await request.populate(requestPopulate);
  return request;
}

export async function voidFinancialRequest({ id, user, req, comments }) {
  const reason = String(comments || "").trim();
  if (!reason) throw new AppError(422, "A void reason is required.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  const request = await FinancialRequest.findById(id);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "VOID", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await releaseBudget(request, user._id, reason);
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.VOIDED, user, req, action: "VOIDED", comments: reason });
  await request.populate(requestPopulate);
  return request;
}

export async function closeFinancialRequest({ id, user, req, comments }) {
  const request = await FinancialRequest.findById(id);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "CLOSE", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.CLOSED, user, req, action: "CLOSED", comments: comments || "Request closed." });
  await resolveNotification(`request:${request._id}:close`);
  await request.populate(requestPopulate);
  return request;
}

export async function deleteFinancialRequest({ id, user, req }) {
  const request = await FinancialRequest.findById(id).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canModifyRequest(request, user) || ![REQUEST_STATUS.DRAFT, REQUEST_STATUS.REJECTED].includes(request.status)) {
    throw new AppError(403, "Only permitted draft or rejected requests can be deleted.", { status: request.status }, ERROR_CODES.FORBIDDEN);
  }
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "DELETE", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: "DELETED", user, req, module: "REQUESTS", oldValues: { status: request.status, requestNumber: request.requestNumber } });
  await request.deleteOne();
  await cleanupUploadedFiles({ attachments: request.attachments.filter((attachment) => attachment.path) });
  return request;
}

export async function requestDocumentRequirements(query) {
  return configuredDocumentRequirements({ requestType: query.requestType, expenseNature: query.expenseNature, attachments: [] });
}

export function publicRequestPayload(value) {
  const object = value?.toObject ? value.toObject() : structuredClone(value);
  for (const attachment of object?.attachments || []) delete attachment.path;
  return object;
}
