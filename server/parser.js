export const parseInvoiceText = (text) => {
  const t = text || '';
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const find = (re) => {
    for (const l of lines) { const m = l.match(re); if (m) return m[1].trim(); }
    return null;
  };
  const amount = (value) => {
    const parsed = Number(value?.replace(/[,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const normalizeDate = (value) => {
    if (!value) return null;
    const numeric = value.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (numeric) {
      const [, first, second, third] = numeric;
      let year;
      let month;
      let day;
      if (first.length === 4) {
        year = Number(first);
        month = Number(second);
        day = Number(third);
      } else {
        day = Number(first);
        month = Number(second);
        year = Number(third);
        if (year < 100) year += year < 70 ? 2000 : 1900;
      }
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
        return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      }
      return null;
    }
    const named = value.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/)
      || value.match(/^([A-Za-z]{3,9})[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/);
    if (!named) return null;
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const day = Number(named[1].match(/^\d/) ? named[1] : named[2]);
    const monthName = named[1].match(/^\d/) ? named[2] : named[1];
    const year = Number(named[3]);
    const month = months.findIndex((item) => monthName.toLowerCase().startsWith(item)) + 1;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (month > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }
    return null;
  };

  const invoiceNumber =
    find(/(?:invoice\s*(?:no|#|number|num)\s*[:#.]?\s*)([A-Z0-9][A-Z0-9\-/_]+)/i) ||
    find(/(?:^|\s)invoice\s+(?!date\b|total\b|copy\b|due\b)([A-Z0-9][A-Z0-9\-/_]+)/i);
  const poNumber =
    find(/(?:purchase\s*order\s*(?:no|#|po)\s*[:#.]?\s*)([A-Z0-9][A-Z0-9\-/_]+)/i) ||
    find(/(?:^|\s)po\s*(?:no|#)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/_]+)/i);
  const vendor = find(/(?:vendor|supplier|billed\s+by|from)\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9 &.,'()\-]{1,119})/i);
  const date = find(/(?:invoice\s*date|dated)\s*[:#.]?\s*(\d{1,4}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}[\s-]+[A-Za-z]{3,9}[\s,-]+\d{4}|[A-Za-z]{3,9}[\s-]+\d{1,2},?[\s-]+\d{4})/i);
  const total = find(/(?:grand\s+total|total\s*(?:amount|due)?)\s*[:#.]?\s*(?:₹|INR|Rs\.?|USD|EUR)?\s*([0-9][0-9,\s]*(?:\.\d{1,2})?)/i);
  const subtotal = find(/(?:sub\s*total|taxable\s+amount)\s*[:#.]?\s*(?:₹|INR|Rs\.?|USD|EUR)?\s*([0-9][0-9,\s]*(?:\.\d{1,2})?)/i);
  const tax = find(/(?:GST|IGST|CGST|SGST|VAT|tax)\s*(?:amount)?\s*[:#.]?\s*(?:₹|INR|Rs\.?|USD|EUR)?\s*([0-9][0-9,\s]*(?:\.\d{1,2})?)/i);
  const currencyLabel = find(/(?:currency)\s*[:#.]?\s*([A-Z]{3})/i);
  const currencySymbol = /(?:₹|\bINR\b|\bRs\.?\b)/i.test(t) ? 'INR'
    : /\bUSD\b|\$/i.test(t) ? 'USD'
      : /\bEUR\b|€/i.test(t) ? 'EUR' : null;
  const bankName = find(/(?:bank(?:\s+name)?)\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9 &.'\-]+)/i);
  const account = find(/(?:account\s*(?:no|number)?\s*[:#]?\s*)([0-9Xx]{4,})/i);
  const ifsc = find(/(?:IFSC\s*[:#]?\s*)([A-Z0-9]{4,}[A-Z0-9]*)/i);
  const normalizedDate = normalizeDate(date);
  const extractedCount = [invoiceNumber, vendor, poNumber, normalizedDate, total].filter(Boolean).length;

  return {
    invoice_number: invoiceNumber,
    vendor: vendor,
    purchase_order: poNumber,
    invoice_date: normalizedDate,
    due_date: null,
    currency: currencyLabel || currencySymbol,
    subtotal: amount(subtotal),
    tax: amount(tax),
    total: amount(total),
    confidence: Math.min(70, extractedCount * 14),
    review_reason: 'Extracted with local OCR/parser. Review all fields before approving.',
    line_items: [],
    bank_details: (bankName || account || ifsc) ? {
      name: bankName,
      account: account || null,
      ifsc: ifsc || null,
      branch: null,
    } : null,
    asset_details: [],
  };
};

function parsePurchaseOrderText(text) {
  const invoiceFields = parseInvoiceText(text);
  const lines = (text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const find = (pattern) => {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  };
  const parseAmount = (value) => {
    const amount = Number(value?.replace(/[,\s]/g, ''));
    return Number.isFinite(amount) ? amount : null;
  };
  const orderNumber = find(/(?:purchase\s*order|order|PO)\s*(?:number|no\.?|#)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/_]+)/i);
  const orderDate = find(/(?:order\s*date|PO\s*date|date\s*of\s*order)\s*[:#.]?\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i);
  const deliveryDate = find(/(?:expected\s+delivery|delivery\s+date|deliver\s+by|ship\s+date)\s*[:#.]?\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i);
  const totalText = find(/(?:order\s+total|grand\s+total|total\s+(?:amount|value))\s*[:#.]?\s*(?:₹|INR|Rs\.?|USD|EUR)?\s*([0-9][0-9,\s]*(?:\.\d{1,2})?)/i);
  const fields = {
    purchase_order_number: orderNumber || invoiceFields.purchase_order,
    vendor: invoiceFields.vendor,
    order_date: orderDate ? parseInvoiceText(`Invoice Date: ${orderDate}`).invoice_date : invoiceFields.invoice_date,
    delivery_date: deliveryDate ? parseInvoiceText(`Invoice Date: ${deliveryDate}`).invoice_date : null,
    currency: invoiceFields.currency,
    total: parseAmount(totalText) ?? invoiceFields.total,
  };
  const confidence = Math.min(70, Object.values(fields).filter((value) => value !== null).length * 14);
  return {
    ...fields,
    confidence,
    review_reason: 'Extracted locally with OCR and field rules. Verify all values against the purchase order.',
  };
}

function parseAssetText(text) {
  const lines = (text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const find = (pattern) => {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  };
  const manufacturer = find(/(?:manufacturer|make|brand)\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9 &.'()\-]{1,79})/i);
  const model = find(/(?:model(?:\s*(?:no|number))?|product\s*name)\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9 &.,/'()\-]{1,99})/i);
  const serialNumber = find(/(?:serial(?:\s*(?:no|number|#))?|s\/n|service\s*tag)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-]{2,39})/i);
  const assetTag = find(/(?:asset\s*(?:tag|id|number)|tag\s*no)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/_]{2,39})/i);
  const employee = find(/(?:assigned\s*to|employee\s*name|custodian)\s*[:#.]?\s*([A-Za-z][A-Za-z .'-]{1,79})/i);
  const fields = { manufacturer, model, serial_number: serialNumber, asset_tag: assetTag, assigned_to: employee };
  const foundCount = Object.values(fields).filter(Boolean).length;
  return {
    assets: foundCount ? [fields] : [],
    confidence: Math.min(70, foundCount * 18),
    review_reason: foundCount
      ? 'Extracted locally with OCR and field rules. Verify the serial number and model against the physical asset.'
      : 'No labeled serial number or asset fields were found. Check the OCR text and enter the details manually.',
  };
}

export function parseDocumentText(text, documentType) {
  const type = ['INVOICE', 'PURCHASE_ORDER', 'RECEIPT', 'WARRANTY', 'OTHER'].includes(documentType)
    ? documentType
    : 'OTHER';
  const fields = type === 'INVOICE'
    ? parseInvoiceText(text)
    : type === 'PURCHASE_ORDER'
      ? parsePurchaseOrderText(text)
      : parseAssetText(text);
  return {
    document_type: type,
    extraction_method: 'Local CPU OCR + rules',
    ...fields,
    raw_text: (text || '').slice(0, 100000),
  };
}