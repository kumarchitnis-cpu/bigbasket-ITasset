import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('tesseract.js');
console.log('exports:', Object.keys(T).join(', '));