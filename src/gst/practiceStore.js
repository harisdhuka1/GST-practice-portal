import { calculatePayment, HEADS } from "./paymentEngine.js";

export const SCHEMA_VERSION = 1;
export const OTP_TTL_MS = 10 * 60 * 1000;
const MINORS = ["tax", "interest", "lateFee"];
const GROUPS = ["A", "B"];
const copy = (value) => structuredClone(value);
const sum = (values) => values.reduce((total, value) => safe(total + value), 0);

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = "StorageError";
  }
}
export class ConflictError extends StorageError {
  constructor(message) {
    super(message);
    this.name = "ConflictError";
  }
}

function safe(value, signed = false) {
  if (!Number.isSafeInteger(value) || (!signed && value < 0))
    throw new Error(
      "Amounts must be safe integer paise; balances cannot be negative.",
    );
  return value;
}
function normalizeHeads(value = {}, signed = false) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected tax-head amounts.");
  if (Object.keys(value).some((head) => !HEADS.includes(head)))
    throw new Error("Unknown tax head. Use igst, cgst, sgst or cess.");
  return Object.fromEntries(
    HEADS.map((head) => [head, safe(value[head] ?? 0, signed)]),
  );
}
function normalizeCash(value = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((minor) => !MINORS.includes(minor))
  )
    throw new Error("Unknown or invalid cash minor head.");
  return Object.fromEntries(
    MINORS.map((minor) => [minor, normalizeHeads(value?.[minor])]),
  );
}
function normalizeNegative(value = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((group) => !GROUPS.includes(group))
  )
    throw new Error("Unknown or invalid negative liability section.");
  return Object.fromEntries(
    GROUPS.map((group) => [group, normalizeHeads(value?.[group])]),
  );
}
function normalizePartA(partA = {}) {
  const signatories = (partA.signatories ?? []).map((signatory) => {
    if (!signatory?.id || !signatory?.name)
      throw new Error("A signatory must have an ID and name.");
    return {
      id: String(signatory.id),
      name: String(signatory.name),
      email: String(signatory.email ?? ""),
      mobile: String(signatory.mobile ?? ""),
    };
  });
  if (
    new Set(signatories.map((signatory) => signatory.id)).size !==
    signatories.length
  )
    throw new Error("Signatory IDs must be unique.");
  return {
    ...copy(partA),
    liabilities: Object.fromEntries(
      GROUPS.map((group) => [
        group,
        normalizeHeads(partA.liabilities?.[group], true),
      ]),
    ),
    itc: normalizeHeads(partA.itc),
    interest: normalizeHeads(partA.interest),
    lateFee: normalizeHeads(partA.lateFee),
    signatories,
  };
}
function identity({ gstin, period }) {
  if (!/^[0-9A-Z]{15}$/.test(gstin ?? ""))
    throw new Error("Use a 15-character practice GSTIN.");
  if (!/^(?:20[1-9]\d|2[1-9]\d{2})-(0[1-9]|1[0-2])$/.test(period ?? ""))
    throw new Error("Return period must use YYYY-MM between 2010 and 2999.");
  return { gstin, period };
}
function id(prefix) {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
function otp() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    // Reject the small remainder to avoid modulo bias.
    do {
      globalThis.crypto.getRandomValues(values);
    } while (values[0] >= 4294800000);
    return String(100000 + (values[0] % 900000));
  }
  return String(100000 + Math.floor(Math.random() * 900000));
}
function date(now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("Invalid timestamp.");
  return new Date(now).toISOString();
}
function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new StorageError(`Invalid ${label} record.`);
}
function assertDate(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new StorageError(`Invalid ${label} timestamp.`);
}
function assertStoredHeads(value, signed = false) {
  assertRecord(value, "tax heads");
  if (HEADS.some((head) => !Object.hasOwn(value, head)))
    throw new StorageError("Incomplete stored tax-head balances.");
  normalizeHeads(value, signed);
}
function assertStoredCash(value) {
  assertRecord(value, "cash");
  if (MINORS.some((minor) => !Object.hasOwn(value, minor)))
    throw new StorageError("Incomplete stored cash minor heads.");
  normalizeCash(value);
  MINORS.forEach((minor) => assertStoredHeads(value[minor]));
}
function assertStoredNegative(value) {
  assertRecord(value, "negative liability");
  if (GROUPS.some((group) => !Object.hasOwn(value, group)))
    throw new StorageError("Incomplete stored liability sections.");
  normalizeNegative(value);
  GROUPS.forEach((group) => assertStoredHeads(value[group]));
}
function assertWorkspace(ws) {
  if (
    !ws ||
    ws.schemaVersion !== SCHEMA_VERSION ||
    typeof ws.id !== "string" ||
    !ws.id
  )
    throw new StorageError(
      "Unsupported or damaged practice workspace. Export your data before replacing it.",
    );
  identity(ws);
  assertDate(ws.createdAt, "workspace creation");
  assertDate(ws.updatedAt, "workspace update");
  if (
    !Number.isSafeInteger(ws.revision) ||
    ws.revision < 0 ||
    !["draft", "offset", "filed"].includes(ws.status)
  )
    throw new StorageError("Invalid workspace status or revision.");
  if (
    !ws.partA ||
    !ws.opening?.credit ||
    !ws.opening?.cash ||
    !ws.opening?.negative ||
    !ws.balances?.credit ||
    !ws.balances?.cash ||
    !ws.balances?.negative
  )
    throw new StorageError("Missing workspace balances or Part A.");
  normalizePartA(ws.partA);
  if (!Array.isArray(ws.partA.signatories))
    throw new StorageError("Missing authorized signatory list.");
  GROUPS.forEach((group) =>
    assertStoredHeads(ws.partA.liabilities?.[group], true),
  );
  ["itc", "interest", "lateFee"].forEach((field) =>
    assertStoredHeads(ws.partA[field]),
  );
  for (const ledger of [ws.opening, ws.balances]) {
    assertStoredHeads(ledger.credit);
    assertStoredCash(ledger.cash);
    assertStoredNegative(ledger.negative);
  }
  if (
    !Array.isArray(ws.challans) ||
    !Array.isArray(ws.ledger) ||
    !Array.isArray(ws.audit)
  )
    throw new StorageError("Incomplete practice records.");
  const challanIds = new Set();
  for (const challan of ws.challans) {
    assertRecord(challan, "challan");
    if (
      typeof challan.id !== "string" ||
      !challan.id ||
      challanIds.has(challan.id) ||
      !["pending", "paid"].includes(challan.status)
    )
      throw new StorageError("Invalid or duplicate stored challan.");
    challanIds.add(challan.id);
    assertDate(challan.createdAt, "challan creation");
    assertStoredCash(challan.amounts);
    const total = sum(
      MINORS.flatMap((minor) => Object.values(challan.amounts[minor])),
    );
    if (total <= 0 || challan.total !== total)
      throw new StorageError(
        "Stored challan total does not match its tax heads.",
      );
    if (challan.status === "paid") {
      if (!challan.cin)
        throw new StorageError("Paid challan has no practice CIN.");
      assertDate(challan.paidAt, "challan payment");
    }
  }
  for (const entry of ws.ledger) {
    assertRecord(entry, "ledger entry");
    if (
      !entry.id ||
      !["credit", "cash", "liability", "negative"].includes(entry.ledger) ||
      !["credit", "debit", "settled", "closing", "opening"].includes(
        entry.direction,
      )
    )
      throw new StorageError("Invalid stored ledger entry.");
    assertDate(entry.at, "ledger entry");
    assertRecord(entry.amounts, "ledger amounts");
  }
  for (const entry of ws.audit) {
    if (
      !entry?.id ||
      typeof entry.action !== "string" ||
      typeof entry.details !== "string"
    )
      throw new StorageError("Invalid stored audit entry.");
    assertDate(entry.at, "audit entry");
  }
  if (ws.paymentPlan != null) {
    assertRecord(ws.paymentPlan, "payment plan");
    assertRecord(ws.paymentPlan.order, "payment utilization order");
    for (const key of ["igstRemainder", "residualIgst"])
      if (!["cgst-first", "sgst-first"].includes(ws.paymentPlan.order[key]))
        throw new StorageError("Invalid stored payment utilization order.");
    if (ws.paymentPlan.allocation != null) {
      assertRecord(ws.paymentPlan.allocation, "payment allocation");
      if (
        Object.keys(ws.paymentPlan.allocation).some(
          (head) => !HEADS.includes(head),
        )
      )
        throw new StorageError("Unknown stored payment allocation head.");
      HEADS.forEach((head) =>
        assertStoredHeads(ws.paymentPlan.allocation[head]),
      );
    }
  }
  if (ws.challenge) {
    const challenge = ws.challenge;
    if (
      !challenge.id ||
      typeof challenge.code !== "string" ||
      !/^\d{6}$/.test(challenge.code) ||
      challenge.declaration !== true ||
      !ws.partA.signatories.some(
        (signatory) => signatory.id === challenge.signatoryId,
      )
    )
      throw new StorageError("Invalid stored EVC challenge.");
    assertDate(challenge.createdAt, "EVC creation");
    assertDate(challenge.expiresAt, "EVC expiry");
    if (
      Date.parse(challenge.expiresAt) - Date.parse(challenge.createdAt) !==
      OTP_TTL_MS
    )
      throw new StorageError("Invalid EVC expiry interval.");
  }
  if (ws.status === "draft" && (ws.challenge || ws.offset || ws.receipt))
    throw new StorageError(
      "Draft workspace contains an unexpected filing record.",
    );
  if (ws.status !== "draft" && (!ws.offset?.snapshot || !ws.offset?.inputs))
    throw new StorageError("Missing offset record.");
  if (ws.status !== "draft") {
    assertDate(ws.offset.at, "offset");
    const calculated = calculatePayment(ws.offset.inputs);
    if (
      !ws.offset.id ||
      calculated.errors.length ||
      calculated.totals.shortfall ||
      JSON.stringify(calculated) !== JSON.stringify(ws.offset.snapshot)
    )
      throw new StorageError(
        "Invalid or inconsistent stored offset calculation.",
      );
    const expectedBalances = {
      credit: calculated.creditClosing,
      cash: calculated.cashClosing,
      negative: calculated.negativeClosing,
    };
    if (JSON.stringify(expectedBalances) !== JSON.stringify(ws.balances))
      throw new StorageError(
        "Stored closing balances do not match the offset.",
      );
  }
  if (ws.status === "filed") {
    if (
      !ws.receipt ||
      !ws.challenge?.verifiedAt ||
      !ws.receipt.reference?.startsWith("PRACTICE-ARN-") ||
      ws.receipt.gstin !== ws.gstin ||
      ws.receipt.period !== ws.period ||
      ws.receipt.signatory?.id !== ws.challenge.signatoryId
    )
      throw new StorageError(
        "Missing or inconsistent practice filing receipt.",
      );
    assertDate(ws.receipt.filedAt, "filing");
    assertDate(ws.challenge.verifiedAt, "EVC verification");
    if (
      JSON.stringify(ws.receipt.payment) !==
        JSON.stringify(ws.offset.snapshot) ||
      ws.receipt.filedAt !== ws.challenge.verifiedAt
    )
      throw new StorageError(
        "The filing receipt does not match its offset or EVC verification.",
      );
  } else if (ws.receipt || ws.challenge?.verifiedAt)
    throw new StorageError("Unexpected completed filing record.");
}
function draftOnly(ws) {
  assertWorkspace(ws);
  if (ws.status !== "draft")
    throw new Error(
      "Liabilities have already been offset. Part A and payment balances are locked for this return.",
    );
}
function edit(ws, action, details, now = Date.now()) {
  const next = copy(ws);
  next.revision += 1;
  next.updatedAt = date(now);
  next.audit.push({ id: id("AUDIT"), at: next.updatedAt, action, details });
  return next;
}
function record(next, ledger, amounts, details) {
  next.ledger.push({
    id: id("ENTRY"),
    at: next.updatedAt,
    ledger,
    amounts: copy(amounts),
    ...details,
  });
}

export function createWorkspace({
  gstin,
  period,
  partA,
  opening = {},
  paymentPlan = null,
}) {
  identity({ gstin, period });
  const normalizedPartA = normalizePartA(partA);
  const normalizedOpening = {
    credit: normalizeHeads(opening.credit),
    cash: normalizeCash(opening.cash),
    negative: normalizeNegative(opening.negative),
  };
  const availableCredit = Object.fromEntries(
    HEADS.map((head) => [
      head,
      safe(normalizedOpening.credit[head] + normalizedPartA.itc[head]),
    ]),
  );
  const now = date();
  const ws = {
    schemaVersion: SCHEMA_VERSION,
    id: id("WORKSPACE"),
    gstin,
    period,
    revision: 0,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    partA: normalizedPartA,
    opening: normalizedOpening,
    balances: {
      credit: availableCredit,
      cash: copy(normalizedOpening.cash),
      negative: copy(normalizedOpening.negative),
    },
    challans: [],
    ledger: [],
    audit: [
      {
        id: id("AUDIT"),
        at: now,
        action: "workspace-created",
        details:
          "Practice return initialized. Current-period eligible ITC is included once in available credit.",
      },
    ],
    challenge: null,
    offset: null,
    receipt: null,
    paymentPlan: null,
  };
  if (paymentPlan != null) ws.paymentPlan = normalizedPlan(ws, paymentPlan);
  return ws;
}

/** Start a later return using the filed return's closing ledger balances. */
export function prepareNextPeriod(previous, { period, partA }) {
  assertWorkspace(previous);
  if (previous.status !== "filed")
    throw new Error(
      "File the current practice return before carrying balances to a later period.",
    );
  identity({ gstin: previous.gstin, period });
  if (period <= previous.period)
    throw new Error(
      "The new return period must be later than the filed period.",
    );
  if (!partA || typeof partA !== "object" || Array.isArray(partA))
    throw new Error("Provide the prepared Part A for the new return period.");
  const next = createWorkspace({
    gstin: previous.gstin,
    period,
    partA,
    opening: copy(previous.balances),
  });
  next.carryforward = {
    workspaceId: previous.id,
    period: previous.period,
    reference: previous.receipt.reference,
  };
  const details = {
    direction: "opening",
    reference: previous.receipt.reference,
    description: `Opening balance carried from filed practice period ${previous.period}.`,
  };
  record(next, "credit", next.opening.credit, details);
  record(next, "cash", next.opening.cash, details);
  record(next, "negative", next.opening.negative, details);
  next.audit.push({
    id: id("AUDIT"),
    at: next.updatedAt,
    action: "balances-carried-forward",
    details: `Credit, cash and negative liability balances copied from ${previous.period}. New-period eligible ITC is added once.`,
  });
  return next;
}

export function updatePartA(ws, partA) {
  draftOnly(ws);
  const normalized = normalizePartA(partA);
  const next = edit(
    ws,
    "part-a-updated",
    "Payment calculation will be refreshed from Part A.",
  );
  next.partA = normalized;
  next.balances.credit = Object.fromEntries(
    HEADS.map((head) => [
      head,
      safe(ws.opening.credit[head] + normalized.itc[head]),
    ]),
  );
  // Manual allocations are tied to the previous liability/ITC snapshot.
  // Keep the selected legal order, but recalculate allocation after Part A edits.
  next.paymentPlan = ws.paymentPlan
    ? { order: copy(ws.paymentPlan.order), allocation: null }
    : null;
  return next;
}

export function getPaymentInputs(ws, options = {}) {
  assertWorkspace(ws);
  if (ws.status !== "draft") return copy(ws.offset.inputs);
  const order = options.order ?? ws.paymentPlan?.order;
  const allocation = Object.hasOwn(options, "allocation")
    ? options.allocation
    : ws.paymentPlan?.allocation;
  return {
    period: ws.period,
    liabilities: copy(ws.partA.liabilities),
    negativeOpening: copy(ws.balances.negative),
    credit: copy(ws.balances.credit),
    cash: copy(ws.balances.cash),
    interest: copy(ws.partA.interest),
    lateFee: copy(ws.partA.lateFee),
    ...(order ? { order: copy(order) } : {}),
    ...(allocation != null ? { allocation: copy(allocation) } : {}),
  };
}

function normalizedPlan(ws, { order, allocation = null } = {}) {
  const inputs = getPaymentInputs(ws, { order, allocation });
  const calculated = calculatePayment(inputs);
  if (calculated.errors.length) throw new Error(calculated.errors.join(" "));
  return {
    order: copy(calculated.order),
    allocation: allocation == null ? null : copy(calculated.matrix),
  };
}

/** Save a validated allocation without requiring the cash shortfall to be funded. */
export function updatePaymentPlan(ws, plan = {}) {
  draftOnly(ws);
  const paymentPlan = normalizedPlan(ws, plan);
  const next = edit(
    ws,
    "payment-plan-saved",
    paymentPlan.allocation
      ? "Validated manual ITC allocation saved for this draft return."
      : "Automatic Rule 88A allocation and utilization order saved for this draft return.",
  );
  next.paymentPlan = paymentPlan;
  return next;
}

export function createChallan(ws, { amounts }) {
  draftOnly(ws);
  const normalized = normalizeCash(amounts);
  const total = sum(
    MINORS.flatMap((minor) => Object.values(normalized[minor])),
  );
  if (total === 0)
    throw new Error("A challan must contain a positive cash deposit.");
  const next = edit(
    ws,
    "challan-created",
    "An unpaid practice challan was generated.",
  );
  next.challans.push({
    id: id("PRACTICE-CPIN"),
    createdAt: next.updatedAt,
    amounts: normalized,
    total,
    status: "pending",
  });
  return next;
}

export function markChallanPaid(ws, challanId) {
  assertWorkspace(ws);
  const original = ws.challans.find((challan) => challan.id === challanId);
  if (!original) throw new Error("Practice challan not found.");
  if (original.status === "paid") return ws;
  draftOnly(ws);
  const next = edit(
    ws,
    "challan-paid",
    `Simulated deposit credited once: ${challanId}`,
  );
  const challan = next.challans.find((item) => item.id === challanId);
  challan.status = "paid";
  challan.paidAt = next.updatedAt;
  challan.cin = id("PRACTICE-CIN");
  for (const minor of MINORS)
    for (const head of HEADS)
      next.balances.cash[minor][head] = safe(
        next.balances.cash[minor][head] + challan.amounts[minor][head],
      );
  record(next, "cash", challan.amounts, {
    direction: "credit",
    reference: challan.cin,
    description: "Simulated challan payment; no bank transaction.",
  });
  return next;
}

export function offsetLiabilities(ws, options = {}) {
  assertWorkspace(ws);
  if (ws.status !== "draft") return ws;
  const inputs = getPaymentInputs(ws, options);
  const payment = calculatePayment(inputs);
  if (payment.errors?.length) throw new Error(payment.errors.join(" "));
  if (payment.totals.shortfall > 0)
    throw new Error(
      "Insufficient cash in one or more tax heads or minor heads. Generate and pay a practice challan for the shortfall.",
    );
  const next = edit(
    ws,
    "liability-offset",
    "Tax liability offset once using the validated ITC matrix and available cash.",
  );
  next.status = "offset";
  next.offset = {
    id: id("PRACTICE-OFFSET"),
    at: next.updatedAt,
    inputs,
    snapshot: copy(payment),
  };
  next.balances = {
    credit: copy(payment.creditClosing),
    cash: copy(payment.cashClosing),
    negative: copy(payment.negativeClosing),
  };
  record(next, "credit", payment.creditUsed, {
    direction: "debit",
    reference: next.offset.id,
    description: "ITC utilized against section A tax.",
  });
  record(next, "cash", payment.cashRequired, {
    direction: "debit",
    reference: next.offset.id,
    description: "Tax, interest and late fee discharged in cash.",
  });
  record(
    next,
    "liability",
    {
      gross: payment.totals.taxPayable,
      negativeAdjusted: payment.totals.negativeAdjusted,
      itc: payment.totals.itcUsed,
      cash: payment.totals.cashTax,
    },
    {
      direction: "settled",
      reference: next.offset.id,
      description: "Table 6.1 payment completed.",
    },
  );
  record(next, "negative", payment.negativeClosing, {
    direction: "closing",
    reference: next.offset.id,
    description:
      "View-only negative liability balance carried forward by section and tax head.",
  });
  return next;
}

export function requestEvc(ws, { signatoryId, declaration }, now = Date.now()) {
  assertWorkspace(ws);
  if (ws.status !== "offset")
    throw new Error("Offset the liabilities before requesting EVC.");
  if (declaration !== true) throw new Error("Accept the filing declaration.");
  const signatory = ws.partA.signatories.find(
    (item) => item.id === signatoryId,
  );
  if (!signatory)
    throw new Error("Select an authorized signatory from Part A.");
  const next = edit(
    ws,
    "evc-requested",
    `Practice code generated for ${signatory.name}; no SMS or email sent.`,
    now,
  );
  next.challenge = {
    id: id("PRACTICE-EVC"),
    code: otp(),
    createdAt: date(now),
    expiresAt: date(now + OTP_TTL_MS),
    signatoryId,
    declaration: true,
  };
  return next;
}

export function verifyEvc(ws, { code, challengeId }, now = Date.now()) {
  assertWorkspace(ws);
  if (ws.status === "filed") {
    if (ws.challenge?.id === challengeId && ws.challenge?.code === String(code))
      return ws;
    throw new Error(
      "This practice return is already filed and cannot be revised.",
    );
  }
  if (ws.status !== "offset" || !ws.challenge)
    throw new Error("Request an EVC after offsetting liabilities.");
  if (challengeId !== ws.challenge.id)
    throw new Error("A newer EVC has been generated. Use the latest code.");
  if (now >= Date.parse(ws.challenge.expiresAt))
    throw new Error("EVC expired. Generate a new practice code.");
  if (!/^\d{6}$/.test(String(code)) || String(code) !== ws.challenge.code)
    throw new Error(
      "Incorrect EVC. Enter the current six-digit practice code.",
    );
  const signatory = ws.partA.signatories.find(
    (item) => item.id === ws.challenge.signatoryId,
  );
  if (!signatory || !ws.challenge.declaration)
    throw new Error("The authorized signatory or declaration is missing.");
  const next = edit(
    ws,
    "return-filed",
    "Practice GSTR-3B filed using simulated EVC. No government filing occurred.",
    now,
  );
  next.status = "filed";
  next.challenge.verifiedAt = next.updatedAt;
  next.receipt = {
    reference: id("PRACTICE-ARN"),
    gstin: next.gstin,
    period: next.period,
    filedAt: next.updatedAt,
    signatory: copy(signatory),
    mode: "Simulated EVC",
    disclaimer:
      "PRACTICE ONLY — not an official GST acknowledgement or filing.",
    payment: copy(next.offset.snapshot),
  };
  return next;
}

export function workspaceKey({ gstin, period }) {
  identity({ gstin, period });
  return `gst-practice:payment:v${SCHEMA_VERSION}:${gstin}:${period}`;
}
function storageOrThrow(storage) {
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function"
  )
    throw new StorageError(
      "Browser storage is unavailable. Enable local storage before saving or making financial changes.",
    );
  return storage;
}
function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    throw new StorageError(
      "Browser storage is blocked. Enable it before continuing.",
    );
  }
}
function parseStored(raw, expected) {
  try {
    const value = JSON.parse(raw);
    assertWorkspace(value);
    if (value.gstin !== expected.gstin || value.period !== expected.period)
      throw new Error("Identity mismatch");
    return value;
  } catch (error) {
    throw new StorageError(
      `Saved practice data is damaged or incompatible. It has not been reset. ${error.message}`,
    );
  }
}
export function loadWorkspace(identityInput, storage = defaultStorage()) {
  storageOrThrow(storage);
  const key = workspaceKey(identityInput);
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    throw new StorageError(
      "Unable to read browser storage. Saved data has not been reset.",
    );
  }
  return raw === null ? null : parseStored(raw, identityInput);
}
export function saveWorkspace(ws, storage = defaultStorage()) {
  assertWorkspace(ws);
  storageOrThrow(storage);
  const key = workspaceKey(ws);
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    throw new StorageError("Unable to read browser storage before saving.");
  }
  const serialized = JSON.stringify(ws);
  if (raw !== null) {
    const persisted = parseStored(raw, ws);
    if (persisted.id !== ws.id)
      throw new ConflictError(
        "A different workspace exists for this GSTIN and period. Reload before continuing.",
      );
    if (persisted.revision === ws.revision && raw === serialized) return ws;
    if (persisted.revision !== ws.revision - 1)
      throw new ConflictError(
        "This return changed in another tab. Reload the saved workspace before continuing.",
      );
  } else if (ws.revision !== 0) {
    throw new ConflictError(
      "The saved workspace is missing. Save the initial workspace before making changes.",
    );
  }
  try {
    storage.setItem(key, serialized);
  } catch {
    throw new StorageError(
      "Unable to save browser data. Your action was not committed. Free storage space or enable local storage, then retry.",
    );
  }
  return ws;
}
