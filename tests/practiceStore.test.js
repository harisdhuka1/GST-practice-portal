import test from "node:test";
import assert from "node:assert/strict";
import { calculatePayment } from "../src/gst/paymentEngine.js";
import {
  createWorkspace,
  updatePartA,
  getPaymentInputs,
  createChallan,
  markChallanPaid,
  offsetLiabilities,
  requestEvc,
  verifyEvc,
  loadWorkspace,
  saveWorkspace,
  workspaceKey,
  OTP_TTL_MS,
  ConflictError,
  StorageError,
  prepareNextPeriod,
  updatePaymentPlan,
} from "../src/gst/practiceStore.js";

const H = (igst = 0, cgst = 0, sgst = 0, cess = 0) => ({
  igst,
  cgst,
  sgst,
  cess,
});
const C = (tax = H(), interest = H(), lateFee = H()) => ({
  tax,
  interest,
  lateFee,
});
const A = () => ({
  liabilities: { A: H(10000, 5000, 5000), B: H(2000) },
  itc: H(8000, 1000, 1000),
  interest: H(100),
  lateFee: H(0, 50, 50),
  signatories: [
    {
      id: "primary",
      name: "Sample Signatory",
      email: "sample@example.com",
      mobile: "9000000001",
    },
  ],
});
const fixture = (overrides = {}) =>
  createWorkspace({
    gstin: "24AAAPA0001A1Z5",
    period: "2026-10",
    partA: A(),
    ...overrides,
  });
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
function fundAndOffset(ws) {
  const payment = calculatePayment(getPaymentInputs(ws));
  let next = createChallan(ws, { amounts: payment.cashShortfall });
  next = markChallanPaid(next, next.challans.at(-1).id);
  return offsetLiabilities(next);
}

test("current-period ITC is included once, Part A updates replace it before offset", () => {
  const ws = fixture({ opening: { credit: H(2000) } });
  assert.equal(ws.balances.credit.igst, 10000);
  const partA = A();
  partA.itc.igst = 3000;
  const updated = updatePartA(ws, partA);
  assert.equal(updated.balances.credit.igst, 5000);
  assert.equal(ws.balances.credit.igst, 10000);
  assert.equal(getPaymentInputs(updated).credit.igst, 5000);
});

test("challans credit only after simulated payment, with exact minor/head separation and no duplicate credit", () => {
  const ws = fixture();
  const pending = createChallan(ws, { amounts: C(H(500), H(30), H(0, 40)) });
  assert.equal(pending.balances.cash.tax.igst, 0);
  const paid = markChallanPaid(pending, pending.challans[0].id);
  assert.deepEqual(paid.balances.cash, C(H(500), H(30), H(0, 40)));
  assert.equal(paid.challans[0].status, "paid");
  assert.equal(paid.ledger.length, 1);
  assert.strictEqual(markChallanPaid(paid, paid.challans[0].id), paid);
  assert.throws(() => createChallan(ws, { amounts: C() }), /positive/);
  assert.throws(
    () => createChallan(ws, { amounts: C(H(1.1)) }),
    /integer paise/,
  );
  assert.throws(
    () => createChallan(ws, { amounts: C(H(-1)) }),
    /integer paise/,
  );
});

test("offset refuses insufficient or wrong-head cash, settles exactly once and locks Part A", () => {
  const ws = fixture();
  assert.throws(() => offsetLiabilities(ws), /Insufficient cash/);
  const wrongHeadCash = fixture({ opening: { cash: C(H(1000000)) } });
  assert.throws(() => offsetLiabilities(wrongHeadCash), /Insufficient cash/);
  const settled = fundAndOffset(ws);
  assert.equal(settled.status, "offset");
  assert.ok(settled.offset.snapshot.totals.cashRequired > 0);
  assert.deepEqual(settled.balances.cash, C());
  assert.deepEqual(settled.balances.credit, H());
  assert.equal(
    settled.ledger.filter((entry) => entry.ledger === "liability").length,
    1,
  );
  assert.strictEqual(offsetLiabilities(settled), settled);
  assert.throws(() => updatePartA(settled, A()), /locked/);
  assert.throws(() => createChallan(settled, { amounts: C(H(100)) }), /locked/);
  assert.deepEqual(getPaymentInputs(settled), settled.offset.inputs);
  assert.equal(ws.status, "draft");
});

test("negative liabilities carry forward separately and nil return can offset without a challan", () => {
  const nilPartA = {
    ...A(),
    liabilities: { A: H(-100), B: H() },
    itc: H(),
    interest: H(),
    lateFee: H(),
  };
  const ws = fixture({
    partA: nilPartA,
    opening: { negative: { A: H(20), B: H(50) } },
  });
  const settled = offsetLiabilities(ws);
  assert.equal(settled.balances.negative.A.igst, 120);
  assert.equal(settled.balances.negative.B.igst, 50);
  assert.equal(settled.offset.snapshot.totals.cashRequired, 0);
});

test("EVC requires offset, declaration and authorized signatory", () => {
  assert.throws(
    () => requestEvc(fixture(), { signatoryId: "primary", declaration: true }),
    /Offset/,
  );
  const ws = fundAndOffset(fixture());
  assert.throws(
    () => requestEvc(ws, { signatoryId: "primary", declaration: false }),
    /declaration/,
  );
  assert.throws(
    () => requestEvc(ws, { signatoryId: "stranger", declaration: true }),
    /authorized signatory/,
  );
  const requested = requestEvc(
    ws,
    { signatoryId: "primary", declaration: true },
    1000,
  );
  assert.match(requested.challenge.code, /^\d{6}$/);
  assert.equal(Date.parse(requested.challenge.expiresAt), 1000 + OTP_TTL_MS);
  assert.equal(requested.status, "offset");
});

test("latest EVC only, incorrect and expired codes cannot file, final verification is idempotent", () => {
  const ws = fundAndOffset(fixture());
  const first = requestEvc(
    ws,
    { signatoryId: "primary", declaration: true },
    1000,
  );
  const latest = requestEvc(
    first,
    { signatoryId: "primary", declaration: true },
    2000,
  );
  assert.throws(
    () =>
      verifyEvc(
        latest,
        { code: first.challenge.code, challengeId: first.challenge.id },
        3000,
      ),
    /newer EVC/,
  );
  assert.throws(
    () =>
      verifyEvc(
        latest,
        { code: "000000", challengeId: latest.challenge.id },
        3000,
      ),
    /Incorrect/,
  );
  assert.throws(
    () =>
      verifyEvc(
        latest,
        { code: latest.challenge.code, challengeId: latest.challenge.id },
        2000 + OTP_TTL_MS,
      ),
    /expired/,
  );
  const filed = verifyEvc(
    latest,
    { code: latest.challenge.code, challengeId: latest.challenge.id },
    3000,
  );
  assert.equal(filed.status, "filed");
  assert.match(filed.receipt.reference, /^PRACTICE-ARN-/);
  assert.equal(filed.receipt.mode, "Simulated EVC");
  assert.match(filed.receipt.disclaimer, /not an official/);
  assert.strictEqual(
    verifyEvc(
      filed,
      { code: latest.challenge.code, challengeId: latest.challenge.id },
      999999999,
    ),
    filed,
  );
  assert.throws(
    () =>
      verifyEvc(
        filed,
        { code: "000000", challengeId: latest.challenge.id },
        3000,
      ),
    /already filed/,
  );
  assert.throws(
    () => requestEvc(filed, { signatoryId: "primary", declaration: true }),
    /Offset/,
  );
  assert.deepEqual(filed.balances, latest.balances);
});

test("workspace storage is taxpayer/period scoped and survives reload through final filing", () => {
  const storage = memoryStorage();
  const initial = fixture();
  assert.equal(loadWorkspace(initial, storage), null);
  saveWorkspace(initial, storage);
  let ws = loadWorkspace(initial, storage);
  const amount = calculatePayment(getPaymentInputs(ws)).cashShortfall;
  ws = saveWorkspace(createChallan(ws, { amounts: amount }), storage);
  ws = saveWorkspace(markChallanPaid(ws, ws.challans[0].id), storage);
  ws = saveWorkspace(offsetLiabilities(ws), storage);
  ws = saveWorkspace(
    requestEvc(ws, { signatoryId: "primary", declaration: true }, 1000),
    storage,
  );
  ws = loadWorkspace(initial, storage);
  ws = saveWorkspace(
    verifyEvc(
      ws,
      { code: ws.challenge.code, challengeId: ws.challenge.id },
      2000,
    ),
    storage,
  );
  assert.deepEqual(loadWorkspace(initial, storage), ws);
  assert.equal(
    loadWorkspace({ gstin: initial.gstin, period: "2026-11" }, storage),
    null,
  );
  assert.equal(
    loadWorkspace(
      { gstin: "24AAAPB0002B1Z5", period: initial.period },
      storage,
    ),
    null,
  );
  assert.strictEqual(saveWorkspace(ws, storage), ws);
});

test("stale writes, missing records and quota failures do not silently overwrite or reset data", () => {
  const storage = memoryStorage();
  const ws = saveWorkspace(fixture(), storage);
  const firstTab = createChallan(ws, { amounts: C(H(100)) });
  const staleTab = createChallan(ws, { amounts: C(H(200)) });
  saveWorkspace(firstTab, storage);
  assert.throws(() => saveWorkspace(staleTab, storage), ConflictError);
  assert.equal(loadWorkspace(ws, storage).challans[0].total, 100);
  storage.removeItem(workspaceKey(ws));
  assert.throws(() => saveWorkspace(firstTab, storage), /missing/);
  const brokenStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.throws(() => saveWorkspace(ws, brokenStorage), /not committed/);
  assert.throws(() => loadWorkspace(ws, null), StorageError);
});

test("corrupt storage raises a visible error and preserves raw data", () => {
  const storage = memoryStorage();
  const ws = fixture();
  const key = workspaceKey(ws);
  storage.setItem(key, "{broken");
  assert.throws(() => loadWorkspace(ws, storage), /not been reset/);
  assert.equal(storage.getItem(key), "{broken");
  storage.setItem(key, JSON.stringify({ ...ws, schemaVersion: 999 }));
  assert.throws(() => loadWorkspace(ws, storage), /incompatible/);
});

test("later periods carry filed closing credit, cash and negative liability with new ITC added once", () => {
  const partA = {
    ...A(),
    liabilities: { A: H(-100, 500, 500), B: H(200) },
    itc: H(5000, 2000, 2000),
  };
  const current = fixture({
    partA,
    opening: {
      credit: H(1000, 100, 100),
      cash: C(H(1000, 1000, 1000), H(1000), H(0, 1000, 1000)),
      negative: { A: H(50), B: H() },
    },
  });
  const offset = offsetLiabilities(current);
  const challenge = requestEvc(
    offset,
    { signatoryId: "primary", declaration: true },
    1000,
  );
  const filed = verifyEvc(
    challenge,
    { code: challenge.challenge.code, challengeId: challenge.challenge.id },
    2000,
  );
  const original = structuredClone(filed);
  const newPartA = {
    ...A(),
    liabilities: { A: H(300), B: H() },
    itc: H(700),
    interest: H(),
    lateFee: H(),
  };
  const next = prepareNextPeriod(filed, { period: "2026-11", partA: newPartA });
  assert.equal(next.gstin, filed.gstin);
  assert.equal(next.period, "2026-11");
  assert.equal(next.revision, 0);
  assert.equal(next.status, "draft");
  assert.deepEqual(next.opening, filed.balances);
  assert.deepEqual(next.balances.cash, filed.balances.cash);
  assert.deepEqual(next.balances.negative, filed.balances.negative);
  assert.equal(next.balances.credit.igst, filed.balances.credit.igst + 700);
  assert.equal(next.balances.credit.cgst, filed.balances.credit.cgst);
  assert.equal(next.balances.negative.A.igst, 150);
  assert.deepEqual(
    next.ledger.map((entry) => entry.ledger),
    ["credit", "cash", "negative"],
  );
  assert.ok(
    next.ledger.every(
      (entry) =>
        entry.direction === "opening" &&
        entry.reference === filed.receipt.reference,
    ),
  );
  assert.equal(next.carryforward.workspaceId, filed.id);
  assert.equal(next.challenge, null);
  assert.equal(next.offset, null);
  assert.equal(next.receipt, null);
  const calculation = calculatePayment(getPaymentInputs(next));
  assert.equal(
    calculation.rows.find((row) => row.group === "A" && row.head === "igst")
      .negativeAdjusted,
    150,
  );
  assert.equal(calculation.errors.length, 0);
  assert.deepEqual(filed, original);
  next.balances.cash.tax.igst = 0;
  assert.notEqual(next.balances.cash.tax.igst, filed.balances.cash.tax.igst);
});

test("carryforward requires a filed return, a later valid period, and prepared new Part A", () => {
  const ws = fixture();
  assert.throws(
    () => prepareNextPeriod(ws, { period: "2026-11", partA: A() }),
    /File the current/,
  );
  const settled = fundAndOffset(ws);
  assert.throws(
    () => prepareNextPeriod(settled, { period: "2026-11", partA: A() }),
    /File the current/,
  );
  const requested = requestEvc(
    settled,
    { signatoryId: "primary", declaration: true },
    1000,
  );
  const filed = verifyEvc(
    requested,
    { code: requested.challenge.code, challengeId: requested.challenge.id },
    2000,
  );
  for (const period of ["2026-10", "2026-09"])
    assert.throws(
      () => prepareNextPeriod(filed, { period, partA: A() }),
      /must be later/,
    );
  for (const period of ["2026-13", "0000-01", "November 2026"])
    assert.throws(
      () => prepareNextPeriod(filed, { period, partA: A() }),
      /YYYY-MM/,
    );
  assert.throws(
    () => prepareNextPeriod(filed, { period: "2026-11" }),
    /prepared Part A/,
  );
  const storage = memoryStorage();
  const next = prepareNextPeriod(filed, { period: "2026-11", partA: A() });
  saveWorkspace(next, storage);
  assert.deepEqual(loadWorkspace(next, storage), next);
  assert.throws(
    () =>
      saveWorkspace(
        prepareNextPeriod(filed, { period: "2026-11", partA: A() }),
        storage,
      ),
    ConflictError,
  );
});

test("malformed balance, challan and filing payloads are rejected without resetting stored records", () => {
  const storage = memoryStorage();
  const pending = createChallan(fixture(), { amounts: C(H(100)) });
  const settled = fundAndOffset(fixture());
  const requested = requestEvc(
    settled,
    { signatoryId: "primary", declaration: true },
    1000,
  );
  assert.equal(typeof requested.challenge.expiresAt, "string");
  assert.ok(Number.isFinite(Date.parse(requested.challenge.expiresAt)));
  const mutations = [
    (ws) => {
      delete ws.balances.credit.igst;
    },
    (ws) => {
      delete ws.balances.cash.lateFee;
    },
    (ws) => {
      ws.balances.cash.tax = [];
    },
    (ws) => {
      delete ws.opening.negative.B;
    },
    (ws) => {
      ws.challans[0].total += 1;
    },
    (ws) => {
      ws.challans.push(structuredClone(ws.challans[0]));
    },
  ];
  for (const mutate of mutations) {
    const damaged = structuredClone(pending);
    mutate(damaged);
    const raw = JSON.stringify(damaged);
    storage.setItem(workspaceKey(damaged), raw);
    assert.throws(() => loadWorkspace(damaged, storage), StorageError);
    assert.equal(storage.getItem(workspaceKey(damaged)), raw);
  }
  for (const mutate of [
    (ws) => {
      ws.challenge.expiresAt = "invalid";
    },
    (ws) => {
      ws.challenge.expiresAt = new Date(1000 + OTP_TTL_MS + 1).toISOString();
    },
    (ws) => {
      ws.balances.credit.igst += 1;
    },
    (ws) => {
      ws.offset.snapshot.totals.cashTax += 1;
    },
  ]) {
    const damaged = structuredClone(requested);
    mutate(damaged);
    storage.setItem(workspaceKey(damaged), JSON.stringify(damaged));
    assert.throws(() => loadWorkspace(damaged, storage), StorageError);
  }
});

test("validated manual payment plan persists and is used by default when posting after reload", () => {
  const storage = memoryStorage();
  const initial = saveWorkspace(fixture(), storage);
  const allocation = { igst: H(8000), cgst: H(), sgst: H(), cess: H() };
  let ws = updatePaymentPlan(initial, {
    order: { igstRemainder: "sgst-first", residualIgst: "sgst-first" },
    allocation,
  });
  assert.equal(ws.revision, 1);
  assert.deepEqual(ws.paymentPlan.allocation, allocation);
  assert.equal(ws.paymentPlan.order.residualIgst, "sgst-first");
  assert.ok(calculatePayment(getPaymentInputs(ws)).totals.shortfall > 0);
  saveWorkspace(ws, storage);
  ws = loadWorkspace(initial, storage);
  assert.deepEqual(getPaymentInputs(ws).allocation, allocation);
  const payment = calculatePayment(getPaymentInputs(ws));
  assert.deepEqual(payment.matrix, allocation);
  ws = saveWorkspace(
    createChallan(ws, { amounts: payment.cashShortfall }),
    storage,
  );
  ws = saveWorkspace(markChallanPaid(ws, ws.challans[0].id), storage);
  ws = saveWorkspace(offsetLiabilities(ws), storage);
  assert.deepEqual(ws.offset.snapshot.matrix, allocation);
  assert.deepEqual(ws.offset.inputs.order, ws.paymentPlan.order);
  assert.equal(ws.balances.credit.cgst, 1000);
  assert.equal(ws.balances.credit.sgst, 1000);
  assert.throws(() => updatePaymentPlan(ws, {}), /locked/);
});

test("payment plan validates restrictions, supports resetting to auto and permits explicit calculation overrides", () => {
  const initial = fixture();
  const forbidden = { igst: H(), cgst: H(0, 0, 100), sgst: H(), cess: H() };
  assert.throws(
    () => updatePaymentPlan(initial, { allocation: forbidden }),
    /cannot pay/,
  );
  assert.equal(initial.revision, 0);
  assert.equal(initial.paymentPlan, null);
  const allocation = { igst: H(8000), cgst: H(), sgst: H(), cess: H() };
  const saved = updatePaymentPlan(initial, { allocation });
  assert.deepEqual(getPaymentInputs(saved).allocation, allocation);
  assert.equal(
    Object.hasOwn(getPaymentInputs(saved, { allocation: null }), "allocation"),
    false,
  );
  assert.equal(
    getPaymentInputs(saved, {
      order: { igstRemainder: "sgst-first", residualIgst: "cgst-first" },
    }).order.igstRemainder,
    "sgst-first",
  );
  for (const plan of [{}, { allocation: null }]) {
    const automatic = updatePaymentPlan(saved, plan);
    assert.equal(automatic.paymentPlan.allocation, null);
    assert.equal(
      Object.hasOwn(getPaymentInputs(automatic), "allocation"),
      false,
    );
    assert.equal(
      calculatePayment(getPaymentInputs(automatic)).creditUsed.cgst,
      1000,
    );
  }
  const created = fixture({ paymentPlan: { allocation } });
  assert.deepEqual(created.paymentPlan.allocation, allocation);
  assert.equal(created.revision, 0);
  const oldWorkspace = structuredClone(initial);
  delete oldWorkspace.paymentPlan;
  assert.equal(
    calculatePayment(getPaymentInputs(oldWorkspace)).errors.length,
    0,
  );
});

test("Part A changes clear a saved manual allocation so reload recalculates against new ITC", () => {
  const storage = memoryStorage();
  let ws = saveWorkspace(fixture(), storage);
  ws = saveWorkspace(
    updatePaymentPlan(ws, {
      order: { igstRemainder: "sgst-first", residualIgst: "sgst-first" },
      allocation: { igst: H(8000), cgst: H(), sgst: H(), cess: H() },
    }),
    storage,
  );
  const changedPartA = A();
  changedPartA.itc.igst = 100;
  ws = saveWorkspace(updatePartA(ws, changedPartA), storage);
  const restored = loadWorkspace(ws, storage);
  assert.equal(restored.paymentPlan.allocation, null);
  assert.equal(restored.paymentPlan.order.igstRemainder, "sgst-first");
  assert.equal(Object.hasOwn(getPaymentInputs(restored), "allocation"), false);
  const payment = calculatePayment(getPaymentInputs(restored));
  assert.equal(payment.errors.length, 0);
  assert.equal(payment.creditUsed.igst, 100);
});
