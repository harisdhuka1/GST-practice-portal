import React, { useEffect, useId, useRef, useState } from "react";
import {
  TABLES,
  getPeriod,
  gstr1Totals,
  taxForRecord,
  upsertGstr1Record,
  deleteGstr1Record,
  fileGstr1,
} from "../gst/portalStore.js";
import { formatMoney, toPaise } from "../gst/paymentEngine.js";
import "./gstr1.css";

const HEADS = ["igst", "cgst", "sgst", "cess"];
const HEAD_LABELS = {
  igst: "IGST",
  cgst: "CGST",
  sgst: "SGST / UTGST",
  cess: "Cess",
};
const money = (n) => formatMoney(n || 0);
const decimal = (n) => formatMoney(n || 0).replaceAll(",", "");
const states = [
  ["01", "Jammu and Kashmir"],
  ["02", "Himachal Pradesh"],
  ["03", "Punjab"],
  ["04", "Chandigarh"],
  ["05", "Uttarakhand"],
  ["06", "Haryana"],
  ["07", "Delhi"],
  ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"],
  ["10", "Bihar"],
  ["11", "Sikkim"],
  ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"],
  ["14", "Manipur"],
  ["15", "Mizoram"],
  ["16", "Tripura"],
  ["17", "Meghalaya"],
  ["18", "Assam"],
  ["19", "West Bengal"],
  ["20", "Jharkhand"],
  ["21", "Odisha"],
  ["22", "Chhattisgarh"],
  ["23", "Madhya Pradesh"],
  ["24", "Gujarat"],
  ["26", "Dadra and Nagar Haveli and Daman and Diu"],
  ["27", "Maharashtra"],
  ["29", "Karnataka"],
  ["30", "Goa"],
  ["31", "Lakshadweep"],
  ["32", "Kerala"],
  ["33", "Tamil Nadu"],
  ["34", "Puducherry"],
  ["35", "Andaman and Nicobar Islands"],
  ["36", "Telangana"],
  ["37", "Andhra Pradesh"],
  ["38", "Ladakh"],
  ["97", "Other Territory"],
];
const docCategories = [
  "Invoices for outward supply",
  "Invoices for inward supply from unregistered persons",
  "Revised invoice",
  "Debit note",
  "Credit note",
  "Receipt voucher",
  "Payment voucher",
  "Refund voucher",
  "Delivery challan for job work",
  "Delivery challan for supply on approval",
  "Delivery challan in case of liquid gas",
  "Delivery challan in cases other than by way of supply",
];
const UQCS = ["NOS", "KGS", "MTR", "LTR", "PCS", "BOX", "OTH"];
function Symbol({ name = "document", size = 18 }) {
  const p = {
    document: (
      <>
        <path d="M14 2H5v20h14V7z" />
        <path d="M14 2v6h5M8 12h8M8 16h6" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    back: <path d="m15 5-7 7 7 7" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {p[name]}
    </svg>
  );
}
function downloadFile(name, data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Dialog({ title, children, onClose }) {
  const id = useId(),
    ref = useRef();
  useEffect(() => {
    const previous = document.activeElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current.focus();
    const key = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const all = [
          ...ref.current.querySelectorAll(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ),
        ].filter((x) => x.offsetParent !== null);
        if (!all.length) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === all[0] ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          all[all.length - 1].focus();
        } else if (
          !e.shiftKey &&
          document.activeElement === all[all.length - 1]
        ) {
          e.preventDefault();
          all[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal wide gstr1-dialog"
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <div className="modal-heading">
          <h2 id={id}>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <Symbol name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
function Field({ label, required, children, hint, full }) {
  return (
    <label className={"gstr1-field " + (full ? "full" : "")}>
      <span>
        {label}
        {required && <b> *</b>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function totalsForCard(state, table, records, totals) {
  if (table.id === "documents")
    return {
      taxable: records.reduce(
        (n, r) => n + (r.totalDocuments || 0) - (r.cancelledDocuments || 0),
        0,
      ),
      totalTax: 0,
    };
  if (table.id === "hsn")
    return {
      taxable: records.reduce((n, r) => n + (r.taxable || 0), 0),
      totalTax: 0,
    };
  return totals.byTable?.[table.id] || { taxable: 0, totalTax: 0 };
}
function recordTax(state, record) {
  try {
    return taxForRecord(state, record);
  } catch {
    return {
      taxable: record.taxable || 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
      totalTax: 0,
    };
  }
}
function newForm(state, table, initial) {
  const period = state.selectedPeriod;
  const existingTax = initial ? recordTax(state, initial) : {};
  return {
    id: initial?.id,
    tableId: table.id,
    recipientGstin: initial?.recipientGstin || "",
    recipientName: initial?.recipientName || "",
    invoiceNo: initial?.invoiceNo || "",
    date: initial?.date || period + "-10",
    pos:
      initial?.pos ||
      (table.id === "exports"
        ? "96"
        : state.taxpayer.stateCode || state.taxpayer.gstin.slice(0, 2)),
    taxable: decimal(initial?.taxable),
    rate: String(initial?.rate ?? 18),
    cess: decimal(initial?.cess),
    documentType:
      initial?.documentType ||
      (["cdnr", "cdnur", "amend-notes"].includes(table.id)
        ? "credit-note"
        : "invoice"),
    exportType: initial?.exportType || initial?.paymentType || "with-payment",
    subType:
      initial?.subType ||
      (table.id === "amend-invoices"
        ? "b2b"
        : table.id === "advances"
          ? "received"
          : table.id === "ecommerce"
            ? "14a"
            : ""),
    originalId: initial?.originalId || "",
    originalPeriod: initial?.originalPeriod || period,
    ecommerceGstin: initial?.ecommerceGstin || "",
    reverseCharge: initial?.reverseCharge || false,
    exemptionType: initial?.exemptionType || "nil-rated",
    hsn: initial?.hsn || "",
    description: initial?.description || "",
    uqc: initial?.uqc || "NOS",
    quantity: String(initial?.quantity ?? 1),
    hsnCategory: initial?.hsnCategory || "B2B",
    ...Object.fromEntries(
      HEADS.map((head) => [
        "reported-" + head,
        decimal(initial?.reportedTax?.[head] ?? existingTax[head] ?? 0),
      ]),
    ),
    documentCategory: initial?.documentCategory || docCategories[0],
    serialFrom: initial?.serialFrom || initial?.fromSerial || "",
    serialTo: initial?.serialTo || initial?.toSerial || "",
    totalDocuments: String(initial?.totalDocuments ?? 0),
    cancelledDocuments: String(initial?.cancelledDocuments ?? 0),
  };
}
function parseForm(raw, table) {
  const record = { ...raw };
  HEADS.forEach((head) => delete record["reported-" + head]);
  if (table.kind === "documents") {
    record.totalDocuments = Number(raw.totalDocuments);
    record.cancelledDocuments = Number(raw.cancelledDocuments);
    record.taxable = 0;
    record.cess = 0;
    record.rate = 0;
    return record;
  }
  record.taxable = toPaise(raw.taxable);
  record.cess = toPaise(raw.cess);
  record.rate = Number(raw.rate);
  if (record.taxable < 0 || record.cess < 0)
    throw Error(
      "Enter positive amounts. A credit note or advance adjustment supplies the reduction.",
    );
  if (table.id === "nil") record.rate = 0;
  if (table.id === "hsn") {
    record.quantity = Number(raw.quantity);
    record.reportedTax = Object.fromEntries(
      HEADS.map((head) => [head, toPaise(raw["reported-" + head])]),
    );
    if (Object.values(record.reportedTax).some((value) => value < 0))
      throw Error("HSN reported tax cannot be negative.");
    record.cess = record.reportedTax.cess;
  }
  if (!record.id) delete record.id;
  return record;
}
function OriginalSelector({ state, table, raw, setRaw }) {
  const eligible = (r) => {
    if (table.id === "amend-invoices")
      return r.tableId === (raw.subType === "export" ? "exports" : raw.subType);
    if (table.id === "amend-notes")
      return ["cdnr", "cdnur"].includes(r.tableId);
    if (table.id === "amend-b2cs") return r.tableId === "b2cs";
    return false;
  };
  const originals = Object.entries(state.periods || {})
    .flatMap(([period, value]) =>
      (value.gstr1?.records || [])
        .filter(eligible)
        .map((record) => ({ period, record })),
    )
    .filter(
      ({ period }) =>
        period < state.selectedPeriod &&
        state.periods[period].gstr1.status === "filed",
    );
  return (
    <Field
      full
      label="Original document to amend"
      required
      hint={
        originals.length
          ? "Enter revised absolute amounts. The difference from the last filed value affects this return."
          : "File the earlier-period GSTR-1 first, then select this later period to amend its records."
      }
    >
      <select
        required
        value={raw.originalId ? raw.originalPeriod + "|" + raw.originalId : ""}
        onChange={(e) => {
          const [period, id] = e.target.value.split("|");
          const original = originals.find(
            (x) => x.period === period && x.record.id === id,
          );
          if (!original) {
            setRaw({
              ...raw,
              originalId: "",
              originalPeriod: state.selectedPeriod,
            });
            return;
          }
          const latest = Object.entries(state.periods)
            .filter(
              ([period, data]) =>
                period < state.selectedPeriod && data.gstr1.status === "filed",
            )
            .sort(([a], [b]) => b.localeCompare(a))
            .flatMap(([, data]) =>
              data.gstr1.records.filter(
                (record) =>
                  record.tableId === table.id &&
                  record.originalId === id &&
                  record.originalPeriod === period,
              ),
            )[0];
          const r = latest || original.record;
          setRaw({
            ...raw,
            originalId: id,
            originalPeriod: period,
            recipientGstin: r.recipientGstin || "",
            recipientName: r.recipientName || "",
            invoiceNo: r.invoiceNo || "",
            pos: r.pos || raw.pos,
            taxable: decimal(r.taxable),
            rate: String(r.rate || 0),
            cess: decimal(r.cess),
            documentType: r.documentType || raw.documentType,
            reverseCharge: !!r.reverseCharge,
            exportType: r.exportType || r.paymentType || raw.exportType,
          });
        }}
      >
        <option value="">Select the original document</option>
        {originals.map(({ period, record }) => (
          <option key={period + record.id} value={period + "|" + record.id}>
            {record.invoiceNo || record.recipientName || record.id} · {period} ·
            ₹{money(record.taxable)}
          </option>
        ))}
      </select>
    </Field>
  );
}
function RecordForm({ state, table, initial, onSave, onCancel }) {
  const [raw, setRaw] = useState(() => newForm(state, table, initial)),
    [error, setError] = useState("");
  const field = (
    key,
    label,
    { required = false, hint, full, type = "text", options } = {},
  ) => (
    <Field key={key} label={label} required={required} hint={hint} full={full}>
      {options ? (
        <select
          value={raw[key]}
          required={required}
          onChange={(e) =>
            setRaw({
              ...raw,
              [key]: e.target.value,
              ...(key === "subType" ? { originalId: "" } : {}),
            })
          }
        >
          {options.map((item) => (
            <option
              key={Array.isArray(item) ? item[0] : item}
              value={Array.isArray(item) ? item[0] : item}
            >
              {Array.isArray(item) ? item[1] : item}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          inputMode={
            [
              "taxable",
              "cess",
              "quantity",
              "totalDocuments",
              "cancelledDocuments",
            ].includes(key) || key.startsWith("reported-")
              ? "decimal"
              : undefined
          }
          maxLength={
            key === "recipientGstin" || key === "ecommerceGstin"
              ? 15
              : key === "hsn"
                ? 8
                : 120
          }
          required={required}
          value={raw[key]}
          onChange={(e) =>
            setRaw({
              ...raw,
              [key]:
                key === "recipientGstin" || key === "ecommerceGstin"
                  ? e.target.value.toUpperCase()
                  : e.target.value,
            })
          }
        />
      )}
    </Field>
  );
  const amendment = !!table.amendment || table.id.startsWith("amend-");
  const isExport =
    table.id === "exports" ||
    (table.id === "amend-invoices" && raw.subType === "export");
  const note = ["cdnr", "cdnur", "amend-notes"].includes(table.id);
  const registered =
    ["b2b", "cdnr"].includes(table.id) ||
    (table.id === "amend-invoices" && raw.subType === "b2b") ||
    (table.id === "amend-notes" && raw.recipientGstin);
  const computed = (() => {
    try {
      return taxForRecord(state, parseForm(raw, table));
    } catch {
      return null;
    }
  })();
  const save = (e) => {
    e.preventDefault();
    setError("");
    try {
      onSave(parseForm(raw, table));
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <form onSubmit={save}>
      <p className="gstr1-required-note">
        * Mandatory fields · Enter amounts in rupees
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="gstr1-form-grid">
        {table.id === "amend-invoices" &&
          field("subType", "Original supply category", {
            required: true,
            options: [
              ["b2b", "B2B invoices"],
              ["b2cl", "B2C large invoices"],
              ["export", "Export invoices"],
            ],
          })}
        {amendment && (
          <OriginalSelector
            state={state}
            table={table}
            raw={raw}
            setRaw={setRaw}
          />
        )}
        {table.kind === "documents" ? (
          <>
            {field("documentCategory", "Nature of document", {
              required: true,
              full: true,
              options: docCategories,
            })}
            {field("serialFrom", "Serial number from", { required: true })}
            {field("serialTo", "Serial number to", { required: true })}
            {field("totalDocuments", "Total documents issued", {
              required: true,
            })}
            {field("cancelledDocuments", "Cancelled documents", {
              required: true,
              hint: "Net issued = total issued minus cancelled.",
            })}
          </>
        ) : (
          <>
            {table.id === "hsn" ? (
              <>
                {field("hsnCategory", "HSN reporting section", {
                  required: true,
                  options: [
                    ["B2B", "B2B supplies"],
                    ["B2C", "B2C supplies"],
                  ],
                })}
                {field("hsn", "HSN / SAC code", {
                  required: true,
                  hint: "Use the HSN / SAC classification for your practice goods or services.",
                })}
                {field("description", "Description", {
                  required: true,
                  full: true,
                })}
                {field("uqc", "Unit quantity code", {
                  required: true,
                  options: UQCS,
                })}
                {field("quantity", "Total quantity", { required: true })}
              </>
            ) : (
              <>
                {table.id === "advances" &&
                  field("subType", "Advance reporting", {
                    required: true,
                    options: [
                      ["received", "11A · Advance received"],
                      ["adjusted", "11B · Advance adjusted"],
                    ],
                  })}
                {table.id === "ecommerce" &&
                  field("subType", "E-commerce reporting", {
                    required: true,
                    full: true,
                    options: [
                      ["14a", "14(a) · Supplies through ECO collecting TCS"],
                      [
                        "14b",
                        "14(b) · Supplies through ECO under section 9(5)",
                      ],
                    ],
                  })}
                {["ecommerce", "ecommerce95"].includes(table.id) &&
                  field("ecommerceGstin", "E-commerce operator GSTIN", {
                    required: true,
                    full: true,
                    hint: "Use a fictional GSTIN for this practice record.",
                  })}
                {note &&
                  field("documentType", "Document type", {
                    required: true,
                    options: [
                      ["credit-note", "Credit note · reduces tax"],
                      ["debit-note", "Debit note · increases tax"],
                    ],
                  })}
                {!["b2cs", "nil", "advances", "ecommerce"].includes(table.id) &&
                  field("recipientGstin", "Recipient GSTIN", {
                    required: !!registered,
                    hint: registered
                      ? "Required for registered recipients."
                      : "Leave blank for an unregistered recipient.",
                  })}
                {field(
                  "recipientName",
                  isExport
                    ? "Overseas recipient"
                    : "Recipient / supply description",
                  { required: true, full: table.id === "nil" },
                )}
                {field(
                  "invoiceNo",
                  note
                    ? "Note number"
                    : table.id === "b2cs" ||
                        table.id === "nil" ||
                        table.id === "advances"
                      ? "Summary reference"
                      : "Invoice number",
                  { required: true },
                )}
                {field("date", note ? "Note date" : "Document / summary date", {
                  required: true,
                  type: "date",
                })}
                {isExport
                  ? field("exportType", "Export type", {
                      required: true,
                      options: [
                        ["with-payment", "With payment of tax"],
                        [
                          "without-payment",
                          "Without payment of tax (LUT / bond)",
                        ],
                      ],
                    })
                  : field("pos", "Place of supply", {
                      required: true,
                      options: states.map(([code, name]) => [
                        code,
                        code + " · " + name,
                      ]),
                    })}
                {table.id === "nil" &&
                  field("exemptionType", "Supply category", {
                    required: true,
                    options: [
                      ["nil-rated", "Nil rated"],
                      ["exempt", "Exempted"],
                      ["non-gst", "Non-GST"],
                    ],
                  })}
              </>
            )}
            {field(
              "taxable",
              table.id === "nil"
                ? "Value of supplies (₹)"
                : amendment
                  ? "Revised taxable value (₹)"
                  : "Taxable value (₹)",
              {
                required: true,
                hint: note
                  ? "Use a positive magnitude. The document type determines the sign."
                  : undefined,
              },
            )}
            {table.id !== "nil" &&
              field("rate", "GST rate (%)", {
                required: true,
                options: [
                  "0",
                  "0.1",
                  "0.25",
                  "1",
                  "1.5",
                  "3",
                  "5",
                  "6",
                  "7.5",
                  "12",
                  "18",
                  "28",
                  "40",
                ],
              })}
            {table.id !== "nil" &&
              table.id !== "hsn" &&
              field("cess", "Cess amount (₹)", { required: true })}
            {table.id === "hsn" &&
              HEADS.map((head) =>
                field("reported-" + head, HEAD_LABELS[head] + " reported (₹)", {
                  required: true,
                  hint: "Tax already included in the relevant supply records.",
                }),
              )}
            {(table.id === "b2b" ||
              (table.id === "amend-invoices" && raw.subType === "b2b")) && (
              <label className="gstr1-field-inline">
                <input
                  type="checkbox"
                  checked={raw.reverseCharge}
                  disabled={amendment}
                  onChange={(e) =>
                    setRaw({ ...raw, reverseCharge: e.target.checked })
                  }
                />
                Supply attracts reverse charge
              </label>
            )}
          </>
        )}
      </div>
      {table.id === "ecommerce" && (
        <p className="gstr1-form-help">
          Table 14 is supplementary reporting. It does not add tax a second time
          to the base supply reported in the relevant supply tables.
        </p>
      )}
      {table.id === "ecommerce95" && (
        <p className="gstr1-form-help">
          Report the operator's section 9(5) liability here. Tax is routed to
          the cash-only payment category in GSTR-3B.
        </p>
      )}
      {table.id === "hsn" && (
        <p className="gstr1-form-help">
          HSN summaries classify supplies already reported in invoice tables.
          They are excluded from tax totals to prevent duplication.
        </p>
      )}
      {computed && table.kind !== "documents" && table.id !== "hsn" && (
        <div className="gstr1-preview-tax">
          {HEADS.map((head) => (
            <div key={head}>
              <span>{HEAD_LABELS[head]} · tax impact</span>
              <strong>₹{money(computed[head])}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" type="submit">
          {initial ? "Save changes" : "Save record"}
        </button>
      </div>
    </form>
  );
}
function FilingForm({ state, totals, onFile, onCancel }) {
  const [declaration, setDeclaration] = useState(false),
    [signatoryId, setSignatoryId] = useState(""),
    [challenge, setChallenge] = useState(null),
    [code, setCode] = useState(""),
    [error, setError] = useState("");
  const request = () => {
    setError("");
    if (!declaration || !signatoryId) {
      setError("Accept the declaration and select an authorised signatory.");
      return;
    }
    setChallenge({
      code: String(100000 + Math.floor(Math.random() * 900000)),
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    setCode("");
  };
  const verify = (e) => {
    e.preventDefault();
    setError("");
    try {
      if (!challenge || Date.now() >= challenge.expiresAt)
        throw Error("This practice EVC expired. Generate a new code.");
      if (code !== challenge.code)
        throw Error(
          "Incorrect EVC. Enter the current six-digit practice code.",
        );
      onFile({ declaration, signatoryId });
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      <div className="gstr1-filing-summary">
        <div>
          <span>Records reported</span>
          <strong>{totals.recordCount}</strong>
        </div>
        <div>
          <span>Taxable value</span>
          <strong>₹{money(totals.taxable)}</strong>
        </div>
        <div>
          <span>Reported tax</span>
          <strong>₹{money(totals.totalTax)}</strong>
        </div>
      </div>
      <div className="notice">
        Filing locks GSTR-1 for this practice period. Review every reporting
        section before you continue. No government filing takes place.
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {challenge ? (
        <form onSubmit={verify}>
          <div className="gstr1-evc">
            <small>SIMULATED EVC · NO SMS OR EMAIL SENT</small>
            <strong>{challenge.code}</strong>
            <span>Valid for 10 minutes · A new code replaces this one</span>
          </div>
          <Field label="Enter EVC" required>
            <input
              aria-label="Enter GSTR-1 EVC"
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={request}>
              Generate new code
            </button>
            <button className="primary" disabled={code.length !== 6}>
              Verify & File GSTR-1
            </button>
          </div>
        </form>
      ) : (
        <>
          <label className="declaration">
            <input
              type="checkbox"
              checked={declaration}
              onChange={(e) => setDeclaration(e.target.checked)}
            />
            <span>
              I hereby declare that the information furnished in this return is
              true and correct to the best of my knowledge and belief.{" "}
              <small>Practice declaration only.</small>
            </span>
          </label>
          <Field label="Authorised Signatory" required>
            <select
              value={signatoryId}
              required
              onChange={(e) => setSignatoryId(e.target.value)}
            >
              <option value="">Select authorised signatory</option>
              {state.taxpayer.signatories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="modal-actions">
            <button className="secondary" onClick={onCancel}>
              Review return
            </button>
            <button
              className="primary"
              disabled={!declaration || !signatoryId}
              onClick={request}
            >
              File GSTR-1 with EVC
            </button>
          </div>
        </>
      )}
    </>
  );
}
export default function Gstr1Page({ state, onChange, onNavigate }) {
  const data = getPeriod(state),
    totals = gstr1Totals(state),
    [active, setActive] = useState(null),
    [view, setView] = useState("cards"),
    [query, setQuery] = useState(""),
    [dialog, setDialog] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [dialogError, setDialogError] = useState("");
  const locked =
    data.gstr1.status === "filed" || !!data.paymentLock || !!data.filing;
  const table = TABLES.find((t) => t.id === active),
    records = table
      ? data.gstr1.records.filter((r) => r.tableId === table.id)
      : [];
  const filtered = TABLES.filter((t) =>
    (t.title + " " + t.subtitle + " " + t.number)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  useEffect(() => {
    setActive(null);
    setDialog(null);
    setError("");
    setMessage("");
  }, [state.selectedPeriod]);
  const show = (value) => {
    setDialog(value);
    setDialogError("");
  };
  const close = () => setDialog(null);
  const commit = (next) => {
    if (onChange(next) === false)
      throw Error(
        "Unable to save this action. Check the workspace message and retry.",
      );
  };
  const saveRecord = (record) => {
    commit(upsertGstr1Record(state, record));
    setMessage("Record saved. GSTR-1 summary has been updated.");
    setError("");
    close();
  };
  const deleteRecord = () => {
    try {
      commit(deleteGstr1Record(state, dialog.record.id));
      setMessage("Record removed from this draft return.");
      close();
    } catch (e) {
      setDialogError(e.message);
    }
  };
  const file = (verification) => {
    commit(fileGstr1(state, verification));
    setMessage(
      "Practice GSTR-1 filed successfully. Its output tax is ready for GSTR-3B.",
    );
    close();
  };
  const exportReturn = () =>
    downloadFile(`PRACTICE-GSTR1-${state.selectedPeriod}.json`, {
      label: "PRACTICE ONLY — NOT AN OFFICIAL GST RETURN",
      gstin: state.taxpayer.gstin,
      period: state.selectedPeriod,
      status: data.gstr1.status,
      records: data.gstr1.records,
      totals,
      receipt: data.gstr1.receipt || null,
    });
  const displayDate = (value) =>
    value
      ? new Date(value).toLocaleDateString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "—";
  return (
    <div className="gstr1-page">
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="alert success" role="status">
          <Symbol name="check" />
          <span>{message}</span>
          <button aria-label="Dismiss message" onClick={() => setMessage("")}>
            <Symbol name="close" size={14} />
          </button>
        </div>
      )}
      {data.gstr1.status === "filed" && (
        <div className="gstr1-receipt">
          <Symbol name="check" size={26} />
          <h3>GSTR-1 filed successfully · Practice return</h3>
          <strong>
            {data.gstr1.receipt?.reference ||
              data.gstr1.receipt?.arn ||
              "Practice filing recorded"}
          </strong>
          <p>
            The return is locked for {state.selectedPeriod}. Review your
            purchase actions in IMS and generate GSTR-2B before preparing
            GSTR-3B.
          </p>
          <div className="gstr1-postfile-actions">
            <button className="secondary" onClick={exportReturn}>
              <Symbol name="download" size={15} />
              Download GSTR-1
            </button>
            <button className="primary" onClick={() => onNavigate("ims")}>
              Go to IMS <Symbol name="arrow" size={14} />
            </button>
          </div>
        </div>
      )}
      <section className="summary-cards" aria-label="GSTR-1 summary">
        {[
          ["Taxable value", totals.taxable, "Net effect of reported supplies"],
          ["Integrated tax", totals.igst, "IGST liability"],
          [
            "Central & State tax",
            (totals.cgst || 0) + (totals.sgst || 0),
            "CGST and SGST / UTGST",
          ],
          [
            "Total reported tax",
            totals.totalTax,
            "Tax shown on reported supplies",
          ],
        ].map(([label, value, caption]) => (
          <div className="summary-card" key={label}>
            <span className="summary-label">
              {label}
              <Symbol size={16} />
            </span>
            <strong>
              <small>₹</small>
              {money(value)}
            </strong>
            <span className="summary-sub">{caption}</span>
          </div>
        ))}
      </section>
      {!active ? (
        <>
          <div className="gstr1-toolbar">
            <div className="gstr1-switch">
              <button
                className={view === "cards" ? "active" : ""}
                onClick={() => setView("cards")}
              >
                Reporting sections
              </button>
              <button
                className={view === "summary" ? "active" : ""}
                onClick={() => setView("summary")}
              >
                Consolidated summary
              </button>
            </div>
            <span className="gstr1-info-label">15 practice sections</span>
            <label className="gstr1-search">
              <Symbol name="search" size={15} />
              <input
                aria-label="Search GSTR-1 tables"
                placeholder="Search a table or description"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {view === "cards" ? (
            <div className="gstr1-grid">
              {filtered.map((t) => {
                const rows = data.gstr1.records.filter(
                    (r) => r.tableId === t.id,
                  ),
                  total = totalsForCard(state, t, rows, totals);
                return (
                  <button
                    className="gstr1-tile"
                    key={t.id}
                    onClick={() => setActive(t.id)}
                  >
                    <div className="gstr1-tile-top">
                      <span className="gstr1-table-badge">{t.number}</span>
                      <div>
                        <h3>{t.title}</h3>
                        <p>{t.subtitle}</p>
                      </div>
                    </div>
                    <div className="gstr1-tile-numbers">
                      <span>
                        {t.kind === "documents"
                          ? "Net documents issued"
                          : t.id === "hsn"
                            ? "Reported taxable value"
                            : "Taxable value"}
                        <strong>
                          {t.kind === "documents"
                            ? total.taxable
                            : "₹" + money(total.taxable)}
                        </strong>
                      </span>
                      <span>
                        {["hsn", "documents", "ecommerce"].includes(t.id)
                          ? "Reporting only"
                          : "Reported tax"}
                        <strong>
                          {["hsn", "documents", "ecommerce"].includes(t.id)
                            ? "—"
                            : "₹" + money(total.totalTax)}
                        </strong>
                      </span>
                    </div>
                    <div className="gstr1-tile-footer">
                      <span className="gstr1-count">
                        <i />
                        {rows.length} {rows.length === 1 ? "record" : "records"}
                      </span>
                      <span>
                        {locked ? "View details" : "Prepare / View"} ›
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>GSTR-1 consolidated summary</h3>
                  <p>
                    Tax impact is calculated once for base supplies and
                    amendment differences.
                  </p>
                </div>
                <span className="rupee-note">All amounts in ₹</span>
              </div>
              <div className="table-scroll">
                <table className="gstr1-summary-table">
                  <thead>
                    <tr>
                      <th>Table / reporting section</th>
                      <th>Records</th>
                      <th>Taxable value</th>
                      {HEADS.map((h) => (
                        <th key={h}>{HEAD_LABELS[h]}</th>
                      ))}
                      <th>Total tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => {
                      const rows = data.gstr1.records.filter(
                          (r) => r.tableId === t.id,
                        ),
                        total = totals.byTable?.[t.id] || {};
                      return (
                        <tr key={t.id}>
                          <th>
                            <button onClick={() => setActive(t.id)}>
                              {t.number} · {t.title}
                            </button>
                          </th>
                          <td>{rows.length}</td>
                          <td>{money(total.taxable)}</td>
                          {HEADS.map((h) => (
                            <td key={h}>{money(total[h])}</td>
                          ))}
                          <td>{money(total.totalTax)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Net return totals</th>
                      <td>{totals.recordCount}</td>
                      <td>{money(totals.taxable)}</td>
                      {HEADS.map((h) => (
                        <td key={h}>{money(totals[h])}</td>
                      ))}
                      <td>{money(totals.totalTax)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="table-note">
                HSN summaries, document counts and supplementary Table 14 values
                are excluded from tax totals.
              </div>
            </section>
          )}
          {!filtered.length && (
            <div className="gstr1-search-none">
              No reporting sections match your search.
            </div>
          )}
          <div className="notice">
            The 15 practice sections group the official GSTR-1 tables and
            amendments. Table 12 includes B2B and B2C HSN summaries; Table 13
            records documents issued. Reporting-only sections do not duplicate
            your tax liability.
          </div>
        </>
      ) : (
        <>
          <div className="gstr1-section-tools">
            <button className="gstr1-back" onClick={() => setActive(null)}>
              <Symbol name="back" size={14} />
              All reporting sections
            </button>
            <div className="button-row">
              <span className="gstr1-info-label">Table {table.number}</span>
              {!locked && (
                <button
                  className="primary"
                  onClick={() => show({ kind: "record" })}
                >
                  + Add{" "}
                  {table.kind === "documents"
                    ? "document range"
                    : table.id === "hsn"
                      ? "HSN summary"
                      : "record"}
                </button>
              )}
            </div>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>
                  {table.number} · {table.title}
                </h3>
                <p>{table.subtitle}</p>
              </div>
              <span className="rupee-note">
                {records.length} {records.length === 1 ? "record" : "records"} ·{" "}
                {locked ? "View only" : "Draft"}
              </span>
            </div>
            {!records.length ? (
              <div className="gstr1-empty">
                <Symbol size={31} />
                <h3>No records in this section</h3>
                <p>
                  Add a practice record to report this category of supplies.
                  Only applicable sections need entries.
                </p>
                {!locked && (
                  <button
                    className="secondary"
                    onClick={() => show({ kind: "record" })}
                  >
                    Add first record
                  </button>
                )}
              </div>
            ) : (
              <div className="table-scroll">
                <table className="gstr1-record-table">
                  <thead>
                    <tr>
                      {table.kind === "documents" ? (
                        <>
                          <th>Nature of document</th>
                          <th>From / To</th>
                          <th>Issued</th>
                          <th>Cancelled</th>
                          <th>Net issued</th>
                        </>
                      ) : (
                        <>
                          <th>
                            {table.id === "hsn"
                              ? "HSN / SAC"
                              : "Document / Recipient"}
                          </th>
                          <th>
                            {table.id === "hsn"
                              ? "Category / Quantity"
                              : "Date / Place of supply"}
                          </th>
                          <th>Taxable value</th>
                          {HEADS.map((h) => (
                            <th key={h}>{HEAD_LABELS[h]}</th>
                          ))}
                          <th>Total tax</th>
                        </>
                      )}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => {
                      const tax = recordTax(state, record);
                      return (
                        <tr key={record.id}>
                          {table.kind === "documents" ? (
                            <>
                              <th>{record.documentCategory}</th>
                              <td>
                                {record.serialFrom || record.fromSerial} /{" "}
                                {record.serialTo || record.toSerial}
                              </td>
                              <td>{record.totalDocuments}</td>
                              <td>{record.cancelledDocuments}</td>
                              <td>
                                {record.totalDocuments -
                                  record.cancelledDocuments}
                              </td>
                            </>
                          ) : (
                            <>
                              <th>
                                <div className="gstr1-record-name">
                                  <span>
                                    {table.id === "hsn"
                                      ? record.hsn
                                      : record.invoiceNo ||
                                        record.description ||
                                        "Summary"}
                                  </span>
                                  <small>
                                    {table.id === "hsn"
                                      ? record.description
                                      : record.recipientName ||
                                        record.recipientGstin}
                                  </small>
                                  {record.documentType === "credit-note" && (
                                    <span className="gstr1-note">
                                      Credit note
                                    </span>
                                  )}
                                  {record.originalId && (
                                    <span className="gstr1-note">
                                      Amendment · {record.originalPeriod}
                                    </span>
                                  )}
                                </div>
                              </th>
                              <td>
                                {table.id === "hsn" ? (
                                  <div className="gstr1-record-name">
                                    <span>{record.hsnCategory} supplies</span>
                                    <small>
                                      {record.quantity} {record.uqc}
                                    </small>
                                  </div>
                                ) : (
                                  <div className="gstr1-record-name">
                                    <span>{displayDate(record.date)}</span>
                                    <small>
                                      {record.pos === "96"
                                        ? "Outside India"
                                        : record.pos +
                                          " · " +
                                          (states.find(
                                            (s) => s[0] === record.pos,
                                          )?.[1] || "Place of supply")}
                                    </small>
                                  </div>
                                )}
                              </td>
                              <td>
                                {money(
                                  table.id === "hsn"
                                    ? record.taxable
                                    : tax.taxable,
                                )}
                              </td>
                              {HEADS.map((h) => (
                                <td key={h}>{money(tax[h])}</td>
                              ))}
                              <td>{money(tax.totalTax)}</td>
                            </>
                          )}
                          <td>
                            <div className="gstr1-record-actions">
                              {!locked ? (
                                <>
                                  <button
                                    onClick={() =>
                                      show({ kind: "record", record })
                                    }
                                    aria-label={`Edit ${record.invoiceNo || record.hsn || record.documentCategory}`}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="delete"
                                    onClick={() =>
                                      show({ kind: "delete", record })
                                    }
                                    aria-label={`Delete ${record.invoiceNo || record.hsn || record.documentCategory}`}
                                  >
                                    Delete
                                  </button>
                                </>
                              ) : (
                                <span className="gstr1-info-label">Filed</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {["hsn", "documents", "ecommerce"].includes(table.id) && (
              <div className="table-note">
                This reporting section is retained for return completeness and
                does not add another tax liability.
              </div>
            )}
            {table.id === "ecommerce95" && (
              <div className="table-note">
                Section 9(5) tax is included in GSTR-3B category B and
                discharged in cash.
              </div>
            )}
          </section>
        </>
      )}
      <div className="gstr1-footer-actions">
        <button className="secondary" onClick={exportReturn}>
          <Symbol name="download" size={15} />
          Download practice return
        </button>
        <div>
          <button
            className="secondary"
            onClick={() => {
              setActive(null);
              setView("summary");
            }}
          >
            Preview summary
          </button>
          {!locked && (
            <button className="primary" onClick={() => show({ kind: "file" })}>
              Proceed to File GSTR-1 <Symbol name="arrow" size={14} />
            </button>
          )}
          {locked && (
            <button className="primary" onClick={() => onNavigate("ims")}>
              Continue to IMS <Symbol name="arrow" size={14} />
            </button>
          )}
        </div>
      </div>
      {dialog && (
        <Dialog
          title={
            dialog.kind === "record"
              ? `${dialog.record ? "Edit" : "Add"} · ${table.title}`
              : dialog.kind === "delete"
                ? "Delete this practice record?"
                : "GSTR-1 · Verification & Filing"
          }
          onClose={close}
        >
          {dialogError && (
            <div className="alert error" role="alert">
              {dialogError}
            </div>
          )}
          {dialog.kind === "record" && (
            <RecordForm
              state={state}
              table={table}
              initial={dialog.record}
              onSave={saveRecord}
              onCancel={close}
            />
          )}{" "}
          {dialog.kind === "delete" && (
            <>
              <p className="hint">
                Remove{" "}
                <strong>
                  {dialog.record.invoiceNo ||
                    dialog.record.hsn ||
                    dialog.record.documentCategory}
                </strong>{" "}
                from this draft return? Any amendment that depends on this
                record must be removed first.
              </p>
              <div className="modal-actions">
                <button className="secondary" onClick={close}>
                  Keep record
                </button>
                <button className="primary" onClick={deleteRecord}>
                  Delete record
                </button>
              </div>
            </>
          )}{" "}
          {dialog.kind === "file" && (
            <FilingForm
              state={state}
              totals={totals}
              onFile={file}
              onCancel={close}
            />
          )}
        </Dialog>
      )}
    </div>
  );
}
