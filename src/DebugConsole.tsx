import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUp, BookOpen, Check, Coins, Flame, Flag, Gem, Heart, MapPin, PackagePlus, Search, Sparkles, Unlock } from 'lucide-react';
import { ITEMS, REGIONS, SAFE_LOCATIONS } from '../core/prototype/content';
import { DEBUG_INSTANCE_LIMIT, DEBUG_STACK_LIMIT, type DebugCommand } from '../core/prototype/debug';
import { FOUNDATION_ROOTS, type FoundationRoot } from '../core/prototype/foundation';
import { FATES, FATE_IDS, FATE_TIERS, type FateId } from '../core/prototype/fates';
import { FURNACES, type FurnaceTier } from '../core/prototype/furnace';
import { FOUNDATION_LEVEL, LEVEL_CAP, realmAt, realmName } from '../core/prototype/growth';
import { SKILLS, SKILL_IDS, type SkillId } from '../core/prototype/skills';
import type { OpeningView } from '../shared/opening-contracts';
import { decimal, formatAmount } from './format';

interface Props {
  game: OpeningView;
  blocked: boolean;
  command: (command: DebugCommand) => Promise<boolean>;
  preview?: boolean;
  issue?: string;
}
const itemKinds = { material: '材料', food: '补给', marrow: '灵髓', insight: '修为用品', 'foundation-pill': '筑基丹', 'meditation-kit': '静修套件', part: '炼材', equipment: '装备' } as const;
const tabs = [
  { id: 'growth', label: '成长', Icon: Sparkles }, { id: 'items', label: '物资', Icon: PackagePlus },
  { id: 'skills', label: '修习', Icon: BookOpen }, { id: 'map', label: '地图', Icon: MapPin },
] as const;

function Picker({ label, value, options, onChange }: {
  label: string; value: string; options: { id: string; label: string; detail?: string }[]; onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const choices = options.filter(option => `${option.label} ${option.detail ?? ''}`.includes(search.trim()));
  return <div className="debug-picker">
    <label className="debug-search"><Search size={15} /><input type="search" aria-label={`搜索${label}`}
      placeholder={`搜索${label}`} value={search} onChange={event => setSearch(event.target.value)} /></label>
    <div className="debug-options" role="group" aria-label={label}>
      {choices.map(option => <button key={option.id} type="button" aria-pressed={option.id === value}
        className={option.id === value ? 'selected' : ''} onClick={() => onChange(option.id)}>
        <span>{option.label}</span>{option.detail && <small>{option.detail}</small>}
        {option.id === value && <Check size={14} />}
      </button>)}
      {!choices.length && <p className="muted small">无匹配条目</p>}
    </div>
  </div>;
}

function AmountField({ label, value, onChange, presets }: {
  label: string; value: string; onChange: (value: string) => void; presets: { label: string; value: string }[];
}) {
  return <label className="debug-amount">{label}
    <input type="text" aria-label={label} inputMode="decimal" pattern="(0|[1-9][0-9]*)(\.[0-9]+)?" required maxLength={1000}
      value={value} onChange={event => onChange(event.target.value)} />
    <span className="debug-presets">{presets.map(preset =>
      <button type="button" key={preset.value} onClick={() => onChange(preset.value)}>{preset.label}</button>)}</span>
  </label>;
}

export default function DebugConsole({ game, blocked, command, preview = false, issue }: Props) {
  const [tab, setTab] = useState<typeof tabs[number]['id']>('growth');
  const [realm, setRealm] = useState(Math.min(LEVEL_CAP, game.level + 1));
  const [root, setRoot] = useState<FoundationRoot>('human');
  const [cultivation, setCultivation] = useState('1000000');
  const [fateId, setFateId] = useState<FateId>(game.fate.id);
  const [money, setMoney] = useState('1000');
  const [insight, setInsight] = useState('100');
  const [furnace, setFurnace] = useState<FurnaceTier>(game.workshop.tier === 0 ? 2 : 4);
  const [itemId, setItemId] = useState(Object.keys(ITEMS)[0]);
  const [kind, setKind] = useState('all');
  const [quantity, setQuantity] = useState('10');
  const [quality, setQuality] = useState('100');
  const [skillId, setSkillId] = useState<SkillId>(game.skills[0].id);
  const [skillLevel, setSkillLevel] = useState(String(game.skills[0].level + 1));
  const [skillXp, setSkillXp] = useState('1000000');
  const [regionId, setRegionId] = useState((game.regions.find(region => !region.completed) ?? game.regions[0]).id);
  const [locationId, setLocationId] = useState(Object.keys(SAFE_LOCATIONS)[0]);
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const item = ITEMS[itemId];
  const instanced = item.kind === 'equipment' || item.kind === 'part';
  const skill = game.skills.find(skill => skill.id === skillId);
  const region = game.regions.find(region => region.id === regionId);
  const targetRealm = Math.max(realm, Math.min(LEVEL_CAP, game.level + 1));
  const targetFurnace = Math.max(furnace, game.workshop.tier === 0 ? 2 : 4) as FurnaceTier;
  useEffect(() => {
    setSkillLevel(String(Math.min(SKILLS[skillId].max, (skill?.level ?? 0) + 1)));
  }, [skillId, skill?.level]);
  const run = async (action: DebugCommand) => {
    if (running || blocked) return;
    setRunning(true);
    setResult('');
    try {
      const success = await command(action);
      setResult(success ? preview ? '已更新预览角色' : '已保存测试改动' : '操作未执行');
    } finally { setRunning(false); }
  };
  const submit = (event: FormEvent, action: DebugCommand) => { event.preventDefault(); void run(action); };
  const selectKind = (id: string) => {
    setKind(id);
    if (id !== 'all' && item.kind !== id) {
      const entry = Object.entries(ITEMS).find(([, item]) => item.kind === id);
      if (entry) { setItemId(entry[0]); setQuantity('1'); }
    }
  };

  return <section id="debug-console" className="debug-console" aria-label="测试控制台">
    <p className="cost-warning">{preview ? '仅修改内存预览，不写存档。' : '改动写入当前角色存档，不可撤销。'}</p>
    {game.history.testAssisted && <div className="debug-actions">
      <button type="button" disabled={blocked || running} onClick={() => void run({ type: 'clear-test-marker' })}>
        <Check size={15} />清除旧测试标记</button>
    </div>}
    <div className="debug-summary"><span>{game.realmName}</span><span>{game.fate.name}</span><span>{game.workshop.name}</span>
      <button type="button" disabled={blocked || running} onClick={() => void run({ type: 'heal' })}><Heart size={15} />气血回满</button></div>
    <div className="debug-tabs" role="tablist" aria-label="控制台分类">
      {tabs.map(({ id, label, Icon }, index) => <button key={id} id={`debug-tab-${id}`} type="button" role="tab"
        aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
        aria-controls={`debug-${id}`} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          setTab(tabs[next].id);
          document.getElementById(`debug-tab-${tabs[next].id}`)?.focus();
        }}>
        <Icon size={15} />{label}</button>)}
    </div>
    <p className="debug-result" role="status">{running ? '正在处理' : result === '操作未执行' ? issue ?? result : result}</p>
    <fieldset disabled={blocked || running} className="debug-controls" id={`debug-${tab}`} role="tabpanel"
      aria-labelledby={`debug-tab-${tab}`}>
      <legend className="sr-only">测试操作</legend>
      {tab === 'growth' && <>
        <form className="debug-row" onSubmit={event => submit(event, {
          type: 'realm', level: targetRealm, ...(game.level < FOUNDATION_LEVEL && targetRealm >= FOUNDATION_LEVEL ? { root } : {}),
        })}>
          <label>目标境界<select value={targetRealm} onChange={event => setRealm(Number(event.target.value))}>
            {Array.from({ length: LEVEL_CAP }, (_, index) => index + 1).map(level =>
              <option key={level} value={level} disabled={level <= game.level}>{realmName(level)}</option>)}
          </select></label>
          {game.level < FOUNDATION_LEVEL && targetRealm >= FOUNDATION_LEVEL && <label>筑基方式
            <select value={root} onChange={event => setRoot(event.target.value as FoundationRoot)}>
              {Object.entries(FOUNDATION_ROOTS).map(([id, root]) => <option key={id} value={id}>{root.name}</option>)}
            </select></label>}
          <button type="submit" disabled={game.level >= LEVEL_CAP}><ArrowUp size={16} />提升境界</button>
        </form>
        <form className="debug-row" onSubmit={event => submit(event, { type: 'cultivation', amount: cultivation })}>
          <AmountField label="追加修为" value={cultivation} onChange={setCultivation} presets={[
            { label: '100万', value: '1000000' }, { label: '1亿', value: '100000000' }, { label: '100亿', value: '10000000000' },
          ]} />
          {game.level < LEVEL_CAP && <button type="button" onClick={() => {
            const remaining = decimal(realmAt(game.level + 1).entryCost).minus(game.cultivation);
            setCultivation(remaining.gt(0) ? remaining.toFixed() : '0');
          }}>下一境界所需</button>}
          <button type="submit"><ArrowUp size={16} />增加修为</button>
        </form>
        <div className="debug-section"><h3>本世气运 · 当前 {game.fate.name}</h3>
          <Picker key="fate" label="气运" value={fateId} onChange={id => setFateId(id as FateId)} options={FATE_IDS.map(id =>
            ({ id, label: FATES[id].name, detail: `${FATE_TIERS[FATES[id].tier].name} · ${FATES[id].effectDescription}` }))} />
          <div className="debug-actions"><button type="button" disabled={fateId === game.fate.id}
            onClick={() => void run({ type: 'fate', fateId })}><Sparkles size={16} />更换为{FATES[fateId].name}</button></div>
        </div>
        <form className="debug-row" onSubmit={event => submit(event, { type: 'insight', amount: insight })}>
          <AmountField label={`追加化悟值 · 当前 ${formatAmount(game.marrowAbsorption.points)}`} value={insight} onChange={setInsight}
            presets={[{ label: '100', value: '100' }, { label: '1万', value: '10000' }, { label: '100万', value: '1000000' }]} />
          <button type="submit" disabled={game.level < FOUNDATION_LEVEL}><Gem size={16} />增加化悟值</button>
        </form>
        <form className="debug-row" onSubmit={event => submit(event, { type: 'furnace', tier: targetFurnace })}>
          <label>目标炉鼎<select value={targetFurnace} onChange={event => setFurnace(Number(event.target.value) as FurnaceTier)}>
            {([2, 4] as const).map(tier => <option key={tier} value={tier} disabled={tier <= game.workshop.tier}>{FURNACES[tier].name}</option>)}
          </select></label>
          <button type="submit" disabled={targetFurnace <= game.workshop.tier}><Flame size={16} />提升炉鼎</button>
        </form>
      </>}
      {tab === 'items' && <>
        <form className="debug-row" onSubmit={event => submit(event, { type: 'money', amount: Number(money) })}>
          <AmountField label={`追加灵石 · 当前 ${formatAmount(game.money)}`} value={money} onChange={setMoney} presets={[
            { label: '1000', value: '1000' }, { label: '100万', value: '1000000' }, { label: '1亿', value: '100000000' },
          ]} />
          <button type="submit"><Coins size={16} />增加灵石</button>
        </form>
        <div className="debug-section"><h3>发放物品</h3>
          <div className="debug-filters"><button type="button" aria-pressed={kind === 'all'} onClick={() => selectKind('all')}>全部</button>
            {Object.entries(itemKinds).map(([id, name]) => <button key={id} type="button" aria-pressed={kind === id}
              onClick={() => selectKind(id)}>{name}</button>)}</div>
          <Picker key="item" label="物品" value={itemId} onChange={id => { setItemId(id); setQuantity('1'); }}
            options={Object.entries(ITEMS).filter(([, item]) => kind === 'all' || item.kind === kind)
              .map(([id, item]) => ({ id, label: item.name, detail: itemKinds[item.kind] }))} />
          <form className="debug-row" onSubmit={event => submit(event, {
            type: 'item', itemId, quantity: Number(quantity), quality: instanced ? Number(quality) : 100,
          })}>
            <label>数量 · {item.name}<input type="number" min={1} max={instanced ? DEBUG_INSTANCE_LIMIT : DEBUG_STACK_LIMIT}
              step={1} required value={quantity} onChange={event => setQuantity(event.target.value)} />
              <span className="debug-presets">{[1, 10, instanced ? 100 : 1000].map(value =>
                <button key={value} type="button" onClick={() => setQuantity(String(value))}>{value}</button>)}</span></label>
            {instanced && <label>品质<input type="number" min={10} max={999} step={1} required value={quality}
              onChange={event => setQuality(event.target.value)} />
              <span className="debug-presets">{[100, 150, 300].map(value =>
                <button key={value} type="button" onClick={() => setQuality(String(value))}>{value}</button>)}</span></label>}
            <button type="submit"><PackagePlus size={16} />发放{item.name}</button>
          </form>
        </div>
      </>}
      {tab === 'skills' && <div className="debug-section"><h3>技能与功法</h3>
        <Picker key="skill" label="技能 / 功法" value={skillId} onChange={id => setSkillId(id as SkillId)} options={SKILL_IDS.map(id => {
          const skill = game.skills.find(skill => skill.id === id);
          return { id, label: SKILLS[id].name, detail: skill ? `${skill.level} / ${SKILLS[id].max}级 · 累计${formatAmount(skill.xp)}` : '未取得' };
        })} />
        {!skill ? <div className="debug-actions"><button type="button" onClick={() => void run({ type: 'learn-skill', skillId })}>
          <Unlock size={16} />补前置并取得{SKILLS[skillId].name}</button></div> : <>
          <form className="debug-row" onSubmit={event => submit(event, { type: 'skill', skillId, level: Number(skillLevel) })}>
            <label>{skill.name}目标等级<input type="number" min={skill.level + 1} max={SKILLS[skillId].max} step={1}
              required value={skillLevel} onChange={event => setSkillLevel(event.target.value)} /></label>
            <button type="button" disabled={skill.level >= SKILLS[skillId].max} onClick={() => setSkillLevel(String(SKILLS[skillId].max))}>设为满级</button>
            <button type="submit" disabled={skill.level >= SKILLS[skillId].max}><ArrowUp size={16} />提升熟练度</button>
          </form>
          <form className="debug-row" onSubmit={event => submit(event, { type: 'skill-xp', skillId, amount: skillXp })}>
            <AmountField label="追加累计熟练" value={skillXp} onChange={setSkillXp} presets={[
              { label: '100万', value: '1000000' }, { label: '1亿', value: '100000000' }, { label: '1万亿', value: '1000000000000' },
            ]} />
            <button type="submit"><BookOpen size={16} />增加熟练</button>
          </form>
        </>}
      </div>}
      {tab === 'map' && <>
        <div className="debug-section"><h3>历练进度</h3>
          <Picker key="region" label="历练地点" value={regionId} onChange={setRegionId} options={Object.entries(REGIONS).map(([id, definition]) => {
            const progress = game.regions.find(region => region.id === id);
            return { id, label: definition.name, detail: progress?.completed ? '已完成' : progress ? '已开放' : '未开放' };
          })} />
          <div className="debug-actions">
            <button type="button" onClick={() => void run({ type: 'region', regionId, operation: 'open' })}><Unlock size={16} />补前置并前往</button>
            <button type="button" disabled={region?.completed} onClick={() => void run({ type: 'region', regionId, operation: 'complete' })}><Flag size={16} />跳过并完成</button>
          </div>
        </div>
        <div className="debug-section"><h3>安全地点</h3>
          <Picker key="location" label="安全地点" value={locationId} onChange={setLocationId}
            options={Object.entries(SAFE_LOCATIONS).map(([id, location]) => ({ id, label: location.name }))} />
          <div className="debug-actions"><button type="button" onClick={() => void run({ type: 'travel', locationId })}>
            <MapPin size={16} />补前置并传送</button></div>
        </div>
      </>}
    </fieldset>
  </section>;
}
