import FinancialRequest from "../models/FinancialRequest.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { APPROVAL_SLA_HOURS, APPROVAL_STAGES, REQUEST_STATUS, ROLES } from "../utils/constants.js";
import { applyCurrencyConversion } from "../services/accountingService.js";
import { recordAudit, workflowEvent } from "../services/auditService.js";
import { reserveBudget } from "../services/budgetService.js";
import { canApproveStage } from "../utils/permissions.js";
import { ensurePeriodOpen } from "../services/periodService.js";
import { assertMandatoryDocuments, hasAttachment } from "../services/requestRules.js";
import { validateXmlAgainstRequest } from "../services/xmlValidationService.js";

const populateRequest = [
  { path: "supplier" },
  { path: "solicitor", select: "name email role area" },
  { path: "lines.costCenter" },
  { path: "lines.expenseType" },
  { path: "approvalHistory.actor", select: "name email role" },
  { path: "budgetCommitment" },
  { path: "bankFile.generatedBy", select: "name email role" },
  { path: "rendition.submittedBy", select: "name email role" }
];

export const getApprovalInbox = asyncHandler(async (req, res) => {
  const query = {
    status: { $in: [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED] }
  };
  if (req.user.role === ROLES.APPROVER) {
    const level = req.user.approvalLevel || APPROVAL_STAGES.AREA_DIRECTOR;
    if (level === APPROVAL_STAGES.AREA_DIRECTOR) query.$or = [{ approvalStage: level }, { approvalStage: { $exists: false } }];
    else query.approvalStage = level;
  }
  const data = await FinancialRequest.find(query)
    .populate(populateRequest)
    .sort({ createdAt: 1 });
  res.json({ data });
});

export const approveRequest = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id).populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.");
  if (![REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED].includes(request.status)) {
    throw new AppError(422, "Only requests in an active approval stage can be approved.");
  }
  if (!canApproveStage(request, req.user)) {
    throw new AppError(403, "This request is assigned to a different approval level.");
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

  const from = request.status;
  const currentStage = request.approvalStage || APPROVAL_STAGES.AREA_DIRECTOR;
  if (currentStage === APPROVAL_STAGES.AREA_DIRECTOR) {
    request.status = REQUEST_STATUS.DIRECTOR_APPROVED;
    request.approvalStage = APPROVAL_STAGES.VICE_RECTOR;
    request.approvalDueAt = new Date(Date.now() + APPROVAL_SLA_HOURS[APPROVAL_STAGES.VICE_RECTOR] * 60 * 60 * 1000);
    request.approvalHistory.push(workflowEvent({
      action: "DIRECTOR_APPROVED",
      from,
      to: request.status,
      user: req.user,
      req,
      comments: req.body.comments || "Approved by Area Director.",
      stage: currentStage,
      dueAt: request.approvalDueAt
    }));
  } else {
    const commitment = await reserveBudget(request, req.user._id);
    request.budgetCommitment = commitment._id;
    request.status = REQUEST_STATUS.BUDGET_COMMITTED;
    request.approvalStage = APPROVAL_STAGES.COMPLETE;
    request.approvalDueAt = null;
    request.approvalHistory.push(workflowEvent({
      action: "VICE_RECTOR_APPROVED",
      from,
      to: request.status,
      user: req.user,
      req,
      comments: req.body.comments || "Approved by Vice Rector and budget commitment created.",
      stage: currentStage
    }));
  }

  await request.save();
  await recordAudit({
    entityType: "FinancialRequest",
    entity: request,
    action: currentStage === APPROVAL_STAGES.AREA_DIRECTOR ? "DIRECTOR_APPROVED" : "VICE_RECTOR_APPROVED",
    user: req.user,
    req,
    comments: req.body.comments,
    changes: { from, to: request.status, approvalStage: currentStage }
  });
  await request.populate(populateRequest);
  res.json({ data: request });
});

export const rejectRequest = asyncHandler(async (req, res) => {
  const { comments } = req.body;
  if (!comments) throw new AppError(400, "Rejection comments are required.");

  const request = await FinancialRequest.findById(req.params.id);
  if (!request) throw new AppError(404, "Financial request not found.");
  if (![REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED].includes(request.status)) {
    throw new AppError(422, "Only requests in an active approval stage can be rejected.");
  }
  if (!canApproveStage(request, req.user)) {
    throw new AppError(403, "This request is assigned to a different approval level.");
  }

  await ensurePeriodOpen(request.accountingPeriod);
  const from = request.status;
  request.status = REQUEST_STATUS.REJECTED;
  request.approvalDueAt = null;
  request.rejectionReason = comments;
  request.approvalHistory.push(workflowEvent({
    action: "REJECTED",
    from,
    to: REQUEST_STATUS.REJECTED,
    user: req.user,
    req,
    comments,
    stage: request.approvalStage
  }));
  await request.save();
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: "REJECTED", user: req.user, req, comments });
  await request.populate(populateRequest);
  res.json({ data: request });
});
