import { useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, Coins, Gem, Image, List, Sparkles, UserRound } from 'lucide-react';
import { SKILLS, type SkillId } from '../../core/prototype/skills';
import { TECHNIQUE_ART } from './art';
import { batchLimit, decimal, duration, formatAmount, formatNumericText, percent } from '../format';
import { activityName } from './ActivityPanel';
import { Bonuses, Dialog, IconButton, ItemGlyph, Meter } from './common';
import type { ViewProps } from './types';
import { DiscordAvatar, useDiscordIdentity } from '../discord-identity';

const ATTRIBUTES = [
  { id: 'attack', name: '攻击', description: '普攻先计算攻击与目标防御的差值，再结算波动、暴击和伤害加成。攻击提升不等于同百分比的伤害提升。' },
  { id: 'defense', name: '防御', description: '用于抵消敌方攻击。敌人的无视防御、牵制等能力会改变实际结算，最终伤害还受伤害修正影响。' },
  { id: 'agility', name: '敏捷', description: '与对手敏捷共同决定命中及闪避，多敌遭遇还会改变双方的有效敏捷。' },
  { id: 'maxHp', name: '气血上限', description: '当前可容纳的气血总量。功法代价、装备、熟练与气运都可能影响此值。' },
  { id: 'attackSpeed', name: '攻速', description: '决定普通攻击的出手间隔，按每秒攻击次数显示。' },
  { id: 'critChance', name: '暴击率', description: '普通攻击命中后的暴击判定概率。' },
  { id: 'critMultiplier', name: '暴击伤害', description: '普通攻击暴击时使用的伤害倍率。' },
  { id: 'attackMultiplier', name: '普攻倍率', description: '普攻伤害计算使用的属性倍率。气运等公共伤害修正另外参与结算，不全部折入此面板。' },
  { id: 'hpRegen', name: '定值恢复', description: '属性提供的每秒定值气血恢复。正向恢复还受公共恢复增效影响；负值损耗不因此减免。' },
  { id: 'hpRegenPercent', name: '比例恢复', description: '属性提供的每秒气血上限比例恢复。负值表示气血损耗，正负来源分别结算。' },
] as const;
const skillDescriptions: Record<SkillId, string> = {
  combat: '在真实战斗中磨砺战技，成长改善身法与对敌能力。',
  unarmed: '空手战斗时增长，拳脚熟练作用于对应武器类型。',
  sword: '持剑战斗时增长；除了剑术本身，达到相应等级也有熟练里程碑收益。',
  greatsword: '使用重剑战斗时增长，重剑有独立熟练和里程碑收益。',
  toughness: '通过符合条件的承伤增长，提高防御；部分敌人不提供承伤熟练。',
  rest: '歇息与调息中积累，达到相应等级改善气血与熟练收益，不加速公共历法。',
  refining: '制作、精炼、合炼与升炼时积累，影响普通制作成功率及器物品质。',
  trade: '系统买卖中积累，改善系统商店采购溢价；不改变玩家寄售定价。',
  'cloudstep-art': '领悟并运转后，在实际活动中积累功法熟练，逐步改善功法收益与代价。',
  'mountainforce-art': '领悟并运转后，在实际活动中积累功法熟练，逐步改善功法收益与代价。',
  'surging-tide-art': '运转时聚劲于一个目标，提升攻击、攻速与普攻倍率；每次攻击行动增长一次自身熟练。',
  'flowchasing-art': '运转时连续行气，侧重攻速并提升攻击与普攻倍率；与其它功法各自独立成长。',
  'scattered-rain-art': '一次行动分击数个不同目标，目标不足不重复攻击；自身熟练按选定目标基础经验的均值增长。',
  footwork: '在允许的训练地点借风练步，以导气轻身磨砺步法，改善敏捷与出手能力。',
  physique: '在允许的训练地点承压或抗流锻体，锤炼筋骨，改善气血与恢复能力；各地训练共用体魄熟练。',
  mining: '实际开采中积累，影响出货概率与采矿效率。',
  logging: '在北麓柳林采木中积累，改善取材周期与单次产量。',
  fishing: '等待鱼讯与成功收鱼各自积累熟练，改善等待周期、操竿区间与可遇灵鱼。',
  domain: '按实际对敌扣血积累独立熟练，常驻增长攻防敏；运转时采用当前领域阶段。',
  pressure: '在灵舟普通战区在线交战时积累，抵抗当地威压；回复里程碑累计且离开战区仍保留。',
  'manual-mastery': '由功法、领域、归息盏或星解盘的较高累计带动；精通高于所练法门时，每级差使该门所得熟练乘1.1，各门仍独立成长。',
  'weapon-mastery': '由剑术或重剑术的较高累计带动；精通高于所练武器技能时，每级差使其所得熟练乘1.1，不影响拳脚。',
  'returning-lamp': '装备归息盏后在实际活动中积累，其里程碑影响技能熟练收益。',
  'star-dissolution-disk': '装备后每次命中独立积累熟练；永久里程碑提高全经验及领域专属熟练，卸下仍保留。',
};
type Detail = { kind: 'stat'; id: typeof ATTRIBUTES[number]['id'] } | { kind: 'skill'; id: SkillId }
  | { kind: 'fate' | 'effects' | 'marrow' };
export function CharacterPanel({ game, blocked, command, goActivity, activityLabel }: ViewProps & {
  goActivity: () => void; activityLabel?: string;
}) {
  const identity = useDiscordIdentity();
  const [view, setView] = useState<'portrait' | 'data'>('portrait');
  const [detail, setDetail] = useState<Detail | null>(null);
  const useFlight = useRef(false);
  const [using, setUsing] = useState(false);
  const [useNotice, setUseNotice] = useState('');
  const [absorb, setAbsorb] = useState(false);
  const [offering, setOffering] = useState(false);
  const stat = detail?.kind === 'stat' ? ATTRIBUTES.find(entry => entry.id === detail.id) : null;
  const skill = detail?.kind === 'skill' ? game.skills.find(entry => entry.id === detail.id) : null;
  const valueOf = (id: typeof ATTRIBUTES[number]['id']) => id === 'critChance' || id === 'hpRegenPercent' ? `${percent(Number(game.stats[id]))}${id === 'hpRegenPercent' ? '/秒' : ''}`
    : id === 'critMultiplier' || id === 'attackMultiplier' ? `×${formatAmount(game.stats[id])}`
      : `${formatAmount(game.stats[id])}${id === 'attackSpeed' || id === 'hpRegen' ? '/秒' : ''}`;
  const consumables = game.inventory.filter(item => item.use);
  const useConsumable = async (itemId: string, quantity: number) => {
    const item = consumables.find(entry => entry.itemId === itemId);
    if (blocked || useFlight.current || !item?.use || item.use.issue || !Number.isInteger(quantity) ||
      quantity < 1 || quantity > batchLimit(item.quantity, '1', item.use.maxBatch)) return;
    useFlight.current = true;
    setUsing(true); setUseNotice('');
    try {
      if (!await command({ type: 'use', itemId, quantity })) setUseNotice('使用未完成');
    } catch { setUseNotice('使用未完成'); }
    finally { useFlight.current = false; setUsing(false); }
  };
  const absorption = game.marrowAbsorption;
  return <aside className="character-panel" aria-label="角色信息">
    <header className="character-heading"><div><span className="eyebrow">散修 · 第{game.life.number}世</span><h2>{game.realmName}</h2></div>
      <div className="icon-segment" role="group" aria-label="角色展示">
        <IconButton label={identity ? '显示头像' : '显示立绘'} aria-pressed={view === 'portrait'} onClick={() => setView('portrait')}>
          {identity ? <UserRound size={17} /> : <Image size={17} />}</IconButton>
        <IconButton label="显示属性与技能" aria-pressed={view === 'data'} onClick={() => setView('data')}><List size={17} /></IconButton>
      </div>
    </header>
    <div className="character-vitals">
      <Meter label="气血" value={game.hp} max={game.stats.maxHp} tone="red" />
      <Meter label="修为" value={game.cultivation} max={game.nextLevelCost ?? game.cultivationCap ?? game.cultivation} />
      {game.level === 24 && <p className="muted small">元婴圆满修为上限1兆；达到9000亿后，炼化一颗化神灵晶可突破。</p>}
      {game.cultivationCap && <p className="muted small">当前开放至{game.realmName}，修为上限{formatAmount(game.cultivationCap)}；溢出不再计入。</p>}
      <div className="character-wealth"><span>常态战力 <strong>{formatAmount(game.combatPower.score)}</strong></span>
        <span className="wallet"><Coins size={13} />{formatAmount(game.money)}</span></div>
    </div>
    <div className="character-scroll">
      {view === 'portrait' ? identity ? <div className="discord-profile">
        <DiscordAvatar /><h3 title={identity.displayName}>{identity.displayName}</h3>
        <span className="muted small" title={`Discord ${identity.id}`}>@{identity.username}</span>
        <span className="eyebrow">Discord 已连接</span>
      </div> : <div className="portrait-stage" role="img" aria-label="角色立绘">
        <div className="portrait-frame" aria-hidden="true"><span>道</span></div>
        <div className="portrait-caption"><span>{game.foundationName ?? '山河独行'}</span><strong>此身入道</strong></div>
      </div> : <div className="character-data">
        <div className="detail-label">周身属性</div>
        <div className="attribute-list">{ATTRIBUTES.map(entry => <button key={entry.id} onClick={() => setDetail({ kind: 'stat', id: entry.id })}>
          <span>{entry.name}</span><strong>{valueOf(entry.id)}</strong><ArrowUpRight size={12} /></button>)}</div>
        <div className="detail-label">百艺熟练</div>
        <div className="sidebar-skills">{game.skills.map(entry => <button key={entry.id} onClick={() => setDetail({ kind: 'skill', id: entry.id })}>
          {TECHNIQUE_ART[entry.id]
            ? <img src={TECHNIQUE_ART[entry.id]} alt="" width={13} height={13} className="raster-art" />
            : <BookOpen size={13} />}<span>{entry.name}</span><strong>{entry.level}<small>级</small></strong></button>)}</div>
        <button className="marrow-link" onClick={() => setDetail({ kind: 'marrow' })}><Gem size={15} />灵髓积蕴<ArrowUpRight size={13} /></button>
      </div>}
      <button className={`character-fate ${game.fate.tier}`} onClick={() => setDetail({ kind: 'fate' })}>
        <Sparkles size={17} /><span>{game.fate.name}</span><small>{game.fate.tierName}</small><ArrowUpRight size={12} /></button>
    </div>
    <section className="quickbar" aria-label="快捷消耗品">
      <div className="section-line"><h3>消耗品</h3>
        <button className="effects-link" disabled={!game.effects.length} onClick={() => setDetail({ kind: 'effects' })}>
          药效 <span>{game.effects.length}</span></button></div>
      <div className="quickbar-list" role="list" tabIndex={0} aria-label="持有的消耗品">
        {consumables.map(item => {
          const use = item.use!;
          const max = batchLimit(item.quantity, '1', use.maxBatch);
          const allAllowed = decimal(item.quantity).eq(max);
          const disabled = blocked || using || Boolean(use.issue);
          const batchIssue = `每次最多使用${formatAmount(String(use.maxBatch))}个`;
          return <article key={item.itemId} className="quick-item" role="listitem" title={formatNumericText(use.issue ?? use.description)}>
            <ItemGlyph kind={item.kind} itemId={item.itemId} size={32} />
            <div className="quick-item-info"><strong>{item.name}</strong><small title={`持有 ${item.quantity} 个`}>×{formatAmount(item.quantity)}</small>{item.itemId === 'huashen-crystal' && <small>{use.description}</small>}</div>
            <div className="quick-item-actions" role="group" aria-label={`使用${item.name}`}>
              <button aria-label={`使用1个${item.name}`} title={use.issue ?? `使用1个${item.name}`}
                disabled={disabled || max < 1} onClick={() => void useConsumable(item.itemId, 1)}>1</button>
              <button aria-label={`使用10个${item.name}`} title={use.issue ?? (use.maxBatch < 10 ? batchIssue : max < 10 ? '数量不足10个' : `使用10个${item.name}`)}
                disabled={disabled || max < 10} onClick={() => void useConsumable(item.itemId, 10)}>10</button>
              <button className="quick-use-all" aria-label={`使用全部${item.name}`}
                title={use.issue ?? (!allAllowed ? batchIssue : `使用全部${item.name}（${item.quantity}个）`)}
                disabled={disabled || max < 1 || !allAllowed} onClick={() => void useConsumable(item.itemId, max)}>全部</button>
            </div>
          </article>;
        })}</div>
      {!consumables.length && <p className="quickbar-empty">暂无消耗品</p>}
      {useNotice && <p className="quickbar-notice negative" role="status">{useNotice}</p>}
    </section>
    {game.fortuneOffering && <button disabled={blocked} onClick={() => setOffering(true)}>纳财养运 · ×{formatAmount(game.fortuneOffering.multiplier)}</button>}
    {offering && game.fortuneOffering && <Dialog title="纳财养运" onClose={() => setOffering(false)}>
      <p>消耗行囊全部紫铸旧币，共{formatAmount(game.fortuneOffering.count)}枚，出售价值{formatAmount(game.fortuneOffering.value)}灵石。</p>
      <p>本世累计投入{formatAmount(game.fortuneOffering.points)}枚；幸运乘区 ×{formatAmount(game.fortuneOffering.multiplier)} → ×{formatAmount(game.fortuneOffering.nextMultiplier)}。</p>
      <p>投入随轮回重置，不消耗灵石余额或其它货币。</p>
      <button className="primary" disabled={blocked || game.fortuneOffering.count === '0'} onClick={async () => {
        if (await command({ type: 'offer-fortune' })) setOffering(false);
      }}>确认投入全部紫铸旧币</button>
    </Dialog>}
    <button className="character-activity" onClick={goActivity}><i className={game.battle || activityLabel ? 'combat' : ''} /><span>{activityLabel ?? activityName(game)}</span>
      <small>{game.locationName}</small><ArrowUpRight size={14} /></button>
    {detail && <Dialog title={stat?.name ?? skill?.name ?? ({ fate: '本世气运', effects: '当前药效', marrow: '灵髓积蕴' } as Record<string, string>)[detail.kind] ?? '角色详情'}
      onClose={() => { setDetail(null); setAbsorb(false); }}>
      {stat && <><div className="detail-number">{valueOf(stat.id)}</div><p>{stat.description}</p>
        <h3 className="detail-label">当前装备与运转来源</h3>
        {[...game.instances.filter(entry => entry.equipped).map(entry => ({ name: entry.name, bonuses: entry.bonuses })),
          ...game.manuals.filter(entry => entry.active), ...game.divineArts.filter(entry => entry.active)]
          .filter(entry => entry.bonuses?.flat?.[stat.id] !== undefined || entry.bonuses?.multiplier?.[stat.id] !== undefined)
          .map((entry, index) => <section className="source-detail" key={`${entry.name}:${index}`}><h3>{entry.name}</h3><Bonuses source={entry.bonuses!} /></section>)}
        <p className="muted small">面板还包含境界、熟练、灵髓、气运及当前药效的结算影响。</p></>}
      {skill && <><div className="detail-number">{skill.level}<small> / {SKILLS[skill.id].max}级</small></div>
        <p>{skillDescriptions[skill.id]}</p>
        {skill.bonusGroups.map(group => <section className="source-detail" key={group.bonuses.id}>
          <div className="section-line"><h3>{group.label}</h3>
            <span className={`small ${group.active ? 'positive' : 'muted'}`}>{group.active ? '生效中' : '未生效'}</span></div>
          <Bonuses source={group.bonuses} />
        </section>)}
        {decimal(skill.experienceMultiplier).gt(1) && <section className="source-detail">
          <h3>常驻加成</h3><p className="positive">战斗与清理修为、技能熟练获取 ×{formatAmount(skill.experienceMultiplier)}</p>
        </section>}
        {decimal(skill.domainExperienceMultiplier).gt(1) && <section className="source-detail">
          <h3>领域专属加成</h3><p className="positive">领域熟练另乘 ×{formatAmount(skill.domainExperienceMultiplier)}</p>
        </section>}
        {skill.masteryBonuses.length > 0 && <section className="source-detail">
          <h3>关联技能熟练加成</h3>
          <div className="bonus-lines">{skill.masteryBonuses.map(entry => <span className="positive" key={entry.id}>
            {entry.name}<b>×{formatAmount(entry.multiplier)}</b></span>)}</div>
        </section>}
        {skill.nextThreshold ? <><Meter label="累计熟练" value={skill.xp} max={skill.nextThreshold} />
          <p className="muted">距下一级 {formatAmount(decimal(skill.nextThreshold).minus(skill.xp).toFixed())} 熟练</p></> : <><p className="positive">此艺已圆满</p><p>累计熟练 {formatAmount(skill.xp)}</p></>}</>}
      {detail.kind === 'fate' && <section className={`fate-section ${game.fate.tier}`}><Sparkles size={30} /><div><span className="eyebrow">{game.fate.tierName}</span>
        <h2>{game.fate.name}</h2><p className="flavor">{game.fate.description}</p><p>{game.fate.effectDescription}</p></div></section>}
      {detail.kind === 'effects' && game.effects.map(effect => <section className="source-detail" key={effect.id}>
        <div className="section-line"><h3>{effect.name}</h3><span className="muted small">{duration(String(Math.max(0, Math.ceil((effect.expiresAt - game.clockMs) / 1000))))}</span></div>
        {effect.description && <p>{formatNumericText(effect.description)}</p>}
        <Bonuses source={effect.source} /></section>)}
      {detail.kind === 'marrow' && <><dl className="attribute-grid">{Object.entries(game.marrow).map(([key, value]) => <div key={key}>
        <dt>{{ attack: '增攻', defense: '增防', agility: '增敏', maxHp: '增血' }[key]}</dt><dd>+{formatAmount(value)}</dd></div>)}</dl>
        {absorption.unlocked && <><p>化悟值 {formatAmount(absorption.points)} · 技能经验 ×{formatAmount(absorption.currentMultiplier)}</p>
          {absorb ? <><p className="negative">消耗以下全部灵髓，仅增加化悟值，不增加属性。</p>
            <div className="recipe-materials">{absorption.materials.map(item => <div key={item.itemId}><span>{item.name}</span><strong>×{formatAmount(item.quantity)}</strong></div>)}</div>
            <p>化悟值 +{formatAmount(absorption.gained)} · 技能经验 ×{formatAmount(absorption.nextMultiplier)}</p>
            <button className="primary" disabled={blocked || !absorption.materials.length} onClick={async () => { if (await command({ type: 'absorb-marrow' })) setAbsorb(false); }}><Check size={16} />确认化悟</button></>
            : <button disabled={blocked || !absorption.materials.length} onClick={() => setAbsorb(true)}><Gem size={16} />灵髓化悟</button>}</>}</>}
    </Dialog>}
  </aside>;
}
