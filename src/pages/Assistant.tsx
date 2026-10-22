import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Box,
  CircleAlert,
  FileText,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react';
import { PageTitle, PanelHeader, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { WorkspaceModule } from '@/lib/types';

type AssistantProps = {
  onNavigate: (module: WorkspaceModule) => void;
};

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const shortcuts: { label: string; module: WorkspaceModule; icon: typeof Box }[] = [
  { label: 'Asset register', module: 'Assets', icon: Box },
  { label: 'Invoices', module: 'Invoices', icon: FileText },
  { label: 'Warranties', module: 'Warranties', icon: BadgeCheck },
  { label: 'Employee assets', module: 'Emp Asset Mgmt', icon: Box },
];

const capabilities = [
  {
    title: 'Ask about operations',
    body: 'Get counts, spend and coverage figures answered from the live workspace summary.',
  },
  {
    title: 'Navigate instantly',
    body: 'Jump straight to the module you need without leaving the assistant panel.',
  },
  {
    title: 'Summarise workflows',
    body: 'Understand what is pending approval, on hold, or waiting for a human decision.',
  },
];

const suggestedQuestions = [
  'How many assets are awaiting assignment?',
  'Which warranties expire in the next 90 days?',
  'Summarize the invoice review queue.',
  'What approvals need attention?',
];

export function AssistantView({ onNavigate }: AssistantProps) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState<string>('');
  const messagesEnd = useRef<HTMLDivElement>(null);

  const ask = async (value: string) => {
    const submitted = value.trim();
    if (!submitted || busy) return;
    setMessages((current) => [...current, { role: 'user', content: submitted }]);
    setQuestion('');
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ answer: string }>('/api/assistant/chat', { question: submitted });
      setMessages((current) => [...current, { role: 'assistant', content: result.answer }]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The assistant could not answer. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    api
      .get<{ configured: boolean; model: string }>('/api/assistant/status')
      .then((status) => {
        setConfigured(status.configured);
        setModel(status.model ?? '');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'Could not check the AI Assistant configuration.');
      });
  }, []);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);

  return (
    <div className="fade-in">
      <PageTitle eyebrow="Workspace · AI" title="AI Assistant" copy="Ask a workspace question or jump directly to a module." />

      <section className="panel assistant-panel">
        <div className="assistant-command-header">
          <div className="assistant-command-mark">
            <Sparkles size={20} />
          </div>
          <div>
            <h2>How can I help?</h2>
            <span>Ask about workspace operations, or navigate to a module.</span>
          </div>
          <span className={`assistant-status ${configured ? 'ready' : configured === false ? 'not-configured' : 'checking'}`}>
            <i />
            {configured === null ? 'Checking connection' : configured ? `AI connected${model ? ` · ${model}` : ''}` : 'AI not configured'}
          </span>
        </div>

        <div className="assistant-capability-grid">
          {capabilities.map((capability) => (
            <div className="assistant-capability" key={capability.title}>
              <strong>{capability.title}</strong>
              <span>{capability.body}</span>
            </div>
          ))}
        </div>

        <div className="assistant-shortcuts" aria-label="Quick navigation">
          {shortcuts.map(({ label, module, icon: Icon }) => (
            <button key={module} type="button" onClick={() => onNavigate(module)}>
              <Icon size={15} />
              {label}
              <ArrowUpRight size={13} />
            </button>
          ))}
        </div>

        <div className="assistant-messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="assistant-welcome">
              <div className="assistant-empty">
                <Bot size={28} />
                <strong>Ask about your workspace</strong>
                <span>Answers use operational summaries, not private employee or invoice details. AI cannot make changes.</span>
              </div>
              <div className="assistant-suggestions">
                {suggestedQuestions.map((suggestion) => (
                  <button key={suggestion} type="button" disabled={busy || !configured} onClick={() => void ask(suggestion)}>
                    {suggestion}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}>
                <span>{message.role === 'user' ? 'You' : 'Operations assistant'}</span>
                <p>{message.content}</p>
              </div>
            ))
          )}
          {busy && (
            <div className="assistant-thinking">
              <Loader2 size={15} className="spin" /> Checking workspace summary
            </div>
          )}
          <div ref={messagesEnd} />
        </div>

        {configured === false && (
          <div className="assistant-config-note">
            <CircleAlert size={16} />
            <span>
              AI chat is unavailable until <code>OPENAI_API_KEY</code> is configured in the API server environment and the server is restarted. A GitHub
              Actions secret alone does not configure this server.
            </span>
          </div>
        )}
        {error && (
          <div className="auth-message module-error" role="alert">
            {error}
          </div>
        )}

        <form
          className="assistant-form"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={2000}
            placeholder={configured === false ? 'Configure the server API key to ask a question...' : 'Ask, navigate, or implement…'}
            aria-label="Question for AI assistant"
            disabled={configured === false || busy}
          />
          <button className="button button-primary" disabled={busy || !question.trim() || configured !== true} aria-label="Send question">
            {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            {busy ? 'Thinking...' : 'Ask AI'}
          </button>
        </form>
        <div className="assistant-disclaimer">
          AI responses may be inaccurate. Verify important decisions against source records. The assistant can answer summary questions and provide navigation;
          it cannot edit data.
        </div>
      </section>

      <section className="panel assistant-panel assistant-recent-panel">
        <PanelHeader title="Workspace modules" subtitle="Open any module directly" />
        <div className="assistant-capability-grid">
          {shortcuts.map(({ label, module, icon: Icon }) => (
            <button type="button" className="assistant-capability" key={module} onClick={() => onNavigate(module)}>
              <Icon size={15} />
              <strong>{label}</strong>
              <StatusBadge status="AVAILABLE" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
