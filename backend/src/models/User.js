import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { APPROVAL_STAGES, ROLES } from "../utils/constants.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.SOLICITOR,
      required: true
    },
    approvalLevel: {
      type: String,
      enum: [APPROVAL_STAGES.AREA_DIRECTOR, APPROVAL_STAGES.VICE_RECTOR],
      default: APPROVAL_STAGES.AREA_DIRECTOR
    },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
    area: { type: String, trim: true, default: "General" },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

const User = mongoose.model("User", userSchema);
export default User;
