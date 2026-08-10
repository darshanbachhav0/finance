import AccountingEntry from "../models/AccountingEntry.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import ExchangeRate from "../models/ExchangeRate.js";
import FinancialRequest from "../models/FinancialRequest.js";
import GeneratedFile from "../models/GeneratedFile.js";
import Supplier from "../models/Supplier.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { APPROVAL_STAGES, REQUEST_STATUS, ROLES } from "../utils/constants.js";

const populatedRequest = [
  { path: "supplier", select: "name rucDni bankName bankAccount cci status" },
  { path: "solicitor", select: "name email role area" }
];

function currentPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function requestScope(user) {
  return user.role === ROLES.SOLICITOR ? { solicitor: user._id } : {};
}

async function missingExchangeRatePeriods() {
  const usedPeriods = await FinancialRequest.distinct("accountingPeriod", {
    currency: "USD",
    status: { $ne: REQUEST_STATUS.CLOSED }
  });
  if (!usedPeriods.length) return [];
  const configured = await ExchangeRate.distinct("period", { period: { $in: usedPeriods } });
  return usedPeriods.filter((period) => !configured.includes(period)).sort();
}

async function buildTasks(user) {
  const taskQueries = [];
  const definitions = [];

  if ([ROLES.ADMIN, ROLES.APPROVER].includes(user.role)) {
    const approvalQuery = { status: { $in: [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED] } };
    if (user.role === ROLES.APPROVER) {
      const level = user.approvalLevel || APPROVAL_STAGES.AREA_DIRECTOR;
      if (level === APPROVAL_STAGES.AREA_DIRECTOR) approvalQuery.$or = [{ approvalStage: level }, { approvalStage: { $exists: false } }];
      else approvalQuery.approvalStage = level;
    }
    taskQueries.push(FinancialRequest.countDocuments(approvalQuery));
    definitions.push({ key: "approval", label: "Requests awaiting approval", path: "/approvals", tone: "amber" });
    taskQueries.push(FinancialRequest.countDocuments({ ...approvalQuery, approvalDueAt: { $lt: new Date() } }));
    definitions.push({ key: "approvalOverdue", label: "Approval SLA overdue", path: "/approvals", tone: "red" });
  }
  if ([ROLES.ADMIN, ROLES.TREASURY].includes(user.role)) {
    taskQueries.push(FinancialRequest.countDocuments({ status: REQUEST_STATUS.APPROVED_PAYABLE }));
    definitions.push({ key: "payable", label: "Requests ready for payment", path: "/treasury", tone: "teal" });
  }
  if ([ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.SOLICITOR].includes(user.role)) {
    const query = { status: REQUEST_STATUS.RENDITION_PENDING };
    if (user.role === ROLES.SOLICITOR) query.solicitor = user._id;
    taskQueries.push(FinancialRequest.countDocuments(query));
    definitions.push({ key: "rendition", label: "Renditions outstanding", path: "/requests?status=RENDICION_PENDIENTE", tone: "amber" });
  }
  if ([ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role)) {
    taskQueries.push(FinancialRequest.countDocuments({ status: REQUEST_STATUS.BUDGET_COMMITTED }));
    definitions.push({ key: "accounting", label: "Requests awaiting fiscal processing", path: "/accounting", tone: "teal" });
    taskQueries.push(Supplier.countDocuments({ status: "PENDING_VALIDATION" }));
    definitions.push({ key: "suppliers", label: "Suppliers awaiting homologation", path: "/suppliers", tone: "amber" });
  }

  const counts = await Promise.all(taskQueries);
  const items = definitions.map((definition, index) => ({ ...definition, count: counts[index] }));

  if ([ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role)) {
    const missingPeriods = await missingExchangeRatePeriods();
    items.push({
      key: "missingExchangeRate",
      label: "Periods missing exchange rates",
      count: missingPeriods.length,
      path: "/exchange-rates",
      tone: "red",
      details: missingPeriods
    });
    const period = await AccountingPeriod.findOne({ period: currentPeriod() });
    items.push({
      key: "period",
      label: period?.status === "CLOSED" ? "Current accounting period is closed" : "Accounting period needs review",
      count: !period || period.status === "CLOSED" ? 1 : 0,
      path: "/accounting/periods",
      tone: "amber"
    });
  }

  return {
    items,
    total: items.reduce((sum, item) => sum + Number(item.count || 0), 0),
    counters: Object.fromEntries(items.map((item) => [item.key, item.count]))
  };
}

async function commonSummary(user) {
  const scope = requestScope(user);
  const [total, byStatus, byType, byCurrency, recentRequests] = await Promise.all([
    FinancialRequest.countDocuments(scope),
    FinancialRequest.aggregate([{ $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    FinancialRequest.aggregate([{ $match: scope }, { $group: { _id: "$requestType", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    FinancialRequest.aggregate([
      { $match: scope },
      { $group: { _id: "$currency", totalAmount: { $sum: "$totalAmount" }, penEquivalent: { $sum: "$penEquivalent" } } }
    ]),
    FinancialRequest.find(scope).populate(populatedRequest).sort({ updatedAt: -1 }).limit(8)
  ]);
  return { total, byStatus, byType, byCurrency, recentRequests };
}

function countStatus(byStatus, status) {
  return byStatus.find((item) => item._id === status)?.count || 0;
}

async function roleDetails(user, common) {
  const metrics = [];
  const warnings = [];
  const data = {};

  if (user.role === ROLES.ADMIN) {
    const [activeUsers, inactiveUsers, missingBank, recentFiles] = await Promise.all([
      User.countDocuments({ active: true }),
      User.countDocuments({ active: false }),
      Supplier.countDocuments({ status: "ACTIVE", $and: [{ $or: [{ cci: { $exists: false } }, { cci: "" }] }, { $or: [{ bankAccount: { $exists: false } }, { bankAccount: "" }] }] }),
      GeneratedFile.find().populate("generatedBy", "name role").sort({ createdAt: -1 }).limit(6)
    ]);
    metrics.push(
      { key: "total", label: "Total requests", value: common.total, tone: "navy" },
      { key: "pending", label: "Pending approval", value: countStatus(common.byStatus, REQUEST_STATUS.PENDING_APPROVAL) + countStatus(common.byStatus, REQUEST_STATUS.DIRECTOR_APPROVED), tone: "amber" },
      { key: "payable", label: "Approved / payable", value: countStatus(common.byStatus, REQUEST_STATUS.APPROVED_PAYABLE), tone: "teal" },
      { key: "users", label: "Active users", value: activeUsers, tone: "green" },
      { key: "closed", label: "Closed requests", value: countStatus(common.byStatus, REQUEST_STATUS.CLOSED), tone: "neutral" }
    );
    if (missingBank) warnings.push({ key: "missingBank", label: "Active suppliers missing bank details", count: missingBank, path: "/suppliers", tone: "red" });
    if (inactiveUsers) warnings.push({ key: "inactiveUsers", label: "Inactive user accounts", count: inactiveUsers, path: "/users", tone: "neutral" });
    data.recentFiles = recentFiles;
  }

  if (user.role === ROLES.SOLICITOR) {
    metrics.push(
      { key: "drafts", label: "My drafts", value: countStatus(common.byStatus, REQUEST_STATUS.DRAFT), tone: "neutral" },
      { key: "rejected", label: "Rejected requests", value: countStatus(common.byStatus, REQUEST_STATUS.REJECTED), tone: "red" },
      { key: "pending", label: "Pending approval", value: countStatus(common.byStatus, REQUEST_STATUS.PENDING_APPROVAL) + countStatus(common.byStatus, REQUEST_STATUS.DIRECTOR_APPROVED), tone: "amber" },
      { key: "rendition", label: "Rendition tasks", value: countStatus(common.byStatus, REQUEST_STATUS.RENDITION_PENDING), tone: "teal" },
      { key: "closed", label: "Completed requests", value: countStatus(common.byStatus, REQUEST_STATUS.CLOSED), tone: "green" }
    );
  }

  if (user.role === ROLES.APPROVER) {
    const level = user.approvalLevel || APPROVAL_STAGES.AREA_DIRECTOR;
    const approvalQuery = { status: { $in: [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED] } };
    if (level === APPROVAL_STAGES.AREA_DIRECTOR) approvalQuery.$or = [{ approvalStage: level }, { approvalStage: { $exists: false } }];
    else approvalQuery.approvalStage = level;
    const [waitingTotals, oldest, decisions] = await Promise.all([
      FinancialRequest.aggregate([
        { $match: approvalQuery },
        { $group: { _id: null, amount: { $sum: "$penEquivalent" }, count: { $sum: 1 } } }
      ]),
      FinancialRequest.find(approvalQuery).populate(populatedRequest).sort({ approvalDueAt: 1 }).limit(6),
      FinancialRequest.find({ approvalHistory: { $elemMatch: { actor: user._id, action: { $in: ["DIRECTOR_APPROVED", "VICE_RECTOR_APPROVED", "REJECTED"] } } } })
        .populate(populatedRequest)
        .sort({ updatedAt: -1 })
        .limit(6)
    ]);
    const waiting = waitingTotals[0] || { amount: 0, count: 0 };
    metrics.push(
      { key: "pending", label: "Pending approval", value: waiting.count, tone: "amber" },
      { key: "amount", label: "PEN equivalent waiting", value: waiting.amount, tone: "teal", format: "currency" },
      { key: "oldest", label: "Oldest request age", value: oldest[0] ? Math.max(0, Math.floor((Date.now() - oldest[0].createdAt.getTime()) / 86400000)) : 0, suffix: "days", tone: "navy" },
      { key: "decisions", label: "Recent decisions", value: decisions.length, tone: "green" }
    );
    data.oldestRequests = oldest;
    data.recentDecisions = decisions;
  }

  if (user.role === ROLES.ACCOUNTING) {
    const period = currentPeriod();
    const [periodRecord, entryTotals, pendingClosures, periods, missingPeriods] = await Promise.all([
      AccountingPeriod.findOne({ period }),
      AccountingEntry.aggregate([
        { $match: { period } },
        { $group: { _id: null, entries: { $sum: 1 }, debit: { $sum: "$debit" }, credit: { $sum: "$credit" } } }
      ]),
      FinancialRequest.countDocuments({ status: { $in: [REQUEST_STATUS.APPROVED_PAYABLE, REQUEST_STATUS.BANK_PROCESSED] } }),
      AccountingPeriod.find().populate("closedBy", "name").sort({ period: -1 }).limit(6),
      missingExchangeRatePeriods()
    ]);
    const entries = entryTotals[0] || { entries: 0, debit: 0, credit: 0 };
    metrics.push(
      { key: "period", label: "Current period", value: periodRecord?.status || "NOT_CREATED", tone: periodRecord?.status === "OPEN" ? "green" : "amber", format: "text" },
      { key: "entries", label: "Entries this period", value: entries.entries, tone: "navy" },
      { key: "debit", label: "Debit total", value: entries.debit, tone: "teal", format: "currency" },
      { key: "credit", label: "Credit total", value: entries.credit, tone: "neutral", format: "currency" },
      { key: "closures", label: "Pending closures", value: pendingClosures, tone: "amber" }
    );
    if (missingPeriods.length) warnings.push({ key: "missingRates", label: "Periods missing exchange rates", count: missingPeriods.length, details: missingPeriods, path: "/exchange-rates", tone: "red" });
    data.periods = periods;
  }

  if (user.role === ROLES.TREASURY) {
    const [queue, recentFiles] = await Promise.all([
      FinancialRequest.find({ status: REQUEST_STATUS.APPROVED_PAYABLE }).populate(populatedRequest).sort({ updatedAt: 1 }),
      GeneratedFile.find({ kind: "BANK_TXT" }).populate("generatedBy", "name role").sort({ createdAt: -1 }).limit(6)
    ]);
    const totals = queue.reduce((result, request) => {
      result[request.currency] = Number(((result[request.currency] || 0) + Number(request.totalAmount || 0)).toFixed(2));
      return result;
    }, {});
    const missingBank = queue.filter((request) => !request.supplier?.cci && !request.supplier?.bankAccount).length;
    metrics.push(
      { key: "queue", label: "Payable queue", value: queue.length, tone: "amber" },
      { key: "pen", label: "PEN waiting", value: totals.PEN || 0, tone: "teal", format: "currency", currency: "PEN" },
      { key: "usd", label: "USD waiting", value: totals.USD || 0, tone: "navy", format: "currency", currency: "USD" },
      { key: "missingBank", label: "Missing bank details", value: missingBank, tone: missingBank ? "red" : "green" },
      { key: "files", label: "Recent bank files", value: recentFiles.length, tone: "neutral" }
    );
    if (missingBank) warnings.push({ key: "missingBank", label: "Payable suppliers missing bank details", count: missingBank, path: "/treasury", tone: "red" });
    data.queue = queue.slice(0, 8);
    data.recentFiles = recentFiles;
  }

  return { metrics, warnings, ...data };
}

export const getTaskSummary = asyncHandler(async (req, res) => {
  res.json(await buildTasks(req.user));
});

export const getDashboardSummary = asyncHandler(async (req, res) => {
  const [common, tasks] = await Promise.all([commonSummary(req.user), buildTasks(req.user)]);
  const details = await roleDetails(req.user, common);
  res.json({
    role: req.user.role,
    total: common.total,
    byStatus: common.byStatus,
    byType: common.byType,
    byCurrency: common.byCurrency,
    recentRequests: common.recentRequests,
    tasks,
    ...details
  });
});
