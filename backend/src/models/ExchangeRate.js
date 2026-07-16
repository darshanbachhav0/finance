import mongoose from "mongoose";

const exchangeRateSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, unique: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    rate: { type: Number, required: true, min: 0 },
    source: { type: String, default: "Manual SUNAT selling rate" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

const ExchangeRate = mongoose.model("ExchangeRate", exchangeRateSchema);
export default ExchangeRate;
