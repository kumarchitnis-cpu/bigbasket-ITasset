const EXTRACTION_PROMPT = `Extract the invoice fields from this document. Return only valid JSON with this exact shape: {"invoice_number": string|null, "vendor": string|null, "purchase_order": string|null, "invoice_date": "YYYY-MM-DD"|null, "due_date": "YYYY-MM-DD"|null, "currency": string|null, "subtotal": number|null, "tax": number|null, "total": number|null, "confidence": number, "review_reason": string|null}. Confidence must be 0-100. Use review_reason for missing critical fields, unreadable values, or totals that do not reconcile. Never invent values.`;

export async function extractInvoice(imageDataUrl, filename) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('AI invoice review is not configured for this workspace.');
    error.status = 503;
    throw error;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${EXTRACTION_PROMPT}\nFilename: ${filename || 'invoice'}` },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = new Error('The AI review service could not process this document.');
    error.status = 502;
    throw error;
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
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

  if (typeof extraction.confidence !== 'number') extraction.confidence = 0;
  return extraction;
}
