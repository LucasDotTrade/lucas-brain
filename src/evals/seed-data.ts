export const seedItems = [
  {
    input: `You are a senior trade document examiner...
PYTHON VALIDATION RESULTS:
[F0] INFO: All dates valid
[F1] INFO: Parties match
[F2] INFO: Amounts within tolerance

No discrepancies found. All checks passed.

RAW DOCUMENTS:
--- LETTER OF CREDIT ---
:20: LC-2024-001
:32B: USD 150,000.00
:31D: 240615 NEW YORK
:44E: HOUSTON, TEXAS
:44F: JEBEL ALI, UAE
:45A: 500 MT POLYETHYLENE RESIN
:59: ACME TRADING LLC

--- BILL OF LADING ---
Shipper: ACME TRADING LLC
Consignee: TO ORDER OF EMIRATES NBD
Port of Loading: HOUSTON, TEXAS
Port of Discharge: JEBEL ALI, UAE
Vessel: MAERSK SELETAR
Quantity: 500 MT POLYETHYLENE RESIN`,
    groundTruth: {
      scenario: "Clean B/L + LC — no issues",
      expectedVerdict: "GO",
      mustMention: ["polyethylene", "Houston", "Jebel Ali"],
      mustNotMention: ["expired", "mismatch", "discrepancy"],
    },
  },
  {
    input: `You are a senior trade document examiner...
PYTHON VALIDATION RESULTS:
[F0] FATAL: Port of discharge mismatch — LC requires "JEBEL ALI, UAE", B/L shows "DUBAI, UAE"
[F1] INFO: Parties match
[F2] INFO: Amounts within tolerance

RAW DOCUMENTS:
--- LETTER OF CREDIT ---
:20: LC-2024-002
:32B: USD 85,000.00
:44F: JEBEL ALI, UAE

--- BILL OF LADING ---
Port of Discharge: DUBAI, UAE`,
    groundTruth: {
      scenario: "Port mismatch — B/L vs LC",
      expectedVerdict: "WAIT",
      mustMention: ["port", "Jebel Ali", "Dubai"],
      mustNotMention: ["expired", "days remaining"],
    },
  },
  {
    input: `You are a senior trade document examiner...
PYTHON VALIDATION RESULTS:
[F0] FATAL: Invoice amount USD 162,500 exceeds LC amount USD 150,000 by 8.3% (tolerance: 5%)
[F1] INFO: Parties match
[F2] INFO: Ports match

RAW DOCUMENTS:
--- LETTER OF CREDIT ---
:32B: USD 150,000.00

--- COMMERCIAL INVOICE ---
Total Amount: USD 162,500.00`,
    groundTruth: {
      scenario: "Amount mismatch — invoice vs LC",
      expectedVerdict: "NO_GO",
      mustMention: ["amount", "150,000", "162,500"],
      mustNotMention: ["expired"],
    },
  },
  {
    input: `You are a senior trade document examiner...
PYTHON VALIDATION RESULTS:
[F0] OBSERVATION: Shipper (VENTURE GLOBAL PLAQUEMINES LLC) differs from LC beneficiary (IRH GLOBAL TRADING LTD)
[F1] INFO: All other checks passed

RAW DOCUMENTS:
--- LETTER OF CREDIT ---
:59: IRH GLOBAL TRADING LTD

--- BILL OF LADING ---
Shipper: VENTURE GLOBAL PLAQUEMINES LLC
Cargo: LNG (LIQUEFIED NATURAL GAS)`,
    groundTruth: {
      scenario: "Shipper ≠ Beneficiary — normal in commodity trades",
      expectedVerdict: "GO",
      mustMention: ["shipper", "beneficiary"],
      mustNotMention: ["expired", "mismatch"],
    },
  },
  {
    input: `You are a senior trade document examiner...
PYTHON VALIDATION RESULTS:
[F0] FATAL: Partial shipment not allowed per LC, but B/L shows "1 of 3" shipments
[F1] WARNING: Documents presented 18 days after B/L date (within 21-day limit but tight)
[F2] INFO: Parties match

RAW DOCUMENTS:
--- LETTER OF CREDIT ---
:43P: PARTIAL SHIPMENTS NOT ALLOWED

--- BILL OF LADING ---
Shipment: 1 of 3
B/L Date: 2024-05-01`,
    groundTruth: {
      scenario: "Multiple issues — partial shipment + stale docs",
      expectedVerdict: "NO_GO",
      mustMention: ["partial shipment"],
      mustNotMention: ["expired", "days remaining"],
    },
  },
];
