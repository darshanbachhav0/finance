import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import FinancialRequest from "../models/FinancialRequest.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { REQUEST_STATUS } from "../utils/constants.js";
import { ensurePeriodOpen } from "../services/periodService.js";
import { generatePaymentEntries } from "../services/accountingService.js";
import GeneratedFile from "../models/GeneratedFile.js";
import { recordAudit, workflowEvent } from "../services/auditService.js";
import { executeBudget } from "../services/budgetService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bankFilesDir = path.resolve(__dirname, "..", "..", "uploads", "bank-files");

const populateRequest = [
  { path: "supplier" },
  { path: "solicitor", select: "name email role area" },
  { path: "lines.costCenter" },
  { path: "lines.expenseType" }
];

export const paymentQueue = asyncHandler(async (_req, res) => {
  const data = await FinancialRequest.find({ status: REQUEST_STATUS.APPROVED_PAYABLE })
    .populate(populateRequest)
    .sort({ updatedAt: 1 });
  res.json({ data });
});

export const listBankFiles = asyncHandler(async (_req, res) => {
  const data = await GeneratedFile.find({ kind: "BANK_TXT" })
    .populate("generatedBy", "name email role")
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ data });
});

export const paymentConfirmationQueue = asyncHandler(async (_req, res) => {
  const data = await FinancialRequest.find({ status: { $in: [REQUEST_STATUS.BANK_PROCESSED, REQUEST_STATUS.RENDITION_PENDING] }, "payment.confirmedAt": { $exists: false } })
    .populate(populateRequest)
    .sort({ "bankFile.generatedAt": 1 });
  res.json({ data });
});

export const generateBankFile = asyncHandler(async (req, res) => {
  const { requestIds, bank = "AUTO", paymentDate } = req.body;
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    throw new AppError(400, "Select at least one payable request.");
  }

  const requests = await FinancialRequest.find({ _id: { $in: requestIds } }).populate(populateRequest);
  if (requests.length !== requestIds.length) throw new AppError(404, "One or more selected requests were not found.");

  for (const request of requests) {
    if (request.status !== REQUEST_STATUS.APPROVED_PAYABLE) {
      throw new AppError(422, `${request.requestNumber} is not approved for payment.`);
    }
    if (!request.supplier?.cci && !request.supplier?.bankAccount) {
      throw new AppError(422, `${request.requestNumber} cannot be paid because the supplier has no bank account or CCI.`);
    }
    await ensurePeriodOpen(request.accountingPeriod);
  }

  await fs.mkdir(bankFilesDir, { recursive: true });
  const normalizedBank = String(bank || "AUTO").toUpperCase();
  const fileName = `${normalizedBank.toLowerCase()}-payments-${Date.now()}.txt`;
  const filePath = path.join(bankFilesDir, fileName);
  const separator = normalizedBank === "BCP" ? "|" : normalizedBank === "BBVA" ? ";" : ",";
  const header = ["RUC_DNI", "SUPPLIER_NAME", "BANK_ACCOUNT_OR_CCI", "AMOUNT", "CURRENCY", "PAYMENT_DATE", "REQUEST_ID"].join(separator);
  const rows = requests.map((request) =>
    [
      request.supplier.rucDni,
      request.supplier.name,
      request.supplier.cci || request.supplier.bankAccount || "",
      request.totalAmount.toFixed(2),
      request.currency,
      paymentDate || new Date().toISOString().slice(0, 10),
      request.requestNumber
    ].join(separator)
  );
  const content = [header, ...rows].join("\n");
  await fs.writeFile(filePath, content, "utf8");

  for (const request of requests) {
    const from = request.status;
    request.status = request.requestType === "Entrega a Rendir" ? REQUEST_STATUS.RENDITION_PENDING : REQUEST_STATUS.BANK_PROCESSED;
    request.bankFile = {
      bank: normalizedBank,
      fileName,
      url: `/uploads/bank-files/${fileName}`,
      generatedAt: new Date(),
      generatedBy: req.user._id
    };
    request.approvalHistory.push(workflowEvent({
      action: "BANK_FILE_GENERATED",
      from,
      to: request.status,
      user: req.user,
      req,
      comments: `Included in ${fileName} for ${normalizedBank}.`
    }));
    await request.save();
    await generatePaymentEntries(request, req.user._id);
    await executeBudget(request, req.user._id);
    await recordAudit({
      entityType: "FinancialRequest",
      entity: request,
      action: "BANK_FILE_GENERATED",
      user: req.user,
      req,
      comments: `Included in ${fileName}.`,
      changes: { bank: normalizedBank, paymentDate, status: request.status }
    });
  }

  const totalsMap = requests.reduce((result, request) => {
    const current = result.get(request.currency) || { currency: request.currency, total: 0, count: 0 };
    current.total += Number(request.totalAmount || 0);
    current.count += 1;
    result.set(request.currency, current);
    return result;
  }, new Map());
  const totals = [...totalsMap.values()].map((item) => ({ ...item, total: Number(item.total.toFixed(2)) }));

  await GeneratedFile.create({
    kind: "BANK_TXT",
    fileName,
    url: `/uploads/bank-files/${fileName}`,
    requestIds: requests.map((request) => request._id),
    requestNumbers: requests.map((request) => request.requestNumber),
    totals,
    rowCount: requests.length,
    generatedBy: req.user._id,
    metadata: { bank: normalizedBank, paymentDate, statusChangesApplied: true, paymentEntriesCreated: true }
  });

  res.status(201).json({
    fileName,
    url: `/uploads/bank-files/${fileName}`,
    content,
    processed: requests.map((request) => request.requestNumber),
    totals,
    statusChangesApplied: true,
    paymentEntriesCreated: true
  });
});

export const confirmPayment = asyncHandler(async (req, res) => {
  const { operationNumber, paidAt, comments } = req.body;
  if (!operationNumber || !paidAt) throw new AppError(422, "Operation number and actual payment date are required.");

  const request = await FinancialRequest.findById(req.params.id).populate(populateRequest);
  if (!request) throw new AppError(404, "Financial request not found.");
  if (![REQUEST_STATUS.BANK_PROCESSED, REQUEST_STATUS.RENDITION_PENDING].includes(request.status)) {
    throw new AppError(422, "Payment can only be confirmed after bank-file generation.");
  }
  await ensurePeriodOpen(request.accountingPeriod);

  const from = request.status;
  request.payment = {
    operationNumber: String(operationNumber).trim(),
    paidAt,
    confirmedAt: new Date(),
    confirmedBy: req.user._id,
    reconciliationComments: comments
  };
  if (request.requestType !== "Entrega a Rendir") request.status = REQUEST_STATUS.PAID;
  request.approvalHistory.push(workflowEvent({
    action: "PAYMENT_CONFIRMED",
    from,
    to: request.status,
    user: req.user,
    req,
    comments: comments || `Payment confirmed with operation ${operationNumber}.`
  }));
  await request.save();
  await recordAudit({
    entityType: "FinancialRequest",
    entity: request,
    action: "PAYMENT_CONFIRMED",
    user: req.user,
    req,
    comments,
    changes: { operationNumber, paidAt, status: request.status }
  });
  res.json({ data: request });
});
