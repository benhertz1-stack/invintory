import { Bottle, FridgeConfig, OccupiedSlot, Tasting, UIAction, Wine, WineSummary } from '../types';

const BASE = '/api';

export class UnauthorizedError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'UnauthorizedError';
  }
}

/** Fired when any request comes back 401 so the app can show the login screen. */
export const AUTH_EVENT = 'invintory:unauthorized';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event(AUTH_EVENT));
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface ToolResponse<T = unknown> {
  ok: true;
  message: string;
  data?: T;
  uiAction?: UIAction;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(passphrase: string): Promise<void> {
  await request('/login', { method: 'POST', body: JSON.stringify({ passphrase }) });
}

export async function logout(): Promise<void> {
  await request('/logout', { method: 'POST' });
}

export async function me(): Promise<boolean> {
  const res = await fetch(`${BASE}/me`, { credentials: 'same-origin' });
  return res.ok;
}

// ── Wines ─────────────────────────────────────────────────────────────────────

export function getWines(): Promise<WineSummary[]> {
  return request<WineSummary[]>('/wines');
}

export function getWine(id: string): Promise<Wine> {
  return request<Wine>(`/wines/${encodeURIComponent(id)}`);
}

export async function generateDescription(id: string): Promise<string> {
  const data = await request<{ description: string }>(`/wines/${encodeURIComponent(id)}/description`, { method: 'POST' });
  return data.description;
}

export async function consumeBottle(wineId: string, bottleId: string): Promise<string> {
  const r = await request<ToolResponse>(`/wines/${encodeURIComponent(wineId)}/bottles/${encodeURIComponent(bottleId)}/consume`, { method: 'PATCH' });
  return r.message;
}

export interface RatingPayload {
  rating?: number;
  liked?: boolean;
  notes?: string;
  wouldBuyAgain?: boolean;
}

export async function rateBottle(wineId: string, bottleId: string, payload: RatingPayload): Promise<Tasting> {
  const r = await request<ToolResponse<Tasting>>(`/wines/${encodeURIComponent(wineId)}/bottles/${encodeURIComponent(bottleId)}/rate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return r.data as Tasting;
}

export async function updateBottlePrice(wineId: string, bottleId: string, price: number, currency = 'USD', kind: 'purchase' | 'market' = 'purchase'): Promise<void> {
  await request(`/wines/${encodeURIComponent(wineId)}/bottles/${encodeURIComponent(bottleId)}/price`, {
    method: 'PATCH',
    body: JSON.stringify({ price, currency, kind }),
  });
}

export async function deleteBottle(wineId: string, bottleId: string): Promise<void> {
  await request(`/wines/${encodeURIComponent(wineId)}/bottles/${encodeURIComponent(bottleId)}`, { method: 'DELETE' });
}

export interface RelocatePayload {
  fridge: string;
  shelf: number;
  position: number;
  depth?: number;
}

export async function relocateBottle(wineId: string, bottleId: string, payload: RelocatePayload): Promise<string> {
  const r = await request<ToolResponse>(`/wines/${encodeURIComponent(wineId)}/bottles/${encodeURIComponent(bottleId)}/relocate`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return r.message;
}

// ── Fridges / locations ───────────────────────────────────────────────────────

export function getFridgeConfigs(): Promise<FridgeConfig[]> {
  return request<FridgeConfig[]>('/fridges');
}

export interface RackData {
  fridge: FridgeConfig;
  slots: OccupiedSlot[];
}

export function getRackData(fridge: string): Promise<RackData> {
  return request<RackData>(`/rack?${new URLSearchParams({ fridge })}`);
}

export interface LocateData {
  wine: WineSummary;
  bottle: Bottle;
  locationText: string;
  fridge: FridgeConfig;
  occupied: OccupiedSlot[];
  highlight: { shelf: number; column: number } | null;
}

export function getLocate(wineId: string, bottleId: string): Promise<LocateData> {
  return request<LocateData>(`/locate/${encodeURIComponent(wineId)}/${encodeURIComponent(bottleId)}`);
}

// ── Monthly reports ───────────────────────────────────────────────────────────

export interface ReportListItem {
  id: string;
  month: string;
  createdAt: string;
  subject: string;
  to: string | null;
  sent: boolean;
  error: string | null;
}

export interface ReportRunResult {
  ok: true;
  id: string;
  subject: string;
  sent: boolean;
  error: string | null;
  totals: { wines: number; bottles: number; value: number };
  alerts: { pastPeak: number; lastCall: number; opening: number };
  picks: number;
  warnings: string[];
}

export function getReports(): Promise<ReportListItem[]> {
  return request<ReportListItem[]>('/reports');
}

export function getReport(id: string): Promise<ReportListItem & { html: string }> {
  return request<ReportListItem & { html: string }>(`/reports/${encodeURIComponent(id)}`);
}

export function runReport(opts: { send: boolean; refreshPrices: boolean }): Promise<ReportRunResult> {
  return request<ReportRunResult>('/reports/run', { method: 'POST', body: JSON.stringify(opts) });
}

// ── Agent chat ────────────────────────────────────────────────────────────────

export interface AgentResponse {
  message: string;
  messages: unknown[];
  uiAction?: UIAction;
}

export function sendAgentMessage(messages: unknown[]): Promise<AgentResponse> {
  return request<AgentResponse>('/agent', { method: 'POST', body: JSON.stringify({ messages }) });
}
