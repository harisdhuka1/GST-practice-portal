# Unified portal architecture

`src/App.jsx` owns one browser-local portal state and routes Home, Login, Returns Dashboard, GSTR-1, IMS, GSTR-2B, GSTR-3B Part A, payment, ledgers and Help. Hash routes are guarded by a practice session. One shared shell displays the selected taxpayer and period.

`src/gst/portalStore.js` owns the return source model. Each immutable mutation increments a revision; save succeeds before a UI success is shown. Taxpayer/period financial amounts are integer paise. The invoice model derives exact tax heads from place of supply, handles credit-note signs and amendment differences, and excludes HSN/document/supplementary reporting from duplicated liability.

GSTR-1 output invoices are separate from inward supplier documents. Only eligible supplier-filed inward records accepted or deemed accepted in IMS contribute to the GSTR-2B snapshot. An IMS version change makes the snapshot stale. Pending, rejected, unfiled, ineligible and reverse-charge documents retain distinct treatment. Credit-note reductions are signed; an unresolved negative ITC result blocks preparation rather than silently turning into zero credit.

`preparePartA(state)` requires a filed GSTR-1 and a canonical, current GSTR-2B, and returns:

```js
{
  legalName,
  liabilities: { A: { igst, cgst, sgst, cess }, B: { igst, cgst, sgst, cess } },
  itc: { igst, cgst, sgst, cess },
  interest: { igst, cgst, sgst, cess },
  lateFee: { igst, cgst, sgst, cess },
  signatories: [{ id, name, email, mobile }]
}
```

Category B contains reverse-charge and section 9(5) operator liability. Additional RCM inputs are added to RCM already present in GSTR-2B. RCM credit is not automatically claimed without payment/eligibility assessment. ITC reversals, interest and late fee are explicit assessed inputs.

`src/Gstr3B.jsx` loads/saves the existing Step 6 workspace using the same GSTIN and period. A source fingerprint lets changed prepared returns update an unposted payment draft without repeating current-period ITC or discarding paid challans. The controlled payment page is embedded beneath the shared portal shell. Its Part A link returns to the upstream preparation screen rather than allowing independent edits that bypass source returns.

Payment offset validates allocation and matching cash balances again from saved inputs. It posts one immutable payment snapshot. `lockPreparedReturn()` verifies its amounts match the prepared sources and locks those sources. EVC filing creates the practice receipt without a further debit. `recordGstr3bFiling()` verifies the receipt and exact closing balances against the posted payment before updating dashboard state.

The portal and payment workspaces are separate localStorage records. Payment is the authoritative financial posting. The App reconciles a saved offset/filing into the portal on reload; it displays a failure if reconciliation cannot complete. Revision checks reject stale tabs and preserve corrupt raw data. This browser store is not a transactional multiuser accounting database. A server-backed version would require database transactions and idempotency keys across these records.

Selecting a later period carries the latest earlier filed closing credit/cash/negative ledgers, plus unresolved pending and supplier-unfiled documents. Accepted/rejected prior documents are archived rather than credited twice. Amendments reference prior filed originals and use the latest prior filed revised absolute value as their comparison baseline.

The earlier standalone October 2026 workspace is preserved. New portal data starts in September, avoiding a silent rewrite of old payment fixtures. Existing locked October data with unrelated upstream sources is shown with a reconciliation error, not imported as a fabricated GSTR-1.

The production build uses same-origin static assets and an offline cache. The first visit must succeed before offline reload is available. No government API, bank endpoint, password server or real OTP service is called.
