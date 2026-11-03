import React, { useState } from "react";
import {
  getPeriod,
  updateSelectedPeriod,
  gstr1Totals,
  computeGstr2b,
} from "../gst/portalStore.js";
import { formatMoney } from "../gst/paymentEngine.js";
export const periodName = (value) =>
  new Date(value + "-01T12:00:00Z").toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
export default function ReturnDashboard({ state, onChange, onNavigate }) {
  const data = getPeriod(state),
    outward = gstr1Totals(state),
    inward = computeGstr2b(state),
    [chosen, setChosen] = useState(state.selectedPeriod),
    [error, setError] = useState("");
  const stale = !!data.gstr2b && data.gstr2b.sourceVersion !== data.ims.version;
  const choose = (e) => {
    e.preventDefault();
    try {
      if (onChange(updateSelectedPeriod(state, chosen)) === false)
        throw Error("The return period could not be saved.");
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      <section className="panel period-selector">
        <div>
          <h3>File Returns</h3>
          <p>Select the financial year and return period to begin.</p>
        </div>
        <form onSubmit={choose}>
          <label>
            Financial Year
            <select
              aria-label="Financial year"
              value={
                Number(chosen.slice(5, 7)) >= 4
                  ? chosen.slice(0, 4)
                  : String(Number(chosen.slice(0, 4)) - 1)
              }
              onChange={(e) => setChosen(e.target.value + "-09")}
            >
              {["2025", "2026", "2027"].map((y) => (
                <option value={y} key={y}>
                  {y}–{String(Number(y) + 1).slice(2)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Return Filing Period
            <select
              aria-label="Return filing period"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
            >
              {Array.from({ length: 12 }, (_, i) => {
                const fy =
                  Number(chosen.slice(5, 7)) >= 4
                    ? Number(chosen.slice(0, 4))
                    : Number(chosen.slice(0, 4)) - 1;
                const month = ((i + 3) % 12) + 1,
                  y = i < 9 ? fy : fy + 1,
                  v = `${y}-${String(month).padStart(2, "0")}`;
                return (
                  <option key={v} value={v}>
                    {periodName(v)}
                  </option>
                );
              })}
            </select>
          </label>
          <button className="primary" type="submit">
            Search
          </button>
        </form>
      </section>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="dashboard-section-title">
        <div>
          <span className="eyebrow">RETURNS WORKSPACE</span>
          <h3>{periodName(state.selectedPeriod)}</h3>
        </div>
        <span className={"status " + (data.filing ? "filed" : "draft")}>
          {data.filing ? "GSTR-3B Filed" : "Return preparation in progress"}
        </span>
      </div>
      <section className="dashboard-tiles">
        {[
          [
            "GSTR-1",
            "Details of outward supplies of goods or services",
            data.gstr1.status === "filed" ? "Filed" : "Not filed",
            "gstr1",
            "15 practice sections",
            `${outward.recordCount} records`,
          ],
          [
            "Invoice Management System",
            "Review documents reported by your suppliers",
            data.paymentLock ? "Locked for this return" : "Available",
            "ims",
            "Inward invoice actions",
            `${inward.records.length} documents`,
          ],
          [
            "GSTR-2B",
            "Auto-drafted input tax credit statement",
            !data.gstr2b
              ? "Not generated"
              : stale
                ? "Recompute required"
                : "Generated",
            "gstr2b",
            "Read-only credit statement",
            data.gstr2b
              ? `ITC ₹${formatMoney(Object.values(data.gstr2b.itc).reduce((a, b) => a + b, 0))}`
              : "Generate after reviewing IMS",
          ],
          [
            "GSTR-3B",
            "Monthly return, tax payment and filing",
            data.filing
              ? "Filed"
              : data.paymentLock
                ? "Payment offset"
                : "Not filed",
            "gstr3b",
            "Part A + Part B",
            data.filing
              ? "Practice acknowledgement available"
              : "Review tax and eligible ITC",
          ],
        ].map(([title, description, status, route, tag, detail], i) => (
          <article className="return-tile" key={route}>
            <div className="return-tile-top">
              <span className="return-type">{i === 1 ? "IMS" : title}</span>
              <span
                className={
                  "status " +
                  (["Filed", "Generated"].includes(status) ? "filed" : "draft")
                }
              >
                {status}
              </span>
            </div>
            <h3>{title}</h3>
            <p>{description}</p>
            <div className="return-tile-meta">
              <span>{tag}</span>
              <strong>{detail}</strong>
            </div>
            <button className="primary" onClick={() => onNavigate(route)}>
              {route === "ims"
                ? "Manage Invoices"
                : route === "gstr2b"
                  ? "View / Generate Statement"
                  : data.filing && route === "gstr3b"
                    ? "View Filed Return"
                    : "Prepare Online"}{" "}
              <span>→</span>
            </button>
          </article>
        ))}
      </section>
      <section className="panel dashboard-checklist">
        <div className="panel-heading">
          <div>
            <h3>Your return journey</h3>
            <p>Each completed step supplies data to the next.</p>
          </div>
        </div>
        {[
          ["GSTR-1 filed", data.gstr1.status === "filed", "gstr1"],
          ["GSTR-2B generated and current", !!data.gstr2b && !stale, "gstr2b"],
          [
            "Liability offset and ledgers posted",
            !!data.paymentLock,
            "payment",
          ],
          ["GSTR-3B filed with practice EVC", !!data.filing, "payment"],
        ].map(([label, done, route], i) => (
          <button
            className="checklist-row"
            key={label}
            onClick={() => onNavigate(route)}
          >
            <span className={done ? "complete" : ""}>{done ? "✓" : i + 1}</span>
            <strong>{label}</strong>
            <small>{done ? "Complete" : "Open step"} →</small>
          </button>
        ))}
      </section>
      <div className="notice">
        This practice workspace keeps the selected taxpayer and period
        consistent across all returns. Filed returns and posted tax payments are
        locked.
      </div>
    </>
  );
}
