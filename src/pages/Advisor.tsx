import { useState, useRef, useEffect, FormEvent } from 'react';
import { Send, Sparkles, Bot, User, Loader } from 'lucide-react';
import { useCollection, buildCollectionSummary } from '../hooks/useCollection';
import { askAdvisor } from '../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'What should I open for a dinner party this weekend?',
  'Which of my wines pair well with grilled salmon?',
  'What are my highest-rated bottles?',
  'Which wines should I drink soon before they peak?',
  'What red wine would go with a beef roast?',
];

export default function Advisor() {
  const { data: collection } = useCollection();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const collectionSummary = collection
    ? buildCollectionSummary(collection.labels, collection.name)
    : '';

  async function send(question: string) {
    if (!question.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: question.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const answer = await askAdvisor(question.trim(), collectionSummary);
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch {
      setError('Failed to get a response. Make sure ANTHROPIC_API_KEY is set on the server.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="flex flex-col h-screen max-h-screen">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2.5">
          <Sparkles size={20} className="text-purple-400" />
          <h1 className="text-lg font-bold text-white">Wine Advisor</h1>
        </div>
        <p className="text-slate-400 text-sm mt-1">
          Ask Claude to recommend wines from your collection
          {collection ? ` (${collection.labels.length} labels loaded)` : ''}
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-10">
            <div className="bg-purple-900/30 border border-purple-800/40 rounded-full p-4">
              <Sparkles size={32} className="text-purple-400" />
            </div>
            <div className="text-center">
              <p className="text-white font-semibold mb-1">Ask me about your wine collection</p>
              <p className="text-slate-400 text-sm">
                I can help with pairings, recommendations, and tasting notes
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full text-slate-300 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'user' ? 'bg-wine-700' : 'bg-purple-800'
              }`}
            >
              {msg.role === 'user' ? (
                <User size={14} className="text-white" />
              ) : (
                <Bot size={14} className="text-white" />
              )}
            </div>
            <div
              className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-wine-700/30 border border-wine-800/40 text-slate-100 rounded-tr-sm'
                  : 'bg-slate-800 border border-slate-700 text-slate-200 rounded-tl-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-800 flex items-center justify-center shrink-0">
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-sm px-4 py-3">
              <Loader size={14} className="text-slate-400 animate-spin" />
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-8 py-4 border-t border-slate-800 shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your collection..."
            disabled={loading}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-600 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-purple-700 hover:bg-purple-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl transition-colors"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
