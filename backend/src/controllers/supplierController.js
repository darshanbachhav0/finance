import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  createSupplierProposal,
  deactivateSupplier,
  listSuppliersPage,
  updateAndReviewSupplier
} from "../services/supplierService.js";

export const listSuppliers = asyncHandler(async (req, res) => {
  res.json(await listSuppliersPage(req.query));
});

export const createSupplier = asyncHandler(async (req, res) => {
  const result = await createSupplierProposal({ payload: req.body, files: req.files, user: req.user, req });
  res.status(201).json({ data: result.supplier, warnings: result.warnings });
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const result = await updateAndReviewSupplier({ supplierId: req.params.id, payload: req.body, files: req.files, user: req.user, req });
  res.json({ data: result.supplier, warnings: result.warnings });
});

export const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await deactivateSupplier({ supplierId: req.params.id, user: req.user, req });
  res.json({ data: supplier });
});
