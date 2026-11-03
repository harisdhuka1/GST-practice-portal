# GST Practice Portal

A single browser-local practice application for homepage/login, returns dashboard, 15 grouped GSTR-1 reporting sections, IMS, GSTR-2B, GSTR-3B Part A, Table 6.1 payment, Rule 88A set-off, ledgers and simulated EVC filing.

```sh
npm ci --cache ./work/npm-cache
npm run dev
```

Practice username: `sample.taxpayer` · Password: `Practice@123`. Enter the displayed practice captcha. Do not enter real GST credentials. The login is a local workflow gate, not real account authentication.

New workspaces start with fictional September 2026 sales and inward documents. Select another period from Returns Dashboard. GSTR-1 filing supplies output liability, while separate supplier records and saved IMS actions supply GSTR-2B credit. Part A requires a filed GSTR-1 and a current GSTR-2B. Posting the payment locks those sources; EVC filing updates the dashboard and closing ledgers without debiting twice. Filed-period closing ledgers and unresolved inward documents carry to a subsequent period.

```sh
npm test
npm run build
npm run preview
```

The production build is static, with no API backend dependency. After the first successful visit, cached assets support offline reload. All records stay in localStorage by taxpayer/period; the practice session uses sessionStorage. Logging out retains return data. Help provides a workspace backup download. Payments, OTP delivery and acknowledgements are simulated.

The completed payment engine from `cc2ad35` is retained. The new portal embeds it beneath a shared shell and derives its Part A from the return store. Earlier standalone October payment records remain at their existing storage key and are not overwritten by the September seed. A mismatched legacy period cannot be silently reconciled into new upstream returns.

See [architecture and integration](docs/integration.md), [current return rules](docs/full-portal-rules.md), [payment rules](docs/payment-rules.md) and [validation](docs/validation.md). The 15 GSTR-1 sections are deliberate groupings; the official portal has more entry tiles. Authenticated 2026 pixel fidelity and full statutory dataset validation are not asserted.
