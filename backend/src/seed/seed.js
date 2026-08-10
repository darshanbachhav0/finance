import bcrypt from "bcrypt";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import AccountingMapping from "../models/AccountingMapping.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import ApprovalRule from "../models/ApprovalRule.js";
import BankFormatConfiguration from "../models/BankFormatConfiguration.js";
import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import BudgetException from "../models/BudgetException.js";
import BudgetRule from "../models/BudgetRule.js";
import CostCenter from "../models/CostCenter.js";
import Counter from "../models/Counter.js";
import DocumentRule from "../models/DocumentRule.js";
import ExchangeRate from "../models/ExchangeRate.js";
import ExpenseType from "../models/ExpenseType.js";
import FinancialRequest from "../models/FinancialRequest.js";
import Project from "../models/Project.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import User from "../models/User.js";
import { processAccountsPayable } from "../services/accountingService.js";
import { closeFinancialRequest } from "../services/requestService.js";
import { generatedRoot, uploadRoot } from "../services/storageService.js";
import { confirmTreasuryPayment, generatePaymentBatch, reconcilePayment } from "../services/treasuryService.js";
import { connectDB } from "../config/db.js";
import {
  APPROVAL_STAGES,
  BUDGET_STATUS,
  EXPENSE_NATURE,
  REQUEST_STATUS,
  REQUEST_TYPE,
  ROLES
} from "../utils/constants.js";

dotenv.config();

const now = new Date();
const currentDate = now.toISOString().slice(0, 10);
const currentPeriod = currentDate.slice(0, 7);
const previousMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const closedPeriod = previousMonthDate.toISOString().slice(0, 7);
const fakeReq = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

async function upsert(Model, filter, values) {
  const insertOnly = Object.fromEntries(Object.entries(filter).filter(([key]) => values[key] === undefined));
  return Model.findOneAndUpdate(filter, { $set: values, $setOnInsert: insertOnly }, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });
}

async function seedCostCenters() {
  const operations = await upsert(CostCenter, { code: "CC-OPS-010" }, { name: "Operations Lima", area: "Operations", annualBudget: 500000, budgetMode: "ACTIVE", active: true });
  const administration = await upsert(CostCenter, { code: "CC-ADM-001" }, { name: "Administration", area: "Administration", annualBudget: 250000, budgetMode: "TRANSITIONAL", active: true });
  const research = await upsert(CostCenter, { code: "CC-RES-020" }, { name: "Research", area: "Research", annualBudget: 350000, budgetMode: "ACTIVE", active: true });
  return { operations, administration, research };
}

async function seedUsers(costCenters) {
  const definitions = [
    ["ERP Admin", "admin@erp.local", "Admin12345!", ROLES.ADMIN, undefined, "Systems", "*"],
    ["Solicitor User", "solicitor@erp.local", "User123456!", ROLES.SOLICITOR, undefined, "Operations", "Operations"],
    ["Area Director", "director@erp.local", "Director123!", ROLES.APPROVER, APPROVAL_STAGES.AREA_DIRECTOR, "Operations", "Operations"],
    ["Vice Rector", "vicerector@erp.local", "ViceRector123!", ROLES.APPROVER, APPROVAL_STAGES.VICE_RECTOR, "Rectorate", "*"],
    ["Accounting Analyst", "accounting@erp.local", "Accounting123!", ROLES.ACCOUNTING, undefined, "Accounting", "*"],
    ["Treasury Analyst", "treasury@erp.local", "Treasury123!", ROLES.TREASURY, undefined, "Treasury", "*"],
    ["Budget Analyst", "budget@erp.local", "Budget12345!", ROLES.BUDGET, undefined, "Budget", "*"],
    ["Management Viewer", "management@erp.local", "Management123!", ROLES.MANAGEMENT, APPROVAL_STAGES.RECTORATE, "Rectorate", "*"]
  ];
  const result = {};
  for (const [name, email, password, role, approvalLevel, area, approvalArea] of definitions) {
    const passwordHash = await bcrypt.hash(password, 12);
    result[role === ROLES.APPROVER ? approvalLevel : role] = await upsert(User, { email }, {
      name,
      email,
      passwordHash,
      role,
      approvalLevel,
      approvalAreas: approvalArea ? [approvalArea] : [],
      costCenter: role === ROLES.SOLICITOR ? costCenters.operations._id : undefined,
      authorizedCostCenters: role === ROLES.SOLICITOR ? [costCenters.operations._id] : [],
      area,
      active: true
    });
  }
  return result;
}

async function seedExpenseTypes() {
  const service = await upsert(ExpenseType, { code: "G-601" }, { name: "Professional Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, permittedRequestTypes: [REQUEST_TYPE.OPEX, REQUEST_TYPE.ENTREGA_RENDIR, REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, REQUEST_TYPE.PAGO_CON_COTIZACION], active: true });
  const capex = await upsert(ExpenseType, { code: "A-331" }, { name: "Computer Equipment", category: "CAPEX", accountingClass: "CLASS_3", accountNumber: "336101", deductible: true, permittedRequestTypes: [REQUEST_TYPE.CAPEX], active: true });
  const nonDeductible = await upsert(ExpenseType, { code: "ND-991" }, { name: "Non-deductible Expense", category: "NON_DEDUCTIBLE", accountingClass: "NON_DEDUCTIBLE", accountNumber: "991001", deductible: false, permittedRequestTypes: [REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO], active: true });
  return { service, capex, nonDeductible };
}

async function ensureEvidence(domain, entityId, name, content) {
  const directory = path.join(uploadRoot, domain, String(entityId));
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, content);
  return { originalName: name, filename: name, path: filePath, url: `/uploads/${domain}/${entityId}/${name}`, mimetype: name.endsWith(".xml") ? "application/xml" : "application/pdf", size: Buffer.byteLength(content) };
}

function minimalPdf(label) {
  return `%PDF-1.4\n% UMA DEVELOPMENT EVIDENCE: ${label}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
}

function invoiceXml({ ruc, number, date, currency = "PEN", net = 100, igv = 18, total = 118 }) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Invoice><ID>${number}</ID><IssueDate>${date}</IssueDate><DocumentCurrencyCode>${currency}</DocumentCurrencyCode><AccountingSupplierParty><Party><PartyIdentification><ID>${ruc}</ID></PartyIdentification><PartyLegalEntity><RegistrationName>UMA Demo Supplier</RegistrationName></PartyLegalEntity></Party></AccountingSupplierParty><TaxTotal><TaxAmount>${igv}</TaxAmount></TaxTotal><LegalMonetaryTotal><LineExtensionAmount>${net}</LineExtensionAmount><TaxExclusiveAmount>${net}</TaxExclusiveAmount><TaxInclusiveAmount>${total}</TaxInclusiveAmount><PayableAmount>${total}</PayableAmount></LegalMonetaryTotal></Invoice>`;
}

async function seedSupplier({ identifier, name, bank, account, cci, currency, admin }) {
  const supplier = await upsert(Supplier, { rucDni: identifier }, {
    identifierType: "RUC",
    normalizedIdentifier: identifier,
    legalName: name,
    name,
    taxAddress: "Lima, Peru",
    fiscalAddress: "Lima, Peru",
    legalRepresentative: "Development Representative",
    email: `demo-${bank.toLowerCase()}@supplier.local`,
    phone: "999999999",
    supplierType: "Development Demo",
    currency,
    bankName: bank,
    bankAccount: account,
    cci,
    taxpayerStatus: "MANUALLY_VALIDATED",
    complianceStatus: "COMPLIANT",
    homologationStatus: "HOMOLOGATED",
    active: true,
    status: "ACTIVE",
    compliance: { taxpayerActive: true, compliant: true, validatedAt: now, validatedBy: admin._id, comments: "Development seed only." },
    reviewedBy: admin._id,
    reviewedAt: now,
    reviewComments: "Development seed only. No SUNAT production validation claimed."
  });
  const documentKinds = [["RUC_FILE", "ruc.pdf"], ["BANK_CERTIFICATE", "bank-certificate.pdf"], ["LEGAL_REP_ID", "representative-id.pdf"]];
  if (!supplier.documents?.length) {
    for (const [kind, fileName] of documentKinds) {
      const file = await ensureEvidence("suppliers", supplier._id, fileName, minimalPdf(`${name} ${kind}`));
      supplier.documents.push({ kind, ...file, uploadedBy: admin._id });
    }
    await supplier.save();
  }
  const bankAccount = await upsert(SupplierBankAccount, { supplier: supplier._id, bank, currency, active: true }, { accountNumber: account, cci, validFrom: now, active: true, createdBy: admin._id, changedBy: admin._id });
  if (!(supplier.bankHistory || []).some((item) => item.status === "ACTIVE" && item.bankAccount === account)) {
    supplier.bankHistory.push({ bankName: bank, currency, bankAccount: account, cci, status: "ACTIVE", validFrom: now, createdBy: admin._id, changedBy: admin._id });
    await supplier.save();
  }
  return { supplier, bankAccount };
}

async function seedSuppliers(admin) {
  const definitions = [
    ["20123456789", "BCP Demo Supplier SAC", "BCP", "1911234567012", "00219100123456701234"],
    ["20123456780", "BBVA Demo Supplier SAC", "BBVA", "001101234567890123", "01100101234567890123"],
    ["20123456771", "Interbank Demo Supplier SAC", "INTERBANK", "200555111222", "00320000555111222001"],
    ["20123456762", "Scotiabank Demo Supplier SAC", "SCOTIABANK", "0001234567890", "00900000123456789012"]
  ];
  const result = {};
  for (const [identifier, name, bank, account, cci] of definitions) result[bank] = await seedSupplier({ identifier, name, bank, account, cci, currency: "PEN", admin });
  const usd = await seedSupplier({ identifier: "20123456753", name: "USD CAPEX Supplier SAC", bank: "BCP", account: "1917654321012", cci: "00219100765432101234", currency: "USD", admin });
  result.USD = usd;
  return result;
}

async function seedPeriodsAndRates(admin) {
  await upsert(AccountingPeriod, { period: currentPeriod }, { status: "OPEN", openedAt: now, openedBy: admin._id, comments: "Development seed period", history: [{ action: "CREATED", at: now, by: admin._id, comments: "Development seed period" }] });
  await upsert(AccountingPeriod, { period: closedPeriod }, { status: "CLOSED", openedAt: previousMonthDate, openedBy: admin._id, closedAt: now, closingDate: now, closedBy: admin._id, comments: "Closed-period control scenario", history: [{ action: "CREATED", at: previousMonthDate, by: admin._id }, { action: "CLOSED", at: now, by: admin._id, comments: "Closed-period control scenario" }] });
  await upsert(ExchangeRate, { currency: "USD", date: new Date(`${currentDate}T00:00:00.000Z`) }, { quoteCurrency: "PEN", period: currentPeriod, rate: 3.75, source: "MANUAL", sourceLabel: "Development-authorized manual selling rate", providerMode: "MANUAL", authoritative: false, active: true, createdBy: admin._id });
}

async function seedRulesAndMappings({ costCenters, expenseTypes }) {
  const approvals = [
    ["APR-OPS-DIR", "Operations Area Director", APPROVAL_STAGES.AREA_DIRECTOR, ROLES.APPROVER, "Operations", 1],
    ["APR-OPS-VR", "Operations Vice Rector", APPROVAL_STAGES.VICE_RECTOR, ROLES.APPROVER, "Operations", 2]
  ];
  for (const [_code, name, approvalLevel, role, area, sequence] of approvals) await upsert(ApprovalRule, { name }, { approvalLevel, role, area, amountFrom: 0, requestType: "*", required: true, sequence, slaHours: 24, active: true });

  const documentRules = [
    ["DOC-PAGO-COT", REQUEST_TYPE.PAGO_CON_COTIZACION, "*", [{ kind: "XML", minCount: 1, labelKey: "invoice XML" }, { kind: "PDF", minCount: 1, labelKey: "invoice PDF" }]],
    ["DOC-REEM-SUST", REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, "*", [{ kind: "XML", minCount: 1, labelKey: "invoice XML" }, { kind: "PDF", minCount: 1, labelKey: "invoice PDF" }]],
    ["DOC-GOODS", "*", EXPENSE_NATURE.GOODS, [{ kind: "QUOTATION", minCount: 3, labelKey: "three quotations" }, { kind: "PDF", minCount: 1, labelKey: "invoice or voucher" }]],
    ["DOC-SERVICES", "*", EXPENSE_NATURE.SERVICES, [{ kind: "PDF", minCount: 1, labelKey: "electronic invoice" }, { kind: "CONTRACT", minCount: 1, labelKey: "signed contract" }, { kind: "CONFORMITY", minCount: 1, labelKey: "service conformity" }]],
    ["DOC-PETTY", "*", EXPENSE_NATURE.PETTY_CASH, [{ kind: "SUPPORTING", minCount: 1, labelKey: "supporting receipts" }]],
    ["DOC-REIMB", "*", EXPENSE_NATURE.REIMBURSEMENT_LIQUIDATION, [{ kind: "SUPPORTING", minCount: 1, labelKey: "validated evidence" }]]
  ];
  for (const [code, requestType, expenseNature, requirements] of documentRules) await upsert(DocumentRule, { code }, { requestType, expenseNature, requirements, active: true });

  const mappings = [
    ["MAP-AP", "Accounts Payable", "ACCOUNTS_PAYABLE", "*", "*", "*", "*", "421201"],
    ["MAP-IGV", "Recoverable IGV", "IGV", "*", "*", "*", "*", "401111"],
    ["MAP-ADV", "Advance transit / Account 14", "ADVANCE_TRANSIT", REQUEST_TYPE.ENTREGA_RENDIR, "*", "*", "*", "141301"],
    ["MAP-RETURN", "Returned advance receivable", "RETURN_RECEIVABLE", REQUEST_TYPE.ENTREGA_RENDIR, "*", "*", "*", "101199"]
  ];
  for (const [code, name, purpose, requestType, expenseNature, bank, currency, accountNumber] of mappings) await upsert(AccountingMapping, { code }, { name, purpose, requestType, expenseNature, bank, currency, accountNumber, active: true });
  const bankAccounts = { BCP: "104101", BBVA: "104102", INTERBANK: "104103", SCOTIABANK: "104104" };
  for (const [bank, accountNumber] of Object.entries(bankAccounts)) {
    for (const currency of ["PEN", "USD"]) {
      await upsert(AccountingMapping, { code: `MAP-BANK-${bank}-${currency}` }, { name: `${bank} ${currency} bank account`, purpose: "BANK", requestType: "*", expenseNature: "*", bank, currency, accountNumber, active: true });
      await upsert(BankFormatConfiguration, { bank, currency }, { mode: "DEMO", specificationVersion: "UMA-DEMO-1", certified: false, notes: "DEMO / NOT CERTIFIED. Replace only after UMA supplies an approved specification.", active: true });
    }
  }
  await upsert(BudgetRule, { name: "Operations active budget" }, { mode: "ACTIVE", exceptionStrategy: "REJECT", costCenter: costCenters.operations._id, expenseType: expenseTypes.service._id, project: "*", active: true });
  await upsert(BudgetRule, { name: "Research extraordinary budget" }, { mode: "ACTIVE", exceptionStrategy: "EXTRAORDINARY_APPROVAL", costCenter: costCenters.research._id, expenseType: expenseTypes.capex._id, project: "*", active: true });
  await upsert(BudgetAllocation, { period: currentPeriod, costCenter: costCenters.operations._id, expenseType: expenseTypes.service._id, project: "" }, { assignedAmount: 300000, active: true });
  await upsert(BudgetAllocation, { period: currentPeriod, costCenter: costCenters.research._id, expenseType: expenseTypes.capex._id, project: "" }, { assignedAmount: 50, active: true });
  await upsert(Project, { code: "PRJ-DIGITAL-01" }, { name: "Digital Modernization", description: "Development CAPEX scenario", costCenter: costCenters.research._id, active: true });
}

async function addAttachment(request, kind, fileName, content, user) {
  const file = await ensureEvidence("requests", request._id, fileName, content);
  request.attachments.push({ kind, ...file, uploadedBy: user._id });
}

async function seedRequest({ key, number, requestType, expenseNature, currency = "PEN", supplier, requester, costCenter, expenseType, description, status = REQUEST_STATUS.DRAFT, net = 100, igv = 18, total = 118, period = currentPeriod }) {
  let request = await FinancialRequest.findOne({ developmentScenarioKey: key });
  if (request) return request;
  request = new FinancialRequest({
    developmentScenarioKey: key,
    requestNumber: number,
    issueDate: new Date(`${period === currentPeriod ? currentDate : `${period}-01`}T00:00:00.000Z`),
    accountingPeriod: period,
    requester: requester._id,
    solicitor: requester._id,
    requesterArea: requester.area,
    requestingArea: requester.area,
    requesterCostCenter: requester.costCenter,
    schoolOrDepartment: requester.area,
    requestType,
    expenseNature,
    priority: "MEDIA",
    project: requestType === REQUEST_TYPE.CAPEX ? "PRJ-DIGITAL-01" : "",
    currency,
    exchangeRate: currency === "USD" ? 3.75 : 1,
    exchangeRateDate: new Date(`${currentDate}T00:00:00.000Z`),
    exchangeRateSource: currency === "USD" ? "Development-authorized manual selling rate" : "PEN",
    supplier: supplier._id,
    supplierSnapshot: { identifierType: supplier.identifierType, identifier: supplier.normalizedIdentifier, legalName: supplier.legalName, homologationStatus: supplier.homologationStatus },
    status,
    description,
    lines: [{ costCenter: costCenter._id, expenseType: expenseType._id, netAmount: net, igvAmount: igv, totalAmount: total, currency, exchangeRate: currency === "USD" ? 3.75 : 1 }],
    draftSavedAt: now
  });
  await request.save();
  return request;
}

async function addPettyEvidence(request, user) {
  if (!(request.attachments || []).some((item) => item.kind === "SUPPORTING")) {
    await addAttachment(request, "SUPPORTING", "supporting-receipt.pdf", minimalPdf(request.requestNumber), user);
    await request.save();
  }
}

async function ensureCommitment(request, user) {
  let commitment = await BudgetCommitment.findOne({ request: request._id });
  if (!commitment) {
    commitment = await BudgetCommitment.create({
      request: request._id,
      requestNumber: request.requestNumber,
      period: request.accountingPeriod,
      lines: request.lines.map((line) => ({ costCenter: line.costCenter, expenseType: line.expenseType, amount: line.penEquivalent || line.totalAmount, mode: "TRANSITIONAL", exceptionStrategy: "REJECT" })),
      totalAmount: request.totalPENEquivalent,
      status: BUDGET_STATUS.NO_BUDGET,
      createdBy: user._id,
      reservedAt: now,
      history: [{ status: BUDGET_STATUS.NO_BUDGET, amount: request.totalPENEquivalent, by: user._id, comments: "Development workflow scenario." }]
    });
  }
  request.budgetCommitment = commitment._id;
  await request.save();
  return commitment;
}

async function seedDraftScenarios(context) {
  const { users, suppliers, costCenters, expenseTypes } = context;
  const solicitor = users[ROLES.SOLICITOR];
  const standard = await seedRequest({ key: "A_STANDARD_PEN_OPEX", number: "SOL-2026-10001", requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.PETTY_CASH, supplier: suppliers.BCP.supplier, requester: solicitor, costCenter: costCenters.operations, expenseType: expenseTypes.service, description: "A. Standard PEN OPEX end-to-end scenario" });
  await addPettyEvidence(standard, solicitor);

  await seedRequest({ key: "B_USD_CAPEX", number: "SOL-2026-10002", requestType: REQUEST_TYPE.CAPEX, expenseNature: EXPENSE_NATURE.EQUIPMENT, currency: "USD", supplier: suppliers.USD.supplier, requester: solicitor, costCenter: costCenters.research, expenseType: expenseTypes.capex, description: "B. USD CAPEX with exact-date exchange rate", net: 1000, igv: 180, total: 1180 });

  const goods = await seedRequest({ key: "C_GOODS_PO", number: "SOL-2026-10003", requestType: REQUEST_TYPE.PAGO_CON_COTIZACION, expenseNature: EXPENSE_NATURE.GOODS, supplier: suppliers.BBVA.supplier, requester: solicitor, costCenter: costCenters.operations, expenseType: expenseTypes.service, description: "C. Goods purchase with quotations and purchase-order branch" });
  if (!(goods.attachments || []).length) {
    for (let index = 1; index <= 3; index += 1) await addAttachment(goods, "QUOTATION", `quotation-${index}.pdf`, minimalPdf(`Quotation ${index}`), solicitor);
    await addAttachment(goods, "PDF", "invoice.pdf", minimalPdf("Invoice"), solicitor);
    await addAttachment(goods, "XML", "invoice.xml", invoiceXml({ ruc: suppliers.BBVA.supplier.rucDni, number: "F001-10003", date: currentDate }), solicitor);
    goods.xmlValidation = { status: "VALID", validated: true, validatedAt: now, supplierMatch: true, documentNumberMatch: null, dateMatch: true, netMatch: true, igvMatch: true, totalMatch: true, errors: [], data: { ruc: suppliers.BBVA.supplier.rucDni, invoiceNumber: "F001-10003", issueDate: currentDate, currency: "PEN", netAmount: 100, igvAmount: 18, totalAmount: 118 } };
    await goods.save();
  }

  const supported = await seedRequest({ key: "D_SUPPORTED_REIMBURSEMENT", number: "SOL-2026-10004", requestType: REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, expenseNature: EXPENSE_NATURE.ADVERTISING, supplier: suppliers.INTERBANK.supplier, requester: solicitor, costCenter: costCenters.operations, expenseType: expenseTypes.service, description: "D. Supported reimbursement with XML and PDF" });
  if (!(supported.attachments || []).length) {
    await addAttachment(supported, "PDF", "supported-reimbursement.pdf", minimalPdf("Supported reimbursement"), solicitor);
    await addAttachment(supported, "XML", "supported-reimbursement.xml", invoiceXml({ ruc: suppliers.INTERBANK.supplier.rucDni, number: "F001-10004", date: currentDate }), solicitor);
    supported.xmlValidation = { status: "VALID", validated: true, validatedAt: now, supplierMatch: true, documentNumberMatch: null, dateMatch: true, netMatch: true, igvMatch: true, totalMatch: true, errors: [], data: { ruc: suppliers.INTERBANK.supplier.rucDni, invoiceNumber: "F001-10004", issueDate: currentDate, currency: "PEN", netAmount: 100, igvAmount: 18, totalAmount: 118 } };
    await supported.save();
  }

  const unsupported = await seedRequest({ key: "E_UNSUPPORTED_REIMBURSEMENT", number: "SOL-2026-10005", requestType: REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, expenseNature: EXPENSE_NATURE.REIMBURSEMENT_LIQUIDATION, supplier: suppliers.SCOTIABANK.supplier, requester: solicitor, costCenter: costCenters.operations, expenseType: expenseTypes.nonDeductible, description: "E. Unsupported reimbursement using configured non-deductible account", net: 118, igv: 0, total: 118 });
  await addPettyEvidence(unsupported, solicitor);

  const closed = await seedRequest({ key: "I_CLOSED_PERIOD", number: "SOL-2026-10009", requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.PETTY_CASH, supplier: suppliers.BCP.supplier, requester: solicitor, costCenter: costCenters.operations, expenseType: expenseTypes.service, description: "I. Closed accounting-period control scenario", period: closedPeriod });
  await addPettyEvidence(closed, solicitor);

  const insufficient = await seedRequest({ key: "G_INSUFFICIENT_BUDGET", number: "SOL-2026-10007", requestType: REQUEST_TYPE.CAPEX, expenseNature: EXPENSE_NATURE.EQUIPMENT, supplier: suppliers.USD.supplier, requester: solicitor, costCenter: costCenters.research, expenseType: expenseTypes.capex, description: "G. Insufficient budget / extraordinary approval scenario", status: REQUEST_STATUS.VICE_RECTOR_APPROVED, net: 5000, igv: 900, total: 5900 });
  insufficient.approvalStage = APPROVAL_STAGES.COMPLETE;
  insufficient.approvalRouteSnapshot = [
    { approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR, role: ROLES.APPROVER, sequence: 1, slaHours: 24, required: true, status: "APPROVED", completedAt: now, completedBy: users[APPROVAL_STAGES.AREA_DIRECTOR]._id },
    { approvalLevel: APPROVAL_STAGES.VICE_RECTOR, role: ROLES.APPROVER, sequence: 2, slaHours: 24, required: true, status: "APPROVED", completedAt: now, completedBy: users[APPROVAL_STAGES.VICE_RECTOR]._id }
  ];
  await insufficient.save();
  await upsert(BudgetException, { request: insufficient._id, dimensionKey: `${costCenters.research._id}|${expenseTypes.capex._id}||PRJ-DIGITAL-01` }, { costCenter: costCenters.research._id, expenseType: expenseTypes.capex._id, project: "PRJ-DIGITAL-01", strategy: "EXTRAORDINARY_APPROVAL", availableAmount: 50, requestedAmount: insufficient.totalPENEquivalent, status: "PENDING", requestedBy: users[APPROVAL_STAGES.VICE_RECTOR]._id });
}

async function seedBankWorkflow(context, bank, index, { confirmAndClose = false } = {}) {
  const { users, suppliers, costCenters, expenseTypes } = context;
  const solicitor = users[ROLES.SOLICITOR];
  const request = await seedRequest({ key: `J_BANK_${bank}`, number: `SOL-2026-${String(10100 + index).padStart(5, "0")}`, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.PETTY_CASH, supplier: suppliers[bank].supplier, requester: solicitor, costCenter: costCenters.administration, expenseType: expenseTypes.service, description: `J. ${bank} demo bank batch scenario`, status: REQUEST_STATUS.BUDGET_COMMITTED });
  await addPettyEvidence(request, solicitor);
  await ensureCommitment(request, users[ROLES.BUDGET]);
  if (request.status === REQUEST_STATUS.BUDGET_COMMITTED) {
    await processAccountsPayable({
      requestId: request._id,
      payload: { documentType: "FACTURA", series: `F${index}01`, number: `BANK-${index}`, documentDate: currentDate, accountingDate: currentDate, fiscalPeriod: currentPeriod, accountNumber: expenseTypes.service.accountNumber, comments: "Development bank scenario" },
      user: users[ROLES.ACCOUNTING],
      req: fakeReq
    });
  }
  const refreshed = await FinancialRequest.findById(request._id);
  if (refreshed.status === REQUEST_STATUS.ACCOUNTED) {
    await generatePaymentBatch({ requestIds: [request._id.toString()], bank, currency: "PEN", paymentDate: currentDate, user: users[ROLES.TREASURY], req: fakeReq });
  }
  const afterBatch = await FinancialRequest.findById(request._id);
  if (confirmAndClose && afterBatch.status === REQUEST_STATUS.BANK_FILE_GENERATED) {
    await confirmTreasuryPayment({ requestId: request._id, payload: { operationNumber: `DEV-${bank}-001`, paidAt: currentDate, confirmedAmount: 118, comments: "Development payment confirmation" }, user: users[ROLES.TREASURY], req: fakeReq });
  }
  const afterPayment = await FinancialRequest.findById(request._id);
  if (confirmAndClose && afterPayment.status === REQUEST_STATUS.PAID) {
    await reconcilePayment({ requestId: request._id, payload: { bankReference: `STM-${bank}-001`, statementAmount: 118, comments: "Development manual reconciliation" }, user: users[ROLES.TREASURY], req: fakeReq });
    await closeFinancialRequest({ id: request._id, user: users[ROLES.ACCOUNTING], req: fakeReq, comments: "Development scenario closed after reconciliation." });
  }
}

async function seedAdvanceScenario(context) {
  const { users, suppliers, costCenters, expenseTypes } = context;
  const request = await seedRequest({ key: "F_ENTREGA_RENDIR", number: "SOL-2026-10006", requestType: REQUEST_TYPE.ENTREGA_RENDIR, expenseNature: EXPENSE_NATURE.PETTY_CASH, supplier: suppliers.BCP.supplier, requester: users[ROLES.SOLICITOR], costCenter: costCenters.operations, expenseType: expenseTypes.service, description: "F. Entrega a Rendir advance / Account 14 scenario", status: REQUEST_STATUS.BUDGET_COMMITTED });
  await addPettyEvidence(request, users[ROLES.SOLICITOR]);
  await ensureCommitment(request, users[ROLES.BUDGET]);
  if (request.status === REQUEST_STATUS.BUDGET_COMMITTED) {
    await processAccountsPayable({ requestId: request._id, payload: { documentType: "RECIBO_INTERNO", series: "ADV", number: "10006", documentDate: currentDate, accountingDate: currentDate, fiscalPeriod: currentPeriod, accountNumber: "141301", comments: "Development advance" }, user: users[ROLES.ACCOUNTING], req: fakeReq });
  }
  const accounted = await FinancialRequest.findById(request._id);
  if (accounted.status === REQUEST_STATUS.ACCOUNTED) await generatePaymentBatch({ requestIds: [request._id.toString()], bank: "BCP", currency: "PEN", paymentDate: currentDate, user: users[ROLES.TREASURY], req: fakeReq });
  const generated = await FinancialRequest.findById(request._id);
  if (generated.status === REQUEST_STATUS.BANK_FILE_GENERATED) await confirmTreasuryPayment({ requestId: request._id, payload: { operationNumber: "DEV-ADV-10006", paidAt: currentDate, confirmedAmount: 118, comments: "Development advance paid" }, user: users[ROLES.TREASURY], req: fakeReq });
}

async function seed() {
  if (process.env.NODE_ENV === "production") throw new Error("Development seed is disabled in production.");
  await connectDB();
  await fs.mkdir(generatedRoot, { recursive: true });
  const costCenters = await seedCostCenters();
  const users = await seedUsers(costCenters);
  const expenseTypes = await seedExpenseTypes();
  const suppliers = await seedSuppliers(users[ROLES.ADMIN]);
  await seedPeriodsAndRates(users[ROLES.ADMIN]);
  await seedRulesAndMappings({ costCenters, expenseTypes });
  const context = { users, suppliers, costCenters, expenseTypes };
  await seedDraftScenarios(context);
  await seedBankWorkflow(context, "BCP", 1, { confirmAndClose: true });
  await seedBankWorkflow(context, "BBVA", 2);
  await seedBankWorkflow(context, "INTERBANK", 3);
  await seedBankWorkflow(context, "SCOTIABANK", 4);
  await seedAdvanceScenario(context);
  await Counter.updateOne({ key: "financial-request", year: 2026 }, { $max: { sequence: 10200 } }, { upsert: true });
  console.log("Development seed completed. Credentials are documented as development-only in docs/DEVELOPMENT_SEED.md.");
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
