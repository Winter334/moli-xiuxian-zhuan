import { useEffect, useState } from 'react';
import { Coins, Flame, LoaderCircle, RefreshCw, Sparkles, Swords, Trophy } from 'lucide-react';
import { RANKING_NAMES, type RankingBoard, type RankingEntry, type RankingId, type RankingMetric } from '../../shared/rankings';
import { formatAmount } from '../format';
import { Empty, IconButton, Tabs } from './common';

const boardIcons: Record<RankingId, typeof Sparkles> = {
  cultivation: Sparkles, power: Swords, refining: Flame, money: Coins,
};

function metricText(metric: RankingMetric, exact = false) {
  const amount = (value: string) => exact ? value : formatAmount(value);
  switch (metric.kind) {
    case 'cultivation': return `${amount(metric.xp)} 修为`;
    case 'refining': return `${metric.level}级 · ${amount(metric.xp)} 熟练`;
    case 'power': return amount(metric.score);
    case 'money': return `${amount(metric.amount)} 灵石`;
  }
}

function RankingRow({ entry }: { entry: RankingEntry }) {
  const top = entry.rank <= 3 ? ` top-${entry.rank}` : '';
  return <li className={`ranking-entry${top}`} aria-current={entry.isSelf ? 'true' : undefined}>
    <span className="ranking-rank" aria-label={`第${entry.rank}名`}>{entry.rank}</span>
    <div className="ranking-who">
      <span className="ranking-name"><strong>{entry.name}</strong>{entry.isSelf && <em>我</em>}</span>
      <span className="ranking-realm">{entry.realmName}</span>
    </div>
    <div className="ranking-figure">
      <strong title={metricText(entry.metric, true)}>{metricText(entry.metric)}</strong>
      <time dateTime={new Date(entry.updatedAt).toISOString()}>{new Date(entry.updatedAt).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })}收录</time>
    </div>
  </li>;
}

export function RankingsPanel({ load, lastCloudSave }: {
  load: (board: RankingId) => Promise<RankingBoard>;
  lastCloudSave: number | null;
}) {
  const [board, setBoard] = useState<RankingId>('cultivation');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RankingBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError(null);
    void load(board).then(result => {
      if (!cancelled) setData(result);
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error && !['TypeError', 'AbortError', 'ZodError'].includes(cause.name)
        ? cause.message : '璇玑阁暂不可用，请稍后再试。');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [board, refresh, load, lastCloudSave]);
  const BoardIcon = boardIcons[board];

  return <div className="rankings-section">
    <div className="section-line"><span className="eyebrow">璇玑阁 · 修士名录</span>
      <IconButton label="刷新榜单" disabled={loading} onClick={() => setRefresh(value => value + 1)}>
        <RefreshCw size={17} /></IconButton></div>
    <Tabs label="璇玑阁榜单" value={board}
      options={(Object.keys(RANKING_NAMES) as RankingId[]).map(id => ({ id, label: RANKING_NAMES[id] }))}
      onChange={setBoard} />
    <div className="rankings-panel" role="region" aria-label={RANKING_NAMES[board]} aria-busy={loading}>
      {loading && <p className="empty-line"><LoaderCircle size={17} className="spinning" />正在读取榜单</p>}
      {error && <p role="alert" className="cost-warning">{error}</p>}
      {data && <>
        <div className="ranking-self" aria-label="我的名次">
          <BoardIcon size={20} strokeWidth={1.4} />
          <div>
            <span className="eyebrow">我的名次 · {RANKING_NAMES[board]}</span>
            {data.self ? <p><strong>第{data.self.rank}名</strong><span>{metricText(data.self.metric)}</span></p>
              : <p className="muted">尚未收录于本榜</p>}
          </div>
        </div>
        {data.entries.length ? <ol className="ranking-list">
          {data.entries.map((entry, index) => <RankingRow key={index} entry={entry} />)}
        </ol> : <Empty icon={<Trophy size={28} />}>暂无收录</Empty>}
        <p className="ranking-note">悬停数值可查看精确值。</p>
      </>}
    </div>
  </div>;
}
