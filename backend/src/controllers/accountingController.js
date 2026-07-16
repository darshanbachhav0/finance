import AccountingEntry from "../models/AccountingEntry.js";
import CostCenter from "../models/CostCenter.js";
import ExpenseType from "../models/ExpenseType.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getConsolidation } from "../services/accountingService.js";
import { flattenConsolidationRow, persistReportFile, toCsv } from "../services/exportService.js";
import { AppError } from "../utils/AppError.js";
import GeneratedFile from "../models/GeneratedFile.js";

async function hydrateConsolidation(rows) {
  const costCenterIds = [...new Set(rows.map((row) => String(row.costCenter)))];
  const expenseTypeIds = [...new Set(rows.map((row) => String(row.expenseType)))];
  const [costCenters, expenseTypes] = await Promise.all([
    CostCenter.find({ _id: { $in: costCenterIds } }),
    ExpenseType.find({ _id: { $in: expenseTypeIds } })
  ]);
  const costCenterMap = new Map(costCenters.map((item) => [String(item._id), item]));
  const expenseTypeMap = new Map(expenseTypes.map((item) => [String(item._id), item]));

  return rows.map((row) => flattenConsolidationRow(row, costCenterMap.get(String(row.costCenter)), expenseTypeMap.get(String(row.expenseType))));
}

export const listEntries = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.period) query.period = req.query.period;
  if (req.query.type) query.type = req.query.type;

  const data = await AccountingEntry.find(query)
    .populate("request", "requestNumber requestType status")
    .populate("costCenter")
    .populate("expenseType")
    .sort({ createdAt: -1 });
  res.json({ data });
});

export const consolidationPreview = asyncHandler(async (req, res) => {
  if (!req.query.period) throw new AppError(400, "Period query parameter is required.");
  const rows = await hydrateConsolidation(await getConsolidation(req.query.period));
  res.json({ data: rows });
});

export const listAccountingExports = asyncHandler(async (_req, res) => {
  const data = await GeneratedFile.find({ kind: "CONSOLIDATION_CSV" })
    .populate("generatedBy", "name email role")
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ data });
});

export const exportConsolidation = asyncHandler(async (req, res) => {
  if (!req.query.period) throw new AppError(400, "Period query parameter is required.");
  const format = req.query.format || "json";
  const rows = await hydrateConsolidation(await getConsolidation(req.query.period));

  if (format === "csv") {
    const content = toCsv(rows);
    const fileName = `consolidation-${req.query.period}-${Date.now()}.csv`;
    const url = await persistReportFile(fileName, content);
    await GeneratedFile.create({
      kind: "CONSOLIDATION_CSV",
      fileName,
      url,
      period: req.query.period,
      rowCount: rows.length,
      generatedBy: req.user._id
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    res.send(content);
    return;
  }

  res.json({ data: rows });
});
