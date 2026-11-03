import React, { useCallback, useEffect, useState } from "react";
import HomePage from "./pages/HomePage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ReturnDashboard, { periodName } from "./pages/ReturnDashboard.jsx";
import Gstr1Page from "./pages/Gstr1Page.jsx";
import IMSPage from "./pages/IMSPage.jsx";
import Gstr2BPage from "./pages/Gstr2BPage.jsx";
import Gstr3BPartA from "./pages/Gstr3BPartA.jsx";
import Gstr3B from "./Gstr3B.jsx";
import { LedgerView } from "./components/Gstr3BPaymentPage.jsx";
import {
  createPortal,
  loadPortal,
  savePortal,
  getPeriod,
  preparePartA,
  getOpeningLedgers,
  lockPreparedReturn,
  recordGstr3bFiling,
} from "./gst/portalStore.js";
import {
  createWorkspace,
  loadWorkspace,
  getPaymentInputs,
} from "./gst/practiceStore.js";
import { calculatePayment, emptyHeads } from "./gst/paymentEngine.js";
import { readSession, logoutPractice } from "./gst/practiceAuth.js";
import "./portal.css";
const PUBLIC = ["home", "login", "help"];
const ROUTES = [
  "home",
  "login",
  "dashboard",
  "gstr1",
  "ims",
  "gstr2b",
  "gstr3b",
  "payment",
  "ledgers",
  "help",
];
const TITLES = {
  dashboard: "Returns Dashboard",
  gstr1: "GSTR-1 · Outward Supplies",
  ims: "Invoice Management System",
  gstr2b: "GSTR-2B · Input Tax Credit Statement",
  gstr3b: "GSTR-3B · Prepare Return",
  payment: "GSTR-3B · Payment",
  ledgers: "Electronic Ledgers",
  help: "Help & Taxpayer Facilities",
};
const SUBTITLES = {
  dashboard: "Prepare, reconcile and file your monthly practice returns.",
  gstr1: "Details of outward supplies of goods or services.",
  ims: "Review the inward documents reported by your suppliers.",
  gstr2b: "Review the auto-drafted credit statement before preparing GSTR-3B.",
  gstr3b: "Review your output tax, inward credit and assessed charges.",
  ledgers:
    "Cash, credit, negative liability and payment postings for the selected return.",
  help: "Understand the workflow and find the official reference material.",
};
function currentRoute() {
  const path = location.hash.slice(1);
  return ROUTES.includes(path) ? path : "home";
}
function downloadBackup(state) {
  const payments = Object.keys(state.periods)
    .map((period) => loadWorkspace({ gstin: state.taxpayer.gstin, period }))
    .filter(Boolean);
  const content = {
    label: "PRACTICE ONLY — Fictional GST workspace backup",
    exportedAt: new Date().toISOString(),
    portal: state,
    payments,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "PRACTICE-GST-workspace.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const [state, setState] = useState(() => {
      try {
        const saved = loadPortal();
        if (saved) return saved;
        const fresh = createPortal();
        savePortal(fresh);
        return fresh;
      } catch (e) {
        return { loadError: e.message };
      }
    }),
    [session, setSession] = useState(() => readSession()),
    [route, setRoute] = useState(currentRoute),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [menu, setMenu] = useState(false),
    [afterLogin, setAfterLogin] = useState("dashboard");
  const view = !session && !PUBLIC.includes(route) ? "login" : route;
  const navigate = useCallback(
    (path) => {
      if (!ROUTES.includes(path)) return;
      if (
        dirty &&
        !window.confirm(
          "Your allocation changes are unsaved. Leave this screen?",
        )
      )
        return;
      setDirty(false);
      setMenu(false);
      setError("");
      if (!session && !PUBLIC.includes(path)) {
        setAfterLogin(path);
        path = "login";
      }
      setRoute(path);
      location.hash = path;
      window.scrollTo({ top: 0, behavior: "instant" });
    },
    [session, dirty],
  );
  useEffect(() => {
    const change = () => {
      const path = currentRoute();
      setRoute(path);
      setMenu(false);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (session && !readSession()) {
        setSession(null);
        setRoute("login");
        setError(
          "Your practice session expired. Sign in again to continue; your return data is saved.",
        );
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [session]);
  let payment = null,
    paymentReadError = "";
  if (!state.loadError)
    try {
      payment = loadWorkspace({
        gstin: state.taxpayer.gstin,
        period: state.selectedPeriod,
      });
    } catch (e) {
      paymentReadError = e.message;
    }
  const commit = useCallback(
    (next) => {
      try {
        if (next === state) return true;
        const currentPayment = loadWorkspace({
          gstin: state.taxpayer.gstin,
          period: state.selectedPeriod,
        });
        if (
          currentPayment &&
          currentPayment.status !== "draft" &&
          next.selectedPeriod === state.selectedPeriod
        ) {
          for (const field of ["gstr1", "ims", "gstr2b", "adjustments"])
            if (
              JSON.stringify(getPeriod(next)[field]) !==
              JSON.stringify(getPeriod(state)[field])
            )
              throw Error(
                "Payment is posted for this return. Its source data is locked.",
              );
        }
        savePortal(next);
        setState(next);
        setError("");
        return true;
      } catch (e) {
        setError(e.message + " The action has not been applied.");
        return false;
      }
    },
    [state],
  );
  const syncPayment = useCallback(
    (ws) => {
      if (
        state.loadError ||
        ws.status === "draft" ||
        ws.gstin !== state.taxpayer.gstin ||
        ws.period !== state.selectedPeriod
      )
        return;
      try {
        let next = lockPreparedReturn(state, ws);
        if (next !== state) {
          savePortal(next);
          setState(next);
          return;
        }
        if (ws.status === "filed") {
          next = recordGstr3bFiling(state, ws.receipt, ws.balances);
          if (next !== state) {
            savePortal(next);
            setState(next);
          }
        }
      } catch (e) {
        setError(
          "Payment is saved, but the return dashboard could not be updated: " +
            e.message +
            " Reload to reconcile it.",
        );
      }
    },
    [state],
  );
  useEffect(() => {
    if (payment && payment.status !== "draft") syncPayment(payment);
  }, [state.selectedPeriod, payment?.status, payment?.id, syncPayment]);
  if (state.loadError)
    return (
      <main className="recovery">
        <h1>Practice workspace could not be loaded</h1>
        <p role="alert">{state.loadError}</p>
        <p>
          Your saved data has been retained. Restore browser storage access and
          reload this page.
        </p>
        <button onClick={() => location.reload()}>Reload workspace</button>
      </main>
    );
  const data = getPeriod(state),
    taxpayer = state.taxpayer;
  let prepared = null,
    prepareError = "";
  try {
    prepared =
      payment && payment.status !== "draft"
        ? payment.partA
        : preparePartA(state);
  } catch (e) {
    prepareError = e.message;
  }
  const opening = getOpeningLedgers(state);
  const loggedIn = (s) => {
    setSession(s);
    const next = PUBLIC.includes(route) ? afterLogin : route;
    setRoute(next);
    location.hash = next;
    setError("");
  };
  const logout = () => {
    if (
      dirty &&
      !window.confirm("Your allocation changes are unsaved. Log out anyway?")
    )
      return;
    try {
      logoutPractice();
      setSession(null);
      setRoute("home");
      location.hash = "home";
      setDirty(false);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div className="portal-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById("main-content");
          main?.setAttribute("tabindex", "-1");
          main?.focus();
        }}
      >
        Skip to main content
      </a>
      <div className="utility">
        <div className="container utility-inner">
          <span>Goods and Services Tax · Learning environment</span>
          <span>
            English <i />
            {session ? "Taxpayer services" : "Independent practice portal"}
          </span>
        </div>
      </div>
      <header className="brand-header">
        <div className="container brand-inner">
          <button
            className="portal-brand"
            onClick={() => navigate("home")}
            aria-label="GST Practice Portal home"
          >
            <span className="brand-symbol" aria-hidden="true">
              <span>GST</span>
              <small>PRACTICE</small>
            </span>
            <span className="brand-copy">
              <strong>GST Practice Portal</strong>
              <span>Goods and Services Tax</span>
            </span>
          </button>
          {session ? (
            <div className="portal-account">
              <div>
                <strong>{taxpayer.signatories[0].name}</strong>
                <span>{taxpayer.gstin}</span>
              </div>
              <button className="text-button" onClick={logout}>
                Logout
              </button>
            </div>
          ) : (
            <button
              className="primary header-login"
              onClick={() => navigate("login")}
            >
              Login <span>→</span>
            </button>
          )}
        </div>
      </header>
      <nav
        className={"main-nav portal-nav " + (menu ? "open" : "")}
        aria-label="Main navigation"
      >
        <div className="container">
          <button
            className="mobile-menu"
            onClick={() => setMenu(!menu)}
            aria-expanded={menu}
          >
            ☰ <span>Menu</span>
          </button>
          <div className="portal-nav-links">
            {[
              ["home", "Home"],
              ["dashboard", "Returns Dashboard"],
              ["gstr1", "GSTR-1"],
              ["ims", "IMS"],
              ["gstr2b", "GSTR-2B"],
              ["gstr3b", "GSTR-3B"],
              ["ledgers", "Electronic Ledgers"],
              ["help", "Help & Resources"],
            ].map(([path, label]) => (
              <button
                className={
                  view === path || (path === "gstr3b" && view === "payment")
                    ? "active"
                    : ""
                }
                key={path}
                onClick={() => navigate(path)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="practice-pill">
            <span />
            PRACTICE MODE
          </span>
        </div>
      </nav>
      <div className="practice-banner">
        <div className="container">
          <span aria-hidden="true">ⓘ</span>
          <span>
            Independent training portal. Fictional data, simulated payments and
            EVC. No government filing.
          </span>
        </div>
      </div>
      {view === "home" ? (
        <main id="main-content">
          <HomePage session={session} onNavigate={navigate} />
        </main>
      ) : view === "login" ? (
        <main id="main-content">
          {error && (
            <div className="container">
              <div className="alert error" role="alert">
                {error}
              </div>
            </div>
          )}
          <LoginPage onLogin={loggedIn} onNavigate={navigate} />
        </main>
      ) : (
        <main className="container portal-content" id="main-content">
          <div className="breadcrumb">
            <button onClick={() => navigate("home")}>Home</button>
            <span>›</span>
            <button onClick={() => navigate("dashboard")}>Returns</button>
            <span>›</span>
            <strong>{TITLES[view]}</strong>
          </div>
          {view !== "payment" && (
            <div className="page-title">
              <div>
                <p className="eyebrow">
                  {view === "help"
                    ? "TAXPAYER FACILITIES"
                    : "TAXPAYER SERVICES"}
                  <span>LEARNING WORKSPACE</span>
                </p>
                <h2>{TITLES[view]}</h2>
                <p>{SUBTITLES[view]}</p>
              </div>
              {view !== "help" && (
                <span className={"status " + (data.filing ? "filed" : "draft")}>
                  {data.filing ? "Filed" : "Practice workspace"}
                </span>
              )}
            </div>
          )}
          {session && view !== "help" && (
            <section className="portal-return-bar" aria-label="Selected return">
              <span>
                <small>GSTIN</small>
                <strong>{taxpayer.gstin}</strong>
              </span>
              <span>
                <small>Legal Name</small>
                <strong>{taxpayer.legalName}</strong>
              </span>
              <span>
                <small>Return Period</small>
                <strong>{periodName(state.selectedPeriod)}</strong>
              </span>
              <button
                className="text-button"
                onClick={() => navigate("dashboard")}
              >
                Change period →
              </button>
            </section>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {paymentReadError && (
            <div className="alert error" role="alert">
              Payment data: {paymentReadError}
            </div>
          )}
          {view === "dashboard" && (
            <ReturnDashboard
              key={state.selectedPeriod}
              state={state}
              onChange={commit}
              onNavigate={navigate}
            />
          )}
          {view === "gstr1" && (
            <Gstr1Page state={state} onChange={commit} onNavigate={navigate} />
          )}
          {view === "ims" && (
            <IMSPage
              key={state.selectedPeriod}
              state={state}
              onChange={commit}
              onNavigate={navigate}
            />
          )}
          {view === "gstr2b" && (
            <Gstr2BPage
              key={state.selectedPeriod}
              state={state}
              onChange={commit}
              onNavigate={navigate}
            />
          )}
          {view === "gstr3b" && (
            <Gstr3BPartA
              key={
                state.selectedPeriod +
                ":" +
                (data.paymentLock?.status || "draft")
              }
              state={state}
              onChange={commit}
              onNavigate={navigate}
              paymentWorkspace={payment}
            />
          )}
          {view === "payment" &&
            (prepared && !paymentReadError ? (
              <Gstr3B
                key={`${taxpayer.gstin}:${state.selectedPeriod}`}
                gstin={taxpayer.gstin}
                period={state.selectedPeriod}
                partA={prepared}
                opening={opening}
                embedded
                onNavigate={navigate}
                onWorkspaceChange={syncPayment}
                onDirtyChange={setDirty}
              />
            ) : (
              <div className="prerequisite-card">
                <h3>Complete the return preparation first</h3>
                <p>{prepareError || paymentReadError}</p>
                <button className="primary" onClick={() => navigate("gstr3b")}>
                  Review GSTR-3B Part A →
                </button>
              </div>
            ))}
          {view === "ledgers" && (
            <PortalLedgers
              taxpayer={taxpayer}
              period={state.selectedPeriod}
              opening={opening}
              payment={payment}
            />
          )}
          {view === "help" && (
            <HelpPage
              state={state}
              onNavigate={navigate}
              onBackup={() => {
                if (!session) {
                  navigate("login");
                  return;
                }
                try {
                  downloadBackup(state);
                } catch (e) {
                  setError(e.message);
                }
              }}
            />
          )}
        </main>
      )}
      <footer className="portal-footer">
        <div className="container">
          <div>
            <strong>GST Practice Portal</strong>
            <p>
              An independent learning environment for GST return preparation.
            </p>
            <span>
              All documents, payments, OTPs and acknowledgements are simulated.
            </span>
          </div>
          <div>
            <button onClick={() => navigate("help")}>Help & Resources</button>
            <a href="https://www.gst.gov.in" target="_blank" rel="noreferrer">
              Official GST Portal →
            </a>
            <span>Data saved in this browser · Times in IST</span>
          </div>
        </div>
        <div className="footer-bottom">
          For training purposes only · Not an official government website
        </div>
      </footer>
    </div>
  );
}
function PortalLedgers({ taxpayer, period, opening, payment }) {
  const ws =
    payment ||
    createWorkspace({
      gstin: taxpayer.gstin,
      period,
      opening,
      partA: {
        legalName: taxpayer.legalName,
        liabilities: { A: emptyHeads(), B: emptyHeads() },
        itc: emptyHeads(),
        interest: emptyHeads(),
        lateFee: emptyHeads(),
        signatories: taxpayer.signatories,
      },
    });
  const calc =
    payment?.offset?.snapshot || calculatePayment(getPaymentInputs(ws));
  return (
    <>
      {!payment && (
        <div className="notice">
          These are the opening balances for the selected period. Current-period
          eligible ITC and liability appear when GSTR-3B payment is prepared.
        </div>
      )}
      <LedgerView ws={ws} calc={calc} />
    </>
  );
}
function HelpPage({ state, onNavigate, onBackup }) {
  return (
    <div className="help-page">
      <div className="help-grid">
        {[
          [
            "01",
            "GSTR-1",
            "Report outward supplies in 15 grouped practice sections. HSN and document summaries retain their reporting role without duplicating tax.",
            "gstr1",
          ],
          [
            "02",
            "IMS & GSTR-2B",
            "Review filed supplier documents. No action is deemed accepted; rejected and pending documents are excluded from eligible ITC. Recompute after changes.",
            "ims",
          ],
          [
            "03",
            "GSTR-3B & Payment",
            "Use the filed GSTR-1 and current GSTR-2B to prepare Part A, then review the Rule 88A matrix and cash shortfall.",
            "gstr3b",
          ],
          [
            "04",
            "Verification & Filing",
            "Pay a practice challan where needed, post the payment once, then complete the declaration and simulated EVC.",
            "payment",
          ],
        ].map(([n, title, text, route]) => (
          <section className="panel help-card" key={n}>
            <span>{n}</span>
            <h3>{title}</h3>
            <p>{text}</p>
            <button className="text-button" onClick={() => onNavigate(route)}>
              Open service →
            </button>
          </section>
        ))}
      </div>
      <section className="panel help-reference">
        <div className="panel-heading">
          <div>
            <h3>Official References</h3>
            <p>
              Use the official portal for real filing requirements and the
              latest guidance.
            </p>
          </div>
        </div>
        <a
          href="https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm"
          target="_blank"
          rel="noreferrer"
        >
          GSTR-1 · Outward supplies user guide →
        </a>
        <a
          href="https://tutorial.gst.gov.in/downloads/news/revised_advisory_on_ims.pdf"
          target="_blank"
          rel="noreferrer"
        >
          Invoice Management System · GSTN advisory →
        </a>
        <a
          href="https://tutorial.gst.gov.in/userguide/returns/FAQ_gstr2b.htm"
          target="_blank"
          rel="noreferrer"
        >
          GSTR-2B · Frequently asked questions →
        </a>
        <a
          href="https://tutorial.gst.gov.in/userguide/returns/GSTR3B.htm"
          target="_blank"
          rel="noreferrer"
        >
          GSTR-3B · Return filing guide →
        </a>
        <a
          href="https://cbic-gst.gov.in/pdf/Circular-98-17-2019-GST.pdf"
          target="_blank"
          rel="noreferrer"
        >
          Rule 88A · ITC utilisation circular →
        </a>
      </section>
      <section className="panel help-reference">
        <div className="panel-heading">
          <div>
            <h3>Your browser workspace</h3>
            <p>
              Progress is stored locally by taxpayer and period. Logging out
              retains your return data.
            </p>
          </div>
          <button className="secondary" onClick={onBackup}>
            Download workspace backup
          </button>
        </div>
        <p>
          Keep a backup before clearing browser storage. This practice login is
          a local navigation gate, and is not a real GST account. The portal
          calls no government filing, banking or OTP endpoint.
        </p>
        <p>
          The current authenticated 2026 portal appearance has not been verified
          pixel by pixel. The statutory tables are grouped into practice
          sections. Rule 86B, interest assessment, late-fee exemptions and final
          ITC eligibility require separate assessment before real filing.
        </p>
      </section>
    </div>
  );
}
