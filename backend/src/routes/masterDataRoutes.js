import { Router } from "express";
import { accountingPeriods, costCenters, exchangeRates, expenseTypes } from "../controllers/masterDataController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

function bindCrud(router, controller) {
  router.get("/", protect, controller.list);
  router.post("/", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), controller.create);
  router.put("/:id", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), controller.update);
  router.delete("/:id", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), controller.remove);
}

export const costCenterRouter = Router();
bindCrud(costCenterRouter, costCenters);

export const expenseTypeRouter = Router();
bindCrud(expenseTypeRouter, expenseTypes);

export const exchangeRateRouter = Router();
bindCrud(exchangeRateRouter, exchangeRates);
exchangeRateRouter.get("/current", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), exchangeRates.current);

export const accountingPeriodRouter = Router();
bindCrud(accountingPeriodRouter, accountingPeriods);
