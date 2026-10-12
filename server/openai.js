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
