import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
import { getOcrCacheDir } from './db.js';

let workerPromise;
let ocrQueue = Promise.resolve();

/**
 * Extract raw text from a PDF or image.
 * - PDFs are read with pdf-parse.
 * - Images are read with tesseract.js OCR.
 * Returns the plain text string, or null if extraction fails.
 */
export async function extractRawText(dataUrl) {
  const match = /^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) return null;
  const [, mimeType, base64] = match;
  return extractRawTextFromBuffer(Buffer.from(base64, 'base64'), mimeType);
}

export async function extractRawTextFromBuffer(buffer, mimeType) {
  if (mimeType.toLowerCase() === 'application/pdf') return extractPdfText(buffer);
  if (['image/png', 'image/jpeg', 'image/webp'].includes(mimeType.toLowerCase())) {
    return extractImagesText([buffer]);
  }
  return null;
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    let text = '';
    try {
      const data = await parser.getText();
      text = (data.text || '').trim();
    } catch (error) {
      console.warn('Could not extract selectable text from PDF; trying OCR.', error.message);
    }
    const selectableText = text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, '').trim();
    if (selectableText.length >= 40) return selectableText;

    let screenshots;
    try {
      screenshots = await parser.getScreenshot({ first: 5, scale: 2, imageBuffer: true, imageDataUrl: false });
    } catch (error) {
      if (text) {
        console.warn('Could not render PDF pages for OCR; using its selectable text instead.', error.message);
        return selectableText;
      }
      throw error;
    }
    const pages = screenshots.pages.map((page) => page.data).filter(Boolean);
    if (pages.length === 0) return selectableText;
    const ocrText = await extractImagesText(pages);
    return ocrText.length > selectableText.length ? ocrText : selectableText;
  } finally {
    await parser.destroy();
  }
}

async function extractImagesText(images) {
  const T = require('tesseract.js');
  const task = ocrQueue.then(async () => {
    if (!workerPromise) {
      const workerOptions = {
        cachePath: getOcrCacheDir(),
        ...(process.env.TESSDATA_DIR ? { langPath: process.env.TESSDATA_DIR, gzip: false } : {}),
      };
      workerPromise = T.createWorker('eng', 1, workerOptions).catch((error) => {
        workerPromise = undefined;
        const ocrError = new Error('Local OCR could not initialize its English language model. Connect this server to the internet for its first scan, or install eng.traineddata in the OCR cache.');
        ocrError.status = 503;
        ocrError.cause = error;
        throw ocrError;
      });
    }
    const worker = await workerPromise;
    const recognizedPages = [];
    for (const image of images) {
      const { data } = await worker.recognize(image);
      if (data.text?.trim()) recognizedPages.push(data.text.trim());
    }
    return recognizedPages.join('\n');
  });
  ocrQueue = task.catch(() => {});
  try {
    return await task;
  } catch (error) {
    if (error.status) throw error;
    const ocrError = new Error('Local OCR could not read this document. Try a clearer PDF or image scan.');
    ocrError.status = 422;
    ocrError.cause = error;
    throw ocrError;
  }
}