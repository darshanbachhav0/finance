import mongoose from "mongoose";
import { CURRENCY } from "../utils/constants.js";

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: { type: String, required: true, unique: true, immutable: true },
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, unique: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCY, required: true },
    issueDate: { type: Date, required: true, default: Date.now },
    status: { type: String, enum: ["DRAFT", "ISSUED", "CANCELLED"], default: "ISSUED" },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fileName: String,
    url: String
  },
  { timestamps: true }
);

export default mongoose.model("PurchaseOrder", purchaseOrderSchema);

