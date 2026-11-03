/**
 * GSTR-3B training payment arithmetic. Every monetary value is integer paise.
 * This module has no persistence, clock, network or UI side effects.
 */
export const HEADS = Object.freeze(["igst", "cgst", "sgst", "cess"]);
export const GROUPS = Object.freeze(["A", "B"]);
const MINORS = ["tax", "interest", "lateFee"];
const ORDERS = ["cgst-first", "sgst-first"];
const ALLOWED = {
  igst: ["igst", "cgst", "sgst"],
  cgst: ["igst", "cgst"],
  sgst: ["igst", "sgst"],
  cess: ["cess"],
};
export const emptyHeads = () =>
  Object.fromEntries(HEADS.map((head) => [head, 0]));
const emptyMatrix = () =>
  Object.fromEntries(HEADS.map((head) => [head, emptyHeads()]));
const emptyCash = () =>
  Object.fromEntries(MINORS.map((minor) => [minor, emptyHeads()]));

/** Strict decimal INR conversion. Currency symbols, grouping and exponents are rejected. */
export function toPaise(value) {
  if (typeof value !== "string" && typeof value !== "number")
    throw new TypeError("Enter a decimal rupee amount.");
  const text = String(value).trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text))
    throw new RangeError(
      "Use a decimal rupee amount with at most two decimal places.",
    );
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (paise > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError("Amount exceeds the safe paise limit.");
  return (negative && paise !== 0n ? -1 : 1) * Number(paise);
}

export function formatMoney(paise) {
  if (!Number.isSafeInteger(paise))
    throw new RangeError("Money must be integer paise.");
  const negative = paise < 0;
  const amount = BigInt(Math.abs(paise));
  const rupees = (amount / 100n).toLocaleString("en-IN");
  return `${negative ? "-" : ""}${rupees}.${String(amount % 100n).padStart(2, "0")}`;
}

/**
 * Calculate Table 6.1. Matrix rows are liability heads; columns are ITC sources.
 * Missing amounts default to zero. Invalid supplied values produce errors and
 * are never silently rounded. Any error makes this result unsuitable for posting.
 */
export function calculatePayment(input = {}) {
  const errors = [];
  const object = (value, path) => {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path} must be an object.`);
      return {};
    }
    return value;
  };
  input = object(input, "Payment input");
  const amount = (value, path, signed = false) => {
    if (value === undefined) return 0;
    if (!Number.isSafeInteger(value) || (!signed && value < 0)) {
      errors.push(
        `${path} must be ${signed ? "safe signed" : "non-negative safe"} integer paise.`,
      );
      return 0;
    }
    return value;
  };
  const add = (values, path) => {
    const sum = values.reduce((total, value) => total + BigInt(value), 0n);
    if (
      sum > BigInt(Number.MAX_SAFE_INTEGER) ||
      sum < -BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      errors.push(`${path} exceeds the safe paise limit.`);
      return 0;
    }
    return Number(sum);
  };
  const heads = (value, path, signed = false) => {
    const source = object(value, path);
    for (const key of Object.keys(source))
      if (!HEADS.includes(key))
        errors.push(`${path}.${key} is not a supported tax head.`);
    return Object.fromEntries(
      HEADS.map((head) => [
        head,
        amount(source[head], `${path}.${head}`, signed),
      ]),
    );
  };
  const groups = (value, path, signed = false) => {
    const source = object(value, path);
    for (const key of Object.keys(source))
      if (!GROUPS.includes(key))
        errors.push(`${path}.${key} is not a supported liability group.`);
    return Object.fromEntries(
      GROUPS.map((group) => [
        group,
        heads(source[group], `${path}.${group}`, signed),
      ]),
    );
  };
  const period = input.period;
  if (
    typeof period !== "string" ||
    !/^(?:20[1-9]\d|2[1-9]\d{2})-(?:0[1-9]|1[0-2])$/.test(period)
  )
    errors.push("Return period must be YYYY-MM.");
  const current = groups(input.liabilities, "liabilities", true);
  const negativeOpening = groups(input.negativeOpening, "negativeOpening");
  const credit = heads(input.credit, "credit");
  const cashInput = object(input.cash, "cash");
  for (const key of Object.keys(cashInput))
    if (!MINORS.includes(key))
      errors.push(`cash.${key} is not a supported cash minor head.`);
  const cash = Object.fromEntries(
    MINORS.map((minor) => [minor, heads(cashInput[minor], `cash.${minor}`)]),
  );
  const interest = heads(input.interest, "interest");
  const lateFee = heads(input.lateFee, "lateFee");
  // Interest and late fee are supplied as assessed Part A amounts. Do not
  // fabricate due dates, interest formulas or automatic late fee exemptions.
  const orderInput = object(input.order, "order");
  const order = {
    igstRemainder: "cgst-first",
    residualIgst: "cgst-first",
    ...orderInput,
  };
  for (const key of ["igstRemainder", "residualIgst"])
    if (!ORDERS.includes(order[key]))
      errors.push(`order.${key} must be cgst-first or sgst-first.`);
  if (period < "2026-02" && order.residualIgst === "sgst-first")
    errors.push(
      "SGST-first utilization against residual IGST is available from the February 2026 return period.",
    );

  const net = { A: emptyHeads(), B: emptyHeads() };
  const negativeClosing = { A: emptyHeads(), B: emptyHeads() };
  const adjustments = { A: emptyHeads(), B: emptyHeads() };
  for (const group of GROUPS)
    for (const head of HEADS) {
      const positive = Math.max(current[group][head], 0);
      adjustments[group][head] = Math.min(
        positive,
        negativeOpening[group][head],
      );
      net[group][head] = positive - adjustments[group][head];
      negativeClosing[group][head] = add(
        [
          negativeOpening[group][head] - adjustments[group][head],
          Math.max(-current[group][head], 0),
        ],
        `negativeClosing.${group}.${head}`,
      );
    }

  const matrix = emptyMatrix();
  if (input.allocation !== undefined) {
    const allocation = object(input.allocation, "allocation");
    for (const key of Object.keys(allocation))
      if (!HEADS.includes(key))
        errors.push(`allocation.${key} is not a supported liability head.`);
    for (const head of HEADS)
      matrix[head] = heads(allocation[head], `allocation.${head}`);
  } else {
    const remainingCredit = { ...credit };
    const remainingTax = { ...net.A };
    const use = (source, destination, cap = remainingTax[destination]) => {
      const utilized = Math.min(
        remainingCredit[source],
        remainingTax[destination],
        cap,
      );
      matrix[destination][source] += utilized;
      remainingCredit[source] -= utilized;
      remainingTax[destination] -= utilized;
    };
    use("igst", "igst");
    const igstDestinations =
      order.igstRemainder === "sgst-first"
        ? ["sgst", "cgst"]
        : ["cgst", "sgst"];
    // Use flexible IGST where same-head credit is insufficient first. A greedy
    // entire-IGST-to-CGST choice can strand CGST credit while SGST needs cash.
    for (const destination of igstDestinations)
      use(
        "igst",
        destination,
        Math.max(remainingTax[destination] - remainingCredit[destination], 0),
      );
    for (const destination of igstDestinations) use("igst", destination);
    use("cgst", "cgst");
    use("sgst", "sgst");
    const residualSources =
      order.residualIgst === "sgst-first" && period >= "2026-02"
        ? ["sgst", "cgst"]
        : ["cgst", "sgst"];
    for (const source of residualSources) use(source, "igst");
    use("cess", "cess");
  }

  const creditUsed = emptyHeads();
  const rowUsed = emptyHeads();
  for (const destination of HEADS) {
    rowUsed[destination] = add(
      HEADS.map((source) => matrix[destination][source]),
      `ITC utilized for ${destination}`,
    );
    if (rowUsed[destination] > net.A[destination])
      errors.push(
        `ITC allocated to ${destination.toUpperCase()} exceeds Section A net tax payable.`,
      );
    for (const source of HEADS)
      if (
        matrix[destination][source] > 0 &&
        !ALLOWED[destination].includes(source)
      )
        errors.push(
          `${source.toUpperCase()} credit cannot pay ${destination.toUpperCase()} liability.`,
        );
  }
  for (const source of HEADS) {
    creditUsed[source] = add(
      HEADS.map((destination) => matrix[destination][source]),
      `${source} credit utilized`,
    );
    if (creditUsed[source] > credit[source])
      errors.push(
        `${source.toUpperCase()} credit utilization exceeds the available ledger balance.`,
      );
  }
  if (
    matrix.cgst.igst + matrix.sgst.igst > 0 &&
    matrix.igst.igst !== Math.min(credit.igst, net.A.igst)
  )
    errors.push(
      "Use IGST credit against IGST liability first before using it against CGST or SGST.",
    );
  const ordinaryNet = add(
    ["igst", "cgst", "sgst"].map((head) => net.A[head]),
    "Section A non-cess net tax",
  );
  if (
    (creditUsed.cgst > 0 || creditUsed.sgst > 0) &&
    creditUsed.igst < Math.min(credit.igst, ordinaryNet)
  )
    errors.push(
      "Exhaust usable IGST credit before utilizing CGST or SGST credit.",
    );
  for (const head of ["cgst", "sgst"]) {
    const ownTaxAfterIgst = Math.max(net.A[head] - matrix[head].igst, 0);
    if (
      matrix.igst[head] > 0 &&
      matrix[head][head] !== Math.min(credit[head], ownTaxAfterIgst)
    )
      errors.push(
        `Use ${head.toUpperCase()} credit against its own liability first before paying residual IGST.`,
      );
  }
  if (period < "2026-02" && matrix.igst.sgst > 0) {
    // Credit required for CGST's own tax cannot be considered available for
    // residual IGST merely because a manual matrix elects to pay that tax cash.
    const cgstOwnNeed = Math.max(net.A.cgst - matrix.cgst.igst, 0);
    const cgstSurplus = Math.max(
      credit.cgst - Math.min(credit.cgst, cgstOwnNeed),
      0,
    );
    const residualIgst = Math.max(net.A.igst - matrix.igst.igst, 0);
    if (matrix.igst.cgst < Math.min(cgstSurplus, residualIgst))
      errors.push(
        "For periods before February 2026, use available CGST credit before SGST credit against residual IGST.",
      );
  }
  const creditClosing = Object.fromEntries(
    HEADS.map((head) => [head, Math.max(credit[head] - creditUsed[head], 0)]),
  );
  const cashRequired = emptyCash();
  const cashShortfall = emptyCash();
  const cashClosing = emptyCash();
  const rows = [];
  for (const group of GROUPS)
    for (const head of HEADS) {
      const utilized = group === "A" ? matrix[head] : emptyHeads();
      const cashTax = Math.max(
        net[group][head] - (group === "A" ? rowUsed[head] : 0),
        0,
      );
      rows.push({
        group,
        head,
        gross: current[group][head],
        negativeAdjusted: adjustments[group][head],
        net: net[group][head],
        itc: { ...utilized },
        cashTax,
        interest: group === "A" ? interest[head] : 0,
        lateFee: group === "A" ? lateFee[head] : 0,
      });
    }
  for (const head of HEADS) {
    cashRequired.tax[head] = add(
      rows.filter((row) => row.head === head).map((row) => row.cashTax),
      `Cash tax required for ${head}`,
    );
    cashRequired.interest[head] = interest[head];
    cashRequired.lateFee[head] = lateFee[head];
    for (const minor of MINORS) {
      cashShortfall[minor][head] = Math.max(
        cashRequired[minor][head] - cash[minor][head],
        0,
      );
      cashClosing[minor][head] = Math.max(
        cash[minor][head] - cashRequired[minor][head],
        0,
      );
    }
  }
  const sum = (values, label) => add(values, label);
  const totals = {
    taxPayable: sum(
      rows.map((row) => Math.max(row.gross, 0)),
      "Total gross tax payable",
    ),
    negativeAdjusted: sum(
      rows.map((row) => row.negativeAdjusted),
      "Total negative liability adjusted",
    ),
    netTax: sum(
      rows.map((row) => row.net),
      "Total net tax payable",
    ),
    itcUsed: sum(Object.values(creditUsed), "Total ITC utilized"),
    cashTax: sum(Object.values(cashRequired.tax), "Total cash tax"),
    interest: sum(Object.values(interest), "Total interest"),
    lateFee: sum(Object.values(lateFee), "Total late fee"),
    cashRequired: sum(
      MINORS.flatMap((minor) => Object.values(cashRequired[minor])),
      "Total cash required",
    ),
    shortfall: sum(
      MINORS.flatMap((minor) => Object.values(cashShortfall[minor])),
      "Total cash shortfall",
    ),
  };
  // Validate aggregate balances too; safe individual values are insufficient
  // when their sum can no longer be represented exactly by JavaScript.
  sum(Object.values(credit), "Total available credit");
  sum(
    MINORS.flatMap((minor) => Object.values(cash[minor])),
    "Total available cash",
  );
  return {
    period,
    order,
    rows,
    matrix,
    creditUsed,
    creditClosing,
    negativeClosing,
    cashRequired,
    cashShortfall,
    cashClosing,
    totals,
    errors: [...new Set(errors)],
  };
}
