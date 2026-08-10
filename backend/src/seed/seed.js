import bcrypt from "bcrypt";
import dotenv from "dotenv";
import mongoose from "mongoose";
import AccountingPeriod from "../models/AccountingPeriod.js";
import CostCenter from "../models/CostCenter.js";
import ExchangeRate from "../models/ExchangeRate.js";
import ExpenseType from "../models/ExpenseType.js";
import Supplier from "../models/Supplier.js";
import User from "../models/User.js";
import { connectDB } from "../config/db.js";
import { APPROVAL_STAGES, ROLES } from "../utils/constants.js";

dotenv.config();

async function upsertUser({ name, email, password, role, approvalLevel, area }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return User.findOneAndUpdate(
    { email },
    { name, email, passwordHash, role, approvalLevel, area, active: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function seed() {
  await connectDB();

  const users = await Promise.all([
    upsertUser({ name: "ERP Admin", email: "admin@erp.local", password: "Admin123!", role: ROLES.ADMIN, area: "Systems" }),
    upsertUser({ name: "Solicitor User", email: "solicitor@erp.local", password: "User123!", role: ROLES.SOLICITOR, area: "Operations" }),
    upsertUser({ name: "Area Director", email: "approver@erp.local", password: "Approver123!", role: ROLES.APPROVER, approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR, area: "Management" }),
    upsertUser({ name: "Vice Rector Approver", email: "vicerector@erp.local", password: "Approver123!", role: ROLES.APPROVER, approvalLevel: APPROVAL_STAGES.VICE_RECTOR, area: "Rectorate" }),
    upsertUser({ name: "Accounting Analyst", email: "accounting@erp.local", password: "Accounting123!", role: ROLES.ACCOUNTING, area: "Accounting" }),
    upsertUser({ name: "Treasury Analyst", email: "treasury@erp.local", password: "Treasury123!", role: ROLES.TREASURY, area: "Treasury" })
  ]);

  const admin = users[0];

  await Supplier.bulkWrite([
    {
      updateOne: {
        filter: { rucDni: "20123456789" },
        update: {
          $set: {
            rucDni: "20123456789",
            name: "Servicios Industriales Andinos SAC",
            bankName: "BCP",
            bankAccount: "191-1234567-0-12",
            cci: "00219100123456701234",
            status: "ACTIVE"
          },
          $setOnInsert: {
            bankHistory: [{ bankName: "BCP", bankAccount: "191-1234567-0-12", cci: "00219100123456701234", status: "ACTIVE", changedBy: admin._id }]
          }
        },
        upsert: true
      }
    },
    {
      updateOne: {
        filter: { rucDni: "10456789123" },
        update: {
          $set: {
            rucDni: "10456789123",
            name: "Proveedor Independiente Lima",
            bankName: "Interbank",
            bankAccount: "200-555111222",
            cci: "00320000555111222001",
            status: "ACTIVE"
          },
          $setOnInsert: {
            bankHistory: [{ bankName: "Interbank", bankAccount: "200-555111222", cci: "00320000555111222001", status: "ACTIVE", changedBy: admin._id }]
          }
        },
        upsert: true
      }
    }
  ]);

  await CostCenter.bulkWrite([
    {
      updateOne: {
        filter: { code: "CC-ADM-001" },
        update: {
          $set: { name: "Administration", area: "Corporate", budgetMode: "ACTIVE", active: true },
          $setOnInsert: { code: "CC-ADM-001", annualBudget: 250000, committedAmount: 0, executedAmount: 42000, paidAmount: 42000, availableAmount: 208000 }
        },
        upsert: true
      }
    },
    {
      updateOne: {
        filter: { code: "CC-OPS-010" },
        update: {
          $set: { name: "Operations Lima", area: "Operations", budgetMode: "ACTIVE", active: true },
          $setOnInsert: { code: "CC-OPS-010", annualBudget: 500000, committedAmount: 0, executedAmount: 118500, paidAmount: 118500, availableAmount: 381500 }
        },
        upsert: true
      }
    }
  ]);

  await ExpenseType.bulkWrite([
    {
      updateOne: {
        filter: { code: "G-601" },
        update: { $set: { code: "G-601", name: "Professional Services", category: "OPEX", accountingClass: "Class 6", accountNumber: "632101", active: true } },
        upsert: true
      }
    },
    {
      updateOne: {
        filter: { code: "A-331" },
        update: { $set: { code: "A-331", name: "Computer Equipment", category: "CAPEX", accountingClass: "Class 3", accountNumber: "336101", active: true } },
        upsert: true
      }
    },
    {
      updateOne: {
        filter: { code: "ND-991" },
        update: { $set: { code: "ND-991", name: "Non-deductible Expense", category: "Non-deductible", accountingClass: "Account 99", accountNumber: "991001", active: true } },
        upsert: true
      }
    }
  ]);

  const now = new Date();
  const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  await Promise.all(
    ["2026-07", currentPeriod].map((period) =>
      AccountingPeriod.findOneAndUpdate(
        { period },
        { $setOnInsert: { period, status: "OPEN" } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    )
  );

  await ExchangeRate.findOneAndUpdate(
    { date: new Date("2026-07-08T00:00:00.000Z") },
    {
      date: new Date("2026-07-08T00:00:00.000Z"),
      period: "2026-07",
      rate: 3.75,
      source: "Manual SUNAT selling rate",
      createdBy: admin._id
    },
    { upsert: true, new: true }
  );

  console.log("Seed completed.");
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
