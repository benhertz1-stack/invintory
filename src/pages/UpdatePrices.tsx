import { useState, useMemo } from 'react';
import { DollarSign, CheckCircle, AlertCircle } from 'lucide-react';
import { useCollection } from '../hooks/useCollection';
import { useQueryClient } from '@tanstack/react-query';
import { updateBottlePrices } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export default function UpdatePrices() {
  const { collectionId } = useAuth();
  const { data: collection, isLoading } = useCollection();
  const queryClient = useQueryClient();

  const [prices, setPrices] = useState<Record<string, string>>({});
  const [currencies, setCurrencies] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState<{ success?: number; error?: string } | null>(null);

  const cellarMap = Object.fromEntries(
    (collection?.cellars ?? []).map((c) => [c.id, c.name])
  );

  const unpricedEntries = useMemo(() => {
    if (!collection) return [];
    return collection.labels.flatMap((label) =>
      label.bottles
        .filter((b) => !b.price && !b.consumed)
        .map((b) => ({
          bottleId: b.id,
          labelName: `${label.wine.winery} — ${label.wine.name} ${label.year}`,
          cellarName: cellarMap[b.cellarId] ?? 'Unknown',
        }))
    );
  }, [collection, cellarMap]);

  const filledCount = unpricedEntries.filter(
    (e) => prices[e.bottleId] && parseFloat(prices[e.bottleId]) > 0
  ).length;

  async function handleUpdate() {
    if (!collectionId) return;
    const updates = unpricedEntries
      .filter((e) => prices[e.bottleId] && parseFloat(prices[e.bottleId]) > 0)
      .map((e) => ({
        id: e.bottleId,
        price: parseFloat(prices[e.bottleId]),
        currency: currencies[e.bottleId] ?? 'USD',
      }));

    if (updates.length === 0) return;
    setUpdating(true);
    setResult(null);
    try {
      await updateBottlePrices(collectionId, updates);
      await queryClient.invalidateQueries({ queryKey: ['collection'] });
      setResult({ success: updates.length });
      setPrices({});
      setCurrencies({});
    } catch {
      setResult({ error: 'Update failed. Please try again.' });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Update Prices</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Set purchase prices for unpriced bottles in your collection
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-slate-400 text-sm">Loading...</div>
      ) : unpricedEntries.length === 0 ? (
        <div className="text-center py-20">
          <CheckCircle size={44} className="text-emerald-500 mx-auto mb-4" />
          <p className="text-white font-semibold">All bottles have prices!</p>
          <p className="text-slate-400 mt-1 text-sm">Your collection is fully priced.</p>
        </div>
      ) : (
        <>
          {result?.success && (
            <div className="flex items-center gap-2 bg-emerald-900/30 border border-emerald-800 text-emerald-300 rounded-lg px-4 py-3 mb-5 text-sm">
              <CheckCircle size={15} />
              Updated {result.success} bottle{result.success !== 1 ? 's' : ''} successfully.
            </div>
          )}
          {result?.error && (
            <div className="flex items-center gap-2 bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-4 py-3 mb-5 text-sm">
              <AlertCircle size={15} />
              {result.error}
            </div>
          )}

          <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden mb-5">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">
                {unpricedEntries.length} unpriced bottle{unpricedEntries.length !== 1 ? 's' : ''}
              </span>
              <span className="text-xs text-slate-500">{filledCount} ready to update</span>
            </div>
            <div className="divide-y divide-slate-800/60">
              {unpricedEntries.map((entry) => (
                <div key={entry.bottleId} className="px-5 py-3.5 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{entry.labelName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{entry.cellarName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={currencies[entry.bottleId] ?? 'USD'}
                      onChange={(e) =>
                        setCurrencies((prev) => ({ ...prev, [entry.bottleId]: e.target.value }))
                      }
                      className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-wine-500"
                    >
                      {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <div className="relative">
                      <DollarSign
                        size={13}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={prices[entry.bottleId] ?? ''}
                        onChange={(e) =>
                          setPrices((prev) => ({ ...prev, [entry.bottleId]: e.target.value }))
                        }
                        className="bg-slate-800 border border-slate-700 rounded-lg pl-7 pr-3 py-1.5 text-sm text-white w-28 focus:outline-none focus:ring-1 focus:ring-wine-500"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleUpdate}
            disabled={updating || filledCount === 0}
            className="bg-wine-700 hover:bg-wine-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
          >
            {updating
              ? 'Updating...'
              : `Update ${filledCount} Bottle${filledCount !== 1 ? 's' : ''}`}
          </button>
        </>
      )}
    </div>
  );
}
