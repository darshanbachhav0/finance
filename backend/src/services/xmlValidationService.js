import fs from "fs/promises";
import { XMLParser } from "fast-xml-parser";
import { AppError } from "../utils/AppError.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: true,
  trimValues: true
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function localValue(value) {
  if (value && typeof value === "object" && "#text" in value) return value["#text"];
  return value;
}

function findSection(node, name) {
  if (!node || typeof node !== "object") return null;
  for (const [key, value] of Object.entries(node)) {
    if (key === name) return value;
    for (const child of asArray(value)) {
      const found = findSection(child, name);
      if (found) return found;
    }
  }
  return null;
}

function findAllValues(node, name, values = []) {
  if (!node || typeof node !== "object") return values;
  for (const [key, value] of Object.entries(node)) {
    if (key === name) {
      for (const item of asArray(value)) values.push(localValue(item));
    }
    for (const child of asArray(value)) {
      if (child && typeof child === "object") findAllValues(child, name, values);
    }
  }
  return values;
}

function findFirstValue(node, names) {
  for (const name of names) {
    const value = findAllValues(node, name).find((item) => item !== undefined && item !== null && item !== "");
    if (value !== undefined) return value;
  }
  return undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function amountsMatch(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= 0.02;
}

export async function parseInvoiceXml(filePath) {
  const xml = await fs.readFile(filePath, "utf8");
  const parsed = parser.parse(xml);
  const root = parsed.Invoice || parsed.CreditNote || parsed.DebitNote || parsed;
  const supplierParty = findSection(root, "AccountingSupplierParty") || findSection(root, "SupplierParty") || root;
  const legalTotal = findSection(root, "LegalMonetaryTotal") || root;
  const taxTotal = findSection(root, "TaxTotal") || root;
  const taxSubtotal = findSection(root, "TaxSubtotal") || root;

  const data = {
    ruc: String(findFirstValue(supplierParty, ["CompanyID", "ID"]) || "").trim(),
    supplierName: String(findFirstValue(supplierParty, ["RegistrationName", "Name"]) || "").trim(),
    invoiceNumber: String(findFirstValue(root, ["ID"]) || "").trim(),
    issueDate: String(findFirstValue(root, ["IssueDate"]) || "").trim(),
    netAmount: toNumber(findFirstValue(legalTotal, ["LineExtensionAmount", "TaxExclusiveAmount"])) ?? toNumber(findFirstValue(taxSubtotal, ["TaxableAmount"])),
    igvAmount: toNumber(findFirstValue(taxTotal, ["TaxAmount"])),
    totalAmount: toNumber(findFirstValue(legalTotal, ["PayableAmount", "TaxInclusiveAmount"]))
  };

  return data;
}

export async function validateXmlAgainstRequest(filePath, requestData) {
  const data = await parseInvoiceXml(filePath);
  const errors = [];

  if (!data.ruc) errors.push("XML does not include supplier RUC/DNI.");
  if (requestData.supplier?.rucDni && data.ruc && data.ruc !== requestData.supplier.rucDni) {
    errors.push(`Supplier RUC/DNI does not match XML. Form: ${requestData.supplier.rucDni}, XML: ${data.ruc}.`);
  }
  if (data.netAmount !== undefined && !amountsMatch(data.netAmount, requestData.netAmount)) {
    errors.push(`Net amount does not match XML. Form: ${requestData.netAmount}, XML: ${data.netAmount}.`);
  }
  if (data.igvAmount !== undefined && !amountsMatch(data.igvAmount, requestData.igvAmount)) {
    errors.push(`IGV amount does not match XML. Form: ${requestData.igvAmount}, XML: ${data.igvAmount}.`);
  }
  if (data.totalAmount !== undefined && !amountsMatch(data.totalAmount, requestData.totalAmount)) {
    errors.push(`Total amount does not match XML. Form: ${requestData.totalAmount}, XML: ${data.totalAmount}.`);
  }

  if (errors.length > 0) {
    throw new AppError(422, "XML validation failed.", { errors, data });
  }

  return {
    validated: true,
    validatedAt: new Date(),
    errorMessages: [],
    data
  };
}
