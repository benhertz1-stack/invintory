import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
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

// ── Dimensions (scene units ≈ metres × ~2) ───────────────────────────────────

const FRIDGE_W = 2.2;
const FRIDGE_D = 1.0;
const WALL = 0.06;
const SHELF_PITCH = 0.3;
const SLAB_T = 0.05;
const PULL_OUT = FRIDGE_D * 1.02;

const CREAM = '#efe2bf';
const CREAM_LIT = '#f7ebcd';
const GLASS_GREEN = '#13231b';
const CABINET = '#75757c';

// ── Bottle geometry: lathe profile, axis along +z with the neck toward +z ────

function makeBottleGeometry(r: number, length: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const bodyEnd = length * 0.6;
  const shoulderEnd = length * 0.74;
  const neckR = r * 0.32;
  pts.push(new THREE.Vector2(0, 0));
  pts.push(new THREE.Vector2(r * 0.82, 0));
  pts.push(new THREE.Vector2(r, r * 0.18));
  pts.push(new THREE.Vector2(r, bodyEnd));
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector2(neckR + (r - neckR) * Math.cos((t * Math.PI) / 2), bodyEnd + (shoulderEnd - bodyEnd) * t));
  }
  pts.push(new THREE.Vector2(neckR, length - r * 0.08));
  pts.push(new THREE.Vector2(neckR * 1.12, length - r * 0.08));
  pts.push(new THREE.Vector2(neckR * 1.12, length));
  pts.push(new THREE.Vector2(0, length));
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateX(Math.PI / 2); // lathe axis (y) → +z
  g.translate(0, 0, -length / 2);
  return g;
}

function useGlowTexture(): THREE.Texture {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,244,214,1)');
    g.addColorStop(0.2, 'rgba(255,208,110,0.8)');
    g.addColorStop(0.55, 'rgba(255,176,50,0.22)');
    g.addColorStop(1, 'rgba(255,160,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

// ── One bottle ────────────────────────────────────────────────────────────────

function Bottle({
  x,
  y,
  geometry,
  r,
  length,
  highlighted,
  glow,
  onClick,
}: {
  x: number;
  y: number;
  geometry: THREE.LatheGeometry;
  r: number;
  length: number;
  highlighted: boolean;
  glow: THREE.Texture;
  onClick?: () => void;
}) {
  const mat = useRef<THREE.MeshPhysicalMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (!highlighted) return;
    const p = 0.85 + 0.35 * Math.sin(clock.elapsedTime * 3.2);
    if (mat.current) mat.current.emissiveIntensity = p;
    if (light.current) light.current.intensity = 3 + p * 2.5;
  });

  const handlers = onClick
    ? {
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onClick();
        },
        onPointerOver: () => (document.body.style.cursor = 'pointer'),
        onPointerOut: () => (document.body.style.cursor = 'auto'),
      }
    : {};

  return (
    <group position={[x, y, 0]}>
      <mesh geometry={geometry} castShadow receiveShadow {...handlers}>
        <meshPhysicalMaterial
          ref={mat}
          color={highlighted ? '#a8781a' : GLASS_GREEN}
          emissive={highlighted ? '#ffb43a' : '#000000'}
          emissiveIntensity={highlighted ? 0.9 : 0}
          roughness={0.22}
          metalness={0.05}
          clearcoat={0.85}
          clearcoatRoughness={0.18}
        />
      </mesh>
      {/* Foil capsule */}
      <mesh position={[0, 0, length * 0.44]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r * 0.37, r * 0.37, length * 0.1, 20]} />
        <meshStandardMaterial color={highlighted ? '#ffd98a' : '#6e1224'} roughness={0.35} metalness={0.55} />
      </mesh>
      {highlighted && (
        <>
          <pointLight ref={light} position={[0, r * 2.4, 0]} intensity={4} color="#ffc65e" distance={2.4} decay={2} />
          <sprite scale={[r * 10, r * 10, 1]} position={[0, r * 0.8, 0]}>
            <spriteMaterial map={glow} color="#ffd57a" transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.95} />
          </sprite>
        </>
      )}
    </group>
  );
}

// ── One shelf (slab + bottles); slides fully out when pulled ─────────────────

function Shelf({
  shelf,
  y,
  pulled,
  occupiedSet,
  highlight,
  glow,
  onSlotClick,
}: {
  shelf: FridgeShelf;
  y: number;
  pulled: boolean;
  occupiedSet: Set<string>;
  highlight: Props['highlight'];
  glow: THREE.Texture;
  onSlotClick?: Props['onSlotClick'];
}) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.position.z = THREE.MathUtils.damp(group.current.position.z, pulled ? PULL_OUT : 0, 3.5, dt);
  });

  const cols = Math.max(1, shelf.cols);
  const innerW = FRIDGE_W - WALL * 2 - 0.08;
  const slotW = innerW / cols;
  const r = Math.min(slotW * 0.4, 0.095);
  const length = Math.min(FRIDGE_D - 0.14, r * 8.4);
  const geometry = useMemo(() => makeBottleGeometry(r, length), [r, length]);
  const slabW = FRIDGE_W - WALL * 2 - 0.02;
  const slabD = FRIDGE_D - 0.08;
  const bottleY = SLAB_T / 2 + r;

  return (
    <group ref={group} position={[0, y, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[slabW, SLAB_T, slabD]} />
        <meshStandardMaterial color={pulled ? CREAM_LIT : CREAM} roughness={0.85} metalness={0} />
      </mesh>

      {Array.from({ length: cols }, (_, i) => {
        const col = i + 1;
        const x = -innerW / 2 + i * slotW + slotW / 2;
        const key = `${shelf.row}-${col}`;
        const occupied = occupiedSet.has(key);
        const isHi = !!highlight && highlight.row === shelf.row && highlight.col === col;
        const click = onSlotClick ? () => onSlotClick(shelf.row, col) : undefined;
        if (occupied || isHi) {
          return <Bottle key={key} x={x} y={bottleY} geometry={geometry} r={r} length={length} highlighted={isHi} glow={glow} onClick={click} />;
        }
        if (!click) return null;
        // Invisible hit target so empty slots are clickable in the fridge browser
        return (
          <mesh
            key={key}
            position={[x, bottleY, 0]}
            onClick={(e) => {
              e.stopPropagation();
              click();
            }}
            onPointerOver={() => (document.body.style.cursor = 'pointer')}
            onPointerOut={() => (document.body.style.cursor = 'auto')}
          >
            <boxGeometry args={[slotW * 0.9, r * 2, slabD * 0.9]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}

      {pulled && (
        <Html position={[slabW / 2 + 0.08, 0.05, slabD / 2 - 0.1]} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
          <div className="px-2 py-0.5 rounded bg-amber-400 text-black text-xs font-semibold whitespace-nowrap shadow">Shelf {shelf.row}</div>
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
  const glow = useGlowTexture();
  const occupiedSet = useMemo(() => new Set(occupiedSlots.map((s) => `${s.row}-${s.col}`)), [occupiedSlots]);
  const sorted = useMemo(() => [...shelves].sort((a, b) => a.row - b.row), [shelves]);
  const n = sorted.length;
  const totalH = n * SHELF_PITCH + 0.34;
  const shelfYs = useMemo(() => sorted.map((_, i) => totalH / 2 - 0.22 - i * SHELF_PITCH - SHELF_PITCH * 0.55), [sorted, totalH]);
  const pulled = pulledShelf ?? highlight?.row ?? null;

  const innerW = FRIDGE_W - WALL * 2;
  const innerH = totalH - WALL * 2;

  return (
    <>
      <ambientLight intensity={0.35} color="#ffe9d0" />
      <directionalLight
        position={[3.2, totalH * 0.9 + 2, 5]}
        intensity={2.2}
        color="#fff0d8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={totalH}
        shadow-camera-bottom={-totalH}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-3, 1, 3]} intensity={0.5} color="#dfe6ff" />
      {/* Interior lighting strips */}
      {[0.8, 0.3, -0.2, -0.7].map((f, i) => (
        <pointLight key={i} position={[0, totalH * f * 0.5, FRIDGE_D * 0.3]} intensity={0.9} color="#ffe2b8" distance={2.6} decay={2} />
      ))}

      {/* Cavity (dark interior seen through the open front) */}
      <mesh position={[0, 0, -WALL / 2]}>
        <boxGeometry args={[innerW, innerH, FRIDGE_D - WALL]} />
        <meshStandardMaterial color="#08080c" roughness={1} side={THREE.BackSide} />
      </mesh>

      {/* Cabinet walls */}
      {[
        { pos: [0, totalH / 2 - WALL / 2, 0], size: [FRIDGE_W, WALL, FRIDGE_D] },
        { pos: [0, -totalH / 2 + WALL / 2, 0], size: [FRIDGE_W, WALL, FRIDGE_D] },
        { pos: [-FRIDGE_W / 2 + WALL / 2, 0, 0], size: [WALL, totalH, FRIDGE_D] },
        { pos: [FRIDGE_W / 2 - WALL / 2, 0, 0], size: [WALL, totalH, FRIDGE_D] },
        { pos: [0, 0, -FRIDGE_D / 2 + WALL / 2], size: [FRIDGE_W, totalH, WALL] },
      ].map((w, i) => (
        <mesh key={i} position={w.pos as [number, number, number]} receiveShadow>
          <boxGeometry args={w.size as [number, number, number]} />
          <meshStandardMaterial color={CABINET} roughness={0.55} metalness={0.25} />
        </mesh>
      ))}

      {/* Glass door */}
      <mesh position={[0, 0, FRIDGE_D / 2 + 0.006]}>
        <boxGeometry args={[FRIDGE_W - 0.02, totalH - 0.02, 0.012]} />
        <meshPhysicalMaterial color="#cfd9e6" transparent opacity={0.14} roughness={0.08} metalness={0.1} clearcoat={1} depthWrite={false} />
      </mesh>
      {/* Door frame */}
      {[
        { pos: [0, totalH / 2 - 0.03, FRIDGE_D / 2 + 0.01], size: [FRIDGE_W, 0.06, 0.03] },
        { pos: [0, -totalH / 2 + 0.03, FRIDGE_D / 2 + 0.01], size: [FRIDGE_W, 0.06, 0.03] },
        { pos: [-FRIDGE_W / 2 + 0.03, 0, FRIDGE_D / 2 + 0.01], size: [0.06, totalH, 0.03] },
        { pos: [FRIDGE_W / 2 - 0.03, 0, FRIDGE_D / 2 + 0.01], size: [0.06, totalH, 0.03] },
      ].map((w, i) => (
        <mesh key={i} position={w.pos as [number, number, number]}>
          <boxGeometry args={w.size as [number, number, number]} />
          <meshStandardMaterial color="#26262c" roughness={0.8} metalness={0.1} />
        </mesh>
      ))}

      {sorted.map((shelf, i) => (
        <Shelf key={shelf.row} shelf={shelf} y={shelfYs[i]} pulled={pulled === shelf.row} occupiedSet={occupiedSet} highlight={highlight} glow={glow} onSlotClick={onSlotClick} />
      ))}

      {/* Floor shadow catcher */}
      <mesh position={[0, -totalH / 2 - 0.001, 0.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <shadowMaterial opacity={0.35} />
      </mesh>
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
  const totalH = shelves.length * SHELF_PITCH + 0.34;
  const dist = totalH * 1.32 + 1.8;
  const pulled = pulledShelf ?? highlight?.row ?? null;

  return (
    <div className="rounded-xl overflow-hidden border border-slate-700 bg-black">
      {!hideChrome && (
        <div className="px-3 py-2 border-b border-slate-800 bg-slate-950 flex items-center justify-between gap-3">
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
        <Canvas shadows dpr={[1, 2]} camera={{ position: [dist * 0.5, totalH * 0.5, dist * 0.92], fov: 34 }} gl={{ antialias: true }}>
          <color attach="background" args={['#000000']} />
          <OrbitControls
            enablePan={false}
            target={[0, -0.05, 0.3]}
            minPolarAngle={Math.PI / 5}
            maxPolarAngle={Math.PI / 1.9}
            minAzimuthAngle={-Math.PI / 2.4}
            maxAzimuthAngle={Math.PI / 2.4}
            minDistance={dist * 0.45}
            maxDistance={dist * 1.6}
          />
          <FridgeScene shelves={shelves} occupiedSlots={occupiedSlots} highlight={highlight} pulledShelf={pulled} onSlotClick={onSlotClick} />
        </Canvas>
      </div>

      {!hideChrome && (
        <div className="px-3 py-2 border-t border-slate-800 bg-slate-950 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
            Your bottle
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-950 border border-emerald-800 shrink-0" />
            Other bottles
          </span>
          <span className="ml-auto italic text-slate-600">Drag to rotate · pinch to zoom</span>
        </div>
      )}
    </div>
  );
}
