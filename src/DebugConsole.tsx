import { useState, type FormEvent } from 'react';
import { ArrowUp, Coins, Flag, Heart, MapPin, PackagePlus, Unlock } from 'lucide-react';
import { ITEMS, REGIONS, SAFE_LOCATIONS } from '../core/prototype/content';
import { DEBUG_INSTANCE_LIMIT, DEBUG_STACK_LIMIT, type DebugCommand } from '../core/prototype/debug';
import { FOUNDATION_LEVEL, LEVEL_CAP, realmName } from '../core/prototype/growth';
import { SKILLS, type SkillId } from '../core/prototype/skills';
import type { OpeningView } from '../shared/opening-contracts';

interface Props {
  game: OpeningView;
  blocked: boolean;
  command: (command: DebugCommand) => Promise<boolean>;
  preview?: boolean;
}
const itemKinds = { material: '材料', food: '补给', marrow: '灵髓', insight: '修为用品', 'foundation-pill': '筑基丹', part: '炼材', equipment: '装备' } as const;

export default function DebugConsole({ game, blocked, command, preview = false }: Props) {
  const [realm, setRealm] = useState(Math.min(LEVEL_CAP, game.level + 1));
  const [money, setMoney] = useState('1000');
  const [itemId, setItemId] = useState(Object.keys(ITEMS)[0]);
  const [quantity, setQuantity] = useState('10');
  const [quality, setQuality] = useState('100');
  const [skillId, setSkillId] = useState<SkillId>(game.skills[0].id);
  const [skillLevel, setSkillLevel] = useState(String(game.skills[0].level + 1));
  const [regionId, setRegionId] = useState((game.regions.find(region => !region.completed) ?? game.regions[0]).id);
  const [locationId, setLocationId] = useState(Object.keys(SAFE_LOCATIONS)[0]);
  const [result, setResult] = useState('');
  const item = ITEMS[itemId];
  const instanced = item.kind === 'equipment' || item.kind === 'part';
  const skill = game.skills.find(skill => skill.id === skillId)!;
  const region = game.regions.find(region => region.id === regionId);
  const targetRealm = Math.max(realm, Math.min(LEVEL_CAP, game.level + 1));
  const run = async (action: DebugCommand) => {
    setResult('');
    setResult(await command(action) ? preview ? '已更新预览角色' : '已保存测试改动' : '未执行，请查看操作提示');
  };
  const submit = (event: FormEvent, action: DebugCommand) => {
    event.preventDefault();
    void run(action);
  };

  return <section id="debug-console" className="debug-console" aria-labelledby="debug-title">
    <div className="section-heading compact">
      <h2 id="debug-title">测试控制台</h2>
      <span className="muted">开发模式</span>
    </div>
    <p className="cost-warning">{preview ? '仅修改内存中的预览角色，不写入存档。' : '修改将写入当前角色存档并参与云备份，不可撤销。'}</p>
    <fieldset disabled={blocked} className="debug-controls">
      <legend className="sr-only">测试操作</legend>
      <form className="debug-row" onSubmit={event => submit(event, { type: 'realm', level: targetRealm })}>
        <label>境界
          <select value={targetRealm} onChange={event => setRealm(Number(event.target.value))}>
            {Array.from({ length: LEVEL_CAP }, (_, index) => index + 1).map(level =>
              <option key={level} value={level} disabled={level <= game.level}>{realmName(level)}{level === FOUNDATION_LEVEL ? '（人道）' : ''}</option>)}
          </select>
        </label>
        <button type="submit" disabled={game.level >= LEVEL_CAP}><ArrowUp size={16} />提升境界</button>
        <button type="button" onClick={() => void run({ type: 'heal' })}><Heart size={16} />气血回满</button>
      </form>

      <form className="debug-row" onSubmit={event => submit(event, { type: 'money', amount: Number(money) })}>
        <label>增加灵石数量
          <input type="number" min={1} max={1_000_000_000_000} step={1} required value={money}
            onChange={event => setMoney(event.target.value)} />
        </label>
        <button type="submit"><Coins size={16} />增加灵石</button>
      </form>

      <form className="debug-row" onSubmit={event => submit(event, {
        type: 'item', itemId, quantity: Number(quantity), quality: instanced ? Number(quality) : 100,
      })}>
        <label className="debug-wide">物品
          <select value={itemId} onChange={event => setItemId(event.target.value)}>
            {Object.entries(itemKinds).map(([kind, name]) =>
              <optgroup key={kind} label={name}>
                {Object.entries(ITEMS).filter(([, item]) => item.kind === kind).map(([id, item]) =>
                  <option key={id} value={id}>{item.name}</option>)}
              </optgroup>)}
          </select>
        </label>
        <label>数量
          <input type="number" min={1} max={instanced ? DEBUG_INSTANCE_LIMIT : DEBUG_STACK_LIMIT} step={1} required
            value={quantity} onChange={event => setQuantity(event.target.value)} />
        </label>
        <label>品质
          <input type="number" min={10} max={999} step={1} required disabled={!instanced}
            value={quality} onChange={event => setQuality(event.target.value)} />
        </label>
        <button type="submit"><PackagePlus size={16} />发放物品</button>
      </form>

      <form className="debug-row" onSubmit={event => submit(event, { type: 'skill', skillId, level: Number(skillLevel) })}>
        <label className="debug-wide">已学技能 / 功法
          <select value={skillId} onChange={event => {
            const id = event.target.value as SkillId;
            setSkillId(id);
            setSkillLevel(String(Math.min(SKILLS[id].max, game.skills.find(skill => skill.id === id)!.level + 1)));
          }}>
            {game.skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name} · {skill.level}级</option>)}
          </select>
        </label>
        <label>目标等级（上限{SKILLS[skillId].max}）
          <input type="number" min={skill.level + 1} max={SKILLS[skillId].max} step={1} required
            value={skillLevel} onChange={event => setSkillLevel(event.target.value)} />
        </label>
        <button type="submit" disabled={skill.level >= SKILLS[skillId].max}><ArrowUp size={16} />提升熟练度</button>
      </form>

      <div className="debug-row">
        <label className="debug-wide">历练进度
          <select value={regionId} onChange={event => setRegionId(event.target.value)}>
            {Object.entries(REGIONS).map(([id, definition]) => {
              const progress = game.regions.find(region => region.id === id);
              return <option key={id} value={id}>
                {definition.name} · {progress?.completed ? '已完成' : progress ? '已开放' : '未开放'}
              </option>;
            })}
          </select>
        </label>
        <button type="button" onClick={() => void run({ type: 'region', regionId, operation: 'open' })}>
          <Unlock size={16} />补前置并前往</button>
        <button type="button" disabled={region?.completed} onClick={() => void run({ type: 'region', regionId, operation: 'complete' })}>
          <Flag size={16} />跳过并完成</button>
      </div>

      <form className="debug-row" onSubmit={event => submit(event, { type: 'travel', locationId })}>
        <label className="debug-wide">安全地点
          <select value={locationId} onChange={event => setLocationId(event.target.value)}>
            {Object.entries(SAFE_LOCATIONS).map(([id, location]) => <option key={id} value={id}>{location.name}</option>)}
          </select>
        </label>
        <button type="submit"><MapPin size={16} />补前置并传送</button>
      </form>
    </fieldset>
    <p className="debug-result" role="status">{result}</p>
  </section>;
}
