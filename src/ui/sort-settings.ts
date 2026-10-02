import { useEffect, useState } from 'react';

export const BAG_SORT_MODES = [
  { id: 'category', label: '按类别' }, { id: 'name', label: '按名称' },
  { id: 'quality', label: '品质优先' }, { id: 'value', label: '价值优先' },
] as const;
export const CRAFT_SORT_MODES = [
  { id: 'ready', label: '齐料优先' }, { id: 'name', label: '按名称' },
  { id: 'chance', label: '成功率' }, { id: 'value', label: '参考价值' },
] as const;
export type BagSort = (typeof BAG_SORT_MODES)[number]['id'];
export type CraftSort = (typeof CRAFT_SORT_MODES)[number]['id'];
interface SortSettings { bag: BagSort; craft: CraftSort }
const KEY = 'moli.ui.sort-settings.v1';

function readSortSettings(preview: boolean): SortSettings {
  if (!preview) try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SortSettings> | null;
    return {
      bag: BAG_SORT_MODES.find(mode => mode.id === saved?.bag)?.id ?? 'category',
      craft: CRAFT_SORT_MODES.find(mode => mode.id === saved?.craft)?.id ?? 'ready',
    };
  } catch { /* Optional display preferences do not affect character saves. */ }
  return { bag: 'category', craft: 'ready' };
}

export function useSortSettings(preview: boolean) {
  const [settings, setSettings] = useState(() => readSortSettings(preview));
  useEffect(() => {
    if (!preview) try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Optional preference. */ }
  }, [settings, preview]);
  return [settings, setSettings] as const;
}
