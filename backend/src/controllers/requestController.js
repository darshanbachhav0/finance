import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { REQUEST_STATUS, ROLES } from "../utils/constants.js";
import { applyCurrencyConversion } from "../services/accountingService.js";
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

function uploadedAttachments(files = {}, userId) {
  const kinds = {
    xml: "XML",
    pdf: "PDF",
    quotation: "QUOTATION",
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

  const accountingPeriod = req.body.accountingPeriod || periodFromDate(req.body.issueDate);
  await ensurePeriodOpen(accountingPeriod);

  const supplier = await Supplier.findById(req.body.supplier);
  if (!supplier || supplier.status !== "ACTIVE") throw new AppError(422, "An active supplier is required.");

  const request = new FinancialRequest({
    requestType: req.body.requestType,
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
    request.status = REQUEST_STATUS.PENDING_APPROVAL;
    request.approvalHistory.push({
      action: "SUBMITTED",
      statusFrom: REQUEST_STATUS.DRAFT,
      statusTo: REQUEST_STATUS.PENDING_APPROVAL,
      actor: req.user._id,
      role: req.user.role,
      comments: "Submitted for approval."
    });
  } else {
    request.approvalHistory.push({
      action: "CREATED",
      statusFrom: null,
      statusTo: REQUEST_STATUS.DRAFT,
      actor: req.user._id,
      role: req.user.role,
      comments: "Draft created."
    });
  }

  await request.save();
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
  for (const field of ["requestType", "issueDate", "accountingPeriod", "currency", "supplier", "description"]) {
    if (req.body[field] !== undefined) request[field] = req.body[field];
  }
  request.attachments.push(...uploadedAttachments(req.files, req.user._id));

  const supplier = await Supplier.findById(request.supplier);
  if (!supplier || supplier.status !== "ACTIVE") throw new AppError(422, "An active supplier is required.");
  await applyCurrencyConversion(request);
  await validateXmlIfPresent(request, supplier);

  if (parseBoolean(req.body.submit)) {
    assertMandatoryDocuments(request);
    const from = request.status;
    request.status = REQUEST_STATUS.PENDING_APPROVAL;
    request.rejectionReason = "";
    request.approvalHistory.push({
      action: "SUBMITTED",
      statusFrom: from,
      statusTo: REQUEST_STATUS.PENDING_APPROVAL,
      actor: req.user._id,
      role: req.user.role,
      comments: "Submitted for approval."
    });
  }

  await request.save();
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
  request.status = REQUEST_STATUS.PENDING_APPROVAL;
  request.rejectionReason = "";
  request.approvalHistory.push({
    action: "SUBMITTED",
    statusFrom: from,
    statusTo: REQUEST_STATUS.PENDING_APPROVAL,
    actor: req.user._id,
    role: req.user.role,
    comments: req.body.comments || "Submitted for approval."
  });
  await request.save();
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
  request.approvalHistory.push({
    action: "RENDITION_SUBMITTED",
    statusFrom: REQUEST_STATUS.RENDITION_PENDING,
    statusTo: REQUEST_STATUS.CLOSED,
    actor: req.user._id,
    role: req.user.role,
    comments: req.body.comments || "Rendition documents uploaded."
  });
  request.status = REQUEST_STATUS.CLOSED;
  await generateRenditionEntries(request, req.user._id);
  await request.save();
  await request.populate(populateRequest);
  res.json({ data: request });
});

export const closeRequest = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id);
  if (!request) throw new AppError(404, "Financial request not found.");
  if (![REQUEST_STATUS.BANK_PROCESSED, REQUEST_STATUS.APPROVED_PAYABLE].includes(request.status)) {
    throw new AppError(422, "Only payable or bank-processed requests can be closed.");
  }

  await ensurePeriodOpen(request.accountingPeriod);
  const from = request.status;
  request.status = REQUEST_STATUS.CLOSED;
  request.approvalHistory.push({
    action: "CLOSED",
    statusFrom: from,
    statusTo: REQUEST_STATUS.CLOSED,
    actor: req.user._id,
    role: req.user.role,
    comments: req.body.comments || "Request closed by Accounting."
  });
  await request.save();
  await request.populate(populateRequest);
  res.json({ data: request });
});

export const deleteRequest = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id);
  if (!request) throw new AppError(404, "Financial request not found.");
  if (!canModifyRequest(request, req.user)) throw new AppError(403, "This request cannot be deleted.");
  await ensurePeriodOpen(request.accountingPeriod);
  await request.deleteOne();
  res.json({ data: request });
});
