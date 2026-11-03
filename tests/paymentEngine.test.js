import test from "node:test";
import assert from "node:assert/strict";
import {
  HEADS,
  GROUPS,
  emptyHeads,
  toPaise,
  formatMoney,
  calculatePayment,
} from "../src/gst/paymentEngine.js";

const h = (igst = 0, cgst = 0, sgst = 0, cess = 0) => ({
  igst,
  cgst,
  sgst,
  cess,
});
const input = (changes) => ({
  period: "2026-10",
  liabilities: { A: h(), B: h() },
  negativeOpening: { A: h(), B: h() },
  credit: h(),
  cash: { tax: h(), interest: h(), lateFee: h() },
  interest: h(),
  lateFee: h(),
  ...changes,
});
const matrix = () => Object.fromEntries(HEADS.map((head) => [head, h()]));

test("decimal conversion preserves paise and rejects ambiguous or rounded input", () => {
  assert.equal(toPaise("12000.05"), 1200005);
  assert.equal(toPaise("-0.01"), -1);
  assert.equal(toPaise(0.3), 30);
  assert.equal(formatMoney(123456789), "12,34,567.89");
  assert.equal(formatMoney(-1), "-0.01");
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER), "9,00,71,99,25,47,409.91");
  for (const bad of [
    "",
    "1,000",
    "₹10",
    "1.234",
    "1e3",
    null,
    NaN,
    Infinity,
    0.1 + 0.2,
    "90071992547409.92",
  ])
    assert.throws(() => toPaise(bad));
  assert.throws(() => formatMoney(1.2));
  assert.notEqual(emptyHeads(), emptyHeads());
});

test("auto set-off splits surplus IGST to avoid stranding own-head credit", () => {
  const r = calculatePayment(
    input({
      liabilities: { A: h(18000, 24000, 23000), B: h() },
      credit: h(32000, 20000, 19000),
    }),
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.matrix.igst.igst, 18000);
  assert.ok(r.matrix.cgst.igst >= 4000);
  assert.ok(r.matrix.sgst.igst >= 4000);
  assert.equal(r.totals.cashTax, 0);
  assert.equal(r.totals.itcUsed, 65000);
  assert.equal(
    Object.values(r.creditClosing).reduce((a, b) => a + b),
    6000,
  );
});

test("IGST own liability has priority; own-head C/S credit follows before residual IGST", () => {
  const r = calculatePayment(
    input({
      liabilities: { A: h(1000, 200, 300, 250), B: h() },
      credit: h(400, 700, 700, 150),
    }),
  );
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.matrix.igst, h(400, 500, 100));
  assert.equal(r.matrix.cgst.cgst, 200);
  assert.equal(r.matrix.sgst.sgst, 300);
  assert.equal(r.matrix.cess.cess, 150);
  assert.equal(r.totals.cashTax, 100);
  assert.equal(r.creditClosing.sgst, 300);
});

test("February 2026 allows either C/S sequence for residual IGST; January keeps CGST first", () => {
  const base = input({
    liabilities: { A: h(500), B: h() },
    credit: h(0, 600, 600),
    order: { residualIgst: "sgst-first" },
  });
  const feb = calculatePayment({ ...base, period: "2026-02" });
  assert.deepEqual(feb.errors, []);
  assert.equal(feb.matrix.igst.sgst, 500);
  const jan = calculatePayment({ ...base, period: "2026-01" });
  assert.ok(jan.errors.some((error) => error.includes("February 2026")));
  assert.equal(jan.matrix.igst.cgst, 500);
  const allocation = matrix();
  allocation.igst.sgst = 500;
  const oldManual = calculatePayment({
    ...base,
    period: "2026-01",
    order: {},
    allocation,
  });
  assert.ok(
    oldManual.errors.some((error) => error.includes("before February 2026")),
  );
});

test("section B tax, interest and late fees stay cash-only and cash balances cannot cross minors", () => {
  const r = calculatePayment(
    input({
      liabilities: { A: h(100, 200, 300, 50), B: h(20, 40, 60, 10) },
      credit: h(1000, 1000, 1000, 1000),
      interest: h(1, 2, 3),
      lateFee: h(0, 5, 5),
      cash: { tax: h(1000, 1000, 1000, 1000), interest: h(), lateFee: h() },
    }),
  );
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.cashRequired.tax, h(20, 40, 60, 10));
  assert.equal(r.totals.shortfall, 16);
  assert.deepEqual(r.cashShortfall.interest, h(1, 2, 3));
  assert.deepEqual(r.cashShortfall.lateFee, h(0, 5, 5));
  assert.equal(
    r.rows
      .filter((row) => row.group === "B")
      .flatMap((row) => Object.values(row.itc))
      .reduce((a, b) => a + b),
    0,
  );
  assert.equal(
    r.rows.reduce((a, row) => a + row.interest, 0),
    6,
  );
});

test("negative liability carries separately by section and head without becoming cash or ITC", () => {
  const r = calculatePayment(
    input({
      liabilities: { A: h(100, -20, 90, 0), B: h(30, 40, -10, 0) },
      negativeOpening: { A: h(80, 15, 150, 0), B: h(100, 5, 20, 0) },
    }),
  );
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.negativeClosing, {
    A: h(0, 35, 60, 0),
    B: h(70, 0, 30, 0),
  });
  assert.equal(
    r.rows.find((row) => row.group === "A" && row.head === "igst").net,
    20,
  );
  assert.equal(
    r.rows.find((row) => row.group === "B" && row.head === "cgst").net,
    35,
  );
  assert.equal(r.totals.negativeAdjusted, 205);
  assert.equal(r.totals.cashTax, 55);
  assert.deepEqual(r.creditClosing, h());
  assert.deepEqual(r.cashClosing.tax, h());
});

test("cess credit cannot cover other tax and general ITC cannot cover cess", () => {
  const r = calculatePayment(
    input({
      liabilities: { A: h(100, 200, 300, 400), B: h() },
      credit: h(0, 1000, 1000, 50),
    }),
  );
  assert.equal(r.totals.cashTax, 350);
  assert.equal(r.matrix.cess.cess, 50);
  const allocation = matrix();
  allocation.cess.igst = 400;
  allocation.cgst.sgst = 200;
  const invalid = calculatePayment(
    input({
      liabilities: { A: h(0, 200, 0, 400), B: h() },
      credit: h(500, 0, 500),
      allocation,
    }),
  );
  assert.ok(
    invalid.errors.some((error) =>
      error.includes("IGST credit cannot pay CESS"),
    ),
  );
  assert.ok(
    invalid.errors.some((error) =>
      error.includes("SGST credit cannot pay CGST"),
    ),
  );
});

test("manual allocation rejects overdraw, overpayment and IGST priority violations", () => {
  const allocation = matrix();
  allocation.cgst.igst = 500;
  allocation.igst.cgst = 200;
  allocation.sgst.sgst = 400;
  const r = calculatePayment(
    input({
      liabilities: { A: h(300, 500, 300), B: h() },
      credit: h(500, 100, 500),
      allocation,
    }),
  );
  assert.ok(
    r.errors.some((error) =>
      error.includes("IGST credit against IGST liability first"),
    ),
  );
  assert.ok(
    r.errors.some((error) => error.includes("CGST credit utilization exceeds")),
  );
  assert.ok(
    r.errors.some((error) => error.includes("ITC allocated to SGST exceeds")),
  );
  const unexhausted = matrix();
  unexhausted.cgst.cgst = 100;
  assert.ok(
    calculatePayment(
      input({
        liabilities: { A: h(0, 100), B: h() },
        credit: h(100, 100),
        allocation: unexhausted,
      }),
    ).errors.some((error) => error.includes("Exhaust usable IGST")),
  );
});

test("manual C/S cross-utilization cannot bypass own-head liabilities", () => {
  const allocation = matrix();
  allocation.igst.cgst = 100;
  const r = calculatePayment(
    input({
      liabilities: { A: h(100, 100), B: h() },
      credit: h(0, 200),
      allocation,
    }),
  );
  assert.ok(
    r.errors.some((error) =>
      error.includes("CGST credit against its own liability first"),
    ),
  );
});

test("pre-February residual priority does not treat own-head CGST needs as surplus", () => {
  const allocation = matrix();
  allocation.igst.sgst = 500;
  const r = calculatePayment(
    input({
      period: "2026-01",
      liabilities: { A: h(500, 600), B: h() },
      credit: h(0, 600, 500),
      allocation,
    }),
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.totals.cashTax, 600);
  assert.equal(r.creditClosing.cgst, 600);
});

test("unused cess/IGST that cannot pay a remaining tax does not block valid CGST utilization", () => {
  const allocation = matrix();
  allocation.cgst.igst = 100;
  allocation.cgst.cgst = 100;
  allocation.cess.cess = 100;
  const r = calculatePayment(
    input({
      liabilities: { A: h(0, 200, 0, 100), B: h() },
      credit: h(100, 100, 0, 500),
      allocation,
    }),
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.creditClosing.cess, 400);
});

test("nil return is valid and does not consume opening balances", () => {
  const r = calculatePayment(
    input({
      credit: h(100, 200, 300, 400),
      cash: { tax: h(1, 2, 3, 4), interest: h(), lateFee: h() },
    }),
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.totals.cashRequired, 0);
  assert.deepEqual(r.creditClosing, h(100, 200, 300, 400));
  assert.deepEqual(r.cashClosing.tax, h(1, 2, 3, 4));
});

test("invalid paise, periods, tax heads and aggregate overflows are blocked", () => {
  for (const value of [
    1.5,
    "100",
    -1,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.ok(calculatePayment(input({ credit: h(value) })).errors.length);
  }
  assert.ok(calculatePayment(input({ period: "2026-13" })).errors.length);
  assert.ok(
    calculatePayment(input({ credit: { vat: 1 } })).errors.some((error) =>
      error.includes("vat"),
    ),
  );
  assert.ok(
    calculatePayment(
      input({ credit: h(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) }),
    ).errors.some((error) => error.includes("safe paise limit")),
  );
  assert.ok(
    calculatePayment(
      input({
        liabilities: { A: h(-Number.MAX_SAFE_INTEGER), B: h() },
        negativeOpening: { A: h(1), B: h() },
      }),
    ).errors.some((error) => error.includes("negativeClosing")),
  );
});

test("deterministic mixed scenarios conserve tax, credit, cash and negative balances", () => {
  let seed = 9127;
  const next = (max) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % max;
  };
  for (let i = 0; i < 300; i++) {
    const liabilities = Object.fromEntries(
      GROUPS.map((group) => [
        group,
        Object.fromEntries(HEADS.map((head) => [head, next(30000) - 5000])),
      ]),
    );
    const negativeOpening = Object.fromEntries(
      GROUPS.map((group) => [
        group,
        Object.fromEntries(HEADS.map((head) => [head, next(1000)])),
      ]),
    );
    const credit = Object.fromEntries(HEADS.map((head) => [head, next(20000)]));
    const cash = Object.fromEntries(
      ["tax", "interest", "lateFee"].map((minor) => [
        minor,
        Object.fromEntries(HEADS.map((head) => [head, next(10000)])),
      ]),
    );
    const original = input({
      liabilities,
      negativeOpening,
      credit,
      cash,
      interest: h(0, 12, 12),
      lateFee: h(0, 25, 25),
      order: {
        igstRemainder: i % 2 ? "sgst-first" : "cgst-first",
        residualIgst: i % 2 ? "cgst-first" : "sgst-first",
      },
    });
    const frozen = JSON.stringify(original);
    const r = calculatePayment(original);
    assert.deepEqual(r.errors, []);
    assert.equal(
      JSON.stringify(original),
      frozen,
      "calculation must not mutate its inputs",
    );
    assert.equal(r.totals.netTax, r.totals.itcUsed + r.totals.cashTax);
    for (const head of HEADS) {
      assert.equal(credit[head], r.creditUsed[head] + r.creditClosing[head]);
      for (const group of GROUPS) {
        const row = r.rows.find(
          (row) => row.group === group && row.head === head,
        );
        assert.equal(Math.max(row.gross, 0), row.negativeAdjusted + row.net);
        assert.equal(
          negativeOpening[group][head] + Math.max(-row.gross, 0),
          row.negativeAdjusted + r.negativeClosing[group][head],
        );
        assert.equal(
          row.net,
          Object.values(row.itc).reduce((a, b) => a + b) + row.cashTax,
        );
      }
      for (const minor of ["tax", "interest", "lateFee"])
        assert.equal(
          cash[minor][head] + r.cashShortfall[minor][head],
          r.cashRequired[minor][head] + r.cashClosing[minor][head],
        );
    }
    // Any auto-generated matrix must also satisfy the manual validator.
    assert.deepEqual(
      calculatePayment({ ...original, allocation: r.matrix }).errors,
      [],
    );
  }
});
