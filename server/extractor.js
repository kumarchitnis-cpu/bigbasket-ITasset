import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

/**
 * Extract raw text from a PDF or image.
 * - PDFs are read with pdf-parse.
 * - Images are read with tesseract.js OCR.
 * Returns the plain text string, or null if extraction fails.
 */
export async function extractRawText(dataUrl) {
  const match = /^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');

  if (mimeType === 'application/pdf') return extractPdfText(buffer);
  return extractImageText(buffer);
}

async function extractPdfText(buffer) {
  const parser = new PDFParse(new Uint8Array(buffer));
  try {
    const data = await parser.getText();
    return (data.text || '').trim();
  } finally {
    await parser.destroy();
  }
}

async function extractImageText(buffer) {
  const T = require('tesseract.js');
  const worker = await T.createWorker('eng');
  try {
    const scheduler = T.createScheduler();
    scheduler.addWorker(worker);
    const { data } = await T.recognize(buffer, 'eng', { scheduler });
    return (data.text || '').trim();
  } finally {
    await worker.terminate();
  }
}