import mongoose from "mongoose";
import { BANKS, CURRENCY } from "../utils/constants.js";

const supplierBankAccountSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    bank: { type: String, enum: BANKS, required: true },
    currency: { type: String, enum: CURRENCY, required: true, default: "PEN" },
    accountNumber: { type: String, required: true, trim: true },
    cci: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true },
    validFrom: { type: Date, default: Date.now },
    validTo: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    legacyImported: { type: Boolean, default: false }
  },
  { timestamps: true }
);

supplierBankAccountSchema.index({ supplier: 1, active: 1 });
supplierBankAccountSchema.index({ accountNumber: 1 });
supplierBankAccountSchema.index({ cci: 1 }, { sparse: true });

export default mongoose.model("SupplierBankAccount", supplierBankAccountSchema);

