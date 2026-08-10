import mongoose from "mongoose";
import {
  APPROVAL_STAGES,
  CANONICAL_REQUEST_STATUSES,
  CURRENCY,
  EXPENSE_NATURE,
  EXPENSE_NATURES,
  LEGACY_EXPENSE_NATURE_MAP,
  LEGACY_REQUEST_TYPE_MAP,
  LEGACY_STATUS_MAP,
  REQUEST_PRIORITIES,
  REQUEST_STATUS,
  REQUEST_TYPES
} from "../utils/constants.js";
import { assertLineTotal, multiplyMoney, roundMoney, sumMoney } from "../utils/money.js";
import { nextRequestNumber } from "../services/sequenceService.js";

const lineSchema = new mongoose.Schema(
  {
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter", required: true },
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType", required: true },
    budgetItem: { type: String, trim: true, default: "" },
    projectId: { type: String, trim: true, default: "" },
    subAccount: { type: String, trim: true, default: "" },
    costCenterSnapshot: {
      code: String,
      name: String,
      area: String
    },
    expenseTypeSnapshot: {
      code: String,
      name: String,
      category: String,
      accountingClass: String,
      accountNumber: String,
      deductible: Boolean
    },
    currency: { type: String, enum: CURRENCY },
    exchangeRate: { type: Number, min: 0 },
    netAmount: { type: Number, required: true, min: 0 },
    igvAmount: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    penEquivalent: { type: Number, default: 0, min: 0 }
  },
  { _id: true }
);

const attachmentSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: [
        "XML",
        "PDF",
        "QUOTATION",
        "PURCHASE_ORDER",
        "CONTRACT",
        "CONFORMITY",
        "ACTIVITY_REPORT",
        "SUPPORTING",
        "RENDITION",
        "RETURN_RECEIPT"
      ],
      required: true
    },
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

const workflowHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    statusFrom: String,
    statusTo: String,
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: String,
    role: String,
    comments: String,
    ip: String,
    signature: String,
    signatureType: { type: String, default: "AUTHENTICATED_ELECTRONIC_SIGN_OFF" },
    snapshotHash: String,
    stage: String,
    startedAt: Date,
    dueAt: Date,
    completedAt: Date,
    slaResult: { type: String, enum: ["ON_TIME", "OVERDUE", "NOT_APPLICABLE"] },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const xmlValidationSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["NOT_REQUIRED", "PENDING", "VALID", "INVALID", "MANUAL"], default: "PENDING" },
    validated: { type: Boolean, default: false },
    validatedAt: Date,
    provider: { type: String, default: "LOCAL_XML" },
    supplierMatch: Boolean,
    documentNumberMatch: Boolean,
    dateMatch: Boolean,
    netMatch: Boolean,
    igvMatch: Boolean,
    totalMatch: Boolean,
    errors: [String],
    errorMessages: [String],
    rawMetadataReference: String,
    data: {
      ruc: String,
      supplierName: String,
      invoiceNumber: String,
      issueDate: String,
      currency: String,
      netAmount: Number,
      igvAmount: Number,
      totalAmount: Number
    }
  },
  { _id: false, suppressReservedKeysWarning: true }
);

const approvalRouteSnapshotSchema = new mongoose.Schema(
  {
    rule: { type: mongoose.Schema.Types.ObjectId, ref: "ApprovalRule" },
    approvalLevel: String,
    role: String,
    sequence: Number,
    slaHours: Number,
    required: Boolean,
    status: { type: String, enum: ["PENDING", "APPROVED", "OBSERVED", "RETURNED", "REJECTED", "SKIPPED"], default: "PENDING" },
    startedAt: Date,
    dueAt: Date,
    completedAt: Date,
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { _id: true }
);

const financialRequestSchema = new mongoose.Schema(
  {
    developmentScenarioKey: { type: String, sparse: true, unique: true, immutable: true },
    requestNumber: { type: String, required: true, unique: true, immutable: true, match: /^(SOL|REQ)-\d{4}-\d{5,7}$/ },
    issueDate: { type: Date, required: true },
    accountingPeriod: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    requester: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    solicitor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    requesterArea: { type: String, trim: true },
    requestingArea: { type: String, trim: true },
    requesterCostCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
    authorizedCostCenterOverride: {
      authorized: { type: Boolean, default: false },
      authorizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reason: String
    },
    schoolOrDepartment: { type: String, trim: true },
    requestType: { type: String, enum: REQUEST_TYPES, required: true, set: (value) => LEGACY_REQUEST_TYPE_MAP[value] || value },
    expenseNature: { type: String, enum: EXPENSE_NATURES, default: EXPENSE_NATURE.SERVICES, set: (value) => LEGACY_EXPENSE_NATURE_MAP[value] || value },
    priority: { type: String, enum: REQUEST_PRIORITIES, default: "MEDIA" },
    project: { type: String, trim: true },
    currency: { type: String, enum: CURRENCY, required: true },
    sourceCurrencyAmount: { type: Number, default: 0, min: 0 },
    exchangeRate: { type: Number, default: 1, min: 0 },
    exchangeRateDate: Date,
    exchangeRateSource: String,
    totalNet: { type: Number, default: 0, min: 0 },
    totalIGV: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    totalPENEquivalent: { type: Number, default: 0, min: 0 },
    netAmount: { type: Number, default: 0, min: 0 },
    igvAmount: { type: Number, default: 0, min: 0 },
    penEquivalent: { type: Number, default: 0, min: 0 },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    supplierSnapshot: {
      identifierType: String,
      identifier: String,
      legalName: String,
      homologationStatus: String
    },
    status: { type: String, enum: CANONICAL_REQUEST_STATUSES, default: REQUEST_STATUS.DRAFT, index: true, set: (value) => LEGACY_STATUS_MAP[value] || value },
    description: { type: String, required: true, trim: true },
    lines: {
      type: [lineSchema],
      validate: { validator: (lines) => Array.isArray(lines) && lines.length > 0, message: "At least one request line is required." }
    },
    attachments: [attachmentSchema],
    xmlValidation: { type: xmlValidationSchema, default: () => ({}) },
    xmlValidationHistory: { type: [xmlValidationSchema], default: [] },
    approvalHistory: [workflowHistorySchema],
    approvalRouteSnapshot: [approvalRouteSnapshotSchema],
    approvalStage: { type: String, enum: Object.values(APPROVAL_STAGES), default: APPROVAL_STAGES.AREA_DIRECTOR },
    approvalDueAt: Date,
    rejectionReason: String,
    draftSavedAt: Date,
    budgetCommitment: { type: mongoose.Schema.Types.ObjectId, ref: "BudgetCommitment" },
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder" },
    paymentBatch: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentBatch" },
    reconciliation: { type: mongoose.Schema.Types.ObjectId, ref: "Reconciliation" },
    fiscalData: {
      supplierIdentifierNormalized: { type: String, trim: true, uppercase: true },
      voucherType: { type: String, trim: true, uppercase: true },
      documentType: { type: String, trim: true, uppercase: true },
      series: { type: String, trim: true, uppercase: true },
      number: { type: String, trim: true, uppercase: true },
      documentDate: Date,
      accountingDate: Date,
      fiscalPeriod: { type: String, match: /^\d{4}-\d{2}$/ },
      accountNumber: { type: String, trim: true },
      subaccountNumber: { type: String, trim: true },
      comments: String,
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
      confirmedAmount: Number,
      comments: String,
      confirmedAt: Date,
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reconciliationComments: String
    },
    rendition: {
      amountAdvanced: { type: Number, default: 0, min: 0 },
      amountRendered: { type: Number, default: 0, min: 0 },
      amountReturned: { type: Number, default: 0, min: 0 },
      balanceOutstanding: { type: Number, default: 0, min: 0 },
      status: { type: String, enum: ["NOT_REQUIRED", "PENDING", "SUBMITTED", "OBSERVED", "VALIDATED"], default: "NOT_REQUIRED" },
      lines: { type: [lineSchema], default: [] },
      documentIds: [{ type: mongoose.Schema.Types.ObjectId }],
      submittedAt: Date,
      submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      validatedAt: Date,
      validator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      comments: String
    },
    migrationReview: {
      required: { type: Boolean, default: false },
      reasons: [String],
      migratedFromStatus: String,
      migratedAt: Date
    }
  },
  { timestamps: true, optimisticConcurrency: true }
);

financialRequestSchema.pre("validate", async function beforeValidate() {
  if (!this.requestNumber) this.requestNumber = await nextRequestNumber(this.issueDate || new Date());
  if (!this.requester) this.requester = this.solicitor;
  if (!this.solicitor) this.solicitor = this.requester;
  if (!this.requesterArea) this.requesterArea = this.requestingArea;
  if (!this.requestingArea) this.requestingArea = this.requesterArea;

  for (const [index, line] of (this.lines || []).entries()) {
    line.netAmount = roundMoney(line.netAmount);
    line.igvAmount = roundMoney(line.igvAmount);
    line.totalAmount = roundMoney(line.totalAmount);
    assertLineTotal(line, index);
    line.currency ||= this.currency;
    line.exchangeRate ||= this.exchangeRate || 1;
    line.penEquivalent = roundMoney(line.penEquivalent || multiplyMoney(line.totalAmount, line.exchangeRate));
  }

  this.totalNet = sumMoney((this.lines || []).map((line) => line.netAmount));
  this.totalIGV = sumMoney((this.lines || []).map((line) => line.igvAmount));
  this.totalAmount = sumMoney((this.lines || []).map((line) => line.totalAmount));
  this.totalPENEquivalent = sumMoney((this.lines || []).map((line) => line.penEquivalent));
  this.sourceCurrencyAmount = this.totalAmount;
  this.netAmount = this.totalNet;
  this.igvAmount = this.totalIGV;
  this.penEquivalent = this.totalPENEquivalent;
});

financialRequestSchema.index({ accountingPeriod: 1, status: 1, createdAt: -1 });
financialRequestSchema.index({ requester: 1, createdAt: -1 });
financialRequestSchema.index({ solicitor: 1, createdAt: -1 });
financialRequestSchema.index({ supplier: 1, createdAt: -1 });
financialRequestSchema.index({ approvalStage: 1, status: 1, approvalDueAt: 1 });
financialRequestSchema.index(
  {
    "fiscalData.supplierIdentifierNormalized": 1,
    "fiscalData.voucherType": 1,
    "fiscalData.series": 1,
    "fiscalData.number": 1
  },
  {
    unique: true,
    partialFilterExpression: {
      "fiscalData.supplierIdentifierNormalized": { $type: "string" },
      "fiscalData.voucherType": { $type: "string" },
      "fiscalData.series": { $type: "string" },
      "fiscalData.number": { $type: "string" }
    },
    name: "voucher_identity_unique"
  }
);

export default mongoose.model("FinancialRequest", financialRequestSchema);
