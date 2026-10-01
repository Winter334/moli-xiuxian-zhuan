import { BookOpen, Flag, MapPin, RotateCcw, Sparkles } from 'lucide-react';
import { REGIONS, SAFE_LOCATIONS } from '../../core/prototype/content';
import { worldCalendarAt } from '../../core/prototype/calendar';
import { realmName } from '../../core/prototype/growth';
import { formatAmount } from '../format';
import { Empty } from './common';
import type { ViewProps } from './types';

const worldDate = (at: number) => {
  const date = worldCalendarAt(at);
  return `${date.year}年${date.month}月${date.day}日`;
};

export function JournalView({ game, openBestiary, openReincarnation }:
  ViewProps & { openBestiary: () => void; openReincarnation: () => void }) {
  const history = game.history;
  const milestones = [
    ...Object.entries(history.firstVisits).map(([id, entry]) => ({ ...entry, key: `visit:${id}`, kind: 'visit', label: `初至${(SAFE_LOCATIONS[id] ?? REGIONS[id]).name}`, icon: MapPin })),
    ...Object.entries(history.firstClears).map(([id, entry]) => ({ ...entry, key: `clear:${id}`, kind: 'clear', label: `清理${REGIONS[id].name}`, icon: Flag })),
    ...Object.entries(history.firstRealms).filter(([id]) => id !== '0').map(([id, entry]) => ({ ...entry, key: `realm:${id}`, kind: 'realm', label: `初入${realmName(Number(id))}`, icon: Sparkles })),
  ].sort((a, b) => b.at - a.at);
  const sum = (values: string[]) => String(values.reduce((total, value) => total + BigInt(value), 0n));
  return <div className="page journal-view"><div className="page-heading"><div><span className="eyebrow">行过山河，皆有所记</span><h1>修行履历</h1></div>
    <button onClick={openBestiary}><BookOpen size={16} />敌人图鉴</button></div>
    {history.testAssisted && <span className="subtle-label">含测试辅助记录</span>}
    <section className="journal-hero" aria-label="历世总览">
      <div className="journal-life">
        <span className="eyebrow">轮回行记</span>
        <strong>第{game.life.number}世</strong>
        <span className={`journal-fate ${game.fate.tier}`}>{game.fate.name} · {game.fate.tierName}</span>
      </div>
      <dl className="attribute-grid lifetime-summary">
        {[['击败敌人', sum(Object.values(history.kills))], ['遭遇敌种', String(Object.keys(history.firstEncounters).length)],
          ['炼成产物', sum(Object.values(history.crafting).map(entry => entry.produced))], ['采得物料', sum(Object.values(history.gathered))],
          ['战败', history.defeats], ['主动撤退', history.withdrawals],
          ['购入支出', history.purchaseSpent], ['售出所得', history.saleEarned]].map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{formatAmount(value)}</dd></div>)}
      </dl>
    </section>
    <div className="section-title"><h2>初次经历</h2><span className="muted small">{milestones.length}则</span></div>
    <ol className="milestone-list">{milestones.map(entry => <li key={entry.key} className={entry.kind}>
      <span className="milestone-mark"><entry.icon size={16} /></span>
      <div><h3>{entry.label}</h3>
        <span>第{entry.life}世 · {realmName(entry.level)}</span></div><time>{worldDate(entry.at)}</time></li>)}</ol>
    {!milestones.length && <Empty icon={<BookOpen size={28} />}>修行之路，方才启程</Empty>}
    <section className="journal-reincarnation" aria-label="重入轮回">
      <RotateCcw size={20} strokeWidth={1.4} />
      <div>
        <h2>重入轮回</h2>
        <p>了却此世，境界与资产尽归尘土；历世履历与留痕跨世保留。</p>
      </div>
      <button className="danger subtle" onClick={openReincarnation}>了却此世</button>
    </section>
  </div>;
}
