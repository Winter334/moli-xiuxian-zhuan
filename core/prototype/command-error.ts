export class CharacterCommandError extends Error {}

export function commandEntry<T>(table: Record<string, T>, id: string, message: string): T {
  if (!Object.hasOwn(table, id)) throw new CharacterCommandError(message);
  return table[id];
}
