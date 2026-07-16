import { Router } from "express";
import { consolidationPreview, exportConsolidation, listAccountingExports, listEntries } from "../controllers/accountingController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING));
router.get("/entries", listEntries);
router.get("/consolidation", consolidationPreview);
router.get("/consolidation/export", exportConsolidation);
router.get("/exports", listAccountingExports);

export default router;
