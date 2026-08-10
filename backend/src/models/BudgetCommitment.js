import mongoose from "mongoose";

const commitmentLineSchema = new mongoose.Schema(
  {
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter", required: true },
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType", required: true },
    project: String,
    amount: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: ["TRANSITIONAL", "ACTIVE"], required: true }
  },
  { _id: false }
);

const budgetCommitmentSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, unique: true },
    requestNumber: { type: String, required: true },
    period: { type: String, required: true },
    lines: [commitmentLineSchema],
    totalAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["RESERVED", "WITHOUT_BUDGET", "EXECUTED", "RELEASED"], required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    executedAt: Date,
    executedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    releasedAt: Date,
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    releaseReason: String
  },
  { timestamps: true }
);

budgetCommitmentSchema.index({ status: 1, period: 1 });

export default mongoose.model("BudgetCommitment", budgetCommitmentSchema);
