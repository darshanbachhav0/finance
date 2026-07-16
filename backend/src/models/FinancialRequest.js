import mongoose from "mongoose";
import { CURRENCY, REQUEST_STATUS, REQUEST_TYPES } from "../utils/constants.js";

const lineSchema = new mongoose.Schema(
  {
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter", required: true },
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType", required: true },
    netAmount: { type: Number, required: true, min: 0 },
    igvAmount: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    penEquivalent: { type: Number, default: 0 }
  },
  { _id: true }
);

const attachmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["XML", "PDF", "QUOTATION", "SUPPORTING", "RENDITION"], required: true },
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

const approvalHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    statusFrom: String,
    statusTo: String,
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    role: String,
    comments: String,
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const xmlValidationSchema = new mongoose.Schema(
  {
    validated: { type: Boolean, default: false },
    validatedAt: Date,
    errorMessages: [String],
    data: {
      ruc: String,
      supplierName: String,
      invoiceNumber: String,
      issueDate: String,
      netAmount: Number,
      igvAmount: Number,
      totalAmount: Number
    }
  },
  { _id: false }
);

const financialRequestSchema = new mongoose.Schema(
  {
    requestNumber: { type: String, unique: true },
    requestType: { type: String, enum: REQUEST_TYPES, required: true },
    issueDate: { type: Date, required: true },
    accountingPeriod: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    currency: { type: String, enum: CURRENCY, required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    solicitor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    description: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(REQUEST_STATUS),
      default: REQUEST_STATUS.DRAFT
    },
    lines: {
      type: [lineSchema],
      validate: {
        validator: (lines) => Array.isArray(lines) && lines.length > 0,
        message: "At least one request line is required."
      }
    },
    netAmount: { type: Number, default: 0 },
    igvAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    exchangeRate: { type: Number, default: 1 },
    penEquivalent: { type: Number, default: 0 },
    attachments: [attachmentSchema],
    xmlValidation: { type: xmlValidationSchema, default: () => ({}) },
    approvalHistory: [approvalHistorySchema],
    rejectionReason: String,
    bankFile: {
      fileName: String,
      url: String,
      generatedAt: Date,
      generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    rendition: {
      submittedAt: Date,
      submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      comments: String
    }
  },
  { timestamps: true }
);

financialRequestSchema.pre("validate", function beforeValidate(next) {
  if (!this.requestNumber) {
    this.requestNumber = `REQ-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
  }

  const totals = (this.lines || []).reduce(
    (acc, line) => {
      acc.netAmount += Number(line.netAmount || 0);
      acc.igvAmount += Number(line.igvAmount || 0);
      acc.totalAmount += Number(line.totalAmount || 0);
      acc.penEquivalent += Number(line.penEquivalent || 0);
      return acc;
    },
    { netAmount: 0, igvAmount: 0, totalAmount: 0, penEquivalent: 0 }
  );

  this.netAmount = Number(totals.netAmount.toFixed(2));
  this.igvAmount = Number(totals.igvAmount.toFixed(2));
  this.totalAmount = Number(totals.totalAmount.toFixed(2));
  this.penEquivalent = Number(totals.penEquivalent.toFixed(2));
  next();
});

financialRequestSchema.index({ status: 1, accountingPeriod: 1 });
financialRequestSchema.index({ solicitor: 1, createdAt: -1 });

const FinancialRequest = mongoose.model("FinancialRequest", financialRequestSchema);
export default FinancialRequest;
