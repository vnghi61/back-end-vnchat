import { AuditLog } from "../models/admin.model.js";

// Ghi audit không bao giờ làm hỏng request gốc.
export async function audit(req, action, { targetType, targetId, metadata } = {}) {
  try {
    await AuditLog.create({
      actorId: req?.user?._id,
      actorKind: req?.user?.kind ?? (req?.apiKey ? "apikey" : undefined),
      action,
      targetType,
      targetId: targetId != null ? String(targetId) : undefined,
      metadata,
      ip: req?.ip,
    });
  } catch (error) {
    console.log("Error writing audit log", error.message);
  }
}
