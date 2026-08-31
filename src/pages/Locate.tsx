import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, MinusCircle, Loader } from 'lucide-react';
import FridgeViewer3D from '../components/FridgeViewer3D';
import RatingForm from '../components/RatingForm';
import { consumeBottle, getLocate, rateBottle, RatingPayload } from '../lib/api';
import { bottleLocation } from '../hooks/useCollection';

/**
 * Full-screen "where is my bottle" view — the link the Claude app hands out
 * (/locate/:wineId/:bottleId). Shows the fridge with the shelf pulled out and
 * the bottle lit up; lets you mark it consumed and rate it on the spot.
 */
export default function Locate() {
  const { wineId = '', bottleId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['locate', wineId, bottleId],
    queryFn: () => getLocate(wineId, bottleId),
    enabled: !!wineId && !!bottleId,
  });
  const [step, setStep] = useState<'view' | 'consuming' | 'rate' | 'done'>('view');

  async function handleConsume() {
    setStep('consuming');
    try {
      await consumeBottle(wineId, bottleId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['wine', wineId] }),
        queryClient.invalidateQueries({ queryKey: ['wines'] }),
        queryClient.invalidateQueries({ queryKey: ['fridges'] }),
      ]);
      setStep('rate');
    } catch {
      setStep('view');
    }
  }

  async function handleRate(p: RatingPayload) {
    await rateBottle(wineId, bottleId, p);
    setStep('done');
    setTimeout(() => navigate(`/collection/${wineId}`), 900);
  }

  if (isLoading) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 p-6">
        <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
          Couldn't find that bottle. <Link to="/collection" className="underline">Back to collection</Link>
        </div>
      </div>
    );
  }

  const { wine, bottle, fridge, occupied, highlight } = data;
  const occupiedSlots = occupied.map((s) => ({ row: s.shelf, col: s.column }));
  const hi = highlight ? { row: highlight.shelf, col: highlight.column } : null;
  const otherBottles = occupied.filter((s) => s.wineId === wine.id && s.bottleId !== bottle.id);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <div className="px-4 sm:px-8 py-4 border-b border-slate-800 flex items-start gap-3">
        <Link to={`/collection/${wine.id}`} className="mt-1 text-slate-400 hover:text-white" title="Wine details">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500 uppercase tracking-wide truncate">{wine.producer}</p>
          <h1 className="text-lg sm:text-2xl font-bold text-white leading-tight">
            {wine.vintage || 'NV'} {wine.name}
          </h1>
          <p className="text-amber-400 text-sm mt-1 flex items-center gap-1.5">
            <MapPin size={14} />
            {bottle.consumed ? 'This bottle has been consumed' : bottleLocation(bottle)}
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 sm:p-6">
        <div className="flex-1 min-w-0">
          {hi ? (
            <FridgeViewer3D
              shelves={fridge.shelves}
              occupiedSlots={occupiedSlots}
              highlight={hi}
              pulledShelf={hi.row}
              fridgeName={fridge.name}
              wineName={wine.name}
              vintage={wine.vintage}
              height="min(70vh, 720px)"
            />
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-400 text-sm">
              No shelf position is recorded for this bottle yet. Tell Claude where it is ("it's in the Large Fridge, shelf 8, third from the left") or relocate it from the wine page.
            </div>
          )}
        </div>

        <aside className="w-full lg:w-80 shrink-0 space-y-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1 text-sm">
            <p className="text-slate-300">
              <span className="text-slate-500">Bottle</span> <span className="font-mono text-xs">{bottle.id}</span>
            </p>
            <p className="text-slate-300">
              <span className="text-slate-500">Size</span> {bottle.size || '750ml'}
            </p>
            {bottle.purchaseDate && (
              <p className="text-slate-300">
                <span className="text-slate-500">Purchased</span> {bottle.purchaseDate}
              </p>
            )}
            {(bottle.marketPrice || bottle.purchasePrice) && (
              <p className="text-slate-300">
                <span className="text-slate-500">Value</span> ${(bottle.marketPrice ?? bottle.purchasePrice ?? 0).toFixed(0)}
              </p>
            )}
            {wine.drinkWindowStart && wine.drinkWindowEnd && (
              <p className="text-slate-300">
                <span className="text-slate-500">Drink</span> {wine.drinkWindowStart}–{wine.drinkWindowEnd}
              </p>
            )}
            {otherBottles.length > 0 && (
              <p className="text-slate-400 text-xs pt-1">
                Also: {otherBottles.map((b) => `shelf ${b.shelf} pos ${b.column}`).join(', ')}
              </p>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            {step === 'view' && !bottle.consumed && (
              <button
                onClick={handleConsume}
                className="w-full flex items-center justify-center gap-2 bg-red-700 hover:bg-red-600 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                <MinusCircle size={14} />
                Opened it — mark consumed
              </button>
            )}
            {step === 'consuming' && (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader size={14} className="animate-spin" /> Updating…
              </div>
            )}
            {step === 'rate' && (
              <RatingForm wineLabel={`${wine.vintage || 'NV'} ${wine.name}`} onSubmit={handleRate} onSkip={() => navigate(`/collection/${wine.id}`)} />
            )}
            {step === 'done' && <p className="text-emerald-400 text-sm text-center">Saved — thanks!</p>}
            {bottle.consumed && step === 'view' && <p className="text-slate-500 text-sm text-center">Already consumed.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
