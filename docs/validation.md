# Verification

Verified on 3 November 2026 (IST).

- 47 Node tests pass. These cover exact paise arithmetic; Rule 88A and the February 2026 sequence; isolated negative balances; 300 mixed-allocation conservation scenarios; invoices, credit notes, exports, 15 reporting groups, HSN/document nonduplication, B2CL threshold, prior-period and repeated amendments; IMS exclusions and declared credit-note reductions; stale/canonical GSTR-2B; Part A reversals; offset/source locking; EVC and duplicate posting; closing-ledger and pending-document carryforward; stale revisions and failed/corrupt storage.
- Production static build succeeds with no API backend.
- Chromium browser journey passes: direct payment route is gated; wrong captcha rejects; all 15 GSTR-1 cards open; a sales invoice is edited and filed using practice EVC; filed records lock; IMS actions make 2B stale; recomputation changes exact eligible credit; pending credit notes and unfiled suppliers are treated correctly; derived Part A reaches Step 6; challan cash and offset post once; source controls lock; final EVC updates the dashboard and exact closing ledgers without a second debit.
- Subsequent-period selection carries pending/unfiled inward documents and filed ledgers, and makes prior filed invoices available for amendment selection.
- Offline reload retains the workspace after the initial asset cache installs. Logout preserves return data and restores route gating.
- 390px mobile homepage and GSTR-1 have no page-level horizontal overflow. Wide financial tables scroll inside their panels.
- Browser quota failure stays visible inside an edit dialog and leaves the original record unchanged. Existing tests preserve corrupt storage with a recovery message.
- No runtime page errors in the completed browser journey.

These checks validate the fictional seeded application and its source-to-payment wiring. They do not prove authenticated 2026 pixel fidelity, full statutory dataset validation, live GST API access, real payments or real filing. See full-portal-rules.md and payment-rules.md for scope and primary references.
