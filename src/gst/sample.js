export const SAMPLE_GSTIN = "24AAAPA0001A1Z5";
export const SAMPLE_PERIOD = "2026-10";
export const SAMPLE_PART_A = {
  legalName: "SAMPLE ALPHA TRADERS",
  liabilities: {
    A: { igst: 1800000, cgst: 2400000, sgst: 2400000, cess: 0 },
    B: { igst: 250000, cgst: 90000, sgst: 90000, cess: 0 },
  },
  itc: { igst: 2700000, cgst: 1800000, sgst: 1600000, cess: 0 },
  interest: { igst: 12500, cgst: 0, sgst: 0, cess: 0 },
  lateFee: { igst: 0, cgst: 2500, sgst: 2500, cess: 0 },
  signatories: [
    {
      id: "sample-signatory",
      name: "Sample Aarav Shah",
      email: "aarav@example.com",
      mobile: "9000000001",
    },
  ],
};
export const SAMPLE_OPENING = {
  credit: { igst: 500000, cgst: 200000, sgst: 300000, cess: 0 },
  cash: {
    tax: { igst: 50000, cgst: 50000, sgst: 50000, cess: 0 },
    interest: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
    lateFee: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
  },
  negative: {
    A: { igst: 0, cgst: 0, sgst: 100000, cess: 0 },
    B: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
  },
};
