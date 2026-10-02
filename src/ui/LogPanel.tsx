import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Coins, Flame, Package, ScrollText, Sparkles, Swords } from 'lucide-react';
import { formatNumericText, timeLabel } from '../format';
import { IconButton } from './common';
import { LOG_GROUPS, visibleLogs, type LogGroup, type LogSettings } from './log-settings';
import type { ViewProps } from './types';

const ICONS = { combat: Swords, growth: Sparkles, production: Flame, trade: Coins, items: Package, other: ScrollText };
export function LogPanel({ game, settings, toggleGroup }: Pick<ViewProps, 'game'> & {
  settings: LogSettings; toggleGroup: (group: LogGroup) => void;
}) {
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const entries = visibleLogs(game.log, settings);
  useEffect(() => { if (follow && list.current) list.current.scrollTop = list.current.scrollHeight; }, [game.log, settings, follow]);
  return <aside className="log-panel" aria-label="事件日志">
    <header><ScrollText size={17} /><h2>行迹</h2><span title={`最近${settings.limit}条记录中显示${entries.length}条`}>{entries.length}条</span></header>
    <div className="log-filters" role="group" aria-label="日志分类开关">
      {LOG_GROUPS.map(group => {
        const Icon = ICONS[group.id];
        const enabled = settings.groups.includes(group.id);
        return <button key={group.id} aria-label={group.title} aria-pressed={enabled} title={`${enabled ? '隐藏' : '显示'}${group.title}`}
          onClick={() => toggleGroup(group.id)}><Icon size={13} /><span>{group.label}</span></button>;
      })}
    </div>
    <div className="log-scroll" ref={list} tabIndex={0} aria-label="日志条目"
      onWheel={event => { if (event.deltaY < 0) setFollow(false); }}
      onTouchMove={() => setFollow(false)} onPointerDown={() => setFollow(false)}
      onKeyDown={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) setFollow(false); }}>
      {entries.length ? entries.map(entry => <article className={`log-entry ${entry.group}`} key={entry.key}>
        <time>{timeLabel(entry.at)}</time><p>{formatNumericText(entry.message)}</p></article>) : <p className="empty-line">{settings.groups.length ? '近期暂无此类记录' : '日志分类已全部关闭'}</p>}
    </div>
    <footer><label className="check-label"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />跟随最新</label>
      <IconButton label="回到最新日志" onClick={() => { setFollow(true); if (list.current) list.current.scrollTop = list.current.scrollHeight; }}><ArrowDown size={15} /></IconButton></footer>
  </aside>;
}
