import { Router } from "express";
import {
  closeRequest,
  createRequest,
  deleteRequest,
  getRequest,
  listRequests,
  submitRequest,
  updateRequest,
  uploadRendition
} from "../controllers/requestController.js";
import { authorize, protect } from "../middleware/auth.js";
import { uploadFields } from "../middleware/upload.js";
import { ROLES } from "../utils/constants.js";
import { REQUEST_CREATOR_ROLES } from "../utils/permissions.js";

const router = Router();

router.use(protect);
router.route("/").get(listRequests).post(authorize(...REQUEST_CREATOR_ROLES), uploadFields, createRequest);
router.route("/:id").get(getRequest).put(uploadFields, updateRequest).delete(deleteRequest);
router.post("/:id/submit", submitRequest);
router.post("/:id/rendition", uploadFields, uploadRendition);
router.post("/:id/close", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), closeRequest);

export default router;
