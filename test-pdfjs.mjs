import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist');
if (!Promise.try) {
  Promise.try = function(fn, ...args) {
    try { return Promise.resolve(fn(...args)); } catch (e) { return Promise.reject(e); }
  };
}
pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.min.mjs';
const pdf = new Uint8Array(Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 20 80 Td (Hello World Test) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000282 00000 n \n0000000370 00000 n \nstartxref\n463\n%%EOF'));
const doc = await pdfjs.getDocument({ data: pdf }).promise;
const page = await doc.getPage(1);
const tc = await page.getTextContent();
const text = tc.items.map(i => i.str).join(' ');
console.log('TEXT:', text);
await doc.destroy();