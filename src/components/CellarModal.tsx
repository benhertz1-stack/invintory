import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Trash2, MoveRight, MinusCircle, Loader, ChevronRight, Maximize2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { consumeBottle, deleteBottle, relocateBottle, getRackData, rateBottle, RackData, RelocatePayload, RatingPayload } from '../lib/api';
import { Bottle, FridgeConfig } from '../types';
import { bottleLocation, useFridges } from '../hooks/useCollection';
import FridgeViewer3D from './FridgeViewer3D';
import RatingForm from './RatingForm';
import WineBottleImage from './WineBottleImage';

interface Props {
  wineId: string;
  wineName: string;
  producer: string;
  vintage: number;
  wineType: string;
  bottle: Bottle;
  onClose: () => void;
}

// ── Relocate form ─────────────────────────────────────────────────────────────

function RelocateForm({
  bottle,
  fridges,
  onSubmit,
  onCancel,
}: {
  bottle: Bottle;
  fridges: FridgeConfig[];
  onSubmit: (payload: RelocatePayload) => void;
  onCancel: () => void;
}) {
  const initial = fridges.find((f) => f.name.toLowerCase() === (bottle.cellar || '').toLowerCase()) ?? fridges[0];
  const [fridgeId, setFridgeId] = useState(initial?.id ?? '');
  const fridge = fridges.find((f) => f.id === fridgeId) ?? initial;
  const shelves = useMemo(() => [...(fridge?.shelves ?? [])].sort((a, b) => a.row - b.row), [fridge]);
  const [shelf, setShelf] = useState<number>(bottle.shelf ?? shelves[0]?.row ?? 1);
  const [position, setPosition] = useState<number>(bottle.column ?? 1);
  const [depth, setDepth] = useState<number>(bottle.depth ?? 1);
  const shelfCfg = shelves.find((s) => s.row === shelf) ?? shelves[0];
  const cols = shelfCfg?.cols ?? 1;

  useEffect(() => {
    if (!shelves.some((s) => s.row === shelf)) setShelf(shelves[0]?.row ?? 1);
  }, [shelves, shelf]);
  useEffect(() => {
    if (position > cols) setPosition(cols);
  }, [cols, position]);

  const selectCls = 'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-wine-500 w-full';

  if (!fridge) return <p className="text-slate-400 text-sm">No fridges registered yet.</p>;

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Fridge</label>
        <select value={fridge.id} onChange={(e) => setFridgeId(e.target.value)} className={selectCls}>
          {fridges.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Shelf (from top)</label>
          <select value={shelf} onChange={(e) => setShelf(Number(e.target.value))} className={selectCls}>
            {shelves.map((s) => (
              <option key={s.row} value={s.row}>
                {s.row}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Pos (from left)</label>
          <select value={position} onChange={(e) => setPosition(Number(e.target.value))} className={selectCls}>
            {Array.from({ length: cols }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Depth</label>
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))} className={selectCls}>
            <option value={1}>Front</option>
            <option value={2}>Back</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSubmit({ fridge: fridge.name, shelf, position, depth })}
          className="flex-1 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          Save location
        </button>
        <button onClick={onCancel} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export default function CellarModal({ wineId, wineName, producer, vintage, wineType, bottle, onClose }: Props) {
  const queryClient = useQueryClient();
  const { data: fridges = [] } = useFridges();
  const [rack, setRack] = useState<RackData | null>(null);
  const [mode, setMode] = useState<'view' | 'relocate' | 'rate' | 'done'>('view');
  const [busy, setBusy] = useState<'remove' | 'relocate' | 'delete' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fridgeName = bottle.cellar || fridges[0]?.name || '';

  useEffect(() => {
    if (!fridgeName) return;
    getRackData(fridgeName).then(setRack).catch(() => setRack(null));
  }, [fridgeName]);

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['wine', wineId] }),
      queryClient.invalidateQueries({ queryKey: ['wines'] }),
      queryClient.invalidateQueries({ queryKey: ['rack'] }),
      queryClient.invalidateQueries({ queryKey: ['fridges'] }),
    ]);
  }

  async function handleRemove() {
    setBusy('remove');
    try {
      await consumeBottle(wineId, bottle.id);
      await invalidate();
      setMode('rate');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleRate(p: RatingPayload) {
    await rateBottle(wineId, bottle.id, p);
    await invalidate();
    setMode('done');
    setTimeout(onClose, 800);
  }

  async function handleRelocate(payload: RelocatePayload) {
    setBusy('relocate');
    try {
      await relocateBottle(wineId, bottle.id, payload);
      await invalidate();
      onClose();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed');
      setMode('view');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this bottle record permanently? (Use "Consumed" if you drank it.)')) return;
    setBusy('delete');
    try {
      await deleteBottle(wineId, bottle.id);
      await invalidate();
      onClose();
    } finally {
      setBusy(null);
    }
  }

  const highlight = bottle.shelf && bottle.column ? { row: bottle.shelf, col: bottle.column } : null;
  const shelves = rack?.fridge.shelves ?? fridges.find((f) => f.name === fridgeName)?.shelves ?? [];
  const occupiedSlots = (rack?.slots ?? []).map((s) => ({ row: s.shelf, col: s.column }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[94vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 shrink-0">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 uppercase tracking-wide truncate">{bottleLocation(bottle)}</p>
            <h2 className="text-base font-semibold text-white truncate">
              {vintage} {wineName}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <Link to={`/locate/${wineId}/${bottle.id}`} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" title="Open full-screen locate view">
              <Maximize2 size={16} />
            </Link>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
          <div className="flex-1 p-3 sm:p-4 overflow-auto">
            {shelves.length ? (
              <FridgeViewer3D
                shelves={shelves}
                occupiedSlots={occupiedSlots}
                highlight={highlight}
                pulledShelf={highlight?.row ?? null}
                fridgeName={fridgeName}
                wineName={wineName}
                vintage={vintage}
                height="min(55vh, 520px)"
              />
            ) : (
              <div className="h-40 flex items-center justify-center text-slate-600 text-sm">Loading fridge…</div>
            )}
          </div>

          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col overflow-y-auto shrink-0">
            <div className="p-4 border-b border-slate-800/60 flex gap-3">
              <div className="shrink-0 w-14">
                <WineBottleImage name={wineName} producer={producer} vintage={vintage} wineType={wineType} className="w-full h-auto" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-xs font-semibold text-white leading-snug">
                  {vintage} {wineName}
                </p>
                <p className="text-xs text-slate-500">{bottle.size || '750ml'}</p>
                <p className="text-xs text-slate-600 font-mono truncate"># {bottle.id}</p>
                <div className="flex items-center gap-0.5 flex-wrap pt-0.5">
                  {bottleLocation(bottle)
                    .split(' › ')
                    .map((part, i, arr) => (
                      <span key={i} className="flex items-center gap-0.5">
                        <span className="text-xs text-slate-400">{part}</span>
                        {i < arr.length - 1 && <ChevronRight size={10} className="text-slate-600" />}
                      </span>
                    ))}
                </div>
              </div>
            </div>

            <div className="p-4 flex-1">
              {message && <p className="text-red-400 text-xs mb-3">{message}</p>}
              {mode === 'done' ? (
                <div className="text-center text-emerald-400 text-sm py-4">Saved ✓</div>
              ) : mode === 'rate' ? (
                <RatingForm wineLabel={`${vintage} ${wineName}`} onSubmit={handleRate} onSkip={onClose} />
              ) : mode === 'relocate' ? (
                <RelocateForm bottle={bottle} fridges={fridges} onSubmit={handleRelocate} onCancel={() => setMode('view')} />
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={handleRemove}
                    disabled={!!busy || bottle.consumed}
                    className="w-full flex items-center justify-center gap-2 bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                  >
                    {busy === 'remove' ? <Loader size={14} className="animate-spin" /> : <MinusCircle size={14} />}
                    Opened it (consumed)
                  </button>
                  <button
                    onClick={() => setMode('relocate')}
                    disabled={!!busy}
                    className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-sm font-medium py-2.5 rounded-lg transition-colors border border-slate-700"
                  >
                    <MoveRight size={14} />
                    Relocate
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={!!busy}
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-slate-400 hover:text-red-400 text-sm font-medium py-2.5 rounded-lg transition-colors border border-slate-800"
                  >
                    {busy === 'delete' ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Delete record
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
