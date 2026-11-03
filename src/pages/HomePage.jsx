import React from "react";
export default function HomePage({ session, onNavigate }) {
  return (
    <div className="home-content">
      <section className="home-hero">
        <div className="container hero-inner">
          <div className="hero-copy">
            <span className="hero-kicker">GOODS AND SERVICES TAX</span>
            <h2>
              A single workspace.
              <br />
              The complete return journey.
            </h2>
            <p>
              Practice GST returns from outward supplies to the final tax
              payment. Learn each step using fictional records in your own
              browser.
            </p>
            <button
              className="primary"
              onClick={() => onNavigate(session ? "dashboard" : "login")}
            >
              {session ? "Open Returns Dashboard" : "Login to Practice"}{" "}
              <span>→</span>
            </button>
            <span className="hero-note">GSTR-1 · IMS · GSTR-2B · GSTR-3B</span>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="hero-document">
              <div className="document-top">
                <span>FORM GSTR-3B</span>
                <span>✓</span>
              </div>
              <strong>Everything adds up.</strong>
              <div className="document-lines">
                <i />
                <i />
                <i />
              </div>
              <div className="document-summary">
                <span>Input tax credit</span>
                <b>₹65,000.00</b>
              </div>
              <div className="document-summary">
                <span>Payment of tax</span>
                <b>Verified ✓</b>
              </div>
            </div>
            <div className="floating-label label-itc">
              <span>✓</span> ITC reconciled
            </div>
            <div className="floating-label label-return">
              <span>✓</span> Return prepared
            </div>
          </div>
        </div>
      </section>
      <div className="container home-main">
        <section className="home-service-strip" aria-label="Practice services">
          {[
            [
              "01",
              "Outward supplies",
              "Prepare all 15 GSTR-1 practice sections",
              "gstr1",
            ],
            [
              "02",
              "Invoice management",
              "Accept, reject or keep inward records pending",
              "ims",
            ],
            [
              "03",
              "Tax credit statement",
              "Generate and review your GSTR-2B",
              "gstr2b",
            ],
            [
              "04",
              "Return & payment",
              "Review, offset and file with practice EVC",
              "gstr3b",
            ],
          ].map(([n, title, text, path]) => (
            <button key={path} onClick={() => onNavigate(path)}>
              <span>{n}</span>
              <strong>{title}</strong>
              <small>{text}</small>
              <b>→</b>
            </button>
          ))}
        </section>
        <div className="home-columns">
          <section className="panel news-panel">
            <div className="panel-heading">
              <div>
                <h3>News & Important Updates</h3>
                <p>Official guidance used by this practice portal.</p>
              </div>
              <span className="tag">GST UPDATES</span>
            </div>
            <article>
              <time>FEB 2026</time>
              <div>
                <a
                  href="https://www.mahagst.gov.in/public/uploads/gstnadvisory/1771847857_395.%20Advisory%20on%20Interest%20Collection%20and%20Related%20Enhancements%20in%20GSTR-3B.pdf"
                  target="_blank"
                  rel="noreferrer"
                >
                  Flexible CGST and SGST credit sequence for residual IGST →
                </a>
                <p>
                  Available in the payment matrix for return periods from
                  February 2026.
                </p>
              </div>
            </article>
            <article>
              <time>IMS</time>
              <div>
                <a
                  href="https://tutorial.gst.gov.in/downloads/news/revised_advisory_on_ims.pdf"
                  target="_blank"
                  rel="noreferrer"
                >
                  Invoice Management System and GSTR-2B recomputation →
                </a>
                <p>
                  Review supplier invoices before using the statement to prepare
                  your return.
                </p>
              </div>
            </article>
            <article>
              <time>GSTR-1</time>
              <div>
                <a
                  href="https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm"
                  target="_blank"
                  rel="noreferrer"
                >
                  Outward supplies: table-wise return preparation →
                </a>
                <p>
                  Official statutory table labels are retained in the grouped
                  practice sections.
                </p>
              </div>
            </article>
          </section>
          <section className="practice-intro">
            <div className="intro-icon">GST</div>
            <span className="eyebrow">A PLACE TO PRACTICE</span>
            <h3>
              Learn the process.
              <br />
              Keep your progress.
            </h3>
            <p>
              Prepared returns, invoice actions, ledger balances and
              acknowledgements stay together in this browser.
            </p>
            <ul>
              <li>Fictional taxpayer and sample documents</li>
              <li>One connected return and payment flow</li>
              <li>Works offline after your first visit</li>
            </ul>
            <button className="secondary" onClick={() => onNavigate("help")}>
              About this practice portal →
            </button>
          </section>
        </div>
        <section className="home-bottom">
          <div>
            <span>START WITH A COMPLETED PERIOD</span>
            <h3>Your September 2026 practice return is ready to prepare.</h3>
          </div>
          <button className="primary" onClick={() => onNavigate("dashboard")}>
            View Returns Dashboard →
          </button>
        </section>
      </div>
    </div>
  );
}
