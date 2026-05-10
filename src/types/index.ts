export interface Bottle {
  id: string;
  cellar: string;
  size: string;
  purchasePrice: number | null;
  marketPrice: number | null;
  currency: string;
  purchaseDate: string;
  location: string;
  section: string;
  row: number | null;
  column: number | null;
  depth: number | null;
  addedOn: string;
  personalNotes: string;
  bottleCode: string;
  barcode: string;
  consumed: boolean;
}

export interface Wine {
  id: string;
  name: string;
  vintage: number;
  wineType: string;
  grapes: string;
  producer: string;
  country: string;
  region: string;
  abv: string;
  drinkWindowStart: number | null;
  drinkWindowEnd: number | null;
  description: string | null;
  collectionNotes: string;
  bottles: Bottle[];
  // summary fields (list endpoint only)
  bottleCount?: number;
  marketValue?: number;
  hasDescription?: boolean;
}
