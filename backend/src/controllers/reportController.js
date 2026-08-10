import AccountsPayable from "../models/AccountsPayable.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import FinancialRequest from "../models/FinancialRequest.js";
import GeneratedFile from "../models/GeneratedFile.js";
import JournalEntry from "../models/JournalEntry.js";
import PaymentBatch from "../models/PaymentBatch.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { budgetOverview } from "../services/budgetOverviewService.js";
import { persistReportFile, toCsv } from "../services/exportService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { AP_STATUS, REQUEST_STATUS } from "../utils/constants.js";

const excludedStatuses = [REQUEST_STATUS.DRAFT, REQUEST_STATUS.REJECTED, REQUEST_STATUS.VOIDED];

function requestMatch(query) {
  const match = { status: { $nin: excludedStatuses } };
  if (query.period) match.accountingPeriod = query.period;
  if (query.dateFrom || query.dateTo) {
    match.issueDate = {};
    if (query.dateFrom) match.issueDate.$gte = new Date(`${query.dateFrom}T00:00:00.000Z`);
    if (query.dateTo) match.issueDate.$lte = new Date(`${query.dateTo}T23:59:59.999Z`);
  }
  return match;
}

export const managementSummary = asyncHandler(async (req, res) => {
  const match = requestMatch(req.query);
  const period = req.query.period;
  const [byType, byMonth, byArea, byProject, payable, approvalTiming, observed, accounting, bankFiles, commitments, budget] = await Promise.all([
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$requestType", total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$accountingPeriod", total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ["$requesterArea", "$requestingArea"] }, total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 20 }]),
    FinancialRequest.aggregate([{ $match: { ...match, project: { $nin: [null, ""] } } }, { $group: { _id: "$project", total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 20 }]),
    AccountsPayable.aggregate([
      { $match: period ? { createdAt: { $gte: new Date(`${period}-01T00:00:00.000Z`), $lt: new Date(new Date(`${period}-01T00:00:00.000Z`).setUTCMonth(new Date(`${period}-01T00:00:00.000Z`).getUTCMonth() + 1)) } } : {} },
      { $group: { _id: "$status", original: { $sum: "$penEquivalent" }, outstanding: { $sum: { $multiply: ["$outstandingAmount", "$exchangeRate"] } }, count: { $sum: 1 } } }
    ]),
    FinancialRequest.aggregate([
      { $match: match },
      { $unwind: "$approvalHistory" },
      { $match: { "approvalHistory.startedAt": { $type: "date" }, "approvalHistory.completedAt": { $type: "date" } } },
      { $group: { _id: "$requesterArea", averageHours: { $avg: { $divide: [{ $subtract: ["$approvalHistory.completedAt", "$approvalHistory.startedAt"] }, 3600000] } }, decisions: { $sum: 1 } } }
    ]),
    FinancialRequest.aggregate([{ $match: { ...match, status: { $in: [REQUEST_STATUS.OBSERVED, REQUEST_STATUS.RETURNED] } } }, { $group: { _id: "$requesterArea", count: { $sum: 1 }, amount: { $sum: "$totalPENEquivalent" } } }]),
    JournalEntry.aggregate([{ $match: { ...(period ? { period } : {}), status: "POSTED" } }, { $group: { _id: "$entryType", debit: { $sum: "$totalDebit" }, credit: { $sum: "$totalCredit" }, count: { $sum: 1 } } }]),
    PaymentBatch.find(period ? { paymentDate: { $gte: new Date(`${period}-01T00:00:00.000Z`), $lt: new Date(new Date(`${period}-01T00:00:00.000Z`).setUTCMonth(new Date(`${period}-01T00:00:00.000Z`).getUTCMonth() + 1)) } } : {}).select("-filePath").populate("generatedBy", "name role").sort({ generatedAt: -1 }).limit(50),
    BudgetCommitment.find(period ? { period } : {}).populate("request", "requestNumber requestType status project requesterArea").sort({ createdAt: -1 }).limit(100),
    budgetOverview({ period })
  ]);
  const now = new Date();
  const overduePayables = await AccountsPayable.countDocuments({ status: { $in: [AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PAYMENT_FILE_CREATED] }, dueDate: { $lt: now } });
  const overdueApprovals = await FinancialRequest.countDocuments({ ...match, status: { $in: [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED] }, approvalDueAt: { $lt: now } });
  const exports = await GeneratedFile.find({ kind: "MANAGEMENT_CSV" }).populate("generatedBy", "name role").sort({ createdAt: -1 }).limit(50);
  res.json({ data: { byType, byMonth, byArea, byProject, payable, approvalTiming, observed, accounting, bankFiles, commitments, budget: budget.totals, budgetAllocations: budget.allocations, budgetWarnings: budget.warnings, overdueApprovals, overduePayables, exports } });
});

export const exportManagementReport = asyncHandler(async (req, res) => {
  const requests = await FinancialRequest.find(requestMatch(req.query)).populate("supplier", "rucDni normalizedIdentifier name legalName").populate("requester", "name area").sort({ createdAt: -1 });
  const rows = requests.map((request) => ({
    requestNumber: request.requestNumber,
    type: request.requestType,
    expenseNature: request.expenseNature,
    area: request.requesterArea || request.requestingArea || request.requester?.area || "",
    project: request.project || "",
    supplierRucDni: request.supplierSnapshot?.identifier || request.supplier?.normalizedIdentifier || request.supplier?.rucDni || "",
    supplier: request.supplierSnapshot?.legalName || request.supplier?.legalName || request.supplier?.name || "",
    period: request.accountingPeriod,
    status: request.status,
    currency: request.currency,
    originalAmount: request.totalAmount,
    exchangeRate: request.exchangeRate,
    penEquivalent: request.totalPENEquivalent
  }));
  const content = toCsv(rows);
  const fileName = `management-report-${req.query.period || "all"}-${Date.now()}.csv`;
  const url = await persistReportFile(fileName, content);
  await GeneratedFile.create({ kind: "MANAGEMENT_CSV", fileName, url, period: req.query.period, requestNumbers: rows.map((row) => row.requestNumber), rowCount: rows.length, generatedBy: req.user._id, metadata: { dateFrom: req.query.dateFrom, dateTo: req.query.dateTo } });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
  res.send(content);
});

export const listManagementExports = asyncHandler(async (req, res) => {
  const query = { kind: "MANAGEMENT_CSV" };
  if (req.query.period) query.period = req.query.period;
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    query.$or = [{ fileName: search }, { period: search }, { requestNumbers: search }];
  }
  const { page, pageSize, skip } = parsePagination(req.query);
  const sort = parseSort(req.query, ["createdAt", "period", "fileName", "rowCount"], { createdAt: -1 });
  const [data, total] = await Promise.all([
    GeneratedFile.find(query).populate("generatedBy", "name role").sort(sort).skip(skip).limit(pageSize),
    GeneratedFile.countDocuments(query)
  ]);
  res.json(paginatedPayload(data, total, page, pageSize));
});
