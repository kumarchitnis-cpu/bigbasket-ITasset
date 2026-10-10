const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type InvoiceExtraction = {
  invoice_number: string | null;
  vendor: string | null;
  purchase_order: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  confidence: number;
  review_reason: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI invoice review is not configured for this workspace." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json() as { imageDataUrl?: string; filename?: string };
    if (!body.imageDataUrl || !body.imageDataUrl.startsWith("data:")) {
      return new Response(JSON.stringify({ error: "A supported invoice document is required." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.imageDataUrl.length > 15000000) {
      return new Response(JSON.stringify({ error: "The invoice document is too large to review." }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const prompt = `Extract the invoice fields from this document. Return only valid JSON with this exact shape: {"invoice_number": string|null, "vendor": string|null, "purchase_order": string|null, "invoice_date": "YYYY-MM-DD"|null, "due_date": "YYYY-MM-DD"|null, "currency": string|null, "subtotal": number|null, "tax": number|null, "total": number|null, "confidence": number, "review_reason": string|null}. Confidence must be 0-100. Use review_reason for missing critical fields, unreadable values, or totals that do not reconcile. Never invent values.`;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: [{ type: "text", text: `${prompt}\nFilename: ${body.filename ?? "invoice"}` }, { type: "image_url", image_url: { url: body.imageDataUrl, detail: "high" } }] }],
      }),
    });
    if (!response.ok) return new Response(JSON.stringify({ error: "The AI review service could not process this document." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = result.choices?.[0]?.message?.content;
    if (!content) return new Response(JSON.stringify({ error: "The AI review returned no extractable fields." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const extraction = JSON.parse(content) as InvoiceExtraction;
    return new Response(JSON.stringify({ extraction }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ error: "The invoice review could not be completed." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
