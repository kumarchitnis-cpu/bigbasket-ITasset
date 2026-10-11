export const parseInvoiceText = (text) => {
  const t = text || '';
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const find = (re) => {
    for (const l of lines) { const m = l.match(re); if (m) return m[1].trim(); }
    return null;
  };

  const invoiceNumber =
    find(/(?:invoice\s*(?:no|#|number|num)\s*[:#]?\s*)([A-Z0-9][A-Z0-9\-/_]+)/i) ||
    find(/(?:^|\s)invoice\s+([A-Z0-9][A-Z0-9\-/_]+)/i);
  const poNumber =
    find(/(?:purchase\s*order\s*(?:no|#|po)\s*[:#]?\s*)([A-Z0-9][A-Z0-9\-/_]+)/i) ||
    find(/(?:^|\s)po\s*(?:no|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/_]+)/i);
  const vendor = find(/(?:vendor\s*[:#]?\s*)([A-Za-z0-9][A-Za-z0-9 &.'\-]+)/i);
  const date = find(/(?:invoice\s*date\s*[:#]?\s*)(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/i);
  const total = find(/(?:total\s*(?:amount)?\s*[:#]?\s*)([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  const bankName = find(/(?:bank\s*[:#]?\s*)([A-Za-z0-9][A-Za-z0-9 &.'\-]+)/i);
  const account = find(/(?:account\s*(?:no|number)?\s*[:#]?\s*)([0-9Xx]{4,})/i);
  const ifsc = find(/(?:IFSC\s*[:#]?\s*)([A-Z0-9]{4,}[A-Z0-9]*)/i);

  return {
    invoice_number: invoiceNumber,
    vendor: vendor,
    purchase_order: poNumber,
    invoice_date: date,
    due_date: null,
    currency: null,
    subtotal: null,
    tax: null,
    total: total ? Number(total.replace(/,/g, '')) : null,
    confidence: 0,
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