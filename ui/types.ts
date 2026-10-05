import type { Item, PlayerState } from '../src/client.ts';
export interface ViewState {
  databaseId: string; revision: number; player: PlayerState;
  worldId: string; exitId?: string; containers: { id: string; items: Item[] }[];
}
export interface Intent { requestId: string; operation: string; payload: Record<string, unknown> }
declare global {
  interface Window {
    extractionHost?: {
      sendIntent(intent: Intent): Promise<void>;
      subscribe(listener: (state: ViewState) => void): () => void;
    };
  }
}
