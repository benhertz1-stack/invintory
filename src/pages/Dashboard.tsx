import { Link } from 'react-router-dom';
import { Package, Wine, DollarSign, Clock, Sparkles } from 'lucide-react';
import { useWines, drinkWindowStatus } from '../hooks/useCollection';

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
  const { data: wines, isLoading, error } = useWines();

  const totalBottles = wines?.reduce((s, w) => s + (w.bottleCount ?? 0), 0) ?? 0;
  const totalValue = wines?.reduce((s, w) => s + (w.marketValue ?? 0), 0) ?? 0;
  const peakCount = wines?.filter((w) => drinkWindowStatus(w) === 'drink').length ?? 0;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 mt-1 text-sm">Your wine collection at a glance</p>
      </div>

      {isLoading && (
        <div className="text-slate-400 text-sm py-10 text-center">Loading collection...</div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-4 py-3 mb-6 text-sm">
          Failed to load collection.
        </div>
      )}

      {wines && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
            <StatCard
              label="Active Bottles"
              value={totalBottles}
              icon={Package}
              accent="bg-slate-700"
            />
            <StatCard
              label="Wine Labels"
              value={wines.length}
              icon={Wine}
              accent="bg-wine-700"
            />
            <StatCard
              label="Market Value"
              value={`$${totalValue.toFixed(0)}`}
              icon={DollarSign}
              accent="bg-emerald-700"
            />
            <StatCard
              label="Drink Now"
              value={peakCount}
              icon={Clock}
              accent="bg-amber-700"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
            <Link
              to="/collection"
              className="bg-slate-900 border border-slate-800 hover:border-wine-700 rounded-xl p-5 transition-colors group"
            >
              <h2 className="font-semibold text-white group-hover:text-wine-400 transition-colors">
                Browse Collection →
              </h2>
              <p className="text-slate-500 mt-1 text-sm">
                {wines.length} labels · {totalBottles} bottles
              </p>
            </Link>

            <Link
              to="/collection"
              className="bg-slate-900 border border-amber-800/50 hover:border-amber-600 rounded-xl p-5 transition-colors group"
            >
              <h2 className="font-semibold text-white group-hover:text-amber-400 transition-colors">
                Drink Now →
              </h2>
              <p className="text-slate-500 mt-1 text-sm">
                {peakCount} wine{peakCount !== 1 ? 's' : ''} in peak window
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

          {wines.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">
                By Region
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {Object.entries(
                  wines.reduce<Record<string, number>>((acc, w) => {
                    const r = w.region || w.country || 'Unknown';
                    acc[r] = (acc[r] ?? 0) + (w.bottleCount ?? 0);
                    return acc;
                  }, {})
                )
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([region, count]) => (
                    <div
                      key={region}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3"
                    >
                      <p className="text-sm font-medium text-slate-200 truncate">{region}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{count} bottles</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
