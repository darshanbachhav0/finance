import mongoose from "mongoose";

const accountingPeriodSchema = new mongoose.Schema(
  {
    period: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN" },
    closingDate: Date,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

const AccountingPeriod = mongoose.model("AccountingPeriod", accountingPeriodSchema);
export default AccountingPeriod;
