import mongoose from "mongoose";
import { CURRENCY } from "../utils/constants.js";

const bankHistorySchema = new mongoose.Schema(
  {
    bankName: String,
    currency: { type: String, enum: CURRENCY, default: "PEN" },
    bankAccount: String,
    cci: String,
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "INACTIVE" },
    validFrom: { type: Date, default: Date.now },
    validTo: Date,
    changedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { _id: true }
);

const supplierDocumentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["RUC_FILE", "BANK_CERTIFICATE", "LEGAL_REP_ID"], required: true },
    originalName: String,
    filename: String,
    path: { type: String, select: false },
    url: String,
    mimetype: String,
    size: Number,
    checksum: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const supplierSchema = new mongoose.Schema(
  {
    identifierType: { type: String, enum: ["RUC", "DNI"], required: true, default: "RUC" },
    rucDni: { type: String, required: true, unique: true, trim: true },
    normalizedIdentifier: { type: String, unique: true, sparse: true, trim: true },
    legalName: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    taxAddress: { type: String, trim: true },
    fiscalAddress: { type: String, trim: true },
    legalRepresentative: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    contactName: { type: String, trim: true },
    supplierType: { type: String, trim: true, default: "General" },
    currency: { type: String, enum: CURRENCY, default: "PEN" },
    bankName: { type: String, trim: true },
    bankAccount: { type: String, trim: true },
    cci: { type: String, trim: true },
    taxpayerStatus: { type: String, enum: ["PENDING", "ACTIVE", "INACTIVE", "NOT_CONFIGURED", "MANUALLY_VALIDATED"], default: "PENDING" },
    complianceStatus: { type: String, enum: ["PENDING", "COMPLIANT", "NON_COMPLIANT", "OBSERVED"], default: "PENDING" },
    homologationStatus: { type: String, enum: ["PENDING_VALIDATION", "HOMOLOGATED", "OBSERVED", "INACTIVE"], default: "PENDING_VALIDATION", index: true },
    active: { type: Boolean, default: false },
    status: { type: String, enum: ["PENDING_VALIDATION", "ACTIVE", "OBSERVED", "INACTIVE"], default: "PENDING_VALIDATION" },
    compliance: {
      taxpayerActive: { type: Boolean, default: false },
      compliant: { type: Boolean, default: false },
      validatedAt: Date,
      validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      comments: String
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    reviewComments: String,
    documents: [supplierDocumentSchema],
    bankHistory: [bankHistorySchema]
  },
  { timestamps: true }
);

supplierSchema.pre("validate", function normalizeSupplier() {
  this.normalizedIdentifier = String(this.rucDni || "").replace(/\D/g, "");
  this.identifierType = this.normalizedIdentifier.length === 8 ? "DNI" : "RUC";
  this.legalName ||= this.name;
  this.name ||= this.legalName;
  this.taxAddress ||= this.fiscalAddress;
  this.fiscalAddress ||= this.taxAddress;
});

supplierSchema.index({ active: 1, homologationStatus: 1, name: 1 });

export default mongoose.model("Supplier", supplierSchema);
