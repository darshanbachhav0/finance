import { Router } from "express";
import { createSupplier, deleteSupplier, listSuppliers, updateSupplier } from "../controllers/supplierController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";
import { SUPPLIER_VIEW_ROLES } from "../utils/permissions.js";
import { uploadFields } from "../middleware/upload.js";

const router = Router();

router.use(protect, authorize(...SUPPLIER_VIEW_ROLES));
router.get("/", listSuppliers);
router.post("/", authorize(ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.SOLICITOR), uploadFields, createSupplier);
router.put("/:id", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), uploadFields, updateSupplier);
router.delete("/:id", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), deleteSupplier);

export default router;
