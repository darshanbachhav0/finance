import mongoose from "mongoose";

const expenseTypeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["OPEX", "CAPEX", "Non-deductible"],
      required: true
    },
    accountingClass: {
      type: String,
      enum: ["Class 6", "Class 3", "Account 99"],
      required: true
    },
    accountNumber: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const ExpenseType = mongoose.model("ExpenseType", expenseTypeSchema);
export default ExpenseType;
