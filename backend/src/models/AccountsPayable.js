import mongoose from "mongoose";
import { AP_STATUS, CURRENCY } from "../utils/constants.js";

const accountsPayableSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, unique: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    supplierIdentifierSnapshot: { type: String, required: true },
    voucher: {
      voucherType: String,
      documentType: String,
      series: String,
      number: String,
      documentDate: Date
    },
    originalAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCY, required: true },
    exchangeRate: { type: Number, required: true, min: 0 },
    penEquivalent: { type: Number, required: true, min: 0 },
    outstandingAmount: { type: Number, required: true, min: 0 },
    dueDate: Date,
    status: { type: String, enum: Object.values(AP_STATUS), default: AP_STATUS.OPEN, index: true },
    provisionJournal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
    paymentJournal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
    paymentBatch: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentBatch" },
    bankAccountSnapshot: {
      bankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierBankAccount" },
      bank: String,
      currency: String,
      accountNumber: String,
      cci: String,
      validFrom: Date
    },
    paidDate: Date,
    history: [{ status: String, at: { type: Date, default: Date.now }, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, comments: String }]
  },
  { timestamps: true }
);

accountsPayableSchema.index({ status: 1, dueDate: 1 });
accountsPayableSchema.index({ supplier: 1, status: 1 });
accountsPayableSchema.index(
  {
    supplierIdentifierSnapshot: 1,
    "voucher.voucherType": 1,
    "voucher.series": 1,
    "voucher.number": 1
  },
  {
    unique: true,
    partialFilterExpression: {
      supplierIdentifierSnapshot: { $type: "string" },
      "voucher.voucherType": { $type: "string" },
      "voucher.series": { $type: "string" },
      "voucher.number": { $type: "string" }
    },
    name: "accounts_payable_voucher_unique"
  }
);

export default mongoose.model("AccountsPayable", accountsPayableSchema);
