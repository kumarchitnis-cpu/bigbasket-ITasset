const EXTRACTION_PROMPT = `Extract invoice details from this document. Return only valid JSON with this exact shape: {"invoice_number": string|null, "vendor": string|null, "purchase_order": string|null, "invoice_date": "YYYY-MM-DD"|null, "due_date": "YYYY-MM-DD"|null, "currency": string|null, "subtotal": number|null, "tax": number|null, "total": number|null, "line_items": [{"description": string|null, "hsn": string|null, "quantity": number|null, "unit_price": number|null, "total": number|null}], "bank_details": {"name": string|null, "account": string|null, "ifsc": string|null, "branch": string|null}, "asset_details": [{"manufacturer": string|null, "model": string|null, "serial_number": string|null}], "confidence": number, "review_reason": string|null}. Include all line items and asset details found; use empty arrays if none. Bank details must be null when not present. Confidence must be 0-100. Use review_reason for missing critical fields, unreadable values, or totals that do not reconcile. Never invent values.`;

function authHeader(apiKey) {
  return ['Bearer', apiKey].join(' ');
}

async function postChat(apiKey, body) {
  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: authHeader(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postResponses(apiKey, body) {
  return fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: authHeader(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function invoiceText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function invoiceNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function throwProviderError(response, featureName) {
  let providerError = null;
  try {
    const result = await response.json();
    providerError = result.error;
  } catch {
    providerError = null;
  }

  const code = providerError?.code;
  let message;
  if (response.status === 401) {
    message = `${featureName} is unavailable: the OpenAI API key is invalid.`;
  } else if (response.status === 429) {
    message = `${featureName} is temporarily unavailable because the AI service rate limit or quota was reached.`;
  } else if (response.status === 400 && featureName === 'AI invoice review') {
    message = 'The AI service could not read this file. Save it as a PDF, PNG, JPG, or WebP and try again.';
  } else {
    message = `${featureName} service returned an error (${response.status}${code ? `, ${code}` : ''}). Please try again later.`;
  }
  console.error(`${featureName} provider request failed`, { status: response.status, code: code || null });
  const error = new Error(message);
  error.status = response.status === 401 ? 503 : response.status === 429 ? 503 : 502;
  throw error;
}

export async function answerAssistant(question, workspaceSummary) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('AI Assistant is not configured for this workspace.');
    error.status = 503;
    throw error;
  }

  const response = await postChat(apiKey, {
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 600,
    messages: [
      {
        role: 'system',
        content: `You are the IT asset operations assistant. Answer concisely using only the provided aggregate workspace summary. Do not claim you changed records or can see individual employee data. If the summary does not answer the question, say what information is missing.\nWorkspace summary: ${JSON.stringify(workspaceSummary)}`,
      },
      { role: 'user', content: question },
    ],
  });

  if (!response.ok) await throwProviderError(response, 'AI Assistant');
  const result = await response.json();
  const answer = result.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) {
    const error = new Error('The AI Assistant returned an empty response.');
    error.status = 502;
    throw error;
  }
  return answer.trim();
}

export async function extractInvoice(fileDataUrl, filename) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('AI invoice review is not configured for this workspace.');
    error.status = 503;
    throw error;
  }

  const fileMatch = typeof fileDataUrl === 'string'
    ? /^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(fileDataUrl)
    : null;
  if (!fileMatch) {
    const error = new Error('Upload a valid PDF, PNG, JPG, or WebP invoice document.');
    error.status = 400;
    throw error;
  }
  const [, mimeType] = fileMatch;
  const safeFilename = String(filename || (mimeType === 'application/pdf' ? 'invoice.pdf' : 'invoice'))
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 120);

  const response = await postResponses(apiKey, {
    model: 'gpt-4o-mini',
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: EXTRACTION_PROMPT }],
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `Extract the invoice fields from ${safeFilename}.` },
          { type: 'input_file', filename: safeFilename, file_data: fileDataUrl, detail: 'high' },
        ],
      },
    ],
    text: { format: { type: 'json_object' } },
  });

  if (!response.ok) await throwProviderError(response, 'AI invoice review');

  const result = await response.json();
  const content = result.output_text
    || result.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
  if (!content) {
    const error = new Error('The AI review returned no extractable fields.');
    error.status = 502;
    throw error;
  }

  let extraction;
  try {
    extraction = JSON.parse(content);
  } catch {
    const error = new Error('The AI review returned unparseable fields.');
    error.status = 502;
    throw error;
  }

  const lineItems = Array.isArray(extraction.line_items)
    ? extraction.line_items.slice(0, 500).filter((item) => item && typeof item === 'object').map((item) => ({
      description: invoiceText(item.description),
      hsn: invoiceText(item.hsn),
      quantity: invoiceNumber(item.quantity),
      unit_price: invoiceNumber(item.unit_price),
      total: invoiceNumber(item.total),
    }))
    : [];
  const assetDetails = Array.isArray(extraction.asset_details)
    ? extraction.asset_details.slice(0, 500).filter((asset) => asset && typeof asset === 'object').map((asset) => ({
      manufacturer: invoiceText(asset.manufacturer),
      model: invoiceText(asset.model),
      serial_number: invoiceText(asset.serial_number),
    }))
    : [];
  const rawBankDetails = extraction.bank_details && typeof extraction.bank_details === 'object' && !Array.isArray(extraction.bank_details)
    ? extraction.bank_details
    : null;
  return {
    invoice_number: invoiceText(extraction.invoice_number),
    vendor: invoiceText(extraction.vendor),
    purchase_order: invoiceText(extraction.purchase_order),
    invoice_date: invoiceText(extraction.invoice_date),
    due_date: invoiceText(extraction.due_date),
    currency: invoiceText(extraction.currency),
    subtotal: invoiceNumber(extraction.subtotal),
    tax: invoiceNumber(extraction.tax),
    total: invoiceNumber(extraction.total),
    line_items: lineItems,
    bank_details: rawBankDetails ? {
      name: invoiceText(rawBankDetails.name),
      account: invoiceText(rawBankDetails.account),
      ifsc: invoiceText(rawBankDetails.ifsc),
      branch: invoiceText(rawBankDetails.branch),
    } : null,
    asset_details: assetDetails,
    confidence: Math.max(0, Math.min(100, invoiceNumber(extraction.confidence) ?? 0)),
    review_reason: invoiceText(extraction.review_reason),
  };
}
