import AccountingEntry from "../models/AccountingEntry.js";
import CostCenter from "../models/CostCenter.js";
import FinancialRequest from "../models/FinancialRequest.js";
import GeneratedFile from "../models/GeneratedFile.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { persistReportFile, toCsv } from "../services/exportService.js";
import { REQUEST_STATUS } from "../utils/constants.js";

const activeStatuses = {
  $nin: [REQUEST_STATUS.DRAFT, REQUEST_STATUS.REJECTED, REQUEST_STATUS.VOIDED]
};

function periodMatch(period) {
  return period ? { accountingPeriod: period } : {};
}

export const managementSummary = asyncHandler(async (req, res) => {
  const match = { status: activeStatuses, ...periodMatch(req.query.period) };
  const [byType, byMonth, byArea, byProject, payable, overdue, costCenters, entryTotals, exports] = await Promise.all([
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$requestType", total: { $sum: "$penEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$accountingPeriod", total: { $sum: "$penEquivalent" }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$requestingArea", total: { $sum: "$penEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 10 }]),
    FinancialRequest.aggregate([{ $match: { ...match, project: { $nin: [null, ""] } } }, { $group: { _id: "$project", total: { $sum: "$penEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 10 }]),
    FinancialRequest.aggregate([{ $match: { ...periodMatch(req.query.period), status: { $in: [REQUEST_STATUS.BUDGET_COMMITTED, REQUEST_STATUS.APPROVED_PAYABLE, REQUEST_STATUS.BANK_PROCESSED, REQUEST_STATUS.PAID] } } }, { $group: { _id: "$status", total: { $sum: "$penEquivalent" }, count: { $sum: 1 } } }]),
    FinancialRequest.countDocuments({ status: { $in: [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED] }, approvalDueAt: { $lt: new Date() } }),
    CostCenter.find({ active: true }).sort({ code: 1 }),
    AccountingEntry.aggregate([{ $match: req.query.period ? { period: req.query.period } : {} }, { $group: { _id: null, debit: { $sum: "$debit" }, credit: { $sum: "$credit" }, count: { $sum: 1 } } }]),
    GeneratedFile.find({ kind: "MANAGEMENT_CSV" }).populate("generatedBy", "name role").sort({ createdAt: -1 }).limit(50)
  ]);

  const budget = costCenters.reduce((result, item) => {
    result.assigned += Number(item.annualBudget || 0);
    result.committed += Number(item.committedAmount || 0);
    result.executed += Number(item.executedAmount || 0);
    result.paid += Number(item.paidAmount || 0);
    result.available += Number(item.availableAmount || 0);
    return result;
  }, { assigned: 0, committed: 0, executed: 0, paid: 0, available: 0 });

  res.json({ data: { byType, byMonth, byArea, byProject, payable, overdue, budget, costCenters, accounting: entryTotals[0] || { debit: 0, credit: 0, count: 0 }, exports } });
});

export const exportManagementReport = asyncHandler(async (req, res) => {
  const requests = await FinancialRequest.find({ status: activeStatuses, ...periodMatch(req.query.period) })
    .populate("supplier", "rucDni name")
    .populate("solicitor", "name area")
    .sort({ createdAt: -1 });
  const rows = requests.map((request) => ({
    requestNumber: request.requestNumber,
    type: request.requestType,
    expenseNature: request.expenseNature,
    area: request.requestingArea || request.solicitor?.area || "",
    project: request.project || "",
    supplierRuc: request.supplier?.rucDni || "",
    supplier: request.supplier?.name || "",
    period: request.accountingPeriod,
    status: request.status,
    currency: request.currency,
    originalAmount: request.totalAmount,
    penEquivalent: request.penEquivalent
  }));
  const content = toCsv(rows);
  const fileName = `management-report-${req.query.period || "all"}-${Date.now()}.csv`;
  const url = await persistReportFile(fileName, content);
  await GeneratedFile.create({ kind: "MANAGEMENT_CSV", fileName, url, period: req.query.period, rowCount: rows.length, generatedBy: req.user._id });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
  res.send(content);
});
