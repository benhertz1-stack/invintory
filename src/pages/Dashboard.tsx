import { Link } from 'react-router-dom';
import { Package, Wine, DollarSign, Star, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCollection } from '../hooks/useCollection';

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
        <div className={`p-1.5 rounded-lg ${accent}`}>
          <Icon size={14} className="text-white" />
        </div>
      </div>
      <div className="text-3xl font-bold text-white">{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const { profile } = useAuth();
  const { data: collection, isLoading, error } = useCollection();

  const totalBottles =
    collection?.labels.reduce((s, l) => s + l.bottles.filter((b) => !b.consumed).length, 0) ?? 0;
  const unpricedBottles =
    collection?.labels.reduce(
      (s, l) => s + l.bottles.filter((b) => !b.price && !b.consumed).length,
      0
    ) ?? 0;
  const scored = collection?.labels.filter((l) => l.wsScore) ?? [];
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((s, l) => s + (l.wsScore ?? 0), 0) / scored.length)
      : '—';

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white">
          Welcome back, {profile?.firstName ?? 'Collector'}
        </h1>
        <p className="text-slate-400 mt-1 text-sm">
          {collection?.name ?? 'Loading your collection...'}
        </p>
      </div>

      {isLoading && (
        <div className="text-slate-400 text-sm py-10 text-center">Loading collection...</div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-4 py-3 mb-6 text-sm">
          Failed to load collection. Your session may have expired — sign out and back in.
        </div>
      )}

      {collection && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
            <StatCard label="Active Bottles" value={totalBottles} icon={Package} accent="bg-slate-700" />
            <StatCard label="Wine Labels" value={collection.labels.length} icon={Wine} accent="bg-wine-700" />
            <StatCard label="Unpriced" value={unpricedBottles} icon={DollarSign} accent="bg-amber-700" />
            <StatCard label="Avg WS Score" value={avgScore} icon={Star} accent="bg-emerald-700" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Link
              to="/collection"
              className="bg-slate-900 border border-slate-800 hover:border-wine-700 rounded-xl p-5 transition-colors group"
            >
              <h2 className="font-semibold text-white group-hover:text-wine-400 transition-colors">
                Browse Collection →
              </h2>
              <p className="text-slate-500 mt-1 text-sm">
                {collection.labels.length} labels · {totalBottles} bottles
              </p>
            </Link>

            <Link
              to="/update-prices"
              className={`bg-slate-900 rounded-xl p-5 transition-colors group border ${
                unpricedBottles > 0
                  ? 'border-amber-800/60 hover:border-amber-600'
                  : 'border-slate-800 hover:border-slate-600'
              }`}
            >
              <h2 className="font-semibold text-white group-hover:text-amber-400 transition-colors">
                Update Prices →
              </h2>
              <p className="text-slate-500 mt-1 text-sm">
                {unpricedBottles > 0
                  ? `${unpricedBottles} bottle${unpricedBottles !== 1 ? 's' : ''} missing prices`
                  : 'All bottles priced'}
              </p>
            </Link>

            <Link
              to="/advisor"
              className="bg-slate-900 border border-slate-800 hover:border-purple-700 rounded-xl p-5 transition-colors group"
            >
              <h2 className="font-semibold text-white group-hover:text-purple-400 transition-colors flex items-center gap-2">
                <Sparkles size={16} />
                Wine Advisor →
              </h2>
              <p className="text-slate-500 mt-1 text-sm">
                Ask Claude to pick wines from your collection
              </p>
            </Link>
          </div>

          {collection.cellars.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">
                Cellars
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {collection.cellars.map((cellar) => {
                  const count = collection.labels.reduce(
                    (s, l) =>
                      s + l.bottles.filter((b) => b.cellarId === cellar.id && !b.consumed).length,
                    0
                  );
                  return (
                    <div
                      key={cellar.id}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3"
                    >
                      <p className="text-sm font-medium text-slate-200 truncate">{cellar.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{count} bottles</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
