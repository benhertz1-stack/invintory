import { useQuery } from '@tanstack/react-query';
import { getCollection } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Label } from '../types';

export function useCollection() {
  const { collectionId } = useAuth();

  return useQuery({
    queryKey: ['collection', collectionId],
    queryFn: () => getCollection(collectionId!),
    enabled: !!collectionId,
    staleTime: 5 * 60 * 1000,
  });
}

export function buildCollectionSummary(labels: Label[], collectionName: string): string {
  const lines: string[] = [`Collection: ${collectionName}`, ''];
  for (const label of labels) {
    const active = label.bottles.filter((b) => !b.consumed);
    if (active.length === 0) continue;
    const score = label.wsScore ? ` (WS ${label.wsScore})` : '';
    lines.push(
      `- ${label.wine.winery} "${label.wine.name}" ${label.year}${score} — ${label.wine.wineType}, ${label.wine.region || label.wine.countryCode} — ${active.length} bottle(s)`
    );
  }
  return lines.join('\n');
}
