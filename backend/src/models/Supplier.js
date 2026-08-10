import mongoose from "mongoose";

const bankHistorySchema = new mongoose.Schema(
  {
    bankName: String,
    bankAccount: String,
    cci: String,
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "INACTIVE" },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { _id: false }
);

const supplierDocumentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["RUC_FILE", "BANK_CERTIFICATE", "LEGAL_REP_ID"], required: true },
    originalName: String,
    filename: String,
    path: String,
    url: String,
    mimetype: String,
    size: Number,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const supplierSchema = new mongoose.Schema(
  {
    rucDni: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    fiscalAddress: { type: String, trim: true },
    legalRepresentative: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    contactName: { type: String, trim: true },
    supplierType: { type: String, trim: true, default: "General" },
    currency: { type: String, enum: ["PEN", "USD"], default: "PEN" },
    bankName: { type: String, trim: true },
    bankAccount: { type: String, trim: true },
    cci: { type: String, trim: true },
    status: { type: String, enum: ["PENDING_VALIDATION", "ACTIVE", "OBSERVED", "INACTIVE"], default: "PENDING_VALIDATION" },
    compliance: {
      taxpayerActive: { type: Boolean, default: false },
      compliant: { type: Boolean, default: false },
      validatedAt: Date,
      validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      comments: String
    },
    documents: [supplierDocumentSchema],
    bankHistory: [bankHistorySchema]
  },
  { timestamps: true }
);

const Supplier = mongoose.model("Supplier", supplierSchema);
export default Supplier;
