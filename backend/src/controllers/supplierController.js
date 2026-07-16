import Supplier from "../models/Supplier.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";

function bankChanged(supplier, payload) {
  return ["bankName", "bankAccount", "cci"].some((field) => payload[field] !== undefined && payload[field] !== supplier[field]);
}

export const listSuppliers = asyncHandler(async (_req, res) => {
  const suppliers = await Supplier.find().sort({ name: 1 });
  res.json({ data: suppliers });
});

export const createSupplier = asyncHandler(async (req, res) => {
  const { rucDni, name, bankName, bankAccount, cci, status } = req.body;
  if (!rucDni || !name) throw new AppError(400, "RUC/DNI and supplier name are required.");

  const existing = await Supplier.findOne({ rucDni });
  if (existing) throw new AppError(409, "RUC/DNI must be unique.");

  const supplier = await Supplier.create({
    rucDni,
    name,
    bankName,
    bankAccount,
    cci,
    status,
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

  Object.assign(supplier, req.body);
  await supplier.save();
  res.json({ data: supplier });
});

export const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findByIdAndUpdate(req.params.id, { status: "INACTIVE" }, { new: true });
  if (!supplier) throw new AppError(404, "Supplier not found.");
  res.json({ data: supplier });
});
