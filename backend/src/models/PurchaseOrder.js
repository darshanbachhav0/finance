import mongoose from "mongoose";
import { CURRENCY, PROCUREMENT_ORDER_KINDS } from "../utils/constants.js";

const orderLineSchema = new mongoose.Schema(
  {
    itemDescription: String,
    quantity: Number,
    unitOfMeasure: String,
    unitPrice: Number,
    total: Number,
    costCenterCode: String,
    expenseAccount: String
  },
  { _id: false }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: { type: String, required: true, unique: true, immutable: true },
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, unique: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    orderKind: { type: String, enum: PROCUREMENT_ORDER_KINDS },
    supplierCodeSnapshot: { type: String, trim: true },
    supplierSnapshot: {
      identifier: String,
      legalName: String
    },
    lines: { type: [orderLineSchema], default: [] },
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
