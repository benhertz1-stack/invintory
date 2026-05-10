import { useQuery } from '@tanstack/react-query';
import { getWines, getWine } from '../lib/api';
import { Wine } from '../types';

export function useWines() {
  return useQuery({
    queryKey: ['wines'],
    queryFn: getWines,
    staleTime: 5 * 60 * 1000,
  });
}

export function useWine(id: string) {
  return useQuery({
    queryKey: ['wine', id],
    queryFn: () => getWine(id),
    staleTime: 5 * 60 * 1000,
    enabled: !!id,
  });
}

export function drinkWindowStatus(
  wine: Pick<Wine, 'drinkWindowStart' | 'drinkWindowEnd'>
): 'hold' | 'drink' | 'past' | 'unknown' {
  const year = new Date().getFullYear();
  if (!wine.drinkWindowStart || !wine.drinkWindowEnd) return 'unknown';
  if (year < wine.drinkWindowStart) return 'hold';
  if (year > wine.drinkWindowEnd) return 'past';
  return 'drink';
}

export function collectionTotalValue(wines: Wine[]): number {
  return wines.reduce((total, w) => {
    const bottles = w.bottles ?? [];
    const active = bottles.filter((b) => !b.consumed);
    return total + active.reduce((s, b) => s + (b.marketPrice ?? 0), 0);
  }, 0);
}
