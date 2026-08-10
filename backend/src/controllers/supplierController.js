import Supplier from "../models/Supplier.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { recordAudit } from "../services/auditService.js";

const supplierPopulate = [
  { path: "compliance.validatedBy", select: "name email role" },
  { path: "documents.uploadedBy", select: "name email role" }
];

function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

function uploadedSupplierDocuments(files = {}, userId) {
  const kinds = { rucFile: "RUC_FILE", bankCertificate: "BANK_CERTIFICATE", legalRepId: "LEGAL_REP_ID" };
  return Object.entries(kinds).flatMap(([field, kind]) =>
    (files[field] || []).map((file) => ({
      kind,
      originalName: file.originalname,
      filename: file.filename,
      path: file.path,
      url: `/uploads/${file.filename}`,
      mimetype: file.mimetype,
      size: file.size,
      uploadedBy: userId
    }))
  );
}

function assertCanActivate(supplier) {
  const missingFields = ["fiscalAddress", "legalRepresentative", "bankName", "bankAccount", "cci"].filter((field) => !supplier[field]);
  const documentKinds = new Set((supplier.documents || []).map((item) => item.kind));
  const missingDocuments = ["RUC_FILE", "BANK_CERTIFICATE", "LEGAL_REP_ID"].filter((kind) => !documentKinds.has(kind));
  if (missingFields.length || missingDocuments.length || !supplier.compliance?.taxpayerActive || !supplier.compliance?.compliant) {
    throw new AppError(422, "Supplier cannot be homologated until fiscal, bank, document, taxpayer, and compliance checks are complete.");
  }
}

function bankChanged(supplier, payload) {
  return ["bankName", "bankAccount", "cci"].some((field) => payload[field] !== undefined && payload[field] !== supplier[field]);
}

export const listSuppliers = asyncHandler(async (_req, res) => {
  const suppliers = await Supplier.find().populate(supplierPopulate).sort({ name: 1 });
  res.json({ data: suppliers });
});

export const createSupplier = asyncHandler(async (req, res) => {
  const { rucDni, name, bankName, bankAccount, cci } = req.body;
  if (!rucDni || !name) throw new AppError(400, "RUC/DNI and supplier name are required.");
  if (!/^(\d{8}|\d{11})$/.test(String(rucDni))) throw new AppError(422, "RUC must contain 11 digits or DNI must contain 8 digits.");

  const existing = await Supplier.findOne({ rucDni });
  if (existing) throw new AppError(409, "RUC/DNI must be unique.");

  const supplier = await Supplier.create({
    rucDni,
    name,
    fiscalAddress: req.body.fiscalAddress,
    legalRepresentative: req.body.legalRepresentative,
    email: req.body.email,
    contactName: req.body.contactName,
    supplierType: req.body.supplierType,
    currency: req.body.currency,
    bankName,
    bankAccount,
    cci,
    status: "PENDING_VALIDATION",
    documents: uploadedSupplierDocuments(req.files, req.user._id),
    bankHistory: [
      {
        bankName,
        bankAccount,
        cci,
        status: "ACTIVE",
        changedBy: req.user._id
      }
    ]
  });
  await recordAudit({ entityType: "Supplier", entity: supplier, action: "CREATED_PENDING_VALIDATION", user: req.user, req });
  res.status(201).json({ data: supplier });
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) throw new AppError(404, "Supplier not found.");

  if (req.body.rucDni && req.body.rucDni !== supplier.rucDni) {
    const existing = await Supplier.findOne({ rucDni: req.body.rucDni });
    if (existing) throw new AppError(409, "RUC/DNI must be unique.");
  }

  if (bankChanged(supplier, req.body)) {
    supplier.bankHistory.push({
      bankName: supplier.bankName,
      bankAccount: supplier.bankAccount,
      cci: supplier.cci,
      status: "INACTIVE",
      changedBy: req.user._id
    });
    supplier.bankHistory.push({
      bankName: req.body.bankName ?? supplier.bankName,
      bankAccount: req.body.bankAccount ?? supplier.bankAccount,
      cci: req.body.cci ?? supplier.cci,
      status: "ACTIVE",
      changedBy: req.user._id
    });
  }

  const payload = { ...req.body };
  if (payload.taxpayerActive !== undefined || payload.compliant !== undefined || payload.complianceComments !== undefined) {
    supplier.compliance = {
      ...supplier.compliance?.toObject?.(),
      taxpayerActive: payload.taxpayerActive !== undefined ? parseBoolean(payload.taxpayerActive) : supplier.compliance?.taxpayerActive,
      compliant: payload.compliant !== undefined ? parseBoolean(payload.compliant) : supplier.compliance?.compliant,
      comments: payload.complianceComments ?? supplier.compliance?.comments,
      validatedAt: new Date(),
      validatedBy: req.user._id
    };
  }
  delete payload.taxpayerActive;
  delete payload.compliant;
  delete payload.complianceComments;
  supplier.documents.push(...uploadedSupplierDocuments(req.files, req.user._id));
  Object.assign(supplier, payload);
  if (supplier.status === "ACTIVE") assertCanActivate(supplier);
  await supplier.save();
  await recordAudit({ entityType: "Supplier", entity: supplier, action: supplier.status === "ACTIVE" ? "HOMOLOGATED" : "UPDATED", user: req.user, req, comments: supplier.compliance?.comments });
  await supplier.populate(supplierPopulate);
  res.json({ data: supplier });
});

export const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findByIdAndUpdate(req.params.id, { status: "INACTIVE" }, { new: true });
  if (!supplier) throw new AppError(404, "Supplier not found.");
  await recordAudit({ entityType: "Supplier", entity: supplier, action: "DEACTIVATED", user: req.user, req });
  res.json({ data: supplier });
});
