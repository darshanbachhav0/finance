import BudgetCommitment from "../models/BudgetCommitment.js";
import CostCenter from "../models/CostCenter.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const getBudgetOverview = asyncHandler(async (req, res) => {
  const centerQuery = {};
  if (req.query.area) centerQuery.area = req.query.area;
  const [costCenters, commitments] = await Promise.all([
    CostCenter.find(centerQuery).sort({ code: 1 }),
    BudgetCommitment.find(req.query.period ? { period: req.query.period } : {})
      .populate("request", "requestNumber requestType status priority requestingArea project")
      .populate("lines.costCenter", "code name area budgetMode")
      .populate("lines.expenseType", "code name accountNumber category")
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 })
  ]);

  const totals = costCenters.reduce((result, center) => {
    result.assigned += Number(center.annualBudget || 0);
    result.committed += Number(center.committedAmount || 0);
    result.executed += Number(center.executedAmount || 0);
    result.paid += Number(center.paidAmount || 0);
    result.available += Number(center.availableAmount || 0);
    return result;
  }, { assigned: 0, committed: 0, executed: 0, paid: 0, available: 0 });

  const warnings = costCenters
    .filter((center) => center.budgetMode === "ACTIVE" && center.annualBudget > 0 && center.availableAmount / center.annualBudget < 0.1)
    .map((center) => ({ costCenter: center._id, code: center.code, name: center.name, available: center.availableAmount }));

  res.json({ data: { totals, costCenters, commitments, warnings } });
});
