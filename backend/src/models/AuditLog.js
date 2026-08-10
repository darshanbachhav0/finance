import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    requestNumber: String,
    action: { type: String, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    role: String,
    ip: String,
    comments: String,
    changes: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

function immutable(next) {
  next(new Error("Audit records are append-only and cannot be changed or deleted."));
}

auditLogSchema.pre("updateOne", immutable);
auditLogSchema.pre("updateMany", immutable);
auditLogSchema.pre("findOneAndUpdate", immutable);
auditLogSchema.pre("deleteOne", immutable);
auditLogSchema.pre("deleteMany", immutable);
auditLogSchema.pre("findOneAndDelete", immutable);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
