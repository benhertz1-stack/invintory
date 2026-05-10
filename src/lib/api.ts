import { Wine } from '../types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function getWines(): Promise<Wine[]> {
  return request<Wine[]>('/wines');
}

export function getWine(id: string): Promise<Wine> {
  return request<Wine>(`/wines/${id}`);
}

export async function generateDescription(id: string): Promise<string> {
  const data = await request<{ description: string }>(`/wines/${id}/description`, {
    method: 'POST',
  });
  return data.description;
}

export async function consumeBottle(wineId: string, bottleId: string): Promise<void> {
  await request(`/wines/${wineId}/bottles/${bottleId}/consume`, { method: 'PATCH' });
}

export async function updateBottlePrice(
  wineId: string,
  bottleId: string,
  price: number,
  currency: string
): Promise<void> {
  await request(`/wines/${wineId}/bottles/${bottleId}/price`, {
    method: 'PATCH',
    body: JSON.stringify({ price, currency }),
  });
}

export async function deleteBottle(wineId: string, bottleId: string): Promise<void> {
  await request(`/wines/${wineId}/bottles/${bottleId}`, { method: 'DELETE' });
}

export interface RelocatePayload {
  cellar?: string; location?: string; section?: string;
  row?: number; column?: number; depth?: number;
}

export async function relocateBottle(
  wineId: string,
  bottleId: string,
  payload: RelocatePayload
): Promise<void> {
  await request(`/wines/${wineId}/bottles/${bottleId}/relocate`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export interface RackSlot {
  bottleId: string; wineId: string; wineName: string; vintage: number;
  size: string; barcode: string; bottleCode: string; addedOn: string;
  cellar: string; location: string; section: string;
  row: number | null; column: number | null; depth: number | null;
}

export interface RackData {
  cellar: string; location: string;
  maxRow: number; maxCol: number;
  slots: RackSlot[];
}

export async function getRackData(cellar: string, location?: string): Promise<RackData> {
  const params = new URLSearchParams({ cellar });
  if (location) params.set('location', location);
  return request<RackData>(`/rack?${params}`);
}

export async function askAdvisor(question: string): Promise<string> {
  const data = await request<{ answer: string }>('/advisor', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
  return data.answer;
}
