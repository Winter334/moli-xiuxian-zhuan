import { createRules } from './game';

export { createRules } from './game';
export { RuleError } from './errors';
export { content, loadContent, describeEffect, describeModifier } from './content';
export type { Content, Effect, Modifier } from './content';
export type { GameState, EquipmentInstance, GameCommand, GameView, Combatant, Stats } from './types';
export const { createGame, advanceGame, applyCommand, getGameView, getPlayerStats } = createRules();
