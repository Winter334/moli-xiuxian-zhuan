import type { OpeningCommand, OpeningView } from '../../shared/opening-contracts';
import type { useGame } from '../use-game';

export type GameSession = ReturnType<typeof useGame>;
export type Page = 'world' | 'map' | 'bag' | 'practice' | 'craft' | 'journal' | 'bestiary' | 'shop' | 'market' | 'rankings' | 'nearby' | 'chat';
export interface ViewProps {
  game: OpeningView;
  blocked: boolean;
  command: (command: OpeningCommand) => Promise<boolean>;
}
export type Stack = OpeningView['inventory'][number];
export type Instance = OpeningView['instances'][number];
export const SLOT_NAMES = {
  weapon: '兵刃', head: '头部', body: '上身', legs: '腿部', feet: '足部',
  accessory: '饰品', artifact: '法宝', special: '特殊',
};
export const KIND_NAMES: Record<string, string> = {
  material: '材料', food: '补给', marrow: '灵髓', insight: '灵露',
  'foundation-pill': '筑基丹', part: '炼材', equipment: '器物',
  'meditation-kit': '静修套件',
};
