import AccountingPeriod from "../models/AccountingPeriod.js";
import { AppError } from "../utils/AppError.js";
import { CLOSED_PERIOD_MESSAGE } from "../utils/constants.js";

export async function ensurePeriodOpen(period) {
  const accountingPeriod = await AccountingPeriod.findOne({ period });
  if (accountingPeriod?.status === "CLOSED") {
    throw new AppError(423, CLOSED_PERIOD_MESSAGE);
  }
  return accountingPeriod;
}

export function periodFromDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
