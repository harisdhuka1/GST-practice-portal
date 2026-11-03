import React, { useEffect, useId, useRef, useState } from "react";
import {
  HEADS,
  GROUPS,
  calculatePayment,
  formatMoney,
  toPaise,
} from "../gst/paymentEngine.js";
import {
  getPaymentInputs,
  updatePartA,
  updatePaymentPlan,
  createChallan,
  markChallanPaid,
  offsetLiabilities,
  requestEvc,
  verifyEvc,
} from "../gst/practiceStore.js";
const LABEL = {
  igst: "Integrated Tax",
  cgst: "Central Tax",
  sgst: "State / UT Tax",
  cess: "Cess",
};
const SHORT = {
  igst: "IGST",
  cgst: "CGST",
  sgst: "SGST / UTGST",
  cess: "Cess",
};
const MINORS = ["tax", "interest", "lateFee"];
const MINOR_LABEL = { tax: "Tax", interest: "Interest", lateFee: "Late fee" };
const money = (n) => formatMoney(n || 0);
const decimal = (n) => formatMoney(n).replaceAll(",", "");
const safeMoneySum = (values) => {
  const n = values.reduce((a, b) => a + BigInt(b), 0n);
  return n > BigInt(Number.MAX_SAFE_INTEGER) ||
    n < -BigInt(Number.MAX_SAFE_INTEGER)
    ? "Invalid total"
    : formatMoney(Number(n));
};
const savedOrder = (ws) =>
  ws.offset?.inputs?.order ||
  ws.paymentPlan?.order || {
    igstRemainder: "cgst-first",
    residualIgst: "cgst-first",
  };
const editableMatrix = (matrix) =>
  matrix
    ? Object.fromEntries(
        HEADS.map((h) => [
          h,
          Object.fromEntries(
            HEADS.map((s) => [s, decimal(matrix[h]?.[s] || 0)]),
          ),
        ]),
      )
    : null;
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const copy = (o) => JSON.parse(JSON.stringify(o));
const date = (t) =>
  new Date(t).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
function Icon({ name = "file", size = 18, ...props }) {
  const paths = {
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 13h8M8 17h6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    wallet: (
      <>
        <path d="M20 8V5H5a2 2 0 0 1 0-4h14v4M5 5H3v15h18V8H5Z" />
        <path d="M16 12h5v5h-5z" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v1" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
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
      {...props}
    >
      {paths[name] || paths.file}
    </svg>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const id = useId(),
    ref = useRef();
  useEffect(() => {
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const all = [
          ...ref.current.querySelectorAll(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ].filter((x) => x.offsetParent !== null);
        const first = all[0],
          last = all[all.length - 1];
        if (!all.length) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handler);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        ref={ref}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2 id={id}>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
function download(name, data, type = "application/json") {
  const url = URL.createObjectURL(
    new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function PreparedReturn({ ws, onSave, onClose }) {
  const [raw, setRaw] = useState(() =>
    Object.fromEntries(
      ["A", "B", "itc", "interest", "lateFee"].map((section) => [
        section,
        Object.fromEntries(
          HEADS.map((h) => [
            h,
            decimal(
              ["A", "B"].includes(section)
                ? ws.partA.liabilities[section][h]
                : ws.partA[section]?.[h] || 0,
            ),
          ]),
        ),
      ]),
    ),
  );
  const [error, setError] = useState("");
  const locked = ws.status !== "draft";
  const save = () => {
    try {
      const p = copy(ws.partA);
      for (const section of Object.keys(raw))
        for (const h of HEADS) {
          const value = toPaise(raw[section][h]);
          if (!["A", "B"].includes(section) && value < 0)
            throw Error("ITC and charges cannot be negative.");
          if (["A", "B"].includes(section)) p.liabilities[section][h] = value;
          else p[section][h] = value;
        }
      onSave(p);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      <p>Review the amounts carried into payment. All figures are in rupees.</p>
      {locked && (
        <div className="notice">
          <Icon name="lock" />
          Payment has been offset. The prepared return is locked.
        </div>
      )}
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      <div className="table-scroll">
        <table className="source-table">
          <thead>
            <tr>
              <th>Prepared return amounts</th>
              {HEADS.map((h) => (
                <th key={h}>{SHORT[h]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["A", "A. Other than reverse charge and section 9(5)"],
              ["B", "B. Reverse charge and section 9(5)"],
              ["itc", "Net ITC available · Table 4(C)"],
              ["interest", "Interest payable"],
              ["lateFee", "Late fee payable"],
            ].map(([section, label]) => (
              <tr key={section}>
                <th>{label}</th>
                {HEADS.map((h) => (
                  <td key={h}>
                    <input
                      aria-label={`${label} ${SHORT[h]} in rupees`}
                      inputMode="decimal"
                      disabled={locked}
                      value={raw[section][h]}
                      onChange={(e) =>
                        setRaw({
                          ...raw,
                          [section]: { ...raw[section], [h]: e.target.value },
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Negative tax amounts are carried to the corresponding negative liability
        balance. Interest and late fee are paid in cash.
      </p>
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>
          Close
        </button>
        {!locked && (
          <button className="primary" onClick={save}>
            Save & recalculate
          </button>
        )}
      </div>
    </>
  );
}
export default function Gstr3BPaymentPage({
  workspace: ws,
  onChange,
  storageError = "",
  embedded = false,
  onNavigate,
  onDirtyChange,
  initialTab = "payment",
}) {
  const [tab, setTab] = useState(initialTab),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [order, setOrder] = useState(() => savedOrder(ws)),
    [manual, setManual] = useState(() =>
      editableMatrix(ws.paymentPlan?.allocation),
    ),
    [declaration, setDeclaration] = useState(false),
    [signatoryId, setSignatory] = useState(""),
    [otp, setOtp] = useState(""),
    [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const locked = ws.status !== "draft",
    filed = ws.status === "filed";
  let calc,
    allocation,
    parseError = "";
  try {
    if (manual)
      allocation = Object.fromEntries(
        HEADS.map((h) => [
          h,
          Object.fromEntries(HEADS.map((s) => [s, toPaise(manual[h][s])])),
        ]),
      );
    calc =
      ws.offset?.snapshot ||
      calculatePayment(
        getPaymentInputs(ws, { order, allocation: allocation || null }),
      );
  } catch (e) {
    parseError = e.message;
    calc = calculatePayment(getPaymentInputs(ws, { order }));
  }
  const errors = [...(calc.errors || []), ...(parseError ? [parseError] : [])];
  const currentPlan = { order, allocation: allocation || null };
  const allocationDirty =
    !locked &&
    JSON.stringify(currentPlan) !==
      JSON.stringify({
        order: ws.paymentPlan?.order || {
          igstRemainder: "cgst-first",
          residualIgst: "cgst-first",
        },
        allocation: ws.paymentPlan?.allocation || null,
      });
  useEffect(() => {
    onDirtyChange?.(allocationDirty);
    return () => onDirtyChange?.(false);
  }, [allocationDirty, onDirtyChange]);
  useEffect(() => {
    if (!allocationDirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [allocationDirty]);
  const periodLabel = new Date(ws.period + "-01T12:00:00Z").toLocaleDateString(
    "en-IN",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
  const year = Number(ws.period.slice(0, 4)),
    fy =
      Number(ws.period.slice(5, 7)) >= 4
        ? `${year}–${String(year + 1).slice(2)}`
        : `${year - 1}–${String(year).slice(2)}`;
  const run = (fn, message) => {
    setError("");
    try {
      const next = fn();
      if (onChange(next) !== false) {
        if (message) setNotice(message);
        return true;
      }
    } catch (e) {
      setError(e.message);
    }
    return false;
  };
  const show = (id) => {
    if (id === "parta" && embedded && onNavigate) {
      onNavigate("gstr3b");
      return;
    }
    setModal(id);
    setError("");
  };
  const changeTab = (t) => {
    setTab(t);
    setError("");
  };
  const setAuto = () => {
    setManual(null);
    setNotice(
      "ITC calculated using the available credit and Rule 88A priorities.",
    );
  };
  const beginManual = () => setManual(editableMatrix(calc.matrix));
  const startEvc = () => {
    if (
      run(
        () => requestEvc(ws, { signatoryId, declaration }),
        "A practice EVC code has been generated. No email or SMS was sent.",
      )
    ) {
      setOtp("");
      setModal("evc");
    }
  };
  const outstanding = calc.totals.shortfall || 0;
  const snapshot = () => ({
    label: "PRACTICE / TRAINING ONLY — NOT A GST FILING",
    gstin: ws.gstin,
    period: ws.period,
    status: ws.status,
    preparedReturn: ws.partA,
    table61: calc,
    receipt: ws.receipt || null,
  });
  const generateChallan = () => {
    if (
      run(
        () => createChallan(ws, { amounts: calc.cashShortfall }),
        "Practice challan generated. Simulate payment to credit the cash ledger.",
      )
    )
      setModal("challans");
  };
  const seconds = ws.challenge
    ? Math.max(0, Math.ceil((Date.parse(ws.challenge.expiresAt) - tick) / 1000))
    : 0;
  return (
    <div className={embedded ? "app-shell payment-embedded" : "app-shell"}>
      {!embedded && (
        <>
          <div className="utility">
            <div className="container utility-inner">
              <span>Goods and Services Tax</span>
              <span>
                Learning environment <i />
                English
              </span>
            </div>
          </div>
          <header className="brand-header">
            <div className="container brand-inner">
              <div className="brand-symbol" aria-hidden="true">
                <span>GST</span>
                <small>PRACTICE</small>
              </div>
              <div className="brand-copy">
                <h1>GST Practice Portal</h1>
                <p>Goods and Services Tax</p>
              </div>
              <div className="user-block">
                <span className="avatar">AS</span>
                <div>
                  <strong>Sample Aarav Shah</strong>
                  <span>Taxpayer workspace</span>
                </div>
              </div>
            </div>
          </header>
          <nav className="main-nav" aria-label="Main navigation">
            <div className="container">
              <button
                className={
                  tab === "payment" || tab === "filing" ? "active" : ""
                }
                onClick={() => changeTab("payment")}
              >
                Returns
              </button>
              <button
                className={tab === "ledgers" ? "active" : ""}
                onClick={() => changeTab("ledgers")}
              >
                Electronic Ledgers
              </button>
              <button onClick={() => show("challans")}>Challan History</button>
              <button onClick={() => show("help")}>Help & Resources</button>
              <span className="practice-pill">
                <span />
                PRACTICE MODE
              </span>
            </div>
          </nav>
          <div className="practice-banner">
            <div className="container">
              <Icon name="info" size={15} />
              <span>
                Independent training portal. Fictional data, simulated payments
                and EVC. No government filing.
              </span>
            </div>
          </div>
        </>
      )}
      <main
        className="container content"
        id={embedded ? "payment-content" : "main-content"}
      >
        <div className="breadcrumb">
          <span>Returns</span>
          <Icon name="arrow" size={12} />
          <span>GSTR-3B</span>
          <Icon name="arrow" size={12} />
          <strong>
            {tab === "ledgers"
              ? "Electronic Ledgers"
              : tab === "filing"
                ? "Verification & Filing"
                : "Payment of Tax"}
          </strong>
        </div>
        <div className="page-title">
          <div>
            <p className="eyebrow">
              FORM GSTR-3B <span>MONTHLY RETURN</span>
            </p>
            <h2>
              {tab === "ledgers"
                ? "Electronic Ledgers"
                : tab === "filing"
                  ? "Verification & Filing"
                  : "Payment of Tax"}
            </h2>
            <p>
              Review your liabilities, utilise input tax credit and complete
              your return.
            </p>
          </div>
          <span className={"status " + ws.status}>
            <span />
            {filed ? "Filed" : locked ? "Payment offset" : "Draft"}
          </span>
        </div>
        <section className="return-info" aria-label="Return details">
          <div>
            <span>GSTIN</span>
            <strong>{ws.gstin}</strong>
          </div>
          <div>
            <span>Legal name</span>
            <strong>{ws.partA.legalName || "Sample Practice Taxpayer"}</strong>
          </div>
          <div>
            <span>Financial year</span>
            <strong>{fy}</strong>
          </div>
          <div>
            <span>Return period</span>
            <strong>{periodLabel}</strong>
          </div>
          <button className="text-button" onClick={() => show("parta")}>
            View Part A <Icon name="arrow" size={14} />
          </button>
        </section>
        <div className="return-steps" aria-label="Return progress">
          <button onClick={() => show("parta")}>
            <span className="step-dot done">
              <Icon name="check" size={14} />
            </span>
            <div>
              <small>PART A</small>
              <strong>Return details</strong>
            </div>
          </button>
          <div className="step-line" />
          <button
            className={tab === "payment" ? "current" : ""}
            onClick={() => changeTab("payment")}
          >
            <span className={"step-dot " + (locked ? "done" : "selected")}>
              {locked ? <Icon name="check" size={14} /> : 2}
            </span>
            <div>
              <small>PART B</small>
              <strong>Payment of tax</strong>
            </div>
          </button>
          <div className="step-line" />
          <button
            className={tab === "filing" ? "current" : ""}
            onClick={() => changeTab("filing")}
          >
            <span
              className={
                "step-dot " + (filed ? "done" : locked ? "selected" : "")
              }
            >
              {filed ? <Icon name="check" size={14} /> : 3}
            </span>
            <div>
              <small>FINAL STEP</small>
              <strong>Verification & filing</strong>
            </div>
          </button>
        </div>
        {(error || storageError) && (
          <div className="alert error" role="alert">
            <Icon name="info" />
            <span>{storageError || error}</span>
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            <Icon name="check" />
            <span>{notice}</span>
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        {tab === "payment" && (
          <>
            <section className="summary-cards" aria-label="Payment summary">
              {[
                [
                  "Net tax payable",
                  calc.totals.netTax,
                  "After negative liability adjustment",
                  "file",
                ],
                [
                  locked ? "Paid through ITC" : "Proposed ITC utilisation",
                  calc.totals.itcUsed,
                  "Rule 88A set-off applied",
                  "file",
                ],
                [
                  "Cash payment required",
                  calc.totals.cashRequired,
                  "Includes interest and late fee",
                  "wallet",
                ],
                [
                  "Additional cash required",
                  outstanding,
                  outstanding
                    ? "Create a challan for the shortfall"
                    : "Cash ledger covers the payment",
                  "wallet",
                ],
              ].map(([label, value, sub, icon], i) => (
                <div
                  className={
                    "summary-card " +
                    (i === 3 && outstanding ? "highlight" : "")
                  }
                  key={label}
                >
                  <span className="summary-label">
                    {label}
                    <Icon name={icon} size={17} />
                  </span>
                  <strong>
                    <small>₹</small>
                    {money(value)}
                  </strong>
                  <span className="summary-sub">{sub}</span>
                </div>
              ))}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>
                    <span className="table-number">6.1</span> Payment of Tax
                  </h3>
                  <p>
                    Tax payable and its discharge through input tax credit and
                    cash.
                  </p>
                </div>
                <span className="rupee-note">All amounts in ₹</span>
              </div>
              <div className="table-scroll payment-scroll">
                <table className="payment-table">
                  <thead>
                    <tr>
                      <th rowSpan="2">Description</th>
                      <th rowSpan="2">Tax payable</th>
                      <th rowSpan="2">
                        Adjustment of
                        <br />
                        negative liability
                      </th>
                      <th rowSpan="2">
                        Net tax
                        <br />
                        payable
                      </th>
                      <th colSpan="4" className="itc-group">
                        {locked
                          ? "Tax paid through ITC"
                          : "Tax to be paid through ITC"}
                      </th>
                      <th rowSpan="2">
                        Tax {locked ? "paid" : "to pay"}
                        <br />
                        in cash
                      </th>
                      <th rowSpan="2">
                        Interest
                        <br />
                        in cash
                      </th>
                      <th rowSpan="2">
                        Late fee
                        <br />
                        in cash
                      </th>
                    </tr>
                    <tr>
                      {HEADS.map((h) => (
                        <th className="itc-group" key={h}>
                          {SHORT[h]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {GROUPS.map((g) => (
                      <React.Fragment key={g}>
                        <tr className="group-row">
                          <th colSpan="11">
                            {g}.{" "}
                            {g === "A"
                              ? "Other than reverse charge and supplies under section 9(5)"
                              : "Reverse charge and supplies under section 9(5)"}
                            {g === "B" && <span>CASH ONLY</span>}
                          </th>
                        </tr>
                        {calc.rows
                          .filter((r) => r.group === g)
                          .map((r) => (
                            <tr key={g + r.head}>
                              <th>{LABEL[r.head]}</th>
                              {[
                                r.gross,
                                r.negativeAdjusted,
                                r.net,
                                ...HEADS.map((h) => r.itc[h]),
                                r.cashTax,
                                r.interest,
                                r.lateFee,
                              ].map((n, i) => (
                                <td
                                  className={i >= 3 && i <= 6 ? "itc-cell" : ""}
                                  key={i}
                                >
                                  {money(n)}
                                </td>
                              ))}
                            </tr>
                          ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      {[
                        safeMoneySum(calc.rows.map((r) => r.gross)),
                        calc.totals.negativeAdjusted,
                        calc.totals.netTax,
                        ...HEADS.map((h) => calc.creditUsed[h]),
                        calc.totals.cashTax,
                        calc.totals.interest,
                        calc.totals.lateFee,
                      ].map((n, i) => (
                        <td key={i}>{typeof n === "string" ? n : money(n)}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="table-note">
                <Icon name="info" size={16} />
                <span>
                  Reverse charge, section 9(5) liability, interest and late fee
                  are payable in cash. Cess credit can be used only against
                  Cess.
                </span>
              </div>
            </section>
            <section className="panel matrix-panel">
              <div className="panel-heading">
                <div>
                  <h3>
                    ITC Set-Off Matrix <span className="tag">Rule 88A</span>
                  </h3>
                  <p>
                    Credit available by source, allocated against each tax
                    liability.
                  </p>
                </div>
                <div className="button-row">
                  {!locked && (
                    <button
                      className="secondary small"
                      disabled={!allocationDirty || errors.length > 0}
                      onClick={() =>
                        run(
                          () => updatePaymentPlan(ws, currentPlan),
                          "Draft allocation saved for this taxpayer and return period.",
                        )
                      }
                    >
                      Save allocation
                    </button>
                  )}
                  <button
                    className="secondary small"
                    disabled={locked}
                    onClick={manual ? setAuto : beginManual}
                  >
                    {manual ? "Use auto set-off" : "Edit allocation"}
                  </button>
                  <button className="text-button" onClick={() => show("rules")}>
                    View set-off rules <Icon name="info" size={15} />
                  </button>
                </div>
              </div>
              <div className="allocation-controls">
                <label>
                  Surplus IGST preference
                  <select
                    aria-label="Surplus IGST preference"
                    disabled={locked || !!manual}
                    value={order.igstRemainder}
                    onChange={(e) =>
                      setOrder({ ...order, igstRemainder: e.target.value })
                    }
                  >
                    <option value="cgst-first">CGST, then SGST / UTGST</option>
                    <option value="sgst-first">SGST / UTGST, then CGST</option>
                  </select>
                </label>
                <label>
                  Residual IGST liability
                  <select
                    aria-label="Residual IGST credit order"
                    disabled={locked || !!manual || ws.period < "2026-02"}
                    value={order.residualIgst}
                    onChange={(e) =>
                      setOrder({ ...order, residualIgst: e.target.value })
                    }
                  >
                    <option value="cgst-first">
                      CGST credit, then SGST credit
                    </option>
                    <option value="sgst-first">
                      SGST credit, then CGST credit
                    </option>
                  </select>
                </label>
                <span className="hint">
                  {allocationDirty ? (
                    <strong className="unsaved-label">
                      Allocation changes are unsaved.
                    </strong>
                  ) : null}{" "}
                  Auto set-off minimises cash payment, then uses your preferred
                  order.
                </span>
              </div>
              <div className="table-scroll">
                <table className="matrix-table">
                  <thead>
                    <tr>
                      <th>
                        Liability to be paid ↓ <span>Credit source →</span>
                      </th>
                      {HEADS.map((h) => (
                        <th key={h}>{SHORT[h]} credit</th>
                      ))}
                      <th>Remaining tax in cash</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="available-row">
                      <th>Available credit</th>
                      {HEADS.map((h) => (
                        <td key={h}>
                          {money(
                            (ws.opening.credit[h] || 0) +
                              (ws.partA.itc[h] || 0),
                          )}
                        </td>
                      ))}
                      <td>—</td>
                    </tr>
                    {HEADS.map((h) => (
                      <tr key={h}>
                        <th>{SHORT[h]} liability</th>
                        {HEADS.map((s) => {
                          const allowed =
                            s === h ||
                            (s === "igst" && h !== "cess") ||
                            (h === "igst" && s !== "cess");
                          return (
                            <td
                              key={s}
                              className={!allowed ? "unavailable" : ""}
                            >
                              {manual && allowed && !locked ? (
                                <input
                                  aria-label={`${SHORT[s]} credit towards ${SHORT[h]} liability in rupees`}
                                  inputMode="decimal"
                                  value={manual[h][s]}
                                  onChange={(e) =>
                                    setManual({
                                      ...manual,
                                      [h]: {
                                        ...manual[h],
                                        [s]: e.target.value,
                                      },
                                    })
                                  }
                                />
                              ) : allowed ? (
                                money(calc.matrix[h][s])
                              ) : (
                                <span aria-label="Not permitted">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td>
                          {money(
                            calc.rows.find(
                              (r) => r.group === "A" && r.head === h,
                            ).cashTax,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Credit balance after payment</th>
                      {HEADS.map((h) => (
                        <td key={h}>{money(calc.creditClosing[h])}</td>
                      ))}
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              {errors.length > 0 && (
                <div className="validation-errors" role="alert">
                  <strong>Resolve the allocation before proceeding</strong>
                  <ul>
                    {errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="table-note">
                <Icon name="info" size={16} />
                <span>
                  IGST credit is used first. CGST and SGST credit cannot be used
                  against each other. From February 2026, either credit may be
                  used first against residual IGST.
                </span>
              </div>
            </section>
            <section className="ledger-links">
              <button
                onClick={() => {
                  changeTab("ledgers");
                }}
              >
                <span className="link-icon">
                  <Icon name="wallet" size={22} />
                </span>
                <div>
                  <strong>Electronic cash & credit ledgers</strong>
                  <span>View available balances and payment entries</span>
                </div>
                <Icon name="arrow" />
              </button>
              <button onClick={() => show("negative")}>
                <span className="link-icon">
                  <Icon name="file" size={22} />
                </span>
                <div>
                  <strong>Negative Liability Statement</strong>
                  <span>View tax adjustments and carried balances</span>
                </div>
                <Icon name="arrow" />
              </button>
            </section>
            <div className="bottom-actions">
              <button className="secondary" onClick={() => show("preview")}>
                <Icon name="file" size={16} />
                Preview return
              </button>
              <div>
                {!locked && (
                  <>
                    <button
                      className="secondary"
                      disabled={outstanding === 0 || errors.length > 0}
                      onClick={() => show("challan")}
                    >
                      Create Challan
                    </button>
                    <button
                      className="primary"
                      disabled={outstanding > 0 || errors.length > 0}
                      onClick={() => show("offset")}
                    >
                      Make Payment / Post Credit to Ledger{" "}
                      <Icon name="arrow" size={16} />
                    </button>
                  </>
                )}
                {locked && (
                  <button
                    className="primary"
                    onClick={() => changeTab("filing")}
                  >
                    {filed ? "View filed return" : "Proceed to File"}
                    <Icon name="arrow" size={16} />
                  </button>
                )}
              </div>
            </div>
            <p className="action-hint">
              {locked
                ? "Payment is posted. The return and ledger debit are locked."
                : outstanding
                  ? "Deposit the additional cash required before posting the payment."
                  : "Review the allocation before posting. Payment can be posted only once."}
            </p>
          </>
        )}
        {tab === "ledgers" && <LedgerView ws={ws} calc={calc} />}
        {tab === "filing" && (
          <section className="panel filing-panel">
            <div className="panel-heading">
              <div>
                <h3>{filed ? "Return filed successfully" : "Verification"}</h3>
                <p>
                  {filed
                    ? "Your practice return and acknowledgement are ready."
                    : "Complete the declaration and verify using a practice EVC."}
                </p>
              </div>
              <Icon name={filed ? "check" : "lock"} size={24} />
            </div>
            <div className="filing-body">
              {!locked ? (
                <>
                  <div className="notice">
                    <Icon name="info" />
                    Complete the tax payment and post credit to the ledger
                    before filing.
                  </div>
                  <button
                    className="primary"
                    onClick={() => changeTab("payment")}
                  >
                    Go to Payment
                  </button>
                </>
              ) : filed ? (
                <>
                  <div className="filed-success">
                    <span>
                      <Icon name="check" size={32} />
                    </span>
                    <h3>GSTR-3B filed · Practice acknowledgement</h3>
                    <p>
                      {periodLabel} · {ws.gstin}
                    </p>
                  </div>
                  <dl className="receipt-details">
                    <div>
                      <dt>Acknowledgement reference</dt>
                      <dd>
                        {ws.receipt?.arn ||
                          ws.receipt?.reference ||
                          ws.receipt?.id}
                      </dd>
                    </div>
                    <div>
                      <dt>Filed on</dt>
                      <dd>
                        {date(ws.receipt?.filedAt || ws.receipt?.createdAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>Filed · simulation</dd>
                    </div>
                  </dl>
                  <p className="hint">
                    This is a training acknowledgement. No return was submitted
                    to the GST portal.
                  </p>
                  <div className="button-row">
                    <button
                      className="primary"
                      onClick={() =>
                        download(
                          `PRACTICE-GSTR3B-${ws.period}.json`,
                          snapshot(),
                        )
                      }
                    >
                      <Icon name="download" size={16} />
                      Download filed return
                    </button>
                    <button
                      className="secondary"
                      onClick={() => show("preview")}
                    >
                      Print acknowledgement
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="notice success">
                    <Icon name="check" />
                    Tax payment has been posted. No further debit will be made
                    during filing.
                  </div>
                  <label className="declaration">
                    <input
                      type="checkbox"
                      checked={declaration}
                      onChange={(e) => setDeclaration(e.target.checked)}
                    />
                    <span>
                      I hereby solemnly affirm and declare that the information
                      given herein is true and correct to the best of my
                      knowledge and belief and nothing has been concealed
                      therefrom. <small>Practice declaration only.</small>
                    </span>
                  </label>
                  <label className="signatory-field">
                    Authorised Signatory <b>*</b>
                    <select
                      value={signatoryId}
                      onChange={(e) => setSignatory(e.target.value)}
                    >
                      <option value="">Select an authorised signatory</option>
                      {ws.partA.signatories.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="hint">
                    A six-digit practice code will be shown on screen. No real
                    email, SMS or filing takes place.
                  </p>
                  <button
                    className="primary"
                    disabled={!declaration || !signatoryId}
                    onClick={startEvc}
                  >
                    File GSTR-3B with EVC <Icon name="arrow" size={16} />
                  </button>
                </>
              )}
            </div>
          </section>
        )}
        {!embedded && (
          <footer className="page-footer">
            <span>GST Practice Portal · Independent learning environment</span>
            <span>Amounts in INR · All times IST</span>
          </footer>
        )}
      </main>
      {modal && (
        <Modal
          title={
            {
              parta: "Prepared Return · Part A",
              rules: "ITC Utilisation · Rule 88A",
              help: "Help & Official References",
              negative: "Negative Liability Statement",
              challan: "Create Practice Challan",
              challans: "Practice Challan History",
              offset: "Confirm Payment & Ledger Posting",
              evc: "Verify with EVC",
              preview: "GSTR-3B · Practice Return Preview",
            }[modal]
          }
          wide={["parta", "negative", "preview", "challans"].includes(modal)}
          onClose={() => setModal(null)}
        >
          {(error || storageError) && (
            <div className="alert error" role="alert">
              <Icon name="info" />
              <span>{storageError || error}</span>
            </div>
          )}
          {modal === "parta" && (
            <PreparedReturn
              ws={ws}
              onClose={() => setModal(null)}
              onSave={(p) => {
                if (
                  run(
                    () => updatePartA(ws, p),
                    "Prepared return saved. Payment has been recalculated.",
                  )
                ) {
                  setManual(null);
                  setModal(null);
                }
              }}
            />
          )}
          {modal === "rules" && (
            <>
              <ol className="rules-list">
                <li>
                  IGST credit pays IGST first. Use remaining IGST credit against
                  CGST and SGST / UTGST in any proportion.
                </li>
                <li>
                  Exhaust usable IGST credit before using CGST or SGST credit.
                </li>
                <li>
                  CGST credit pays CGST first, then IGST. SGST credit pays SGST
                  first, then IGST. These credits cannot pay each other.
                </li>
                <li>
                  For return periods from February 2026, use CGST and SGST
                  credit against residual IGST in either order.
                </li>
                <li>
                  Cess credit pays only Cess. Reverse charge, section 9(5)
                  liability, interest and late fee require cash.
                </li>
              </ol>
              <p className="hint">
                Auto set-off considers available own-head credit to avoid an
                unnecessary cash payment. You may edit the allocation within
                these rules.
              </p>
              <a
                className="external-link"
                href="https://cbic-gst.gov.in/pdf/Circular-98-17-2019-GST.pdf"
                target="_blank"
                rel="noreferrer"
              >
                CBIC Circular 98/17/2019 ↗
              </a>
            </>
          )}
          {modal === "help" && (
            <>
              <p>Practice the payment and filing sequence:</p>
              <ol className="rules-list">
                <li>Review Part A and Table 6.1.</li>
                <li>Review the ITC set-off and cash shortfall.</li>
                <li>Create and simulate payment of a challan where needed.</li>
                <li>
                  Post the payment once, then complete the declaration and EVC.
                </li>
              </ol>
              <div className="notice">
                <Icon name="info" />
                Practice data is saved in this browser and scoped to the GSTIN
                and period. Download a return for your records.
              </div>
              <p>
                This module follows published payment rules. Exact 2026 screen
                appearance has not been verified against an authenticated portal
                session.
              </p>
              <div className="resource-links">
                <a
                  href="https://tutorial.gst.gov.in/userguide/returns/GSTR3B.htm"
                  target="_blank"
                  rel="noreferrer"
                >
                  GST Portal · GSTR-3B user guide ↗
                </a>
                <a
                  href="https://cbic-gst.gov.in/pdf/Circular-98-17-2019-GST.pdf"
                  target="_blank"
                  rel="noreferrer"
                >
                  CBIC · Rule 88A circular ↗
                </a>
                <a
                  href="https://www.mahagst.gov.in/public/uploads/gstnadvisory/1771847857_395.%20Advisory%20on%20Interest%20Collection%20and%20Related%20Enhancements%20in%20GSTR-3B.pdf"
                  target="_blank"
                  rel="noreferrer"
                >
                  GSTN · February 2026 advisory ↗
                </a>
              </div>
            </>
          )}
          {modal === "negative" && <NegativeTable ws={ws} calc={calc} />}
          {modal === "challan" && (
            <>
              <p>
                Deposit the cash shortfall under the corresponding tax and minor
                heads.
              </p>
              <CashTable amounts={calc.cashShortfall} />
              <div className="amount-total">
                <span>Practice challan amount</span>
                <strong>₹{money(outstanding)}</strong>
              </div>
              <div className="notice">
                <Icon name="info" />
                This creates a simulated challan. It does not open a bank or
                accept money.
              </div>
              <div className="modal-actions">
                <button className="secondary" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={!outstanding || errors.length > 0}
                  onClick={generateChallan}
                >
                  Generate Practice Challan
                </button>
              </div>
            </>
          )}
          {modal === "challans" && (
            <>
              <p>
                Pending challans credit the cash ledger only after simulated
                payment.
              </p>
              {!ws.challans.length ? (
                <div className="empty-state">
                  <Icon name="file" size={32} />
                  <h3>No practice challans</h3>
                  <p>Create a challan when the cash ledger has a shortfall.</p>
                </div>
              ) : (
                ws.challans.map((c) => (
                  <div className="challan-card" key={c.id}>
                    <div>
                      <strong>{c.id}</strong>
                      <span
                        className={
                          "status " + (c.status === "paid" ? "filed" : "draft")
                        }
                      >
                        {c.status === "paid" ? "Paid · simulated" : "Pending"}
                      </span>
                    </div>
                    <CashTable amounts={c.amounts} />
                    {c.status !== "paid" && (
                      <button
                        className="primary"
                        onClick={() =>
                          run(
                            () => markChallanPaid(ws, c.id),
                            "Simulated payment received. The cash ledger has been credited once.",
                          )
                        }
                      >
                        Simulate successful payment
                      </button>
                    )}
                  </div>
                ))
              )}
            </>
          )}
          {modal === "offset" && (
            <>
              <div className="notice">
                <Icon name="lock" />
                Posting locks the payment calculation and prepared return for
                this period.
              </div>
              <dl className="confirm-values">
                <div>
                  <dt>Credit ledger debit</dt>
                  <dd>₹{money(calc.totals.itcUsed)}</dd>
                </div>
                <div>
                  <dt>Cash ledger debit</dt>
                  <dd>₹{money(calc.totals.cashRequired)}</dd>
                </div>
                <div>
                  <dt>Balance tax after payment</dt>
                  <dd>₹0.00</dd>
                </div>
              </dl>
              <p>
                Review the return and allocation before proceeding. This
                practice posting is recorded once.
              </p>
              <div className="modal-actions">
                <button className="secondary" onClick={() => setModal(null)}>
                  Review payment
                </button>
                <button
                  className="primary"
                  disabled={outstanding > 0 || errors.length > 0}
                  onClick={() => {
                    if (
                      run(
                        () =>
                          offsetLiabilities(ws, {
                            order,
                            allocation: allocation || null,
                          }),
                        "Payment posted successfully. Proceed to verification and filing.",
                      )
                    ) {
                      setModal(null);
                      changeTab("filing");
                    }
                  }}
                >
                  Confirm & Post
                </button>
              </div>
            </>
          )}
          {modal === "evc" && (
            <>
              <p>
                Verify the return using the code generated for the selected
                authorised signatory.
              </p>
              <div className="evc-code">
                <span>SIMULATED EVC · NO MESSAGE SENT</span>
                <strong>{ws.challenge?.code}</strong>
                <small>
                  <Icon name="clock" size={13} />
                  {seconds
                    ? `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                    : "Code expired. Generate a new code."}
                </small>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    run(
                      () =>
                        verifyEvc(ws, {
                          code: otp,
                          challengeId: ws.challenge?.id,
                        }),
                      "Practice GSTR-3B filed successfully.",
                    )
                  ) {
                    setModal(null);
                    changeTab("filing");
                  }
                }}
              >
                <label className="signatory-field">
                  Enter One Time Password
                  <input
                    aria-label="Enter EVC code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                </label>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={startEvc}
                  >
                    Generate new code
                  </button>
                  <button
                    className="primary"
                    disabled={otp.length !== 6 || !seconds}
                  >
                    Verify & File
                  </button>
                </div>
              </form>
            </>
          )}
          {modal === "preview" && (
            <div className="print-return">
              <div className="print-heading">
                <strong>FORM GSTR-3B · PRACTICE ONLY</strong>
                <span>
                  {periodLabel} · {ws.gstin}
                </span>
                <span>{ws.partA.legalName}</span>
              </div>
              <dl className="confirm-values">
                <div>
                  <dt>Net tax payable</dt>
                  <dd>₹{money(calc.totals.netTax)}</dd>
                </div>
                <div>
                  <dt>
                    {locked
                      ? "Paid through input tax credit"
                      : "Proposed input tax credit"}
                  </dt>
                  <dd>₹{money(calc.totals.itcUsed)}</dd>
                </div>
                <div>
                  <dt>
                    {locked ? "Tax paid in cash" : "Tax to be paid in cash"}
                  </dt>
                  <dd>₹{money(calc.totals.cashTax)}</dd>
                </div>
                <div>
                  <dt>Interest and late fee in cash</dt>
                  <dd>
                    ₹{safeMoneySum([calc.totals.interest, calc.totals.lateFee])}
                  </dd>
                </div>
              </dl>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Category / Tax head</th>
                      <th>Gross liability</th>
                      <th>Adjustment</th>
                      <th>Net tax</th>
                      <th>ITC</th>
                      <th>Cash tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calc.rows.map((r) => (
                      <tr key={r.group + r.head}>
                        <th>
                          {r.group} · {SHORT[r.head]}
                        </th>
                        {[
                          r.gross,
                          r.negativeAdjusted,
                          r.net,
                          sum(r.itc),
                          r.cashTax,
                        ].map((n, i) => (
                          <td key={i}>{money(n)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ws.receipt && (
                <p>
                  <strong>Practice acknowledgement:</strong>{" "}
                  {ws.receipt.arn || ws.receipt.reference || ws.receipt.id}
                </p>
              )}
              <p className="hint">
                {locked
                  ? "Payment posted."
                  : "Draft allocation. Payment has not been posted."}{" "}
                {filed
                  ? "Filed in this practice environment."
                  : "Return not filed."}{" "}
                All references are simulated.
              </p>
              <div className="modal-actions">
                <button
                  className="secondary"
                  onClick={() =>
                    download(`PRACTICE-GSTR3B-${ws.period}.json`, snapshot())
                  }
                >
                  <Icon name="download" size={16} />
                  Download JSON
                </button>
                <button className="primary" onClick={() => window.print()}>
                  Print / Save PDF
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
function CashTable({ amounts }) {
  return (
    <div className="table-scroll">
      <table className="cash-table">
        <thead>
          <tr>
            <th>Tax head</th>
            {MINORS.map((m) => (
              <th key={m}>{MINOR_LABEL[m]}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {HEADS.map((h) => (
            <tr key={h}>
              <th>{SHORT[h]}</th>
              {MINORS.map((m) => (
                <td key={m}>{money(amounts?.[m]?.[h])}</td>
              ))}
              <td>
                {money(
                  MINORS.reduce((n, m) => n + (amounts?.[m]?.[h] || 0), 0),
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function NegativeTable({ ws, calc }) {
  return (
    <>
      <div className="notice">
        <Icon name="info" />
        View only. Negative liability adjusts the same tax head and category in
        subsequent returns; it is separate from cash and ITC.
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Category / Tax head</th>
              <th>Opening balance</th>
              <th>Used this return</th>
              <th>New negative liability</th>
              <th>Closing / carry forward</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.flatMap((g) =>
              HEADS.map((h) => {
                const row = calc.rows.find(
                  (r) => r.group === g && r.head === h,
                );
                return (
                  <tr key={g + h}>
                    <th>
                      {g} · {SHORT[h]}
                    </th>
                    <td>{money(ws.opening.negative?.[g]?.[h])}</td>
                    <td>{money(row.negativeAdjusted)}</td>
                    <td>{money(Math.max(0, -row.gross))}</td>
                    <td>{money(calc.negativeClosing[g][h])}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {ws.status === "draft"
          ? "Closing balances are provisional until payment is posted."
          : "Closing balances were recorded when payment was posted."}
      </p>
    </>
  );
}
export function LedgerView({ ws, calc }) {
  const [kind, setKind] = useState("cash");
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>Ledger balances & transactions</h3>
          <p>
            Balances for {ws.gstin} · {ws.period}
          </p>
        </div>
        <span className="rupee-note">All amounts in ₹</span>
      </div>
      <div className="ledger-tabs" role="tablist" aria-label="Ledger type">
        {[
          ["cash", "Electronic Cash Ledger"],
          ["credit", "Electronic Credit Ledger"],
          ["liability", "Liability Register"],
          ["negative", "Negative Liability"],
        ].map(([id, label]) => (
          <button
            role="tab"
            aria-selected={kind === id}
            className={kind === id ? "active" : ""}
            key={id}
            onClick={() => setKind(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ledger-content">
        {kind === "cash" && (
          <>
            <h4>Available cash balance</h4>
            <CashTable amounts={ws.balances.cash} />
            <p className="hint">
              Cash is maintained by tax head and minor head. A tax deposit does
              not cover interest or late fee automatically.
            </p>
          </>
        )}
        {kind === "credit" && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Credit source</th>
                  <th>Opening ITC</th>
                  <th>ITC from Part A</th>
                  <th>Posted utilisation</th>
                  <th>Available balance</th>
                </tr>
              </thead>
              <tbody>
                {HEADS.map((h) => (
                  <tr key={h}>
                    <th>{SHORT[h]}</th>
                    <td>{money(ws.opening.credit[h])}</td>
                    <td>{money(ws.partA.itc[h])}</td>
                    <td>
                      {money(ws.status === "draft" ? 0 : calc.creditUsed[h])}
                    </td>
                    <td>{money(ws.balances.credit[h])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {kind === "negative" && <NegativeTable ws={ws} calc={calc} />}{" "}
        {kind === "liability" && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Category / Tax head</th>
                  <th>Net tax</th>
                  <th>Discharged through ITC</th>
                  <th>Discharged through cash</th>
                  <th>Outstanding tax</th>
                </tr>
              </thead>
              <tbody>
                {calc.rows.map((r) => (
                  <tr key={r.group + r.head}>
                    <th>
                      {r.group} · {SHORT[r.head]}
                    </th>
                    <td>{money(r.net)}</td>
                    <td>{money(ws.status === "draft" ? 0 : sum(r.itc))}</td>
                    <td>{money(ws.status === "draft" ? 0 : r.cashTax)}</td>
                    <td>{money(ws.status === "draft" ? r.net : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              Interest: ₹{money(calc.totals.interest)} · Late fee: ₹
              {money(calc.totals.lateFee)} ·{" "}
              {ws.status === "draft"
                ? "Unpaid"
                : "Discharged through cash ledger"}
            </p>
          </div>
        )}
        <div className="ledger-history">
          <h4>Posting history</h4>
          {!ws.ledger.length ? (
            <p className="hint">
              No ledger postings yet. Challan payments and the final offset will
              appear here.
            </p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Reference / date</th>
                    <th>Entry</th>
                    <th>Amount (₹)</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {ws.ledger
                    .filter((entry) => entry.ledger === kind)
                    .map((entry, i) => {
                      const flatten = (o) =>
                        Object.values(o || {}).flatMap((v) =>
                          typeof v === "number" ? [v] : flatten(v),
                        );
                      const values =
                        entry.ledger === "liability"
                          ? [entry.amounts.itc || 0, entry.amounts.cash || 0]
                          : flatten(entry.amounts);
                      return (
                        <tr key={entry.id || i}>
                          <th>
                            <span>{entry.reference || entry.id || i + 1}</span>
                            <small className="entry-date">
                              {date(entry.at)}
                            </small>
                          </th>
                          <td>
                            {entry.ledger} · {entry.direction}
                          </td>
                          <td>{safeMoneySum(values)}</td>
                          <td>
                            {entry.description ||
                              "Recorded in this practice workspace"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
