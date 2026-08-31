import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FridgeShelf } from '../types';

interface Props {
  shelves: FridgeShelf[];
  occupiedSlots: { row: number; col: number }[];
  highlight: { row: number; col: number } | null;
  /** Shelf number to slide out of the cabinet (defaults to the highlighted bottle's shelf). */
  pulledShelf?: number | null;
  fridgeName: string;
  wineName?: string;
  vintage?: number;
  /** CSS height of the canvas area. */
  height?: number | string;
  onSlotClick?: (row: number, col: number) => void;
  hideChrome?: boolean;
}

const SHELF_H = 0.24;
const DIVIDER_H = 0.045;
const FRIDGE_W = 2.2;
const FRIDGE_D = 0.88;
const PULL_Z = 0.66;

// ── One bottle slot ───────────────────────────────────────────────────────────

function BottleSlot({
  x,
  r,
  occupied,
  highlighted,
  onClick,
}: {
  x: number;
  r: number;
  occupied: boolean;
  highlighted: boolean;
  onClick?: () => void;
}) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const face = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!highlighted) return;
    const pulse = 0.75 + 0.45 * Math.sin(clock.elapsedTime * 4);
    if (mat.current) mat.current.emissiveIntensity = pulse;
    if (face.current) face.current.emissiveIntensity = pulse * 1.6;
  });

  const handlers = onClick
    ? {
        onClick: (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          onClick();
        },
        onPointerOver: () => (document.body.style.cursor = 'pointer'),
        onPointerOut: () => (document.body.style.cursor = 'auto'),
      }
    : {};

  if (!occupied && !highlighted) {
    return (
      <mesh position={[x, 0, FRIDGE_D / 2 - 0.04]} {...handlers}>
        <ringGeometry args={[r - 0.012, r + 0.006, 24]} />
        <meshStandardMaterial color="#1b1b3d" side={THREE.DoubleSide} />
      </mesh>
    );
  }

  return (
    <group position={[x, 0, 0]} {...handlers}>
      {highlighted && <pointLight position={[0, 0.12, FRIDGE_D / 2 + 0.15]} intensity={5} color="#fbbf24" distance={1.4} />}
      {/* Bottle body, lying on its side pointing at the viewer */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.02]}>
        <cylinderGeometry args={[r, r, FRIDGE_D - 0.18, 22]} />
        <meshStandardMaterial
          ref={mat}
          color={highlighted ? '#3a2600' : '#1c0606'}
          emissive={highlighted ? '#fbbf24' : '#3a0000'}
          emissiveIntensity={highlighted ? 0.8 : 0.15}
          roughness={0.35}
          metalness={0.1}
        />
      </mesh>
      {/* Punt / foil face toward the viewer */}
      <mesh position={[0, 0, FRIDGE_D / 2 - 0.06]}>
        <circleGeometry args={[r * 0.96, 22]} />
        <meshStandardMaterial
          ref={face}
          color={highlighted ? '#fbbf24' : '#5a0f0f'}
          emissive={highlighted ? '#fbbf24' : '#000000'}
          emissiveIntensity={highlighted ? 1.2 : 0}
          toneMapped={!highlighted}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// ── One shelf (tray + bottles), slides forward when pulled ───────────────────

function Shelf({
  shelf,
  y,
  pulled,
  occupiedSet,
  highlight,
  onSlotClick,
}: {
  shelf: FridgeShelf;
  y: number;
  pulled: boolean;
  occupiedSet: Set<string>;
  highlight: Props['highlight'];
  onSlotClick?: Props['onSlotClick'];
}) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.position.z = THREE.MathUtils.damp(group.current.position.z, pulled ? PULL_Z : 0, 4, dt);
  });

  const cols = Math.max(1, shelf.cols);
  const slotW = (FRIDGE_W - 0.1) / cols;
  const slotR = Math.min(slotW * 0.38, 0.082);

  return (
    <group ref={group} position={[0, y, 0]}>
      {/* Tray */}
      <mesh position={[0, -SHELF_H / 2 + 0.015, 0]}>
        <boxGeometry args={[FRIDGE_W - 0.08, 0.03, FRIDGE_D - 0.08]} />
        <meshStandardMaterial color={pulled ? '#7a5424' : '#3b2a12'} roughness={0.9} />
      </mesh>
      {/* Side rails */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (FRIDGE_W / 2 - 0.05), -SHELF_H / 2 + 0.045, 0]}>
          <boxGeometry args={[0.02, 0.06, FRIDGE_D - 0.08]} />
          <meshStandardMaterial color="#2a1e0a" />
        </mesh>
      ))}
      {/* Front lip */}
      <mesh position={[0, -SHELF_H / 2 + 0.04, FRIDGE_D / 2 - 0.04]}>
        <boxGeometry args={[FRIDGE_W - 0.08, 0.05, 0.015]} />
        <meshStandardMaterial color={pulled ? '#a5702f' : '#4a3416'} />
      </mesh>

      {Array.from({ length: cols }, (_, i) => {
        const col = i + 1;
        const x = -FRIDGE_W / 2 + 0.05 + i * slotW + slotW / 2;
        const key = `${shelf.row}-${col}`;
        return (
          <BottleSlot
            key={key}
            x={x}
            r={slotR}
            occupied={occupiedSet.has(key)}
            highlighted={!!highlight && highlight.row === shelf.row && highlight.col === col}
            onClick={onSlotClick ? () => onSlotClick(shelf.row, col) : undefined}
          />
        );
      })}

      {pulled && (
        <Html position={[FRIDGE_W / 2 + 0.1, 0.02, FRIDGE_D / 2]} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
          <div className="px-2 py-0.5 rounded bg-amber-400 text-black text-xs font-semibold whitespace-nowrap shadow">
            Shelf {shelf.row}
          </div>
        </Html>
      )}
    </group>
  );
}

// ── Scene ─────────────────────────────────────────────────────────────────────

function FridgeScene({
  shelves,
  occupiedSlots,
  highlight,
  pulledShelf,
  onSlotClick,
}: Pick<Props, 'shelves' | 'occupiedSlots' | 'highlight' | 'pulledShelf' | 'onSlotClick'>) {
  const occupiedSet = useMemo(() => new Set(occupiedSlots.map((s) => `${s.row}-${s.col}`)), [occupiedSlots]);
  const sorted = useMemo(() => [...shelves].sort((a, b) => a.row - b.row), [shelves]);
  const totalH = useMemo(() => sorted.length * SHELF_H + (sorted.length - 1) * DIVIDER_H + 0.22, [sorted]);

  const shelfYs = useMemo(() => {
    const positions: number[] = [];
    let y = totalH / 2 - SHELF_H / 2 - 0.11;
    sorted.forEach((_, idx) => {
      if (idx > 0) y -= DIVIDER_H;
      positions.push(y);
      y -= SHELF_H;
    });
    return positions;
  }, [sorted, totalH]);

  const pulled = pulledShelf ?? highlight?.row ?? null;

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, totalH + 1, 2.8]} intensity={1.3} color="#5ba3d9" />
      <pointLight position={[1.8, 0.5, 2.6]} intensity={0.7} />
      <pointLight position={[-1.8, -0.5, 2.6]} intensity={0.45} />

      {/* Outer shell */}
      <mesh position={[0, 0, -0.07]}>
        <boxGeometry args={[FRIDGE_W + 0.14, totalH + 0.14, FRIDGE_D + 0.14]} />
        <meshStandardMaterial color="#17171b" metalness={0.75} roughness={0.25} />
      </mesh>
      {/* Cavity */}
      <mesh>
        <boxGeometry args={[FRIDGE_W, totalH, FRIDGE_D]} />
        <meshStandardMaterial color="#03030c" />
      </mesh>
      {/* LED strip */}
      <mesh position={[0, totalH / 2 - 0.04, FRIDGE_D / 2 - 0.005]}>
        <boxGeometry args={[FRIDGE_W - 0.06, 0.025, 0.015]} />
        <meshStandardMaterial color="#5ba3d9" emissive="#5ba3d9" emissiveIntensity={2.5} toneMapped={false} />
      </mesh>
      {/* Handle */}
      <mesh position={[FRIDGE_W / 2 + 0.085, 0, FRIDGE_D / 2 - 0.01]}>
        <boxGeometry args={[0.038, totalH * 0.55, 0.038]} />
        <meshStandardMaterial color="#2a2a30" metalness={0.85} roughness={0.15} />
      </mesh>
      {/* Hinges */}
      {[-totalH * 0.38, totalH * 0.38].map((hy, i) => (
        <mesh key={i} position={[-(FRIDGE_W / 2 + 0.075), hy, 0]}>
          <boxGeometry args={[0.05, 0.12, 0.06]} />
          <meshStandardMaterial color="#1a1a1e" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      {/* Static dividers between shelves */}
      {sorted.map((shelf, idx) =>
        idx > 0 ? (
          <mesh key={`div-${shelf.row}`} position={[0, shelfYs[idx] + SHELF_H / 2 + DIVIDER_H / 2, -0.02]}>
            <boxGeometry args={[FRIDGE_W - 0.06, DIVIDER_H, FRIDGE_D - 0.1]} />
            <meshStandardMaterial color="#1c1408" roughness={0.95} />
          </mesh>
        ) : null,
      )}

      {sorted.map((shelf, idx) => (
        <Shelf
          key={shelf.row}
          shelf={shelf}
          y={shelfYs[idx]}
          pulled={pulled === shelf.row}
          occupiedSet={occupiedSet}
          highlight={highlight}
          onSlotClick={onSlotClick}
        />
      ))}

      {/* Feet */}
      {[-FRIDGE_W / 2 + 0.2, FRIDGE_W / 2 - 0.2].map((fx, i) => (
        <mesh key={i} position={[fx, -(totalH / 2 + 0.05), 0]}>
          <boxGeometry args={[0.18, 0.06, FRIDGE_D * 0.3]} />
          <meshStandardMaterial color="#0e0e10" />
        </mesh>
      ))}
    </>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export default function FridgeViewer3D({
  shelves,
  occupiedSlots,
  highlight,
  pulledShelf,
  fridgeName,
  wineName,
  vintage,
  height = 380,
  onSlotClick,
  hideChrome,
}: Props) {
  const totalH = shelves.length * (SHELF_H + DIVIDER_H) + 0.22;
  const camZ = totalH * 1.35 + 1.3;
  const pulled = pulledShelf ?? highlight?.row ?? null;

  return (
    <div className="rounded-xl overflow-hidden border border-slate-700 bg-slate-950">
      {!hideChrome && (
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-slate-300 truncate">{fridgeName}</span>
          {wineName ? (
            <span className="text-xs text-amber-400 truncate">
              {vintage ? `${vintage} ` : ''}
              {wineName}
            </span>
          ) : pulled ? (
            <span className="text-xs text-amber-400">Shelf {pulled}</span>
          ) : null}
        </div>
      )}

      <div style={{ height }}>
        <Canvas dpr={[1, 2]} camera={{ position: [1.5, totalH * 0.32, camZ], fov: 40 }}>
          <OrbitControls
            enablePan={false}
            target={[0, 0, 0.15]}
            minPolarAngle={Math.PI / 4}
            maxPolarAngle={(Math.PI * 3) / 4}
            minAzimuthAngle={-Math.PI / 2.6}
            maxAzimuthAngle={Math.PI / 2.6}
            minDistance={camZ * 0.5}
            maxDistance={camZ * 1.7}
          />
          <FridgeScene shelves={shelves} occupiedSlots={occupiedSlots} highlight={highlight} pulledShelf={pulled} onSlotClick={onSlotClick} />
        </Canvas>
      </div>

      {!hideChrome && (
        <div className="px-3 py-2 border-t border-slate-800 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
            Your bottle
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border border-red-900 bg-red-950 shrink-0" />
            Occupied
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border border-slate-700 bg-slate-900 shrink-0" />
            Empty
          </span>
          <span className="ml-auto italic text-slate-600">Drag to rotate · pinch to zoom</span>
        </div>
      )}
    </div>
  );
}
