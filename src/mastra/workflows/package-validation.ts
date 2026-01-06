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
    "certificateNumber": "SGS-2024-001"
  },
  "analysis": "Brief analysis of this document's completeness and any internal issues."
}

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
  }),
  execute: async ({ inputData }) => {
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
      // Check if quantities vary by more than 5% (typical LC tolerance)
      const baseQty = quantities[0].numeric;
      const tolerance = 0.05;
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
          description: `Quantity mismatch across documents (exceeds 5% tolerance)`,
        });
      }
    }

    // Cross-reference goods description (UCP 600 Article 18(c))
    // Invoice description must match LC exactly; B/L can be general
    const goodsDescriptions: { doc: string; value: string }[] = [];

    // Only check core commercial docs for goods description
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
        goodsDescriptions.push({ doc: docName, value: doc.extractedData.goodsDescription! });
      }
    }

    // Helper to normalize goods description for comparison
    const normalizeGoods = (desc: string): string => {
      return desc.toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")  // Remove punctuation
        .replace(/\s+/g, " ")          // Normalize whitespace
        .trim();
    };

    // Helper to check if goods descriptions match (LC is the reference)
    const goodsMatch = (lcDesc: string, otherDesc: string): boolean => {
      const lcNorm = normalizeGoods(lcDesc);
      const otherNorm = normalizeGoods(otherDesc);

      if (lcNorm === otherNorm) return true;

      // Check if other contains all key words from LC
      // E.g., LC: "MURBAN CRUDE OIL" should match Invoice: "MURBAN CRUDE OIL API 40.2"
      const lcWords = lcNorm.split(" ").filter(w => w.length > 2);
      const otherWords = otherNorm.split(" ");
      const allLcWordsPresent = lcWords.every(word => otherWords.includes(word));

      if (allLcWordsPresent) return true;

      // Check if LC desc is contained in other (other has more detail)
      if (otherNorm.includes(lcNorm)) return true;

      return false;
    };

    if (goodsDescriptions.length >= 2) {
      // LC description is the reference per UCP 600
      const lcGoods = goodsDescriptions.find(g => g.doc === "LETTER OF CREDIT");

      if (lcGoods) {
        const mismatches = goodsDescriptions.filter(g => {
          if (g.doc === "LETTER OF CREDIT") return false; // Don't compare LC to itself
          return !goodsMatch(lcGoods.value, g.value);
        });

        if (mismatches.length > 0) {
          crossRefIssues.push({
            field: "goodsDescription",
            documents: goodsDescriptions.map((g) => g.doc),
            values: goodsDescriptions.map((g) => `${g.doc}: ${g.value}`),
            severity: "critical",
            description: `Goods description mismatch - UCP 600 Article 18(c) requires invoice to match LC exactly`,
          });
        }
      }
    }

    return {
      crossRefIssues,
      documentResults,
    };
  },
});

// Step 4: Determine final verdict
const finalVerdictStep = createStep({
  id: "final-verdict",
  inputSchema: z.object({
    crossRefIssues: z.array(crossRefIssueSchema),
    documentResults: z.array(documentResultSchema),
  }),
  outputSchema: z.object({
    overallVerdict: z.enum(["GO", "WAIT", "NO_GO"]),
    documentResults: z.array(documentResultSchema),
    crossReferenceIssues: z.array(crossRefIssueSchema),
    recommendation: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { documentResults, crossRefIssues } = inputData;

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
  }),
  outputSchema: z.object({
    packageId: z.string(),
    overallVerdict: z.enum(["GO", "WAIT", "NO_GO"]),
    documentResults: z.array(documentResultSchema),
    crossReferenceIssues: z.array(crossRefIssueSchema),
    recommendation: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { overallVerdict, documentResults, crossReferenceIssues, recommendation } = inputData;

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
  }),
})
  .then(prepareDocsStep)
  .foreach(analyzeDocStep, { concurrency: 5 })
  .then(crossReferenceStep)
  .then(finalVerdictStep)
  .then(recordPackageStep)
  .commit();
