import FinancialRequest from "../models/FinancialRequest.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { persistReportFile, toCsv } from "../services/exportService.js";
import { AppError } from "../utils/AppError.js";
import { REQUEST_STATUS } from "../utils/constants.js";
import GeneratedFile from "../models/GeneratedFile.js";

export const listSireExports = asyncHandler(async (_req, res) => {
  const data = await GeneratedFile.find({ kind: "SIRE_CSV" })
    .populate("generatedBy", "name email role")
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ data });
});

export const exportSire = asyncHandler(async (req, res) => {
  if (!req.query.period) throw new AppError(400, "Period query parameter is required.");
  const format = req.query.format || "json";

  const requests = await FinancialRequest.find({
    accountingPeriod: req.query.period,
    status: { $in: [REQUEST_STATUS.APPROVED_PAYABLE, REQUEST_STATUS.BANK_PROCESSED, REQUEST_STATUS.RENDITION_PENDING, REQUEST_STATUS.CLOSED] },
    "xmlValidation.validated": true
  })
    .populate("supplier")
    .sort({ issueDate: 1 });

  const rows = requests.map((request) => ({
    period: request.accountingPeriod,
    supplierRuc: request.supplier?.rucDni || request.xmlValidation?.data?.ruc || "",
    supplierName: request.supplier?.name || request.xmlValidation?.data?.supplierName || "",
    invoiceNumber: request.xmlValidation?.data?.invoiceNumber || "",
    issueDate: request.xmlValidation?.data?.issueDate || request.issueDate.toISOString().slice(0, 10),
    netAmount: request.netAmount,
    igvAmount: request.igvAmount,
    totalAmount: request.totalAmount,
    currency: request.currency,
    requestId: request.requestNumber
  }));

  const warnings = rows.flatMap((row) => {
    const missing = [];
    if (!row.supplierRuc) missing.push("supplier RUC");
    if (!row.invoiceNumber) missing.push("invoice number");
    if (!row.issueDate) missing.push("issue date");
    return missing.length ? [{ requestId: row.requestId, message: `Missing ${missing.join(", ")}.` }] : [];
  });

  if (format === "csv") {
    const content = toCsv(rows);
    const fileName = `sire-rce-${req.query.period}-${Date.now()}.csv`;
    const url = await persistReportFile(fileName, content);
    await GeneratedFile.create({
      kind: "SIRE_CSV",
      fileName,
      url,
      period: req.query.period,
      requestNumbers: rows.map((row) => row.requestId),
      rowCount: rows.length,
      generatedBy: req.user._id,
      metadata: { warningCount: warnings.length }
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    res.send(content);
    return;
  }

  res.json({ data: rows, warnings });
});
