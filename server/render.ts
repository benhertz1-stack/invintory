import sharp from 'sharp';
import type { FridgeShelfDoc } from './db';

/**
 * Server-side rendering of a wine fridge as an SVG/PNG.
 * Used by the MCP `locate_bottle` / `show_fridge` tools so the picture shows up
 * inline in the Claude app (which can't run WebGL from a tool result).
 *
 * The highlighted shelf is drawn "pulled out" as a tray in front of the cabinet,
 * with the target bottle lit in amber.
 */

export interface RenderOpts {
  fridgeName: string;
  shelves: FridgeShelfDoc[];
  occupied: { shelf: number; column: number }[];
  highlight: { shelf: number; column: number } | null;
  title?: string;
  subtitle?: string;
}

const W = 760;
const PAD_L = 64;
const PAD_R = 44;
const CAB_X = PAD_L;
const CAB_W = W - PAD_L - PAD_R;
const INNER_PAD = 18;
const HEADER_H = 92;
const SHELF_H = 40;
const PULL_EXTRA = 36;
const DIV_H = 6;
const FOOTER_H = 58;

const FONT = 'DejaVu Sans, Arial, Helvetica, sans-serif';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function renderFridgeSvg(o: RenderOpts): string {
  const shelves = [...o.shelves].sort((a, b) => a.row - b.row);
  const pulled = o.highlight?.shelf ?? null;
  const occ = new Set(o.occupied.map((s) => `${s.shelf}-${s.column}`));

  // Vertical layout
  let y = HEADER_H + INNER_PAD;
  const rows = shelves.map((s) => {
    const h = s.row === pulled ? SHELF_H + PULL_EXTRA : SHELF_H;
    const r = { shelf: s, y, h };
    y += h + DIV_H;
    return r;
  });
  const cabTop = HEADER_H;
  const cabBottom = y - DIV_H + INNER_PAD;
  const cabH = cabBottom - cabTop;
  const H = cabBottom + FOOTER_H;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs>`,
    `<radialGradient id="glow" cx="50%" cy="50%" r="50%">`,
    `<stop offset="0%" stop-color="#fbbf24" stop-opacity="0.95"/>`,
    `<stop offset="55%" stop-color="#f59e0b" stop-opacity="0.35"/>`,
    `<stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<linearGradient id="tray" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="#6b4a1e"/>`,
    `<stop offset="100%" stop-color="#3b2a12"/>`,
    `</linearGradient>`,
    `<linearGradient id="steel" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0%" stop-color="#1c1c24"/>`,
    `<stop offset="50%" stop-color="#2a2a34"/>`,
    `<stop offset="100%" stop-color="#1a1a22"/>`,
    `</linearGradient>`,
    `</defs>`,
    // Background
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#0b0b12"/>`,
  );

  // Header
  out.push(
    `<text x="${CAB_X}" y="30" font-family="${FONT}" font-size="12" fill="#8b8b9a" letter-spacing="1.5">${esc(o.fridgeName.toUpperCase())}</text>`,
  );
  if (o.title) {
    out.push(
      `<text x="${CAB_X}" y="56" font-family="${FONT}" font-size="21" font-weight="bold" fill="#ffffff">${esc(o.title)}</text>`,
    );
  }
  if (o.subtitle) {
    out.push(
      `<text x="${CAB_X}" y="78" font-family="${FONT}" font-size="14" fill="#fbbf24">${esc(o.subtitle)}</text>`,
    );
  }

  // Cabinet shell + cavity
  out.push(
    `<rect x="${CAB_X - 10}" y="${cabTop - 10}" width="${CAB_W + 20}" height="${cabH + 20}" rx="14" fill="url(#steel)" stroke="#3a3a48" stroke-width="2"/>`,
    `<rect x="${CAB_X}" y="${cabTop}" width="${CAB_W}" height="${cabH}" rx="6" fill="#06060e"/>`,
    // LED strip
    `<rect x="${CAB_X + 10}" y="${cabTop + 4}" width="${CAB_W - 20}" height="3" rx="1.5" fill="#5ba3d9" opacity="0.9"/>`,
    // Door handle
    `<rect x="${CAB_X + CAB_W + 16}" y="${cabTop + cabH * 0.25}" width="7" height="${cabH * 0.5}" rx="3" fill="#3a3a44" stroke="#55555f" stroke-width="1"/>`,
  );

  const center = CAB_X + CAB_W / 2;
  const innerW = CAB_W - INNER_PAD * 2;

  rows.forEach((row, idx) => {
    const s = row.shelf;
    const isPulled = s.row === pulled;
    const cols = Math.max(1, s.cols);
    const slotW = innerW / cols;
    const r = Math.min(15, slotW * 0.36);

    // Shelf number label (left gutter)
    out.push(
      `<text x="${PAD_L - 16}" y="${row.y + SHELF_H / 2 + 4}" text-anchor="end" font-family="${FONT}" font-size="${isPulled ? 13 : 11}" font-weight="${isPulled ? 'bold' : 'normal'}" fill="${isPulled ? '#fbbf24' : '#5c5c6e'}">${s.row}</text>`,
    );

    // Divider below the shelf
    if (idx < rows.length - 1) {
      out.push(
        `<rect x="${CAB_X + 6}" y="${row.y + row.h + 1}" width="${CAB_W - 12}" height="4" rx="1" fill="#3b2a12"/>`,
      );
    }

    let cy = row.y + SHELF_H / 2;
    let scale = 1;
    let spread = 1;

    if (isPulled) {
      // Empty rail left behind
      out.push(
        `<rect x="${CAB_X + INNER_PAD - 4}" y="${row.y + 6}" width="${innerW + 8}" height="${SHELF_H - 12}" rx="4" fill="#0e0e1c" stroke="#1f1f33" stroke-width="1"/>`,
      );
      const yBack = row.y + 12;
      const yFront = row.y + row.h - 6;
      const xl = CAB_X + INNER_PAD - 6;
      const xr = CAB_X + CAB_W - INNER_PAD + 6;
      const flare = 20;
      // Cast shadow, then tray (trapezoid = perspective of a pulled-out shelf)
      out.push(
        `<polygon points="${xl - flare + 6},${yFront + 8} ${xr + flare + 6},${yFront + 8} ${xr + 6},${yBack + 8} ${xl + 6},${yBack + 8}" fill="#000000" opacity="0.5"/>`,
        `<polygon points="${xl},${yBack} ${xr},${yBack} ${xr + flare},${yFront} ${xl - flare},${yFront}" fill="url(#tray)" stroke="#8a6230" stroke-width="1.5"/>`,
        `<rect x="${xl - flare}" y="${yFront - 2}" width="${xr - xl + flare * 2}" height="5" rx="1.5" fill="#8a6230"/>`,
        `<text x="${xr + 4}" y="${row.y + 9}" text-anchor="end" font-family="${FONT}" font-size="10" fill="#fbbf24">shelf ${s.row} — pulled out</text>`,
      );
      cy = yBack + (yFront - yBack) * 0.55;
      scale = 1.25;
      spread = 1.05;
    }

    for (let c = 1; c <= cols; c++) {
      const cx0 = CAB_X + INNER_PAD + (c - 1) * slotW + slotW / 2;
      const cx = center + (cx0 - center) * spread;
      const rr = r * scale;
      const key = `${s.row}-${c}`;
      const isHi = !!o.highlight && o.highlight.shelf === s.row && o.highlight.column === c;
      const isOcc = occ.has(key);

      if (isHi) {
        out.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(rr * 2.4)}" fill="url(#glow)"/>`);
      }
      // Bottle end / empty slot
      const fill = isHi ? '#3a2600' : isOcc ? '#3a0a0a' : '#0f0f22';
      const stroke = isHi ? '#fbbf24' : isOcc ? '#8b1a1a' : '#2a2a48';
      out.push(
        `<circle cx="${fmt(cx + 1)}" cy="${fmt(cy + 1.5)}" r="${fmt(rr)}" fill="#000" opacity="0.5"/>`,
        `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(rr)}" fill="${fill}" stroke="${stroke}" stroke-width="${isHi ? 3 : 1.4}"/>`,
      );
      if (isHi) {
        out.push(
          `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(rr * 0.62)}" fill="none" stroke="#fbbf24" stroke-width="1.5" opacity="0.9"/>`,
          `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(rr * 0.32)}" fill="#fbbf24"/>`,
        );
      } else if (isOcc) {
        out.push(
          `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(rr * 0.62)}" fill="none" stroke="#991b1b" stroke-width="1" opacity="0.7"/>`,
          `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(rr * 0.28)}" fill="#7f1d1d"/>`,
        );
      }
    }
  });

  // Legend
  const ly = cabBottom + 34;
  const legend: Array<[string, string, string]> = [
    ['#fbbf24', '#fbbf24', 'your bottle'],
    ['#3a0a0a', '#8b1a1a', 'occupied'],
    ['#0f0f22', '#2a2a48', 'empty'],
  ];
  let lx = CAB_X;
  for (const [fill, stroke, label] of legend) {
    out.push(
      `<circle cx="${lx + 7}" cy="${ly - 4}" r="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
      `<text x="${lx + 20}" y="${ly}" font-family="${FONT}" font-size="12" fill="#8b8b9a">${label}</text>`,
    );
    lx += 22 + label.length * 7.5 + 22;
  }
  out.push(
    `<text x="${CAB_X + CAB_W + 30}" y="${ly}" text-anchor="end" font-family="${FONT}" font-size="11" fill="#4c4c5c">shelves numbered from the top · positions from the left</text>`,
  );

  out.push(`</svg>`);
  return out.join('\n');
}

export async function renderFridgePng(o: RenderOpts): Promise<Buffer> {
  const svg = renderFridgeSvg(o);
  return sharp(Buffer.from(svg), { density: 120 }).png({ compressionLevel: 8 }).toBuffer();
}
