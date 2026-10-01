import { useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Search } from 'lucide-react';
import { ENEMIES } from '../../core/prototype/content';
import { realmName } from '../../core/prototype/growth';
import { enemySchema } from '../../core/prototype/types';
import { attackIntervalMs } from '../../core/prototype/stats';
import { formatAmount, percent } from '../format';
import { CombatAvatar } from './art';
import { enemyAbilities } from './enemy-details';
import { Dialog, Empty, IconButton } from './common';
import type { ViewProps } from './types';

export function BestiaryView({ game, onBack }: ViewProps & { onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const known = Object.keys(game.history.firstEncounters);
  const entries = known.filter(id => ENEMIES[id].name.includes(query.trim()))
    .sort((a, b) => ENEMIES[a].realm - ENEMIES[b].realm || ENEMIES[a].name.localeCompare(ENEMIES[b].name, 'zh-CN'));
  const content = selected && known.includes(selected) ? ENEMIES[selected] : null;
  const enemy = content ? enemySchema.parse(content.definition) : null;
  return <div className="page bestiary-view">
    <div className="page-heading"><div><span className="eyebrow">历世见闻 · {known.length}种</span><h1>敌人图鉴</h1></div>
      <IconButton label="返回履历" onClick={onBack}><ArrowLeft size={18} /></IconButton></div>
    <div className="list-toolbar"><label className="search-field"><Search size={16} /><input type="search" aria-label="搜索已遭遇敌人"
      placeholder="搜索敌人" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    <div className="bestiary-list">{entries.map(id => <button className="bestiary-entry" key={id} onClick={() => setSelected(id)}>
      <CombatAvatar enemyId={id} name={ENEMIES[id].name} /><span><strong>{ENEMIES[id].name}</strong>
        <small>{realmName(ENEMIES[id].realm)} · 击败 {formatAmount(game.history.kills[id] ?? '0')} 次</small></span><ChevronRight size={16} />
    </button>)}</div>
    {!entries.length && <Empty icon={<BookOpen size={26} />}>{known.length ? '未找到对应见闻' : '尚无敌人见闻'}</Empty>}
    {content && enemy && selected && <Dialog title={content.name} onClose={() => setSelected(null)}>
      <div className="bestiary-title"><CombatAvatar enemyId={selected} name={content.name} /><div><span>{realmName(content.realm)}</span>
        <p className="small muted">初遇于第{game.history.firstEncounters[selected].life}世 · 击败{formatAmount(game.history.kills[selected] ?? '0')}次</p></div></div>
      <p className="flavor">{content.description}</p>
      <h3>基础属性</h3><dl className="bestiary-stats">
        {[['气血', enemy.stats.maxHp], ['攻击', enemy.stats.attack], ['防御', enemy.stats.defense], ['敏捷', enemy.stats.agility],
          ['暴击率', percent(Number(enemy.stats.critChance))], ['暴击倍率', `×${enemy.stats.critMultiplier}`],
          ['出手间隔', `${attackIntervalMs(enemy.stats.attackSpeed) / 1000}秒`]].map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{['气血', '攻击', '防御', '敏捷'].includes(label) ? formatAmount(value) : value}</dd></div>)}
      </dl>
      <h3>战斗特性</h3>{enemyAbilities(enemy.abilities).length ? enemyAbilities(enemy.abilities).map(line => <p className="enemy-ability" key={line}>{line}</p>)
        : <p className="muted">无特殊能力</p>}
    </Dialog>}
  </div>;
}
