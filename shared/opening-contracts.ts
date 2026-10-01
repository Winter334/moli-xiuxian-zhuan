import type { CharacterCommand, getCharacterView } from '../core/prototype';

export type OpeningCommand = CharacterCommand;
export type OpeningView = ReturnType<typeof getCharacterView>;

export interface OpeningResponse {
  characterId: string;
  game: OpeningView;
  revision: string;
  serverTime: number;
  mode: 'local-opening';
}
