import { useEffect, useState } from 'react';
import { ArrowLeftRight, ArrowUpRight, BookOpen, CirclePause, LockKeyhole, Play, Sparkles } from 'lucide-react';
import { decimal, formatAmount, formatDecimal, progress } from '../format';
import { TECHNIQUE_ART } from './art';
import { Bonuses, Dialog, Empty, Meter } from './common';
import type { ViewProps } from './types';

type Entry = ({ kind: 'manual' } & ViewProps['game']['manuals'][number])
  | ({ kind: 'divine' } & ViewProps['game']['divineArts'][number]);
const entryKey = (entry: Entry) => `${entry.kind}:${entry.id}`;
const kindName = (entry: Entry) => entry.kind === 'manual' ? '功法' : '神通';
const statusOf = (entry: Entry) => entry.active ? '运转中' : entry.learned ? entry.kind === 'manual' ? '已领悟' : '已掌握'
  : entry.kind === 'manual' ? entry.learnable ? '可领悟' : '未领悟' : '未掌握';
const availableFor = (entry: Entry) => entry.learned || entry.kind === 'manual' && entry.learnable;
function requirementOf(entry: Entry) {
  if (entry.kind === 'divine') return entry.requirement;
  if (entry.learnable) return `可在${entry.locationName}领悟`;
  if (entry.unlocked) return entry.locationName ? `需前往${entry.locationName}领悟` : '尚未到达领悟地点';
  return entry.prerequisiteName ? `清理${entry.prerequisiteName}后可领悟` : '尚未取得';
}

export function PracticeView({ game, blocked, command }: ViewProps) {
  const [selectedKey, setSelectedKey] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const manuals = game.manuals.filter(manual => manual.unlocked || manual.learned)
    .map(manual => ({ ...manual, kind: 'manual' as const }));
  const arts = game.divineArts.filter(art => art.learned).map(art => ({ ...art, kind: 'divine' as const }));
  const entries: Entry[] = [...manuals, ...arts];
  const selected = entries.find(entry => entryKey(entry) === selectedKey);
  const disabled = blocked || pending;
  const currentFor = (entry: Entry) => entries.find(other => other.kind === entry.kind && other.active);
  const actionLabel = (entry: Entry) => entry.active ? '停用' : !entry.learned ? entry.kind === 'manual' ? '领悟' : '未掌握'
    : currentFor(entry) ? '切换' : '运转';
  useEffect(() => { if (selectedKey && !selected) setSelectedKey(''); }, [selectedKey, selected]);
  const select = (entry: Entry) => { setSelectedKey(entryKey(entry)); setNotice(''); };
  const act = async (entry: Entry) => {
    if (disabled || !availableFor(entry)) return;
    setPending(true); setNotice('');
    try {
      const request: Parameters<ViewProps['command']>[0] = entry.kind === 'manual'
        ? entry.learned ? { type: 'activate-manual', manualId: entry.active ? null : entry.id }
          : { type: 'learn-manual', manualId: entry.id }
        : { type: 'activate-divine-art', divineArtId: entry.active ? null : entry.id };
      if (!await command(request)) setNotice('操作未完成');
    } catch (error) { setNotice(error instanceof Error ? error.message : '操作未完成'); }
    finally { setPending(false); }
  };
  const action = (entry: Entry) => <button className={entry.active ? '' : 'primary'}
    aria-label={`${actionLabel(entry)}${entry.name}`} disabled={disabled || !availableFor(entry)} onClick={() => void act(entry)}>
    {entry.active ? <CirclePause size={15} /> : !entry.learned ? entry.kind === 'manual' ? <BookOpen size={15} /> : <LockKeyhole size={15} />
      : currentFor(entry) ? <ArrowLeftRight size={15} /> : <Play size={15} />}{actionLabel(entry)}
  </button>;
  return <div className="page practice-view">
    <div className="page-heading practice-heading"><h1>修行</h1>
      <span className="subtle-label">{game.foundationName ?? game.realmName}</span></div>
    {game.foundationRequired && <p className="notice">修满6000万修为后，可服用筑基丹药突破。超出炼气上限的修为不再积存。</p>}
    {!selected && notice && <p className="negative small" role="alert">{notice}</p>}
    <section className="practice-manuals" aria-label="功法">
      <div className="practice-section-heading"><h2><BookOpen size={18} />功法</h2><span>同时运转一门</span></div>
      <div className="manual-list">{manuals.map(entry => <article key={entry.id}
        className={`manual-entry ${entry.active ? 'active' : ''}`} aria-label={entry.name}>
        <header>{TECHNIQUE_ART[entry.id] && <img className="manual-art raster-art" src={TECHNIQUE_ART[entry.id]} alt="" width={44} height={44} />}<div>
          <button className="practice-name" aria-label={`查看${entry.name}`} title={`查看${entry.name}详情`} onClick={() => select(entry)}>
            <strong>{entry.name}</strong><ArrowUpRight size={13} /></button>
          <span className={`practice-status ${entry.active ? 'positive' : 'muted'}`}>{entry.active && <Play size={11} />}{statusOf(entry)}</span>
        </div>{action(entry)}</header>
        {entry.unlocked && <p className="flavor">{entry.description}</p>}
        <div className="manual-effects"><span className="manual-effect-label">{entry.learned ? '运转效果' : '入门参考'}</span>
          <Bonuses source={entry.bonuses} />{entry.targetCount > 1 && <span>最多{entry.targetCount}个不同目标</span>}</div>
        {entry.learned ? <div className="manual-growth">
          <span className="manual-level">{entry.level}<small> / {entry.maxLevel}级</small></span>
          <div className="manual-proficiency"><div>
            <span>{entry.nextThreshold ? '累计熟练' : '功法圆满'}</span>
            <span title={entry.nextThreshold ? `${formatDecimal(entry.xp)} / ${formatDecimal(entry.nextThreshold)}` : formatDecimal(entry.xp)}>
              {formatAmount(entry.xp)}{entry.nextThreshold && <> / {formatAmount(entry.nextThreshold)}</>}
            </span>
          </div><progress aria-label={`${entry.name}累计熟练`} value={entry.nextThreshold ? progress(entry.xp, entry.nextThreshold) : 100} max={100} /></div>
        </div> : <p className="practice-requirement">{requirementOf(entry)}</p>}
      </article>)}</div>
      {!manuals.length && <Empty icon={<BookOpen size={26} />}>尚无法门</Empty>}
    </section>
    <section className="practice-divine" aria-label="神通">
      <div className="practice-section-heading"><h2><Sparkles size={18} />神通</h2><span>与功法并行</span></div>
      {arts.map(entry => <article key={entry.id} className={`practice-art ${entry.active ? 'active' : ''}`}>
        <header>{TECHNIQUE_ART[entry.id] && <img className="manual-art raster-art" src={TECHNIQUE_ART[entry.id]} alt="" width={44} height={44} />}<div>
          <button className="practice-name" aria-label={`查看${entry.name}`} title={`查看${entry.name}详情`} onClick={() => select(entry)}>
            <strong>{entry.name}</strong><ArrowUpRight size={13} /></button>
          <span className={`practice-status ${entry.active ? 'positive' : 'muted'}`}>{entry.active && <Play size={11} />}{statusOf(entry)}</span>
        </div>{action(entry)}</header>
        <Bonuses source={entry.bonuses} />
        {entry.progress && <div className="manual-growth">
          <span className="manual-level">{entry.progress.level}<small> / {entry.progress.max}级</small></span>
          <div className="manual-proficiency"><div><span>累计熟练</span><span>{formatAmount(entry.progress.xp)}</span></div>
            <progress aria-label="领域累计熟练" max={100}
              value={entry.progress.nextThreshold ? progress(entry.progress.xp, entry.progress.nextThreshold) : 100} /></div>
        </div>}
        <p className="flavor">{entry.description}</p>
        {!entry.learned && <p className="practice-requirement">{entry.requirement}</p>}
      </article>)}
      {!arts.length && <Empty icon={<Sparkles size={26} />}>尚无神通</Empty>}
    </section>
    {selected && <Dialog title={selected.name} onClose={() => { setSelectedKey(''); setNotice(''); }} footer={
      <div className="practice-actions"><div>
        {notice && <p className="negative" role="alert">{notice}</p>}
        <p className="muted">{!selected.learned ? requirementOf(selected) : !selected.active && currentFor(selected) ? `将替换${currentFor(selected)!.name}`
          : selected.kind === 'manual' ? '功法同时只能运转一门' : '可与功法并行运转'}</p>
      </div>{action(selected)}</div>
    }>
      <div className={`practice-detail-title ${selected.kind}`}>
        <span className="practice-glyph">{TECHNIQUE_ART[selected.id]
          ? <img src={TECHNIQUE_ART[selected.id]} alt="" width={28} height={28} className="raster-art" />
          : selected.kind === 'manual' ? <BookOpen size={28} /> : <Sparkles size={28} />}</span>
        <div><span className="eyebrow">{kindName(selected)}{selected.kind === 'manual' && selected.learned ? ` · ${selected.level} / ${selected.maxLevel}级` : ''}</span>
          <strong className={selected.active ? 'positive' : ''}>{statusOf(selected)}</strong></div>
      </div>
      <p className="flavor">{selected.kind === 'manual' && !selected.unlocked ? requirementOf(selected) : selected.description}</p>
      <section className="practice-effects">
        <h3>{selected.kind === 'manual' && !selected.learned ? '入门运转效果' : '运转效果'}</h3>
        <Bonuses source={selected.bonuses} />
        {selected.kind === 'manual' && selected.targetCount > 1 && <p className="small">每次行动最多攻击{selected.targetCount}个不同目标</p>}
      </section>
      {selected.kind === 'manual' ? <section className="practice-progress">
        <h3>功法熟练</h3>
        {selected.learned ? selected.nextThreshold ? <>
          <Meter label="累计熟练" value={selected.xp} max={selected.nextThreshold} />
          <p className="muted small">距下一级 {formatAmount(decimal(selected.nextThreshold).minus(selected.xp).toFixed())} 熟练</p>
        </> : <p className="positive small">已达{selected.maxLevel}级，功法圆满</p> : <p className="muted small">尚未领悟</p>}
        <p className="muted small">运转后随实际战斗积累自身熟练，领悟不自动运转。</p>
      </section> : selected.progress ? <section className="practice-progress">
        <h3>领域熟练 · {selected.progress.level} / {selected.progress.max}级</h3>
        {selected.progress.nextThreshold ? <Meter label="累计熟练" value={selected.progress.xp} max={selected.progress.nextThreshold} />
          : <p>累计熟练 {formatAmount(selected.progress.xp)}</p>}
        <h3>常驻成长</h3><Bonuses source={selected.progress.passive} />
      </section> : <p className="muted small">{selected.requirement}，与功法分别运转；不消耗功法运转位。</p>}
    </Dialog>}
  </div>;
}
