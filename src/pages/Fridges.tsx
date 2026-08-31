import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Refrigerator, MapPin } from 'lucide-react';
import FridgeViewer3D from '../components/FridgeViewer3D';
import { getRackData } from '../lib/api';
import { useFridges } from '../hooks/useCollection';

/** Browse a fridge in 3D: click a slot or a shelf to pull it out and see what's on it. */
export default function Fridges() {
  const { data: fridges, isLoading } = useFridges();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulled, setPulled] = useState<number | null>(null);
  const [picked, setPicked] = useState<{ row: number; col: number } | null>(null);

  const fridge = useMemo(() => fridges?.find((f) => f.id === selectedId) ?? fridges?.[0] ?? null, [fridges, selectedId]);

  useEffect(() => {
    setPulled(null);
    setPicked(null);
  }, [fridge?.id]);

  const { data: rack } = useQuery({
    queryKey: ['rack', fridge?.name],
    queryFn: () => getRackData(fridge!.name),
    enabled: !!fridge,
  });

  if (isLoading) return <div className="p-8 text-slate-400 text-sm">Loading fridges…</div>;
  if (!fridge) return <div className="p-8 text-slate-400 text-sm">No fridges registered yet — ask Claude to set one up from a photo.</div>;

  const slots = rack?.slots ?? [];
  const occupiedSlots = slots.map((s) => ({ row: s.shelf, col: s.column }));
  const pickedSlot = picked ? slots.find((s) => s.shelf === picked.row && s.column === picked.col) : null;
  const shelfSlots = pulled ? slots.filter((s) => s.shelf === pulled).sort((a, b) => a.column - b.column) : [];
  const shelves = [...fridge.shelves].sort((a, b) => a.row - b.row);

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Refrigerator size={22} className="text-wine-500" />
            {fridge.name}
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {fridge.model ? `${fridge.model} · ` : ''}
            {fridge.shelves.length} shelves · {slots.length} bottles placed
          </p>
        </div>
        {fridges && fridges.length > 1 && (
          <select
            value={fridge.id}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300"
          >
            {fridges.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4">
        <FridgeViewer3D
          shelves={fridge.shelves}
          occupiedSlots={occupiedSlots}
          highlight={picked}
          pulledShelf={pulled}
          fridgeName={fridge.name}
          wineName={pickedSlot ? pickedSlot.wineName : undefined}
          vintage={pickedSlot?.vintage}
          height="min(70vh, 720px)"
          onSlotClick={(row, col) => {
            setPulled(row);
            setPicked({ row, col });
          }}
        />

        <aside className="space-y-3">
          {pickedSlot && (
            <div className="bg-slate-900 border border-amber-800/50 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Selected</p>
              <p className="text-white font-semibold">
                {pickedSlot.vintage} {pickedSlot.wineName}
              </p>
              <p className="text-amber-400 text-xs mt-1 flex items-center gap-1">
                <MapPin size={11} /> shelf {pickedSlot.shelf} · pos {pickedSlot.column}
              </p>
              <div className="flex gap-2 mt-3">
                <Link to={`/collection/${pickedSlot.wineId}`} className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200">
                  Wine details
                </Link>
                <Link to={`/locate/${pickedSlot.wineId}/${pickedSlot.bottleId}`} className="text-xs px-3 py-1.5 bg-wine-700 hover:bg-wine-600 rounded-lg text-white">
                  Locate view
                </Link>
              </div>
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wide">Shelves (top → bottom)</div>
            <div className="max-h-[50vh] overflow-y-auto divide-y divide-slate-800/60">
              {shelves.map((sh) => {
                const n = slots.filter((s) => s.shelf === sh.row).length;
                const active = pulled === sh.row;
                return (
                  <div key={sh.row}>
                    <button
                      onClick={() => {
                        setPulled(active ? null : sh.row);
                        setPicked(null);
                      }}
                      className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${
                        active ? 'bg-amber-900/20 text-amber-300' : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span>
                        Shelf {sh.row}
                        {sh.isDisplay ? <span className="text-slate-500 text-xs"> · display</span> : null}
                      </span>
                      <span className="text-xs text-slate-500">
                        {n}/{sh.cols}
                      </span>
                    </button>
                    {active && (
                      <div className="px-4 pb-2 space-y-1">
                        {shelfSlots.length === 0 && <p className="text-xs text-slate-500">Empty</p>}
                        {shelfSlots.map((s) => (
                          <button
                            key={s.bottleId}
                            onClick={() => setPicked({ row: s.shelf, col: s.column })}
                            className={`w-full text-left text-xs px-2 py-1 rounded ${
                              picked?.col === s.column ? 'bg-amber-900/30 text-amber-200' : 'text-slate-400 hover:bg-slate-800'
                            }`}
                          >
                            <span className="font-mono text-slate-500 mr-2">{s.column}</span>
                            {s.vintage} {s.wineName}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
