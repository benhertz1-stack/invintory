import { useQuery } from '@tanstack/react-query';
import { getWines, getWine, getFridgeConfigs } from '../lib/api';
import { DrinkStatus } from '../types';

export function useWines() {
  return useQuery({ queryKey: ['wines'], queryFn: getWines });
}

export function useWine(id: string) {
  return useQuery({ queryKey: ['wine', id], queryFn: () => getWine(id), enabled: !!id });
}

export function useFridges() {
  return useQuery({ queryKey: ['fridges'], queryFn: getFridgeConfigs, staleTime: 5 * 60 * 1000 });
}

export function drinkWindowStatus(w: { drinkWindowStart: number | null; drinkWindowEnd: number | null }): DrinkStatus {
  const year = new Date().getFullYear();
  if (!w.drinkWindowStart || !w.drinkWindowEnd) return 'unknown';
  if (year < w.drinkWindowStart) return 'hold';
  if (year > w.drinkWindowEnd) return 'past';
  return 'drink';
}

/** "Large Fridge › shelf 8 › pos 3" style label for a bottle. */
export function bottleLocation(b: { cellar: string; shelf: number | null; column: number | null; depth: number | null; section?: string }): string {
  const parts: string[] = [];
  if (b.cellar) parts.push(b.cellar);
  const shelf = b.shelf ?? (b.section ? parseInt(/(\d+)/.exec(b.section)?.[1] ?? '', 10) || null : null);
  if (shelf) parts.push(`shelf ${shelf}`);
  if (b.column) parts.push(`pos ${b.column}`);
  if (b.depth && b.depth > 1) parts.push('back');
  return parts.join(' › ') || 'No location';
}
