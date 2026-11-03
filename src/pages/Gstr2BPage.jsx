import React, { useState } from "react";
import { HEADS, formatMoney } from "../gst/paymentEngine.js";
import { getPeriod, generateGstr2b } from "../gst/portalStore.js";
import {
  InwardDialog,
  InwardDocumentDetails,
  displayDate,
  downloadInwardCsv,
  saveDownload,
  statusForRecord,
} from "./IMSPage.jsx";
import "./inward.css";

const money = (value) => formatMoney(value || 0);
const SHORT = {
  igst: "Integrated Tax",
  cgst: "Central Tax",
  sgst: "State / UT Tax",
  cess: "Cess",
};
const CATEGORY_LABELS = {
  B2B: "B2B · Registered supplier invoices",
  CDNR: "CDNR · Credit / debit notes",
  ISD: "ISD · Input service distributor",
  IMPG: "IMPG · Import of goods",
  IMPGSEZ: "IMPGSEZ · Import from SEZ",
};
const unique = (records) => [
  ...new Map(records.map((record) => [record.id, record])).values(),
];
const TAB_LABELS = {
  all: "All documents",
  available: "ITC available",
  unavailable: "ITC not available",
  rejected: "Rejected",
  pending: "Pending",
  rcm: "Reverse charge",
};

export default function Gstr2BPage({ state, onChange, onNavigate }) {
  const period = getPeriod(state);
  const snapshot = period.gstr2b;
  const locked = Boolean(period.paymentLock || period.filing);
  const stale = Boolean(
    snapshot && snapshot.sourceVersion !== period.ims.version,
  );
  const [tab, setTab] = useState("available"),
    [category, setCategory] = useState("all"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [detailId, setDetailId] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const records = snapshot
    ? unique([
        ...(snapshot.allRecords || snapshot.records || []),
        ...(snapshot.eligibleRecords || []),
        ...(snapshot.excludedRecords || []),
      ])
    : [];
  const availableIds = new Set(
    (snapshot?.eligibleRecords || []).map((record) => record.id),
  );
  const matchesTab = (record, value) => {
    if (value === "all") return true;
    if (value === "available") return availableIds.has(record.id);
    if (value === "rejected") return record.action === "rejected";
    if (value === "pending") return record.action === "pending";
    if (value === "rcm")
      return record.rcm === true || record.reverseCharge === true;
    return record.eligible === false;
  };
  const counts = Object.fromEntries(
    Object.keys(TAB_LABELS).map((value) => [
      value,
      records.filter((record) => matchesTab(record, value)).length,
    ]),
  );
  const filtered = records.filter(
    (record) =>
      matchesTab(record, tab) &&
      (category === "all" || (record.category || "B2B") === category) &&
      [record.supplierGstin, record.supplierName, record.invoiceNo]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const detail = records.find((record) => record.id === detailId);
  const regenerate = () => {
    setError("");
    setMessage("");
    try {
      const next = generateGstr2b(state);
      if (onChange(next) === false) {
        setError(
          "The statement could not be saved. Check browser storage and try again.",
        );
        return;
      }
      setMessage(
        "Practice GSTR-2B generated from the saved supplier documents and IMS actions.",
      );
    } catch (exception) {
      setError(exception.message);
    }
  };
  const switchTab = (value) => {
    setTab(value);
    setPage(1);
  };
  const itc =
    snapshot?.itc || Object.fromEntries(HEADS.map((head) => [head, 0]));
  const generatedAt = snapshot?.generatedAt
    ? new Date(snapshot.generatedAt).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
  const unfiledCount =
    snapshot?.unfiledRecords?.length ||
    period.ims.records.filter((record) => record.supplierFiled === false)
      .length;
  const categories = snapshot?.categories || {};
  const negativeNetCredit = Boolean(
    snapshot && HEADS.some((head) => (snapshot.itc?.[head] || 0) < 0),
  );
  const canContinue = Boolean(
    snapshot && !stale && !negativeNetCredit && period.gstr1.status === "filed",
  );
  return (
    <div className="inward-page">
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="alert success" role="status">
          {message}
        </div>
      )}
      {stale && (
        <div className="alert error" role="alert">
          IMS actions changed after this statement was generated. Recompute
          GSTR-2B before preparing GSTR-3B. The saved statement below has been
          retained.
        </div>
      )}
      <div className="notice">
        GSTR-2B is a read-only statement. Eligible supplier-filed documents
        accepted in IMS, including no-action documents deemed accepted,
        determine available ITC. Rejected, pending and ineligible documents are
        presented separately for reconciliation.
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>GSTR-2B · Auto-drafted ITC Statement</h3>
            <p>
              Return period {state.selectedPeriod} · {state.taxpayer.gstin}
            </p>
          </div>
          <div className="inward-actions">
            {snapshot && (
              <>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() =>
                    saveDownload(
                      `PRACTICE-GSTR2B-${state.selectedPeriod}.json`,
                      {
                        label:
                          "PRACTICE ONLY — not an official GSTR-2B statement",
                        gstin: state.taxpayer.gstin,
                        period: state.selectedPeriod,
                        ...snapshot,
                      },
                    )
                  }
                >
                  Download JSON
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() =>
                    downloadInwardCsv(
                      `PRACTICE-GSTR2B-${state.selectedPeriod}.csv`,
                      records,
                    )
                  }
                >
                  Download CSV
                </button>
              </>
            )}
            <button
              type="button"
              className="primary small"
              disabled={locked}
              onClick={regenerate}
            >
              {snapshot ? "Recompute GSTR-2B" : "Generate GSTR-2B"}
            </button>
          </div>
        </div>
        {snapshot ? (
          <div className="inward-panel-note">
            <div className="inward-snapshot-stamp">
              <span
                className={"inward-status " + (stale ? "stale" : "current")}
              >
                {stale
                  ? "Recomputation required"
                  : "Generated · current IMS version"}
              </span>
              <span>Generated {generatedAt} IST</span>
              {snapshot.acceleratedPractice !== false && (
                <span className="inward-status pending">
                  Accelerated practice generation
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="inward-empty">
            <h3>Your practice statement is ready to generate</h3>
            <p>
              Review supplier documents in IMS, then generate the saved
              statement used to prepare Table 4 of GSTR-3B. Generation before
              the normal statutory date is accelerated for training.
            </p>
            <div
              className="inward-actions"
              style={{ justifyContent: "center" }}
            >
              <button
                type="button"
                className="secondary"
                onClick={() => onNavigate("ims")}
              >
                Review IMS
              </button>
              <button
                type="button"
                className="primary"
                disabled={locked}
                onClick={regenerate}
              >
                Generate Practice Statement
              </button>
            </div>
          </div>
        )}
      </section>
      {snapshot && (
        <>
          {negativeNetCredit && (
            <div className="alert error" role="alert">
              Credit-note reductions exceed eligible ITC in one or more tax
              heads. Review the credit-note reduction amounts in IMS before
              preparing GSTR-3B.
            </div>
          )}
          <section
            className="inward-amount-summary"
            aria-label="Available ITC by tax head"
          >
            {HEADS.map((head) => (
              <div key={head}>
                <span>{SHORT[head]}</span>
                <strong>
                  <small>₹</small>
                  {money(itc[head])}
                </strong>
              </div>
            ))}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Supplier Documents by Category</h3>
                <p>
                  All supplier-filed documents, including those excluded from
                  available ITC. Credit notes reduce the category totals.
                </p>
              </div>
              <span className="rupee-note">All amounts in ₹</span>
            </div>
            <div className="table-scroll">
              <table className="inward-category-table">
                <thead>
                  <tr>
                    <th>Document category</th>
                    <th>Documents</th>
                    <th>Taxable value</th>
                    {HEADS.map((head) => (
                      <th key={head}>
                        {head === "sgst" ? "SGST / UTGST" : head.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(CATEGORY_LABELS).map(([id, label]) => {
                    const summary = categories[id];
                    return (
                      <tr key={id}>
                        <th>{label}</th>
                        <td>{summary?.recordCount || 0}</td>
                        {["taxable", ...HEADS].map((head) => (
                          <td key={head}>{money(summary?.[head])}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="inward-panel-note">
              The category summary follows the saved statement. Available ITC
              totals above reflect eligibility, IMS actions and credit-note
              reductions. Reverse charge is assessed separately before payment.
            </p>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Document Details & Reconciliation</h3>
                <p>
                  {records.length} supplier-filed documents · Select a document
                  number to view its details
                </p>
              </div>
              <span className="rupee-note">Read only</span>
            </div>
            <div
              className="inward-tabs"
              role="tablist"
              aria-label="GSTR-2B reconciliation category"
            >
              {Object.entries(TAB_LABELS).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  role="tab"
                  aria-selected={tab === value}
                  className={tab === value ? "active" : ""}
                  onClick={() => switchTab(value)}
                >
                  {label} <span>{counts[value]}</span>
                </button>
              ))}
            </div>
            <div className="inward-toolbar">
              <label className="inward-search">
                Search statement documents
                <input
                  type="search"
                  aria-label="Search GSTR-2B documents"
                  placeholder="GSTIN, supplier or document number"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label>
                Document category
                <select
                  aria-label="Filter GSTR-2B document category"
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All categories</option>
                  {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="table-scroll">
              <table className="inward-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Supplier details</th>
                    <th>Document number / date</th>
                    <th>Taxable value (₹)</th>
                    <th>IGST (₹)</th>
                    <th>CGST (₹)</th>
                    <th>SGST / UTGST (₹)</th>
                    <th>Cess (₹)</th>
                    <th>Statement status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((record) => {
                    const status = statusForRecord(record);
                    return (
                      <tr key={record.id}>
                        <td>{record.category || "B2B"}</td>
                        <td>
                          <span className="supplier-name">
                            {record.supplierName}
                          </span>
                          <span className="supplier-gstin">
                            {record.supplierGstin}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="invoice-link"
                            onClick={() => setDetailId(record.id)}
                          >
                            {record.invoiceNo}
                          </button>
                          <span className="invoice-date">
                            {displayDate(record.date)}
                          </span>
                          {record.documentType === "credit-note" && (
                            <span className="credit-note">CREDIT NOTE</span>
                          )}
                        </td>
                        {[
                          record.taxable,
                          ...HEADS.map((head) => record[head]),
                        ].map((amount, index) => (
                          <td key={index}>{money(amount)}</td>
                        ))}
                        <td>
                          <span className={"inward-status " + status.className}>
                            {availableIds.has(record.id) &&
                            record.action === "no-action"
                              ? "Deemed accepted"
                              : status.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visible.length && (
                <div className="inward-empty">
                  <h3>No documents in this view</h3>
                  <p>
                    Select another category or change the search to view
                    statement records.
                  </p>
                </div>
              )}
            </div>
            <div className="inward-pagination">
              <span>
                {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–
                {Math.min(currentPage * pageSize, filtered.length)} of{" "}
                {filtered.length} documents
              </span>
              <div>
                <button
                  type="button"
                  className="secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {currentPage} of {pages}
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={currentPage >= pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
            <p className="inward-panel-note">
              {unfiledCount
                ? `${unfiledCount} supplier-saved document${unfiledCount === 1 ? " is" : "s are"} not yet filed and excluded from this statement. `
                : ""}
              Change acceptance, rejection or pending status in IMS, then
              recompute. This statement cannot be edited directly.
            </p>
          </section>
          <div className="inward-bottom-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => onNavigate("ims")}
            >
              ← Back to IMS
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canContinue}
              onClick={() => onNavigate("gstr3b")}
            >
              {period.filing ? "View GSTR-3B" : "Prepare GSTR-3B"} →
            </button>
          </div>
          {!canContinue && !locked && (
            <p className="inward-financial-note">
              {stale
                ? "Recompute GSTR-2B after the latest IMS actions to continue."
                : period.gstr1.status !== "filed"
                  ? "File the practice GSTR-1 before preparing GSTR-3B."
                  : negativeNetCredit
                    ? "Review credit-note ITC reductions in IMS before continuing."
                    : "Generate the statement to continue."}
            </p>
          )}
        </>
      )}
      {detail && (
        <InwardDialog
          title="GSTR-2B Document Details"
          onClose={() => setDetailId(null)}
        >
          <InwardDocumentDetails
            key={detail.id}
            record={detail}
            onClose={() => setDetailId(null)}
          />
        </InwardDialog>
      )}
    </div>
  );
}
