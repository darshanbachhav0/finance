import mongoose from "mongoose";
import { BANKS, CURRENCY } from "../utils/constants.js";

const paymentItemSchema = new mongoose.Schema(
  {
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable", required: true },
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true },
    requestNumber: { type: String, required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    supplierIdentifier: { type: String, required: true },
    supplierName: { type: String, required: true },
    bankAccount: {
      bank: String,
      currency: String,
      accountNumber: String,
      cci: String,
      validFrom: Date
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCY, required: true },
    status: { type: String, enum: ["INSTRUCTION_CREATED", "CONFIRMED", "REJECTED", "CANCELLED"], default: "INSTRUCTION_CREATED" }
  },
  { _id: true }
);

const paymentBatchSchema = new mongoose.Schema(
  {
    batchNumber: { type: String, required: true, unique: true, immutable: true },
    bank: { type: String, enum: BANKS, required: true },
    currency: { type: String, enum: CURRENCY, required: true },
    paymentDate: { type: Date, required: true },
    items: { type: [paymentItemSchema], required: true },
    totalAmount: { type: Number, required: true, min: 0 },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true, select: false },
    url: { type: String, required: true },
    checksum: { type: String, required: true },
    adapterMode: { type: String, enum: ["DEMO", "CERTIFIED"], default: "DEMO" },
    specificationVersion: { type: String, default: "DEMO-1" },
    status: { type: String, enum: ["GENERATED", "PARTIALLY_CONFIRMED", "CONFIRMED", "CANCELLED"], default: "GENERATED", index: true },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    generatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

paymentBatchSchema.index({ status: 1, paymentDate: 1 });
paymentBatchSchema.index({ bank: 1, currency: 1, generatedAt: -1 });

export default mongoose.model("PaymentBatch", paymentBatchSchema);

