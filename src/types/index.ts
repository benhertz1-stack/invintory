export interface AuthState {
  accessToken: string;
  userId: string;
}

export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  collectionId?: string;
  collection?: { id: string; name?: string };
}

export interface Collection {
  id: string;
  name: string;
  cellars: Cellar[];
  labels: Label[];
}

export interface Cellar {
  id: string;
  collectionId: string;
  name: string;
}

export interface Wine {
  name: string;
  wineType: string;
  region: string;
  winery: string;
  countryCode: string;
  sweetness?: string;
  maturation?: string;
}

export interface Label {
  id: string;
  year: number;
  wsScore?: number;
  wine: Wine;
  bottles: Bottle[];
}

export interface Bottle {
  id: string;
  price?: number;
  currency?: string;
  cellarId: string;
  consumed: boolean;
  barcode?: string;
}
