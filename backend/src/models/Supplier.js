import mongoose from "mongoose";

const bankHistorySchema = new mongoose.Schema(
  {
    bankName: String,
    bankAccount: String,
    cci: String,
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "INACTIVE" },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { _id: false }
);

const supplierSchema = new mongoose.Schema(
  {
    rucDni: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    bankName: { type: String, trim: true },
    bankAccount: { type: String, trim: true },
    cci: { type: String, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    bankHistory: [bankHistorySchema]
  },
  { timestamps: true }
);

const Supplier = mongoose.model("Supplier", supplierSchema);
export default Supplier;
