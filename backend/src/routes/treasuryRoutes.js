import { Router } from "express";
import { generateBankFile, listBankFiles, paymentQueue } from "../controllers/treasuryController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect, authorize(ROLES.ADMIN, ROLES.TREASURY));
router.get("/queue", paymentQueue);
router.get("/bank-files", listBankFiles);
router.post("/bank-file", generateBankFile);

export default router;
