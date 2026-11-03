import React, { useEffect, useId, useRef, useState } from "react";
import { HEADS, formatMoney, toPaise } from "../gst/paymentEngine.js";
import {
  getPeriod,
  setImsAction,
  setImsActions,
  generateGstr2b,
} from "../gst/portalStore.js";
import "./inward.css";

export const ACTION_LABELS = {
  accepted: "Accepted",
  rejected: "Rejected",
  pending: "Pending",
  "no-action": "No action",
};
export const TAX_LABELS = {
  igst: "Integrated Tax",
  cgst: "Central Tax",
  sgst: "State / UT Tax",
  cess: "Cess",
};
const money = (value) => formatMoney(value || 0);
export const displayDate = (value) =>
  value
    ? new Date(
        value.length === 10 ? value + "T12:00:00Z" : value,
      ).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      })
    : "—";
export const recordIsLocked = (record) =>
  record.eligible === false ||
  record.rcm === true ||
  record.reverseCharge === true;
export function statusForRecord(record) {
  if (record.supplierFiled === false)
    return { label: "Supplier not filed", className: "pending" };
  if (record.rcm || record.reverseCharge)
    return { label: "Reverse charge", className: "pending" };
  if (record.eligible === false)
    return { label: "ITC not available", className: "rejected" };
  return {
    label: ACTION_LABELS[record.action || "no-action"],
    className: record.action || "no-action",
  };
}
export function saveDownload(name, rowsOrData, type = "application/json") {
  const blob = new Blob(
    [
      typeof rowsOrData === "string"
        ? rowsOrData
        : JSON.stringify(rowsOrData, null, 2),
    ],
    { type },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadInwardCsv(name, records) {
  const cell = (value) => {
    const text = String(value ?? "");
    const guarded =
      /^[=+@]/.test(text) || /^-\D/.test(text) ? "'" + text : text;
    return '"' + guarded.replaceAll('"', '""') + '"';
  };
  const columns = [
    "Supplier GSTIN",
    "Supplier name",
    "Document number",
    "Document date",
    "Document type",
    "Category",
    "Taxable value (INR)",
    "IGST (INR)",
    "CGST (INR)",
    "SGST / UTGST (INR)",
    "Cess (INR)",
    "IMS action",
    "Supplier filed",
    "ITC eligible",
    "Reverse charge",
    "Statement status",
    ...HEADS.map(
      (head) => `${head.toUpperCase()} declared credit-note reduction (INR)`,
    ),
    "Recipient remarks",
  ];
  const rows = records.map((record) => [
    record.supplierGstin,
    record.supplierName,
    record.invoiceNo,
    record.date,
    record.documentType,
    record.category || "B2B",
    money(record.taxable).replaceAll(",", ""),
    ...HEADS.map((head) => money(record[head]).replaceAll(",", "")),
    ACTION_LABELS[record.action || "no-action"],
    record.supplierFiled === false ? "No" : "Yes",
    record.eligible === false ? "No" : "Yes",
    record.rcm || record.reverseCharge ? "Yes" : "No",
    statusForRecord(record).label,
    ...HEADS.map((head) =>
      record.itcReduction
        ? money(record.itcReduction[head]).replaceAll(",", "")
        : "",
    ),
    record.remarks || "",
  ]);
  saveDownload(
    name,
    [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
}
export function InwardDialog({ title, children, onClose }) {
  const id = useId();
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = [
        ...ref.current.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ),
      ].filter((item) => item.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === focusable[0] ||
          document.activeElement === ref.current)
      ) {
        event.preventDefault();
        focusable.at(-1).focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === focusable.at(-1)
      ) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="inward-modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="inward-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        ref={ref}
        tabIndex={-1}
      >
        <div className="inward-modal-title">
          <h2 id={id}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document details"
          >
            ×
          </button>
        </div>
        <div className="inward-modal-body">{children}</div>
      </section>
    </div>
  );
}
export function InwardDocumentDetails({
  record,
  editable = false,
  onAction,
  onClose,
}) {
  const [action, setAction] = useState(record.action || "no-action");
  const [remarks, setRemarks] = useState(record.remarks || "");
  const [reduction, setReduction] = useState(() =>
    Object.fromEntries(
      HEADS.map((head) => [
        head,
        money(
          record.itcReduction?.[head] ?? Math.abs(record[head] || 0),
        ).replaceAll(",", ""),
      ]),
    ),
  );
  const [error, setError] = useState("");
  const cn = record.documentType === "credit-note";
  const apply = () => {
    try {
      const options = { remarks };
      if (cn && action === "accepted")
        options.itcReduction = Object.fromEntries(
          HEADS.map((head) => [head, toPaise(reduction[head])]),
        );
      if (onAction(action, options) !== false) onClose();
      else
        setError(
          "The action could not be saved. Check browser storage and try again.",
        );
    } catch (exception) {
      setError(exception.message);
    }
  };
  const status = statusForRecord(record);
  return (
    <div className="inward-detail">
      <div className="inward-detail-grid">
        {[
          ["Supplier", record.supplierName],
          ["GSTIN", record.supplierGstin],
          ["Document number", record.invoiceNo],
          ["Document date", displayDate(record.date)],
          ["Document type", cn ? "Credit note" : "Tax invoice"],
          ["Statement category", record.category || "B2B"],
          [
            "Supplier return",
            record.supplierFiled === false
              ? "Not filed — excluded from GSTR-2B"
              : "Filed",
          ],
          ["IMS status", status.label],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value || "—"}</strong>
          </div>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Taxable value</th>
              {HEADS.map((head) => (
                <th key={head}>{TAX_LABELS[head]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {[record.taxable, ...HEADS.map((head) => record[head])].map(
                (amount, index) => (
                  <td key={index}>{money(amount)}</td>
                ),
              )}
            </tr>
          </tbody>
        </table>
      </div>
      {record.eligible === false && (
        <div className="notice">
          ITC is not available for this document.{" "}
          {record.reason ||
            record.ineligibilityReason ||
            record.ineligibleReason ||
            "Review the eligibility or place-of-supply conditions."}{" "}
          This document bypasses IMS action.
        </div>
      )}
      {(record.rcm || record.reverseCharge) && (
        <div className="notice">
          Reverse-charge documents bypass IMS action and are presented
          separately in GSTR-2B. Their tax liability is carried to the cash-only
          section of GSTR-3B.
        </div>
      )}
      {cn && (
        <p className="inward-financial-note">
          Accepted credit notes reduce ITC. From October 2025, eligible credit
          notes can be kept pending. An explicit reduction may reflect the ITC
          previously availed.
        </p>
      )}
      {editable && !recordIsLocked(record) && (
        <>
          <div className="detail-actions">
            <label className="grow">
              Action
              <select
                aria-label="Document IMS action"
                value={action}
                onChange={(event) => setAction(event.target.value)}
              >
                {Object.entries(ACTION_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {["rejected", "pending"].includes(action) && (
            <label>
              Remarks
              <textarea
                aria-label="IMS action remarks"
                maxLength={500}
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="Optional reconciliation remarks"
              />
            </label>
          )}
          {cn && action === "accepted" && (
            <div>
              <p className="inward-financial-note">
                ITC amount to be reduced (₹). Each amount must not exceed the
                credit-note tax for that head.
              </p>
              <div className="inward-detail-grid">
                {HEADS.map((head) => (
                  <label key={head}>
                    {TAX_LABELS[head]}
                    <input
                      aria-label={`${TAX_LABELS[head]} credit-note ITC reduction in rupees`}
                      inputMode="decimal"
                      value={reduction[head]}
                      onChange={(event) =>
                        setReduction({
                          ...reduction,
                          [head]: event.target.value,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {!editable && record.remarks && (
        <div>
          <p className="inward-financial-note">Recipient remarks</p>
          <p>{record.remarks}</p>
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
        {editable && !recordIsLocked(record) && (
          <button type="button" className="primary" onClick={apply}>
            Save IMS Action
          </button>
        )}
      </div>
    </div>
  );
}

export default function IMSPage({ state, onChange, onNavigate }) {
  const period = getPeriod(state);
  const locked = Boolean(period.paymentLock || period.filing);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [kind, setKind] = useState("all"),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState([]),
    [bulkAction, setBulkAction] = useState("accepted"),
    [remarks, setRemarks] = useState(""),
    [detailId, setDetailId] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const records = period.ims.records;
  const active = period.filing
    ? records.filter(
        (record) =>
          record.action === "pending" ||
          record.supplierFiled === false ||
          recordIsLocked(record),
      )
    : records;
  const counts = Object.fromEntries(
    Object.keys(ACTION_LABELS).map((action) => [
      action,
      active.filter(
        (record) =>
          (record.action || "no-action") === action && !recordIsLocked(record),
      ).length,
    ]),
  );
  const stale = Boolean(
    period.gstr2b && period.gstr2b.sourceVersion !== period.ims.version,
  );
  const filtered = active.filter((record) => {
    const matchesStatus =
      filter === "all" ||
      (filter === "bypass"
        ? recordIsLocked(record)
        : (record.action || "no-action") === filter && !recordIsLocked(record));
    const matchesKind = kind === "all" || record.documentType === kind;
    const text = [record.supplierGstin, record.supplierName, record.invoiceNo]
      .join(" ")
      .toLowerCase();
    return (
      matchesStatus && matchesKind && text.includes(query.toLowerCase().trim())
    );
  });
  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const selectable = visible.filter((record) => !recordIsLocked(record));
  const allVisibleSelected =
    selectable.length > 0 &&
    selectable.every((record) => selected.includes(record.id));
  const detail = records.find((record) => record.id === detailId);
  const run = (action, text) => {
    setError("");
    setMessage("");
    try {
      const next = action();
      if (onChange(next) === false) {
        setError(
          "The action was not saved. Check browser storage and try again.",
        );
        return false;
      }
      setMessage(text);
      return true;
    } catch (exception) {
      setError(exception.message);
      return false;
    }
  };
  const selectVisible = () =>
    setSelected(
      allVisibleSelected
        ? selected.filter(
            (id) => !selectable.some((record) => record.id === id),
          )
        : [...new Set([...selected, ...selectable.map((record) => record.id)])],
    );
  const changeFilter = (setter, value) => {
    setter(value);
    setPage(1);
    setSelected([]);
  };
  const regenerate = () => {
    if (
      run(
        () => generateGstr2b(state),
        "Practice GSTR-2B has been recomputed using the saved IMS actions.",
      )
    )
      onNavigate("gstr2b");
  };
  return (
    <div className="inward-page">
      <div className="notice">
        Review inward documents uploaded by your suppliers. No action is treated
        as deemed acceptance when GSTR-2B is generated. Rejected and pending
        documents do not add to available ITC.
      </div>
      {locked && (
        <div className="notice">
          This period's payment or return is locked. IMS actions for this return
          are read only.
          {period.filing
            ? " Accepted and rejected documents have left the active IMS view; pending documents remain visible."
            : ""}
        </div>
      )}
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
      <section className="inward-stats" aria-label="IMS document counts">
        {Object.entries(ACTION_LABELS).map(([action, label]) => (
          <div className={"inward-stat " + action} key={action}>
            <span>{label}</span>
            <strong>{counts[action]}</strong>
            <small>
              {action === "accepted"
                ? "Considered for eligible ITC"
                : action === "no-action"
                  ? "Deemed accepted at generation"
                  : action === "pending"
                    ? "Retained for later reconciliation"
                    : "Excluded from available ITC"}
            </small>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Invoice Management System</h3>
            <p>
              Supplier invoices and credit notes · {state.selectedPeriod} ·{" "}
              {active.length} active documents
            </p>
          </div>
          <div className="inward-actions">
            <button
              type="button"
              className="secondary small"
              onClick={() =>
                downloadInwardCsv(
                  `PRACTICE-IMS-${state.selectedPeriod}.csv`,
                  filtered,
                )
              }
            >
              Download CSV
            </button>
            <button
              type="button"
              className="primary small"
              disabled={locked}
              onClick={regenerate}
            >
              {period.gstr2b ? "Recompute GSTR-2B" : "Generate GSTR-2B"}
            </button>
          </div>
        </div>
        <div className="inward-toolbar">
          <label className="inward-search">
            Search supplier or document
            <input
              aria-label="Search IMS documents"
              type="search"
              value={query}
              placeholder="GSTIN, supplier or invoice number"
              onChange={(event) => changeFilter(setQuery, event.target.value)}
            />
          </label>
          <label>
            Action status
            <select
              aria-label="Filter IMS action status"
              value={filter}
              onChange={(event) => changeFilter(setFilter, event.target.value)}
            >
              <option value="all">All documents</option>
              {Object.entries(ACTION_LABELS).map(([action, label]) => (
                <option value={action} key={action}>
                  {label}
                </option>
              ))}
              <option value="bypass">Bypasses IMS</option>
            </select>
          </label>
          <label>
            Document type
            <select
              aria-label="Filter IMS document type"
              value={kind}
              onChange={(event) => changeFilter(setKind, event.target.value)}
            >
              <option value="all">All types</option>
              <option value="invoice">Tax invoices</option>
              <option value="credit-note">Credit notes</option>
            </select>
          </label>
        </div>
        {selected.length > 0 && !locked && (
          <div className="inward-bulkbar">
            <strong>{selected.length} documents selected</strong>
            <select
              aria-label="Bulk IMS action"
              value={bulkAction}
              onChange={(event) => setBulkAction(event.target.value)}
            >
              {Object.entries(ACTION_LABELS).map(([action, label]) => (
                <option key={action} value={action}>
                  {label}
                </option>
              ))}
            </select>
            {["rejected", "pending"].includes(bulkAction) && (
              <input
                aria-label="Bulk IMS remarks"
                value={remarks}
                maxLength={500}
                placeholder="Optional remarks"
                onChange={(event) => setRemarks(event.target.value)}
              />
            )}
            <button
              type="button"
              className="primary small"
              onClick={() => {
                if (
                  run(
                    () =>
                      setImsActions(state, selected, bulkAction, { remarks }),
                    "IMS actions saved for the selected documents. Recompute GSTR-2B to update the statement.",
                  )
                )
                  setSelected([]);
              }}
            >
              Apply Action
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setSelected([])}
            >
              Clear selection
            </button>
          </div>
        )}
        <div className="table-scroll">
          <table className="inward-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all visible IMS documents"
                    disabled={locked || !selectable.length}
                    checked={allVisibleSelected}
                    onChange={selectVisible}
                  />
                </th>
                <th>Supplier details</th>
                <th>Document number / date</th>
                <th>Taxable value (₹)</th>
                <th>IGST (₹)</th>
                <th>CGST (₹)</th>
                <th>SGST / UTGST (₹)</th>
                <th>Cess (₹)</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((record) => (
                <tr key={record.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${record.invoiceNo}`}
                      disabled={locked || recordIsLocked(record)}
                      checked={selected.includes(record.id)}
                      onChange={() =>
                        setSelected(
                          selected.includes(record.id)
                            ? selected.filter((id) => id !== record.id)
                            : [...selected, record.id],
                        )
                      }
                    />
                  </td>
                  <td>
                    <span className="supplier-name">{record.supplierName}</span>
                    <span className="supplier-gstin">
                      {record.supplierGstin}
                    </span>
                    {record.supplierFiled === false && (
                      <span className="ineligible">Supplier not filed</span>
                    )}
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
                  {[record.taxable, ...HEADS.map((head) => record[head])].map(
                    (amount, index) => (
                      <td key={index}>{money(amount)}</td>
                    ),
                  )}
                  <td>
                    {recordIsLocked(record) ? (
                      <span
                        className={
                          "inward-status " + statusForRecord(record).className
                        }
                      >
                        {statusForRecord(record).label}
                      </span>
                    ) : (
                      <select
                        className="inward-action-select"
                        aria-label={`IMS action for ${record.invoiceNo}`}
                        disabled={locked}
                        value={record.action || "no-action"}
                        onChange={(event) =>
                          run(
                            () =>
                              setImsAction(
                                state,
                                record.id,
                                event.target.value,
                              ),
                            "IMS action saved. Recompute GSTR-2B before preparing GSTR-3B.",
                          )
                        }
                      >
                        {Object.entries(ACTION_LABELS).map(
                          ([action, label]) => (
                            <option key={action} value={action}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <div className="inward-empty">
              <h3>No matching documents</h3>
              <p>
                Change the search or filters to view other supplier documents.
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
              onClick={() => {
                setPage(currentPage - 1);
                setSelected([]);
              }}
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
              onClick={() => {
                setPage(currentPage + 1);
                setSelected([]);
              }}
            >
              Next
            </button>
          </div>
        </div>
        <p className="inward-panel-note">
          Supplier-saved documents can be reviewed in IMS, but enter GSTR-2B
          only after the supplier files. Reverse-charge and ineligible documents
          bypass IMS action. Credit notes are shown as reductions where
          applicable.
        </p>
      </section>
      <div className="inward-disclosure">
        <p>
          <strong>
            {stale
              ? "GSTR-2B needs recomputation."
              : period.gstr2b
                ? "GSTR-2B reflects the saved IMS actions."
                : "GSTR-2B has not been generated for this practice period."}
          </strong>
          <br />
          Generation before the statutory date is accelerated practice
          generation. This simulator does not contact GST systems.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() => onNavigate("gstr2b")}
        >
          View GSTR-2B →
        </button>
      </div>
      {detail && (
        <InwardDialog
          title="Inward Document Details"
          onClose={() => setDetailId(null)}
        >
          <InwardDocumentDetails
            key={detail.id}
            record={detail}
            editable={!locked}
            onClose={() => setDetailId(null)}
            onAction={(action, options) => {
              setError("");
              const next = setImsAction(state, detail.id, action, options);
              if (onChange(next) === false) return false;
              setMessage(
                "Document action saved. Recompute GSTR-2B to update the statement.",
              );
              return true;
            }}
          />
        </InwardDialog>
      )}
    </div>
  );
}
