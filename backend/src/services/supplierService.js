import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import { recordAudit } from "./auditService.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import { paginatedPayload, parsePagination, parseSort, escapedRegex } from "./queryService.js";
import { nextSupplierCode } from "./sequenceService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, ROLES } from "../utils/constants.js";
import { assertValidBankAccountNumber, assertValidCci } from "../utils/bankAccountValidation.js";

const supplierDocumentKinds = Object.freeze({
  rucFile: "RUC_FILE",
  bankCertificate: "BANK_CERTIFICATE",
  legalRepId: "LEGAL_REP_ID"
});

export function normalizeSupplierIdentifier(value) {
  return String(value || "").replace(/\D/g, "");
}

export function assertSupplierIdentifier(value) {
  const normalized = normalizeSupplierIdentifier(value);
  if (!/^(\d{8}|\d{11})$/.test(normalized)) {
    throw new AppError(422, "RUC must contain 11 digits or DNI must contain 8 digits.", { identifier: value }, ERROR_CODES.VALIDATION_ERROR);
  }
  return normalized;
}

function parseStructuredValue(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(422, `${field} must contain valid JSON.`, { field }, ERROR_CODES.VALIDATION_ERROR);
  }
}

function mapUploadedDocuments(files, userId) {
  return Object.entries(supplierDocumentKinds).flatMap(([field, kind]) =>
    (files[field] || []).map((file) => ({
      kind,
      originalName: file.originalname,
      filename: file.filename,
      path: file.path,
      url: file.url,
      mimetype: file.mimetype,
      size: file.size,
      checksum: file.checksum,
      uploadedBy: userId
    }))
  );
}

export function assertSupplierCanBeHomologated(supplier) {
  const missingFields = ["taxAddress", "legalRepresentative", "bankName", "bankAccount", "cci"].filter((field) => !supplier[field] && !(field === "taxAddress" && supplier.fiscalAddress));
  const documentKinds = new Set((supplier.documents || []).map((item) => item.kind));
  const missingDocuments = ["RUC_FILE", "BANK_CERTIFICATE", "LEGAL_REP_ID"].filter((kind) => !documentKinds.has(kind));
  const taxpayerValid = supplier.taxpayerStatus === "ACTIVE" || supplier.taxpayerStatus === "MANUALLY_VALIDATED" || supplier.compliance?.taxpayerActive;
  const compliant = supplier.complianceStatus === "COMPLIANT" || supplier.compliance?.compliant;
  if (missingFields.length || missingDocuments.length || !taxpayerValid || !compliant) {
    throw new AppError(
      422,
      "Supplier cannot be homologated until fiscal, bank, document, taxpayer and compliance checks are complete.",
      { missingFields, missingDocuments, taxpayerValid: Boolean(taxpayerValid), compliant: Boolean(compliant) },
      ERROR_CODES.VALIDATION_ERROR
    );
  }
}

export function isSupplierUsable(supplier) {
  return Boolean(supplier && ((supplier.active && supplier.homologationStatus === "HOMOLOGATED") || supplier.status === "ACTIVE"));
}

export function assertSupplierUsable(supplier) {
  if (!isSupplierUsable(supplier)) {
    throw new AppError(422, "An active homologated supplier is required.", { supplier: supplier?._id }, ERROR_CODES.SUPPLIER_NOT_HOMOLOGATED);
  }
}

export async function reusedBankWarnings({ supplierId, accountNumber, cci }) {
  const normalizedAccount = accountNumber ? assertValidBankAccountNumber(accountNumber) : "";
  const normalizedCci = cci ? assertValidCci(cci) : "";
  const conditions = [];
  if (normalizedAccount) conditions.push({ accountNumber: normalizedAccount });
  if (normalizedCci) conditions.push({ cci: normalizedCci });
  if (!conditions.length) return [];
  const records = await SupplierBankAccount.find({
    supplier: { $ne: supplierId },
    $or: conditions
  }).populate("supplier", "rucDni name legalName");
  return records.map((record) => ({
    code: record.cci === normalizedCci ? "CCI_REUSED" : "ACCOUNT_REUSED",
    supplier: record.supplier?._id,
    supplierName: record.supplier?.legalName || record.supplier?.name,
    accountNumber: record.accountNumber,
    cci: record.cci
  }));
}

export async function replaceActiveBankAccount(supplier, payload, userId) {
  const bankFieldsProvided = ["bankName", "bankAccount", "cci", "currency", "accountType", "accountHolderName"]
    .some((field) => payload[field] !== undefined);
  const existingActive = await SupplierBankAccount.findOne({ supplier: supplier._id, active: true }).sort({ validFrom: -1 });
  if (!bankFieldsProvided && existingActive) return { account: existingActive, warnings: [] };
  const bank = String(payload.bankName ?? supplier.bankName ?? "").trim().toUpperCase();
  const rawAccountNumber = payload.bankAccount ?? supplier.bankAccount ?? "";
  const rawCci = payload.cci ?? supplier.cci ?? "";
  const currency = payload.currency || supplier.currency || "PEN";
  if (!bank || !String(rawAccountNumber).trim()) return { account: null, warnings: [] };
  let accountNumber;
  let cci;
  try {
    accountNumber = assertValidBankAccountNumber(rawAccountNumber);
    cci = assertValidCci(rawCci, { required: false });
  } catch (error) {
    if (bankFieldsProvided) throw error;
    return {
      account: null,
      warnings: [{ code: "LEGACY_BANK_DETAILS_REVIEW_REQUIRED", message: error.message }]
    };
  }
  const accountType = payload.accountType || "CURRENT";
  const accountHolderName = String(payload.accountHolderName || supplier.legalName || supplier.name || "").trim();

  const active = existingActive;
  const unchanged = active && active.bank === bank && active.accountNumber === accountNumber && active.cci === cci && active.currency === currency && active.accountType === accountType;
  if (unchanged) return { account: active, warnings: await reusedBankWarnings({ supplierId: supplier._id, accountNumber, cci }) };

  const now = new Date();
  await SupplierBankAccount.updateMany(
    { supplier: supplier._id, active: true },
    { $set: { active: false, preferred: false, validTo: now, changedBy: userId } }
  );
  for (const history of supplier.bankHistory || []) {
    if (history.status === "ACTIVE") {
      history.status = "INACTIVE";
      history.preferred = false;
      history.validTo = now;
      history.changedAt = now;
      history.changedBy = userId;
    }
  }
  const account = await SupplierBankAccount.create({
    supplier: supplier._id,
    bank,
    currency,
    accountType,
    accountHolderName,
    accountNumber,
    cci,
    active: true,
    preferred: true,
    verificationStatus: "PENDING",
    validFrom: now,
    createdBy: userId,
    changedBy: userId
  });
  supplier.bankName = bank;
  supplier.bankAccount = accountNumber;
  supplier.cci = cci;
  supplier.bankHistory.push({
    bankName: bank,
    currency,
    accountType,
    accountHolderName,
    bankAccount: accountNumber,
    cci,
    status: "ACTIVE",
    preferred: true,
    verificationStatus: "PENDING",
    validFrom: now,
    createdBy: userId,
    changedBy: userId
  });
  return { account, warnings: await reusedBankWarnings({ supplierId: supplier._id, accountNumber, cci }) };
}

export async function addVerifiedSupplierBankAccount({ supplier, payload, user }) {
  if (![ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role)) {
    throw new AppError(403, "Only Accounting or Admin can verify supplier bank accounts.", undefined, ERROR_CODES.FORBIDDEN);
  }
  const accountNumber = assertValidBankAccountNumber(payload.accountNumber || payload.bankAccount);
  const cci = assertValidCci(payload.cci, { required: false });
  const preferred = payload.preferred === true || payload.preferred === "true";
  if (preferred) {
    await SupplierBankAccount.updateMany(
      {
        supplier: supplier._id,
        currency: payload.currency || supplier.currency || "PEN",
        accountType: payload.accountType || "CURRENT",
        active: true,
        preferred: true
      },
      { $set: { preferred: false, changedBy: user._id } }
    );
  }
  const account = await SupplierBankAccount.create({
    supplier: supplier._id,
    bank: String(payload.bank || payload.bankName || "").trim().toUpperCase(),
    currency: payload.currency || supplier.currency || "PEN",
    accountType: payload.accountType || "CURRENT",
    accountHolderName: payload.accountHolderName || supplier.legalName || supplier.name,
    accountNumber,
    cci,
    active: true,
    preferred,
    verificationStatus: "VERIFIED",
    ownershipResult: payload.ownershipResult || "MANUAL_ACCEPTED",
    verifiedBy: user._id,
    verifiedAt: new Date(),
    verificationSource: payload.verificationSource || "AUTHORIZED_MANUAL_REVIEW",
    verificationDocument: payload.verificationDocument,
    verificationComments: payload.verificationComments,
    createdBy: user._id,
    changedBy: user._id
  });
  return { account, warnings: await reusedBankWarnings({ supplierId: supplier._id, accountNumber, cci }) };
}

export async function getActiveBankAccount(supplierId, { bank, currency } = {}) {
  const query = { supplier: supplierId, active: true };
  if (bank) query.bank = String(bank).toUpperCase();
  if (currency) query.currency = currency;
  return SupplierBankAccount.findOne(query).sort({ validFrom: -1 });
}

export async function listSuppliersPage(queryParams) {
  const query = {};
  if (queryParams.homologationStatus) query.homologationStatus = queryParams.homologationStatus;
  if (queryParams.active !== undefined) query.active = queryParams.active === "true";
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    query.$or = [{ supplierCode: search }, { rucDni: search }, { normalizedIdentifier: search }, { name: search }, { commercialName: search }, { legalName: search }];
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["supplierCode", "name", "commercialName", "legalName", "rucDni", "createdAt", "homologationStatus"], { legalName: 1, name: 1 });
  const [data, total] = await Promise.all([
    Supplier.find(query)
      .populate("compliance.validatedBy", "name email role")
      .populate("complianceReview.reviewedBy", "name email role")
      .populate("reviewedBy", "name email role")
      .populate("documents.uploadedBy", "name email role")
      .sort(sort).skip(skip).limit(pageSize),
    Supplier.countDocuments(query)
  ]);
  const supplierIds = data.map((supplier) => supplier._id);
  const bankAccounts = await SupplierBankAccount.find({ supplier: { $in: supplierIds } }).sort({ validFrom: -1 });
  const bySupplier = bankAccounts.reduce((map, account) => {
    const key = String(account.supplier);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(account);
    return map;
  }, new Map());
  return paginatedPayload(data.map((supplier) => ({ ...supplier.toObject(), bankAccounts: bySupplier.get(String(supplier._id)) || [] })), total, page, pageSize);
}

export async function createSupplierProposal({ payload, files, user, req }) {
  const identifier = assertSupplierIdentifier(payload.rucDni || payload.identifier);
  if (!payload.name && !payload.legalName) throw new AppError(400, "Supplier legal name is required.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const duplicate = await Supplier.findOne({ $or: [{ normalizedIdentifier: identifier }, { rucDni: identifier }] });
  if (duplicate) throw new AppError(409, "RUC/DNI must be unique.", { supplier: duplicate._id }, ERROR_CODES.DUPLICATE_SUPPLIER);

  const supplier = new Supplier({
    identifierType: identifier.length === 8 ? "DNI" : "RUC",
    rucDni: identifier,
    normalizedIdentifier: identifier,
    personType: payload.personType,
    legalName: payload.legalName || payload.name,
    commercialName: payload.commercialName || payload.name || payload.legalName,
    name: payload.name || payload.legalName,
    taxAddress: payload.taxAddress || payload.fiscalAddress,
    fiscalAddress: payload.fiscalAddress || payload.taxAddress,
    location: parseStructuredValue(payload.location, "location"),
    website: payload.website,
    legalRepresentative: payload.legalRepresentative,
    legalRepresentativeDocument: parseStructuredValue(payload.legalRepresentativeDocument, "legalRepresentativeDocument"),
    email: payload.email,
    phone: payload.phone,
    contactName: payload.contactName,
    commercialContact: parseStructuredValue(payload.commercialContact, "commercialContact"),
    operationsContact: parseStructuredValue(payload.operationsContact, "operationsContact"),
    supplierType: payload.supplierType,
    goodsServicesProfile: payload.goodsServicesProfile,
    paymentTerms: parseStructuredValue(payload.paymentTerms, "paymentTerms"),
    delivery: parseStructuredValue(payload.delivery, "delivery"),
    declarations: parseStructuredValue(payload.declarations, "declarations"),
    currency: payload.currency,
    taxpayerStatus: "PENDING",
    complianceStatus: "PENDING",
    homologationStatus: "PENDING_VALIDATION",
    active: false,
    status: "PENDING_VALIDATION"
  });
  let persistedFiles = {};
  try {
    persistedFiles = await persistUploadedFiles(files, { domain: "suppliers", entityId: supplier._id });
    supplier.documents.push(...mapUploadedDocuments(persistedFiles, user._id));
    await supplier.save();
    await replaceActiveBankAccount(supplier, payload, user._id);
    await supplier.save();
    const warnings = await reusedBankWarnings({ supplierId: supplier._id, accountNumber: supplier.bankAccount, cci: supplier.cci });
    await recordAudit({ entityType: "Supplier", entity: supplier, action: "CREATED_PENDING_VALIDATION", user, req, module: "SUPPLIERS", newValues: { identifier, legalName: supplier.legalName } });
    return { supplier, warnings };
  } catch (error) {
    await cleanupUploadedFiles(persistedFiles);
    await SupplierBankAccount.deleteMany({ supplier: supplier._id }).catch(() => undefined);
    if (!supplier.isNew) await Supplier.deleteOne({ _id: supplier._id, homologationStatus: "PENDING_VALIDATION" }).catch(() => undefined);
    throw error;
  }
}

export async function updateAndReviewSupplier({ supplierId, payload, files, user, req }) {
  const supplier = await Supplier.findById(supplierId).select("+documents.path");
  if (!supplier) throw new AppError(404, "Supplier not found.", { supplierId }, ERROR_CODES.NOT_FOUND);
  if (payload.rucDni && normalizeSupplierIdentifier(payload.rucDni) !== supplier.normalizedIdentifier) {
    const identifier = assertSupplierIdentifier(payload.rucDni);
    const duplicate = await Supplier.findOne({ _id: { $ne: supplier._id }, $or: [{ normalizedIdentifier: identifier }, { rucDni: identifier }] });
    if (duplicate) throw new AppError(409, "RUC/DNI must be unique.", { supplier: duplicate._id }, ERROR_CODES.DUPLICATE_SUPPLIER);
    supplier.rucDni = identifier;
    supplier.normalizedIdentifier = identifier;
  }
  const oldValues = { homologationStatus: supplier.homologationStatus, active: supplier.active, bankName: supplier.bankName, bankAccount: supplier.bankAccount, cci: supplier.cci };
  const persistedFiles = await persistUploadedFiles(files, { domain: "suppliers", entityId: supplier._id });
  supplier.documents.push(...mapUploadedDocuments(persistedFiles, user._id));
  const fields = [
    "personType",
    "legalName",
    "commercialName",
    "name",
    "taxAddress",
    "fiscalAddress",
    "website",
    "legalRepresentative",
    "email",
    "phone",
    "contactName",
    "supplierType",
    "goodsServicesProfile",
    "currency"
  ];
  for (const field of fields) if (payload[field] !== undefined) supplier[field] = payload[field];
  for (const field of ["location", "legalRepresentativeDocument", "commercialContact", "operationsContact", "paymentTerms", "delivery", "declarations"]) {
    const value = parseStructuredValue(payload[field], field);
    if (value !== undefined) supplier[field] = value;
  }

  if (payload.taxpayerActive !== undefined || payload.taxpayerStatus) {
    const active = payload.taxpayerActive === true || payload.taxpayerActive === "true" || payload.taxpayerStatus === "ACTIVE" || payload.taxpayerStatus === "MANUALLY_VALIDATED";
    supplier.taxpayerStatus = active ? "MANUALLY_VALIDATED" : (payload.taxpayerStatus || "INACTIVE");
    supplier.compliance.taxpayerActive = active;
  }
  if (payload.compliant !== undefined || payload.complianceStatus) {
    const compliant = payload.compliant === true || payload.compliant === "true" || payload.complianceStatus === "COMPLIANT";
    supplier.complianceStatus = compliant ? "COMPLIANT" : (payload.complianceStatus || "NON_COMPLIANT");
    supplier.compliance.compliant = compliant;
  }
  supplier.compliance.comments = payload.complianceComments ?? supplier.compliance.comments;
  supplier.compliance.validatedAt = new Date();
  supplier.compliance.validatedBy = user._id;
  if (payload.complianceReview !== undefined || payload.complianceReviewResult !== undefined) {
    const review = parseStructuredValue(payload.complianceReview, "complianceReview") || {};
    supplier.complianceReview.result = payload.complianceReviewResult || review.result || supplier.complianceReview.result;
    supplier.complianceReview.comments = review.comments ?? payload.complianceComments ?? supplier.complianceReview.comments;
    supplier.complianceReview.reviewedBy = user._id;
    supplier.complianceReview.reviewedAt = new Date();
  }

  const bankResult = await replaceActiveBankAccount(supplier, payload, user._id);
  const requestedHomologation = payload.homologationStatus === "HOMOLOGATED" || payload.status === "ACTIVE";
  const requestedObserved = payload.homologationStatus === "OBSERVED" || payload.status === "OBSERVED";
  const requestedRejected = payload.homologationStatus === "REJECTED" || payload.status === "REJECTED";
  const requestedInactive = payload.homologationStatus === "INACTIVE" || payload.status === "INACTIVE";
  if (requestedHomologation) {
    if (![ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role)) throw new AppError(403, "Only Accounting or Admin can homologate suppliers.", undefined, ERROR_CODES.FORBIDDEN);
    assertSupplierCanBeHomologated(supplier);
    if (!bankResult.account) {
      throw new AppError(422, "A normalized supplier bank account is required for homologation.", { warnings: bankResult.warnings }, ERROR_CODES.VALIDATION_ERROR);
    }
    supplier.supplierCode ||= await nextSupplierCode();
    supplier.homologationStatus = "HOMOLOGATED";
    supplier.active = true;
    supplier.status = "ACTIVE";
  } else if (requestedObserved) {
    supplier.homologationStatus = "OBSERVED";
    supplier.active = false;
    supplier.status = "OBSERVED";
  } else if (requestedRejected) {
    supplier.homologationStatus = "REJECTED";
    supplier.active = false;
    supplier.status = "REJECTED";
  } else if (requestedInactive) {
    supplier.homologationStatus = "INACTIVE";
    supplier.active = false;
    supplier.status = "INACTIVE";
  }
  supplier.reviewedBy = user._id;
  supplier.reviewedAt = new Date();
  supplier.reviewComments = payload.reviewComments || payload.complianceComments || supplier.reviewComments;
  if (requestedHomologation && bankResult.account) {
    bankResult.account.verificationStatus = "VERIFIED";
    bankResult.account.ownershipResult = payload.ownershipResult || "MANUAL_ACCEPTED";
    bankResult.account.verifiedBy = user._id;
    bankResult.account.verifiedAt = new Date();
    bankResult.account.verificationSource = payload.verificationSource || "ACCOUNTING_HOMOLOGATION";
    bankResult.account.verificationDocument = payload.verificationDocument;
    bankResult.account.verificationComments = payload.verificationComments || supplier.reviewComments || "";
    await bankResult.account.save();
    const activeHistory = [...(supplier.bankHistory || [])].reverse().find((item) => item.status === "ACTIVE");
    if (activeHistory) {
      activeHistory.verificationStatus = bankResult.account.verificationStatus;
      activeHistory.ownershipResult = bankResult.account.ownershipResult;
      activeHistory.verifiedBy = user._id;
      activeHistory.verifiedAt = bankResult.account.verifiedAt;
      activeHistory.verificationSource = bankResult.account.verificationSource;
      activeHistory.verificationDocument = bankResult.account.verificationDocument;
    }
  }
  await supplier.save();
  await recordAudit({
    entityType: "Supplier",
    entity: supplier,
    action: requestedHomologation ? "HOMOLOGATED" : requestedObserved ? "OBSERVED" : requestedRejected ? "REJECTED" : requestedInactive ? "DEACTIVATED" : "UPDATED",
    user,
    req,
    module: "SUPPLIERS",
    comments: supplier.reviewComments,
    oldValues,
    newValues: { homologationStatus: supplier.homologationStatus, active: supplier.active, bankAccount: supplier.bankAccount, cci: supplier.cci }
  });
  return { supplier, warnings: bankResult.warnings };
}

export async function deactivateSupplier({ supplierId, user, req }) {
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw new AppError(404, "Supplier not found.", { supplierId }, ERROR_CODES.NOT_FOUND);
  supplier.homologationStatus = "INACTIVE";
  supplier.active = false;
  supplier.status = "INACTIVE";
  supplier.reviewedBy = user._id;
  supplier.reviewedAt = new Date();
  await supplier.save();
  await SupplierBankAccount.updateMany({ supplier: supplier._id, active: true }, { $set: { active: false, validTo: new Date(), changedBy: user._id } });
  await recordAudit({ entityType: "Supplier", entity: supplier, action: "DEACTIVATED", user, req, module: "SUPPLIERS" });
  return supplier;
}
