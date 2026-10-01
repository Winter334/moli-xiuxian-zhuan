import { loadContent } from './content';
import { combatCandidate } from './combat-candidate';
import patch from './content/stage-1-technique-candidate.json';

export const techniqueCandidate = loadContent({
  ...combatCandidate, version: patch.version, rulesVersion: patch.rulesVersion,
  actions: combatCandidate.actions.map((action) => ({
    ...action, ...patch.actionChanges.find((entry) => entry.id === action.id),
  })),
  techniques: combatCandidate.techniques.map((technique) => ({
    ...technique, ...patch.techniqueChanges.find((entry) => entry.id === technique.id),
  })),
});

export function techniqueProfile() {
  const c = structuredClone(techniqueCandidate);
  c.version = 'stage-1-dual-common.1-slots.1';
  c.equipmentQualities!.forEach((quality, index) => { quality.weight = index === 0 ? 1 : 0; });
  return loadContent(c);
}
