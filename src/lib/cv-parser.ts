import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const MAX_LENGTH = 15_000;

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_LENGTH);
}

export async function extractTextFromCV(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return cleanText(result.text);
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    if (!result.value && mimeType === "application/msword") {
      throw new Error(
        "Could not extract text from .doc file. Please convert to .docx or .pdf and re-upload."
      );
    }
    return cleanText(result.value);
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
