import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import BudgetException from "../models/BudgetException.js";
import BudgetRule from "../models/BudgetRule.js";
import CostCenter from "../models/CostCenter.js";
import { AppError } from "../utils/AppError.js";
import { BUDGET_STATUS, ERROR_CODES } from "../utils/constants.js";
import { addMoney, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";

function dimensionKey(line, project) {
  return [
    String(line.costCenter?._id || line.costCenter),
    String(line.expenseType?._id || line.expenseType),
    String(line.budgetItem || ""),
    String(line.projectId || project || "")
  ].join("|");
}

export function groupedRequestLines(request) {
  const grouped = new Map();
  for (const line of request.lines || []) {
    const key = dimensionKey(line, request.project);
    const current = grouped.get(key) || {
      costCenter: line.costCenter?._id || line.costCenter,
      expenseType: line.expenseType?._id || line.expenseType,
      budgetItem: line.budgetItem || "",
      project: line.projectId || request.project || "",
      amount: 0
    };
    current.amount = addMoney(current.amount, line.penEquivalent || line.totalAmount || 0);
    grouped.set(key, current);
  }
  return [...grouped.values()].map((line) => ({ ...line, amount: roundMoney(line.amount) }));
}

export async function previewBudget(request) {
  const grouped = groupedRequestLines(request);
  if (!grouped.length || !request.accountingPeriod) {
    return { status: "PENDING_VALIDATION", totalRequested: 0, lines: [] };
  }

  const centers = await CostCenter.find({ _id: { $in: grouped.map((line) => line.costCenter) } });
  const centerMap = new Map(centers.map((center) => [String(center._id), center]));
  const lines = [];

  for (const line of grouped) {
    const center = centerMap.get(String(line.costCenter));
    if (!center?.active || !line.expenseType) {
      lines.push({
        ...line,
        status: "PENDING_VALIDATION",
        costCenterSnapshot: center ? { code: center.code, name: center.name, area: center.area } : undefined
      });
      continue;
    }
    const [rule, allocation] = await Promise.all([
      resolveRule(line, center, request.issueDate),
      findAllocation(request.accountingPeriod, line)
    ]);
    const assigned = roundMoney(allocation?.assignedAmount ?? center.annualBudget ?? 0);
    const committed = roundMoney(allocation?.committedAmount ?? center.committedAmount ?? 0);
    const executed = roundMoney(allocation?.executedAmount ?? center.executedAmount ?? 0);
    const paid = roundMoney(allocation?.paidAmount ?? center.paidAmount ?? 0);
    const available = subtractMoney(subtractMoney(assigned, committed), executed);
    const projectedBalance = subtractMoney(available, line.amount);
    const mode = rule.mode || "TRANSITIONAL";
    lines.push({
      ...line,
      mode,
      exceptionStrategy: rule.exceptionStrategy || "REJECT",
      source: allocation ? "BUDGET_ALLOCATION" : "COST_CENTER",
      allocation: allocation?._id,
      costCenterSnapshot: { code: center.code, name: center.name, area: center.area },
      assigned,
      committed,
      executed,
      paid,
      available,
      projectedBalance,
      status: mode === "TRANSITIONAL" ? "TRANSITIONAL" : projectedBalance >= 0 ? "AVAILABLE" : "INSUFFICIENT"
    });
  }

  const complete = lines.every((line) => line.status !== "PENDING_VALIDATION");
  const insufficient = lines.some((line) => line.status === "INSUFFICIENT");
  return {
    status: !complete ? "PENDING_VALIDATION" : insufficient ? "INSUFFICIENT" : lines.every((line) => line.mode === "TRANSITIONAL") ? "TRANSITIONAL" : "AVAILABLE",
    totalRequested: sumMoney(lines.map((line) => line.amount || 0)),
    totalAvailable: complete ? sumMoney(lines.map((line) => line.available || 0)) : null,
    projectedBalance: complete ? sumMoney(lines.map((line) => line.projectedBalance || 0)) : null,
    lines
  };
}

async function resolveRule(line, center, requestDate) {
  const date = new Date(requestDate || Date.now());
  const rules = await BudgetRule.find({
    active: true,
    $and: [
      { $or: [{ costCenter: line.costCenter }, { costCenter: null }, { costCenter: { $exists: false } }] },
      { $or: [{ expenseType: line.expenseType }, { expenseType: null }, { expenseType: { $exists: false } }] },
      { $or: [{ project: line.project || "" }, { project: "*" }, { project: "" }] },
      { $or: [{ effectiveFrom: { $exists: false } }, { effectiveFrom: { $lte: date } }] },
      { $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gte: date } }] }
    ]
  }).sort({ costCenter: -1, expenseType: -1, project: -1 }).limit(1);
  return rules[0] || {
    mode: center.budgetMode === "ACTIVE" && Number(center.annualBudget || 0) > 0 ? "ACTIVE" : "TRANSITIONAL",
    exceptionStrategy: "REJECT"
  };
}

async function findAllocation(period, line) {
  const exact = await BudgetAllocation.findOne({
    period,
    costCenter: line.costCenter,
    expenseType: line.expenseType,
    project: line.project || "",
    active: true
  });
  if (exact) return exact;
  return BudgetAllocation.findOne({
    period: period.slice(0, 4),
    costCenter: line.costCenter,
    expenseType: line.expenseType,
    project: line.project || "",
    active: true
  });
}

function insufficientBudgetError(label, available, required, strategy) {
  return new AppError(
    422,
    `${label} has insufficient budget. Available PEN ${available.toFixed(2)}, required PEN ${required.toFixed(2)}.`,
    { available, required, exceptionStrategy: strategy },
    ERROR_CODES.INSUFFICIENT_BUDGET
  );
}

async function releaseApplied(applied, session) {
  for (const item of [...applied].reverse()) {
    if (item.kind === "allocation") {
      await BudgetAllocation.updateOne({ _id: item.id }, { $inc: { committedAmount: -item.amount } }, { session });
    } else {
      await CostCenter.updateOne({ _id: item.id }, { $inc: { committedAmount: -item.amount } }, { session });
    }
  }
}

export async function reserveBudget(request, userId, { session } = {}) {
  const existing = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (existing) return existing;

  const grouped = groupedRequestLines(request);
  const centers = await CostCenter.find({ _id: { $in: grouped.map((line) => line.costCenter) } }).session(session || null);
  const centerMap = new Map(centers.map((center) => [String(center._id), center]));
  const prepared = [];

  for (const line of grouped) {
    const center = centerMap.get(String(line.costCenter));
    if (!center?.active) {
      throw new AppError(422, "Every request line needs an active Cost Center before budget commitment.", { costCenter: line.costCenter }, ERROR_CODES.VALIDATION_ERROR);
    }
    const [rule, allocation] = await Promise.all([
      resolveRule(line, center, request.issueDate),
      findAllocation(request.accountingPeriod, line)
    ]);
    const mode = rule.mode || "TRANSITIONAL";
    const exceptionStrategy = rule.exceptionStrategy || "REJECT";
    const available = allocation
      ? subtractMoney(subtractMoney(allocation.assignedAmount, allocation.committedAmount), allocation.executedAmount)
      : subtractMoney(subtractMoney(center.annualBudget, center.committedAmount), center.executedAmount);
    if (mode === "ACTIVE" && available < line.amount && exceptionStrategy === "REJECT") {
      throw insufficientBudgetError(allocation ? `${center.code} allocation` : center.code, available, line.amount, exceptionStrategy);
    }
    let budgetException = null;
    let exceptionApproved = false;
    if (mode === "ACTIVE" && available < line.amount) {
      const key = dimensionKey(line, request.project);
      budgetException = await BudgetException.findOne({ request: request._id, dimensionKey: key });
      if (!budgetException) {
        [budgetException] = await BudgetException.create([{
          request: request._id,
          dimensionKey: key,
          costCenter: line.costCenter,
          expenseType: line.expenseType,
          budgetItem: line.budgetItem,
          project: line.project,
          strategy: exceptionStrategy,
          availableAmount: available,
          requestedAmount: line.amount,
          requestedBy: userId
        }]);
      }
      exceptionApproved = exceptionStrategy === "EXTRAORDINARY_APPROVAL" && budgetException.status === "APPROVED";
      if (!exceptionApproved) {
      throw new AppError(
        409,
        `Budget exception ${exceptionStrategy} is required before this request can continue.`,
        { available, required: line.amount, exceptionStrategy, costCenter: center.code, budgetException: budgetException._id, exceptionStatus: budgetException.status },
        ERROR_CODES.INSUFFICIENT_BUDGET
      );
      }
    }
    prepared.push({ ...line, mode, exceptionStrategy, allocation, center, budgetException, exceptionApproved });
  }

  const applied = [];
  try {
    for (const line of prepared.filter((item) => item.mode === "ACTIVE")) {
      if (line.allocation) {
        const allocationQuery = line.exceptionApproved
          ? { _id: line.allocation._id }
          : { _id: line.allocation._id, $expr: { $gte: [{ $subtract: [{ $subtract: ["$assignedAmount", "$committedAmount"] }, "$executedAmount"] }, line.amount] } };
        const updated = await BudgetAllocation.findOneAndUpdate(
          allocationQuery,
          { $inc: { committedAmount: line.amount } },
          { new: true, session }
        );
        if (!updated) throw new AppError(409, "Budget allocation changed while reserving funds. Retry the operation.", undefined, ERROR_CODES.INSUFFICIENT_BUDGET);
        applied.push({ kind: "allocation", id: line.allocation._id, amount: line.amount });
      } else {
        const centerQuery = line.exceptionApproved
          ? { _id: line.center._id }
          : { _id: line.center._id, $expr: { $gte: [{ $subtract: [{ $subtract: ["$annualBudget", { $ifNull: ["$committedAmount", 0] }] }, { $ifNull: ["$executedAmount", 0] }] }, line.amount] } };
        const updated = await CostCenter.findOneAndUpdate(
          centerQuery,
          { $inc: { committedAmount: line.amount } },
          { new: true, session }
        );
        if (!updated) throw new AppError(409, `${line.center.code} budget changed while reserving funds. Retry the operation.`, undefined, ERROR_CODES.INSUFFICIENT_BUDGET);
        applied.push({ kind: "costCenter", id: line.center._id, amount: line.amount });
      }
    }

    const status = prepared.some((line) => line.mode === "ACTIVE") ? BUDGET_STATUS.COMMITTED : BUDGET_STATUS.NO_BUDGET;
    const [commitment] = await BudgetCommitment.create([{
      request: request._id,
      requestNumber: request.requestNumber,
      period: request.accountingPeriod,
      lines: prepared.map((line) => ({
        allocation: line.allocation?._id,
        costCenter: line.costCenter,
        expenseType: line.expenseType,
        budgetItem: line.budgetItem,
        project: line.project,
        amount: line.amount,
        mode: line.mode,
        exceptionStrategy: line.exceptionStrategy,
        budgetException: line.budgetException?._id
      })),
      totalAmount: sumMoney(prepared.map((line) => line.amount)),
      status,
      createdBy: userId,
      reservedAt: new Date(),
      history: [{ status, amount: sumMoney(prepared.map((line) => line.amount)), by: userId, comments: "Budget reservation created." }]
    }], session ? { session } : undefined);
    return commitment;
  } catch (error) {
    await releaseApplied(applied, session);
    throw error;
  }
}

async function moveLineBalances(commitment, fromField, toField, session) {
  for (const line of commitment.lines.filter((item) => item.mode === "ACTIVE")) {
    const update = { $inc: { [fromField]: -line.amount, [toField]: line.amount } };
    if (line.allocation) await BudgetAllocation.updateOne({ _id: line.allocation }, update, { session });
    else await CostCenter.updateOne({ _id: line.costCenter }, update, { session });
  }
}

export async function executeBudget(request, userId, { session } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment || [BUDGET_STATUS.EXECUTED, BUDGET_STATUS.CLOSED, BUDGET_STATUS.RELEASED].includes(commitment.status)) return commitment;
  if (![BUDGET_STATUS.COMMITTED, BUDGET_STATUS.NO_BUDGET].includes(commitment.status)) return commitment;

  await moveLineBalances(commitment, "committedAmount", "executedAmount", session);
  commitment.status = BUDGET_STATUS.EXECUTED;
  commitment.executedAt = new Date();
  commitment.executedBy = userId;
  commitment.history.push({ status: BUDGET_STATUS.EXECUTED, amount: commitment.totalAmount, by: userId, comments: "Budget marked executed after confirmed payment." });
  await commitment.save({ session });
  return commitment;
}

export async function markBudgetPaid(request, userId, { session } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment || commitment.status === BUDGET_STATUS.CLOSED) return commitment;
  if (commitment.status !== BUDGET_STATUS.EXECUTED) await executeBudget(request, userId, { session });
  const current = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!current || current.status === BUDGET_STATUS.CLOSED) return current;

  for (const line of current.lines.filter((item) => item.mode === "ACTIVE")) {
    const update = { $inc: { paidAmount: line.amount } };
    if (line.allocation) await BudgetAllocation.updateOne({ _id: line.allocation }, update, { session });
    else await CostCenter.updateOne({ _id: line.costCenter }, update, { session });
  }
  current.status = BUDGET_STATUS.CLOSED;
  current.paidAt = new Date();
  current.paidBy = userId;
  current.history.push({ status: BUDGET_STATUS.CLOSED, amount: current.totalAmount, by: userId, comments: "Budget payment figures updated after Treasury confirmation." });
  await current.save({ session });
  return current;
}

export async function releaseBudget(request, userId, reason, { session } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment || [BUDGET_STATUS.EXECUTED, BUDGET_STATUS.CLOSED, BUDGET_STATUS.RELEASED].includes(commitment.status)) return commitment;

  for (const line of commitment.lines.filter((item) => item.mode === "ACTIVE")) {
    const update = { $inc: { committedAmount: -line.amount } };
    if (line.allocation) await BudgetAllocation.updateOne({ _id: line.allocation }, update, { session });
    else await CostCenter.updateOne({ _id: line.costCenter }, update, { session });
  }
  commitment.status = BUDGET_STATUS.RELEASED;
  commitment.releasedAt = new Date();
  commitment.releasedBy = userId;
  commitment.releaseReason = reason;
  commitment.history.push({ status: BUDGET_STATUS.RELEASED, amount: commitment.totalAmount, by: userId, comments: reason });
  await commitment.save({ session });
  return commitment;
}
