import { Router } from "express";
import accountingRoutes from "./accountingRoutes.js";
import approvalRoutes from "./approvalRoutes.js";
import authRoutes from "./authRoutes.js";
import dashboardRoutes from "./dashboardRoutes.js";
import requestRoutes from "./requestRoutes.js";
import sireRoutes from "./sireRoutes.js";
import supplierRoutes from "./supplierRoutes.js";
import treasuryRoutes from "./treasuryRoutes.js";
import userRoutes from "./userRoutes.js";
import {
  accountingPeriodRouter,
  costCenterRouter,
  exchangeRateRouter,
  expenseTypeRouter
} from "./masterDataRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/requests", requestRoutes);
router.use("/approvals", approvalRoutes);
router.use("/accounting", accountingRoutes);
router.use("/treasury", treasuryRoutes);
router.use("/suppliers", supplierRoutes);
router.use("/cost-centers", costCenterRouter);
router.use("/expense-types", expenseTypeRouter);
router.use("/exchange-rates", exchangeRateRouter);
router.use("/accounting-periods", accountingPeriodRouter);
router.use("/sire", sireRoutes);
router.use("/users", userRoutes);

export default router;
