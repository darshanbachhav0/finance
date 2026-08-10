import { Router } from "express";
import {
  confirmPayment,
  generateBankFile,
  listBankFiles,
  paymentConfirmationQueue,
  paymentQueue,
  reconciliationQueue,
  reconcileRequestPayment,
  schedulePaymentRequests
} from "../controllers/treasuryController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect, authorize(ROLES.ADMIN, ROLES.TREASURY));
router.get("/queue", paymentQueue);
router.get("/bank-files", listBankFiles);
router.get("/payment-confirmations", paymentConfirmationQueue);
router.get("/reconciliation", reconciliationQueue);
router.post("/schedule", schedulePaymentRequests);
router.post("/bank-file", generateBankFile);
router.post("/requests/:id/confirm-payment", confirmPayment);
router.post("/requests/:id/reconcile", reconcileRequestPayment);

export default router;
