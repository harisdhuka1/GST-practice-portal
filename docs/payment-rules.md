# Step 6 payment rules and integration limits

The payment engine uses integer paise and preserves tax heads and liability
categories throughout. It implements a training simulation; it does not submit
returns, pay a government challan or send an OTP.

## Table 6.1

The notified Table 6.1 separates Section A, ordinary output tax, from Section B,
reverse-charge liability and supplies under section 9(5). Each section retains
IGST, CGST, SGST/UTGST and Cess. The training table shows gross tax, adjustment
of a previous negative balance, net tax, credit used by source head, tax in cash,
interest in cash and late fee in cash. Interest and late fee are passed in as
already assessed Part A totals and shown once; the engine does not infer their
allocation to A/B.

Sources: [Notification 12/2024, replacement Table 6.1, PDF pages 27–28](https://www.gstcouncil.gov.in/sites/default/files/2024-09/central-tax-12-2024-11072024.pdf)
and [Notification 09/2025, commencement on 11 February 2025](https://gstcouncil.gov.in/sites/default/files/2025-04/09-2025-ct-eng.pdf).

## Rule 88A allocation

- IGST credit first pays IGST liability. Surplus IGST credit can then pay CGST
  and SGST in either order or proportion.
- Usable IGST credit must be exhausted before CGST or SGST credit is used.
- CGST and SGST credit each pay their own head before residual IGST liability.
  CGST credit cannot pay SGST; SGST credit cannot pay CGST.
- Cess credit pays only Cess. Reverse-charge and section 9(5) tax, interest and
  late fee use cash after applicable negative adjustment.
- Available credit is not consumed beyond actual eligible liability. The
  automatic matrix first places surplus IGST where own-head credit is
  insufficient, then uses the selected preference. This avoids stranding
  same-head credit unnecessarily. Manual matrices are independently validated.

The portal permits either CGST/SGST sequence against residual IGST starting
with the **February 2026 return period**. This is a portal behavior update;
it is not represented as a change to the text of Rule 88A. For earlier periods,
the simulator applies CGST before SGST to that residual IGST.

Sources: [CBIC Circular 98/17/2019](https://cbic-gst.gov.in/pdf/Circular-98-17-2019-GST.pdf),
[GSTN February 2026 advisory hosted by the Maharashtra GST department](https://www.mahagst.gov.in/public/uploads/gstnadvisory/1771847857_395.%20Advisory%20on%20Interest%20Collection%20and%20Related%20Enhancements%20in%20GSTR-3B.pdf),
[CBIC reverse-charge FAQ](https://cbic-gst.gov.in/hindi/sectoral-faq.html), and
[Compensation Cess Act, section 11](https://cbic-gst.gov.in/hindi/compensation-cess-bill-e.html).

## Negative liability and ledgers

Balances are maintained separately for A/B and for each tax head. The
adjustment is the smaller of positive current liability and the corresponding
opening negative balance. The unused balance plus any new negative liability
is carried forward. Negative balances never become ITC or cash and cannot be
edited from the payment screen. Cash tax, interest and late-fee minor heads
are kept separate; a surplus in one minor head does not automatically pay
another minor head.

Automatic future adjustment and the view-only negative statement are described
in [ICAI practical FAQs on GSTR-3B, 2026, question 13](https://d23z1tp9il9etb.cloudfront.net/download/pdf26/Practical%20FAQs%20on%20filing%20of%20Form%20GSTR-3B.pdf).
The tax-head and A/B separation follows the notified table above; it is an
implementation interpretation of that structure.

## Filing

Offset succeeds only after a valid allocation and sufficient matching cash
balances. EVC follows a declaration and selection of a listed authorised
signatory. A practice OTP expires after ten minutes; a replacement invalidates
the previous challenge. Filing and offset must be idempotent, and a filed return
cannot be edited. Practice reference numbers must be visibly marked.

Sources: [GST portal GSTR-3B FAQ](https://tutorial.gst.gov.in/userguide/returns/GSTR3B.htm),
[official EVC filing sequence](https://tutorial.gst.gov.in/userguide/returns/GSTR3B_-_File_Nil_Return.htm),
and [GSTN known issues and resolutions, GSTR-3B OTP errors](https://tutorial.gst.gov.in/offlineutilities/gsterrorandresolution/gstissuesandsuggestedsolutions.pdf).

## Verification boundaries

The current authenticated **2026 pixel layout has not been verified** against
an official portal screenshot. These rule sources support the table structure
and payment sequence; they do not establish a pixel-exact replica.

Part A must supply validated net eligible ITC, liability and assessed charges.
The engine does not independently determine ITC eligibility, reverse-charge
classification, Rule 86B applicability, interest under section 50, late-fee
waivers or the correctness of upstream returns. Any additional mandatory cash
restriction must be supplied by an upstream validation before final offset.
