import { Router } from "express";
import {
  closeRequest,
  createRequest,
  deleteRequest,
  getAuthorizedCostCenters,
  getBudgetPreview,
  getRequestDocumentRequirements,
  getRequestFormPolicy,
  getRequest,
  listRequests,
  observeRendition,
  submitRequest,
  updateRequest,
  uploadRendition,
  validateRendition,
  voidRequest,
} from "../controllers/requestController.js";
import { authorize, protect } from "../middleware/auth.js";
import { uploadFields } from "../middleware/upload.js";
import { ROLES } from "../utils/constants.js";
import { REQUEST_CREATOR_ROLES } from "../utils/permissions.js";

const router = Router();

router.use(protect);
router.get("/document-requirements", getRequestDocumentRequirements);
router.get("/form-policy", getRequestFormPolicy);
router.get("/authorized-cost-centers", authorize(...REQUEST_CREATOR_ROLES), getAuthorizedCostCenters);
router.post("/budget-preview", authorize(...REQUEST_CREATOR_ROLES), getBudgetPreview);
router.route("/").get(listRequests).post(authorize(...REQUEST_CREATOR_ROLES), uploadFields, createRequest);
router.route("/:id").get(getRequest).put(uploadFields, updateRequest).delete(deleteRequest);
router.post("/:id/submit", submitRequest);
router.post("/:id/rendition", authorize(ROLES.ADMIN, ROLES.SOLICITOR), uploadFields, uploadRendition);
router.post("/:id/rendition/validate", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), validateRendition);
router.post("/:id/rendition/observe", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), observeRendition);
router.post("/:id/close", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), closeRequest);
router.post("/:id/void", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), voidRequest);

export default router;
