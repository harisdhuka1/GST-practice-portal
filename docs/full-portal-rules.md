# Full portal rules and verification boundaries

The implementation is an independent training application using fictional data.
Login, supplier records, GST filings, challans, OTP delivery and acknowledgements
are simulated. It does not authenticate with or submit data to the government.

## GSTR-1 structure

The requested fifteen sections are grouped practice sections. The public official
manual contains additional entry and amendment tiles; fifteen is not asserted to
be the official dashboard's complete tile count. The practice groups retain the
statutory numbers: B2B (4/6B/6C), large consumer supplies (5), exports (6A), other
consumer supplies (7), exempt/non-GST supplies (8), registered and unregistered
notes (9B), invoice revisions (9A), note revisions (9C), consumer-summary revisions
(10), advances and adjustments (11), HSN (12), documents (13), supplier ECO
reporting (14/14A), and operator section 9(5) reporting (15/15A).

For current periods, B2CL requires an interstate unregistered invoice above
₹1 lakh. HSN separates business and consumer summaries. Document issuance details
are required where applicable supplies exist. Amendment liability is the change
from the original, not a second full invoice. HSN and document summaries do not
create additional output tax. Table 14 is supplementary and must not duplicate
base transaction liability.

Source: [official GSTR-1 manual](https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm).

## IMS and recipient decisions

Own outward invoices must not be credited back to the same taxpayer as inward
supplies. IMS uses separate fictional supplier documents. A saved supplier document
can be visible before supplier filing; inclusion in GSTR-2B requires supplier
filing. A record left without a recipient decision is deemed accepted when the
statement is computed. Reject and Pending exclude current-period credit. Changes
after computation require another computation before proceeding to GSTR-3B.

RCM and supplies excluded by the specified time/place eligibility rules bypass
recipient IMS actions. After the corresponding GSTR-3B is filed, completed
accepted/rejected items leave the active queue; pending items remain for future
decisions. Recalculation remains possible before filing the relevant GSTR-3B.

Source: [GSTN revised IMS advisory](https://tutorial.gst.gov.in/downloads/news/revised_advisory_on_ims.pdf).

The October 2025 update extends Pending to credit notes and certain downward
amendments. It also introduces recipient remarks and a declared credit reduction
where the full note would repeat a reversal already made. A declared reduction
must not exceed the note's corresponding tax. Defaulting to full reduction is
appropriate only when no prior reversal/non-availment reduces the amount due.

Source: [official October 2025 IMS FAQ](https://tutorial.gst.gov.in/downloads/news/creative_faq_on_gstr9_for_24_25_dt_15_oct_25_v6_final.pdf).
The official search index supplied this PDF's content; direct opening returned
404 during research, so its continued direct-download availability is unverified.

## GSTR-2B and preparation of GSTR-3B

GSTR-2B is a statement, not a return to be filed or a direct-entry invoice editor.
Its ordinary generation date is the fourteenth of the next month. The practice
app may generate a preview earlier only when visibly identified as accelerated
practice generation. The default September 2026 period avoids this issue at the
verification date, 3 November 2026 IST.

Preserve separate categories for ordinary eligible inward credit, goods imports,
ISD, reverse charge and unavailable credit. Their GSTR-3B destinations differ:
ordinary inward credit maps to 4A(5), imported goods to 4A(1), ISD to 4A(4), and
eligible paid RCM to 4A(3). Inward RCM liability belongs in 3.1(d); do not assume
credit merely because that cash liability exists. Import of services requires
separate assessed inputs. The specified section 16(4)/place restrictions belong
in 4D(2). Other eligibility restrictions require taxpayer assessment and reversal.

Source: [official GSTR-2B FAQ](https://tutorial.gst.gov.in/userguide/returns/FAQ_gstr2b.htm).

## Limits of the practice implementation

Published guidance supports the data relationships; an authenticated current
2026 portal session has not been supplied to verify pixel-exact appearance.
Fifteen grouped sections, local fixture documents, accelerated generation and
practice login must remain recognisable as training choices.

The application does not replace full statutory eligibility review, jurisdiction
and HSN catalogues, GSTN validation, all amendment dependencies, real due-date
extensions, e-invoice integrations, Rule 86B assessment or legal interest/late-fee
calculation. Part B retains the previously tested integer-paise payment engine;
assessed charges and special restrictions remain explicit inputs. See
[payment-rules.md](payment-rules.md) for the payment sources and limits.
