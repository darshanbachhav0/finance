import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  closeFinancialRequest,
  createFinancialRequest,
  deleteFinancialRequest,
  getRequestDetail,
  listRequestsPage,
  previewFinancialRequestBudget,
  publicRequestPayload,
  requestAuthorizedCostCenters,
  requestDocumentRequirements,
  requestFormPolicy,
  submitFinancialRequest,
  updateFinancialRequest,
  voidFinancialRequest
} from "../services/requestService.js";
import {
  getRenditionBankDestination,
  getRenditionPolicy,
  reviewRendition,
  submitRendition
} from "../services/renditionService.js";

export const listRequests = asyncHandler(async (req, res) => {
  const result = await listRequestsPage(req.query, req.user);
  res.json({ ...result, data: result.data.map(publicRequestPayload) });
});

export const getRequest = asyncHandler(async (req, res) => {
  const result = await getRequestDetail(req.params.id, req.user);
  res.json({
    data: publicRequestPayload(result.request),
    related: {
      accountsPayable: result.accountsPayable,
      journalEntries: result.journalEntries,
      paymentBatches: result.paymentBatches,
      reconciliation: result.reconciliation,
      audit: result.audit,
      budgetPreview: result.budgetPreview
    }
  });
});

export const getRequestDocumentRequirements = asyncHandler(async (req, res) => {
  res.json({ data: await requestDocumentRequirements(req.query) });
});

export const getRequestFormPolicy = asyncHandler(async (req, res) => {
  res.json({ data: await requestFormPolicy(req.query) });
});

export const getAuthorizedCostCenters = asyncHandler(async (req, res) => {
  res.json({ data: await requestAuthorizedCostCenters(req.user) });
});

export const getBudgetPreview = asyncHandler(async (req, res) => {
  res.json({ data: await previewFinancialRequestBudget({ payload: req.body, user: req.user }) });
});

export const createRequest = asyncHandler(async (req, res) => {
  const request = await createFinancialRequest({ payload: req.body, files: req.files, user: req.user, req });
  res.status(201).json({ data: publicRequestPayload(request) });
});

export const updateRequest = asyncHandler(async (req, res) => {
  const request = await updateFinancialRequest({ id: req.params.id, payload: req.body, files: req.files, user: req.user, req });
  res.json({ data: publicRequestPayload(request) });
});

export const submitRequest = asyncHandler(async (req, res) => {
  const request = await submitFinancialRequest({ id: req.params.id, user: req.user, req, comments: req.body.comments });
  res.json({ data: publicRequestPayload(request) });
});

export const closeRequest = asyncHandler(async (req, res) => {
  const request = await closeFinancialRequest({ id: req.params.id, user: req.user, req, comments: req.body.comments });
  res.json({ data: publicRequestPayload(request) });
});

export const voidRequest = asyncHandler(async (req, res) => {
  const request = await voidFinancialRequest({ id: req.params.id, user: req.user, req, comments: req.body.comments });
  res.json({ data: publicRequestPayload(request) });
});

export const deleteRequest = asyncHandler(async (req, res) => {
  const request = await deleteFinancialRequest({ id: req.params.id, user: req.user, req });
  res.json({ data: publicRequestPayload(request) });
});

export const uploadRendition = asyncHandler(async (req, res) => {
  const request = await submitRendition({ requestId: req.params.id, payload: req.body, files: req.files, user: req.user, req });
  res.json({ data: publicRequestPayload(request) });
});

function renditionReviewHandler(action) {
  return asyncHandler(async (req, res) => {
    const result = await reviewRendition({ requestId: req.params.id, action, comments: req.body.comments, user: req.user, req });
    const request = result.request || result;
    res.json({ data: publicRequestPayload(request), journal: result.journal });
  });
}

export const validateRendition = renditionReviewHandler("VALIDATE");
export const observeRendition = renditionReviewHandler("OBSERVE");
export const approveRendition = renditionReviewHandler("APPROVE");
export const rejectRendition = renditionReviewHandler("REJECT");

export const getRenditionFormPolicy = asyncHandler(async (req, res) => {
  res.json({ data: await getRenditionPolicy({ requestId: req.params.id, date: req.query.date, user: req.user }) });
});

export const getRenditionPaymentDestination = asyncHandler(async (req, res) => {
  res.json({ data: await getRenditionBankDestination({ requestId: req.params.id, user: req.user }) });
});
