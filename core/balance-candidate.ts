import legacy from './content/stage-1.json';
import candidate from './content/stage-1-candidate.json';
import { loadContent } from './content';

// Historical economy composition, now using the shared current combat schema.
// This profile is never imported by the server or used to convert existing saves.
export const balanceCandidate = loadContent({
  ...legacy,
  ...candidate,
  settings: { ...legacy.settings, ...candidate.settings },
  recipes: [...candidate.recipes, ...legacy.recipes.filter((recipe) => 'alchemyLevel' in recipe)],
});
