import test from "node:test";
import assert from "node:assert/strict";
import {
  TABLES,
  PORTAL_KEY,
  createPortal,
  getPeriod,
  ensurePeriod,
  updateSelectedPeriod,
  loadPortal,
  savePortal,
  upsertGstr1Record,
  deleteGstr1Record,
  gstr1Totals,
  taxForRecord,
  fileGstr1,
  setImsAction,
  setImsActions,
  computeGstr2b,
  generateGstr2b,
  savePartAAdjustments,
  preparePartA,
  lockPreparedReturn,
  recordGstr3bFiling,
  getOpeningLedgers,
} from "../src/gst/portalStore.js";
import {
  createWorkspace,
  getPaymentInputs,
  createChallan,
  markChallanPaid,
  offsetLiabilities,
  requestEvc,
  verifyEvc,
} from "../src/gst/practiceStore.js";
import { calculatePayment, emptyHeads } from "../src/gst/paymentEngine.js";
const H = (igst = 0, cgst = 0, sgst = 0, cess = 0) => ({
  igst,
  cgst,
  sgst,
  cess,
});
const fixture = () => createPortal();
const sale = (extra) => ({
  tableId: "b2b",
  recipientGstin: "27AAAPB0002B1Z4",
  recipientName: "Sample Customer",
  invoiceNo: "TEST-001",
  date: "2026-09-12",
  pos: "27",
  taxable: 100000,
  rate: 18,
  cess: 0,
  documentType: "invoice",
  ...extra,
});
const file = (s) =>
  fileGstr1(s, {
    declaration: true,
    signatoryId: s.taxpayer.signatories[0].id,
  });
const ready = () => generateGstr2b(file(fixture()));
function storage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
    data,
  };
}
function posted(state) {
  const partA = preparePartA(state);
  let ws = createWorkspace({
    gstin: state.taxpayer.gstin,
    period: state.selectedPeriod,
    partA,
    opening: getOpeningLedgers(state),
  });
  const shortfall = calculatePayment(getPaymentInputs(ws)).cashShortfall;
  ws = createChallan(ws, { amounts: shortfall });
  ws = markChallanPaid(ws, ws.challans[0].id);
  return offsetLiabilities(ws);
}

test("fifteen grouped statutory cards retain Table 10 and separate e-commerce sections 14 and 15", () => {
  assert.equal(TABLES.length, 15);
  assert.equal(new Set(TABLES.map((t) => t.id)).size, 15);
  assert.ok(TABLES.find((t) => t.id === "amend-b2cs" && t.number === "10"));
  assert.ok(TABLES.find((t) => t.id === "ecommerce"));
  assert.ok(TABLES.find((t) => t.id === "ecommerce95"));
});
test("seed uses completed September period and HSN/documents never double-count output liability", () => {
  const s = fixture(),
    t = gstr1Totals(s);
  assert.equal(s.selectedPeriod, "2026-09");
  assert.deepEqual(t.liabilities.A, H(1800000, 2400000, 2400000));
  assert.equal(t.totalTax, 6600000);
  assert.equal(t.byTable.documents.recordCount, 1);
  assert.equal(t.byTable.hsn.recordCount, 3);
  assert.equal(t.byTable.hsn.taxable, t.taxable);
  assert.equal(
    getPeriod(s).gstr1.records.filter(
      (r) => r.tableId === "hsn" && r.hsnCategory === "B2C",
    ).length,
    2,
  );
});
test("invoice taxes use place of supply, exact half rates, and strict integer paise", () => {
  const s = fixture();
  assert.deepEqual(
    taxForRecord(s, sale({ taxable: 101, rate: 5, pos: "24" })),
    { taxable: 101, igst: 0, cgst: 3, sgst: 3, cess: 0, totalTax: 6 },
  );
  assert.equal(
    taxForRecord(s, sale({ taxable: 101, rate: 5, pos: "27" })).igst,
    5,
  );
  assert.throws(
    () => upsertGstr1Record(s, sale({ taxable: 1.5 })),
    /integer paise/,
  );
  assert.throws(
    () => upsertGstr1Record(s, sale({ taxable: -100 })),
    /integer paise/,
  );
  assert.throws(() => upsertGstr1Record(s, sale({ rate: 18.123 })), /GST rate/);
  assert.throws(
    () => upsertGstr1Record(s, sale({ date: "2026-08-12" })),
    /selected return/,
  );
});
test("B2CL applies inter-state unregistered invoice-value threshold above one lakh", () => {
  const s = fixture();
  assert.throws(
    () =>
      upsertGstr1Record(
        s,
        sale({ tableId: "b2cl", recipientGstin: "", taxable: 8000000 }),
      ),
    /above ₹1 lakh/,
  );
  const large = upsertGstr1Record(
    s,
    sale({ tableId: "b2cl", recipientGstin: "", taxable: 9000000 }),
  );
  assert.equal(getPeriod(large).gstr1.records.at(-1).invoiceValue, 10620000);
  assert.throws(
    () =>
      upsertGstr1Record(
        s,
        sale({
          tableId: "b2cl",
          recipientGstin: "",
          taxable: 9000000,
          pos: "24",
        }),
      ),
    /inter-state/,
  );
  assert.throws(
    () =>
      upsertGstr1Record(
        s,
        sale({ tableId: "b2cs", recipientGstin: "", taxable: 9000000 }),
      ),
    /B2C Large/,
  );
});
test("credit notes reduce liability, debit notes increase it, exports without payment and section14 do not add tax", () => {
  let s = fixture();
  const base = gstr1Totals(s).liabilities.A.igst;
  s = upsertGstr1Record(
    s,
    sale({
      tableId: "cdnr",
      invoiceNo: "CN-TEST",
      documentType: "credit-note",
    }),
  );
  assert.equal(gstr1Totals(s).liabilities.A.igst, base - 18000);
  s = upsertGstr1Record(
    s,
    sale({ tableId: "cdnr", invoiceNo: "DN-TEST", documentType: "debit-note" }),
  );
  assert.equal(gstr1Totals(s).liabilities.A.igst, base);
  s = upsertGstr1Record(
    s,
    sale({
      tableId: "exports",
      invoiceNo: "EXP-TEST",
      recipientGstin: "",
      exportType: "without-payment",
    }),
  );
  assert.equal(gstr1Totals(s).liabilities.A.igst, base);
  s = upsertGstr1Record(
    s,
    sale({ tableId: "ecommerce", invoiceNo: "ECO-TEST", subType: "14a" }),
  );
  assert.equal(gstr1Totals(s).liabilities.A.igst, base);
  s = upsertGstr1Record(
    s,
    sale({ tableId: "ecommerce95", invoiceNo: "ECO95-TEST" }),
  );
  assert.equal(gstr1Totals(s).liabilities.B.igst, 18000);
});
test("prior-period amendments apply revised-minus-original delta and duplicate originals are blocked", () => {
  let s = fixture();
  assert.throws(
    () =>
      upsertGstr1Record(
        s,
        sale({
          tableId: "amend-invoices",
          invoiceNo: "AM-001",
          originalId: "SALE-001",
          taxable: 12000000,
        }),
      ),
    /earlier return period/,
  );
  s = updateSelectedPeriod(file(s), "2026-10");
  s = upsertGstr1Record(
    s,
    sale({
      tableId: "amend-invoices",
      invoiceNo: "AM-OCT",
      date: "2026-09-04",
      originalId: "SALE-001",
      originalPeriod: "2026-09",
      taxable: 12000000,
    }),
  );
  assert.equal(gstr1Totals(s).liabilities.A.igst, 360000);
  assert.throws(
    () =>
      upsertGstr1Record(
        s,
        sale({
          tableId: "amend-invoices",
          invoiceNo: "AM-OCT2",
          date: "2026-09-04",
          originalId: "SALE-001",
          originalPeriod: "2026-09",
          taxable: 13000000,
        }),
      ),
    /already has an amendment/,
  );
  const amendment = getPeriod(s).gstr1.records[0];
  s = deleteGstr1Record(s, amendment.id);
  assert.equal(gstr1Totals(s).liabilities.A.igst, 0);
});
test("GSTR1 filing requires declaration, signatory and required summary/documents; nil return remains possible", () => {
  const s = fixture();
  assert.throws(
    () => fileGstr1(s, { declaration: false, signatoryId: "sample-signatory" }),
    /declaration/,
  );
  assert.throws(
    () => fileGstr1(s, { declaration: true, signatoryId: "missing" }),
    /signatory/,
  );
  let missing = createPortal({ seed: false });
  missing = upsertGstr1Record(missing, sale());
  assert.throws(() => file(missing), /HSN/);
  missing = upsertGstr1Record(missing, {
    tableId: "hsn",
    hsn: "8471",
    description: "Sample goods",
    quantity: 1,
    uqc: "NOS",
    taxable: 100000,
    rate: 18,
    pos: "27",
  });
  assert.throws(() => file(missing), /Table 13/);
  const filed = file(s);
  assert.equal(getPeriod(filed).gstr1.status, "filed");
  assert.match(getPeriod(filed).gstr1.receipt.reference, /^PRACTICE-GSTR1-/);
  assert.throws(
    () => upsertGstr1Record(filed, sale()),
    /already filed|is filed/,
  );
  assert.equal(
    getPeriod(file(createPortal({ seed: false }))).gstr1.status,
    "filed",
  );
});
test("IMS accepts no-action and accepted supplier-filed documents, excludes pending/rejected/unfiled/ineligible", () => {
  const s = fixture(),
    b = computeGstr2b(s);
  assert.deepEqual(b.itc, H(2700000, 1710000, 1710000));
  assert.equal(b.eligibleRecords.length, 3);
  assert.equal(b.unfiledRecords.length, 1);
  assert.equal(b.ineligibleRecords.length, 1);
  assert.ok(!b.records.some((r) => r.id === "IMS-006"));
  assert.ok(b.excludedRecords.some((r) => r.id === "IMS-004"));
  const changed = setImsActions(s, ["IMS-004", "IMS-005"], "accepted");
  assert.equal(changed.revision, s.revision + 1);
  assert.equal(getPeriod(changed).ims.version, 1);
  assert.equal(computeGstr2b(changed).itc.igst, 3240000);
  assert.throws(
    () => setImsActions(s, ["IMS-004", "missing"], "accepted"),
    /not found/,
  );
  assert.equal(
    getPeriod(s).ims.records.find((r) => r.id === "IMS-004").action,
    "pending",
  );
  assert.throws(() => setImsAction(s, "IMS-007", "accepted"), /bypass IMS/);
});
test("credit-note Pending and declared reduction respect period limits and tax-head bounds", () => {
  const s = fixture();
  const pending = setImsAction(s, "IMS-003", "pending", {
    remarks: "Verify prior ITC claim",
  });
  assert.equal(computeGstr2b(pending).itc.cgst, 1800000);
  const reduced = setImsAction(s, "IMS-003", "accepted", {
    itcReduction: H(0, 40000, 50000),
    remarks: "Partly availed",
  });
  assert.deepEqual(computeGstr2b(reduced).itc, H(2700000, 1760000, 1750000));
  assert.throws(
    () => setImsAction(s, "IMS-003", "accepted", { itcReduction: H(1) }),
    /cannot exceed/,
  );
  const older = createPortal({ period: "2025-09" });
  assert.throws(
    () => setImsAction(older, "IMS-003", "pending"),
    /October 2025/,
  );
});
test("GSTR2B snapshots require recomputation after IMS change and prepare exact Step6 contract", () => {
  let s = fixture();
  assert.throws(() => preparePartA(s), /File GSTR-1/);
  s = file(s);
  assert.throws(() => preparePartA(s), /Generate GSTR-2B/);
  s = generateGstr2b(s);
  const a = preparePartA(s);
  assert.deepEqual(a.liabilities.A, H(1800000, 2400000, 2400000));
  assert.deepEqual(a.liabilities.B, H(250000, 90000, 90000));
  assert.deepEqual(a.itc, H(2700000, 1710000, 1710000));
  assert.equal(a.signatories[0].id, "sample-signatory");
  const saved = getPeriod(s).gstr2b;
  s = setImsAction(s, "IMS-004", "accepted");
  assert.equal(getPeriod(s).gstr2b.generatedAt, saved.generatedAt);
  assert.throws(() => preparePartA(s), /Recompute/);
  s = generateGstr2b(s);
  assert.equal(preparePartA(s).itc.igst, 2880000);
});
test("RCM bypasses IMS and eligible-credit excess is blocked instead of silently clamped", () => {
  const s = fixture();
  const modified = structuredClone(s),
    data = getPeriod(modified);
  data.ims.records.push({
    id: "RCM",
    supplierFiled: true,
    action: "no-action",
    supplierGstin: "24AAAPB0002B1Z4",
    supplierName: "Sample RCM",
    invoiceNo: "RCM1",
    date: "2026-09-22",
    taxable: 100000,
    igst: 18000,
    cgst: 0,
    sgst: 0,
    cess: 0,
    rcm: true,
    eligible: true,
    documentType: "invoice",
    category: "B2B",
  });
  assert.equal(computeGstr2b(modified).rcmSummary.igst, 18000);
  assert.equal(computeGstr2b(modified).itc.igst, 2700000);
  assert.throws(() => setImsAction(modified, "RCM", "rejected"), /bypass IMS/);
  assert.equal(
    preparePartA(generateGstr2b(file(modified))).liabilities.B.igst,
    268000,
  );
  const creditExcess = structuredClone(s);
  getPeriod(creditExcess).ims.records = getPeriod(
    creditExcess,
  ).ims.records.filter((r) => r.id === "IMS-003");
  const snapshot = computeGstr2b(creditExcess);
  assert.equal(snapshot.itc.cgst, -90000);
  assert.throws(
    () => preparePartA(generateGstr2b(file(creditExcess))),
    /reductions exceed/,
  );
});
test("PartA adjustments include explicit reversal and reject reversal above available credit", () => {
  let s = ready();
  const adjustments = {
    ...getPeriod(s).adjustments,
    itcReversal: H(10000, 20000, 20000),
  };
  s = savePartAAdjustments(s, adjustments);
  assert.equal(preparePartA(s).itc.igst, 2690000);
  s = savePartAAdjustments(s, { ...adjustments, itcReversal: H(999999999) });
  assert.throws(() => preparePartA(s), /reversal exceeds/);
});
test("payment offset locks all upstream mutations and final filing reconciles without duplicate writes", () => {
  let s = ready();
  let ws = posted(s);
  const before = s.revision;
  s = lockPreparedReturn(s, ws);
  assert.equal(s.revision, before + 1);
  assert.strictEqual(lockPreparedReturn(s, ws), s);
  assert.throws(() => setImsAction(s, "IMS-004", "accepted"), /locked/);
  assert.throws(() => generateGstr2b(s), /locked/);
  assert.throws(() => savePartAAdjustments(s, {}), /locked/);
  ws = requestEvc(ws, { declaration: true, signatoryId: "sample-signatory" });
  ws = verifyEvc(ws, { challengeId: ws.challenge.id, code: ws.challenge.code });
  s = lockPreparedReturn(s, ws);
  s = recordGstr3bFiling(s, ws.receipt, ws.balances);
  assert.equal(getPeriod(s).filing.reference, ws.receipt.reference);
  assert.strictEqual(recordGstr3bFiling(s, ws.receipt, ws.balances), s);
  const nextPeriod = updateSelectedPeriod(s, "2026-10");
  assert.deepEqual(getOpeningLedgers(nextPeriod), ws.balances);
  assert.deepEqual(
    getPeriod(nextPeriod).ims.records.map((r) => r.id),
    ["IMS-004", "IMS-006"],
  );
  assert.equal(getPeriod(nextPeriod).ims.records[0].carriedFrom, "2026-09");
  assert.equal(computeGstr2b(nextPeriod).unfiledRecords.length, 1);
  const accepted = setImsAction(nextPeriod, "IMS-004", "accepted");
  assert.equal(computeGstr2b(accepted).itc.igst, 180000);
  const bad = ready(),
    badWs = posted(bad);
  badWs.partA.itc.igst++;
  assert.throws(() => lockPreparedReturn(bad, badWs), /does not match/);
  assert.throws(
    () => recordGstr3bFiling(ready(), ws.receipt, ws.balances),
    /Post and reconcile/,
  );
});
test("return periods isolate documents, preserve current selection and initialize only once", () => {
  const s = fixture(),
    withPeriod = ensurePeriod(s, "2026-10");
  assert.equal(withPeriod.selectedPeriod, "2026-09");
  assert.equal(withPeriod.revision, s.revision + 1);
  assert.strictEqual(ensurePeriod(withPeriod, "2026-10"), withPeriod);
  const changed = updateSelectedPeriod(s, "2026-10");
  assert.equal(getPeriod(changed).gstr1.records.length, 0);
  assert.equal(getPeriod(changed, "2026-09").gstr1.records.length, 8);
  assert.strictEqual(updateSelectedPeriod(changed, "2026-10"), changed);
  assert.throws(
    () => updateSelectedPeriod(s, "2026-13"),
    /valid return period/,
  );
});
test("storage preserves revisions, detects stale tabs and corrupt records, and never applies failed save", () => {
  const st = storage(),
    s = fixture();
  assert.equal(loadPortal(st), null);
  savePortal(s, st);
  const loaded = loadPortal(st);
  assert.deepEqual(loaded, s);
  const a = setImsAction(s, "IMS-004", "accepted");
  savePortal(a, st);
  const stale = setImsAction(s, "IMS-005", "accepted");
  assert.throws(() => savePortal(stale, st), /another tab/);
  assert.equal(loadPortal(st).revision, 1);
  st.setItem(PORTAL_KEY, "{broken");
  assert.throws(() => loadPortal(st), /not been reset/);
  assert.equal(st.getItem(PORTAL_KEY), "{broken");
  const quota = storage();
  savePortal(s, quota);
  quota.setItem = () => {
    throw Error("quota");
  };
  assert.throws(() => savePortal(a, quota), /not committed/);
  assert.equal(loadPortal(quota).revision, 0);
});

test("HSN reported tax retains mixed heads without increasing supplier liability", () => {
  let s = fixture();
  const old = gstr1Totals(s).liabilities.A;
  s = upsertGstr1Record(s, {
    tableId: "hsn",
    hsn: "9983",
    description: "Mixed service summary",
    quantity: 1,
    uqc: "OTH",
    hsnCategory: "B2B",
    taxable: 100000,
    rate: 18,
    reportedTax: H(9000, 4500, 4500),
  });
  const record = getPeriod(s).gstr1.records.at(-1);
  assert.deepEqual(taxForRecord(s, record), {
    taxable: 100000,
    ...H(9000, 4500, 4500),
    totalTax: 18000,
  });
  assert.deepEqual(gstr1Totals(s).liabilities.A, old);
});
test("re-amending an original uses the latest filed revised value, and RCM classification changes are rejected", () => {
  let s = updateSelectedPeriod(file(fixture()), "2026-10");
  s = upsertGstr1Record(
    s,
    sale({
      tableId: "amend-invoices",
      invoiceNo: "AM-OCT",
      date: "2026-09-04",
      originalId: "SALE-001",
      originalPeriod: "2026-09",
      taxable: 12000000,
    }),
  );
  s = upsertGstr1Record(s, {
    tableId: "hsn",
    hsn: "8471",
    quantity: 1,
    uqc: "NOS",
    taxable: 2000000,
    rate: 18,
    pos: "27",
  });
  s = upsertGstr1Record(s, {
    tableId: "documents",
    serialFrom: "AM-OCT",
    serialTo: "AM-OCT",
    totalDocuments: 1,
    cancelledDocuments: 0,
  });
  s = file(s);
  s = updateSelectedPeriod(s, "2026-11");
  s = upsertGstr1Record(
    s,
    sale({
      tableId: "amend-invoices",
      invoiceNo: "AM-NOV",
      date: "2026-09-04",
      originalId: "SALE-001",
      originalPeriod: "2026-09",
      taxable: 13000000,
    }),
  );
  assert.equal(gstr1Totals(s).liabilities.A.igst, 180000);
  assert.throws(
    () =>
      upsertGstr1Record(
        updateSelectedPeriod(s, "2026-12"),
        sale({
          tableId: "amend-invoices",
          invoiceNo: "AM-DEC",
          date: "2026-09-04",
          originalId: "SALE-001",
          originalPeriod: "2026-09",
          taxable: 13000000,
          reverseCharge: true,
        }),
      ),
    /reverse-charge classification/,
  );
});
test("tampered GSTR2B credit and mismatched filing closing balances cannot enter payment carryforward", () => {
  const s = ready(),
    corrupt = structuredClone(s);
  getPeriod(corrupt).gstr2b.itc.igst++;
  assert.throws(() => preparePartA(corrupt), /does not match/);
  let ws = posted(s);
  let locked = lockPreparedReturn(s, ws);
  ws = requestEvc(ws, { declaration: true, signatoryId: "sample-signatory" });
  ws = verifyEvc(ws, { challengeId: ws.challenge.id, code: ws.challenge.code });
  locked = lockPreparedReturn(locked, ws);
  const balances = structuredClone(ws.balances);
  balances.credit.igst++;
  assert.throws(
    () => recordGstr3bFiling(locked, ws.receipt, balances),
    /Closing ledgers/,
  );
});
