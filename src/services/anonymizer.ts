import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface PIIEntity {
  text: string;
  type: string;
  replacement: string;
  box_2d?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in normalized coordinates 0-1000
}

export interface AnonymizationResult {
  originalText?: string;
  anonymizedText: string;
  entities: PIIEntity[];
  imageData?: string; // Base64 image data for visual preview
}

/**
 * Anonymize a text document using Gemini.
 * Handles large documents by chunking.
 */
export async function anonymizeDocument(text: string): Promise<AnonymizationResult> {
  const model = "gemini-3-flash-preview";
  
  // Chunking logic for large documents
  const MAX_CHUNK_SIZE = 8000; 
  const chunks: string[] = [];
  
  if (text.length <= MAX_CHUNK_SIZE) {
    chunks.push(text);
  } else {
    let currentPos = 0;
    while (currentPos < text.length) {
      let endPos = currentPos + MAX_CHUNK_SIZE;
      if (endPos < text.length) {
        const lastNewline = text.lastIndexOf('\n', endPos);
        if (lastNewline > currentPos) {
          endPos = lastNewline;
        }
      }
      chunks.push(text.substring(currentPos, endPos));
      currentPos = endPos;
    }
  }

  const allEntities: PIIEntity[] = [];
  let fullAnonymizedText = "";

  for (const chunk of chunks) {
    const prompt = `
      You are a GDPR compliance expert. Your task is to identify all Personally Identifiable Information (PII) in the provided text and suggest anonymization replacements.
      
      Identify entities such as:
      - Full Names
      - Email Addresses
      - Phone Numbers
      - Physical Addresses
      - Social Security Numbers / ID Numbers
      - Dates of Birth
      - Bank Account Details
      
      Return a JSON object with:
      1. "anonymizedText": The text with PII replaced by placeholders like [NAME_1], [EMAIL_1], etc.
      2. "entities": A list of objects with "text" (original PII), "type" (category), and "replacement" (the placeholder used).
      
      Text to anonymize:
      """
      ${chunk}
      """
    `;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            anonymizedText: { type: Type.STRING },
            entities: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  type: { type: Type.STRING },
                  replacement: { type: Type.STRING }
                },
                required: ["text", "type", "replacement"]
              }
            }
          },
          required: ["anonymizedText", "entities"]
        }
      }
    });

    const result = JSON.parse(response.text);
    fullAnonymizedText += result.anonymizedText + (chunks.length > 1 ? "\n" : "");
    allEntities.push(...result.entities);
  }

  const uniqueEntities = Array.from(new Map(allEntities.map(e => [e.text + e.replacement, e])).values());

  return {
    originalText: text,
    anonymizedText: fullAnonymizedText,
    entities: uniqueEntities
  };
}

/**
 * Anonymize multimodal content (images or PDFs as images).
 * Returns bounding boxes for visual redaction.
 */
export async function anonymizeMultimodal(
  fileData: string, 
  mimeType: string,
  isImage: boolean
): Promise<AnonymizationResult> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    You are a world-class GDPR compliance expert and high-precision document redaction engine.
    Analyze this ${isImage ? 'image' : 'document'} (likely a scan or photo of an ID, passport, or official record).
    
    CRITICAL INSTRUCTIONS FOR SPATIAL ACCURACY:
    1. Coordinate System: Use a normalized coordinate system from 0 to 1000. [ymin, xmin, ymax, xmax].
    2. Precision: Bounding boxes (box_2d) MUST be extremely tight around the sensitive text. Do not include excessive margins.
    3. Completeness: Ensure ALL characters of a sensitive field are covered by the box.
    4. Passports: Redact the entire MRZ (Machine Readable Zone) at the bottom as one or two large blocks if it contains PII.
    5. Signatures: Identify and provide bounding boxes for handwritten signatures as [SIGNATURE].
    
    PII Categories to detect and redact:
    - Personal Names (Full names, initials)
    - Contact Info (Emails, Phone numbers, detailed Physical Addresses)
    - Identity Numbers (Passport numbers, ID card numbers, SSN, Driver's License, Tax IDs)
    - Dates (Date of Birth, Expiry dates if linked to ID)
    - Biometric/Demographic (Nationality, Gender, Place of Birth)
    - Visual PII (Handwritten signatures)
    
    Return a strictly valid JSON object:
    {
      "anonymizedText": "Reconstructed full text with placeholders like [NAME_1], [ADDRESS_1], etc.",
      "entities": [
        {
          "text": "Original sensitive text",
          "type": "Category (e.g., NAME, PASSPORT_NO, ADDRESS)",
          "replacement": "[PLACEHOLDER]",
          "box_2d": [ymin, xmin, ymax, xmax]
        }
      ]
    }
  `;

  const response = await ai.models.generateContent({
    model,
    contents: [
      { text: prompt },
      { inlineData: { data: fileData, mimeType } }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          anonymizedText: { type: Type.STRING },
          entities: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                type: { type: Type.STRING },
                replacement: { type: Type.STRING },
                box_2d: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                  description: "[ymin, xmin, ymax, xmax] normalized 0-1000"
                }
              },
              required: ["text", "type", "replacement"]
            }
          }
        },
        required: ["anonymizedText", "entities"]
      }
    }
  });

  const result = JSON.parse(response.text);
  return {
    anonymizedText: result.anonymizedText,
    entities: result.entities,
    imageData: isImage ? `data:${mimeType};base64,${fileData}` : undefined
  };
}
