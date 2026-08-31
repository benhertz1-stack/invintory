import { useState, useRef, useEffect, FormEvent, ChangeEvent, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Send, Camera, X, Sparkles, Bot, User, Loader, MapPin } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sendAgentMessage } from '../lib/api';
import { AdvisorMessage, FridgeViewAction, WineSummary } from '../types';

const FridgeViewer3D = lazy(() => import('../components/FridgeViewer3D'));

const SUGGESTIONS = [
  'What should I open for a steak dinner?',
  'Which of my wines are ready to drink now?',
  'Add a wine from a photo',
  'Where is my Ontogeny?',
];

// ── Compress + encode image ───────────────────────────────────────────────────
async function compressImage(file: File, maxDim = 1280): Promise<{ data: string; mediaType: string; preview: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height / width) * maxDim);
          width = maxDim;
        } else {
          width = Math.round((width / height) * maxDim);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      const data = canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
      const preview = canvas.toDataURL('image/jpeg', 0.45);
      URL.revokeObjectURL(url);
      resolve({ data, mediaType: 'image/jpeg', preview });
    };
    img.src = url;
  });
}

// ── Wine list card ────────────────────────────────────────────────────────────
function WineListCard({ wines }: { wines: WineSummary[] }) {
  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-slate-700">
      <div className="px-3 py-1.5 bg-slate-800/60 border-b border-slate-700 text-xs text-slate-400">
        {wines.length} wine{wines.length !== 1 ? 's' : ''}
      </div>
      <div className="divide-y divide-slate-800 max-h-64 overflow-y-auto">
        {wines.map((w) => (
          <Link key={w.id} to={`/collection/${w.id}`} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-800/40 transition-colors">
            <span className="text-slate-500 font-mono text-xs w-10 shrink-0">{w.vintage || 'NV'}</span>
            <span className="text-white text-xs flex-1 min-w-0 truncate">{w.name}</span>
            <span className="text-slate-500 text-xs shrink-0">{w.bottleCount}×</span>
            {w.drinkWindowStart && (
              <span className={`text-xs shrink-0 ${w.drinkStatus === 'drink' ? 'text-emerald-400' : 'text-slate-500'}`}>
                {w.drinkWindowStart}–{w.drinkWindowEnd}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: AdvisorMessage }) {
  const isUser = msg.role === 'user';
  const fridgeAction = msg.uiAction?.type === 'fridge_view' ? (msg.uiAction as FridgeViewAction) : null;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isUser ? 'bg-wine-700' : 'bg-purple-800'}`}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-white" />}
      </div>

      <div className={`max-w-[85%] sm:max-w-[78%] space-y-2 ${isUser ? 'flex flex-col items-end' : ''}`}>
        {msg.images && msg.images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end">
            {msg.images.map((img, i) => (
              <img key={i} src={img.preview} alt="attached" className="w-20 h-20 object-cover rounded-lg border border-slate-700" />
            ))}
          </div>
        )}

        {msg.text && (
          <div
            className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              isUser ? 'bg-wine-700/30 border border-wine-800/40 text-slate-100 rounded-tr-sm' : 'bg-slate-800 border border-slate-700 text-slate-200 rounded-tl-sm'
            }`}
          >
            {isUser ? (
              msg.text
            ) : (
              <div className="prose prose-invert prose-sm max-w-none [&_table]:w-full [&_table]:text-xs [&_th]:text-left [&_th]:py-1 [&_td]:py-1 [&_tr]:border-b [&_tr]:border-slate-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
              </div>
            )}
            {msg.uiAction?.type === 'wine_list' && <WineListCard wines={msg.uiAction.wines} />}
          </div>
        )}

        {fridgeAction && fridgeAction.shelves?.length > 0 && (
          <div className="w-full max-w-md">
            <Suspense
              fallback={
                <div className="h-40 flex items-center justify-center bg-slate-900 rounded-xl border border-slate-700 text-slate-500 text-sm">Loading 3D view…</div>
              }
            >
              <FridgeViewer3D
                shelves={fridgeAction.shelves}
                occupiedSlots={fridgeAction.occupiedSlots}
                highlight={fridgeAction.highlight}
                pulledShelf={fridgeAction.pulledShelf ?? fridgeAction.highlight?.row ?? null}
                fridgeName={fridgeAction.fridgeName}
                wineName={fridgeAction.wineName}
                vintage={fridgeAction.vintage}
              />
            </Suspense>
            {fridgeAction.url && (
              <a href={fridgeAction.url} className="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300">
                <MapPin size={11} /> Open full-screen locate view
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Advisor() {
  const [displayMsgs, setDisplayMsgs] = useState<AdvisorMessage[]>([]);
  const [apiMsgs, setApiMsgs] = useState<unknown[]>([]);
  const [pendingImages, setPendingImages] = useState<{ data: string; mediaType: string; preview: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMsgs, loading]);

  async function send(text: string, images = pendingImages) {
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || loading) return;

    const content: unknown[] = images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }));
    content.push({ type: 'text', text: trimmed || 'Please look at the attached image(s).' });

    const newApiMsg = { role: 'user', content };
    const newDisplayMsg: AdvisorMessage = { role: 'user', text: trimmed, images: images.length > 0 ? images : undefined };

    setDisplayMsgs((prev) => [...prev, newDisplayMsg]);
    setApiMsgs((prev) => [...prev, newApiMsg]);
    setPendingImages([]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const result = await sendAgentMessage([...apiMsgs, newApiMsg]);
      setApiMsgs(result.messages);
      setDisplayMsgs((prev) => [...prev, { role: 'assistant', text: result.message, uiAction: result.uiAction }]);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Failed to get a response.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const compressed = await Promise.all(files.map((f) => compressImage(f)));
    setPendingImages((prev) => [...prev, ...compressed]);
    e.target.value = '';
  }

  const isEmpty = displayMsgs.length === 0 && !loading;

  return (
    <div className="flex flex-col h-[calc(100vh-57px)] md:h-screen">
      <div className="px-4 sm:px-8 py-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2.5">
          <Sparkles size={20} className="text-purple-400" />
          <h1 className="text-lg font-bold text-white">Wine Advisor</h1>
        </div>
        <p className="text-slate-400 text-sm mt-1">Ask about your collection, add wines from photos, or locate a bottle</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-5">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-10">
            <div className="bg-purple-900/30 border border-purple-800/40 rounded-full p-4">
              <Sparkles size={32} className="text-purple-400" />
            </div>
            <div className="text-center">
              <p className="text-white font-semibold mb-1">Your wine cellar assistant</p>
              <p className="text-slate-400 text-sm">Same tools as the Claude app connector — add, locate, drink, rate.</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s, [])} className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full text-slate-300 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {displayMsgs.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-800 flex items-center justify-center shrink-0">
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
              <Loader size={14} className="text-slate-400 animate-spin" />
              <span className="text-xs text-slate-400">Thinking…</span>
            </div>
          </div>
        )}

        {error && <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 sm:px-8 py-4 border-t border-slate-800 shrink-0">
        {pendingImages.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative">
                <img src={img.preview} alt="pending" className="w-14 h-14 object-cover rounded-lg border border-slate-700" />
                <button
                  onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-slate-900 border border-slate-600 rounded-full flex items-center justify-center hover:bg-red-900 transition-colors"
                >
                  <X size={10} className="text-slate-300" />
                </button>
              </div>
            ))}
          </div>
        )}

        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handleFiles} />

        <form onSubmit={handleSubmit} className="flex gap-3 items-end">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            title="Attach photo(s)"
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-40 shrink-0"
          >
            <Camera size={18} />
          </button>
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={pendingImages.length > 0 ? 'Add a message or press Send…' : 'Ask about your collection, add a wine, find a bottle…'}
            disabled={loading}
            className="flex-1 resize-none bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-600 disabled:opacity-50 min-h-[40px] max-h-28 overflow-y-auto"
            style={{ lineHeight: '1.5' }}
          />
          <button
            type="submit"
            disabled={loading || (!input.trim() && pendingImages.length === 0)}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-purple-700 hover:bg-purple-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white transition-colors shrink-0"
          >
            {loading ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
        <p className="text-xs text-slate-600 mt-2 text-center">Enter to send · Shift+Enter for new line · Camera to attach photos</p>
      </div>
    </div>
  );
}
