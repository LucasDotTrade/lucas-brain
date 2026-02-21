// Shared Senior Reviewer instructions — matches what Python sends
const REVIEW_INSTRUCTIONS = `## PYTHON VALIDATION RESULTS
The deterministic pipeline found the results below. Each finding has an ID (F0, F1, ...).
Python's severity is AUTHORITATIVE — do not reassign it.

## YOUR REVIEW (SENIOR REVIEWER)

---REVIEW_START---
For EACH finding above, output in this EXACT format:
FINDING_ID: F0
STATUS: CONFIRMED | OVERRIDE | UNCLEAR
CONFIDENCE: HIGH | MEDIUM | LOW
EVIDENCE: "<verbatim text from raw document>" (or NOT_FOUND)
NOTES: <1 sentence max>

Rules:
- Evidence must be VERBATIM text copied from the raw document text below
- Python's severity is AUTHORITATIVE
- You report your CONFIDENCE in the finding's accuracy: HIGH / MEDIUM / LOW
---REVIEW_END---

---ANALYSIS_START---
Write your analysis for the user here. This is the ONLY part the user will see.
Include your semantic analysis:
- Do goods descriptions mean the same thing across documents?
- Does this deal make commercial sense overall?
- Do LC sections conflict with each other?
- What could go wrong even if all checks passed?
- Any sanctions concerns?
---ANALYSIS_END---

### HARD RULES
1. Do NOT introduce new deterministic findings beyond Python's findings
2. If you spot something deterministic Python missed, note it briefly with verbatim evidence (max 2 observations)
3. Do NOT reassign severity
4. NEVER fabricate or paraphrase document content
5. Do NOT infer what a document "probably" says
6. When comparing entities across documents, copy-paste EXACTLY

Analyze this document and provide actionable feedback.`;

function makePrompt(parts: {
  docs: string;
  findings: string;
  docCount: number;
  docTypes: string;
  primaryType: string;
}): string {
  return `[User: +1234567890 via WhatsApp]
[Today's date: 20 February 2026]

## DOCUMENTS RECEIVED (${parts.docCount} total):
${parts.docTypes}

Primary Document Type: ${parts.primaryType}

## Document Content:
${parts.docs}

${parts.findings}

${REVIEW_INSTRUCTIONS}`;
}

export const seedItems = [
  {
    input: makePrompt({
      docCount: 2,
      docTypes: "Letter Of Credit, Bill Of Lading",
      primaryType: "letter_of_credit",
      docs: `--- LETTER OF CREDIT ---
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
      findings: `FINDING_ID: F0
STATUS: INFO
CONFIDENCE: HIGH
EVIDENCE: "All dates valid"
NOTES: No date issues found

FINDING_ID: F1
STATUS: INFO
CONFIDENCE: HIGH
EVIDENCE: "ACME TRADING LLC" matches across LC and B/L
NOTES: Parties match

FINDING_ID: F2
STATUS: INFO
CONFIDENCE: HIGH
EVIDENCE: "USD 150,000.00" consistent across documents
NOTES: Amounts within tolerance`,
    }),
    groundTruth: {
      scenario: "Clean B/L + LC — no issues",
      expectedVerdict: "GO",
      mustMention: ["ACME TRADING", "HOUSTON", "JEBEL ALI", "polyethylene"],
      mustNotMention: ["expired", "mismatch", "discrepancy"],
    },
  },
  {
    input: makePrompt({
      docCount: 2,
      docTypes: "Letter Of Credit, Bill Of Lading",
      primaryType: "letter_of_credit",
      docs: `--- LETTER OF CREDIT ---
:20: LC-2024-002
:32B: USD 85,000.00
:31D: 240715 DUBAI
:44E: SHANGHAI, CHINA
:44F: JEBEL ALI, UAE
:45A: 200 MT STEEL COILS
:59: GOLDEN STAR METALS FZE

--- BILL OF LADING ---
Shipper: GOLDEN STAR METALS FZE
Consignee: TO ORDER OF MASHREQ BANK
Port of Loading: SHANGHAI, CHINA
Port of Discharge: DUBAI, UAE
Vessel: MSC AURORA
Quantity: 200 MT STEEL COILS`,
      findings: `FINDING_ID: F0
STATUS: FATAL
CONFIDENCE: HIGH
EVIDENCE: LC field :44F: "JEBEL ALI, UAE" vs B/L "Port of Discharge: DUBAI, UAE"
NOTES: Port of discharge mismatch — LC requires JEBEL ALI, B/L shows DUBAI

FINDING_ID: F1
STATUS: INFO
CONFIDENCE: HIGH
EVIDENCE: "GOLDEN STAR METALS FZE" matches across LC and B/L
NOTES: Parties match

FINDING_ID: F2
STATUS: INFO
CONFIDENCE: HIGH
EVIDENCE: "USD 85,000.00" consistent
NOTES: Amounts within tolerance`,
    }),
    groundTruth: {
      scenario: "Port mismatch — B/L vs LC",
      expectedVerdict: "NO_GO",
      mustMention: ["JEBEL ALI", "DUBAI", "port"],
      mustNotMention: ["expired", "days remaining"],
    },
  },
  {
    input: makePrompt({
      docCount: 2,
      docTypes: "Letter Of Credit, Commercial Invoice",
      primaryType: "letter_of_credit",
      docs: `--- LETTER OF CREDIT ---
:20: LC-2024-003
:32B: USD 150,000.00
:31D: 240815 LONDON
:44E: MUMBAI, INDIA
:44F: FELIXSTOWE, UK
:45A: 10,000 PIECES COTTON FABRIC
:59: RAJESH TEXTILES PVT LTD

--- COMMERCIAL INVOICE ---
Invoice No: INV-2024-0891
Seller: RAJESH TEXTILES PVT LTD
Buyer: BRITANNIA IMPORTS LTD
Total Amount: USD 162,500.00
Goods: 10,000 PIECES COTTON FABRIC`,
      findings: `FINDING_ID: F0
STATUS: FATAL
CONFIDENCE: HIGH
EVIDENCE: Invoice "Total Amount: USD 162,500.00" vs LC ":32B: USD 150,000.00"
NOTES: Invoice amount USD 162,500 exceeds LC amount USD 150,000 by 8.3% (tolerance: 5%)

FINDING_ID: F1
STATUS: INFO
CONFIDENCE: HIGH
EVIDENCE: "RAJESH TEXTILES PVT LTD" matches across LC and Invoice
NOTES: Parties match

FINDING_ID: F2
STATUS: INFO
CONFIDENCE: HIGH
EVIDENCE: Ports consistent
NOTES: Ports match`,
    }),
    groundTruth: {
      scenario: "Amount mismatch — invoice vs LC",
      expectedVerdict: "NO_GO",
      mustMention: ["150,000", "162,500", "amount"],
      mustNotMention: ["expired"],
    },
  },
  {
    input: makePrompt({
      docCount: 2,
      docTypes: "Letter Of Credit, Bill Of Lading",
      primaryType: "letter_of_credit",
      docs: `--- LETTER OF CREDIT ---
:20: LC-2024-004
:32B: USD 12,500,000.00
:31D: 240930 HOUSTON
:44E: PLAQUEMINES, LOUISIANA
:44F: DAHEJ, INDIA
:45A: LNG (LIQUEFIED NATURAL GAS) - ONE SHIPMENT
:59: IRH GLOBAL TRADING LTD

--- BILL OF LADING ---
Shipper: VENTURE GLOBAL PLAQUEMINES LLC
Consignee: TO ORDER OF STATE BANK OF INDIA
Port of Loading: PLAQUEMINES, LOUISIANA
Port of Discharge: DAHEJ, INDIA
Vessel: LNG CARRIER SERI BAKTI
Cargo: LNG (LIQUEFIED NATURAL GAS)
Quantity: APPROX 65,000 CBM`,
      findings: `FINDING_ID: F0
STATUS: OBSERVATION
CONFIDENCE: HIGH
EVIDENCE: LC ":59: IRH GLOBAL TRADING LTD" vs B/L "Shipper: VENTURE GLOBAL PLAQUEMINES LLC"
NOTES: Shipper differs from LC beneficiary — common in commodity/energy trades where manufacturer ships on behalf of trading house

FINDING_ID: F1
STATUS: INFO
CONFIDENCE: HIGH
EVIDENCE: All other fields consistent
NOTES: All other checks passed`,
    }),
    groundTruth: {
      scenario: "Shipper ≠ Beneficiary — normal in commodity trades",
      expectedVerdict: "GO",
      mustMention: ["shipper", "beneficiary"],
      mustNotMention: ["expired", "mismatch"],
    },
  },
  {
    input: makePrompt({
      docCount: 2,
      docTypes: "Letter Of Credit, Bill Of Lading",
      primaryType: "letter_of_credit",
      docs: `--- LETTER OF CREDIT ---
:20: LC-2024-005
:32B: USD 320,000.00
:31D: 240630 SINGAPORE
:44E: BUSAN, SOUTH KOREA
:44F: SINGAPORE
:43P: PARTIAL SHIPMENTS NOT ALLOWED
:45A: 1000 MT HDPE PELLETS
:59: KOREA PETROCHEMICAL IND CO LTD

--- BILL OF LADING ---
Shipper: KOREA PETROCHEMICAL IND CO LTD
Consignee: TO ORDER OF DBS BANK
Port of Loading: BUSAN, SOUTH KOREA
Port of Discharge: SINGAPORE
Vessel: HYUNDAI COURAGE
Shipment: 1 of 3
B/L Date: 2024-05-01
Quantity: 350 MT HDPE PELLETS`,
      findings: `FINDING_ID: F0
STATUS: FATAL
CONFIDENCE: HIGH
EVIDENCE: LC ":43P: PARTIAL SHIPMENTS NOT ALLOWED" vs B/L "Shipment: 1 of 3"
NOTES: Partial shipment not allowed per LC, but B/L shows 1 of 3 shipments

FINDING_ID: F1
STATUS: WARNING
CONFIDENCE: MEDIUM
EVIDENCE: "B/L Date: 2024-05-01"
NOTES: Documents presented 18 days after B/L date (within 21-day limit but tight)

FINDING_ID: F2
STATUS: INFO
CONFIDENCE: HIGH
EVIDENCE: "KOREA PETROCHEMICAL IND CO LTD" matches across LC and B/L
NOTES: Parties match`,
    }),
    groundTruth: {
      scenario: "Multiple issues — partial shipment + stale docs",
      expectedVerdict: "NO_GO",
      mustMention: ["partial shipment"],
      mustNotMention: ["expired", "days remaining"],
    },
  },
];
