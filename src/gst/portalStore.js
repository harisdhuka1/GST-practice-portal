import { HEADS, emptyHeads, calculatePayment } from "./paymentEngine.js";
import {
  StorageError,
  ConflictError,
  getPaymentInputs,
} from "./practiceStore.js";
import { SAMPLE_GSTIN, SAMPLE_OPENING, SAMPLE_PART_A } from "./sample.js";

export const PORTAL_SCHEMA_VERSION = 1;
export const PORTAL_KEY = "gst-practice:portal:v1";
export const TABLES = Object.freeze([
  {
    id: "b2b",
    number: "4A, 4B, 6B, 6C",
    title: "B2B Invoices",
    subtitle: "Taxable supplies to registered persons",
    kind: "invoice",
  },
  {
    id: "b2cl",
    number: "5",
    title: "B2C (Large) Invoices",
    subtitle: "Inter-state unregistered supplies above ₹1 lakh invoice value",
    kind: "invoice",
  },
  {
    id: "exports",
    number: "6A",
    title: "Export Invoices",
    subtitle: "Exports with or without payment of tax",
    kind: "invoice",
  },
  {
    id: "b2cs",
    number: "7",
    title: "B2C (Others)",
    subtitle: "Other supplies to unregistered persons",
    kind: "invoice",
  },
  {
    id: "nil",
    number: "8",
    title: "Nil Rated, Exempted & Non-GST",
    subtitle: "Summary of nil-rated, exempted and non-GST supplies",
    kind: "invoice",
  },
  {
    id: "cdnr",
    number: "9B",
    title: "Credit / Debit Notes (Registered)",
    subtitle: "Notes issued to registered recipients",
    kind: "invoice",
  },
  {
    id: "cdnur",
    number: "9B",
    title: "Credit / Debit Notes (Unregistered)",
    subtitle: "Notes issued to unregistered recipients",
    kind: "invoice",
  },
  {
    id: "amend-invoices",
    number: "9A",
    title: "Amended Invoices",
    subtitle: "Amend B2B, B2C large and export invoices",
    kind: "invoice",
    amendment: true,
  },
  {
    id: "amend-notes",
    number: "9C",
    title: "Amended Credit / Debit Notes",
    subtitle: "Amend registered and unregistered notes",
    kind: "invoice",
    amendment: true,
  },
  {
    id: "amend-b2cs",
    number: "10",
    title: "Amended B2C (Others)",
    subtitle: "Amend earlier-period B2C summary",
    kind: "invoice",
    amendment: true,
  },
  {
    id: "advances",
    number: "11A, 11B",
    title: "Advances & Adjustments",
    subtitle: "Tax liability on advances and advance adjustments",
    kind: "invoice",
  },
  {
    id: "hsn",
    number: "12",
    title: "HSN-wise Summary",
    subtitle: "Separate B2B and B2C HSN summaries",
    kind: "summary",
  },
  {
    id: "documents",
    number: "13",
    title: "Documents Issued",
    subtitle: "Serial ranges, issued and cancelled documents",
    kind: "documents",
  },
  {
    id: "ecommerce",
    number: "14, 14A",
    title: "Supplies through E-commerce Operators",
    subtitle: "Supplementary supplier reporting; no duplicate tax",
    kind: "invoice",
  },
  {
    id: "ecommerce95",
    number: "15, 15A",
    title: "Section 9(5) E-commerce Supplies",
    subtitle: "Operator tax liability payable in cash",
    kind: "invoice",
  },
]);
const ACTIONS = ["accepted", "rejected", "pending", "no-action"];
const AMENDMENTS = {
  "amend-invoices": ["b2b", "b2cl", "exports"],
  "amend-notes": ["cdnr", "cdnur"],
  "amend-b2cs": ["b2cs"],
};
const copy = (value) => structuredClone(value);
const uid = (prefix) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const timestamp = () => new Date().toISOString();
const safe = (n, signed = false) => {
  if (!Number.isSafeInteger(n) || (!signed && n < 0))
    throw new Error(
      "Amounts must be safe integer paise; negative values are represented by document type.",
    );
  return n;
};
const total = (values) => {
  const n = values.reduce((a, b) => a + BigInt(safe(b, true)), 0n);
  if (
    n > BigInt(Number.MAX_SAFE_INTEGER) ||
    n < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("The total exceeds the supported safe monetary limit.");
  return Number(n);
};
const heads = (o = {}, signed = false) => {
  if (
    !o ||
    typeof o !== "object" ||
    Array.isArray(o) ||
    Object.keys(o).some((k) => !HEADS.includes(k))
  )
    throw new Error("Invalid tax-head amounts.");
  return Object.fromEntries(HEADS.map((h) => [h, safe(o[h] ?? 0, signed)]));
};
const addHeads = (a, b) =>
  Object.fromEntries(HEADS.map((h) => [h, total([a[h] || 0, b[h] || 0])]));
const validPeriod = (period) => {
  if (!/^(?:20[1-9]\d|2[1-9]\d{2})-(?:0[1-9]|1[0-2])$/.test(period || ""))
    throw new Error("Select a valid return period (YYYY-MM).");
  return period;
};
const validDate = (date) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date || "") ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error("Enter a valid document date.");
  return date;
};
const decimalBasis = (rate) => {
  if (
    typeof rate !== "number" ||
    !Number.isFinite(rate) ||
    rate < 0 ||
    rate > 100 ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(rate))
  )
    throw new Error("Enter a valid GST rate with up to two decimal places.");
  return Math.round(rate * 100);
};
const rounded = (numerator, denominator) => {
  const value = (numerator + denominator / 2n) / denominator;
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Tax exceeds the supported monetary limit.");
  return Number(value);
};
const zeroSummary = () => ({
  taxable: 0,
  ...emptyHeads(),
  totalTax: 0,
  recordCount: 0,
});
const addSummary = (a, b) => ({
  taxable: total([a.taxable, b.taxable || 0]),
  ...addHeads(a, b),
  totalTax: total([
    a.totalTax,
    b.totalTax ?? total(HEADS.map((h) => b[h] || 0)),
  ]),
  recordCount: a.recordCount + (b.recordCount ?? 1),
});
const emptyAdjustments = () => ({
  rcm: emptyHeads(),
  interest: emptyHeads(),
  lateFee: emptyHeads(),
  itcReversal: emptyHeads(),
});
function emptyPeriod() {
  return {
    gstr1: { status: "draft", records: [], receipt: null },
    ims: { records: [], version: 0 },
    gstr2b: null,
    adjustments: emptyAdjustments(),
    paymentLock: null,
    filing: null,
    closing: null,
  };
}
function assertPortal(state) {
  if (
    !state ||
    state.schemaVersion !== PORTAL_SCHEMA_VERSION ||
    typeof state.id !== "string" ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !state.taxpayer ||
    !/^[0-9A-Z]{15}$/.test(state.taxpayer.gstin || "") ||
    !Array.isArray(state.taxpayer.signatories) ||
    !state.periods ||
    typeof state.periods !== "object"
  )
    throw new StorageError(
      "Unsupported or damaged portal workspace. Your saved data has been retained.",
    );
  validPeriod(state.selectedPeriod);
  if (!state.periods[state.selectedPeriod])
    throw new StorageError("The selected return period is missing.");
  for (const [period, data] of Object.entries(state.periods)) {
    validPeriod(period);
    if (
      !data ||
      !data.gstr1 ||
      !["draft", "filed"].includes(data.gstr1.status) ||
      !Array.isArray(data.gstr1.records) ||
      !data.ims ||
      !Array.isArray(data.ims.records) ||
      !Number.isSafeInteger(data.ims.version) ||
      data.ims.version < 0 ||
      !data.adjustments
    )
      throw new StorageError("A saved return period is incomplete.");
    for (const record of data.gstr1.records) {
      if (!record.id || !TABLES.some((t) => t.id === record.tableId))
        throw new StorageError("A saved GSTR-1 record is invalid.");
      if (record.tableId !== "documents") {
        safe(record.taxable);
        decimalBasis(record.rate ?? 0);
        safe(record.cess ?? 0);
        if (record.reportedTax) heads(record.reportedTax);
      }
    }
    for (const record of data.ims.records) {
      if (
        !record.id ||
        !ACTIONS.includes(record.action) ||
        typeof record.supplierFiled !== "boolean"
      )
        throw new StorageError("A saved IMS record is invalid.");
      safe(record.taxable);
      heads(Object.fromEntries(HEADS.map((h) => [h, record[h] ?? 0])));
      if (record.itcReduction) {
        const reduction = heads(record.itcReduction);
        for (const h of HEADS)
          if (reduction[h] > (record[h] || 0))
            throw new StorageError(
              "Saved ITC reduction exceeds credit-note tax.",
            );
      }
    }
    for (const key of ["rcm", "interest", "lateFee", "itcReversal"])
      heads(data.adjustments[key] || {});
    if (data.gstr1.status === "filed" && !data.gstr1.receipt)
      throw new StorageError("The filed GSTR-1 acknowledgement is missing.");
    if (
      data.gstr2b &&
      (!Number.isSafeInteger(data.gstr2b.sourceVersion) ||
        typeof data.gstr2b.generatedAt !== "string")
    )
      throw new StorageError("A saved GSTR-2B snapshot is incomplete.");
    if (
      data.filing &&
      (!data.filing.reference?.startsWith("PRACTICE-ARN-") || !data.closing)
    )
      throw new StorageError(
        "The filed GSTR-3B acknowledgement or closing ledgers are missing.",
      );
  }
}
export function getPeriod(state, period = state.selectedPeriod) {
  assertPortal(state);
  validPeriod(period);
  const data = state.periods[period];
  if (!data)
    throw new Error("The selected return period has not been created.");
  return data;
}
function edit(state, action, details) {
  assertPortal(state);
  const next = copy(state);
  next.revision++;
  next.updatedAt = timestamp();
  next.audit.push({
    id: uid("AUDIT"),
    at: next.updatedAt,
    period: next.selectedPeriod,
    action,
    details,
  });
  return next;
}
function unlocked(data) {
  if (data.paymentLock || data.filing)
    throw new Error(
      "Payment has been posted for this return. Upstream return data is locked.",
    );
}
function editableGstr1(state) {
  const data = getPeriod(state);
  unlocked(data);
  if (data.gstr1.status === "filed")
    throw new Error(
      "GSTR-1 is filed and cannot be edited. Use a subsequent-period amendment.",
    );
  return data;
}
function carriedPending(state, period) {
  const previous = Object.entries(state.periods)
    .filter(([p, d]) => p < period && d.filing)
    .sort(([a], [b]) => b.localeCompare(a))[0];
  if (!previous) return null;
  return {
    reference: previous[1].filing.reference,
    period: previous[0],
    records: previous[1].ims.records
      .filter(
        (r) =>
          (r.action === "pending" || r.supplierFiled === false) &&
          actionable(r),
      )
      .map((r) => ({ ...copy(r), carriedFrom: r.carriedFrom || previous[0] })),
  };
}
function addPendingCarry(state, period) {
  const target = state.periods[period],
    carry = carriedPending(state, period);
  if (
    !carry ||
    target.paymentLock ||
    target.filing ||
    target.pendingCarryReference === carry.reference
  )
    return;
  const existing = new Set(target.ims.records.map((r) => r.id));
  const incoming = carry.records.filter((r) => !existing.has(r.id));
  if (incoming.length) {
    target.ims.records.push(...incoming);
    target.ims.version++;
  }
  target.pendingCarryReference = carry.reference;
}
export function ensurePeriod(state, period) {
  validPeriod(period);
  assertPortal(state);
  if (state.periods[period]) return state;
  const next = edit(
    state,
    "period-created",
    `Practice return ${period} initialized.`,
  );
  next.periods[period] = emptyPeriod();
  addPendingCarry(next, period);
  return next;
}
export function updateSelectedPeriod(state, period) {
  validPeriod(period);
  assertPortal(state);
  if (state.selectedPeriod === period) return state;
  const next = edit(state, "period-selected", `Selected ${period}.`);
  next.periods[period] ||= emptyPeriod();
  addPendingCarry(next, period);
  next.selectedPeriod = period;
  return next;
}

function baseTax(state, record) {
  const taxable = safe(record.taxable ?? 0),
    rate = decimalBasis(record.rate ?? 0),
    cess = safe(record.cess ?? 0);
  let result = { taxable, ...emptyHeads(), totalTax: 0 };
  if (record.tableId === "documents")
    return { ...zeroSummary(), recordCount: 1 };
  if (record.tableId === "hsn" && record.reportedTax) {
    const reported = heads(record.reportedTax);
    return {
      taxable,
      ...reported,
      totalTax: total(HEADS.map((h) => reported[h])),
    };
  }
  if (
    record.tableId === "nil" ||
    ((record.tableId === "exports" || record.subType === "export") &&
      (record.exportType || record.paymentType) === "without-payment")
  )
    return result;
  if (
    String(record.pos) === "96" ||
    String(record.pos) !== state.taxpayer.stateCode
  ) {
    result.igst = rounded(BigInt(taxable) * BigInt(rate), 10000n);
  } else {
    const half = rounded(BigInt(taxable) * BigInt(rate), 20000n);
    result.cgst = half;
    result.sgst = half;
  }
  result.cess = cess;
  result.totalTax = total(HEADS.map((h) => result[h]));
  return result;
}
function findOriginal(state, record) {
  const data = state.periods[record.originalPeriod || state.selectedPeriod];
  const original = data?.gstr1.records.find((r) => r.id === record.originalId);
  if (!original || !AMENDMENTS[record.tableId]?.includes(original.tableId))
    throw new Error(
      "Select a matching original invoice or note for the amendment.",
    );
  if (
    !record.originalPeriod ||
    record.originalPeriod >= state.selectedPeriod ||
    data.gstr1.status !== "filed"
  )
    throw new Error(
      "An amendment must refer to a filed original document in an earlier return period.",
    );
  return original;
}
function priorAmendmentBaseline(state, record) {
  const original = findOriginal(state, record);
  const earlier = Object.entries(state.periods)
    .filter(
      ([period, data]) =>
        period < state.selectedPeriod && data.gstr1.status === "filed",
    )
    .sort(([a], [b]) => b.localeCompare(a));
  for (const [period, data] of earlier) {
    const revision = data.gstr1.records.find(
      (r) =>
        r.tableId === record.tableId &&
        r.originalId === record.originalId &&
        r.originalPeriod === record.originalPeriod,
    );
    if (revision) return revision;
  }
  return original;
}
export function taxForRecord(state, record) {
  if (record.tableId === "documents")
    return { ...zeroSummary(), recordCount: 1 };
  let tax = baseTax(state, record);
  const sign =
    record.documentType === "credit-note" ||
    (record.tableId === "advances" && record.subType === "adjusted")
      ? -1
      : 1;
  tax = Object.fromEntries(Object.entries(tax).map(([k, v]) => [k, v * sign]));
  if (AMENDMENTS[record.tableId]) {
    const original = priorAmendmentBaseline(state, record);
    const originalSign = original.documentType === "credit-note" ? -1 : 1;
    const originalTax = baseTax(state, original);
    const old = Object.fromEntries(
      Object.entries(originalTax).map(([key, value]) => [
        key,
        value * originalSign,
      ]),
    );
    tax = Object.fromEntries(
      Object.keys(tax).map((k) => [k, total([tax[k], -old[k]])]),
    );
  }
  return tax;
}
function normalizeSale(state, input) {
  const table = TABLES.find((t) => t.id === input?.tableId);
  if (!table) throw new Error("Select a supported GSTR-1 table.");
  const record = {
    ...copy(input),
    id: input.id || uid("SALE"),
    tableId: table.id,
  };
  if (table.kind === "documents") {
    record.documentCategory = String(
      input.documentCategory ||
        input.documentType ||
        "Invoices for outward supply",
    ).slice(0, 100);
    record.serialFrom = String(
      input.serialFrom || input.fromSerial || "",
    ).trim();
    record.serialTo = String(input.serialTo || input.toSerial || "").trim();
    record.totalDocuments = safe(input.totalDocuments ?? 0);
    record.cancelledDocuments = safe(input.cancelledDocuments ?? 0);
    if (
      !record.serialFrom ||
      !record.serialTo ||
      !record.totalDocuments ||
      record.cancelledDocuments > record.totalDocuments
    )
      throw new Error(
        "Enter a serial range and valid issued/cancelled document counts.",
      );
    return record;
  }
  record.taxable = safe(input.taxable ?? 0);
  record.rate = input.rate ?? 0;
  decimalBasis(record.rate);
  record.cess = safe(input.cess ?? 0);
  record.pos = String(input.pos || state.taxpayer.stateCode);
  record.documentType = input.documentType || "invoice";
  record.subType = input.subType || input.subtype || "";
  record.exportType = input.exportType || input.paymentType || "with-payment";
  if (!["invoice", "credit-note", "debit-note"].includes(record.documentType))
    throw new Error("Choose an invoice, credit note or debit note.");
  if (!/^(?:0[1-9]|[1-2][0-9]|3[0-8]|96|97)$/.test(record.pos))
    throw new Error("Select a valid place of supply state code.");
  if (table.kind === "summary") {
    record.hsn = String(input.hsn || "").trim();
    record.description = String(input.description || "").slice(0, 200);
    record.uqc = String(input.uqc || "NOS");
    record.quantity = Number(input.quantity ?? 0);
    record.hsnCategory = input.hsnCategory || "B2B";
    if (input.reportedTax) record.reportedTax = heads(input.reportedTax);
    if (
      !/^\d{4,8}$/.test(record.hsn) ||
      !Number.isFinite(record.quantity) ||
      record.quantity < 0 ||
      !["B2B", "B2C"].includes(record.hsnCategory)
    )
      throw new Error(
        "Enter a 4 to 8 digit HSN, nonnegative quantity and B2B/B2C classification.",
      );
    return record;
  }
  record.invoiceNo = String(input.invoiceNo || "").trim();
  record.recipientGstin = String(input.recipientGstin || "")
    .trim()
    .toUpperCase();
  record.recipientName = String(input.recipientName || "")
    .trim()
    .slice(0, 120);
  record.date = validDate(input.date);
  if (
    !record.invoiceNo ||
    record.invoiceNo.length > 16 ||
    !/^[A-Za-z0-9\/-]+$/.test(record.invoiceNo)
  )
    throw new Error(
      "Use a document number of up to 16 letters, numbers, / or -.",
    );
  if (!table.amendment && record.date.slice(0, 7) !== state.selectedPeriod)
    throw new Error("Document date must fall in the selected return period.");
  if (
    ["b2b", "cdnr"].includes(table.id) &&
    !/^\d{2}[A-Z0-9]{13}$/.test(record.recipientGstin)
  )
    throw new Error("Enter a 15-character recipient practice GSTIN.");
  if (record.recipientGstin && record.recipientGstin === state.taxpayer.gstin)
    throw new Error("The recipient GSTIN must differ from the supplier GSTIN.");
  if (table.id === "exports") {
    record.pos = "96";
    if (!["with-payment", "without-payment"].includes(record.exportType))
      throw new Error("Select export with or without payment.");
  }
  if (
    ["cdnr", "cdnur", "amend-notes"].includes(table.id) &&
    !["credit-note", "debit-note"].includes(record.documentType)
  )
    throw new Error("Select a credit note or debit note document type.");
  if (
    table.id === "advances" &&
    !["received", "adjusted"].includes(record.subType)
  )
    throw new Error("Select advance received or advance adjusted.");
  if (table.id === "ecommerce" && !["14a", "14b"].includes(record.subType))
    record.subType = "14a";
  if (
    ["ecommerce", "ecommerce95"].includes(table.id) &&
    input.ecommerceGstin &&
    !/^\d{2}[A-Z0-9]{13}$/.test(String(input.ecommerceGstin))
  )
    throw new Error("Enter a valid practice e-commerce GSTIN.");
  if (table.amendment) {
    const original = findOriginal(state, record);
    if (!!record.reverseCharge !== !!original.reverseCharge)
      throw new Error(
        "Changing reverse-charge classification through an amendment is not supported. Retain the original classification.",
      );
    if (table.id === "amend-invoices")
      record.subType =
        original.tableId === "exports" ? "export" : original.tableId;
  }
  const tax = baseTax(state, record);
  record.invoiceValue = total([record.taxable, tax.totalTax]);
  if (
    table.id === "b2cl" &&
    (record.pos === state.taxpayer.stateCode ||
      record.invoiceValue <= 10000000 ||
      record.recipientGstin)
  )
    throw new Error(
      "B2C Large requires an inter-state unregistered invoice with value above ₹1 lakh.",
    );
  if (
    table.id === "b2cs" &&
    record.pos !== state.taxpayer.stateCode &&
    record.invoiceValue > 10000000
  )
    throw new Error(
      "Inter-state unregistered invoices above ₹1 lakh belong in B2C Large.",
    );
  if (record.taxable === 0 && record.cess === 0 && table.id !== "nil")
    throw new Error("Enter a positive taxable amount.");
  return record;
}
export function upsertGstr1Record(state, input) {
  const data = editableGstr1(state),
    record = normalizeSale(state, input);
  const duplicates = data.gstr1.records.filter((r) => r.id !== record.id);
  if (
    record.invoiceNo &&
    duplicates.some(
      (r) =>
        r.tableId === record.tableId &&
        r.invoiceNo === record.invoiceNo &&
        r.recipientGstin === record.recipientGstin,
    )
  )
    throw new Error("This document is already present in the selected table.");
  if (
    record.originalId &&
    duplicates.some(
      (r) =>
        r.originalId === record.originalId &&
        (r.originalPeriod || state.selectedPeriod) ===
          (record.originalPeriod || state.selectedPeriod),
    )
  )
    throw new Error(
      "This original document already has an amendment in this return.",
    );
  const next = edit(
    state,
    "gstr1-record-saved",
    `Saved ${record.tableId} document.`,
  );
  const records = next.periods[next.selectedPeriod].gstr1.records,
    index = records.findIndex((r) => r.id === record.id);
  if (index < 0) records.push(record);
  else records[index] = record;
  gstr1Totals(next);
  return next;
}
export function deleteGstr1Record(state, id) {
  const data = editableGstr1(state);
  if (!data.gstr1.records.some((r) => r.id === id))
    throw new Error("GSTR-1 record not found.");
  if (
    data.gstr1.records.some(
      (r) =>
        r.originalId === id &&
        (r.originalPeriod || state.selectedPeriod) === state.selectedPeriod,
    )
  )
    throw new Error(
      "Delete the linked amendment before deleting its original document.",
    );
  const next = edit(
    state,
    "gstr1-record-deleted",
    "Removed a draft GSTR-1 record.",
  );
  next.periods[next.selectedPeriod].gstr1.records = data.gstr1.records.filter(
    (r) => r.id !== id,
  );
  return next;
}
export function gstr1Totals(state) {
  const data = getPeriod(state);
  let summary = zeroSummary();
  const byTable = Object.fromEntries(TABLES.map((t) => [t.id, zeroSummary()])),
    liabilities = { A: emptyHeads(), B: emptyHeads() };
  for (const record of data.gstr1.records) {
    const tax = taxForRecord(state, record);
    byTable[record.tableId] = addSummary(byTable[record.tableId], tax);
    if (["hsn", "documents", "ecommerce"].includes(record.tableId)) continue;
    summary = addSummary(summary, tax);
    if (record.reverseCharge) continue;
    const group = record.tableId === "ecommerce95" ? "B" : "A";
    liabilities[group] = addHeads(liabilities[group], tax);
  }
  return {
    ...summary,
    recordCount: data.gstr1.records.length,
    byTable,
    liabilities,
  };
}
export function fileGstr1(state, { declaration, signatoryId }) {
  const data = editableGstr1(state);
  if (declaration !== true) throw new Error("Accept the GSTR-1 declaration.");
  const signatory = state.taxpayer.signatories.find(
    (s) => s.id === signatoryId,
  );
  if (!signatory) throw new Error("Select an authorised signatory.");
  const transactional = data.gstr1.records.filter(
    (r) => !["hsn", "documents", "ecommerce"].includes(r.tableId),
  );
  if (
    transactional.length &&
    !data.gstr1.records.some((r) => r.tableId === "hsn")
  )
    throw new Error(
      "Add the HSN-wise summary before filing a return with supplies.",
    );
  if (
    transactional.length &&
    !data.gstr1.records.some((r) => r.tableId === "documents")
  )
    throw new Error(
      "Complete Table 13, Documents Issued, before filing a return with supplies.",
    );
  const totals = gstr1Totals(state);
  const next = edit(
    state,
    "gstr1-filed",
    "GSTR-1 filed in the practice workspace.",
  );
  const target = next.periods[next.selectedPeriod];
  target.gstr1.status = "filed";
  target.gstr1.receipt = {
    reference: uid("PRACTICE-GSTR1"),
    gstin: state.taxpayer.gstin,
    period: state.selectedPeriod,
    filedAt: next.updatedAt,
    signatory: copy(signatory),
    totals,
    disclaimer: "Practice only; no government filing.",
  };
  return next;
}

function actionable(record) {
  return !record.rcm && !record.reverseCharge && record.eligible !== false;
}
function normalizeImsOption(record, action, options, period) {
  if (!ACTIONS.includes(action))
    throw new Error("Select Accept, Reject, Pending or No Action.");
  if (!actionable(record))
    throw new Error(
      "Reverse-charge and ineligible documents bypass IMS actions.",
    );
  if (
    action === "pending" &&
    record.documentType === "credit-note" &&
    period < "2025-10"
  )
    throw new Error(
      "Pending action on credit notes is available from October 2025.",
    );
  const result = { ...record, action };
  if (Object.hasOwn(options, "remarks")) {
    if (typeof options.remarks !== "string" || options.remarks.length > 500)
      throw new Error("Remarks must contain at most 500 characters.");
    result.remarks = options.remarks;
  }
  if (Object.hasOwn(options, "itcReduction")) {
    if (record.documentType !== "credit-note")
      throw new Error("Declared ITC reduction applies only to credit notes.");
    const reduction = heads(options.itcReduction);
    for (const h of HEADS)
      if (reduction[h] > (record[h] || 0))
        throw new Error(
          "ITC reduction cannot exceed the credit-note tax for that head.",
        );
    result.itcReduction = reduction;
  }
  return result;
}
export function setImsAction(state, id, action, options = {}) {
  return setImsActions(state, [id], action, options);
}
export function setImsActions(state, ids, action, options = {}) {
  const data = getPeriod(state);
  unlocked(data);
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
    throw new Error("Select one or more distinct IMS documents.");
  const replacements = new Map(
    ids.map((id) => {
      const record = data.ims.records.find((r) => r.id === id);
      if (!record) throw new Error("IMS document not found.");
      return [
        id,
        normalizeImsOption(record, action, options, state.selectedPeriod),
      ];
    }),
  );
  if (
    [...replacements].every(
      ([id, record]) =>
        JSON.stringify(record) ===
        JSON.stringify(data.ims.records.find((r) => r.id === id)),
    )
  )
    return state;
  const next = edit(
    state,
    "ims-action-saved",
    `${action} applied to ${ids.length} document(s).`,
  );
  const target = next.periods[next.selectedPeriod];
  target.ims.records = target.ims.records.map(
    (r) => replacements.get(r.id) || r,
  );
  target.ims.version++;
  return next;
}
function imsTax(record, { creditReduction = true } = {}) {
  const negative = record.documentType === "credit-note",
    values =
      negative && record.itcReduction && creditReduction
        ? record.itcReduction
        : record;
  const sign = negative ? -1 : 1;
  const result = {
    taxable: record.taxable * sign,
    ...Object.fromEntries(HEADS.map((h) => [h, (values[h] || 0) * sign])),
  };
  result.totalTax = total(HEADS.map((h) => result[h]));
  return result;
}
export function computeGstr2b(state) {
  const data = getPeriod(state);
  const records = data.ims.records
      .filter((r) => r.supplierFiled !== false)
      .map(copy),
    unfiledRecords = data.ims.records
      .filter((r) => r.supplierFiled === false)
      .map(copy);
  const eligibleRecords = [],
    excludedRecords = [],
    rcmRecords = [],
    ineligibleRecords = [],
    counts = Object.fromEntries(ACTIONS.map((a) => [a, 0]));
  let summary = zeroSummary(),
    eligibleSummary = zeroSummary(),
    excludedSummary = zeroSummary(),
    rcmSummary = zeroSummary(),
    ineligibleSummary = zeroSummary();
  const categories = {};
  for (const record of records) {
    counts[record.action]++;
    const tax = imsTax(record);
    summary = addSummary(summary, tax);
    const category = record.category || "B2B";
    categories[category] = addSummary(
      categories[category] || zeroSummary(),
      tax,
    );
    if (record.rcm || record.reverseCharge) {
      rcmRecords.push(record);
      rcmSummary = addSummary(rcmSummary, tax);
      excludedRecords.push(record);
      excludedSummary = addSummary(excludedSummary, tax);
      continue;
    }
    if (record.eligible === false) {
      ineligibleRecords.push(record);
      ineligibleSummary = addSummary(ineligibleSummary, tax);
      excludedRecords.push(record);
      excludedSummary = addSummary(excludedSummary, tax);
      continue;
    }
    if (["accepted", "no-action"].includes(record.action)) {
      eligibleRecords.push(record);
      eligibleSummary = addSummary(eligibleSummary, tax);
    } else {
      excludedRecords.push(record);
      excludedSummary = addSummary(excludedSummary, tax);
    }
  }
  const itc = Object.fromEntries(HEADS.map((h) => [h, eligibleSummary[h]]));
  const nextMonth = new Date(`${state.selectedPeriod}-01T12:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  nextMonth.setUTCDate(14);
  const expectedGenerationDate = nextMonth.toISOString().slice(0, 10);
  return {
    records,
    allRecords: records,
    eligibleRecords,
    excludedRecords,
    unfiledRecords,
    rcmRecords,
    ineligibleRecords,
    itc,
    summary,
    eligibleSummary,
    excludedSummary,
    rcmSummary,
    ineligibleSummary,
    counts,
    categories,
    sourceVersion: data.ims.version,
    generatedAt: null,
    expectedGenerationDate,
    acceleratedPractice:
      new Date().toISOString().slice(0, 10) < expectedGenerationDate,
    creditNoteExcess: Object.fromEntries(
      HEADS.map((h) => [h, Math.max(0, -eligibleSummary[h])]),
    ),
  };
}
export function generateGstr2b(state) {
  const data = getPeriod(state);
  unlocked(data);
  const snapshot = computeGstr2b(state);
  const next = edit(
    state,
    "gstr2b-generated",
    "GSTR-2B snapshot generated/recomputed for training.",
  );
  next.periods[next.selectedPeriod].gstr2b = {
    ...snapshot,
    generatedAt: next.updatedAt,
  };
  return next;
}
export function savePartAAdjustments(state, adjustments) {
  const data = getPeriod(state);
  unlocked(data);
  const normalized = Object.fromEntries(
    ["rcm", "interest", "lateFee", "itcReversal"].map((key) => [
      key,
      heads(adjustments[key] || {}),
    ]),
  );
  const next = edit(
    state,
    "gstr3b-part-a-saved",
    "Prepared return adjustments saved.",
  );
  next.periods[next.selectedPeriod].adjustments = normalized;
  return next;
}
export function preparePartA(state) {
  const data = getPeriod(state);
  if (data.gstr1.status !== "filed")
    throw new Error(
      "File GSTR-1 before preparing GSTR-3B in this practice workflow.",
    );
  if (!data.gstr2b)
    throw new Error("Generate GSTR-2B before preparing GSTR-3B.");
  if (data.gstr2b.sourceVersion !== data.ims.version)
    throw new Error(
      "IMS has changed. Recompute GSTR-2B before continuing to GSTR-3B.",
    );
  const canonical = computeGstr2b(state);
  for (const key of [
    "records",
    "itc",
    "eligibleSummary",
    "excludedSummary",
    "rcmSummary",
    "ineligibleSummary",
  ])
    if (JSON.stringify(canonical[key]) !== JSON.stringify(data.gstr2b[key]))
      throw new StorageError(
        "The saved GSTR-2B snapshot does not match its source documents. Recompute GSTR-2B before preparing payment.",
      );
  if (HEADS.some((h) => (data.gstr2b.itc[h] || 0) < 0))
    throw new Error(
      "Accepted credit-note reductions exceed this period’s eligible ITC. Review the declared ITC reduction and prior-credit reversal before preparing payment.",
    );
  const sales = gstr1Totals(state),
    adjust = data.adjustments,
    rcmFrom2b = data.gstr2b.rcmSummary || emptyHeads();
  const itc = Object.fromEntries(
    HEADS.map((h) => {
      const value = (data.gstr2b.itc[h] || 0) - (adjust.itcReversal?.[h] || 0);
      if (value < 0)
        throw new Error("ITC reversal exceeds available GSTR-2B ITC.");
      return [h, value];
    }),
  );
  return {
    legalName: state.taxpayer.legalName,
    liabilities: {
      A: copy(sales.liabilities.A),
      B: addHeads(sales.liabilities.B, addHeads(adjust.rcm, rcmFrom2b)),
    },
    itc,
    interest: copy(adjust.interest),
    lateFee: copy(adjust.lateFee),
    signatories: copy(state.taxpayer.signatories),
  };
}
export function lockPreparedReturn(state, paymentWorkspace) {
  const data = getPeriod(state);
  if (
    !paymentWorkspace ||
    paymentWorkspace.gstin !== state.taxpayer.gstin ||
    paymentWorkspace.period !== state.selectedPeriod ||
    !["offset", "filed"].includes(paymentWorkspace.status)
  )
    throw new Error(
      "The posted payment must match the selected taxpayer and return period.",
    );
  if (
    data.paymentLock?.workspaceId === paymentWorkspace.id &&
    data.paymentLock.status === paymentWorkspace.status
  )
    return state;
  if (data.paymentLock && data.paymentLock.workspaceId !== paymentWorkspace.id)
    throw new Error(
      "A different payment workspace is already posted for this period.",
    );
  const calculated = calculatePayment(getPaymentInputs(paymentWorkspace));
  if (
    calculated.errors.length ||
    calculated.totals.shortfall ||
    JSON.stringify(calculated) !==
      JSON.stringify(paymentWorkspace.offset.snapshot)
  )
    throw new Error("The payment calculation is invalid or unfunded.");
  const expected = preparePartA(state);
  for (const key of ["liabilities", "itc", "interest", "lateFee"])
    if (
      JSON.stringify(expected[key]) !==
      JSON.stringify(paymentWorkspace.partA[key])
    )
      throw new Error(
        "The posted payment does not match the current prepared return.",
      );
  const next = edit(
    state,
    "gstr3b-payment-locked",
    "The posted payment locks the source returns.",
  );
  next.periods[next.selectedPeriod].paymentLock = {
    workspaceId: paymentWorkspace.id,
    status: paymentWorkspace.status,
    at: timestamp(),
    snapshot: copy(calculated),
  };
  return next;
}
export function recordGstr3bFiling(state, receipt, balances) {
  const period = receipt?.period;
  validPeriod(period);
  if (
    receipt?.gstin !== state.taxpayer.gstin ||
    !receipt.reference?.startsWith("PRACTICE-ARN-")
  )
    throw new Error("The practice receipt must match the taxpayer.");
  const data = getPeriod(state, period);
  if (data.filing?.reference === receipt.reference) return state;
  if (data.filing) throw new Error("This return period is already filed.");
  if (
    !data.paymentLock?.snapshot ||
    JSON.stringify(data.paymentLock.snapshot) !==
      JSON.stringify(receipt.payment)
  )
    throw new Error(
      "Post and reconcile this return’s payment before recording its filing.",
    );
  const normalized = {
    credit: heads(balances.credit),
    cash: Object.fromEntries(
      ["tax", "interest", "lateFee"].map((m) => [m, heads(balances.cash?.[m])]),
    ),
    negative: Object.fromEntries(
      ["A", "B"].map((g) => [g, heads(balances.negative?.[g])]),
    ),
  };
  const expectedClosing = {
    credit: data.paymentLock.snapshot.creditClosing,
    cash: data.paymentLock.snapshot.cashClosing,
    negative: data.paymentLock.snapshot.negativeClosing,
  };
  if (JSON.stringify(normalized) !== JSON.stringify(expectedClosing))
    throw new Error("Closing ledgers do not match the posted payment.");
  const next = edit(
    state,
    "gstr3b-filed",
    "Filed practice return reconciled to the return dashboard.",
  );
  const target = next.periods[period];
  target.filing = copy(receipt);
  target.closing = normalized;
  target.paymentLock = {
    ...(target.paymentLock || {}),
    status: "filed",
    at: receipt.filedAt,
  };
  return next;
}
export function getOpeningLedgers(state, period = state.selectedPeriod) {
  validPeriod(period);
  assertPortal(state);
  const previous = Object.entries(state.periods)
    .filter(([p, d]) => p < period && d.filing && d.closing)
    .sort(([a], [b]) => b.localeCompare(a))[0];
  return previous ? copy(previous[1].closing) : copy(state.openingLedgers);
}

function seedPeriod(state) {
  const p = state.selectedPeriod,
    day = (n) => `${p}-${String(n).padStart(2, "0")}`;
  const sales = [
    {
      id: "SALE-001",
      tableId: "b2b",
      recipientGstin: "27AAAPB0002B1Z4",
      recipientName: "Sample Beta Distributors",
      invoiceNo: "INV-001",
      date: day(4),
      pos: "27",
      taxable: 10000000,
      rate: 18,
      cess: 0,
      documentType: "invoice",
    },
    {
      id: "SALE-002",
      tableId: "b2b",
      recipientGstin: "24AAAPC0003C1Z3",
      recipientName: "Sample Gamma Retail",
      invoiceNo: "INV-002",
      date: day(8),
      pos: "24",
      taxable: 20000000,
      rate: 18,
      cess: 0,
      documentType: "invoice",
    },
    {
      id: "SALE-003",
      tableId: "b2cs",
      recipientGstin: "",
      recipientName: "Sample retail customers",
      invoiceNo: "RET-001",
      date: day(12),
      pos: "24",
      taxable: 6666667,
      rate: 18,
      cess: 0,
      documentType: "invoice",
    },
    {
      id: "SALE-004",
      tableId: "exports",
      recipientGstin: "",
      recipientName: "Sample Overseas Buyer",
      invoiceNo: "EXP-001",
      date: day(16),
      pos: "96",
      taxable: 2500000,
      rate: 18,
      cess: 0,
      documentType: "invoice",
      exportType: "without-payment",
    },
    {
      id: "HSN-001",
      tableId: "hsn",
      hsn: "8471",
      description: "Sample office equipment",
      uqc: "NOS",
      quantity: 20,
      hsnCategory: "B2B",
      taxable: 30000000,
      rate: 18,
      cess: 0,
      pos: "24",
      reportedTax: { igst: 1800000, cgst: 1800000, sgst: 1800000, cess: 0 },
    },
    {
      id: "HSN-002",
      tableId: "hsn",
      hsn: "8471",
      description: "Sample retail equipment",
      uqc: "NOS",
      quantity: 10,
      hsnCategory: "B2C",
      taxable: 6666667,
      rate: 18,
      cess: 0,
      pos: "24",
    },
    {
      id: "HSN-003",
      tableId: "hsn",
      hsn: "8471",
      description: "Sample export equipment",
      uqc: "NOS",
      quantity: 2,
      hsnCategory: "B2C",
      taxable: 2500000,
      rate: 18,
      cess: 0,
      pos: "96",
      subType: "export",
      exportType: "without-payment",
    },
    {
      id: "DOC-001",
      tableId: "documents",
      documentCategory: "Invoices for outward supply",
      serialFrom: "INV-001",
      serialTo: "INV-004",
      totalDocuments: 4,
      cancelledDocuments: 0,
    },
  ];
  const purchases = [
    {
      id: "IMS-001",
      supplierGstin: "27AAAPB0002B1Z4",
      supplierName: "Sample Beta Supplies",
      invoiceNo: "PUR-101",
      date: day(3),
      taxable: 15000000,
      igst: 2700000,
      cgst: 0,
      sgst: 0,
      cess: 0,
      action: "accepted",
      documentType: "invoice",
      eligible: true,
      supplierFiled: true,
      category: "B2B",
    },
    {
      id: "IMS-002",
      supplierGstin: "24AAAPC0003C1Z3",
      supplierName: "Sample Gamma Services",
      invoiceNo: "PUR-102",
      date: day(7),
      taxable: 20000000,
      igst: 0,
      cgst: 1800000,
      sgst: 1800000,
      cess: 0,
      action: "no-action",
      documentType: "invoice",
      eligible: true,
      supplierFiled: true,
      category: "B2B",
    },
    {
      id: "IMS-003",
      supplierGstin: "24AAAPC0003C1Z3",
      supplierName: "Sample Gamma Services",
      invoiceNo: "CN-011",
      date: day(10),
      taxable: 1000000,
      igst: 0,
      cgst: 90000,
      sgst: 90000,
      cess: 0,
      action: "accepted",
      documentType: "credit-note",
      eligible: true,
      supplierFiled: true,
      category: "CDNR",
    },
    {
      id: "IMS-004",
      supplierGstin: "29AAAPB0002B1Z4",
      supplierName: "Sample Delta Components",
      invoiceNo: "PUR-103",
      date: day(14),
      taxable: 1000000,
      igst: 180000,
      cgst: 0,
      sgst: 0,
      cess: 0,
      action: "pending",
      documentType: "invoice",
      eligible: true,
      supplierFiled: true,
      category: "B2B",
    },
    {
      id: "IMS-005",
      supplierGstin: "27AAAPC0003C1Z3",
      supplierName: "Sample Echo Traders",
      invoiceNo: "PUR-104",
      date: day(17),
      taxable: 2000000,
      igst: 360000,
      cgst: 0,
      sgst: 0,
      cess: 0,
      action: "rejected",
      documentType: "invoice",
      eligible: true,
      supplierFiled: true,
      category: "B2B",
    },
    {
      id: "IMS-006",
      supplierGstin: "24AAAPB0002B1Z4",
      supplierName: "Sample Zeta Vendor",
      invoiceNo: "DRAFT-01",
      date: day(20),
      taxable: 500000,
      igst: 0,
      cgst: 45000,
      sgst: 45000,
      cess: 0,
      action: "no-action",
      documentType: "invoice",
      eligible: true,
      supplierFiled: false,
      category: "B2B",
    },
    {
      id: "IMS-007",
      supplierGstin: "24AAAPC0003C1Z3",
      supplierName: "Sample Club Services",
      invoiceNo: "INEL-01",
      date: day(21),
      taxable: 100000,
      igst: 0,
      cgst: 9000,
      sgst: 9000,
      cess: 0,
      action: "no-action",
      documentType: "invoice",
      eligible: false,
      supplierFiled: true,
      category: "B2B",
      ineligibleReason: "Blocked credit — training example",
    },
  ];
  const target = state.periods[p];
  target.gstr1.records = sales.map((r) => normalizeSale(state, r));
  target.ims.records = purchases;
  target.adjustments = {
    rcm: copy(SAMPLE_PART_A.liabilities.B),
    interest: copy(SAMPLE_PART_A.interest),
    lateFee: copy(SAMPLE_PART_A.lateFee),
    itcReversal: emptyHeads(),
  };
}
export function createPortal({ period = "2026-09", seed = true } = {}) {
  validPeriod(period);
  const now = timestamp();
  const state = {
    schemaVersion: PORTAL_SCHEMA_VERSION,
    id: uid("PORTAL"),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    taxpayer: {
      gstin: SAMPLE_GSTIN,
      legalName: "SAMPLE ALPHA TRADERS",
      tradeName: "Sample Alpha Traders",
      stateCode: "24",
      signatories: copy(SAMPLE_PART_A.signatories),
    },
    selectedPeriod: period,
    periods: { [period]: emptyPeriod() },
    openingLedgers: copy(SAMPLE_OPENING),
    audit: [
      {
        id: uid("AUDIT"),
        at: now,
        period,
        action: "portal-created",
        details: "Fictional GST training workspace initialized.",
      },
    ],
  };
  if (seed) seedPeriod(state);
  return state;
}
function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    throw new StorageError(
      "Browser storage is blocked. Enable local storage before continuing.",
    );
  }
}
function getStorage(storage) {
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function"
  )
    throw new StorageError(
      "Browser storage is unavailable. Enable local storage before continuing.",
    );
  return storage;
}
function parsePortal(raw) {
  try {
    const state = JSON.parse(raw);
    assertPortal(state);
    return state;
  } catch (error) {
    throw new StorageError(
      `Saved portal data is damaged or incompatible. It has not been reset. ${error.message}`,
    );
  }
}
export function loadPortal(storage = defaultStorage()) {
  getStorage(storage);
  let raw;
  try {
    raw = storage.getItem(PORTAL_KEY);
  } catch {
    throw new StorageError("Unable to read saved portal data.");
  }
  return raw === null ? null : parsePortal(raw);
}
export function savePortal(state, storage = defaultStorage()) {
  assertPortal(state);
  getStorage(storage);
  let raw;
  try {
    raw = storage.getItem(PORTAL_KEY);
  } catch {
    throw new StorageError("Unable to read browser storage before saving.");
  }
  const serialized = JSON.stringify(state);
  if (raw !== null) {
    const saved = parsePortal(raw);
    if (saved.id !== state.id)
      throw new ConflictError(
        "A different portal workspace is saved. Reload before continuing.",
      );
    if (saved.revision === state.revision && raw === serialized) return state;
    if (saved.revision !== state.revision - 1)
      throw new ConflictError(
        "Portal data changed in another tab. Reload before continuing.",
      );
  } else if (state.revision !== 0)
    throw new ConflictError(
      "The saved portal workspace is missing. Save the initial workspace before making changes.",
    );
  try {
    storage.setItem(PORTAL_KEY, serialized);
  } catch {
    throw new StorageError(
      "Unable to save portal data. The action was not committed. Free browser storage or enable local storage and retry.",
    );
  }
  return state;
}
