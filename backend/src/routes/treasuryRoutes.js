import { Router } from "express";
import { confirmPayment, generateBankFile, listBankFiles, paymentConfirmationQueue, paymentQueue } from "../controllers/treasuryController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect, authorize(ROLES.ADMIN, ROLES.TREASURY));
router.get("/queue", paymentQueue);
router.get("/bank-files", listBankFiles);
router.get("/payment-confirmations", paymentConfirmationQueue);
router.post("/bank-file", generateBankFile);
router.post("/requests/:id/confirm-payment", confirmPayment);

export default router;
