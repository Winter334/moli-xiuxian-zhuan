import { useEffect, useState } from 'react';
import { RECENT_LOG_LIMIT } from '../../core/prototype/log';
import type { ViewProps } from './types';

export const LOG_GROUPS = [
  { id: 'combat', label: '战斗', title: '战斗与探索' },
  { id: 'growth', label: '成长', title: '修行成长' },
  { id: 'production', label: '生产', title: '炼制与采集' },
  { id: 'trade', label: '交易', title: '交易' },
  { id: 'items', label: '物品', title: '物品使用与取得' },
  { id: 'other', label: '其它', title: '其它记录' },
] as const;
export type LogGroup = (typeof LOG_GROUPS)[number]['id'];
export const LOG_DISPLAY_LIMITS = [50, 100, RECENT_LOG_LIMIT] as const;
export interface LogSettings { limit: number; groups: LogGroup[] }
const KEY = 'moli.ui.log-settings.v1';
export function defaultLogSettings(): LogSettings {
  return { limit: RECENT_LOG_LIMIT, groups: LOG_GROUPS.map(group => group.id) };
}
function readLogSettings(preview: boolean): LogSettings {
  if (!preview) try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<LogSettings> | null;
    if (saved && LOG_DISPLAY_LIMITS.includes(saved.limit as typeof LOG_DISPLAY_LIMITS[number]) &&
      Array.isArray(saved.groups) && saved.groups.every(id => LOG_GROUPS.some(group => group.id === id)) &&
      new Set(saved.groups).size === saved.groups.length) return { limit: saved.limit!, groups: saved.groups };
  } catch { /* Optional display preferences do not affect character saves. */ }
  return defaultLogSettings();
}
export function useLogSettings(preview: boolean) {
  const [settings, setSettings] = useState(() => readLogSettings(preview));
  useEffect(() => {
    if (!preview) try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Optional preference. */ }
  }, [settings, preview]);
  return [settings, setSettings] as const;
}

// Classification stays in the display layer; unknown records remain in "other".
export function logGroupOf(message: string): LogGroup {
  if (message.startsWith('[测试]')) return 'other';
  if (/^击败|清理完成(?:，|$)|^战败|^清剿所得|^清理奖励|^已开放|^巡枢残印引动|^中枢禁令/.test(message)) return 'combat';
  if (/^晋升|^领悟|^运转|^停止运转|^已可领悟|^掌握神通|^根基已定|^灵髓化悟|^本世气运|^轮回已定/.test(message)) return 'growth';
  if (/^炉鼎升至|^炼器 |^升炼 |：完成 \d+\/|采矿熟练增长|^开始开采/.test(message)) return 'production';
  if (/：购入 |：售出 /.test(message)) return 'trade';
  if (/^使用 |^取得/.test(message)) return 'items';
  return 'other';
}
export function visibleLogs(log: ViewProps['game']['log'], settings: LogSettings) {
  const occurrences = new Map<string, number>();
  return log.slice(-settings.limit).flatMap(entry => {
    const group = logGroupOf(entry.message);
    if (!settings.groups.includes(group)) return [];
    const identity = `${entry.at}:${entry.message}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return [{ ...entry, group, key: `${identity}:${occurrence}` }];
  });
}
