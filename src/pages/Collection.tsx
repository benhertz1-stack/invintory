import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { useCollection } from '../hooks/useCollection';
import { Label, Cellar } from '../types';

function TypeBadge({ type }: { type: string }) {
  const palette: Record<string, string> = {
    Red: 'bg-red-900/40 text-red-300',
    White: 'bg-yellow-900/40 text-yellow-300',
    Rosé: 'bg-pink-900/40 text-pink-300',
    Sparkling: 'bg-blue-900/40 text-blue-300',
    Dessert: 'bg-amber-900/40 text-amber-300',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${palette[type] ?? 'bg-slate-700 text-slate-300'}`}>
      {type}
    </span>
  );
}

function LabelRow({ label, cellars }: { label: Label; cellars: Cellar[] }) {
  const [open, setOpen] = useState(false);
  const active = label.bottles.filter((b) => !b.consumed);
  const priced = active.filter((b) => b.price).length;
  const cellarMap = Object.fromEntries(cellars.map((c) => [c.id, c.name]));

  return (
    <div className="border border-slate-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white text-sm">{label.wine.winery}</span>
            <TypeBadge type={label.wine.wineType} />
          </div>
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            {label.wine.name} · {label.year}
            {label.wine.region ? ` · ${label.wine.region}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-5 shrink-0 text-right">
          {label.wsScore != null && (
            <div>
              <span className="text-base font-bold text-emerald-400">{label.wsScore}</span>
              <span className="text-xs text-slate-500 ml-0.5">WS</span>
            </div>
          )}
          <div>
            <span className="text-white font-medium text-sm">{active.length}</span>
            <span className="text-slate-500 text-xs"> btl</span>
          </div>
          <div className="hidden sm:block">
            <span className={priced === active.length ? 'text-emerald-400 text-sm' : 'text-amber-400 text-sm'}>
              {priced}/{active.length}
            </span>
            <span className="text-slate-500 text-xs"> $</span>
          </div>
          {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-800 divide-y divide-slate-800/50">
          {label.bottles.map((bottle) => (
            <div
              key={bottle.id}
              className={`px-5 py-3 flex items-center gap-4 text-sm ${bottle.consumed ? 'opacity-40' : ''}`}
            >
              <span className="text-slate-400 flex-1 truncate">
                {cellarMap[bottle.cellarId] ?? 'Unknown Cellar'}
              </span>
              {bottle.consumed ? (
                <span className="text-xs text-slate-600 bg-slate-800 px-2 py-0.5 rounded-full">Consumed</span>
              ) : bottle.price ? (
                <span className="text-emerald-400">
                  {bottle.currency ?? 'USD'} {bottle.price.toFixed(2)}
                </span>
              ) : (
                <span className="text-xs text-amber-400 bg-amber-900/20 px-2 py-0.5 rounded-full">
                  No price
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Collection() {
  const { data: collection, isLoading } = useCollection();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState<'winery' | 'year' | 'score'>('winery');

  const wineTypes = useMemo(
    () => [...new Set(collection?.labels.map((l) => l.wine.wineType) ?? [])].sort(),
    [collection]
  );

  const filtered = useMemo(() => {
    if (!collection) return [];
    const q = search.toLowerCase();
    return collection.labels
      .filter((l) => {
        const matchSearch =
          !q ||
          l.wine.winery.toLowerCase().includes(q) ||
          l.wine.name.toLowerCase().includes(q) ||
          (l.wine.region ?? '').toLowerCase().includes(q) ||
          String(l.year).includes(q);
        return matchSearch && (!typeFilter || l.wine.wineType === typeFilter);
      })
      .sort((a, b) => {
        if (sortBy === 'year') return b.year - a.year;
        if (sortBy === 'score') return (b.wsScore ?? 0) - (a.wsScore ?? 0);
        return a.wine.winery.localeCompare(b.wine.winery);
      });
  }, [collection, search, typeFilter, sortBy]);

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Collection</h1>
        <p className="text-slate-400 mt-1 text-sm">
          {filtered.length} of {collection?.labels.length ?? 0} labels
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2.5 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search winery, wine, region, vintage..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-wine-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-wine-500"
        >
          <option value="">All types</option>
          {wineTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-wine-500"
        >
          <option value="winery">Sort: Winery</option>
          <option value="year">Sort: Vintage</option>
          <option value="score">Sort: WS Score</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-slate-400 text-sm">Loading your collection...</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((label) => (
            <LabelRow key={label.id} label={label} cellars={collection?.cellars ?? []} />
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-20 text-slate-500 text-sm">No wines match your search.</div>
          )}
        </div>
      )}
    </div>
  );
}
