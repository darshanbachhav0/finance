import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import JournalEntry from "../models/JournalEntry.js";
import { validateAccountingDimensions } from "./accountingDimensionService.js";
import { requireAccountingMapping } from "./accountingMappingService.js";
import { recordAudit } from "./auditService.js";
import { assertConfiguredDocuments } from "./documentRuleService.js";
import { applyExchangeRate } from "./exchangeRateService.js";
import { guardAccountingPeriod } from "./periodService.js";
import { notifyRoles, resolveNotification } from "./notificationService.js";
import { runFinancialOperation } from "./transactionService.js";
import { transitionRequest } from "./workflowService.js";
import { AppError } from "../utils/AppError.js";
import {
  AP_STATUS,
  ERROR_CODES,
  MANDATORY_XML_TYPES,
  REQUEST_STATUS,
  REQUEST_TYPE
} from "../utils/constants.js";
import { addMoney, moneyEquals, multiplyMoney, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";

function normalizeToken(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function fiscalPayload(body, supplierIdentifier) {
  const voucherType = normalizeToken(body.voucherType || body.documentType);
  const series = normalizeToken(body.series);
  const number = normalizeToken(body.number);
  const required = {
    voucherType,
    series,
    number,
    documentDate: body.documentDate,
    accountingDate: body.accountingDate,
    fiscalPeriod: body.fiscalPeriod
  };
  const missing = Object.entries(required).filter(([, value]) => !String(value || "").trim()).map(([key]) => key);
  if (missing.length) {
    throw new AppError(422, "Required fiscal fields are missing.", { missing }, ERROR_CODES.VALIDATION_ERROR);
  }
  return {
    supplierIdentifierNormalized: normalizeToken(supplierIdentifier),
    voucherType,
    documentType: voucherType,
    series,
    number,
    documentDate: body.documentDate,
    accountingDate: body.accountingDate,
    fiscalPeriod: body.fiscalPeriod,
    accountNumber: String(body.accountNumber || "").trim(),
    subaccountNumber: String(body.subaccountNumber || "").trim(),
    comments: String(body.comments || "").trim()
  };
}

function debitLine({ accountNumber, subAccount = "", description, costCenter, expenseType, amount }) {
  return { accountNumber, subAccount, description, costCenter, expenseType, debit: roundMoney(amount), credit: 0 };
}

function creditLine({ accountNumber, subAccount = "", description, amount }) {
  return { accountNumber, subAccount, description, debit: 0, credit: roundMoney(amount) };
}

function adjustDebitsToTotal(lines, target) {
  const current = sumMoney(lines.map((line) => line.debit));
  const difference = subtractMoney(target, current);
  if (!moneyEquals(difference, 0)) {
    const lastDebit = [...lines].reverse().find((line) => line.debit > 0);
    if (!lastDebit) throw new AppError(422, "The provision has no debit line.", undefined, ERROR_CODES.VALIDATION_ERROR);
    lastDebit.debit = addMoney(lastDebit.debit, difference);
  }
}

async function provisionJournalLines(request) {
  await request.populate("lines.expenseType");
  const total = request.totalPENEquivalent ?? request.penEquivalent;
  const payable = await requireAccountingMapping("ACCOUNTS_PAYABLE", request);
  const lines = [];

  if (request.requestType === REQUEST_TYPE.ENTREGA_RENDIR) {
    const transit = await requireAccountingMapping("ADVANCE_TRANSIT", request);
    lines.push(debitLine({
      accountNumber: transit.accountNumber,
      subAccount: transit.subAccount,
      description: `Advance receivable for ${request.requestNumber}`,
      amount: total
    }));
  } else if (request.requestType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO) {
    for (const line of request.lines) {
      lines.push(debitLine({
        accountNumber: line.expenseType.accountNumber,
        subAccount: line.subAccount || "",
        description: `Non-deductible reimbursement ${request.requestNumber}`,
        costCenter: line.costCenter,
        expenseType: line.expenseType._id,
        amount: line.penEquivalent
      }));
    }
  } else {
    const igvMapping = request.totalIGV > 0 ? await requireAccountingMapping("IGV", request) : null;
    for (const line of request.lines) {
      const netPen = multiplyMoney(line.netAmount, request.exchangeRate);
      const igvPen = multiplyMoney(line.igvAmount, request.exchangeRate);
      if (netPen > 0) {
        lines.push(debitLine({
          accountNumber: line.expenseType.accountNumber,
          subAccount: line.subAccount || "",
          description: `${request.requestType} provision ${request.requestNumber}`,
          costCenter: line.costCenter,
          expenseType: line.expenseType._id,
          amount: netPen
        }));
      }
      if (igvPen > 0) {
        lines.push(debitLine({
          accountNumber: igvMapping.accountNumber,
          subAccount: igvMapping.subAccount,
          description: `Recoverable IGV ${request.requestNumber}`,
          costCenter: line.costCenter,
          expenseType: line.expenseType._id,
          amount: igvPen
        }));
      }
    }
  }
  adjustDebitsToTotal(lines, total);
  lines.push(creditLine({
    accountNumber: payable.accountNumber,
    subAccount: payable.subAccount,
    description: `Accounts payable ${request.requestNumber}`,
    amount: total
  }));
  return lines;
}

async function createJournal({ request, accountsPayable, entryType, sourceTransaction, lines, userId, session }) {
  const existing = await JournalEntry.findOne({ request: request._id, entryType }).session(session || null);
  if (existing) return existing;
  const totalDebit = sumMoney(lines.map((line) => line.debit));
  const totalCredit = sumMoney(lines.map((line) => line.credit));
  if (!moneyEquals(totalDebit, totalCredit)) {
    throw new AppError(422, "Accounting journal is not balanced.", { totalDebit, totalCredit }, ERROR_CODES.VALIDATION_ERROR);
  }
  const [journal] = await JournalEntry.create([{
    request: request._id,
    accountsPayable: accountsPayable?._id,
    period: request.fiscalData?.fiscalPeriod || request.accountingPeriod,
    entryType,
    sourceTransaction,
    currency: request.currency,
    originalAmount: request.totalAmount,
    exchangeRate: request.exchangeRate,
    penEquivalent: request.totalPENEquivalent ?? request.penEquivalent,
    lines,
    totalDebit,
    totalCredit,
    status: "POSTED",
    postedAt: new Date(),
    generatedBy: userId
  }], session ? { session } : undefined);
  return journal;
}

export async function createProvisionJournal(request, accountsPayable, userId, { session } = {}) {
  const entryType = request.requestType === REQUEST_TYPE.ENTREGA_RENDIR ? "ADVANCE" : "PROVISION";
  return createJournal({
    request,
    accountsPayable,
    entryType,
    sourceTransaction: `CXP:${request.requestNumber}`,
    lines: await provisionJournalLines(request),
    userId,
    session
  });
}

export async function createPaymentJournal(request, accountsPayable, userId, { bank, session } = {}) {
  const [payable, bankMapping] = await Promise.all([
    requireAccountingMapping("ACCOUNTS_PAYABLE", request),
    requireAccountingMapping("BANK", request, { bank, currency: request.currency })
  ]);
  const amount = request.totalPENEquivalent ?? request.penEquivalent;
  return createJournal({
    request,
    accountsPayable,
    entryType: "PAYMENT",
    sourceTransaction: `PAYMENT:${request.payment?.operationNumber || request.requestNumber}`,
    lines: [
      debitLine({ accountNumber: payable.accountNumber, subAccount: payable.subAccount, description: `Settle CXP ${request.requestNumber}`, amount }),
      creditLine({ accountNumber: bankMapping.accountNumber, subAccount: bankMapping.subAccount, description: `Bank payment ${request.requestNumber}`, amount })
    ],
    userId,
    session
  });
}

export async function createRenditionJournal(request, accountsPayable, userId, { session } = {}) {
  await request.populate("rendition.lines.expenseType");
  const [transit, igvMapping, returnedMapping] = await Promise.all([
    requireAccountingMapping("ADVANCE_TRANSIT", request),
    Number(request.rendition.lines.reduce((sum, line) => addMoney(sum, line.igvAmount), 0)) > 0
      ? requireAccountingMapping("IGV", request)
      : Promise.resolve(null),
    request.rendition.amountReturned > 0
      ? requireAccountingMapping("RETURN_RECEIVABLE", request)
      : Promise.resolve(null)
  ]);
  const lines = [];
  for (const line of request.rendition.lines) {
    const netPen = multiplyMoney(line.netAmount, request.exchangeRate);
    const igvPen = multiplyMoney(line.igvAmount, request.exchangeRate);
    if (netPen > 0) {
      lines.push(debitLine({
        accountNumber: line.expenseType.accountNumber,
        subAccount: line.subAccount || "",
        description: `Rendition expense ${request.requestNumber}`,
        costCenter: line.costCenter,
        expenseType: line.expenseType._id,
        amount: netPen
      }));
    }
    if (igvPen > 0) {
      lines.push(debitLine({
        accountNumber: igvMapping.accountNumber,
        subAccount: igvMapping.subAccount,
        description: `Rendition IGV ${request.requestNumber}`,
        costCenter: line.costCenter,
        expenseType: line.expenseType._id,
        amount: igvPen
      }));
    }
  }
  if (request.rendition.amountReturned > 0) {
    lines.push(debitLine({
      accountNumber: returnedMapping.accountNumber,
      subAccount: returnedMapping.subAccount,
      description: `Returned advance funds ${request.requestNumber}`,
      amount: multiplyMoney(request.rendition.amountReturned, request.exchangeRate)
    }));
  }
  const advancedPen = multiplyMoney(request.rendition.amountAdvanced, request.exchangeRate);
  adjustDebitsToTotal(lines, advancedPen);
  lines.push(creditLine({
    accountNumber: transit.accountNumber,
    subAccount: transit.subAccount,
    description: `Clear advance receivable ${request.requestNumber}`,
    amount: advancedPen
  }));
  return createJournal({
    request,
    accountsPayable,
    entryType: "RENDITION",
    sourceTransaction: `RENDITION:${request.requestNumber}`,
    lines,
    userId,
    session
  });
}

export async function processAccountsPayable({ requestId, payload, user, req }) {
  const request = await FinancialRequest.findById(requestId).select("+attachments.path").populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (request.status !== REQUEST_STATUS.BUDGET_COMMITTED) {
    throw new AppError(409, "Only budget-committed requests can be processed by Accounting.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (
    request.requestType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO
    && request.rendition?.number
    && (request.rendition?.status !== "VALIDATED" || request.rendition?.financeReview?.result !== "APPROVED")
  ) {
    throw new AppError(
      422,
      "The official unsupported-reimbursement detail requires Finance approval before Accounting processing.",
      { renditionStatus: request.rendition?.status, financeReview: request.rendition?.financeReview?.result },
      ERROR_CODES.RENDITION_REQUIRED
    );
  }
  const supplierIdentifier = request.supplier?.normalizedIdentifier || request.supplier?.rucDni || request.supplierSnapshot?.identifier;
  const fiscal = fiscalPayload(payload, supplierIdentifier);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "ACCOUNT", user, req, module: "ACCOUNTING", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  if (fiscal.fiscalPeriod !== request.accountingPeriod) {
    await guardAccountingPeriod({ period: fiscal.fiscalPeriod, action: "ACCOUNT", user, req, module: "ACCOUNTING", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  }
  await applyExchangeRate(request);
  await validateAccountingDimensions({ requestType: request.requestType, expenseNature: request.expenseNature, lines: request.lines, user });
  await assertConfiguredDocuments(request);
  if (MANDATORY_XML_TYPES.includes(request.requestType) && !request.xmlValidation?.validated) {
    throw new AppError(422, "A valid XML fiscal document is required before Accounting processing.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
  }
  const duplicate = await AccountsPayable.findOne({
    request: { $ne: request._id },
    supplierIdentifierSnapshot: fiscal.supplierIdentifierNormalized,
    "voucher.voucherType": fiscal.voucherType,
    "voucher.series": fiscal.series,
    "voucher.number": fiscal.number
  });
  if (duplicate) {
    throw new AppError(409, "The supplier voucher is already registered.", { accountsPayable: duplicate._id }, ERROR_CODES.DUPLICATE_VOUCHER);
  }

  const result = await runFinancialOperation(async (session) => {
    request.fiscalData = { ...fiscal, processedAt: new Date(), processedBy: user._id };
    let accountsPayable = await AccountsPayable.findOne({ request: request._id }).session(session || null);
    if (!accountsPayable) {
      [accountsPayable] = await AccountsPayable.create([{
        request: request._id,
        supplier: request.supplier._id,
        supplierIdentifierSnapshot: fiscal.supplierIdentifierNormalized,
        voucher: {
          voucherType: fiscal.voucherType,
          documentType: fiscal.documentType,
          series: fiscal.series,
          number: fiscal.number,
          documentDate: fiscal.documentDate
        },
        originalAmount: request.totalAmount,
        currency: request.currency,
        exchangeRate: request.exchangeRate,
        penEquivalent: request.totalPENEquivalent ?? request.penEquivalent,
        outstandingAmount: request.totalAmount,
        dueDate: payload.dueDate,
        status: AP_STATUS.OPEN,
        history: [{ status: AP_STATUS.OPEN, by: user._id, comments: "CXP created after fiscal validation." }]
      }], session ? { session } : undefined);
    }
    const journal = await createProvisionJournal(request, accountsPayable, user._id, { session });
    accountsPayable.provisionJournal = journal._id;
    await accountsPayable.save({ session });
    request.accountsPayable = accountsPayable._id;
    await transitionRequest({
      request,
      targetStatus: REQUEST_STATUS.ACCOUNTED,
      user,
      req,
      action: "ACCOUNTED",
      comments: payload.comments || "Fiscal validation completed, balanced provision posted, and CXP created.",
      session
    });
    await recordAudit({
      entityType: "AccountsPayable",
      entity: accountsPayable,
      requestId: request._id,
      action: "CREATED",
      user,
      req,
      module: "ACCOUNTING",
      newValues: { status: accountsPayable.status, voucher: accountsPayable.voucher, provisionJournal: journal.entryNumber },
      session
    });
    return { request, accountsPayable, journal };
  });
  await resolveNotification(`request:${request._id}:accounting`);
  await notifyRoles({
    roles: ["Treasury"],
    eventKey: `request:${request._id}:treasury`,
    type: "TREASURY_PAYABLE",
    title: "Payable item ready",
    message: `${request.requestNumber} has an open CXP ready for Treasury scheduling.`,
    path: "/treasury",
    entityType: "FinancialRequest",
    entityId: request._id
  });
  return result;
}

export async function generateProvisionEntries(request, userId, options = {}) {
  const ap = await AccountsPayable.findOne({ request: request._id });
  return [await createProvisionJournal(request, ap, userId, options)];
}

export async function generatePaymentEntries(request, userId, options = {}) {
  const ap = await AccountsPayable.findOne({ request: request._id });
  return [await createPaymentJournal(request, ap, userId, options)];
}

export async function generateRenditionEntries(request, userId, options = {}) {
  const ap = await AccountsPayable.findOne({ request: request._id });
  return [await createRenditionJournal(request, ap, userId, options)];
}

export const applyCurrencyConversion = applyExchangeRate;

export async function getConsolidation(period) {
  const eligibleStatuses = [
    REQUEST_STATUS.ACCOUNTED,
    REQUEST_STATUS.SCHEDULED,
    REQUEST_STATUS.BANK_FILE_GENERATED,
    REQUEST_STATUS.PAID,
    REQUEST_STATUS.RENDITION_PENDING,
    REQUEST_STATUS.RECONCILED,
    REQUEST_STATUS.CLOSED
  ];
  const [sourceRows, journalRows, sourceSummary, journalSummary] = await Promise.all([
    FinancialRequest.aggregate([
      { $match: { accountingPeriod: period, status: { $in: eligibleStatuses } } },
      { $unwind: "$lines" },
      { $lookup: { from: "expensetypes", localField: "lines.expenseType", foreignField: "_id", as: "expense" } },
      { $unwind: { path: "$expense", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { costCenter: "$lines.costCenter", expenseType: "$lines.expenseType", accountNumber: "$expense.accountNumber" },
          netAmount: { $sum: { $multiply: ["$lines.netAmount", "$exchangeRate"] } },
          igvAmount: { $sum: { $multiply: ["$lines.igvAmount", "$exchangeRate"] } },
          totalAmount: { $sum: "$lines.penEquivalent" },
          penEquivalent: { $sum: "$lines.penEquivalent" },
          requests: { $addToSet: "$_id" }
        }
      }
    ]),
    JournalEntry.aggregate([
      { $match: { period, status: "POSTED", entryType: { $in: ["PROVISION", "ADVANCE", "RENDITION"] } } },
      { $unwind: "$lines" },
      {
        $group: {
          _id: { costCenter: "$lines.costCenter", expenseType: "$lines.expenseType", accountNumber: "$lines.accountNumber" },
          debit: { $sum: "$lines.debit" },
          credit: { $sum: "$lines.credit" }
        }
      }
    ]),
    JournalEntry.aggregate([
      { $match: { period, status: "POSTED", entryType: { $in: ["PROVISION", "ADVANCE", "RENDITION"] } } },
      { $group: { _id: null, total: { $sum: "$totalDebit" }, requests: { $addToSet: "$request" } } },
      { $project: { total: 1, count: { $size: "$requests" } } }
    ]),
    JournalEntry.aggregate([
      { $match: { period, status: "POSTED", entryType: { $in: ["PROVISION", "ADVANCE", "RENDITION"] } } },
      { $group: { _id: null, totalDebit: { $sum: "$totalDebit" }, totalCredit: { $sum: "$totalCredit" } } }
    ])
  ]);
  const rowMap = new Map();
  const keyOf = (row) => `${row._id.costCenter || ""}|${row._id.expenseType || ""}|${row._id.accountNumber || ""}`;
  for (const row of sourceRows) {
    rowMap.set(keyOf(row), {
      period,
      costCenter: row._id.costCenter,
      expenseType: row._id.expenseType,
      accountNumber: row._id.accountNumber || "",
      currency: "PEN",
      netAmount: roundMoney(row.netAmount),
      igvAmount: roundMoney(row.igvAmount),
      totalAmount: roundMoney(row.totalAmount),
      penEquivalent: roundMoney(row.penEquivalent),
      requestCount: row.requests.length,
      debit: 0,
      credit: 0
    });
  }
  for (const row of journalRows) {
    const key = keyOf(row);
    const current = rowMap.get(key) || {
      period,
      costCenter: row._id.costCenter,
      expenseType: row._id.expenseType,
      accountNumber: row._id.accountNumber || "",
      currency: "PEN",
      netAmount: 0,
      igvAmount: 0,
      totalAmount: 0,
      penEquivalent: 0,
      requestCount: 0,
      debit: 0,
      credit: 0
    };
    current.debit = roundMoney(row.debit);
    current.credit = roundMoney(row.credit);
    rowMap.set(key, current);
  }
  const transactionSourceTotal = roundMoney(sourceSummary[0]?.total || 0);
  const centralizationTotal = roundMoney(journalSummary[0]?.totalDebit || 0);
  return {
    rows: [...rowMap.values()],
    summary: {
      transactionSourceTotal,
      centralizationTotal,
      totalDebit: centralizationTotal,
      totalCredit: roundMoney(journalSummary[0]?.totalCredit || 0),
      difference: subtractMoney(transactionSourceTotal, centralizationTotal),
      requestCount: sourceSummary[0]?.count || 0,
      balanced: moneyEquals(centralizationTotal, journalSummary[0]?.totalCredit || 0)
    }
  };
}
