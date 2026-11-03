import React, { useState } from "react";
import {
  createCaptcha,
  loginPractice,
  DEMO_USERNAME,
  DEMO_PASSWORD,
} from "../gst/practiceAuth.js";
export default function LoginPage({ onLogin, onNavigate }) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [captcha, setCaptcha] = useState(""),
    [challenge, setChallenge] = useState(createCaptcha),
    [visible, setVisible] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="container login-page">
      <div className="breadcrumb">
        <span>Home</span>
        <span>›</span>
        <strong>Login</strong>
      </div>
      <div className="login-layout">
        <div className="login-description">
          <span className="eyebrow">TAXPAYER SERVICES</span>
          <h2>
            Welcome to your
            <br />
            practice workspace.
          </h2>
          <p>
            Sign in to prepare returns, review inward invoices and complete the
            payment and filing sequence.
          </p>
          <div className="login-journey">
            {[
              "Prepare outward supplies",
              "Reconcile inward invoices",
              "Review ITC and tax liability",
              "Offset and file your return",
            ].map((x, i) => (
              <div key={x}>
                <span>{i + 1}</span>
                {x}
              </div>
            ))}
          </div>
          <p className="login-disclaimer">
            This is an independent simulator. Use the supplied practice
            credentials; never enter a real GST portal password.
          </p>
        </div>
        <section className="panel login-card">
          <div className="panel-heading">
            <div>
              <h3>Login</h3>
              <p>Access the GST practice return workspace.</p>
            </div>
            <span className="tag">PRACTICE</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              try {
                onLogin(
                  loginPractice({ username, password, captcha, challenge }),
                );
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <label>
              Username <b>*</b>
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter practice username"
              />
            </label>
            <label>
              Password <b>*</b>
              <div className="password-input">
                <input
                  required
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter practice password"
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Hide password" : "Show password"}
                >
                  {visible ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <label>
              Type the characters shown below <b>*</b>
              <div className="captcha-display">
                <code aria-label="Practice captcha">{challenge.text}</code>
                <button
                  type="button"
                  onClick={() => {
                    setChallenge(createCaptcha());
                    setCaptcha("");
                  }}
                  aria-label="Refresh captcha"
                >
                  ↻
                </button>
                <small>Practice captcha</small>
              </div>
              <input
                required
                value={captcha}
                onChange={(e) => setCaptcha(e.target.value)}
                maxLength={6}
                autoComplete="off"
                placeholder="Enter captcha"
                aria-label="Enter captcha"
              />
            </label>
            <button type="submit" className="primary">
              Login →
            </button>
            <div className="demo-login">
              <strong>Practice credentials</strong>
              <p>
                Username <code>{DEMO_USERNAME}</code>
                <br />
                Password <code>{DEMO_PASSWORD}</code>
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setUsername(DEMO_USERNAME);
                  setPassword(DEMO_PASSWORD);
                }}
              >
                Use practice credentials
              </button>
            </div>
            <p className="hint">
              This gate keeps the practice flow together. It does not provide
              real account authentication.
            </p>
          </form>
          <button
            className="text-button login-back"
            onClick={() => onNavigate("home")}
          >
            ← Back to Home
          </button>
        </section>
      </div>
    </div>
  );
}
