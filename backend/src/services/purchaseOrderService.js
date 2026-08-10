import PurchaseOrder from "../models/PurchaseOrder.js";
import { recordAudit } from "./auditService.js";
import { nextPurchaseOrderNumber } from "./sequenceService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, REQUEST_STATUS, REQUEST_TYPE } from "../utils/constants.js";

export async function generatePurchaseOrder(request, user, req, { session } = {}) {
  if (request.requestType !== REQUEST_TYPE.PAGO_CON_COTIZACION || ![REQUEST_STATUS.VICE_RECTOR_APPROVED, REQUEST_STATUS.BUDGET_COMMITTED].includes(request.status)) {
    throw new AppError(409, "A purchase order can only be issued for an approved Pago con Cotizacion request.", { requestType: request.requestType, status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const existing = await PurchaseOrder.findOne({ request: request._id }).session(session || null);
  if (existing) return existing;
  const poNumber = await nextPurchaseOrderNumber(request.issueDate);
  const [purchaseOrder] = await PurchaseOrder.create([{
    poNumber,
    request: request._id,
    supplier: request.supplier?._id || request.supplier,
    amount: request.totalAmount,
    currency: request.currency,
    issueDate: new Date(),
    status: "ISSUED",
    generatedBy: user._id
  }], session ? { session } : undefined);
  await recordAudit({
    entityType: "PurchaseOrder",
    entity: purchaseOrder,
    requestId: request._id,
    action: "ISSUED",
    user,
    req,
    module: "PURCHASE_ORDERS",
    newValues: { poNumber, amount: purchaseOrder.amount, currency: purchaseOrder.currency },
    session
  });
  return purchaseOrder;
}
