import assert from "node:assert/strict";
import test from "node:test";
import { assertMandatoryDocuments, assertRequestLines } from "../src/services/requestRules.js";
import { MANDATORY_XML_TYPES } from "../src/utils/constants.js";

test("mandatory invoice request types require both XML and PDF", () => {
  const request = { requestType: MANDATORY_XML_TYPES[0], attachments: [{ kind: "XML" }] };
  assert.throws(() => assertMandatoryDocuments(request), (error) => {
    assert.equal(error.statusCode, 422);
    assert.match(error.message, /PDF/);
    return true;
  });

  assert.doesNotThrow(() => assertMandatoryDocuments({
    requestType: MANDATORY_XML_TYPES[0],
    attachments: [{ kind: "XML" }, { kind: "PDF" }]
  }));
});

test("request types outside the mandatory XML list can be saved without invoice files", () => {
  assert.doesNotThrow(() => assertMandatoryDocuments({ requestType: "OPEX", attachments: [] }));
});

test("every request needs at least one fully dimensioned accounting line", () => {
  assert.throws(() => assertRequestLines([]), (error) => error.statusCode === 422);
  assert.throws(
    () => assertRequestLines([{ costCenter: "cost-1" }]),
    (error) => error.statusCode === 422 && /Expense Type/.test(error.message)
  );
  assert.doesNotThrow(() => assertRequestLines([{ costCenter: "cost-1", expenseType: "expense-1" }]));
});
