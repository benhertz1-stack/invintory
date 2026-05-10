import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, Loader, CheckCircle, Package, DollarSign, Calendar, MapPin, Wine } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useQueryClient } from '@tanstack/react-query';
import { useWine, drinkWindowStatus } from '../hooks/useCollection';
import { generateDescription, consumeBottle } from '../lib/api';
import CellarModal from '../components/CellarModal';
import { Bottle } from '../types';

function DrinkBadge({ status }: { status: 'drink' | 'hold' | 'past' | 'unknown' }) {
  if (status === 'drink')
    return (
      <span className="px-3 py-1 rounded-full text-sm bg-emerald-900/40 text-emerald-300 border border-emerald-800/50">
        Drink Now
      </span>
    );
  if (status === 'hold')
    return (
      <span className="px-3 py-1 rounded-full text-sm bg-blue-900/40 text-blue-300 border border-blue-800/50">
        Hold
      </span>
    );
  if (status === 'past')
    return (
      <span className="px-3 py-1 rounded-full text-sm bg-slate-700 text-slate-400">
        Past Peak
      </span>
    );
  return null;
}

export default function WineDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: wine, isLoading, error } = useWine(id!);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);
  const [consumingId, setConsumingId] = useState<string | null>(null);
  const [cellarBottle, setCellarBottle] = useState<Bottle | null>(null);

  if (isLoading) {
    return (
      <div className="p-8 text-center text-slate-400 text-sm py-20">Loading wine details...</div>
    );
  }

  if (error || !wine) {
    return (
      <div className="p-8">
        <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
          Wine not found.
        </div>
      </div>
    );
  }

  const activeBtls = wine.bottles.filter((b) => !b.consumed);
  const consumedBtls = wine.bottles.filter((b) => b.consumed);
  const totalValue = activeBtls.reduce((s, b) => s + (b.marketPrice ?? 0), 0);
  const status = drinkWindowStatus(wine);

  async function handleGenerateDescription() {
    if (!id) return;
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

  async function handleConsume(bottleId: string) {
    if (!id) return;
    setConsumingId(bottleId);
    try {
      await consumeBottle(id, bottleId);
      await queryClient.invalidateQueries({ queryKey: ['wine', id] });
      await queryClient.invalidateQueries({ queryKey: ['wines'] });
    } finally {
      setConsumingId(null);
    }
  }

  return (
    <>
      {cellarBottle && (
        <CellarModal
          wineId={id!}
          wineName={wine.name}
          producer={wine.producer}
          vintage={wine.vintage}
          wineType={wine.wineType}
          bottle={cellarBottle}
          onClose={() => setCellarBottle(null)}
        />
      )}

      <div className="p-8 max-w-4xl">
        <Link
          to="/collection"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={14} />
          Back to Collection
        </Link>

        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-xs text-slate-500 uppercase tracking-wide">{wine.wineType}</span>
            <DrinkBadge status={status} />
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">{wine.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-slate-400 text-sm">
            <span>{wine.producer}</span>
            <span className="text-slate-600">·</span>
            <span>{wine.vintage}</span>
            <span className="text-slate-600">·</span>
            <span className="flex items-center gap-1">
              <MapPin size={12} />
              {wine.region}{wine.country ? `, ${wine.country}` : ''}
            </span>
          </div>
        </div>

        {/* Stats */}
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
            <p className="text-2xl font-bold text-white">
              {totalValue > 0 ? `$${totalValue.toFixed(0)}` : '—'}
            </p>
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
            <p className="text-xl font-bold text-white">
              {wine.drinkWindowStart && wine.drinkWindowEnd
                ? `${wine.drinkWindowStart}–${wine.drinkWindowEnd}`
                : '—'}
            </p>
          </div>
        </div>

        {/* Grapes */}
        {wine.grapes && (
          <div className="mb-6">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Grapes</p>
            <p className="text-slate-300 text-sm">{wine.grapes}</p>
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
              <button
                onClick={handleGenerateDescription}
                className="text-xs px-3 py-1.5 bg-purple-800/40 hover:bg-purple-700/40 border border-purple-700/50 text-purple-300 rounded-lg transition-colors"
              >
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
            <p className="text-slate-500 text-sm">
              Click "Generate with AI" to get expert tasting notes, food pairings, and cellaring advice.
            </p>
          )}
        </div>

        {/* Bottles */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800">
            <h2 className="font-semibold text-white text-sm">
              Bottles ({activeBtls.length} active
              {consumedBtls.length > 0 ? `, ${consumedBtls.length} consumed` : ''})
            </h2>
          </div>
          <div className="divide-y divide-slate-800/60">
            {wine.bottles.map((bottle) => {
              const locationLine = [
                bottle.cellar,
                bottle.location,
                [
                  bottle.row && `R${bottle.row}`,
                  bottle.column && `C${bottle.column}`,
                  bottle.depth && `D${bottle.depth}`,
                ]
                  .filter(Boolean)
                  .join(', '),
              ]
                .filter(Boolean)
                .join(' › ');

              return (
                <div
                  key={bottle.id}
                  className={`px-5 py-3.5 flex items-center gap-4 ${
                    bottle.consumed ? 'opacity-40' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-300 truncate">{locationLine || 'No location'}</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {bottle.size}
                      {bottle.purchaseDate ? ` · Purchased ${bottle.purchaseDate}` : ''}
                      {(bottle.bottleCode || bottle.barcode) ? ` · #${bottle.bottleCode || bottle.barcode}` : ''}
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
                        {/* View in cellar */}
                        <button
                          onClick={() => setCellarBottle(bottle)}
                          className="flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-wine-900/40 border border-slate-700 hover:border-wine-700/50 text-slate-400 hover:text-wine-300 rounded-lg transition-colors"
                          title="View in cellar"
                        >
                          <Wine size={11} />
                          Cellar
                        </button>

                        {/* Quick consume */}
                        <button
                          onClick={() => handleConsume(bottle.id)}
                          disabled={consumingId === bottle.id}
                          className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors disabled:opacity-50"
                        >
                          {consumingId === bottle.id ? (
                            <Loader size={10} className="animate-spin" />
                          ) : (
                            'Consumed'
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Collection Notes */}
        {wine.collectionNotes && (
          <div className="mt-6 bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="font-semibold text-white text-sm mb-2">Collection Notes</h2>
            <p className="text-slate-400 text-sm whitespace-pre-wrap">{wine.collectionNotes}</p>
          </div>
        )}
      </div>
    </>
  );
}
