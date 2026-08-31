import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, Loader, CheckCircle, Package, DollarSign, Calendar, MapPin, Wine, Star, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useQueryClient } from '@tanstack/react-query';
import { useWine, drinkWindowStatus, bottleLocation } from '../hooks/useCollection';
import { generateDescription, consumeBottle, rateBottle, RatingPayload } from '../lib/api';
import CellarModal from '../components/CellarModal';
import RatingForm from '../components/RatingForm';
import { Bottle } from '../types';

function DrinkBadge({ status }: { status: 'drink' | 'hold' | 'past' | 'unknown' }) {
  if (status === 'drink') return <span className="px-3 py-1 rounded-full text-sm bg-emerald-900/40 text-emerald-300 border border-emerald-800/50">Drink Now</span>;
  if (status === 'hold') return <span className="px-3 py-1 rounded-full text-sm bg-blue-900/40 text-blue-300 border border-blue-800/50">Hold</span>;
  if (status === 'past') return <span className="px-3 py-1 rounded-full text-sm bg-slate-700 text-slate-400">Past Peak</span>;
  return null;
}

function Stars({ n }: { n: number | null }) {
  if (n == null) return <span className="text-slate-500 text-xs">unrated</span>;
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={12} className={i <= n ? 'text-amber-400 fill-amber-400' : 'text-slate-700'} />
      ))}
    </span>
  );
}

export default function WineDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: wine, isLoading, error } = useWine(id);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);
  const [consumingId, setConsumingId] = useState<string | null>(null);
  const [cellarBottle, setCellarBottle] = useState<Bottle | null>(null);
  const [ratingBottle, setRatingBottle] = useState<Bottle | null>(null);

  if (isLoading) return <div className="p-8 text-center text-slate-400 text-sm py-20">Loading wine details...</div>;
  if (error || !wine) {
    return (
      <div className="p-8">
        <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">Wine not found.</div>
      </div>
    );
  }

  const activeBtls = wine.bottles.filter((b) => !b.consumed);
  const consumedBtls = wine.bottles.filter((b) => b.consumed);
  const totalValue = activeBtls.reduce((s, b) => s + (b.marketPrice ?? 0), 0);
  const status = drinkWindowStatus(wine);
  const tastings = wine.tastings ?? [];

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['wine', id] }),
      queryClient.invalidateQueries({ queryKey: ['wines'] }),
      queryClient.invalidateQueries({ queryKey: ['rack'] }),
    ]);
  }

  async function handleGenerateDescription() {
    setGeneratingDesc(true);
    setDescError(null);
    try {
      await generateDescription(id);
      await queryClient.invalidateQueries({ queryKey: ['wine', id] });
    } catch {
      setDescError('Failed to generate description. Check server logs.');
    } finally {
      setGeneratingDesc(false);
    }
  }

  async function handleConsume(bottle: Bottle) {
    setConsumingId(bottle.id);
    try {
      await consumeBottle(id, bottle.id);
      await refresh();
      setRatingBottle(bottle);
    } finally {
      setConsumingId(null);
    }
  }

  async function handleRate(p: RatingPayload) {
    if (!ratingBottle) return;
    await rateBottle(id, ratingBottle.id, p);
    await refresh();
    setRatingBottle(null);
  }

  return (
    <>
      {cellarBottle && (
        <CellarModal wineId={id} wineName={wine.name} producer={wine.producer} vintage={wine.vintage} wineType={wine.wineType} bottle={cellarBottle} onClose={() => setCellarBottle(null)} />
      )}

      {ratingBottle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-md p-6 relative">
            <button onClick={() => setRatingBottle(null)} className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800">
              <X size={16} />
            </button>
            <RatingForm wineLabel={`${wine.vintage} ${wine.name}`} onSubmit={handleRate} onSkip={() => setRatingBottle(null)} />
          </div>
        </div>
      )}

      <div className="p-4 sm:p-8 max-w-4xl">
        <Link to="/collection" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-6">
          <ArrowLeft size={14} />
          Back to Collection
        </Link>

        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-xs text-slate-500 uppercase tracking-wide">{wine.wineType}</span>
            <DrinkBadge status={status} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">{wine.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-slate-400 text-sm">
            <span>{wine.producer}</span>
            <span className="text-slate-600">·</span>
            <span>{wine.vintage || 'NV'}</span>
            <span className="text-slate-600">·</span>
            <span className="flex items-center gap-1">
              <MapPin size={12} />
              {wine.region}
              {wine.country ? `, ${wine.country}` : ''}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <div className="flex items-center gap-1.5 mb-2">
              <Package size={13} className="text-slate-500" />
              <span className="text-xs text-slate-500 uppercase tracking-wide">Bottles</span>
            </div>
            <p className="text-2xl font-bold text-white">{activeBtls.length}</p>
          </div>
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <div className="flex items-center gap-1.5 mb-2">
              <DollarSign size={13} className="text-slate-500" />
              <span className="text-xs text-slate-500 uppercase tracking-wide">Market Value</span>
            </div>
            <p className="text-2xl font-bold text-white">{totalValue > 0 ? `$${totalValue.toFixed(0)}` : '—'}</p>
          </div>
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs text-slate-500 uppercase tracking-wide">ABV</span>
            </div>
            <p className="text-2xl font-bold text-white">{wine.abv || '—'}</p>
          </div>
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <div className="flex items-center gap-1.5 mb-2">
              <Calendar size={13} className="text-slate-500" />
              <span className="text-xs text-slate-500 uppercase tracking-wide">Drink Window</span>
            </div>
            <p className="text-xl font-bold text-white">{wine.drinkWindowStart && wine.drinkWindowEnd ? `${wine.drinkWindowStart}–${wine.drinkWindowEnd}` : '—'}</p>
          </div>
        </div>

        {wine.grapes && (
          <div className="mb-6">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Grapes</p>
            <p className="text-slate-300 text-sm">{wine.grapes}</p>
          </div>
        )}

        {/* Bottles */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-3.5 border-b border-slate-800">
            <h2 className="font-semibold text-white text-sm">
              Bottles ({activeBtls.length} active{consumedBtls.length > 0 ? `, ${consumedBtls.length} consumed` : ''})
            </h2>
          </div>
          <div className="divide-y divide-slate-800/60">
            {wine.bottles.map((bottle) => (
              <div key={bottle.id} className={`px-5 py-3.5 flex flex-wrap items-center gap-3 ${bottle.consumed ? 'opacity-40' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-300 truncate">{bottleLocation(bottle)}</p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {bottle.size || '750ml'}
                    {bottle.purchaseDate ? ` · Purchased ${bottle.purchaseDate}` : ''}
                    {` · #${bottle.id}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-sm">
                  {bottle.marketPrice ? (
                    <span className="text-emerald-400">${bottle.marketPrice.toFixed(0)}</span>
                  ) : bottle.purchasePrice ? (
                    <span className="text-slate-400">${bottle.purchasePrice.toFixed(0)} paid</span>
                  ) : null}

                  {bottle.consumed ? (
                    <span className="flex items-center gap-1 text-xs text-slate-600">
                      <CheckCircle size={12} /> Consumed
                    </span>
                  ) : (
                    <>
                      <Link
                        to={`/locate/${id}/${bottle.id}`}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-amber-900/30 border border-slate-700 hover:border-amber-700/50 text-slate-400 hover:text-amber-300 rounded-lg transition-colors"
                        title="Show in 3D"
                      >
                        <MapPin size={11} />
                        Locate
                      </Link>
                      <button
                        onClick={() => setCellarBottle(bottle)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-wine-900/40 border border-slate-700 hover:border-wine-700/50 text-slate-400 hover:text-wine-300 rounded-lg transition-colors"
                        title="Move / manage"
                      >
                        <Wine size={11} />
                        Cellar
                      </button>
                      <button
                        onClick={() => handleConsume(bottle)}
                        disabled={consumingId === bottle.id}
                        className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {consumingId === bottle.id ? <Loader size={10} className="animate-spin" /> : 'Consumed'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tastings */}
        {tastings.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
            <h2 className="font-semibold text-white text-sm mb-3">Your tastings</h2>
            <div className="space-y-2">
              {tastings.map((t) => (
                <div key={t.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Stars n={t.rating} />
                    <span className="text-xs text-slate-500">{t.tastedAt.slice(0, 10)}</span>
                    {t.wouldBuyAgain === true && <span className="text-xs text-emerald-400">would buy again</span>}
                    {t.wouldBuyAgain === false && <span className="text-xs text-slate-500">wouldn't buy again</span>}
                  </div>
                  {t.notes && <p className="text-slate-400 text-sm mt-0.5">{t.notes}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Description */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-purple-400" />
              <h2 className="font-semibold text-white text-sm">Sommelier Notes</h2>
            </div>
            {!wine.description && !generatingDesc && (
              <button onClick={handleGenerateDescription} className="text-xs px-3 py-1.5 bg-purple-800/40 hover:bg-purple-700/40 border border-purple-700/50 text-purple-300 rounded-lg transition-colors">
                Generate with AI
              </button>
            )}
          </div>
          {generatingDesc && (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
              <Loader size={14} className="animate-spin" />
              Generating sommelier notes...
            </div>
          )}
          {descError && <p className="text-red-400 text-sm">{descError}</p>}
          {wine.description && (
            <div className="prose prose-invert prose-sm max-w-none prose-headings:text-slate-200 prose-headings:text-sm prose-headings:font-semibold prose-p:text-slate-400 prose-ul:text-slate-400 prose-li:text-slate-400">
              <ReactMarkdown>{wine.description}</ReactMarkdown>
            </div>
          )}
          {!wine.description && !generatingDesc && !descError && (
            <p className="text-slate-500 text-sm">Click "Generate with AI" to get expert tasting notes, food pairings, and cellaring advice.</p>
          )}
        </div>

        {wine.collectionNotes && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="font-semibold text-white text-sm mb-2">Collection Notes</h2>
            <p className="text-slate-400 text-sm whitespace-pre-wrap">{wine.collectionNotes}</p>
          </div>
        )}
      </div>
    </>
  );
}
