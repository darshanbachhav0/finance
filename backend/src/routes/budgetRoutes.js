import { Router } from "express";
import { getBudgetOverview } from "../controllers/budgetController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();
router.use(protect, authorize(ROLES.ADMIN, ROLES.APPROVER, ROLES.ACCOUNTING));
router.get("/overview", getBudgetOverview);
export default router;
