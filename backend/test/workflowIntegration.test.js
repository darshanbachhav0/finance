import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AuditLog from "../src/models/AuditLog.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import { recordAudit } from "../src/services/auditService.js";
import { executeBudget, reserveBudget } from "../src/services/budgetService.js";

test("budget, fiscal duplicate, and immutable audit controls work together", { timeout: 30000 }, async () => {
  const databaseName = `erp_financial_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([FinancialRequest.init(), AuditLog.init()]);
    const user = await User.create({ name: "Test Admin", email: `admin-${Date.now()}@test.local`, passwordHash: "not-used", role: "Admin", area: "Test" });
    const supplier = await Supplier.create({ rucDni: "20111111111", name: "Integration Supplier", status: "ACTIVE" });
    const center = await CostCenter.create({ code: "CC-TEST", name: "Test Center", area: "Test", annualBudget: 1000, budgetMode: "ACTIVE", active: true });
    const expense = await ExpenseType.create({ code: "EXP-TEST", name: "Test Service", category: "OPEX", accountingClass: "Class 6", accountNumber: "630001", active: true });

    const request = await FinancialRequest.create({
      requestType: "OPEX",
      expenseNature: "Contratación de Servicios",
      issueDate: new Date("2026-08-01T00:00:00.000Z"),
      accountingPeriod: "2026-08",
      currency: "PEN",
      supplier: supplier._id,
      solicitor: user._id,
      description: "Integration workflow request",
      status: "COMPROMISO_PRESUPUESTAL",
      lines: [{ costCenter: center._id, expenseType: expense._id, netAmount: 100, igvAmount: 18, totalAmount: 118, penEquivalent: 118 }]
    });

    const commitment = await reserveBudget(request, user._id);
    assert.equal(commitment.status, "RESERVED");
    assert.equal((await CostCenter.findById(center._id)).committedAmount, 118);
    await executeBudget(request, user._id);
    const executedCenter = await CostCenter.findById(center._id);
    assert.equal(executedCenter.committedAmount, 0);
    assert.equal(executedCenter.executedAmount, 118);
    assert.equal(executedCenter.paidAmount, 118);

    request.fiscalData = { documentType: "FACTURA", series: "F001", number: "123", documentDate: new Date(), accountingDate: new Date(), fiscalPeriod: "2026-08", accountNumber: "42" };
    await request.save();
    await assert.rejects(() => FinancialRequest.create({
      requestType: "OPEX",
      issueDate: new Date("2026-08-02T00:00:00.000Z"),
      accountingPeriod: "2026-08",
      currency: "PEN",
      supplier: supplier._id,
      solicitor: user._id,
      description: "Duplicate fiscal request",
      lines: [{ costCenter: center._id, expenseType: expense._id, netAmount: 10, igvAmount: 1.8, totalAmount: 11.8 }],
      fiscalData: { documentType: "FACTURA", series: "F001", number: "123", documentDate: new Date(), accountingDate: new Date(), fiscalPeriod: "2026-08", accountNumber: "42" }
    }), (error) => error?.code === 11000);

    const audit = await recordAudit({ entityType: "FinancialRequest", entity: request, action: "TESTED", user, req: { headers: {}, ip: "127.0.0.1" } });
    await assert.rejects(() => AuditLog.deleteOne({ _id: audit._id }), /append-only/);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
