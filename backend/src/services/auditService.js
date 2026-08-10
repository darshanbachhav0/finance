import AuditLog from "../models/AuditLog.js";

export function clientIp(req) {
  return String(req.headers?.["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

export function electronicSignature(user, createdAt = new Date()) {
  const actor = String(user?._id || "system").slice(-8).toUpperCase();
  return `UMA-${actor}-${createdAt.getTime().toString(36).toUpperCase()}`;
}

export function workflowEvent({ action, from = null, to, user, req, comments, stage, dueAt }) {
  const createdAt = new Date();
  return {
    action,
    statusFrom: from,
    statusTo: to,
    actor: user?._id,
    role: user?.role,
    comments,
    ip: clientIp(req),
    signature: electronicSignature(user, createdAt),
    stage,
    dueAt,
    createdAt
  };
}

export async function recordAudit({ entityType, entity, action, user, req, comments, changes = {} }) {
  return AuditLog.create({
    entityType,
    entityId: entity._id || entity,
    requestNumber: entity.requestNumber,
    action,
    actor: user?._id,
    role: user?.role,
    ip: clientIp(req),
    comments,
    changes
  });
}
