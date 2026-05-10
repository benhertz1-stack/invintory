import { useState, useEffect } from 'react';
import { X, Trash2, MoveRight, MinusCircle, Loader, ChevronRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  consumeBottle, deleteBottle, relocateBottle, getRackData,
  RackData, RelocatePayload,
} from '../lib/api';
import { Bottle } from '../types';
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

// ── 3D Rack SVG ──────────────────────────────────────────────────────────────

function RackVisualization({
  rack,
  highlightBottleId,
}: {
  rack: RackData;
  highlightBottleId: string;
}) {
  const rows = Math.max(rack.maxRow, 4);
  const cols = Math.max(rack.maxCol, 4);
  const slotR = 14;
  const cellW = Math.max(34, Math.min(52, 320 / cols));
  const cellH = 40;
  const padX = 20;
  const padY = 16;
  const svgW = padX * 2 + cols * cellW;
  const svgH = padY * 2 + rows * cellH;

  const slotMap = new Map(
    rack.slots.map((s) => [`${s.row ?? 0}-${s.column ?? 0}`, s])
  );

  return (
    <div
      style={{ perspective: '700px', perspectiveOrigin: '55% 35%' }}
      className="flex items-center justify-center"
    >
      <div style={{ transform: 'rotateX(18deg) rotateY(-18deg)' }}>
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          width={svgW}
          height={svgH}
          className="drop-shadow-2xl"
        >
          <defs>
            <radialGradient id="glowYellow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </radialGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Rack frame */}
          <rect x="2" y="2" width={svgW - 4} height={svgH - 4} rx="6"
            fill="#0f172a" stroke="#334155" strokeWidth="1.5" />

          {/* Shelf dividers */}
          {Array.from({ length: rows - 1 }, (_, i) => (
            <rect
              key={i}
              x={padX - 6}
              y={padY + (i + 1) * cellH - 3}
              width={svgW - (padX - 6) * 2}
              height={5}
              rx="1"
              fill="#1e293b"
              stroke="#334155"
              strokeWidth="0.5"
            />
          ))}

          {/* Bottle slots */}
          {Array.from({ length: rows }, (_, rowIdx) =>
            Array.from({ length: cols }, (_, colIdx) => {
              const row = rowIdx + 1;
              const col = colIdx + 1;
              const key = `${row}-${col}`;
              const slot = slotMap.get(key);
              const isHighlighted = slot?.bottleId === highlightBottleId;
              const isOccupied = !!slot;

              const cx = padX + colIdx * cellW + cellW / 2;
              const cy = padY + rowIdx * cellH + cellH / 2;

              return (
                <g key={key}>
                  {/* Glow for highlighted */}
                  {isHighlighted && (
                    <circle cx={cx} cy={cy} r={slotR + 8} fill="url(#glowYellow)" />
                  )}

                  {/* Slot hole shadow */}
                  <circle cx={cx + 1} cy={cy + 1} r={slotR} fill="#000" opacity="0.4" />

                  {/* Slot circle */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={slotR}
                    fill={isHighlighted ? '#1c1005' : isOccupied ? '#1a0505' : '#1e293b'}
                    stroke={isHighlighted ? '#fbbf24' : isOccupied ? '#7f1d1d' : '#334155'}
                    strokeWidth={isHighlighted ? 2.5 : 1}
                  />

                  {/* Inner ring for occupied */}
                  {isOccupied && !isHighlighted && (
                    <circle cx={cx} cy={cy} r={slotR - 5} fill="none"
                      stroke="#991b1b" strokeWidth="1" opacity="0.6" />
                  )}

                  {/* Wine bottle dot for occupied */}
                  {isOccupied && !isHighlighted && (
                    <circle cx={cx} cy={cy} r={4} fill="#7f1d1d" opacity="0.8" />
                  )}

                  {/* Highlighted bottle indicator */}
                  {isHighlighted && (
                    <>
                      <circle cx={cx} cy={cy} r={slotR - 4} fill="none"
                        stroke="#fbbf24" strokeWidth="1.5" />
                      <circle cx={cx} cy={cy} r={5} fill="#fbbf24" />
                    </>
                  )}

                  {/* Row/Col label on first row/col */}
                  {rowIdx === 0 && (
                    <text x={cx} y={padY - 4} textAnchor="middle"
                      fontSize="7" fill="#475569" fontFamily="sans-serif">
                      C{col}
                    </text>
                  )}
                </g>
              );
            })
          )}

          {/* Row labels */}
          {Array.from({ length: rows }, (_, i) => (
            <text
              key={i}
              x={padX - 10}
              y={padY + i * cellH + cellH / 2 + 3}
              textAnchor="middle"
              fontSize="7"
              fill="#475569"
              fontFamily="sans-serif"
            >
              R{i + 1}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ── Relocate form ─────────────────────────────────────────────────────────────

function RelocateForm({
  bottle,
  onSubmit,
  onCancel,
}: {
  bottle: Bottle;
  onSubmit: (payload: RelocatePayload) => void;
  onCancel: () => void;
}) {
  const [cellar, setCellar] = useState(bottle.cellar);
  const [location, setLocation] = useState(bottle.location);
  const [section, setSection] = useState(bottle.section);
  const [row, setRow] = useState(String(bottle.row ?? ''));
  const [col, setCol] = useState(String(bottle.column ?? ''));
  const [depth, setDepth] = useState(String(bottle.depth ?? ''));

  const inputCls =
    'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-wine-500 w-full';

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Cellar / Fridge</label>
        <input value={cellar} onChange={(e) => setCellar(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Shelf / Location</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Section</label>
        <input value={section} onChange={(e) => setSection(e.target.value)} className={inputCls} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Row</label>
          <input type="number" min="1" value={row} onChange={(e) => setRow(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Column</label>
          <input type="number" min="1" value={col} onChange={(e) => setCol(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Depth</label>
          <input type="number" min="1" value={depth} onChange={(e) => setDepth(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() =>
            onSubmit({
              cellar, location, section,
              row: row ? parseInt(row) : undefined,
              column: col ? parseInt(col) : undefined,
              depth: depth ? parseInt(depth) : undefined,
            })
          }
          className="flex-1 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          Save Location
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function CellarModal({
  wineId, wineName, producer, vintage, wineType, bottle, onClose,
}: Props) {
  const queryClient = useQueryClient();
  const [rack, setRack] = useState<RackData | null>(null);
  const [mode, setMode] = useState<'view' | 'relocate'>('view');
  const [busy, setBusy] = useState<'remove' | 'relocate' | 'delete' | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (bottle.cellar) {
      getRackData(bottle.cellar, bottle.location || undefined)
        .then(setRack)
        .catch(() => {});
    }
  }, [bottle.cellar, bottle.location]);

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['wine', wineId] }),
      queryClient.invalidateQueries({ queryKey: ['wines'] }),
    ]);
  }

  async function handleRemove() {
    setBusy('remove');
    try {
      await consumeBottle(wineId, bottle.id);
      await invalidate();
      setDone(true);
      setTimeout(onClose, 800);
    } finally {
      setBusy(null);
    }
  }

  async function handleRelocate(payload: RelocatePayload) {
    setBusy('relocate');
    try {
      await relocateBottle(wineId, bottle.id, payload);
      await invalidate();
      onClose();
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy('delete');
    try {
      await deleteBottle(wineId, bottle.id);
      await invalidate();
      onClose();
    } finally {
      setBusy(null);
    }
  }

  const locationBreadcrumb = [
    bottle.cellar,
    bottle.location,
    [bottle.row && `R${bottle.row}`, bottle.column && `C${bottle.column}`, bottle.depth && `D${bottle.depth}`]
      .filter(Boolean)
      .join(', '),
  ]
    .filter(Boolean)
    .join(' › ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">
              {bottle.location || bottle.cellar}
            </p>
            <h2 className="text-base font-semibold text-white">{bottle.cellar}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
          {/* Left — Rack */}
          <div className="flex-1 flex items-center justify-center bg-slate-900/40 p-6 overflow-auto">
            {rack ? (
              <RackVisualization rack={rack} highlightBottleId={bottle.id} />
            ) : (
              <div className="text-slate-600 text-sm">Loading rack…</div>
            )}
          </div>

          {/* Right — Bottle panel */}
          <div className="w-full md:w-72 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col overflow-y-auto shrink-0">
            {/* Bottle count badge */}
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-200">Located Bottle</span>
              <span className="bg-wine-700/40 border border-wine-700/50 text-wine-300 text-xs px-2 py-0.5 rounded-full">
                1
              </span>
            </div>

            {/* Bottle card */}
            <div className="p-4 border-b border-slate-800/60">
              <div className="flex gap-3">
                {/* Wine bottle image */}
                <div className="shrink-0 w-16">
                  <WineBottleImage
                    name={wineName}
                    producer={producer}
                    vintage={vintage}
                    wineType={wineType}
                    className="w-full h-auto"
                  />
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <p className="text-xs font-semibold text-white leading-snug">
                    {vintage} {wineName}
                  </p>
                  <p className="text-xs text-slate-500">{bottle.size}</p>
                  {(bottle.bottleCode || bottle.barcode) && (
                    <p className="text-xs text-slate-600 font-mono">
                      # {bottle.bottleCode || bottle.barcode}
                    </p>
                  )}
                  {bottle.addedOn && (
                    <p className="text-xs text-slate-600">Added {bottle.addedOn.split(' ')[0]}</p>
                  )}

                  {/* Location breadcrumb */}
                  <div className="flex items-center gap-0.5 flex-wrap pt-0.5">
                    {locationBreadcrumb.split(' › ').map((part, i, arr) => (
                      <span key={i} className="flex items-center gap-0.5">
                        <span className="text-xs text-slate-400">{part}</span>
                        {i < arr.length - 1 && <ChevronRight size={10} className="text-slate-600" />}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Action area */}
            <div className="p-4 flex-1">
              {done ? (
                <div className="text-center text-emerald-400 text-sm py-4">Marked as consumed ✓</div>
              ) : mode === 'relocate' ? (
                <RelocateForm
                  bottle={bottle}
                  onSubmit={handleRelocate}
                  onCancel={() => setMode('view')}
                />
              ) : (
                <div className="space-y-2">
                  {/* Remove */}
                  <button
                    onClick={handleRemove}
                    disabled={!!busy}
                    className="w-full flex items-center justify-center gap-2 bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                  >
                    {busy === 'remove' ? (
                      <Loader size={14} className="animate-spin" />
                    ) : (
                      <MinusCircle size={14} />
                    )}
                    Remove (Consumed)
                  </button>

                  {/* Relocate */}
                  <button
                    onClick={() => setMode('relocate')}
                    disabled={!!busy}
                    className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-sm font-medium py-2.5 rounded-lg transition-colors border border-slate-700"
                  >
                    <MoveRight size={14} />
                    Relocate
                  </button>

                  {/* Delete */}
                  <button
                    onClick={handleDelete}
                    disabled={!!busy}
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-slate-400 hover:text-red-400 text-sm font-medium py-2.5 rounded-lg transition-colors border border-slate-800"
                  >
                    {busy === 'delete' ? (
                      <Loader size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Delete Bottle Record
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
