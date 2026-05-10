import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, MapPin, Package, DollarSign } from 'lucide-react';
import { useWines, drinkWindowStatus } from '../hooks/useCollection';
import { Wine } from '../types';

function DrinkBadge({ wine }: { wine: Wine }) {
  const status = drinkWindowStatus(wine);
  if (status === 'drink') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 border border-emerald-800/50">
        Drink Now
      </span>
    );
  }
  if (status === 'hold') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-800/50">
        Hold
      </span>
    );
  }
  if (status === 'past') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">
        Past Peak
      </span>
    );
  }
  return null;
}

function TypeBadge({ type }: { type: string }) {
  const palette: Record<string, string> = {
    red: 'bg-red-900/40 text-red-300 border-red-800/40',
    white: 'bg-yellow-900/40 text-yellow-300 border-yellow-800/40',
    rosé: 'bg-pink-900/40 text-pink-300 border-pink-800/40',
    sparkling: 'bg-blue-900/40 text-blue-300 border-blue-800/40',
    dessert: 'bg-amber-900/40 text-amber-300 border-amber-800/40',
  };
  const key = type.toLowerCase();
  const cls = palette[key] ?? 'bg-slate-700 text-slate-300 border-slate-600';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${cls}`}>{type}</span>
  );
}

function WineCard({ wine }: { wine: Wine }) {
  const value = wine.marketValue ?? 0;
  return (
    <Link
      to={`/collection/${wine.id}`}
      className="bg-slate-900 border border-slate-800 hover:border-wine-600 rounded-xl p-5 transition-colors group flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500 truncate">{wine.producer}</p>
          <h3 className="font-semibold text-white text-sm mt-0.5 leading-snug group-hover:text-wine-300 transition-colors">
            {wine.name}
          </h3>
        </div>
        <span className="text-lg font-bold text-slate-300 shrink-0">{wine.vintage}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <TypeBadge type={wine.wineType} />
        <DrinkBadge wine={wine} />
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 mt-auto pt-1 border-t border-slate-800/60">
        <span className="flex items-center gap-1">
          <MapPin size={10} />
          {wine.region || wine.country}
        </span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <Package size={10} />
            {wine.bottleCount}
          </span>
          {value > 0 && (
            <span className="flex items-center gap-1 text-emerald-400">
              <DollarSign size={10} />${value.toFixed(0)}
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}

type SortKey = 'producer' | 'vintage' | 'value' | 'bottles';

export default function Collection() {
  const { data: wines, isLoading } = useWines();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [windowFilter, setWindowFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('producer');

  const wineTypes = useMemo(
    () => [...new Set(wines?.map((w) => w.wineType) ?? [])].sort(),
    [wines]
  );

  const filtered = useMemo(() => {
    if (!wines) return [];
    const q = search.toLowerCase();
    return wines
      .filter((w) => {
        const matchSearch =
          !q ||
          w.producer.toLowerCase().includes(q) ||
          w.name.toLowerCase().includes(q) ||
          (w.region ?? '').toLowerCase().includes(q) ||
          (w.country ?? '').toLowerCase().includes(q) ||
          (w.grapes ?? '').toLowerCase().includes(q) ||
          String(w.vintage).includes(q);
        const matchType = !typeFilter || w.wineType === typeFilter;
        const matchWindow =
          !windowFilter || drinkWindowStatus(w) === windowFilter;
        return matchSearch && matchType && matchWindow;
      })
      .sort((a, b) => {
        if (sortBy === 'vintage') return b.vintage - a.vintage;
        if (sortBy === 'value') return (b.marketValue ?? 0) - (a.marketValue ?? 0);
        if (sortBy === 'bottles') return (b.bottleCount ?? 0) - (a.bottleCount ?? 0);
        return a.producer.localeCompare(b.producer) || a.name.localeCompare(b.name);
      });
  }, [wines, search, typeFilter, windowFilter, sortBy]);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Collection</h1>
        <p className="text-slate-400 mt-1 text-sm">
          {filtered.length} of {wines?.length ?? 0} labels
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2.5 mb-6">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search producer, wine, region, grape, vintage..."
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
            <option key={t} value={t} className="capitalize">
              {t}
            </option>
          ))}
        </select>
        <select
          value={windowFilter}
          onChange={(e) => setWindowFilter(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-wine-500"
        >
          <option value="">All windows</option>
          <option value="drink">Drink Now</option>
          <option value="hold">Hold</option>
          <option value="past">Past Peak</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-wine-500"
        >
          <option value="producer">Sort: Producer</option>
          <option value="vintage">Sort: Vintage</option>
          <option value="value">Sort: Value</option>
          <option value="bottles">Sort: Bottles</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-slate-400 text-sm">Loading your collection...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((wine) => (
            <WineCard key={wine.id} wine={wine} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-20 text-slate-500 text-sm">
              No wines match your search.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
