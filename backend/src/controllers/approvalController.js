import FinancialRequest from "../models/FinancialRequest.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { REQUEST_STATUS } from "../utils/constants.js";
import { applyCurrencyConversion, generateProvisionEntries } from "../services/accountingService.js";
import { ensurePeriodOpen } from "../services/periodService.js";
import { assertMandatoryDocuments, hasAttachment } from "../services/requestRules.js";
import { validateXmlAgainstRequest } from "../services/xmlValidationService.js";

const populateRequest = [
  { path: "supplier" },
  { path: "solicitor", select: "name email role area" },
  { path: "lines.costCenter" },
  { path: "lines.expenseType" },
  { path: "approvalHistory.actor", select: "name email role" },
  { path: "bankFile.generatedBy", select: "name email role" },
  { path: "rendition.submittedBy", select: "name email role" }
];

export const getApprovalInbox = asyncHandler(async (_req, res) => {
  const data = await FinancialRequest.find({ status: REQUEST_STATUS.PENDING_APPROVAL })
    .populate(populateRequest)
    .sort({ createdAt: 1 });
  res.json({ data });
});

export const approveRequest = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id).populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.");
  if (request.status !== REQUEST_STATUS.PENDING_APPROVAL) {
    throw new AppError(422, "Only requests pending approval can be approved.");
  }

  await ensurePeriodOpen(request.accountingPeriod);
  await applyCurrencyConversion(request);
  if (hasAttachment(request, "XML") && !request.xmlValidation?.validated) {
    request.xmlValidation = await validateXmlAgainstRequest(request.attachments.find((item) => item.kind === "XML").path, {
      supplier: request.supplier,
      netAmount: request.netAmount,
      igvAmount: request.igvAmount,
      totalAmount: request.totalAmount,
      issueDate: request.issueDate
    });
  }
  assertMandatoryDocuments(request);

  request.status = REQUEST_STATUS.APPROVED_PAYABLE;
  request.approvalHistory.push({
    action: "APPROVED",
    statusFrom: REQUEST_STATUS.PENDING_APPROVAL,
    statusTo: REQUEST_STATUS.APPROVED_PAYABLE,
    actor: req.user._id,
    role: req.user.role,
    comments: req.body.comments || "Approved for payment."
  });

  await request.save();
  await generateProvisionEntries(request, req.user._id);
  await request.populate(populateRequest);
  res.json({ data: request });
});

export const rejectRequest = asyncHandler(async (req, res) => {
  const { comments } = req.body;
  if (!comments) throw new AppError(400, "Rejection comments are required.");

  const request = await FinancialRequest.findById(req.params.id);
  if (!request) throw new AppError(404, "Financial request not found.");
  if (request.status !== REQUEST_STATUS.PENDING_APPROVAL) {
    throw new AppError(422, "Only requests pending approval can be rejected.");
  }

  await ensurePeriodOpen(request.accountingPeriod);
  request.status = REQUEST_STATUS.REJECTED;
  request.rejectionReason = comments;
  request.approvalHistory.push({
    action: "REJECTED",
    statusFrom: REQUEST_STATUS.PENDING_APPROVAL,
    statusTo: REQUEST_STATUS.REJECTED,
    actor: req.user._id,
    role: req.user.role,
    comments
  });
  await request.save();
  await request.populate(populateRequest);
  res.json({ data: request });
});
