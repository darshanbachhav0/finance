import BudgetCommitment from "../models/BudgetCommitment.js";
import CostCenter from "../models/CostCenter.js";
import { AppError } from "../utils/AppError.js";

function groupedRequestLines(request) {
  const grouped = new Map();
  for (const line of request.lines || []) {
    const costCenter = String(line.costCenter?._id || line.costCenter);
    const current = grouped.get(costCenter) || {
      costCenter,
      expenseType: line.expenseType?._id || line.expenseType,
      amount: 0
    };
    current.amount += Number(line.penEquivalent || line.totalAmount || 0);
    grouped.set(costCenter, current);
  }
  return [...grouped.values()].map((line) => ({ ...line, amount: Number(line.amount.toFixed(2)) }));
}

export async function reserveBudget(request, userId) {
  const existing = await BudgetCommitment.findOne({ request: request._id });
  if (existing) return existing;

  const grouped = groupedRequestLines(request);
  const centers = await CostCenter.find({ _id: { $in: grouped.map((line) => line.costCenter) } });
  const centerMap = new Map(centers.map((center) => [String(center._id), center]));
  const lines = grouped.map((line) => {
    const center = centerMap.get(line.costCenter);
    if (!center || !center.active) throw new AppError(422, "Every request line needs an active cost center before budget commitment.");
    const mode = center.budgetMode === "ACTIVE" && Number(center.annualBudget || 0) > 0 ? "ACTIVE" : "TRANSITIONAL";
    const available = Number(center.annualBudget || 0) - Number(center.committedAmount || 0) - Number(center.executedAmount || 0);
    if (mode === "ACTIVE" && available < line.amount) {
      throw new AppError(422, `${center.code} has insufficient budget. Available PEN ${available.toFixed(2)}, required PEN ${line.amount.toFixed(2)}.`);
    }
    return { ...line, mode, project: request.project || "" };
  });

  const applied = [];
  try {
    for (const line of lines.filter((item) => item.mode === "ACTIVE")) {
      const center = centerMap.get(line.costCenter);
      const committedAmount = Number(center.committedAmount || 0) + line.amount;
      const availableAmount = Number(center.annualBudget || 0) - committedAmount - Number(center.executedAmount || 0);
      const updated = await CostCenter.findOneAndUpdate(
        {
          _id: center._id,
          $expr: {
            $gte: [
              { $subtract: [{ $subtract: ["$annualBudget", { $ifNull: ["$committedAmount", 0] }] }, "$executedAmount"] },
              line.amount
            ]
          }
        },
        { $set: { committedAmount, availableAmount } },
        { new: true }
      );
      if (!updated) throw new AppError(409, `${center.code} budget changed while this request was being approved. Review the available balance and try again.`);
      applied.push({ center, amount: line.amount });
    }

    return await BudgetCommitment.create({
      request: request._id,
      requestNumber: request.requestNumber,
      period: request.accountingPeriod,
      lines,
      totalAmount: Number(lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2)),
      status: lines.some((line) => line.mode === "ACTIVE") ? "RESERVED" : "WITHOUT_BUDGET",
      createdBy: userId
    });
  } catch (error) {
    for (const item of applied) {
      const committedAmount = Math.max(0, Number(item.center.committedAmount || 0));
      await CostCenter.findByIdAndUpdate(item.center._id, {
        $set: {
          committedAmount,
          availableAmount: Number(item.center.annualBudget || 0) - committedAmount - Number(item.center.executedAmount || 0)
        }
      });
    }
    throw error;
  }
}

export async function executeBudget(request, userId) {
  const commitment = await BudgetCommitment.findOne({ request: request._id });
  if (!commitment || ["EXECUTED", "RELEASED"].includes(commitment.status)) return commitment;

  for (const line of commitment.lines.filter((item) => item.mode === "ACTIVE")) {
    const center = await CostCenter.findById(line.costCenter);
    if (!center) continue;
    center.committedAmount = Math.max(0, Number(center.committedAmount || 0) - line.amount);
    center.executedAmount = Number(center.executedAmount || 0) + line.amount;
    center.paidAmount = Number(center.paidAmount || 0) + line.amount;
    await center.save();
  }
  commitment.status = "EXECUTED";
  commitment.executedAt = new Date();
  commitment.executedBy = userId;
  await commitment.save();
  return commitment;
}

export async function releaseBudget(request, userId, reason) {
  const commitment = await BudgetCommitment.findOne({ request: request._id });
  if (!commitment || ["EXECUTED", "RELEASED"].includes(commitment.status)) return commitment;

  for (const line of commitment.lines.filter((item) => item.mode === "ACTIVE")) {
    const center = await CostCenter.findById(line.costCenter);
    if (!center) continue;
    center.committedAmount = Math.max(0, Number(center.committedAmount || 0) - line.amount);
    await center.save();
  }
  commitment.status = "RELEASED";
  commitment.releasedAt = new Date();
  commitment.releasedBy = userId;
  commitment.releaseReason = reason;
  await commitment.save();
  return commitment;
}
