import AccountingEntry from "../models/AccountingEntry.js";
import ExchangeRate from "../models/ExchangeRate.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { AppError } from "../utils/AppError.js";
import { REQUEST_STATUS } from "../utils/constants.js";

function startOfDay(dateValue) {
  const date = new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function resolveExchangeRate(currency, issueDate, period) {
  if (currency === "PEN") return 1;

  const date = startOfDay(issueDate);
  const exact = await ExchangeRate.findOne({ date });
  if (exact) return exact.rate;

  const latestForPeriod = await ExchangeRate.findOne({ period }).sort({ date: -1 });
  if (latestForPeriod) return latestForPeriod.rate;

  throw new AppError(422, `Missing SUNAT selling exchange rate for USD request period ${period}.`);
}

export async function applyCurrencyConversion(request) {
  const rate = await resolveExchangeRate(request.currency, request.issueDate, request.accountingPeriod);
  request.exchangeRate = rate;
  request.lines = request.lines.map((line) => {
    line.penEquivalent = Number((Number(line.totalAmount || 0) * rate).toFixed(2));
    return line;
  });
  const totals = request.lines.reduce(
    (acc, line) => {
      acc.netAmount += Number(line.netAmount || 0);
      acc.igvAmount += Number(line.igvAmount || 0);
      acc.totalAmount += Number(line.totalAmount || 0);
      acc.penEquivalent += Number(line.penEquivalent || 0);
      return acc;
    },
    { netAmount: 0, igvAmount: 0, totalAmount: 0, penEquivalent: 0 }
  );
  request.netAmount = Number(totals.netAmount.toFixed(2));
  request.igvAmount = Number(totals.igvAmount.toFixed(2));
  request.totalAmount = Number(totals.totalAmount.toFixed(2));
  request.penEquivalent = Number(totals.penEquivalent.toFixed(2));
  return request;
}

export async function generateProvisionEntries(request, userId) {
  const existing = await AccountingEntry.findOne({ request: request._id, type: "PROVISION" });
  if (existing) return AccountingEntry.find({ request: request._id, type: "PROVISION" });

  await request.populate("lines.expenseType");
  const entries = request.lines.map((line) => {
    const accountNumber = request.requestType === "Entrega a Rendir" ? "14" : line.expenseType.accountNumber;
    const debitAmount = request.currency === "USD" ? line.penEquivalent : line.totalAmount;
    return {
      request: request._id,
      period: request.accountingPeriod,
      costCenter: line.costCenter,
      expenseType: line.expenseType._id,
      accountNumber,
      description:
        request.requestType === "Entrega a Rendir"
          ? `Transit provision Account 14 for ${request.requestNumber}`
          : `Expense/asset provision for ${request.requestNumber}`,
      debit: Number(debitAmount.toFixed(2)),
      credit: 0,
      currency: request.currency,
      originalAmount: line.totalAmount,
      exchangeRate: request.exchangeRate,
      type: "PROVISION",
      generatedBy: userId
    };
  });

  return AccountingEntry.insertMany(entries);
}

export async function generatePaymentEntries(request, userId) {
  const existing = await AccountingEntry.findOne({ request: request._id, type: "PAYMENT" });
  if (existing) return AccountingEntry.find({ request: request._id, type: "PAYMENT" });

  await request.populate("lines.expenseType");
  const entries = request.lines.map((line) => {
    const amount = request.currency === "USD" ? line.penEquivalent : line.totalAmount;
    return {
      request: request._id,
      period: request.accountingPeriod,
      costCenter: line.costCenter,
      expenseType: line.expenseType._id,
      accountNumber: "10",
      description: `Bank payment for ${request.requestNumber}`,
      debit: 0,
      credit: Number(amount.toFixed(2)),
      currency: request.currency,
      originalAmount: line.totalAmount,
      exchangeRate: request.exchangeRate,
      type: "PAYMENT",
      generatedBy: userId
    };
  });

  return AccountingEntry.insertMany(entries);
}

export async function generateRenditionEntries(request, userId) {
  const existing = await AccountingEntry.findOne({ request: request._id, type: "RENDITION" });
  if (existing) return AccountingEntry.find({ request: request._id, type: "RENDITION" });

  await request.populate("lines.expenseType");
  const entries = request.lines.map((line) => {
    const amount = request.currency === "USD" ? line.penEquivalent : line.totalAmount;
    return {
      request: request._id,
      period: request.accountingPeriod,
      costCenter: line.costCenter,
      expenseType: line.expenseType._id,
      accountNumber: line.expenseType.accountNumber,
      description: `Rendition expense recognition for ${request.requestNumber}`,
      debit: Number(amount.toFixed(2)),
      credit: 0,
      currency: request.currency,
      originalAmount: line.totalAmount,
      exchangeRate: request.exchangeRate,
      type: "RENDITION",
      generatedBy: userId
    };
  });

  return AccountingEntry.insertMany(entries);
}

export async function getConsolidation(period) {
  const pipeline = [
    {
      $match: {
        accountingPeriod: period,
        status: { $in: [REQUEST_STATUS.APPROVED_PAYABLE, REQUEST_STATUS.BANK_PROCESSED, REQUEST_STATUS.RENDITION_PENDING, REQUEST_STATUS.CLOSED] }
      }
    },
    { $unwind: "$lines" },
    {
      $group: {
        _id: {
          period: "$accountingPeriod",
          costCenter: "$lines.costCenter",
          expenseType: "$lines.expenseType",
          currency: "$currency"
        },
        netAmount: { $sum: "$lines.netAmount" },
        igvAmount: { $sum: "$lines.igvAmount" },
        totalAmount: { $sum: "$lines.totalAmount" },
        penEquivalent: { $sum: "$lines.penEquivalent" },
        requestCount: { $addToSet: "$_id" }
      }
    },
    {
      $project: {
        _id: 0,
        period: "$_id.period",
        costCenter: "$_id.costCenter",
        expenseType: "$_id.expenseType",
        currency: "$_id.currency",
        netAmount: { $round: ["$netAmount", 2] },
        igvAmount: { $round: ["$igvAmount", 2] },
        totalAmount: { $round: ["$totalAmount", 2] },
        penEquivalent: { $round: ["$penEquivalent", 2] },
        requestCount: { $size: "$requestCount" }
      }
    }
  ];

  return FinancialRequest.aggregate(pipeline);
}
