import { useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Search } from 'lucide-react';
import { ENEMIES, ITEMS, REGIONS, enemyRealmName, type LootEntry } from '../../core/prototype/content';
import { enemySchema } from '../../core/prototype/types';
import { attackIntervalMs } from '../../core/prototype/stats';
import { decimal, formatAmount, formatDecimal, percent } from '../format';
import { CombatAvatar } from './art';
import { enemyAbilities } from './enemy-details';
import { Dialog, Empty, IconButton, ItemGlyph } from './common';
import type { ViewProps } from './types';

function groupedLoot(loot: LootEntry[]) {
  const groups: (LootEntry & { rolls: number })[] = [];
  for (const entry of loot) {
    if (decimal(entry.chance).lte(0)) continue;
    const group = groups.find(value => value.itemId === entry.itemId &&
      decimal(value.chance).eq(entry.chance) && Boolean(value.ignoreLuck) === Boolean(entry.ignoreLuck));
    if (group) group.rolls++;
    else groups.push({ ...entry, rolls: 1 });
  }
  return groups;
}

function lootRate(chance: string, unit: string) {
  const amount = decimal(chance);
  const whole = amount.floor();
  const extra = amount.minus(whole);
  const guaranteed = whole.gt(0) ? `必得 ${formatAmount(whole.toFixed())}${unit}` : '';
  const random = extra.gt(0) ? `${formatAmount(extra.mul(100).toFixed())}%${whole.gt(0) ? ' 额外' : ''}掉落 1${unit}` : '';
  return [guaranteed, random].filter(Boolean).join('，');
}

export function BestiaryView({ game, onBack }: ViewProps & { onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const known = Object.keys(game.history.firstEncounters);
  const entries = known.filter(id => ENEMIES[id].name.includes(query.trim()) ||
    ENEMIES[id].loot.some(drop => decimal(drop.chance).gt(0) && ITEMS[drop.itemId].name.includes(query.trim())))
    .sort((a, b) => ENEMIES[a].realm - ENEMIES[b].realm || ENEMIES[a].name.localeCompare(ENEMIES[b].name, 'zh-CN'));
  const content = selected && known.includes(selected) ? ENEMIES[selected] : null;
  const enemy = content ? enemySchema.parse(content.definition) : null;
  const drops = content ? groupedLoot(content.loot) : [];
  const locations = selected ? game.regions.filter(region => {
    const definition = REGIONS[region.id];
    return definition.pool.includes(selected) || Object.values(definition.encounterPools ?? {}).some(pool => pool.includes(selected));
  }) : [];
  return <div className="page bestiary-view">
    <div className="page-heading"><div><span className="eyebrow">历世见闻 · {known.length}种</span><h1>敌人图鉴</h1></div>
      <IconButton label="返回履历" onClick={onBack}><ArrowLeft size={18} /></IconButton></div>
    <div className="list-toolbar"><label className="search-field"><Search size={16} /><input type="search" aria-label="搜索已遭遇敌人或掉落物"
      placeholder="搜索敌人或掉落物" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    <div className="bestiary-list">{entries.map(id => <button className="bestiary-entry" key={id} onClick={() => setSelected(id)}>
      <CombatAvatar enemyId={id} name={ENEMIES[id].name} /><span><strong>{ENEMIES[id].name}</strong>
        <small>{enemyRealmName(ENEMIES[id])} · 击败 {formatAmount(game.history.kills[id] ?? '0')} 次</small>
        <small className="bestiary-entry-loot">掉落：{[...new Set(groupedLoot(ENEMIES[id].loot).map(drop => ITEMS[drop.itemId].name))].join('、') || '无'}</small>
      </span><ChevronRight size={16} />
    </button>)}</div>
    {!entries.length && <Empty icon={<BookOpen size={26} />}>{known.length ? '未找到对应见闻' : '尚无敌人见闻'}</Empty>}
    {content && enemy && selected && <Dialog title={content.name} onClose={() => setSelected(null)}>
      <div className="bestiary-title"><CombatAvatar enemyId={selected} name={content.name} /><div><span>{enemyRealmName(content)}</span>
        <p className="small muted">初遇于第{game.history.firstEncounters[selected].life}世 · 击败{formatAmount(game.history.kills[selected] ?? '0')}次</p></div></div>
      <p className="flavor">{content.description}</p>
      {locations.length > 0 && <p className="bestiary-locations"><span>出没地点</span>
        {locations.map(region => `${region.name}${region.challenge ? region.completed ? '（挑战已完成）' : '（一次性挑战）' : ''}`).join('、')}
      </p>}
      <section className="bestiary-loot" aria-label="基础掉落">
        <h3>基础掉落</h3>
        <p className="muted small">各项独立判定，不含地域与气运掉落加成。</p>
        {drops.length ? <ul>{drops.map((drop, index) => {
          const item = ITEMS[drop.itemId];
          const unit = item.kind === 'equipment' || item.kind === 'part' ? '件' : '份';
          return <li key={`${drop.itemId}:${index}`}>
            <ItemGlyph itemId={drop.itemId} kind={item.kind} slot={item.slot} size={24} />
            <div className="bestiary-loot-name"><strong>{item.name}</strong>
              {drop.ignoreLuck && <small>不受掉落加成影响</small>}
            </div>
            <div className="bestiary-loot-rate"><span>{lootRate(drop.chance, unit)}</span>
              {drop.rolls > 1 && <small>{drop.rolls}次独立判定</small>}
            </div>
          </li>;
        })}</ul> : <p className="muted small">无击败掉落</p>}
      </section>
      <h3>基础属性</h3><dl className="bestiary-stats">
        {[['气血', enemy.stats.maxHp], ['攻击', enemy.stats.attack], ['防御', enemy.stats.defense], ['敏捷', enemy.stats.agility],
          ['暴击率', percent(Number(enemy.stats.critChance))], ['暴击倍率', `×${formatDecimal(enemy.stats.critMultiplier)}`],
          ['出手间隔', `${formatDecimal(attackIntervalMs(enemy.stats.attackSpeed) / 1000)}秒`]].map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{['气血', '攻击', '防御', '敏捷'].includes(label) ? formatAmount(value) : value}</dd></div>)}
      </dl>
      <h3>战斗特性</h3>{enemyAbilities(enemy.abilities).length ? enemyAbilities(enemy.abilities).map(line => <p className="enemy-ability" key={line}>{line}</p>)
        : <p className="muted">无特殊能力</p>}
    </Dialog>}
  </div>;
}
