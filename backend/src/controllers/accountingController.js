import AccountingEntry from "../models/AccountingEntry.js";
import CostCenter from "../models/CostCenter.js";
import ExpenseType from "../models/ExpenseType.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getConsolidation } from "../services/accountingService.js";
import { flattenConsolidationRow, persistReportFile, toCsv } from "../services/exportService.js";
import { AppError } from "../utils/AppError.js";
import GeneratedFile from "../models/GeneratedFile.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { generateProvisionEntries } from "../services/accountingService.js";
import { recordAudit, workflowEvent } from "../services/auditService.js";
import { ensurePeriodOpen } from "../services/periodService.js";
import { REQUEST_STATUS } from "../utils/constants.js";

const populatedRequest = [
  { path: "supplier" },
  { path: "solicitor", select: "name email role area" },
  { path: "lines.costCenter" },
  { path: "lines.expenseType" },
  { path: "approvalHistory.actor", select: "name email role" },
  { path: "budgetCommitment" },
  { path: "fiscalData.processedBy", select: "name email role" }
];

export const listPendingAccounting = asyncHandler(async (_req, res) => {
  const data = await FinancialRequest.find({ status: REQUEST_STATUS.BUDGET_COMMITTED })
    .populate(populatedRequest)
    .sort({ updatedAt: 1 });
  res.json({ data });
});

export const processPayable = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id);
  if (!request) throw new AppError(404, "Financial request not found.");
  if (request.status !== REQUEST_STATUS.BUDGET_COMMITTED) {
    throw new AppError(422, "Only budget-committed requests can be processed by Accounting.");
  }

  const required = ["documentType", "series", "number", "documentDate", "accountingDate", "fiscalPeriod", "accountNumber"];
  const missing = required.filter((field) => !String(req.body[field] || "").trim());
  if (missing.length) throw new AppError(422, `Missing fiscal field(s): ${missing.join(", ")}.`);
  await ensurePeriodOpen(req.body.fiscalPeriod);

  const duplicate = await FinancialRequest.findOne({
    _id: { $ne: request._id },
    supplier: request.supplier,
    "fiscalData.documentType": req.body.documentType,
    "fiscalData.series": String(req.body.series).toUpperCase(),
    "fiscalData.number": req.body.number
  });
  if (duplicate) {
    throw new AppError(409, `Duplicate fiscal document already registered in ${duplicate.requestNumber}.`);
  }

  request.fiscalData = {
    documentType: req.body.documentType,
    series: String(req.body.series).toUpperCase(),
    number: req.body.number,
    documentDate: req.body.documentDate,
    accountingDate: req.body.accountingDate,
    fiscalPeriod: req.body.fiscalPeriod,
    accountNumber: req.body.accountNumber,
    subaccountNumber: req.body.subaccountNumber,
    processedAt: new Date(),
    processedBy: req.user._id
  };
  const from = request.status;
  request.status = REQUEST_STATUS.APPROVED_PAYABLE;
  request.approvalHistory.push(workflowEvent({
    action: "ACCOUNTED",
    from,
    to: request.status,
    user: req.user,
    req,
    comments: req.body.comments || "Fiscal document validated, preliminary entry generated, and CXP registered."
  }));
  await request.save();
  await generateProvisionEntries(request, req.user._id);
  await recordAudit({
    entityType: "FinancialRequest",
    entity: request,
    action: "ACCOUNTED",
    user: req.user,
    req,
    comments: req.body.comments,
    changes: { fiscalDocument: `${request.fiscalData.documentType} ${request.fiscalData.series}-${request.fiscalData.number}` }
  });
  await request.populate(populatedRequest);
  res.json({ data: request });
});

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
