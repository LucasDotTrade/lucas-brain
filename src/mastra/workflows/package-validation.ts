import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import postgres from "postgres";
import OpenAI from "openai";

const sql = postgres(process.env.DATABASE_URL!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================================
// Deterministic Date Extraction (regex-based, not LLM-dependent)
// ============================================================

const MONTH_MAP: Record<string, string> = {
  january: "01", jan: "01",
  february: "02", feb: "02",
  march: "03", mar: "03",
  april: "04", apr: "04",
  may: "05",
  june: "06", jun: "06",
  july: "07", jul: "07",
  august: "08", aug: "08",
  september: "09", sep: "09", sept: "09",
  october: "10", oct: "10",
  november: "11", nov: "11",
  december: "12", dec: "12",
};

/**
 * Parse various date formats to ISO (YYYY-MM-DD)
 * Handles: "15 February 2026", "Feb 15, 2026", "2026-02-15", "15/02/2026"
 */
function parseToISODate(dateStr: string): string | null {
  if (!dateStr) return null;
  const s = dateStr.trim();

  // Already ISO format: 2026-02-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY or DD-MM-YYYY
  let match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // "15 February 2026" or "February 15, 2026" or "15 Feb 2026"
  match = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (match) {
    const [, d, monthName, y] = match;
    const m = MONTH_MAP[monthName.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, "0")}`;
  }

  // "February 15, 2026" or "Feb 15 2026"
  match = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (match) {
    const [, monthName, d, y] = match;
    const m = MONTH_MAP[monthName.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, "0")}`;
  }

  return null;
}

/**
 * Extract critical dates from LC text using regex (deterministic)
 */
function extractDatesFromText(text: string): { latestShipmentDate?: string; expiryDate?: string; shipmentDate?: string } {
  const result: { latestShipmentDate?: string; expiryDate?: string; shipmentDate?: string } = {};
  const upper = text.toUpperCase();

  // Latest Shipment Date patterns
  const latestShipmentPatterns = [
    /LATEST\s+SHIPMENT\s+DATE[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$|PLACE|GOODS|PORT)/i,
    /LAST\s+DATE\s+(?:OF\s+)?SHIPMENT[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$)/i,
    /LATEST\s+DATE\s+(?:OF\s+)?SHIPMENT[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$)/i,
    /SHIPMENT[:\s]+(?:ON\s+OR\s+BEFORE|NOT\s+LATER\s+THAN)\s+([A-Za-z0-9\s,\/\-]+?)(?:\n|$)/i,
  ];

  for (const pattern of latestShipmentPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const parsed = parseToISODate(match[1].trim());
      if (parsed) {
        result.latestShipmentDate = parsed;
        break;
      }
    }
  }

  // Expiry Date patterns
  const expiryPatterns = [
    /EXPIRY\s+DATE[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$|PLACE)/i,
    /DATE\s+OF\s+EXPIRY[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$)/i,
    /EXPIRES?\s+(?:ON)?[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$)/i,
    /VALID\s+UNTIL[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$)/i,
  ];

  for (const pattern of expiryPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const parsed = parseToISODate(match[1].trim());
      if (parsed) {
        result.expiryDate = parsed;
        break;
      }
    }
  }

  // B/L Shipment Date patterns (for bill of lading)
  const shipmentPatterns = [
    /SHIPPED\s+ON\s+BOARD\s+DATE[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$)/i,
    /SHIPPED\s+ON\s+BOARD[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$)/i,
    /ON\s+BOARD\s+DATE[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$)/i,
    /DATE\s+OF\s+SHIPMENT[:\s]+([A-Za-z0-9\s,\/\-]+?)(?:\n|$)/i,
  ];

  for (const pattern of shipmentPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const parsed = parseToISODate(match[1].trim());
      if (parsed) {
        result.shipmentDate = parsed;
        break;
      }
    }
  }

  return result;
}

// ============================================================
// Shared schemas
const documentTypeEnum = z.enum([
  // Core documents
  "letter_of_credit",
  "bill_of_lading",
  "commercial_invoice",
  "packing_list",
  "certificate_of_origin",
  // O&G specific documents
  "certificate_of_quality",
  "certificate_of_quantity",
  "insurance_certificate",
  "inspection_certificate",
  "bill_of_exchange",
  "beneficiary_certificate",
  "vessel_nomination",
  "ullage_report",
  "tank_calibration_certificate",
  "loading_certificate",
  "weight_certificate",
  "non_manipulation_certificate",
  "notice_of_readiness",
  "letter_of_indemnity",
  "weight_out_turn",
  "export_license",
  "certificate_of_ownership",
  "cargo_manifest",
  "vessel_q88",
  "time_log",
  "masters_receipt",
  "tank_cleanliness_certificate",
  "charter_party",
  "dip_test_report",
]);

const issueSchema = z.object({
  type: z.string(),
  severity: z.enum(["minor", "major", "critical"]),
  description: z.string(),
});

const extractedDataSchema = z.object({
  // Core fields
  amount: z.string().optional(),
  currency: z.string().optional(),
  beneficiary: z.string().optional(),
  applicant: z.string().optional(),
  portOfLoading: z.string().optional(),
  portOfDischarge: z.string().optional(),
  goodsDescription: z.string().optional(),
  quantity: z.string().optional(),
  weight: z.string().optional(),
  expiryDate: z.string().optional(),
  latestShipmentDate: z.string().optional(),
  shipmentDate: z.string().optional(),
  vesselName: z.string().optional(),
  blNumber: z.string().optional(),
  lcNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  // O&G specific fields
  apiGravity: z.string().optional(),
  sulfurContent: z.string().optional(),
  vesselImo: z.string().optional(),
  inspectionCompany: z.string().optional(),
  loadingDate: z.string().optional(),
  insuredValue: z.string().optional(),
  certificateNumber: z.string().optional(),
  // New fields for O&G validation
  requiredInspectionCompany: z.string().optional(), // From LC: "SGS" or "Bureau Veritas"
  consignee: z.string().optional(),                 // From B/L: "TO ORDER OF BANK X"
  quantityTolerance: z.string().optional(),         // From LC: "+/- 10%" or "5 PCT MORE OR LESS"
  shippedOnBoard: z.boolean().optional(),           // From B/L: true if "SHIPPED ON BOARD" present
  issuingBank: z.string().optional(),               // From LC: bank that issued the LC
  // LOI (Letter of Indemnity) fields
  loiBeneficiary: z.string().optional(),            // Who is indemnified (carrier or bank)
  loiIndemnifier: z.string().optional(),            // Who gives indemnity (buyer/applicant)
  loiVesselName: z.string().optional(),             // Vessel referenced in LOI
  loiBlNumber: z.string().optional(),               // B/L number being replaced
  loiCargoDescription: z.string().optional(),       // Cargo description in LOI
  loiIndemnityValue: z.string().optional(),         // Indemnity amount (e.g., "200% of cargo value")
  // WOT (Weight Out-Turn) fields
  wotLoadingWeight: z.string().optional(),          // Weight at loading port
  wotDischargeWeight: z.string().optional(),        // Weight at discharge port
  wotDifference: z.string().optional(),             // Shortage or overage
  wotVesselName: z.string().optional(),             // Vessel name in WOT
  wotCargoDescription: z.string().optional(),       // Cargo description in WOT
  // Export License fields
  exportLicenseNumber: z.string().optional(),       // License/permit number
  exportLicenseExporter: z.string().optional(),     // Authorized exporter
  exportLicenseGoods: z.string().optional(),        // Goods description
  exportLicenseDestination: z.string().optional(),  // Permitted destination
  exportLicenseValidUntil: z.string().optional(),   // Expiry date
  // Certificate of Ownership fields
  ownershipSeller: z.string().optional(),           // Seller/transferor
  ownershipBuyer: z.string().optional(),            // Buyer/transferee
  ownershipVessel: z.string().optional(),           // Vessel name
  ownershipCargo: z.string().optional(),            // Cargo description
  // Tank Cleanliness fields
  tankCleanlinessVessel: z.string().optional(),     // Vessel name
  tankCleanlinessDate: z.string().optional(),       // Inspection date
  tankCleanlinessInspector: z.string().optional(),  // Inspector/surveyor
  // B/L freight and carrier fields (UCP 600 compliance)
  freightNotation: z.string().optional(),           // "FREIGHT PREPAID" or "FREIGHT COLLECT"
  carrierName: z.string().optional(),               // Shipping line name (e.g., "CMA CGM", "Maersk")
  carrierSignature: z.boolean().optional(),         // true if signed by carrier/master/agent
  // Additional date fields for consistency checks
  invoiceDate: z.string().optional(),               // Invoice issue date
  issueDate: z.string().optional(),                 // Generic issue date for certificates
  inspectionDate: z.string().optional(),            // Inspection certificate date

  // ============================================================
  // LINE ITEM ARRAYS - For deterministic math verification
  // LLMs extract the rows, JavaScript sums them
  // ============================================================

  // Packing List line items (for weight verification)
  packingListItems: z.array(z.object({
    description: z.string().optional(),
    cartons: z.number().optional(),
    netWeight: z.number(),      // REQUIRED - the weight value for this row
    grossWeight: z.number().optional(),
  })).optional().describe("Extract ALL rows from packing list table"),
  packingListTotalNet: z.number().optional().describe("Printed 'Total Net Weight' at bottom"),
  packingListTotalGross: z.number().optional().describe("Printed 'Total Gross Weight' at bottom"),

  // Ullage Report line items (tank volumes)
  ullageItems: z.array(z.object({
    tankName: z.string().optional(),   // e.g., "1P", "2S", "3C"
    volume: z.number(),                 // REQUIRED - volume in this tank
    temperature: z.number().optional(),
  })).optional().describe("Extract ALL tank measurements from ullage report"),
  ullageTotalVolume: z.number().optional().describe("Printed 'Total' volume at bottom"),

  // Invoice line items (for amount verification)
  invoiceLineItems: z.array(z.object({
    description: z.string().optional(),
    quantity: z.number().optional(),
    unitPrice: z.number().optional(),
    lineTotal: z.number(),              // REQUIRED - amount for this line
  })).optional().describe("Extract ALL line items from invoice"),
  invoicePrintedTotal: z.number().optional().describe("Printed 'Total Amount' at bottom"),
});

const documentResultSchema = z.object({
  type: documentTypeEnum,
  verdict: z.enum(["GO", "WAIT", "NO_GO"]),
  issues: z.array(issueSchema),
  extractedData: extractedDataSchema,
  analysis: z.string(),
  rawText: z.string().optional(), // Keep raw text for deterministic checks
});

const crossRefIssueSchema = z.object({
  field: z.string(),
  documents: z.array(z.string()),
  values: z.array(z.string()),
  severity: z.enum(["minor", "major", "critical"]),
  description: z.string(),
});

// Document input for foreach iteration
const docInputSchema = z.object({
  type: documentTypeEnum,
  text: z.string(),
  clientEmail: z.string(),
});

// Step 1: Prepare documents for parallel processing
const prepareDocsStep = createStep({
  id: "prepare-docs",
  inputSchema: z.object({
    documents: z.array(
      z.object({
        type: documentTypeEnum,
        text: z.string(),
      })
    ),
    clientEmail: z.string(),
    channel: z.enum(["email", "whatsapp"]),
  }),
  outputSchema: z.array(docInputSchema),
  execute: async ({ inputData }) => {
    // Add clientEmail to each document for the foreach step
    return inputData.documents.map((doc) => ({
      ...doc,
      clientEmail: inputData.clientEmail,
    }));
  },
});

// Step 2: Analyze individual document (used in foreach)
// Uses Haiku for extraction (~$0.0005/doc) instead of Sonnet (~$0.015/doc)
const analyzeDocStep = createStep({
  id: "analyze-doc",
  inputSchema: docInputSchema,
  outputSchema: documentResultSchema,
  execute: async ({ inputData, mastra }) => {
    // Use Haiku for fast/cheap extraction
    const extractor = mastra?.getAgent("haikuExtractor");
    if (!extractor) {
      throw new Error("Haiku extractor agent not found");
    }

    const threadId = `package-${Date.now()}-${inputData.clientEmail}`;

    const docTypeName = inputData.type.replace(/_/g, " ");
    const prompt = `You are analyzing a ${docTypeName} as part of a COMPLETE LC DOCUMENT PACKAGE. Other documents (LC, B/L, Invoice, certificates) are being analyzed separately - cross-reference checks happen later.

Your job: Extract data from THIS document and check its INTERNAL consistency only.

DOCUMENT:
${inputData.text}

Respond in this EXACT JSON format:
{
  "verdict": "GO" | "WAIT" | "NO_GO",
  "issues": [{"type": "issue_type", "severity": "minor|major|critical", "description": "..."}],
  "extractedData": {
    "amount": "USD 125,000.00",
    "currency": "USD",
    "beneficiary": "Company Name",
    "applicant": "Buyer Name",
    "portOfLoading": "Shanghai, China",
    "portOfDischarge": "Dubai, UAE",
    "goodsDescription": "Murban Crude Oil",
    "quantity": "500,000 BARRELS",
    "weight": "68,500 MT",
    "expiryDate": "2024-03-15",
    "latestShipmentDate": "2024-03-10",
    "shipmentDate": "2024-02-28",
    "vesselName": "MV Ocean Star",
    "blNumber": "BL-2024-001",
    "lcNumber": "LC-2024-00456",
    "invoiceNumber": "INV-2024-001",
    "apiGravity": "40.2",
    "sulfurContent": "0.75%",
    "vesselImo": "9876543",
    "inspectionCompany": "SGS",
    "loadingDate": "2024-02-28",
    "insuredValue": "USD 137,500.00",
    "certificateNumber": "SGS-2024-001",
    "requiredInspectionCompany": "SGS",
    "consignee": "TO ORDER OF NATIONAL BANK OF KUWAIT",
    "quantityTolerance": "+/- 10%",
    "shippedOnBoard": true,
    "issuingBank": "NATIONAL BANK OF KUWAIT",
    "loiBeneficiary": "PACIFIC OCEAN CARRIERS",
    "loiIndemnifier": "GULF ENERGY TRADING LLC",
    "loiVesselName": "MV Ocean Star",
    "loiBlNumber": "BL-2024-001",
    "loiCargoDescription": "Murban Crude Oil",
    "loiIndemnityValue": "200% of cargo value",
    "wotLoadingWeight": "68,500 MT",
    "wotDischargeWeight": "68,450 MT",
    "wotDifference": "50 MT shortage (0.07%)",
    "wotVesselName": "MV Ocean Star",
    "wotCargoDescription": "Murban Crude Oil",
    "exportLicenseNumber": "EXP-2024-00456",
    "exportLicenseExporter": "ADNOC TRADING LLC",
    "exportLicenseGoods": "Murban Crude Oil",
    "exportLicenseDestination": "Japan",
    "exportLicenseValidUntil": "2024-12-31",
    "ownershipSeller": "ADNOC TRADING LLC",
    "ownershipBuyer": "GULF ENERGY TRADING LLC",
    "ownershipVessel": "MV Ocean Star",
    "ownershipCargo": "Murban Crude Oil",
    "tankCleanlinessVessel": "MV Ocean Star",
    "tankCleanlinessDate": "2024-02-25",
    "tankCleanlinessInspector": "SGS Gulf Limited"
  },
  "analysis": "Brief analysis of this document's completeness and any internal issues."
}

SPECIAL EXTRACTION RULES:
- requiredInspectionCompany: ONLY from LC - look for "inspection by SGS" or "certificate issued by Bureau Veritas"
- consignee: ONLY from B/L - extract the "TO ORDER OF [BANK]" or "CONSIGNEE: [NAME]" field
- quantityTolerance: ONLY from LC - look for "+/- X%", "X PCT MORE OR LESS", or field 39A tolerance
- shippedOnBoard: ONLY from B/L - true if "SHIPPED ON BOARD" or "LADEN ON BOARD" appears, false if only "RECEIVED FOR SHIPMENT"
- issuingBank: ONLY from LC - the bank that issued the credit
- vesselName: From LC if specified (look for "Vessel:", "Intended Vessel:", "Nominated Vessel:"). From B/L always (look for "Vessel:", "Ship:", "MV", "MT")
- insuredValue: ONLY from Insurance Certificate - look for "Sum Insured:", "Amount Insured:", "Insured Value:", or "Coverage Amount:"
- loiBeneficiary: ONLY from LOI - party being indemnified (carrier, bank, terminal). Look for "indemnify", "hold harmless"
- loiIndemnifier: ONLY from LOI - party giving indemnity. Look for "we hereby", "the undersigned"
- loiVesselName: ONLY from LOI - vessel name referenced
- loiBlNumber: ONLY from LOI - the B/L number being replaced or referenced
- loiIndemnityValue: ONLY from LOI - indemnity amount or percentage (e.g., "200% of cargo value", "USD 5,000,000")
- wotLoadingWeight: ONLY from WOT - weight at loading. Look for "Loaded:", "Loading figure:", "Ship figure at loading:"
- wotDischargeWeight: ONLY from WOT - weight at discharge. Look for "Discharged:", "Outturn:", "Ship figure at discharge:"
- wotDifference: ONLY from WOT - calculated shortage/overage. Look for "Shortage:", "Overage:", "Difference:", "Loss:"
- exportLicenseNumber: ONLY from Export License - the license/permit number
- exportLicenseExporter: ONLY from Export License - authorized exporter name
- exportLicenseGoods: ONLY from Export License - goods description
- exportLicenseDestination: ONLY from Export License - permitted destination country
- exportLicenseValidUntil: ONLY from Export License - expiry/validity date
- ownershipSeller: ONLY from Certificate of Ownership - seller/transferor name
- ownershipBuyer: ONLY from Certificate of Ownership - buyer/transferee name
- ownershipVessel: ONLY from Certificate of Ownership - vessel name
- ownershipCargo: ONLY from Certificate of Ownership - cargo description
- tankCleanlinessVessel: ONLY from Tank Cleanliness Cert - vessel name
- tankCleanlinessDate: ONLY from Tank Cleanliness Cert - inspection date
- tankCleanlinessInspector: ONLY from Tank Cleanliness Cert - inspector/surveyor name
- freightNotation: ONLY from B/L - look for "FREIGHT PREPAID", "FREIGHT COLLECT", "PREPAID", "COLLECT"
- carrierName: ONLY from B/L - the shipping line or carrier name (e.g., "CMA CGM", "Maersk", "MSC", "Hapag-Lloyd")
- carrierSignature: ONLY from B/L - true if document shows signature by carrier, master, or agent (look for "As Agent for Carrier", "For the Master", "Signed by", signature line)
- invoiceDate: ONLY from Invoice - the invoice issue date
- issueDate: From any certificate - the issue/certification date
- inspectionDate: ONLY from Inspection Certificate - the date inspection was performed

LINE ITEM EXTRACTION (CRITICAL FOR MATH VERIFICATION):
- packingListItems: ONLY from Packing List - Extract EVERY row from the table as an array. Each row needs at minimum the netWeight (as a NUMBER, not string). Example: [{"description": "Avocados Grade A", "cartons": 100, "netWeight": 980.5, "grossWeight": 1050.2}, ...]
- packingListTotalNet: ONLY from Packing List - The printed "Total Net Weight" at the bottom (as NUMBER)
- packingListTotalGross: ONLY from Packing List - The printed "Total Gross Weight" at the bottom (as NUMBER)
- ullageItems: ONLY from Ullage Report - Extract EVERY tank measurement as an array. Each needs at minimum the volume (as NUMBER). Example: [{"tankName": "1P", "volume": 11287.40}, {"tankName": "2S", "volume": 10007.00}, ...]
- ullageTotalVolume: ONLY from Ullage Report - The printed "Total" volume at the bottom (as NUMBER)
- invoiceLineItems: ONLY from Invoice - Extract EVERY line item as an array. Each needs at minimum lineTotal (as NUMBER). Example: [{"description": "Crude Oil", "quantity": 500000, "unitPrice": 75.50, "lineTotal": 37750000}, ...]
- invoicePrintedTotal: ONLY from Invoice - The printed "Total Amount" at the bottom (as NUMBER)

RULES:
- Extract ALL fields present in the document
- Only flag issues WITHIN this document (missing signatures, invalid dates, internal math errors)
- Do NOT complain about missing LC/Invoice/B/L - those are separate documents in the package
- Verdict GO = document is complete and internally consistent
- Verdict WAIT = minor issues or missing optional fields
- Verdict NO_GO = critical internal problems (corrupted, unsigned, invalid dates)

CRITICAL FOR BENEFICIARY FIELD:
- For LC: beneficiary = the seller/exporter receiving payment
- For B/L: beneficiary = the SHIPPER (NOT the consignee - consignee is often "to order of bank")
- For Invoice: beneficiary = the seller issuing the invoice
- For Certificates: beneficiary = the party who requested/benefits from the certificate`;

    const response = await extractor.generate(prompt, {
      // No memory for extraction - pure stateless extraction
    });

    // Parse JSON from response
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Run deterministic date extraction (override LLM for critical dates)
        const deterministicDates = extractDatesFromText(inputData.text);
        const extractedData = parsed.extractedData || {};

        // Use deterministic dates if found, otherwise fall back to LLM
        if (deterministicDates.latestShipmentDate) {
          extractedData.latestShipmentDate = deterministicDates.latestShipmentDate;
        }
        if (deterministicDates.expiryDate) {
          extractedData.expiryDate = deterministicDates.expiryDate;
        }
        if (deterministicDates.shipmentDate) {
          extractedData.shipmentDate = deterministicDates.shipmentDate;
        }

        return {
          type: inputData.type,
          verdict: parsed.verdict || "WAIT",
          issues: parsed.issues || [],
          extractedData,
          analysis: parsed.analysis || response.text,
          rawText: inputData.text, // Keep for cross-reference
        };
      }
    } catch (e) {
      // Fallback if JSON parsing fails
    }

    // Even on fallback, try deterministic extraction
    const deterministicDates = extractDatesFromText(inputData.text);

    return {
      type: inputData.type,
      verdict: "WAIT" as const,
      issues: [],
      extractedData: {
        latestShipmentDate: deterministicDates.latestShipmentDate,
        expiryDate: deterministicDates.expiryDate,
        shipmentDate: deterministicDates.shipmentDate,
      },
      analysis: response.text,
      rawText: inputData.text,
    };
  },
});

// Step 3: Cross-reference all documents
const crossReferenceStep = createStep({
  id: "cross-reference",
  inputSchema: z.array(documentResultSchema),
  outputSchema: z.object({
    crossRefIssues: z.array(crossRefIssueSchema),
    documentResults: z.array(documentResultSchema),
    paymentMode: z.enum(["lc", "no_lc"]),
  }),
  execute: async ({ inputData, mastra }) => {
    const documentResults = inputData;
    const crossRefIssues: z.infer<typeof crossRefIssueSchema>[] = [];

    // Helper to normalize values for comparison
    const normalize = (val: string | undefined): string => {
      if (!val) return "";
      return val.toLowerCase().replace(/[^a-z0-9]/g, "");
    };

    // Helper to extract core port name (for fuzzy matching)
    // "JEBEL DHANNA, ABU DHABI, UAE" -> "jebel dhanna"
    // "JEBEL DHANNA TERMINAL" -> "jebel dhanna"
    // "MINA AL AHMADI, KUWAIT" -> "mina al ahmadi"
    const extractCorePort = (val: string | undefined): string => {
      if (!val) return "";
      let port = val.toLowerCase().trim();
      // Remove country suffixes
      port = port.replace(/,?\s*(uae|india|china|kuwait|qatar|saudi arabia|oman|bahrain|singapore|malaysia|indonesia|usa|uk|germany|netherlands|france|italy|spain)\.?$/i, "");
      // Remove common suffixes
      port = port.replace(/\s*(terminal|port|harbour|harbor|anchorage|roadstead)\.?$/i, "");
      // Take text before first comma (e.g., "JEBEL DHANNA, ABU DHABI" -> "JEBEL DHANNA")
      port = port.split(",")[0].trim();
      // Normalize whitespace
      port = port.replace(/\s+/g, " ");
      return port;
    };

    // Check if two port names likely refer to the same port
    const portsMatch = (port1: string, port2: string): boolean => {
      const core1 = extractCorePort(port1);
      const core2 = extractCorePort(port2);
      if (!core1 || !core2) return true; // Empty = no mismatch
      if (core1 === core2) return true;
      // Check if one contains the other (handles "JEBEL DHANNA" vs "JEBEL DHANNA FREE ZONE")
      if (core1.includes(core2) || core2.includes(core1)) return true;
      // Check first two words match (handles minor variations)
      const words1 = core1.split(" ").slice(0, 2).join(" ");
      const words2 = core2.split(" ").slice(0, 2).join(" ");
      if (words1 === words2 && words1.length >= 4) return true;
      return false;
    };

    // Extract core company name (remove legal suffixes)
    // "ADNOC TRADING LLC" -> "adnoc trading"
    // "KPC TRADING LIMITED" -> "kpc trading"
    const extractCoreName = (val: string | undefined): string => {
      if (!val) return "";
      let name = val.toLowerCase().trim();
      // Remove legal entity suffixes
      name = name.replace(/\s*(llc|ltd|limited|inc|incorporated|corp|corporation|co|company|plc|gmbh|ag|sa|srl|bv|nv|pty|pvt|private)\.?$/gi, "");
      // Remove trailing punctuation
      name = name.replace(/[.,;:]+$/, "").trim();
      return name;
    };

    // Check if two names likely refer to the same entity
    const namesMatch = (name1: string, name2: string): boolean => {
      const core1 = extractCoreName(name1);
      const core2 = extractCoreName(name2);
      if (!core1 || !core2) return true; // Empty = no mismatch
      if (core1 === core2) return true;
      // Check if one contains the other
      if (core1.includes(core2) || core2.includes(core1)) return true;
      // Check normalized versions (no spaces/punctuation)
      const norm1 = core1.replace(/[^a-z0-9]/g, "");
      const norm2 = core2.replace(/[^a-z0-9]/g, "");
      if (norm1 === norm2) return true;
      return false;
    };

    // Helper to extract numeric amount
    const extractAmount = (val: string | undefined): number | null => {
      if (!val) return null;
      const match = val.replace(/,/g, "").match(/[\d.]+/);
      return match ? parseFloat(match[0]) : null;
    };

    // Get documents by type
    const lc = documentResults.find((d) => d.type === "letter_of_credit");
    const bl = documentResults.find((d) => d.type === "bill_of_lading");
    const invoice = documentResults.find((d) => d.type === "commercial_invoice");

    // Simple: LC present or not - no keyword parsing
    const hasLC = !!lc;
    const paymentMode: "lc" | "no_lc" = hasLC ? "lc" : "no_lc";

    // Cross-reference amounts
    const amounts: { doc: string; value: number }[] = [];
    if (lc?.extractedData.amount) {
      const amt = extractAmount(lc.extractedData.amount);
      if (amt) amounts.push({ doc: "LC", value: amt });
    }
    if (invoice?.extractedData.amount) {
      const amt = extractAmount(invoice.extractedData.amount);
      if (amt) amounts.push({ doc: "Invoice", value: amt });
    }

    if (amounts.length >= 2) {
      const lcAmt = amounts.find((a) => a.doc === "LC")?.value;
      const invAmt = amounts.find((a) => a.doc === "Invoice")?.value;
      if (lcAmt && invAmt && invAmt > lcAmt) {
        crossRefIssues.push({
          field: "amount",
          documents: ["LC", "Invoice"],
          values: amounts.map((a) => `${a.doc}: ${a.value}`),
          severity: "critical",
          description: `Invoice amount exceeds LC amount. LC: ${lcAmt}, Invoice: ${invAmt}`,
        });
      }
    }

    // Cross-reference ports
    const portsOfLoading: { doc: string; value: string }[] = [];
    const portsOfDischarge: { doc: string; value: string }[] = [];

    // Helper to check if a value is actually specified (not empty/n/a/not specified)
    const isSpecified = (val: string | undefined): boolean => {
      if (!val) return false;
      const lower = val.toLowerCase().trim();
      if (lower === "" || lower === "n/a" || lower === "na" || lower === "not specified" || lower === "not applicable" || lower === "none" || lower === "-") {
        return false;
      }
      return true;
    };

    // Only cross-reference ports from documents that have actual loading/discharge port fields
    // Exclude docs where "location" or "country" might be wrongly extracted as port
    const portRelevantDocTypes = [
      "letter_of_credit", "bill_of_lading", "commercial_invoice",
      "certificate_of_origin", "insurance_certificate", "inspection_certificate",
      "loading_certificate", "vessel_nomination"
    ];

    for (const doc of documentResults) {
      const docName = doc.type.replace(/_/g, " ").toUpperCase();
      // Only include port-relevant doc types in cross-reference
      if (!portRelevantDocTypes.includes(doc.type)) continue;

      if (isSpecified(doc.extractedData.portOfLoading)) {
        portsOfLoading.push({ doc: docName, value: doc.extractedData.portOfLoading! });
      }
      if (isSpecified(doc.extractedData.portOfDischarge)) {
        portsOfDischarge.push({ doc: docName, value: doc.extractedData.portOfDischarge! });
      }
    }

    // Check port of loading consistency (using fuzzy matching)
    if (portsOfLoading.length >= 2) {
      const basePort = portsOfLoading[0].value;
      const mismatches = portsOfLoading.filter((p) => !portsMatch(basePort, p.value));
      if (mismatches.length > 0) {
        crossRefIssues.push({
          field: "portOfLoading",
          documents: portsOfLoading.map((p) => p.doc),
          values: portsOfLoading.map((p) => `${p.doc}: ${p.value}`),
          severity: "major",
          description: `Port of loading mismatch across documents`,
        });
      }
    }

    // Check port of discharge consistency (using fuzzy matching)
    if (portsOfDischarge.length >= 2) {
      const basePort = portsOfDischarge[0].value;
      const mismatches = portsOfDischarge.filter((p) => !portsMatch(basePort, p.value));
      if (mismatches.length > 0) {
        crossRefIssues.push({
          field: "portOfDischarge",
          documents: portsOfDischarge.map((p) => p.doc),
          values: portsOfDischarge.map((p) => `${p.doc}: ${p.value}`),
          severity: "major",
          description: `Port of discharge mismatch across documents`,
        });
      }
    }

    // Cross-reference beneficiary names
    // Only include docs where "beneficiary" means the LC beneficiary (seller/exporter)
    // Exclude third-party certs (SGS, DNV) where LLM extracts the issuer instead
    const beneficiaryRelevantDocTypes = [
      "letter_of_credit",
      "commercial_invoice",
      "bill_of_lading",
      "packing_list",
      "certificate_of_origin",
      "insurance_certificate",
      "beneficiary_certificate",
      "non_manipulation_certificate",
    ];

    const beneficiaries: { doc: string; value: string }[] = [];
    for (const doc of documentResults) {
      if (!beneficiaryRelevantDocTypes.includes(doc.type)) continue;
      const docName = doc.type.replace(/_/g, " ").toUpperCase();
      if (isSpecified(doc.extractedData.beneficiary)) {
        beneficiaries.push({ doc: docName, value: doc.extractedData.beneficiary! });
      }
    }

    if (beneficiaries.length >= 2) {
      const baseName = beneficiaries[0].value;
      const mismatches = beneficiaries.filter((b) => !namesMatch(baseName, b.value));
      if (mismatches.length > 0) {
        crossRefIssues.push({
          field: "beneficiary",
          documents: beneficiaries.map((b) => b.doc),
          values: beneficiaries.map((b) => `${b.doc}: ${b.value}`),
          severity: "critical",
          description: `Beneficiary name mismatch - banks will reject`,
        });
      }
    }

    // Cross-reference LC numbers
    // Exclude docs that may have their own reference numbers (not LC numbers)
    const lcNumberRelevantDocTypes = [
      "letter_of_credit",
      "commercial_invoice",
      "bill_of_lading",
      "packing_list",
      "certificate_of_origin",
      "insurance_certificate",
      "bill_of_exchange",
      "beneficiary_certificate",
      "non_manipulation_certificate",
    ];

    const lcNumbers: { doc: string; value: string }[] = [];
    for (const doc of documentResults) {
      if (!lcNumberRelevantDocTypes.includes(doc.type)) continue;
      const docName = doc.type.replace(/_/g, " ").toUpperCase();
      if (isSpecified(doc.extractedData.lcNumber)) {
        lcNumbers.push({ doc: docName, value: doc.extractedData.lcNumber! });
      }
    }

    if (lcNumbers.length >= 2) {
      const normalized = lcNumbers.map((l) => normalize(l.value));
      const unique = [...new Set(normalized)];
      if (unique.length > 1) {
        crossRefIssues.push({
          field: "lcNumber",
          documents: lcNumbers.map((l) => l.doc),
          values: lcNumbers.map((l) => `${l.doc}: ${l.value}`),
          severity: "critical",
          description: `LC number mismatch - documents reference different LCs`,
        });
      }
    }

    // LC-specific checks (only if LC document present)
    if (paymentMode === "lc") {
      // Check shipment date vs LC expiry
      if (bl?.extractedData.shipmentDate && lc?.extractedData.expiryDate) {
        const shipDate = new Date(bl.extractedData.shipmentDate);
        const expDate = new Date(lc.extractedData.expiryDate);
        if (!isNaN(shipDate.getTime()) && !isNaN(expDate.getTime()) && shipDate > expDate) {
          crossRefIssues.push({
            field: "dates",
            documents: ["LC", "B/L"],
            values: [`LC Expiry: ${lc.extractedData.expiryDate}`, `Shipment: ${bl.extractedData.shipmentDate}`],
            severity: "critical",
            description: `Shipment date is after LC expiry - presentation will be rejected`,
          });
        }
      }

      // Check if LC is expired (expiry date < today)
      if (lc?.extractedData.expiryDate) {
        const expDate = new Date(lc.extractedData.expiryDate);
        const today = new Date();
        if (!isNaN(expDate.getTime()) && expDate < today) {
          crossRefIssues.push({
            field: "lcExpiry",
            documents: ["LC"],
            values: [`LC Expiry: ${lc.extractedData.expiryDate}`, `Today: ${today.toISOString().split('T')[0]}`],
            severity: "critical",
            description: `LC expired on ${lc.extractedData.expiryDate} - cannot present documents`,
          });
        }
      }

      // Check if shipment is after LC latest shipment date
      if (bl?.extractedData.shipmentDate && lc?.extractedData.latestShipmentDate) {
        const shipDate = new Date(bl.extractedData.shipmentDate);
        const latestDate = new Date(lc.extractedData.latestShipmentDate);
        if (!isNaN(shipDate.getTime()) && !isNaN(latestDate.getTime()) && shipDate > latestDate) {
          crossRefIssues.push({
            field: "lateShipment",
            documents: ["LC", "B/L"],
            values: [`LC Latest Shipment: ${lc.extractedData.latestShipmentDate}`, `B/L Shipped: ${bl.extractedData.shipmentDate}`],
            severity: "critical",
            description: `Shipment date ${bl.extractedData.shipmentDate} is after LC latest shipment date ${lc.extractedData.latestShipmentDate} - bank will reject`,
          });
        }
      }
    }

    // Cross-reference quantities across documents
    const quantities: { doc: string; value: string; numeric: number }[] = [];
    const extractQty = (val: string | undefined): number | null => {
      if (!val) return null;
      // Extract numeric value, handling formats like "432,850 BARRELS", "500 MT", "68,500.00 MT"
      const match = val.replace(/,/g, "").match(/([\d.]+)/);
      return match ? parseFloat(match[1]) : null;
    };

    for (const doc of documentResults) {
      const docName = doc.type.replace(/_/g, " ").toUpperCase();
      if (isSpecified(doc.extractedData.quantity)) {
        const qty = extractQty(doc.extractedData.quantity);
        if (qty && qty > 0) {
          quantities.push({ doc: docName, value: doc.extractedData.quantity!, numeric: qty });
        }
      }
    }

    if (quantities.length >= 2) {
      // Extract tolerance from LC if specified, otherwise default to 5%
      let tolerance = 0.05; // Default UCP 600 tolerance
      let toleranceSource = "UCP 600 default 5%";

      if (lc?.extractedData.quantityTolerance) {
        const tolStr = lc.extractedData.quantityTolerance;
        // Parse tolerance: "+/- 10%", "10 PCT", "5 PERCENT MORE OR LESS"
        const tolMatch = tolStr.match(/([\d.]+)\s*(%|PCT|PERCENT)/i);
        if (tolMatch) {
          tolerance = parseFloat(tolMatch[1]) / 100;
          toleranceSource = `LC specified ${tolStr}`;
        }
      }

      const baseQty = quantities[0].numeric;
      const mismatches = quantities.filter((q) => {
        const diff = Math.abs(q.numeric - baseQty) / baseQty;
        return diff > tolerance;
      });

      if (mismatches.length > 0) {
        crossRefIssues.push({
          field: "quantity",
          documents: quantities.map((q) => q.doc),
          values: quantities.map((q) => `${q.doc}: ${q.value}`),
          severity: "major",
          description: `Quantity mismatch across documents (exceeds ${(tolerance * 100).toFixed(0)}% tolerance - ${toleranceSource})`,
        });
      }
    }

    // Cross-reference goods description per UCP 600:
    // - Article 18(c): Invoice must "correspond" with LC (strict)
    // - Article 19: B/L can use "general terms not inconsistent" with LC (lenient)
    const goodsDescriptions: { doc: string; docType: string; value: string }[] = [];

    const goodsDescRelevantDocTypes = [
      "letter_of_credit",
      "commercial_invoice",
      "bill_of_lading",
      "packing_list",
    ];

    for (const doc of documentResults) {
      if (!goodsDescRelevantDocTypes.includes(doc.type)) continue;
      const docName = doc.type.replace(/_/g, " ").toUpperCase();
      if (isSpecified(doc.extractedData.goodsDescription)) {
        goodsDescriptions.push({
          doc: docName,
          docType: doc.type,
          value: doc.extractedData.goodsDescription!
        });
      }
    }

    // Semantic comparison using Haiku - handles any product type
    // Replaces hardcoded product categories with LLM understanding
    const compareGoodsDescriptions = async (
      lcDesc: string,
      otherDesc: string,
      docType: "invoice" | "bl"
    ): Promise<{ matches: boolean; reason?: string }> => {
      const extractor = mastra?.getAgent("haikuExtractor");
      if (!extractor) {
        // Fallback: flag for review if Haiku unavailable
        return { matches: false, reason: "Unable to verify goods description - Haiku unavailable" };
      }

      const rule = docType === "invoice"
        ? "UCP 600 Article 18(c): Invoice must 'correspond' with LC - all key product descriptors (grade, type, specification) must match. Missing descriptors = mismatch."
        : "UCP 600 Article 19: B/L can use general terms, only fails if describing a completely different product category.";

      const prompt = `Compare these goods descriptions for a Letter of Credit presentation.

LC description: "${lcDesc}"
${docType === "invoice" ? "Invoice" : "B/L"} description: "${otherDesc}"

Rule: ${rule}

Examples:
- LC "MURBAN CRUDE OIL" vs Invoice "CRUDE OIL" → mismatch (invoice missing grade "MURBAN")
- LC "MURBAN CRUDE OIL" vs B/L "CRUDE OIL" → match (B/L can use general terms)
- LC "MURBAN CRUDE OIL" vs B/L "FROZEN BEEF" → mismatch (different product entirely)
- LC "FROZEN BEEF CUTS" vs Invoice "BEEF CUTS FROZEN" → match (same words, different order)

Respond with JSON only:
{"matches": true or false, "reason": "one sentence explanation"}`;

      try {
        const response = await extractor.generate(prompt, {});
        const jsonStr = response.text.replace(/```json\n?|\n?```/g, "").trim();
        const json = JSON.parse(jsonStr);
        return { matches: Boolean(json.matches), reason: json.reason };
      } catch {
        // Fallback: flag for review if Haiku fails
        return { matches: false, reason: "Unable to verify goods description - manual review recommended" };
      }
    };

    if (goodsDescriptions.length >= 2) {
      const lcGoods = goodsDescriptions.find(g => g.docType === "letter_of_credit");

      if (lcGoods) {
        // Compare all docs against LC in parallel
        const docsToCompare = goodsDescriptions.filter(g => g.docType !== "letter_of_credit");

        const comparisons = await Promise.all(
          docsToCompare.map(async (g) => {
            const docType = (g.docType === "commercial_invoice" || g.docType === "packing_list")
              ? "invoice" as const
              : "bl" as const;

            const result = await compareGoodsDescriptions(lcGoods.value, g.value, docType);

            return {
              doc: g.doc,
              docType: g.docType,
              severity: (docType === "invoice" ? "critical" : "major") as "critical" | "major",
              matches: result.matches,
              reason: result.reason || `${g.doc} doesn't match LC goods description`
            };
          })
        );

        const issues = comparisons.filter(c => !c.matches);

        if (issues.length > 0) {
          const hasCritical = issues.some(i => i.severity === "critical");
          crossRefIssues.push({
            field: "goodsDescription",
            documents: goodsDescriptions.map((g) => g.doc),
            values: goodsDescriptions.map((g) => `${g.doc}: ${g.value}`),
            severity: hasCritical ? "critical" : "major",
            description: issues.map(i => i.reason).join("; "),
          });
        }
      }
    }

    // LC-specific inspection and consignee checks (only if LC document present)
    if (paymentMode === "lc") {
      // Cross-reference inspection company (if LC specifies one)
      if (lc?.extractedData.requiredInspectionCompany) {
        const requiredCompany = lc.extractedData.requiredInspectionCompany.toLowerCase();
        const inspectionDocs = documentResults.filter(d =>
          ["inspection_certificate", "certificate_of_quality", "certificate_of_quantity"].includes(d.type) &&
          isSpecified(d.extractedData.inspectionCompany)
        );

        for (const doc of inspectionDocs) {
          const actualCompany = doc.extractedData.inspectionCompany!.toLowerCase();
          // Check if required company name appears in actual company
          if (!actualCompany.includes(requiredCompany) && !requiredCompany.includes(actualCompany)) {
            crossRefIssues.push({
              field: "inspectionCompany",
              documents: ["LC", doc.type.replace(/_/g, " ").toUpperCase()],
              values: [`LC requires: ${lc.extractedData.requiredInspectionCompany}`, `${doc.type.replace(/_/g, " ")}: ${doc.extractedData.inspectionCompany}`],
              severity: "critical",
              description: `LC requires inspection by ${lc.extractedData.requiredInspectionCompany} but certificate issued by ${doc.extractedData.inspectionCompany}`,
            });
          }
        }
      }

      // Cross-reference consignee/order party (B/L must be to order of issuing bank)
      if (bl?.extractedData.consignee && lc?.extractedData.issuingBank) {
        const consignee = bl.extractedData.consignee.toLowerCase();
        const issuingBank = lc.extractedData.issuingBank.toLowerCase();

        // B/L should be "to order" or "to order of [issuing bank]"
        const isToOrder = consignee.includes("to order");

        // Better matching: exclude common banking words, require distinctive words
        const commonWords = ["bank", "of", "the", "n.a.", "na", "ltd", "limited", "inc", "corp", "plc"];
        const bankDistinctiveWords = issuingBank.split(/\s+/)
          .filter(word => word.length > 2 && !commonWords.includes(word));

        // Check if consignee mentions issuing bank (exact or distinctive words)
        const mentionsIssuingBank = consignee.includes(issuingBank) ||
          bankDistinctiveWords.some(word => consignee.includes(word));

        if (!isToOrder) {
          crossRefIssues.push({
            field: "consignee",
            documents: ["B/L", "LC"],
            values: [`B/L Consignee: ${bl.extractedData.consignee}`, `LC Issuing Bank: ${lc.extractedData.issuingBank}`],
            severity: "critical",
            description: `B/L not made "to order" - should be "TO ORDER" or "TO ORDER OF ${lc.extractedData.issuingBank}" for LC presentation`,
          });
        } else if (consignee.includes("to order of") && !mentionsIssuingBank) {
          // B/L is "to order of [someone]" but not the issuing bank
          crossRefIssues.push({
            field: "consignee",
            documents: ["B/L", "LC"],
            values: [`B/L Consignee: ${bl.extractedData.consignee}`, `LC Issuing Bank: ${lc.extractedData.issuingBank}`],
            severity: "major",
            description: `B/L made to order of wrong party - should be "TO ORDER OF ${lc.extractedData.issuingBank}"`,
          });
        }
      }

      // Cross-reference vessel name (if LC specifies one)
      if (lc?.extractedData.vesselName && bl?.extractedData.vesselName) {
        const lcVessel = lc.extractedData.vesselName.toLowerCase().trim();
        const blVessel = bl.extractedData.vesselName.toLowerCase().trim();

        // Check if vessels match (allow for minor variations like "MV" prefix)
        const normalizeVessel = (v: string) => v.replace(/^(mv|m\/v|mt|m\.v\.)\s*/i, "").trim();
        const lcVesselNorm = normalizeVessel(lcVessel);
        const blVesselNorm = normalizeVessel(blVessel);

        if (lcVesselNorm !== blVesselNorm && !blVesselNorm.includes(lcVesselNorm) && !lcVesselNorm.includes(blVesselNorm)) {
          crossRefIssues.push({
            field: "vesselName",
            documents: ["LC", "B/L"],
            values: [`LC Vessel: ${lc.extractedData.vesselName}`, `B/L Vessel: ${bl.extractedData.vesselName}`],
            severity: "major",
            description: `Vessel name mismatch - LC specifies "${lc.extractedData.vesselName}" but B/L shows "${bl.extractedData.vesselName}"`,
          });
        }
      }

      // Cross-reference insurance value (must be >= 110% of invoice/LC amount)
      const insuranceCert = documentResults.find((d) => d.type === "insurance_certificate");
      if (insuranceCert?.extractedData.insuredValue) {
        const insuredAmt = extractAmount(insuranceCert.extractedData.insuredValue);
        const invoiceAmt = invoice?.extractedData.amount ? extractAmount(invoice.extractedData.amount) : null;
        const lcAmt = lc?.extractedData.amount ? extractAmount(lc.extractedData.amount) : null;
        const referenceAmt = invoiceAmt || lcAmt;

        if (insuredAmt && referenceAmt) {
          const minRequired = referenceAmt * 1.10; // 110% minimum
          if (insuredAmt < minRequired) {
            const coverage = ((insuredAmt / referenceAmt) * 100).toFixed(0);
            crossRefIssues.push({
              field: "insuranceValue",
              documents: ["Insurance Certificate", invoice ? "Invoice" : "LC"],
              values: [`Insured: ${insuranceCert.extractedData.insuredValue}`, `Reference: ${invoice?.extractedData.amount || lc?.extractedData.amount}`],
              severity: "major",
              description: `Insurance coverage insufficient - ${coverage}% of value (minimum 110% required for LC presentation)`,
            });
          }
        }
      }

      // LOI Cross-Reference Checks
      const loi = documentResults.find((d) => d.type === "letter_of_indemnity");
      if (loi) {
        // LOI vessel must match B/L vessel
        if (loi.extractedData.loiVesselName && bl?.extractedData.vesselName) {
          const loiVessel = loi.extractedData.loiVesselName.toLowerCase().replace(/^(mv|m\/v|mt|m\.t\.)\s*/i, "").trim();
          const blVessel = bl.extractedData.vesselName.toLowerCase().replace(/^(mv|m\/v|mt|m\.t\.)\s*/i, "").trim();
          if (loiVessel !== blVessel && !loiVessel.includes(blVessel) && !blVessel.includes(loiVessel)) {
            crossRefIssues.push({
              field: "loiVesselName",
              documents: ["LOI", "B/L"],
              values: [`LOI: ${loi.extractedData.loiVesselName}`, `B/L: ${bl.extractedData.vesselName}`],
              severity: "critical",
              description: "LOI vessel name does not match B/L — bank will reject",
            });
          }
        }

        // LOI B/L number must match actual B/L
        if (loi.extractedData.loiBlNumber && bl?.extractedData.blNumber) {
          const loiBl = loi.extractedData.loiBlNumber.toLowerCase().replace(/\s/g, "");
          const actualBl = bl.extractedData.blNumber.toLowerCase().replace(/\s/g, "");
          if (loiBl !== actualBl && !loiBl.includes(actualBl) && !actualBl.includes(loiBl)) {
            crossRefIssues.push({
              field: "loiBlNumber",
              documents: ["LOI", "B/L"],
              values: [`LOI references: ${loi.extractedData.loiBlNumber}`, `Actual B/L: ${bl.extractedData.blNumber}`],
              severity: "critical",
              description: "LOI references wrong B/L number",
            });
          }
        }
      }

      // WOT Cross-Reference Checks
      const wot = documentResults.find((d) => d.type === "weight_out_turn");
      if (wot) {
        // WOT loading weight should match B/L weight (within tolerance)
        if (wot.extractedData.wotLoadingWeight && bl?.extractedData.weight) {
          const wotLoading = extractAmount(wot.extractedData.wotLoadingWeight);
          const blWeight = extractAmount(bl.extractedData.weight);
          if (wotLoading && blWeight) {
            const diff = Math.abs(wotLoading - blWeight) / blWeight;
            if (diff > 0.005) { // 0.5% tolerance
              crossRefIssues.push({
                field: "wotLoadingWeight",
                documents: ["WOT", "B/L"],
                values: [`WOT Loading: ${wot.extractedData.wotLoadingWeight}`, `B/L Weight: ${bl.extractedData.weight}`],
                severity: "major",
                description: `WOT loading weight differs from B/L by ${(diff * 100).toFixed(2)}% (max 0.5% tolerance)`,
              });
            }
          }
        }

        // WOT shortage/overage check (typical tolerance 0.5% for crude)
        if (wot.extractedData.wotLoadingWeight && wot.extractedData.wotDischargeWeight) {
          const loading = extractAmount(wot.extractedData.wotLoadingWeight);
          const discharge = extractAmount(wot.extractedData.wotDischargeWeight);
          if (loading && discharge) {
            const loss = (loading - discharge) / loading;
            if (loss > 0.005) { // More than 0.5% shortage
              crossRefIssues.push({
                field: "wotShortage",
                documents: ["WOT"],
                values: [`Loading: ${wot.extractedData.wotLoadingWeight}`, `Discharge: ${wot.extractedData.wotDischargeWeight}`],
                severity: "major",
                description: `Transit loss of ${(loss * 100).toFixed(2)}% exceeds typical 0.5% tolerance — may trigger cargo claims`,
              });
            }
            if (loss < -0.003) { // Overage more than 0.3%
              crossRefIssues.push({
                field: "wotOverage",
                documents: ["WOT"],
                values: [`Loading: ${wot.extractedData.wotLoadingWeight}`, `Discharge: ${wot.extractedData.wotDischargeWeight}`],
                severity: "minor",
                description: `Discharge weight exceeds loading by ${(Math.abs(loss) * 100).toFixed(2)}% — unusual, verify measurements`,
              });
            }
          }
        }
      }

      // Export License Cross-Reference Checks
      const exportLic = documentResults.find((d) => d.type === "export_license");
      if (exportLic) {
        // Exporter should match LC beneficiary
        if (exportLic.extractedData.exportLicenseExporter && lc?.extractedData.beneficiary) {
          const licExporter = exportLic.extractedData.exportLicenseExporter.toLowerCase();
          const lcBenef = lc.extractedData.beneficiary.toLowerCase();
          if (!licExporter.includes(lcBenef.substring(0, 10)) && !lcBenef.includes(licExporter.substring(0, 10))) {
            crossRefIssues.push({
              field: "exportLicenseExporter",
              documents: ["Export License", "LC"],
              values: [`License: ${exportLic.extractedData.exportLicenseExporter}`, `LC Beneficiary: ${lc.extractedData.beneficiary}`],
              severity: "critical",
              description: "Export license exporter does not match LC beneficiary — sanctions risk",
            });
          }
        }

        // License must not be expired
        if (exportLic.extractedData.exportLicenseValidUntil) {
          const validUntil = new Date(exportLic.extractedData.exportLicenseValidUntil);
          const today = new Date();
          if (!isNaN(validUntil.getTime()) && validUntil < today) {
            crossRefIssues.push({
              field: "exportLicenseExpiry",
              documents: ["Export License"],
              values: [`Valid until: ${exportLic.extractedData.exportLicenseValidUntil}`],
              severity: "critical",
              description: "Export license has expired",
            });
          }
        }
      }

      // Certificate of Ownership Cross-Reference Checks
      const ownership = documentResults.find((d) => d.type === "certificate_of_ownership");
      if (ownership) {
        // Buyer should match LC applicant
        if (ownership.extractedData.ownershipBuyer && lc?.extractedData.applicant) {
          const certBuyer = ownership.extractedData.ownershipBuyer.toLowerCase();
          const lcApplicant = lc.extractedData.applicant.toLowerCase();
          if (!certBuyer.includes(lcApplicant.substring(0, 10)) && !lcApplicant.includes(certBuyer.substring(0, 10))) {
            crossRefIssues.push({
              field: "ownershipBuyer",
              documents: ["Certificate of Ownership", "LC"],
              values: [`Cert Buyer: ${ownership.extractedData.ownershipBuyer}`, `LC Applicant: ${lc.extractedData.applicant}`],
              severity: "major",
              description: "Ownership certificate buyer does not match LC applicant",
            });
          }
        }

        // Vessel should match B/L
        if (ownership.extractedData.ownershipVessel && bl?.extractedData.vesselName) {
          const certVessel = ownership.extractedData.ownershipVessel.toLowerCase().replace(/^(mv|m\/v|mt)\s*/i, "").trim();
          const blVessel = bl.extractedData.vesselName.toLowerCase().replace(/^(mv|m\/v|mt)\s*/i, "").trim();
          if (!certVessel.includes(blVessel) && !blVessel.includes(certVessel)) {
            crossRefIssues.push({
              field: "ownershipVessel",
              documents: ["Certificate of Ownership", "B/L"],
              values: [`Cert: ${ownership.extractedData.ownershipVessel}`, `B/L: ${bl.extractedData.vesselName}`],
              severity: "major",
              description: "Ownership certificate vessel does not match B/L",
            });
          }
        }
      }

      // Tank Cleanliness Cross-Reference Checks
      const tankClean = documentResults.find((d) => d.type === "tank_cleanliness_certificate");
      if (tankClean) {
        // Vessel must match B/L
        if (tankClean.extractedData.tankCleanlinessVessel && bl?.extractedData.vesselName) {
          const certVessel = tankClean.extractedData.tankCleanlinessVessel.toLowerCase().replace(/^(mv|m\/v|mt)\s*/i, "").trim();
          const blVessel = bl.extractedData.vesselName.toLowerCase().replace(/^(mv|m\/v|mt)\s*/i, "").trim();
          if (!certVessel.includes(blVessel) && !blVessel.includes(certVessel)) {
            crossRefIssues.push({
              field: "tankCleanlinessVessel",
              documents: ["Tank Cleanliness Cert", "B/L"],
              values: [`Cert: ${tankClean.extractedData.tankCleanlinessVessel}`, `B/L: ${bl.extractedData.vesselName}`],
              severity: "major",
              description: "Tank cleanliness certificate vessel does not match B/L",
            });
          }
        }

        // Tank inspection date must be BEFORE B/L date
        if (tankClean.extractedData.tankCleanlinessDate && bl?.extractedData.shipmentDate) {
          const inspDate = new Date(tankClean.extractedData.tankCleanlinessDate);
          const blDate = new Date(bl.extractedData.shipmentDate);
          if (!isNaN(inspDate.getTime()) && !isNaN(blDate.getTime()) && inspDate > blDate) {
            crossRefIssues.push({
              field: "tankCleanlinessDate",
              documents: ["Tank Cleanliness Cert", "B/L"],
              values: [`Inspection: ${tankClean.extractedData.tankCleanlinessDate}`, `B/L: ${bl.extractedData.shipmentDate}`],
              severity: "critical",
              description: "Tank cleanliness inspection dated AFTER B/L — logically impossible",
            });
          }
        }
      }

      // Vessel Name Cross-Reference for Other O&G Documents
      const vesselDocs: Array<{ type: string; name: string }> = [
        { type: "cargo_manifest", name: "Cargo Manifest" },
        { type: "vessel_q88", name: "Vessel Q88" },
        { type: "time_log", name: "Time Log" },
        { type: "masters_receipt", name: "Master's Receipt" },
        { type: "charter_party", name: "Charter Party" },
        { type: "dip_test_report", name: "Dip Test Report" },
      ];

      for (const vDoc of vesselDocs) {
        const doc = documentResults.find((d) => d.type === vDoc.type);
        if (doc?.extractedData.vesselName && bl?.extractedData.vesselName) {
          const docVessel = doc.extractedData.vesselName.toLowerCase().replace(/^(mv|m\/v|mt)\s*/i, "").trim();
          const blVessel = bl.extractedData.vesselName.toLowerCase().replace(/^(mv|m\/v|mt)\s*/i, "").trim();
          if (!docVessel.includes(blVessel) && !blVessel.includes(docVessel)) {
            crossRefIssues.push({
              field: `${vDoc.type}VesselName`,
              documents: [vDoc.name, "B/L"],
              values: [`${vDoc.name}: ${doc.extractedData.vesselName}`, `B/L: ${bl.extractedData.vesselName}`],
              severity: "major",
              description: `${vDoc.name} vessel does not match B/L`,
            });
          }
        }
      }

      // === GAP FIX 1: FREIGHT NOTATION CHECK ===
      // LC may specify "FREIGHT PREPAID" or "FREIGHT COLLECT" - B/L must match
      if (bl?.extractedData.freightNotation && lc?.extractedData.freightNotation) {
        const blFreight = bl.extractedData.freightNotation.toLowerCase();
        const lcFreight = lc.extractedData.freightNotation.toLowerCase();

        const blIsPrepaid = blFreight.includes("prepaid");
        const blIsCollect = blFreight.includes("collect");
        const lcIsPrepaid = lcFreight.includes("prepaid");
        const lcIsCollect = lcFreight.includes("collect");

        if ((blIsPrepaid && lcIsCollect) || (blIsCollect && lcIsPrepaid)) {
          crossRefIssues.push({
            field: "freightNotation",
            documents: ["B/L", "LC"],
            values: [`B/L: ${bl.extractedData.freightNotation}`, `LC: ${lc.extractedData.freightNotation}`],
            severity: "critical",
            description: "Freight notation mismatch — B/L shows different freight terms than LC requires",
          });
        }
      }

      // === GAP FIX 2: B/L CARRIER SIGNATURE CHECK ===
      // UCP 600 Article 20 requires B/L to be signed by carrier, master, or agent
      if (bl) {
        if (bl.extractedData.carrierSignature === false) {
          crossRefIssues.push({
            field: "carrierSignature",
            documents: ["B/L"],
            values: ["No carrier/master signature detected"],
            severity: "critical",
            description: "B/L must be signed by carrier, master, or named agent per UCP 600 Article 20",
          });
        }

        if (!bl.extractedData.carrierName) {
          crossRefIssues.push({
            field: "carrierName",
            documents: ["B/L"],
            values: ["Carrier name not found"],
            severity: "major",
            description: "B/L should indicate the name of the carrier per UCP 600",
          });
        }
      }

      // === GAP FIX 3: DOCUMENT DATING CONSISTENCY ===
      // All docs should have consistent/logical dates - certificates should not be dated after B/L
      const blDateStr = bl?.extractedData.shipmentDate;
      if (blDateStr) {
        const blDate = new Date(blDateStr);
        if (!isNaN(blDate.getTime())) {
          // Check inspection certificate date
          const inspectionCert = documentResults.find((d) => d.type === "inspection_certificate");
          if (inspectionCert?.extractedData.inspectionDate) {
            const inspDate = new Date(inspectionCert.extractedData.inspectionDate);
            if (!isNaN(inspDate.getTime()) && inspDate > blDate) {
              const daysDiff = (inspDate.getTime() - blDate.getTime()) / (1000 * 60 * 60 * 24);
              if (daysDiff > 1) {
                crossRefIssues.push({
                  field: "documentDating",
                  documents: ["Inspection Certificate", "B/L"],
                  values: [`Inspection: ${inspectionCert.extractedData.inspectionDate}`, `B/L: ${blDateStr}`],
                  severity: "major",
                  description: `Inspection certificate dated ${Math.floor(daysDiff)} days AFTER B/L — logically inconsistent`,
                });
              }
            }
          }

          // Check certificate of origin date
          const co = documentResults.find((d) => d.type === "certificate_of_origin");
          if (co?.extractedData.issueDate) {
            const coDate = new Date(co.extractedData.issueDate);
            if (!isNaN(coDate.getTime()) && coDate > blDate) {
              const daysDiff = (coDate.getTime() - blDate.getTime()) / (1000 * 60 * 60 * 24);
              if (daysDiff > 1) {
                crossRefIssues.push({
                  field: "documentDating",
                  documents: ["Certificate of Origin", "B/L"],
                  values: [`CO: ${co.extractedData.issueDate}`, `B/L: ${blDateStr}`],
                  severity: "major",
                  description: `Certificate of Origin dated ${Math.floor(daysDiff)} days AFTER B/L — logically inconsistent`,
                });
              }
            }
          }

          // Check quality certificate date
          const qualityCert = documentResults.find((d) => d.type === "certificate_of_quality");
          if (qualityCert?.extractedData.issueDate) {
            const qcDate = new Date(qualityCert.extractedData.issueDate);
            if (!isNaN(qcDate.getTime()) && qcDate > blDate) {
              const daysDiff = (qcDate.getTime() - blDate.getTime()) / (1000 * 60 * 60 * 24);
              if (daysDiff > 1) {
                crossRefIssues.push({
                  field: "documentDating",
                  documents: ["Certificate of Quality", "B/L"],
                  values: [`Quality Cert: ${qualityCert.extractedData.issueDate}`, `B/L: ${blDateStr}`],
                  severity: "major",
                  description: `Quality certificate dated ${Math.floor(daysDiff)} days AFTER B/L — logically inconsistent`,
                });
              }
            }
          }
        }
      }
    }

    // Non-LC mode: Check customs/export readiness instead of LC compliance
    if (paymentMode === "no_lc") {
      const hasInvoice = documentResults.some((d) => d.type === "commercial_invoice");
      const hasBL = documentResults.some((d) => d.type === "bill_of_lading");
      const hasCO = documentResults.some((d) => d.type === "certificate_of_origin");
      const hasPackingList = documentResults.some((d) => d.type === "packing_list");

      // Critical: Invoice and B/L required for cargo release
      if (!hasInvoice) {
        crossRefIssues.push({
          field: "customsReadiness",
          documents: ["Package"],
          values: ["Missing Commercial Invoice"],
          severity: "critical",
          description: "Commercial Invoice required for customs clearance",
        });
      }
      if (!hasBL) {
        crossRefIssues.push({
          field: "customsReadiness",
          documents: ["Package"],
          values: ["Missing Bill of Lading"],
          severity: "critical",
          description: "Bill of Lading required for cargo release",
        });
      }

      // Major: CO and Packing List typically needed
      if (!hasCO) {
        crossRefIssues.push({
          field: "customsReadiness",
          documents: ["Package"],
          values: ["Missing Certificate of Origin"],
          severity: "major",
          description: "Certificate of Origin typically required for customs clearance",
        });
      }
      if (!hasPackingList) {
        crossRefIssues.push({
          field: "customsReadiness",
          documents: ["Package"],
          values: ["Missing Packing List"],
          severity: "major",
          description: "Packing List helps customs verify cargo contents",
        });
      }
    }

    // Check for shipped-on-board notation (critical for oil trade)
    if (bl && bl.extractedData.shippedOnBoard === false) {
      crossRefIssues.push({
        field: "shippedOnBoard",
        documents: ["B/L"],
        values: ["B/L: RECEIVED FOR SHIPMENT (not shipped on board)"],
        severity: "critical",
        description: `B/L is "Received for Shipment" without shipped-on-board notation - bank will reject. Need dated on-board notation with vessel name.`,
      });
    }

    // ============================================================
    // DETERMINISTIC MATH VERIFICATION (JavaScript, not LLM)
    // LLMs extract rows, JavaScript sums them — no hallucination
    // ============================================================

    // Packing List weight verification
    const packingList = documentResults.find((d) => d.type === "packing_list");
    if (packingList?.extractedData.packingListItems && packingList.extractedData.packingListTotalNet) {
      const items = packingList.extractedData.packingListItems;
      const printedTotal = packingList.extractedData.packingListTotalNet;

      if (items.length > 0) {
        const calculatedSum = items.reduce((sum, item) => sum + (item.netWeight || 0), 0);
        const diff = Math.abs(calculatedSum - printedTotal);

        if (diff > 1.0) { // More than 1kg difference
          crossRefIssues.push({
            field: "packingListMath",
            documents: ["Packing List"],
            values: [
              `Rows sum to: ${calculatedSum.toFixed(2)} kg`,
              `Printed total: ${printedTotal.toFixed(2)} kg`,
              `Difference: ${diff.toFixed(2)} kg`,
            ],
            severity: "critical",
            description: `MATH ERROR: Packing list rows sum to ${calculatedSum.toFixed(2)} kg but printed total is ${printedTotal.toFixed(2)} kg — ${diff.toFixed(2)} kg discrepancy`,
          });
        }
      }
    }

    // Ullage Report volume verification
    const ullage = documentResults.find((d) => d.type === "ullage_report");
    if (ullage?.extractedData.ullageItems && ullage.extractedData.ullageTotalVolume) {
      const tanks = ullage.extractedData.ullageItems;
      const printedTotal = ullage.extractedData.ullageTotalVolume;

      if (tanks.length > 0) {
        const calculatedSum = tanks.reduce((sum, tank) => sum + (tank.volume || 0), 0);
        const diff = Math.abs(calculatedSum - printedTotal);
        const percentDiff = (diff / printedTotal) * 100;

        if (percentDiff > 0.1) { // More than 0.1% difference for oil volumes
          crossRefIssues.push({
            field: "ullageMath",
            documents: ["Ullage Report"],
            values: [
              `Tanks sum to: ${calculatedSum.toFixed(2)}`,
              `Printed total: ${printedTotal.toFixed(2)}`,
              `Difference: ${diff.toFixed(2)} (${percentDiff.toFixed(2)}%)`,
            ],
            severity: "critical",
            description: `MATH ERROR: Ullage tank volumes sum to ${calculatedSum.toFixed(2)} but printed total is ${printedTotal.toFixed(2)} — ${percentDiff.toFixed(2)}% discrepancy`,
          });
        }
      }
    }

    // Invoice line item verification
    if (invoice?.extractedData.invoiceLineItems && invoice.extractedData.invoicePrintedTotal) {
      const lineItems = invoice.extractedData.invoiceLineItems;
      const printedTotal = invoice.extractedData.invoicePrintedTotal;

      if (lineItems.length > 0) {
        const calculatedSum = lineItems.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
        const diff = Math.abs(calculatedSum - printedTotal);
        const percentDiff = (diff / printedTotal) * 100;

        if (diff > 1.0 && percentDiff > 0.01) { // More than $1 and 0.01% difference
          crossRefIssues.push({
            field: "invoiceMath",
            documents: ["Invoice"],
            values: [
              `Lines sum to: ${calculatedSum.toFixed(2)}`,
              `Printed total: ${printedTotal.toFixed(2)}`,
              `Difference: ${diff.toFixed(2)}`,
            ],
            severity: "critical",
            description: `MATH ERROR: Invoice line items sum to ${calculatedSum.toFixed(2)} but printed total is ${printedTotal.toFixed(2)} — possible fraud or typo`,
          });
        }
      }
    }

    return {
      crossRefIssues,
      documentResults,
      paymentMode,
    };
  },
});

// Step 4: Determine final verdict
const finalVerdictStep = createStep({
  id: "final-verdict",
  inputSchema: z.object({
    crossRefIssues: z.array(crossRefIssueSchema),
    documentResults: z.array(documentResultSchema),
    paymentMode: z.enum(["lc", "no_lc"]),
  }),
  outputSchema: z.object({
    overallVerdict: z.enum(["GO", "WAIT", "NO_GO"]),
    documentResults: z.array(documentResultSchema),
    crossReferenceIssues: z.array(crossRefIssueSchema),
    recommendation: z.string(),
    paymentMode: z.enum(["lc", "no_lc"]),
  }),
  execute: async ({ inputData }) => {
    const { documentResults, crossRefIssues, paymentMode } = inputData;

    // Check for critical issues
    const hasCriticalDocIssue = documentResults.some((d) =>
      d.issues.some((i) => i.severity === "critical")
    );
    const hasCriticalCrossRef = crossRefIssues.some((i) => i.severity === "critical");
    const hasNoGoVerdict = documentResults.some((d) => d.verdict === "NO_GO");

    // Check for major issues
    const hasMajorDocIssue = documentResults.some((d) =>
      d.issues.some((i) => i.severity === "major")
    );
    const hasMajorCrossRef = crossRefIssues.some((i) => i.severity === "major");
    const hasWaitVerdict = documentResults.some((d) => d.verdict === "WAIT");

    // Determine overall verdict
    let overallVerdict: "GO" | "WAIT" | "NO_GO";
    let recommendation: string;

    if (hasCriticalDocIssue || hasCriticalCrossRef || hasNoGoVerdict) {
      overallVerdict = "NO_GO";
      const criticalIssues = [
        ...documentResults.flatMap((d) =>
          d.issues.filter((i) => i.severity === "critical").map((i) => i.description)
        ),
        ...crossRefIssues.filter((i) => i.severity === "critical").map((i) => i.description),
      ];
      recommendation = `STOP - Critical issues found: ${criticalIssues.join("; ")}. Do not present to bank until resolved.`;
    } else if (hasMajorDocIssue || hasMajorCrossRef || hasWaitVerdict || crossRefIssues.length > 0) {
      overallVerdict = "WAIT";
      const majorIssues = [
        ...documentResults.flatMap((d) =>
          d.issues.filter((i) => i.severity === "major").map((i) => i.description)
        ),
        ...crossRefIssues.filter((i) => i.severity === "major").map((i) => i.description),
      ];
      recommendation = majorIssues.length > 0
        ? `REVIEW NEEDED - Issues found: ${majorIssues.join("; ")}. Request amendments before presentation.`
        : `REVIEW NEEDED - Minor cross-reference issues detected. Verify documents match before presentation.`;
    } else {
      overallVerdict = "GO";
      recommendation = `Package looks complete and consistent. Proceed with presentation to bank.`;
    }

    return {
      overallVerdict,
      documentResults,
      crossReferenceIssues: crossRefIssues,
      recommendation,
      paymentMode,
    };
  },
});

// Step 5: Record package to database
const recordPackageStep = createStep({
  id: "record-package",
  inputSchema: z.object({
    overallVerdict: z.enum(["GO", "WAIT", "NO_GO"]),
    documentResults: z.array(documentResultSchema),
    crossReferenceIssues: z.array(crossRefIssueSchema),
    recommendation: z.string(),
    paymentMode: z.enum(["lc", "no_lc"]),
  }),
  outputSchema: z.object({
    packageId: z.string(),
    overallVerdict: z.enum(["GO", "WAIT", "NO_GO"]),
    documentResults: z.array(documentResultSchema),
    crossReferenceIssues: z.array(crossRefIssueSchema),
    recommendation: z.string(),
    paymentMode: z.enum(["lc", "no_lc"]),
  }),
  execute: async ({ inputData }) => {
    const { overallVerdict, documentResults, crossReferenceIssues, recommendation, paymentMode } = inputData;

    // Create embedding for semantic search
    const embeddingText = [
      `Package validation: ${overallVerdict}`,
      `Documents: ${documentResults.map((d) => d.type).join(", ")}`,
      `Cross-reference issues: ${crossReferenceIssues.map((i) => i.description).join("; ")}`,
      recommendation,
    ].join("\n");

    let embedding: number[] | null = null;
    try {
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: embeddingText,
      });
      embedding = embeddingResponse.data[0].embedding;
    } catch (e) {
      console.error("Embedding failed:", e);
    }

    // Insert package record
    const packageId = crypto.randomUUID();

    // Use 'letter_of_credit' as document_type since 'package' isn't in enum
    // The issues JSON contains the full package details
    await sql`
      INSERT INTO cases (
        id, client_email, document_type, verdict, issues, advice_summary, embedding
      ) VALUES (
        ${packageId},
        'package-validation',
        'letter_of_credit',
        ${overallVerdict},
        ${JSON.stringify({
          documentResults: documentResults.map((d) => ({
            type: d.type,
            verdict: d.verdict,
            issues: d.issues,
          })),
          crossReferenceIssues,
        })},
        ${recommendation.substring(0, 500)},
        ${embedding ? JSON.stringify(embedding) : null}::vector
      )
    `;

    return {
      packageId,
      overallVerdict,
      documentResults,
      crossReferenceIssues,
      recommendation,
      paymentMode,
    };
  },
});

// Main workflow
export const packageValidationWorkflow = createWorkflow({
  id: "package-validation",
  inputSchema: z.object({
    documents: z.array(
      z.object({
        type: documentTypeEnum,
        text: z.string(),
      })
    ),
    clientEmail: z.string(),
    channel: z.enum(["email", "whatsapp"]),
  }),
  outputSchema: z.object({
    packageId: z.string(),
    overallVerdict: z.enum(["GO", "WAIT", "NO_GO"]),
    documentResults: z.array(documentResultSchema),
    crossReferenceIssues: z.array(crossRefIssueSchema),
    recommendation: z.string(),
    paymentMode: z.enum(["lc", "no_lc"]),
  }),
})
  .then(prepareDocsStep)
  .foreach(analyzeDocStep, { concurrency: 5 })
  .then(crossReferenceStep)
  .then(finalVerdictStep)
  .then(recordPackageStep)
  .commit();
