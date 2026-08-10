import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import CostCenter from "../models/CostCenter.js";
import ExpenseType from "../models/ExpenseType.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { APPROVAL_SLA_HOURS, APPROVAL_STAGES, REQUEST_STATUS, ROLES } from "../utils/constants.js";
import { applyCurrencyConversion } from "../services/accountingService.js";
import { recordAudit, workflowEvent } from "../services/auditService.js";
import { releaseBudget } from "../services/budgetService.js";
import { ensurePeriodOpen, periodFromDate } from "../services/periodService.js";
import { assertMandatoryDocuments, assertRequestLines, hasAttachment } from "../services/requestRules.js";
import { validateXmlAgainstRequest } from "../services/xmlValidationService.js";
import { generateRenditionEntries } from "../services/accountingService.js";
import { canModifyRequest, canViewRequest } from "../utils/permissions.js";

const populateRequest = [
  { path: "supplier" },
  { path: "solicitor", select: "name email role area" },
  { path: "lines.costCenter" },
  { path: "lines.expenseType" },
  { path: "approvalHistory.actor", select: "name email role" },
  { path: "bankFile.generatedBy", select: "name email role" },
  { path: "budgetCommitment" },
  { path: "fiscalData.processedBy", select: "name email role" },
  { path: "payment.confirmedBy", select: "name email role" },
  { path: "rendition.submittedBy", select: "name email role" }
];

function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

function parseLines(lines) {
  const parsed = typeof lines === "string" ? JSON.parse(lines || "[]") : lines;
  return (parsed || []).map((line) => ({
    costCenter: line.costCenter,
    expenseType: line.expenseType,
    netAmount: Number(line.netAmount || 0),
    igvAmount: Number(line.igvAmount || 0),
    totalAmount: Number(line.totalAmount || 0)
  }));
}

async function assertActiveDimensions(requestType, lines) {
  const [costCenters, expenseTypes] = await Promise.all([
    CostCenter.find({ _id: { $in: lines.map((line) => line.costCenter) } }),
    ExpenseType.find({ _id: { $in: lines.map((line) => line.expenseType) } })
  ]);
  const costCenterMap = new Map(costCenters.map((item) => [String(item._id), item]));
  const expenseTypeMap = new Map(expenseTypes.map((item) => [String(item._id), item]));
  for (const [index, line] of lines.entries()) {
    const center = costCenterMap.get(String(line.costCenter?._id || line.costCenter));
    const expense = expenseTypeMap.get(String(line.expenseType?._id || line.expenseType));
    if (!center?.active || !expense?.active) throw new AppError(422, `Line ${index + 1} must use active cost-center and expense-account master data.`);
    if (requestType === "CAPEX" && expense.category !== "CAPEX") throw new AppError(422, `Line ${index + 1} must use a CAPEX expense account.`);
    if (requestType === "OPEX" && !["OPEX", "Non-deductible"].includes(expense.category)) throw new AppError(422, `Line ${index + 1} must use an OPEX or non-deductible expense account.`);
  }
}

function uploadedAttachments(files = {}, userId) {
  const kinds = {
    xml: "XML",
    pdf: "PDF",
    quotation: "QUOTATION",
    purchaseOrder: "PURCHASE_ORDER",
    contract: "CONTRACT",
    conformity: "CONFORMITY",
    activityReport: "ACTIVITY_REPORT",
    supporting: "SUPPORTING",
    rendition: "RENDITION"
  };

  return Object.entries(kinds).flatMap(([field, kind]) =>
    (files[field] || []).map((file) => ({
      kind,
      originalName: file.originalname,
      filename: file.filename,
      path: file.path,
      url: `/uploads/${file.filename}`,
      mimetype: file.mimetype,
      size: file.size,
      uploadedBy: userId
    }))
  );
}

function beginApproval(request) {
  request.status = REQUEST_STATUS.PENDING_APPROVAL;
  request.approvalStage = APPROVAL_STAGES.AREA_DIRECTOR;
  request.approvalDueAt = new Date(Date.now() + APPROVAL_SLA_HOURS[APPROVAL_STAGES.AREA_DIRECTOR] * 60 * 60 * 1000);
}

async function validateXmlIfPresent(request, supplier) {
  const xmlAttachment = request.attachments?.find((attachment) => attachment.kind === "XML");
  if (!xmlAttachment) return;

  request.xmlValidation = await validateXmlAgainstRequest(xmlAttachment.path, {
    supplier,
    netAmount: request.netAmount,
    igvAmount: request.igvAmount,
    totalAmount: request.totalAmount,
    issueDate: request.issueDate
  });
}

export const listRequests = asyncHandler(async (req, res) => {
  const query = {};
  if (req.user.role === ROLES.SOLICITOR) query.solicitor = req.user._id;
  if (req.user.role === ROLES.APPROVER) query.status = { $ne: REQUEST_STATUS.DRAFT };
  if (req.query.status) query.status = req.query.status;
  if (req.user.role === ROLES.APPROVER && req.query.status === REQUEST_STATUS.DRAFT) query.status = "__NO_DRAFTS_FOR_APPROVERS__";
  if (req.query.type) query.requestType = req.query.type;
  if (req.query.period) query.accountingPeriod = req.query.period;

  const data = await FinancialRequest.find(query).populate(populateRequest).sort({ createdAt: -1 });
  res.json({ data });
});

export const getRequest = asyncHandler(async (req, res) => {
  const data = await FinancialRequest.findById(req.params.id).populate(populateRequest);
  if (!data) throw new AppError(404, "Financial request not found.");
  if (!canViewRequest(data, req.user)) throw new AppError(403, "You do not have permission to view this request.");
  res.json({ data });
});

export const createRequest = asyncHandler(async (req, res) => {
  const lines = parseLines(req.body.lines);
  assertRequestLines(lines);
  await assertActiveDimensions(req.body.requestType, lines);

  const accountingPeriod = req.body.accountingPeriod || periodFromDate(req.body.issueDate);
  await ensurePeriodOpen(accountingPeriod);

  const supplier = await Supplier.findById(req.body.supplier);
  if (!supplier || supplier.status !== "ACTIVE") throw new AppError(422, "An active supplier is required.");

  const request = new FinancialRequest({
    requestType: req.body.requestType,
    expenseNature: req.body.expenseNature,
    priority: req.body.priority,
    requestingArea: req.user.area,
    schoolOrDepartment: req.body.schoolOrDepartment || req.user.area,
    project: req.body.project,
    issueDate: req.body.issueDate,
    accountingPeriod,
    currency: req.body.currency,
    supplier: supplier._id,
    solicitor: req.user._id,
    description: req.body.description,
    lines,
    attachments: uploadedAttachments(req.files, req.user._id)
  });

  await applyCurrencyConversion(request);
  await validateXmlIfPresent(request, supplier);

  if (parseBoolean(req.body.submit)) {
    assertMandatoryDocuments(request);
    beginApproval(request);
    request.approvalHistory.push(workflowEvent({
      action: "SUBMITTED",
      from: REQUEST_STATUS.DRAFT,
      to: REQUEST_STATUS.PENDING_APPROVAL,
      user: req.user,
      req,
      comments: "Submitted for Area Director approval.",
      stage: request.approvalStage,
      dueAt: request.approvalDueAt
    }));
  } else {
    request.approvalHistory.push(workflowEvent({
      action: "CREATED",
      to: REQUEST_STATUS.DRAFT,
      user: req.user,
      req,
      comments: "Draft created."
    }));
  }

  await request.save();
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: parseBoolean(req.body.submit) ? "SUBMITTED" : "CREATED", user: req.user, req });
  await request.populate(populateRequest);
  res.status(201).json({ data: request });
});

export const updateRequest = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id);
  if (!request) throw new AppError(404, "Financial request not found.");
  if (!canModifyRequest(request, req.user)) throw new AppError(403, "This request cannot be modified in its current state.");

  const nextPeriod = req.body.accountingPeriod || request.accountingPeriod;
  await ensurePeriodOpen(nextPeriod);

  if (req.body.lines) {
    const lines = parseLines(req.body.lines);
    assertRequestLines(lines);
    request.lines = lines;
  }
  for (const field of ["requestType", "expenseNature", "priority", "schoolOrDepartment", "project", "issueDate", "accountingPeriod", "currency", "supplier", "description"]) {
    if (req.body[field] !== undefined) request[field] = req.body[field];
  }
  await assertActiveDimensions(request.requestType, request.lines);
  request.attachments.push(...uploadedAttachments(req.files, req.user._id));

  const supplier = await Supplier.findById(request.supplier);
  if (!supplier || supplier.status !== "ACTIVE") throw new AppError(422, "An active supplier is required.");
  await applyCurrencyConversion(request);
  await validateXmlIfPresent(request, supplier);

  if (parseBoolean(req.body.submit)) {
    assertMandatoryDocuments(request);
    const from = request.status;
    beginApproval(request);
    request.rejectionReason = "";
    request.approvalHistory.push(workflowEvent({
      action: "SUBMITTED",
      from,
      to: REQUEST_STATUS.PENDING_APPROVAL,
      user: req.user,
      req,
      comments: "Submitted for Area Director approval.",
      stage: request.approvalStage,
      dueAt: request.approvalDueAt
    }));
  }

  await request.save();
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: parseBoolean(req.body.submit) ? "RESUBMITTED" : "UPDATED", user: req.user, req });
  await request.populate(populateRequest);
  res.json({ data: request });
});

export const submitRequest = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id).populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.");
  if (!canModifyRequest(request, req.user)) throw new AppError(403, "This request cannot be submitted.");

  await ensurePeriodOpen(request.accountingPeriod);
  await applyCurrencyConversion(request);
  if (hasAttachment(request, "XML") && !request.xmlValidation?.validated) {
    await validateXmlIfPresent(request, request.supplier);
  }
  assertMandatoryDocuments(request);

  const from = request.status;
  beginApproval(request);
  request.rejectionReason = "";
  request.approvalHistory.push(workflowEvent({
    action: "SUBMITTED",
    from,
    to: REQUEST_STATUS.PENDING_APPROVAL,
    user: req.user,
    req,
    comments: req.body.comments || "Submitted for Area Director approval.",
    stage: request.approvalStage,
    dueAt: request.approvalDueAt
  }));
  await request.save();
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: "SUBMITTED", user: req.user, req, comments: req.body.comments });
  await request.populate(populateRequest);
  res.json({ data: request });
});

export const uploadRendition = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id);
  if (!request) throw new AppError(404, "Financial request not found.");
  if (request.status !== REQUEST_STATUS.RENDITION_PENDING) {
    throw new AppError(422, "Rendition can only be uploaded while the request is RENDICION_PENDIENTE.");
  }
  if (String(request.solicitor) !== String(req.user._id) && ![ROLES.ADMIN, ROLES.ACCOUNTING].includes(req.user.role)) {
    throw new AppError(403, "You do not have permission to submit this rendition.");
  }

  await ensurePeriodOpen(request.accountingPeriod);
  const attachments = uploadedAttachments(req.files, req.user._id).filter((attachment) => attachment.kind === "RENDITION");
  if (!attachments.length) throw new AppError(422, "At least one rendition/supporting file is required.");

  request.attachments.push(...attachments);
  request.rendition = {
    submittedAt: new Date(),
    submittedBy: req.user._id,
    comments: req.body.comments
  };
  request.approvalHistory.push(workflowEvent({
    action: "RENDITION_SUBMITTED",
    from: REQUEST_STATUS.RENDITION_PENDING,
    to: REQUEST_STATUS.CLOSED,
    user: req.user,
    req,
    comments: req.body.comments || "Rendition documents uploaded."
  }));
  request.status = REQUEST_STATUS.CLOSED;
  await generateRenditionEntries(request, req.user._id);
  await request.save();
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: "RENDITION_SUBMITTED", user: req.user, req, comments: req.body.comments });
  await request.populate(populateRequest);
  res.json({ data: request });
});

export const closeRequest = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id);
  if (!request) throw new AppError(404, "Financial request not found.");
  if (![REQUEST_STATUS.PAID, REQUEST_STATUS.RECONCILED, REQUEST_STATUS.BANK_PROCESSED, REQUEST_STATUS.APPROVED_PAYABLE].includes(request.status)) {
    throw new AppError(422, "Only payable, paid, reconciled, or bank-processed requests can be closed.");
  }

  await ensurePeriodOpen(request.accountingPeriod);
  const from = request.status;
  request.status = REQUEST_STATUS.CLOSED;
  request.approvalHistory.push(workflowEvent({
    action: "CLOSED",
    from,
    to: REQUEST_STATUS.CLOSED,
    user: req.user,
    req,
    comments: req.body.comments || "Request closed by Accounting."
  }));
  await request.save();
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: "CLOSED", user: req.user, req, comments: req.body.comments });
  await request.populate(populateRequest);
  res.json({ data: request });
});

export const voidRequest = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id);
  if (!request) throw new AppError(404, "Financial request not found.");
  if ([REQUEST_STATUS.CLOSED, REQUEST_STATUS.VOIDED].includes(request.status)) {
    throw new AppError(422, "Closed or already voided requests cannot be voided.");
  }
  if (!String(req.body.comments || "").trim()) throw new AppError(422, "A void reason is required.");
  await ensurePeriodOpen(request.accountingPeriod);
  await releaseBudget(request, req.user._id, req.body.comments);
  const from = request.status;
  request.status = REQUEST_STATUS.VOIDED;
  request.approvalDueAt = null;
  request.approvalHistory.push(workflowEvent({
    action: "VOIDED",
    from,
    to: request.status,
    user: req.user,
    req,
    comments: req.body.comments
  }));
  await request.save();
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: "VOIDED", user: req.user, req, comments: req.body.comments, changes: { from } });
  await request.populate(populateRequest);
  res.json({ data: request });
});

export const deleteRequest = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id);
  if (!request) throw new AppError(404, "Financial request not found.");
  if (!canModifyRequest(request, req.user)) throw new AppError(403, "This request cannot be deleted.");
  await ensurePeriodOpen(request.accountingPeriod);
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: "DELETED", user: req.user, req, changes: { status: request.status } });
  await request.deleteOne();
  res.json({ data: request });
});
