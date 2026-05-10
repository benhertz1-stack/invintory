import axios from 'axios';
import { AuthState, Profile, Collection } from '../types';

const client = axios.create({ baseURL: '/api' });

function getStoredAuth(): AuthState | null {
  const raw = localStorage.getItem('auth');
  return raw ? (JSON.parse(raw) as AuthState) : null;
}

client.interceptors.request.use((config) => {
  const auth = getStoredAuth();
  if (auth) {
    config.headers.Authorization = `Bearer ${auth.accessToken}`;
  }
  return config;
});

export async function authenticate(refreshToken: string, googleApiKey: string): Promise<AuthState> {
  const { data } = await client.post<AuthState>('/auth', { refreshToken, googleApiKey });
  localStorage.setItem('auth', JSON.stringify(data));
  return data;
}

export async function getProfile(userId: string): Promise<Profile> {
  const { data } = await client.get<Profile>(`/invintory/profiles/${userId}`);
  return data;
}

export async function getCollection(collectionId: string): Promise<Collection> {
  const { data } = await client.get<Collection>(`/invintory/collections/${collectionId}`);
  return data;
}

export async function updateBottlePrices(
  collectionId: string,
  updates: { id: string; price: number; currency: string }[]
): Promise<void> {
  await client.patch(`/invintory/collections/${collectionId}/bottles`, updates);
}

export async function askAdvisor(question: string, collectionSummary: string): Promise<string> {
  const { data } = await client.post<{ answer: string }>('/advisor', {
    question,
    collectionSummary,
  });
  return data.answer;
}

export { axios };
