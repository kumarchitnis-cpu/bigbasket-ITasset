/**
 * Local Ollama AI client.
 *
 * Calls a locally running Ollama instance (default http://127.0.0.1:11434) when
 * OLLAMA_ENABLED=true. Never contacts OpenAI or any hosted AI service.
 *
 * All callers must treat the returned text as untrusted input. This module does
 * not follow instructions found inside document contents.
 */

const OLLAMA_ENABLED = String(process.env.OLLAMA_ENABLED || 'true').toLowerCase() === 'true';
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const OLLAMA_TIMEOUT_SECONDS = Math.max(3, Number(process.env.OLLAMA_TIMEOUT_SECONDS) || 90);
const OLLAMA_TIMEOUT_MS = OLLAMA_TIMEOUT_SECONDS * 1000;

export function ollamaStatus() {
  return {
    enabled: OLLAMA_ENABLED,
    url: OLLAMA_URL,
    model: OLLAMA_MODEL,
    timeout_seconds: OLLAMA_TIMEOUT_SECONDS,
  };
}

/**
 * Check whether Ollama is reachable. Does not throw.
 */
export async function ollamaAvailable() {
  if (!OLLAMA_ENABLED) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Pull a model if it is missing. Best-effort; logs but does not throw.
 */
export async function ensureModel() {
  if (!OLLAMA_ENABLED) return false;
  try {
    const listResponse = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
    if (!listResponse.ok) return false;
    const list = await listResponse.json();
    const models = Array.isArray(list?.models) ? list.models : [];
    const hasModel = models.some((model) => model?.name === OLLAMA_MODEL);
    if (hasModel) return true;

    const pullResponse = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, stream: false }),
    });
    return pullResponse.ok;
  } catch {
    return false;
  }
}

/**
 * Generate structured JSON from a prompt. Returns parsed object or null on failure.
 * The `schema` parameter is an optional JSON Schema-like description used to
 * instruct the model and to validate the response loosely.
 */
export async function generateJSON({ system, prompt, schema, temperature = 0.1 }) {
  if (!OLLAMA_ENABLED) return null;
  const schemaInstruction = schema
    ? `\n\nReturn ONLY a single JSON object matching this schema (no markdown, no prose):\n${JSON.stringify(schema)}`
    : '\n\nReturn ONLY a single JSON object (no markdown, no prose).';

  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    options: { temperature },
    format: 'json',
    messages: [
      { role: 'system', content: `${system}${schemaInstruction}` },
      { role: 'user', content: prompt },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn('Ollama request failed', { status: response.status });
      return null;
    }

    const result = await response.json();
    const content = result?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      console.warn('Ollama returned empty content');
      return null;
    }

    // Strip markdown code fences if the model ignored the format instruction.
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (parseError) {
      console.warn('Ollama returned invalid JSON', { content: cleaned.slice(0, 200) });
      return null;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('Ollama request timed out', { timeout_ms: OLLAMA_TIMEOUT_MS });
    } else {
      console.warn('Ollama request error', { error: error.message });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate that an AI-extracted object contains only known keys and safe values.
 * Rejects instruction-following content masquerading as extracted data.
 */
export function validateExtractedObject(obj, allowedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const allowed = new Set(allowedKeys);
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!allowed.has(key)) continue;
    if (typeof value === 'string' && value.trim().toLowerCase().includes('ignore')) {
      // Reject values that look like instruction-following content.
      if (/ignore (all )?(previous|above|prior)/i.test(value)) continue;
    }
    cleaned[key] = value;
  }
  return Object.keys(cleaned).length ? cleaned : null;
}