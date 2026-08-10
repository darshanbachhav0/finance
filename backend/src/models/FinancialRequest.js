import mongoose from "mongoose";
import {
  APPROVAL_STAGES,
  CURRENCY,
  EXPENSE_NATURES,
  REQUEST_PRIORITIES,
  REQUEST_STATUS,
  REQUEST_TYPES
} from "../utils/constants.js";

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
    kind: {
      type: String,
      enum: ["XML", "PDF", "QUOTATION", "PURCHASE_ORDER", "CONTRACT", "CONFORMITY", "ACTIVITY_REPORT", "SUPPORTING", "RENDITION"],
      required: true
    },
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
    ip: String,
    signature: String,
    stage: String,
    dueAt: Date,
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
    expenseNature: { type: String, enum: EXPENSE_NATURES, default: "Contratación de Servicios" },
    priority: { type: String, enum: REQUEST_PRIORITIES, default: "MEDIA" },
    requestingArea: { type: String, trim: true },
    schoolOrDepartment: { type: String, trim: true },
    project: { type: String, trim: true },
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
    approvalStage: { type: String, enum: Object.values(APPROVAL_STAGES), default: APPROVAL_STAGES.AREA_DIRECTOR },
    approvalDueAt: Date,
    rejectionReason: String,
    budgetCommitment: { type: mongoose.Schema.Types.ObjectId, ref: "BudgetCommitment" },
    fiscalData: {
      documentType: { type: String, trim: true },
      series: { type: String, trim: true, uppercase: true },
      number: { type: String, trim: true },
      documentDate: Date,
      accountingDate: Date,
      fiscalPeriod: { type: String, match: /^\d{4}-\d{2}$/ },
      accountNumber: { type: String, trim: true },
      subaccountNumber: { type: String, trim: true },
      processedAt: Date,
      processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    bankFile: {
      bank: String,
      fileName: String,
      url: String,
      generatedAt: Date,
      generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    payment: {
      operationNumber: String,
      paidAt: Date,
      confirmedAt: Date,
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reconciliationComments: String
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
    this.requestNumber = `SOL-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
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
financialRequestSchema.index(
  { supplier: 1, "fiscalData.documentType": 1, "fiscalData.series": 1, "fiscalData.number": 1 },
  {
    unique: true,
    partialFilterExpression: {
      "fiscalData.documentType": { $type: "string" },
      "fiscalData.series": { $type: "string" },
      "fiscalData.number": { $type: "string" }
    }
  }
);

const FinancialRequest = mongoose.model("FinancialRequest", financialRequestSchema);
export default FinancialRequest;
