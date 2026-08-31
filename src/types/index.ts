export interface FridgeShelf {
  /** Shelf number from the top (1 = top). */
  row: number;
  cols: number;
  isDisplay?: boolean;
  depth?: number;
}

export interface FridgeConfig {
  id: string;
  name: string;
  model: string;
  shelves: FridgeShelf[];
  notes?: string;
  occupied?: number;
}

export type DrinkStatus = 'drink' | 'hold' | 'past' | 'unknown';

export interface WineSummary {
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
  drinkStatus: DrinkStatus;
  bottleCount: number;
  marketValue: number;
  hasDescription: boolean;
  collectionNotes: string;
  locations: string[];
}

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
  shelf: number | null;
  row: number | null;
  column: number | null;
  depth: number | null;
  addedOn: string;
  personalNotes: string;
  bottleCode: string;
  barcode: string;
  consumed: boolean;
  consumedAt?: string | null;
}

export interface Tasting {
  id: string;
  wineId: string;
  bottleId: string | null;
  wineName: string;
  vintage: number;
  producer: string;
  rating: number | null;
  liked: boolean | null;
  notes: string;
  wouldBuyAgain: boolean | null;
  tastedAt: string;
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
  tastings?: Tasting[];
}

export interface OccupiedSlot {
  shelf: number;
  column: number;
  depth: number;
  wineId: string;
  wineName: string;
  vintage: number;
  bottleId: string;
}

export interface FridgeViewAction {
  type: 'fridge_view';
  fridgeName: string;
  shelves: FridgeShelf[];
  occupiedSlots: { row: number; col: number }[];
  highlight: { row: number; col: number } | null;
  pulledShelf?: number | null;
  wineName: string;
  vintage: number;
  url?: string;
}

export interface WineListAction {
  type: 'wine_list';
  wines: WineSummary[];
}

export type UIAction = FridgeViewAction | WineListAction;

export interface AdvisorMessage {
  role: 'user' | 'assistant';
  text: string;
  images?: { data: string; mediaType: string; preview: string }[];
  uiAction?: UIAction;
}
