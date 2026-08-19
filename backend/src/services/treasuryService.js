import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import GeneratedFile from "../models/GeneratedFile.js";
import PaymentBatch from "../models/PaymentBatch.js";
import Reconciliation from "../models/Reconciliation.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import { getBankFileAdapter } from "../integrations/banks/index.js";
import { createPaymentJournal } from "./accountingService.js";
import { recordAudit } from "./auditService.js";
import { markBudgetPaid } from "./budgetService.js";
import { guardAccountingPeriod } from "./periodService.js";
import { notifyRoles, notifyUser, resolveNotification } from "./notificationService.js";
import {
  listEligibleSupplierPaymentAccounts,
  resolvePaymentDestination,
  usesEmployeeReimbursementDestination
} from "./paymentDestinationService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "./queryService.js";
import { nextPaymentBatchNumber } from "./sequenceService.js";
import { generatedRoot } from "./storageService.js";
import { runFinancialOperation } from "./transactionService.js";
import { transitionRequest } from "./workflowService.js";
import { AppError } from "../utils/AppError.js";
import { AP_STATUS, ERROR_CODES, REQUEST_STATUS, REQUEST_TYPE } from "../utils/constants.js";
import { moneyEquals, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";

const bankFilesDir = path.join(generatedRoot, "bank-files");

function selectedAccountId(accountSelections, requestId) {
  if (Array.isArray(accountSelections)) {
    return accountSelections.find((item) => String(item.requestId) === String(requestId))?.bankAccountId;
  }
  return accountSelections?.[String(requestId)];
}

async function loadPaymentItems(requestIds, bank, currency, accountSelections = {}) {
  const uniqueIds = [...new Set(requestIds.map(String))];
  if (uniqueIds.length !== requestIds.length) throw new AppError(422, "A request cannot be selected twice.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const requests = await FinancialRequest.find({ _id: { $in: uniqueIds } })
    .select("+rendition.reimbursementBankSnapshot.accountHolderName +rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci")
    .populate("supplier");
  if (requests.length !== uniqueIds.length) throw new AppError(404, "One or more selected requests were not found.", undefined, ERROR_CODES.NOT_FOUND);
  const items = [];
  for (const request of requests) {
    if (![REQUEST_STATUS.ACCOUNTED, REQUEST_STATUS.SCHEDULED].includes(request.status)) {
      throw new AppError(409, `${request.requestNumber} is not eligible for scheduling.`, { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
    }
    if (request.currency !== currency) {
      throw new AppError(422, `${request.requestNumber} uses ${request.currency}; one batch can contain only ${currency}.`, undefined, ERROR_CODES.VALIDATION_ERROR);
    }
    const accountsPayable = await AccountsPayable.findOne({ request: request._id });
    if (!accountsPayable || ![AP_STATUS.OPEN, AP_STATUS.SCHEDULED].includes(accountsPayable.status) || accountsPayable.paymentBatch) {
      throw new AppError(409, `${request.requestNumber} CXP is not available for a new payment batch.`, { status: accountsPayable?.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
    }
    const destination = await resolvePaymentDestination({
      request,
      accountsPayable,
      bank,
      currency,
      selectedAccountId: selectedAccountId(accountSelections, request._id)
    });
    items.push({
      request,
      accountsPayable,
      bankAccount: destination.account,
      requestNumber: request.requestNumber,
      supplierIdentifier: request.supplier.normalizedIdentifier || request.supplier.rucDni,
      supplierName: request.supplier.legalName || request.supplier.name,
      amount: accountsPayable.outstandingAmount,
      currency,
      bankAccountSnapshot: destination.snapshot
    });
  }
  return items;
}

async function scheduleLoadedItem(item, paymentDate, user, req, session) {
  const { request, accountsPayable, bankAccountSnapshot } = item;
  await guardAccountingPeriod({
    period: request.accountingPeriod,
    action: "SCHEDULE",
    user,
    req,
    module: "TREASURY",
    entityType: "FinancialRequest",
    entityId: request._id,
    requestId: request._id
  });
  if (request.status === REQUEST_STATUS.ACCOUNTED) {
    accountsPayable.status = AP_STATUS.SCHEDULED;
    accountsPayable.bankAccountSnapshot = bankAccountSnapshot;
    accountsPayable.history.push({ status: AP_STATUS.SCHEDULED, by: user._id, comments: `Scheduled for ${new Date(paymentDate).toISOString().slice(0, 10)}.` });
    await accountsPayable.save({ session });
    await transitionRequest({
      request,
      targetStatus: REQUEST_STATUS.SCHEDULED,
      user,
      req,
      action: "PAYMENT_SCHEDULED",
      comments: `Scheduled for ${new Date(paymentDate).toISOString().slice(0, 10)}.`,
      session
    });
    await recordAudit({
      entityType: "AccountsPayable",
      entity: accountsPayable,
      requestId: request._id,
      action: "PAYMENT_DESTINATION_SELECTED",
      user,
      req,
      module: "TREASURY",
      newValues: {
        sourceType: bankAccountSnapshot.sourceType,
        bankAccountId: bankAccountSnapshot.bankAccountId || bankAccountSnapshot.employeeBankAccountId,
        bank: bankAccountSnapshot.bank,
        currency: bankAccountSnapshot.currency,
        accountType: bankAccountSnapshot.accountType,
        accountLast4: String(bankAccountSnapshot.accountNumber || bankAccountSnapshot.cci || "").slice(-4)
      },
      session
    });
  }
}

async function countMissingPaymentDestinations(query, bank) {
  const accountChecks = [
    { $eq: ["$supplier", "$$supplierId"] },
    { $eq: ["$currency", "$$currency"] },
    { $eq: ["$active", true] },
    { $eq: ["$accountType", "CURRENT"] },
    {
      $or: [
        { $and: [{ $eq: ["$verificationStatus", "VERIFIED"] }, { $in: ["$ownershipResult", ["MATCH", "MANUAL_ACCEPTED"]] }] },
        { $and: [{ $eq: ["$verificationStatus", "LEGACY_ACCEPTED"] }, { $ne: ["$ownershipResult", "MISMATCH"] }] }
      ]
    }
  ];
  const employeeChecks = [
    { $in: ["$requestDoc.requestType", [REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO]] },
    { $ne: [{ $ifNull: ["$requestDoc.rendition.reimbursementBankSnapshot.profile", null] }, null] },
    { $eq: ["$requestDoc.rendition.reimbursementBankSnapshot.verificationStatus", "VERIFIED"] },
    { $eq: ["$requestDoc.rendition.reimbursementBankSnapshot.currency", "$currency"] }
  ];
  if (bank) {
    accountChecks.push({ $eq: ["$bank", bank] });
    employeeChecks.push({ $eq: ["$requestDoc.rendition.reimbursementBankSnapshot.bank", bank] });
  }
  const [result] = await AccountsPayable.aggregate([
    { $match: query },
    { $lookup: { from: FinancialRequest.collection.name, localField: "request", foreignField: "_id", as: "requestRows" } },
    { $set: { requestDoc: { $arrayElemAt: ["$requestRows", 0] } } },
    {
      $lookup: {
        from: SupplierBankAccount.collection.name,
        let: { supplierId: "$supplier", currency: "$currency" },
        pipeline: [{ $match: { $expr: { $and: accountChecks } } }],
        as: "eligibleAccounts"
      }
    },
    {
      $match: {
        $expr: {
          $and: [
            { $eq: [{ $ifNull: ["$bankAccountSnapshot.bank", null] }, null] },
            { $eq: [{ $and: employeeChecks }, false] },
            { $eq: [{ $size: "$eligibleAccounts" }, 0] }
          ]
        }
      }
    },
    { $count: "count" }
  ]);
  return result?.count || 0;
}

export async function listTreasuryQueue(queryParams) {
  const query = { status: { $in: [AP_STATUS.OPEN, AP_STATUS.SCHEDULED] } };
  if (queryParams.status) query.status = queryParams.status;
  if (queryParams.currency) query.currency = queryParams.currency;
  if (queryParams.supplier) query.supplier = queryParams.supplier;
  if (queryParams.bank) {
    const normalizedBank = String(queryParams.bank).toUpperCase();
    const supplierIds = await SupplierBankAccount.distinct("supplier", {
      bank: normalizedBank,
      active: true,
      accountType: "CURRENT",
      $or: [
        { verificationStatus: "VERIFIED", ownershipResult: { $in: ["MATCH", "MANUAL_ACCEPTED"] } },
        { verificationStatus: "LEGACY_ACCEPTED", ownershipResult: { $ne: "MISMATCH" } }
      ]
    });
    const employeeRequestIds = await FinancialRequest.distinct("_id", {
      requestType: { $in: [REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO] },
      "rendition.reimbursementBankSnapshot.bank": normalizedBank
    });
    query.$and = [...(query.$and || []), { $or: [
      { supplier: { $in: supplierIds } },
      { "bankAccountSnapshot.bank": normalizedBank },
      { request: { $in: employeeRequestIds } }
    ] }];
  }
  if (queryParams.costCenter) {
    const requestIds = await FinancialRequest.distinct("_id", { "lines.costCenter": queryParams.costCenter });
    query.request = { $in: requestIds };
  }
  if (queryParams.requestType) {
    const requestIds = await FinancialRequest.distinct("_id", { requestType: queryParams.requestType });
    const currentIds = query.request?.$in;
    query.request = { $in: currentIds ? requestIds.filter((id) => currentIds.some((current) => String(current) === String(id))) : requestIds };
  }
  if (queryParams.paymentDate) {
    const start = new Date(`${queryParams.paymentDate}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    query.dueDate = { $gte: start, $lt: end };
  }
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    const [supplierIds, requestIds] = await Promise.all([
      Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { rucDni: search }, { normalizedIdentifier: search }] }),
      FinancialRequest.distinct("_id", { $or: [{ requestNumber: search }, { "lines.costCenterSnapshot.code": search }] })
    ]);
    query.$and = [...(query.$and || []), { $or: [
      { supplierIdentifierSnapshot: search },
      { "voucher.series": search },
      { "voucher.number": search },
      { supplier: { $in: supplierIds } },
      { request: { $in: requestIds } }
    ] }];
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["dueDate", "outstandingAmount", "currency", "createdAt", "status"], { dueDate: 1, createdAt: 1 });
  const [records, total, totalsByCurrency, missingBankDetails] = await Promise.all([
    AccountsPayable.find(query)
      .populate({
        path: "request",
        select: "+rendition.reimbursementBankSnapshot.accountHolderName +rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci",
        populate: [{ path: "lines.costCenter" }, { path: "lines.expenseType" }, { path: "requester", select: "name area" }]
      })
      .populate("supplier")
      .sort(sort).skip(skip).limit(pageSize),
    AccountsPayable.countDocuments(query),
    AccountsPayable.aggregate([{ $match: query }, { $group: { _id: "$currency", total: { $sum: "$outstandingAmount" }, count: { $sum: 1 } } }]),
    countMissingPaymentDestinations(query, queryParams.bank ? String(queryParams.bank).toUpperCase() : undefined)
  ]);
  const data = await Promise.all(records.map(async (accountsPayable) => {
    const object = accountsPayable.toObject();
    const request = object.request;
    const frozen = object.bankAccountSnapshot?.bank ? object.bankAccountSnapshot : null;
    if (usesEmployeeReimbursementDestination(request)) {
      const source = request.rendition.reimbursementBankSnapshot;
      const paymentDestination = frozen || {
        sourceType: "EMPLOYEE_REIMBURSEMENT",
        employeeBankAccountId: source.profile,
        bank: source.bank,
        currency: source.currency,
        accountType: "CURRENT",
        accountHolderName: source.accountHolderName,
        accountNumber: source.accountNumber,
        cci: source.cci,
        verificationStatus: source.verificationStatus,
        capturedAt: source.capturedAt
      };
      return { ...request, accountsPayable: object, supplier: object.supplier, activeBankAccounts: [], eligibleBankAccounts: [], paymentDestination, destinationLocked: true };
    }
    const accounts = await listEligibleSupplierPaymentAccounts({ supplierId: accountsPayable.supplier._id, currency: object.currency });
    return {
      ...request,
      accountsPayable: object,
      supplier: object.supplier,
      activeBankAccounts: accounts,
      eligibleBankAccounts: accounts,
      paymentDestination: frozen,
      destinationLocked: Boolean(frozen && object.status === AP_STATUS.SCHEDULED)
    };
  }));
  return {
    ...paginatedPayload(data, total, page, pageSize),
    summary: {
      totalsByCurrency: Object.fromEntries(totalsByCurrency.map((item) => [item._id, { total: item.total, count: item.count }])),
      missingBankDetails
    }
  };
}

export async function getEligiblePaymentDestinations({ requestId, bank, currency }) {
  const request = await FinancialRequest.findById(requestId)
    .select("+rendition.reimbursementBankSnapshot.accountHolderName +rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci")
    .populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  const accountsPayable = await AccountsPayable.findOne({ request: request._id });
  if (!accountsPayable) throw new AppError(404, "Accounts Payable record not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (accountsPayable.status === AP_STATUS.SCHEDULED && accountsPayable.bankAccountSnapshot?.bank) {
    return { sourceType: accountsPayable.bankAccountSnapshot.sourceType || "SUPPLIER", locked: true, selected: accountsPayable.bankAccountSnapshot, accounts: [accountsPayable.bankAccountSnapshot] };
  }
  if (usesEmployeeReimbursementDestination(request)) {
    const source = request.rendition.reimbursementBankSnapshot;
    const selected = {
      sourceType: "EMPLOYEE_REIMBURSEMENT",
      employeeBankAccountId: source.profile,
      bank: source.bank,
      currency: source.currency,
      accountType: "CURRENT",
      accountHolderName: source.accountHolderName,
      accountNumber: source.accountNumber,
      cci: source.cci,
      verificationStatus: source.verificationStatus,
      capturedAt: source.capturedAt
    };
    return { sourceType: selected.sourceType, locked: true, selected, accounts: [selected] };
  }
  const accounts = await listEligibleSupplierPaymentAccounts({ supplierId: request.supplier._id, bank, currency: currency || request.currency });
  return { sourceType: "SUPPLIER", locked: false, selected: accounts[0] || null, accounts };
}

export async function schedulePayments({ requestIds, bank, currency, paymentDate, accountSelections, user, req }) {
  if (!Array.isArray(requestIds) || !requestIds.length) throw new AppError(422, "Select at least one payable request.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (!paymentDate) throw new AppError(422, "A payment date is required.", { field: "paymentDate" }, ERROR_CODES.VALIDATION_ERROR);
  const normalizedBank = String(bank || "").toUpperCase();
  const items = await loadPaymentItems(requestIds, normalizedBank, currency, accountSelections);
  await runFinancialOperation(async (session) => {
    for (const item of items) await scheduleLoadedItem(item, paymentDate, user, req, session);
  });
  return items.map((item) => item.request);
}

export async function generatePaymentBatch({ requestIds, bank, currency, paymentDate, accountSelections, user, req }) {
  if (!Array.isArray(requestIds) || !requestIds.length) throw new AppError(422, "Select at least one payable request.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (!paymentDate) throw new AppError(422, "A payment date is required.", { field: "paymentDate" }, ERROR_CODES.VALIDATION_ERROR);
  const normalizedBank = String(bank || "").trim().toUpperCase();
  const adapter = getBankFileAdapter(normalizedBank);
  const items = await loadPaymentItems(requestIds, normalizedBank, currency, accountSelections);
  adapter.validateBatch(items.map((item) => ({ ...item, bankAccount: item.bankAccountSnapshot })));
  const batchNumber = await nextPaymentBatchNumber(paymentDate);
  const adapterItems = items.map((item) => ({ ...item, bankAccount: item.bankAccountSnapshot }));
  const content = adapter.generateFile({ batchNumber, paymentDate, currency, items: adapterItems });
  const fileName = adapter.getFileName(batchNumber);
  const checksum = crypto.createHash("sha256").update(content).digest("hex");
  await fs.mkdir(bankFilesDir, { recursive: true });
  const filePath = path.join(bankFilesDir, fileName);
  await fs.writeFile(filePath, content, "utf8");

  try {
    const result = await runFinancialOperation(async (session) => {
      for (const item of items) await scheduleLoadedItem(item, paymentDate, user, req, session);
      const [batch] = await PaymentBatch.create([{
        batchNumber,
        bank: normalizedBank,
        currency,
        paymentDate,
        items: items.map((item) => ({
          accountsPayable: item.accountsPayable._id,
          request: item.request._id,
          requestNumber: item.requestNumber,
          supplier: item.request.supplier._id,
          supplierIdentifier: item.supplierIdentifier,
          supplierName: item.supplierName,
          bankAccount: item.bankAccountSnapshot,
          amount: item.amount,
          currency
        })),
        totalAmount: sumMoney(items.map((item) => item.amount)),
        fileName,
        filePath,
        url: `/generated/bank-files/${fileName}`,
        checksum,
        adapterMode: adapter.mode,
        specificationVersion: adapter.specificationVersion,
        status: "GENERATED",
        generatedBy: user._id,
        generatedAt: new Date()
      }], session ? { session } : undefined);

      for (const item of items) {
        item.accountsPayable.status = AP_STATUS.PAYMENT_FILE_CREATED;
        item.accountsPayable.paymentBatch = batch._id;
        item.accountsPayable.bankAccountSnapshot = item.bankAccountSnapshot;
        item.accountsPayable.history.push({ status: AP_STATUS.PAYMENT_FILE_CREATED, by: user._id, comments: `Included in demo batch ${batchNumber}. Payment is not yet confirmed.` });
        await item.accountsPayable.save({ session });
        item.request.paymentBatch = batch._id;
        item.request.bankFile = { bank: normalizedBank, fileName, url: batch.url, generatedAt: new Date(), generatedBy: user._id };
        await transitionRequest({
          request: item.request,
          targetStatus: REQUEST_STATUS.BANK_FILE_GENERATED,
          user,
          req,
          action: "BANK_FILE_GENERATED",
          comments: `Payment instruction included in ${batchNumber}. Payment has not been confirmed.`,
          session
        });
      }
      await GeneratedFile.create([{
        kind: "BANK_TXT",
        fileName,
        url: `/generated/bank-files/${fileName}`,
        requestIds: items.map((item) => item.request._id),
        requestNumbers: items.map((item) => item.requestNumber),
        totals: [{ currency, total: sumMoney(items.map((item) => item.amount)), count: items.length }],
        rowCount: items.length,
        generatedBy: user._id,
        metadata: {
          batchNumber,
          bank: normalizedBank,
          paymentDate,
          adapterMode: adapter.mode,
          specificationVersion: adapter.specificationVersion,
          certified: false,
          paymentConfirmed: false,
          paymentEntriesCreated: false,
          notice: "DEMO / NOT CERTIFIED. TXT generation creates instructions only."
        }
      }], session ? { session } : undefined);
      await recordAudit({
        entityType: "PaymentBatch",
        entity: batch,
        action: "GENERATED_DEMO_BANK_FILE",
        user,
        req,
        module: "TREASURY",
        message: "Demo bank file generated; no payment settlement was posted.",
        newValues: { batchNumber, bank: normalizedBank, currency, totalAmount: batch.totalAmount, itemCount: items.length, adapterMode: adapter.mode },
        session
      });
      return { batch, content };
    });
    for (const item of items) {
      await resolveNotification(`request:${item.request._id}:treasury`);
      await notifyRoles({
        roles: ["Treasury"],
        eventKey: `request:${item.request._id}:payment-confirmation`,
        type: "PAYMENT_CONFIRMATION",
        title: "Payment confirmation required",
        message: `${item.requestNumber} is in ${batchNumber}; confirm it only after bank execution.`,
        path: "/treasury",
        entityType: "FinancialRequest",
        entityId: item.request._id
      });
    }
    return result;
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function confirmTreasuryPayment({ requestId, payload, user, req }) {
  const operationNumber = String(payload.operationNumber || "").trim();
  if (!operationNumber || !payload.paidAt || payload.confirmedAmount === undefined) {
    throw new AppError(422, "Operation number, actual payment date, and confirmed amount are required.", { required: ["operationNumber", "paidAt", "confirmedAmount"] }, ERROR_CODES.VALIDATION_ERROR);
  }
  const request = await FinancialRequest.findById(requestId).populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (request.status !== REQUEST_STATUS.BANK_FILE_GENERATED) {
    throw new AppError(409, "Payment can only be confirmed after bank-file generation.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const accountsPayable = await AccountsPayable.findOne({ request: request._id });
  if (!accountsPayable || accountsPayable.status !== AP_STATUS.PAYMENT_FILE_CREATED) {
    throw new AppError(409, "The CXP is not awaiting payment confirmation.", { status: accountsPayable?.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const confirmedAmount = roundMoney(payload.confirmedAmount);
  if (!moneyEquals(confirmedAmount, accountsPayable.outstandingAmount)) {
    throw new AppError(422, "Confirmed amount must equal the outstanding CXP amount.", { confirmedAmount, outstandingAmount: accountsPayable.outstandingAmount }, ERROR_CODES.VALIDATION_ERROR);
  }
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "CONFIRM_PAYMENT", user, req, module: "TREASURY", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });

  const result = await runFinancialOperation(async (session) => {
    request.payment = {
      operationNumber,
      paidAt: payload.paidAt,
      confirmedAmount,
      comments: payload.comments,
      confirmedAt: new Date(),
      confirmedBy: user._id
    };
    const paymentJournal = await createPaymentJournal(request, accountsPayable, user._id, {
      bank: accountsPayable.bankAccountSnapshot?.bank || request.bankFile?.bank,
      session
    });
    accountsPayable.status = AP_STATUS.PAID;
    accountsPayable.outstandingAmount = 0;
    accountsPayable.paidDate = payload.paidAt;
    accountsPayable.paymentJournal = paymentJournal._id;
    accountsPayable.history.push({ status: AP_STATUS.PAID, by: user._id, comments: `Payment confirmed: ${operationNumber}.` });
    await accountsPayable.save({ session });
    const batch = await PaymentBatch.findById(accountsPayable.paymentBatch).session(session || null);
    if (batch) {
      const item = batch.items.find((value) => String(value.accountsPayable) === String(accountsPayable._id));
      if (item) item.status = "CONFIRMED";
      const confirmed = batch.items.filter((value) => value.status === "CONFIRMED").length;
      batch.status = confirmed === batch.items.length ? "CONFIRMED" : "PARTIALLY_CONFIRMED";
      await batch.save({ session });
    }
    await markBudgetPaid(request, user._id, { session });
    await transitionRequest({
      request,
      targetStatus: REQUEST_STATUS.PAID,
      user,
      req,
      action: "PAYMENT_CONFIRMED",
      comments: payload.comments || `Bank payment confirmed with operation ${operationNumber}.`,
      session
    });
    if (request.requestType === REQUEST_TYPE.ENTREGA_RENDIR) {
      request.rendition.status = "PENDING";
      request.rendition.amountAdvanced = confirmedAmount;
      request.rendition.balanceOutstanding = confirmedAmount;
      await transitionRequest({
        request,
        targetStatus: REQUEST_STATUS.RENDITION_PENDING,
        user,
        req,
        action: "RENDITION_REQUIRED",
        comments: "Advance paid; supporting rendition is now required.",
        session
      });
    }
    await recordAudit({
      entityType: "AccountsPayable",
      entity: accountsPayable,
      requestId: request._id,
      action: "PAYMENT_CONFIRMED",
      user,
      req,
      module: "TREASURY",
      newValues: { operationNumber, paidAt: payload.paidAt, confirmedAmount, paymentJournal: paymentJournal.entryNumber },
      session
    });
    return { request, accountsPayable, paymentJournal, batch };
  });
  await resolveNotification(`request:${request._id}:payment-confirmation`);
  if (request.requestType === REQUEST_TYPE.ENTREGA_RENDIR) {
    await notifyUser({
      userId: request.requester || request.solicitor,
      eventKey: `request:${request._id}:rendition`,
      type: "RENDITION_PENDING",
      title: "Rendition pending",
      message: `${request.requestNumber} was paid and now requires rendition evidence.`,
      path: `/requests/${request._id}`,
      entityType: "FinancialRequest",
      entityId: request._id
    });
  } else {
    await notifyUser({
      userId: request.requester || request.solicitor,
      eventKey: `request:${request._id}:paid`,
      type: "PAYMENT_CONFIRMED",
      title: "Payment confirmed",
      message: `${request.requestNumber} was paid with operation ${operationNumber}.`,
      path: `/requests/${request._id}`,
      entityType: "FinancialRequest",
      entityId: request._id
    });
  }
  return result;
}

export async function reconcilePayment({ requestId, payload, user, req }) {
  const request = await FinancialRequest.findById(requestId);
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (![REQUEST_STATUS.PAID, REQUEST_STATUS.RENDITION_PENDING].includes(request.status)) {
    throw new AppError(409, "Only paid requests can be reconciled.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (request.status === REQUEST_STATUS.RENDITION_PENDING && request.rendition?.status !== "VALIDATED") {
    throw new AppError(422, "The rendition must be validated before reconciliation.", undefined, ERROR_CODES.RENDITION_REQUIRED);
  }
  const accountsPayable = await AccountsPayable.findOne({ request: request._id });
  const bankReference = String(payload.bankReference || "").trim();
  if (!bankReference || payload.statementAmount === undefined) {
    throw new AppError(422, "Bank reference and statement amount are required.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  const paidAmount = roundMoney(request.payment?.confirmedAmount);
  const statementAmount = roundMoney(payload.statementAmount);
  const difference = subtractMoney(statementAmount, paidAmount);
  if (!moneyEquals(difference, 0)) {
    throw new AppError(422, "Bank reconciliation difference must be zero.", { statementAmount, paidAmount, difference }, ERROR_CODES.VALIDATION_ERROR);
  }
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "RECONCILE", user, req, module: "TREASURY", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  const result = await runFinancialOperation(async (session) => {
    let reconciliation = await Reconciliation.findOne({ request: request._id }).session(session || null);
    if (!reconciliation) {
      [reconciliation] = await Reconciliation.create([{
        request: request._id,
        accountsPayable: accountsPayable._id,
        reconciledBy: user._id,
        reconciledAt: new Date(),
        bankReference,
        statementAmount,
        paidAmount,
        difference,
        comments: payload.comments
      }], session ? { session } : undefined);
    }
    request.reconciliation = reconciliation._id;
    request.payment.reconciliationComments = payload.comments;
    await transitionRequest({
      request,
      targetStatus: REQUEST_STATUS.RECONCILED,
      user,
      req,
      action: "RECONCILED",
      comments: payload.comments || `Reconciled with bank reference ${bankReference}.`,
      session
    });
    await recordAudit({ entityType: "Reconciliation", entity: reconciliation, requestId: request._id, action: "RECONCILED", user, req, module: "TREASURY", newValues: { bankReference, statementAmount, paidAmount, difference }, session });
    return { request, reconciliation };
  });
  await notifyRoles({
    roles: ["Accounting"],
    eventKey: `request:${request._id}:close`,
    type: "ACCOUNTING_CLOSE",
    title: "Request ready to close",
    message: `${request.requestNumber} is reconciled and ready for Accounting closure.`,
    path: `/requests/${request._id}`,
    entityType: "FinancialRequest",
    entityId: request._id
  });
  return result;
}

export async function listPaymentBatches(queryParams = {}) {
  const query = {};
  if (queryParams.bank) query.bank = String(queryParams.bank).toUpperCase();
  if (queryParams.currency) query.currency = queryParams.currency;
  if (queryParams.status) query.status = queryParams.status;
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    query.$or = [{ batchNumber: search }, { fileName: search }, { "items.requestNumber": search }, { "items.supplierName": search }];
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["batchNumber", "fileName", "bank", "currency", "totalAmount", "status", "generatedAt"], { generatedAt: -1 });
  const [data, total] = await Promise.all([
    PaymentBatch.find(query).populate("generatedBy", "name email role").sort(sort).skip(skip).limit(pageSize),
    PaymentBatch.countDocuments(query)
  ]);
  return paginatedPayload(data, total, page, pageSize);
}

export async function listPaymentConfirmationQueue(queryParams = {}) {
  const { page, pageSize, skip } = parsePagination(queryParams);
  const query = { status: AP_STATUS.PAYMENT_FILE_CREATED };
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    const [supplierIds, requestIds, batchIds] = await Promise.all([
      Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { rucDni: search }] }),
      FinancialRequest.distinct("_id", { requestNumber: search }),
      PaymentBatch.distinct("_id", { batchNumber: search })
    ]);
    query.$or = [
      { supplierIdentifierSnapshot: search },
      { supplier: { $in: supplierIds } },
      { request: { $in: requestIds } },
      { paymentBatch: { $in: batchIds } }
    ];
  }
  const sort = parseSort(queryParams, ["outstandingAmount", "dueDate", "updatedAt"], { updatedAt: 1 });
  const [records, total] = await Promise.all([
    AccountsPayable.find(query)
      .populate({ path: "request", populate: { path: "supplier" } })
      .populate("paymentBatch", "batchNumber bank currency paymentDate status")
      .sort(sort).skip(skip).limit(pageSize),
    AccountsPayable.countDocuments(query)
  ]);
  return paginatedPayload(records.map((ap) => ({ ...ap.request.toObject(), accountsPayable: ap.toObject() })), total, page, pageSize);
}

export async function listReconciliationQueue(queryParams = {}) {
  const query = {
    $or: [
      { status: REQUEST_STATUS.PAID },
      { status: REQUEST_STATUS.RENDITION_PENDING, "rendition.status": "VALIDATED" }
    ]
  };
  if (queryParams.currency) query.currency = queryParams.currency;
  if (queryParams.accountingPeriod) query.accountingPeriod = queryParams.accountingPeriod;
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    query.$and = [{ $or: [{ requestNumber: search }, { description: search }] }];
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["requestNumber", "currency", "status", "payment.operationNumber", "payment.paidAt", "payment.confirmedAmount", "updatedAt"], { "payment.paidAt": 1, updatedAt: 1 });
  const [requests, total] = await Promise.all([
    FinancialRequest.find(query)
      .populate("supplier", "name legalName rucDni normalizedIdentifier")
      .populate("requester solicitor", "name email area")
      .populate("paymentBatch", "batchNumber bank currency paymentDate status")
      .sort(sort)
      .skip(skip).limit(pageSize),
    FinancialRequest.countDocuments(query)
  ]);
  const payableRecords = await AccountsPayable.find({ request: { $in: requests.map((request) => request._id) } });
  const payableByRequest = new Map(payableRecords.map((item) => [String(item.request), item.toObject()]));
  return paginatedPayload(requests.map((request) => ({ ...request.toObject(), accountsPayable: payableByRequest.get(String(request._id)) })), total, page, pageSize);
}
