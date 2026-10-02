import { getCharacterView } from '../core/prototype/character';
import { characterStats, type CharacterState } from '../core/prototype/character-state';
import { equipmentSource } from '../core/prototype/equipment';
import { scaledSource } from '../core/prototype/effects';
import { resolveStats } from '../core/prototype/stats';
import { manualSource } from '../core/prototype/skills';
import { DIVINE_ARTS } from '../core/prototype/divine-arts';
import { publicCharacterSchema } from '../shared/social';

export function publicCharacterInfo(character: CharacterState) {
  const derived = characterStats(character, true);
  const view = getCharacterView(character);
  const publicBonuses = (source: { flat?: object; multiplier?: object }) => ({
    ...(source.flat ? { flat: source.flat } : {}), ...(source.multiplier ? { multiplier: source.multiplier } : {}),
  });
  return publicCharacterSchema.parse({
    realmName: view.realmName, score: view.combatPower.score, stats: resolveStats(derived.base, derived.sources),
    equipment: view.instances.filter(item => item.equipped).map(item => ({
      slot: item.slot, itemId: item.itemId, name: item.name, quality: item.quality,
      bonuses: publicBonuses(scaledSource(equipmentSource(item.instanceId, character.instances[item.instanceId]), derived.sources)),
    })),
    abilities: [
      ...view.manuals.filter(entry => entry.active).map(entry => ({
        kind: 'manual', id: entry.id, name: entry.name, level: entry.level,
        bonuses: publicBonuses(scaledSource(manualSource(entry.id, entry.level), derived.sources)),
      })),
      ...view.divineArts.filter(entry => entry.active).map(entry => ({
        kind: 'divine', id: entry.id, name: entry.name, level: null,
        bonuses: publicBonuses(scaledSource(DIVINE_ARTS[entry.id].source, derived.sources)),
      })),
    ],
  });
}
