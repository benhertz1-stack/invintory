import { useState } from 'react';
import { Star, Loader } from 'lucide-react';
import { RatingPayload } from '../lib/api';

interface Props {
  wineLabel: string;
  onSubmit: (payload: RatingPayload) => Promise<void>;
  onSkip: () => void;
}

/** "How was it?" form shown right after a bottle is marked consumed. */
export default function RatingForm({ wineLabel, onSubmit, onSkip }: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [buyAgain, setBuyAgain] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (rating == null && !notes.trim()) {
      setError('Pick a star rating or write a note.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        rating: rating ?? undefined,
        notes: notes.trim() || undefined,
        wouldBuyAgain: buyAgain ?? undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-white font-semibold">How was it?</p>
        <p className="text-slate-400 text-sm">{wineLabel}</p>
      </div>

      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const lit = (hover ?? rating ?? 0) >= n;
          return (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setRating(n)}
              className="p-1"
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
            >
              <Star size={28} className={lit ? 'text-amber-400 fill-amber-400' : 'text-slate-600'} />
            </button>
          );
        })}
        <span className="self-center ml-2 text-sm text-slate-400">
          {rating ? ['', 'Not for me', 'Meh', 'Good', 'Really good', 'Loved it'][rating] : ''}
        </span>
      </div>

      <textarea
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What did you like or dislike? (tannin, fruit, oak, finish…)"
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-wine-500"
      />

      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-400">Buy again?</span>
        {[
          [true, 'Yes'],
          [false, 'No'],
        ].map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => setBuyAgain(buyAgain === v ? null : (v as boolean))}
            className={`px-3 py-1 rounded-full border text-xs transition-colors ${
              buyAgain === v ? 'bg-wine-700 border-wine-600 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {label as string}
          </button>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="flex-1 flex items-center justify-center gap-2 bg-wine-700 hover:bg-wine-600 disabled:bg-slate-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
        >
          {busy ? <Loader size={14} className="animate-spin" /> : 'Save rating'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
