import { REQUEST_STATUS, ROLES } from "./constants.js";

export const SUPPLIER_VIEW_ROLES = [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.SOLICITOR];
export const REQUEST_CREATOR_ROLES = [ROLES.ADMIN, ROLES.SOLICITOR];

export function canCreateRequest(role) {
  return REQUEST_CREATOR_ROLES.includes(role);
}

export function canViewSuppliers(role) {
  return SUPPLIER_VIEW_ROLES.includes(role);
}

export function canModifyRequest(request, user) {
  if (!request || !user) return false;
  if (user.role === ROLES.ADMIN) return true;
  const ownerId = request.solicitor?._id || request.solicitor;
  return (
    user.role === ROLES.SOLICITOR &&
    String(ownerId) === String(user._id) &&
    [REQUEST_STATUS.DRAFT, REQUEST_STATUS.REJECTED].includes(request.status)
  );
}

export function canViewRequest(request, user) {
  if (!request || !user) return false;
  if (user.role === ROLES.SOLICITOR) {
    return String(request.solicitor?._id || request.solicitor) === String(user._id);
  }
  if (user.role === ROLES.APPROVER) return request.status !== REQUEST_STATUS.DRAFT;
  return true;
}
