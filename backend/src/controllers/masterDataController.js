import AccountingPeriod from "../models/AccountingPeriod.js";
import CostCenter from "../models/CostCenter.js";
import ExchangeRate from "../models/ExchangeRate.js";
import ExpenseType from "../models/ExpenseType.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { fetchLatestUsdPenSellingRate } from "../services/exchangeRateProvider.js";
import { AppError } from "../utils/AppError.js";

function crud(Model, label, sort = { createdAt: -1 }) {
  return {
    list: asyncHandler(async (_req, res) => {
      const data = await Model.find().sort(sort);
      res.json({ data });
    }),
    create: asyncHandler(async (req, res) => {
      const data = await Model.create(req.body);
      res.status(201).json({ data });
    }),
    update: asyncHandler(async (req, res) => {
      const data = await Model.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true
      });
      if (!data) throw new AppError(404, `${label} not found.`);
      res.json({ data });
    }),
    remove: asyncHandler(async (req, res) => {
      const data = await Model.findByIdAndDelete(req.params.id);
      if (!data) throw new AppError(404, `${label} not found.`);
      res.json({ data });
    })
  };
}

export const costCenters = crud(CostCenter, "Cost center", { code: 1 });
export const expenseTypes = crud(ExpenseType, "Expense type", { code: 1 });
export const exchangeRates = {
  ...crud(ExchangeRate, "Exchange rate", { date: -1 }),
  current: asyncHandler(async (_req, res) => {
    const data = await fetchLatestUsdPenSellingRate();
    res.json({ data });
  })
};

export const accountingPeriods = {
  list: asyncHandler(async (_req, res) => {
    const data = await AccountingPeriod.find().populate("closedBy", "name email role").sort({ period: -1 });
    res.json({ data });
  }),
  create: asyncHandler(async (req, res) => {
    const data = await AccountingPeriod.create(req.body);
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => {
    const payload = { ...req.body };
    if (payload.status === "CLOSED") {
      payload.closingDate = payload.closingDate || new Date();
      payload.closedBy = req.user._id;
    }
    if (payload.status === "OPEN") {
      payload.closedBy = null;
      payload.closingDate = null;
    }

    const data = await AccountingPeriod.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true
    }).populate("closedBy", "name email role");
    if (!data) throw new AppError(404, "Accounting period not found.");
    res.json({ data });
  }),
  remove: asyncHandler(async (req, res) => {
    const data = await AccountingPeriod.findByIdAndDelete(req.params.id);
    if (!data) throw new AppError(404, "Accounting period not found.");
    res.json({ data });
  })
};
