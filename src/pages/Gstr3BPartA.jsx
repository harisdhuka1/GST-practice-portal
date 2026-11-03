import React, { useState } from "react";
import { HEADS, formatMoney, toPaise } from "../gst/paymentEngine.js";
import {
  getPeriod,
  gstr1Totals,
  preparePartA,
  savePartAAdjustments,
  computeGstr2b,
  taxForRecord,
} from "../gst/portalStore.js";
const labels = {
  igst: "Integrated Tax",
  cgst: "Central Tax",
  sgst: "State / UT Tax",
  cess: "Cess",
};
const money = (n) => formatMoney(n || 0);
export default function Gstr3BPartA({
  state,
  onChange,
  onNavigate,
  paymentWorkspace,
}) {
  const data = getPeriod(state),
    totals = gstr1Totals(state),
    inward = computeGstr2b(state),
    locked =
      !!data.paymentLock ||
      !!data.filing ||
      paymentWorkspace?.status === "offset" ||
      paymentWorkspace?.status === "filed";
  const [raw, setRaw] = useState(() =>
      Object.fromEntries(
        ["rcm", "itcReversal", "interest", "lateFee"].map((k) => [
          k,
          Object.fromEntries(
            HEADS.map((h) => [
              h,
              money(data.adjustments[k]?.[h]).replaceAll(",", ""),
            ]),
          ),
        ]),
      ),
    ),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const dirty =
    JSON.stringify(raw) !==
    JSON.stringify(
      Object.fromEntries(
        ["rcm", "itcReversal", "interest", "lateFee"].map((k) => [
          k,
          Object.fromEntries(
            HEADS.map((h) => [
              h,
              money(data.adjustments[k]?.[h]).replaceAll(",", ""),
            ]),
          ),
        ]),
      ),
    );
  let prepared,
    readiness = "";
  try {
    prepared =
      paymentWorkspace?.status !== "draft" && paymentWorkspace?.offset
        ? paymentWorkspace.partA
        : preparePartA(state);
  } catch (e) {
    readiness = e.message;
  }
  const save = () => {
    try {
      const adjustment = Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [
          k,
          Object.fromEntries(
            HEADS.map((h) => {
              const value = toPaise(v[h]);
              if (value < 0)
                throw Error(
                  "Assessed charges and reversals cannot be negative.",
                );
              return [h, value];
            }),
          ),
        ]),
      );
      if (onChange(savePartAAdjustments(state, adjustment)) === false)
        throw Error("The assessed amounts could not be saved.");
      setError("");
      setMessage(
        "Assessed amounts saved. The payment figures have been updated.",
      );
    } catch (e) {
      setError(e.message);
    }
  };
  const by = totals.byTable,
    zero = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }),
    add = (values) =>
      values.reduce(
        (a, b) =>
          Object.fromEntries(
            Object.keys(a).map((k) => [k, a[k] + (b?.[k] || 0)]),
          ),
        zero(),
      );
  const classified = {
    ordinary: zero(),
    exports: zero(),
    nil: zero(),
    nonGst: zero(),
  };
  for (const record of data.gstr1.records) {
    if (
      ["hsn", "documents", "ecommerce", "ecommerce95"].includes(record.tableId)
    )
      continue;
    const original = record.originalId
      ? state.periods[record.originalPeriod]?.gstr1.records.find(
          (r) => r.id === record.originalId,
        )
      : null;
    const base = original || record;
    const category =
      base.tableId === "exports"
        ? "exports"
        : base.tableId === "nil"
          ? base.exemptionType === "non-gst"
            ? "nonGst"
            : "nil"
          : "ordinary";
    let tax = taxForRecord(state, record);
    if (base.reverseCharge)
      tax = { ...tax, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    classified[category] = add([classified[category], tax]);
  }
  const rows = [
    [
      "(a) Outward taxable supplies (other than zero rated, nil rated and exempted)",
      classified.ordinary,
    ],
    ["(b) Outward taxable supplies (zero rated)", classified.exports],
    ["(c) Other outward supplies (nil rated and exempted)", classified.nil],
    [
      "(d) Inward supplies liable to reverse charge",
      {
        taxable: inward.rcmSummary?.taxable || 0,
        ...Object.fromEntries(
          HEADS.map((h) => [
            h,
            (inward.rcmSummary?.[h] || 0) + (data.adjustments.rcm[h] || 0),
          ]),
        ),
      },
    ],
    ["(e) Non-GST outward supplies", classified.nonGst],
  ];
  const snapshot = data.gstr2b;
  const itc = snapshot?.itc || Object.fromEntries(HEADS.map((h) => [h, 0]));
  const creditCategory = (allowed) =>
    Object.fromEntries(
      HEADS.map((h) => [
        h,
        (snapshot?.eligibleRecords || [])
          .filter((r) => allowed.includes(r.category || "B2B"))
          .reduce(
            (n, r) =>
              n +
              (r.documentType === "credit-note"
                ? -(r.itcReduction?.[h] ?? r[h] ?? 0)
                : r[h] || 0),
            0,
          ),
      ]),
    );
  const imports = creditCategory(["IMPG", "IMPGSEZ"]),
    services = creditCategory(["IMPS"]),
    isd = creditCategory(["ISD"]);
  const ordinaryCredit = Object.fromEntries(
    HEADS.map((h) => [h, itc[h] - imports[h] - services[h] - isd[h]]),
  );
  const interstate = {};
  for (const record of data.gstr1.records) {
    const base = record.originalId
      ? state.periods[record.originalPeriod]?.gstr1.records.find(
          (r) => r.id === record.originalId,
        )
      : record;
    if (
      !base ||
      !["b2cl", "b2cs", "cdnur"].includes(base.tableId) ||
      base.pos === state.taxpayer.stateCode
    )
      continue;
    const tax = taxForRecord(state, record);
    interstate[base.pos] ||= zero();
    interstate[base.pos] = add([interstate[base.pos], tax]);
  }
  return (
    <div className="parta-page">
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
      {locked && (
        <div className="notice success">
          Payment has been posted for this period. Part A and its source returns
          are locked.{data.filing ? " GSTR-3B is filed." : ""}
        </div>
      )}
      {readiness && (
        <div className="prerequisite-card">
          <strong>Complete the source returns to prepare payment</strong>
          <p>{readiness}</p>
          <div className="button-row">
            <button className="secondary" onClick={() => onNavigate("gstr1")}>
              Open GSTR-1
            </button>
            <button className="secondary" onClick={() => onNavigate("gstr2b")}>
              Open GSTR-2B
            </button>
          </div>
        </div>
      )}
      <div className="source-badges">
        <span>
          GSTR-1 <b>{data.gstr1.status === "filed" ? "Filed ✓" : "Draft"}</b>
        </span>
        <span>
          GSTR-2B{" "}
          <b>
            {!data.gstr2b
              ? "Not generated"
              : data.gstr2b.sourceVersion === data.ims.version
                ? "Current ✓"
                : "Recompute required"}
          </b>
        </span>
        <span>
          Payment <b>{locked ? "Posted ✓" : "Not posted"}</b>
        </span>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>
              <span className="table-number">3.1</span> Details of outward
              supplies and inward supplies liable to reverse charge
            </h3>
            <p>
              Output supplies are carried from the filed GSTR-1. Additional
              reverse charge is assessed below.
            </p>
          </div>
          <span className="rupee-note">All amounts in ₹</span>
        </div>
        <div className="table-scroll">
          <table className="parta-table">
            <thead>
              <tr>
                <th>Nature of supplies</th>
                <th>Total taxable value</th>
                {HEADS.map((h) => (
                  <th key={h}>{labels[h]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, tax]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>{money(tax.taxable)}</td>
                  {HEADS.map((h) => (
                    <td key={h}>{money(tax[h])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>
              <span className="table-number">3.1.1</span> Supplies notified
              under section 9(5)
            </h3>
            <p>
              Tax payable by the electronic commerce operator is included in
              payment category B.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="parta-table">
            <thead>
              <tr>
                <th>Nature of supplies</th>
                <th>Taxable value</th>
                {HEADS.map((h) => (
                  <th key={h}>{labels[h]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>(i) Tax payable by electronic commerce operator</th>
                <td>{money(by.ecommerce95?.taxable)}</td>
                {HEADS.map((h) => (
                  <td key={h}>{money(by.ecommerce95?.[h])}</td>
                ))}
              </tr>
              <tr>
                <th>
                  (ii) Supplies through an operator on which the operator pays
                  tax
                </th>
                <td>
                  {money(
                    data.gstr1.records
                      .filter(
                        (r) => r.tableId === "ecommerce" && r.subType === "14b",
                      )
                      .reduce((n, r) => n + r.taxable, 0),
                  )}
                </td>
                {HEADS.map((h) => (
                  <td key={h}>—</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>
              <span className="table-number">3.2</span> Inter-state supplies to
              unregistered persons
            </h3>
            <p>Break-up of applicable outward supplies by place of supply.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Place of supply</th>
                <th>Taxable value</th>
                <th>Integrated tax</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(interstate).length ? (
                Object.entries(interstate).map(([pos, tax]) => (
                  <tr key={pos}>
                    <th>State code {pos}</th>
                    <td>{money(tax.taxable)}</td>
                    <td>{money(tax.igst)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="3" className="hint">
                    No applicable inter-state unregistered supplies in this
                    return.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>
              <span className="table-number">4</span> Eligible Input Tax Credit
            </h3>
            <p>
              Computed from the current GSTR-2B snapshot, after the recipient's
              IMS actions.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="parta-table">
            <thead>
              <tr>
                <th>Details</th>
                {HEADS.map((h) => (
                  <th key={h}>{labels[h]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="parta-net">
                <th>(A) Available ITC from eligible inward documents</th>
                {HEADS.map((h) => (
                  <td key={h}>{money(itc[h])}</td>
                ))}
              </tr>
              {[
                ["(1) Import of goods", imports],
                [
                  "(2) Import of services — assessed eligible documents",
                  services,
                ],
                [
                  "(3) Inward reverse charge — no automatic credit claim",
                  zero(),
                ],
                ["(4) Inward supplies from ISD", isd],
                [
                  "(5) All other ITC — net document adjustments",
                  ordinaryCredit,
                ],
              ].map(([label, credit]) => (
                <tr key={label}>
                  <th>{label}</th>
                  {HEADS.map((h) => (
                    <td key={h}>{money(credit[h])}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th>(B) Assessed ITC reversals</th>
                {HEADS.map((h) => (
                  <td key={h}>{money(data.adjustments.itcReversal?.[h])}</td>
                ))}
              </tr>
              <tr className="parta-net">
                <th>(C) Net ITC available</th>
                {HEADS.map((h) => (
                  <td key={h}>
                    {money(
                      prepared?.itc?.[h] ??
                        itc[h] - (data.adjustments.itcReversal?.[h] || 0),
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <th>
                  (D) ITC unavailable (section 16(4) / place of supply
                  restrictions)
                </th>
                {HEADS.map((h) => (
                  <td key={h}>{money(inward.ineligibleSummary?.[h])}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="table-note">
          Imports, ISD and ordinary inward documents retain their categories in
          GSTR-2B. Reverse-charge credit is not automatically claimed from an
          unpaid cash liability.
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Assessed amounts & reversals</h3>
            <p>
              Enter additional reverse charge and already assessed charges. All
              figures are in rupees.
            </p>
          </div>
          {!locked && (
            <button
              className="secondary small"
              disabled={!dirty}
              onClick={save}
            >
              Save assessed amounts
            </button>
          )}
        </div>
        <div className="table-scroll">
          <table className="parta-input-table">
            <thead>
              <tr>
                <th>Amount to assess</th>
                {HEADS.map((h) => (
                  <th key={h}>{labels[h]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["rcm", "Additional RCM not included in GSTR-2B"],
                ["itcReversal", "ITC to reverse"],
                ["interest", "5.1 Interest payable in cash"],
                ["lateFee", "Late fee payable in cash"],
              ].map(([key, label]) => (
                <tr key={key}>
                  <th>{label}</th>
                  {HEADS.map((h) => (
                    <td key={h}>
                      <input
                        aria-label={`${label} ${labels[h]} in rupees`}
                        inputMode="decimal"
                        disabled={locked}
                        value={raw[key][h]}
                        onChange={(e) =>
                          setRaw({
                            ...raw,
                            [key]: { ...raw[key], [h]: e.target.value },
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
        <div className="table-note">
          Additional RCM is added to reverse-charge tax already present in
          GSTR-2B. Interest, exemptions, late-fee caps and special mandatory
          cash restrictions are assessed inputs in this training module. They
          are not calculated from real taxpayer records.
        </div>
      </section>
      <div className="parta-payment-summary">
        <div>
          <span>Net tax for payment</span>
          <strong>
            ₹
            {money(
              prepared
                ? Object.values(prepared.liabilities.A)
                    .concat(Object.values(prepared.liabilities.B))
                    .reduce((n, v) => n + Math.max(0, v), 0)
                : 0,
            )}
          </strong>
        </div>
        <div>
          <span>Net eligible ITC</span>
          <strong>
            ₹
            {money(
              prepared
                ? Object.values(prepared.itc).reduce((n, v) => n + v, 0)
                : 0,
            )}
          </strong>
        </div>
        <button
          className="primary"
          disabled={(!prepared || dirty) && !locked}
          onClick={() => onNavigate("payment")}
        >
          {locked ? "View Payment / Filed Return" : "Proceed to Payment"} →
        </button>
      </div>
      {dirty && (
        <p className="hint unsaved-label">
          Save your assessed amount changes before proceeding to payment.
        </p>
      )}
    </div>
  );
}
