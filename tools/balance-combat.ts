import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { combatProfile } from '../core/combat-candidate';
import { economyProfile } from '../core/economy-candidate';
import { techniqueProfile } from '../core/technique-candidate';
import { loadoutProfile } from '../core/loadout-candidate';
import {
  firstSession, combatPreparation, combatWindow, switchCombatTechnique, sessionOrders,
  challengePreparation, challengeTrials,
  type SessionOrder, type StaffPolicy,
} from '../core/combat-scenarios';
import { equipmentPaths, type EquipmentPath } from '../core/equipment-scenarios';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = arg('mode') ?? 'session';
if (!['session', 'combat', 'investment', 'sustain', 'challenge'].includes(mode)) throw new Error('未知测算模式');
const ordered = mode === 'investment' || mode === 'sustain' || mode === 'challenge';
const seed = Number(arg('seed') ?? 1);
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('非法种子');
const paths = arg('path') ? [arg('path') as EquipmentPath] : Object.keys(equipmentPaths) as EquipmentPath[];
if (paths.some((path) => !equipmentPaths[path])) throw new Error('未知路线');
const baseline = arg('baseline') ?? 'loadout';
if (!['economy', 'combat', 'technique', 'dual', 'loadout'].includes(baseline)) throw new Error('未知候选配置');
const content = baseline === 'loadout' ? loadoutProfile() : baseline === 'economy' ? economyProfile()
  : baseline === 'technique' || baseline === 'dual' ? techniqueProfile() : combatProfile();
const duration = Number(arg('duration') ?? (mode === 'challenge' ? 3600 : 1800));
if (!Number.isSafeInteger(duration) || duration < 1 || duration > 3600) throw new Error('短时测算须在 1 至 3600 秒内');
const policy = arg('policy') ?? (baseline === 'loadout' ? 'both' : 'weapon-only');
if (!['weapon-only', 'distributed', 'both'].includes(policy) || (baseline !== 'loadout' && policy !== 'weapon-only')) {
  throw new Error('多部位投入须使用 loadout 候选');
}
const techniqueId = arg('technique');
if (techniqueId && (mode !== 'session' || !content.techniques.some((t) => t.id === techniqueId && t.manualItemId))) {
  throw new Error('仅短时路线可指定有书册来源的功法');
}
if (mode === 'combat' && !content.settings.manaSupply) throw new Error('战斗对照须支持回灵补给');
if (ordered && (baseline !== 'loadout' || arg('policy') || techniqueId)) {
  throw new Error('有序投入仅支持 loadout，使用 order/staff/mana-limit/reserve 参数，不混用旧 policy/technique');
}
const orders = (arg('order') ? arg('order')!.split(',') :
  mode === 'challenge' ? ['weapon-first'] : Object.keys(sessionOrders)) as SessionOrder[];
const staffPolicy = (arg('staff') ?? 'low') as StaffPolicy;
const manaPurchaseLimit = Number(arg('mana-limit') ?? (mode === 'challenge' || staffPolicy !== 'low' ? 2 : 0));
const reserveStones = Number(arg('reserve') ?? 0);
if (!ordered && ['order', 'staff', 'mana-limit', 'reserve'].some((name) => arg(name) !== undefined)) {
  throw new Error('order/staff/mana-limit/reserve 仅用于 investment/sustain');
}
const growthPolicy = arg('growth') ?? 'available';
const upgradeWindowSeconds = Number(arg('window') ?? 300);
const compareAtEnd = arg('compare-end') ?? 'false';
const challengeLevel = Number(arg('level') ?? 4);
const challengeFights = Number(arg('fights') ?? 5);
const challengeRegions = (arg('regions') ?? 'quarry,pool,ruins').split(',');
if (mode === 'challenge') {
  if (['staff', 'reserve', 'growth', 'window', 'compare-end'].some((name) => arg(name) !== undefined) ||
      orders.length !== 1 || !Number.isSafeInteger(challengeLevel) || challengeLevel < 3 || challengeLevel > 12 ||
      !Number.isSafeInteger(challengeFights) || challengeFights < 1 || challengeFights > 20 ||
      challengeRegions.some((id) => !content.regions.some((r) => r.id === id))) throw new Error('挑战准备或目标参数非法');
} else if (['level', 'fights', 'regions'].some((name) => arg(name) !== undefined)) {
  throw new Error('level/fights/regions 仅用于 challenge');
}
if ((mode !== 'sustain' && (arg('growth') || arg('window') || arg('compare-end'))) ||
    !['true', 'false'].includes(compareAtEnd) ||
    !['none', 'available'].includes(growthPolicy) || !Number.isSafeInteger(upgradeWindowSeconds) ||
    upgradeWindowSeconds < 0 || upgradeWindowSeconds > 3600) throw new Error('growth/window 仅用于 sustain，窗口须为 0 至 3600 秒');
if (orders.some((order) => !sessionOrders[order]) || !['low', 'high', 'supplied'].includes(staffPolicy) ||
    !Number.isSafeInteger(manaPurchaseLimit) || manaPurchaseLimit < 0 || manaPurchaseLimit > 1000 ||
    !Number.isSafeInteger(reserveStones) || reserveStones < 0) throw new Error('有序投入参数非法');
const sessions = [];
const preparations = [];
const windows = [];
const mixed = [];
const challenges = [];
for (const path of paths) {
  if (mode === 'challenge') {
    const prepared = challengePreparation(content, path, seed, challengeLevel, duration, orders[0], manaPurchaseLimit);
    sessions.push(prepared.report);
    for (const region of challengeRegions) {
      for (const technique of path === 'staff' ? ['kindling', 'flame'] : [equipmentPaths[path].technique]) {
        for (const stock of path === 'staff' ? [...new Set([0, manaPurchaseLimit])] : [0]) {
          challenges.push({ path, ...challengeTrials(content, prepared.state, technique, region, challengeFights, stock) });
        }
      }
    }
  } else if (ordered) {
    for (const order of orders) {
      sessions.push(firstSession(content, path, seed, duration, undefined, 'ordered', {
        order, staffPolicy, manaPurchaseLimit, reserveStones,
        ...(mode === 'sustain' ? {
          travelPolicy: 'attrition' as const, growthPolicy: growthPolicy as 'none' | 'available', upgradeWindowSeconds,
          compareAtEnd: compareAtEnd === 'true',
        } : {}),
      }));
    }
  } else if (mode === 'session') {
    for (const strategy of policy === 'both' ? ['weapon-only', 'distributed'] as const : [policy as 'weapon-only' | 'distributed']) {
      sessions.push(firstSession(content, path, seed, duration, techniqueId, strategy));
    }
  }
  else {
    const prepared = combatPreparation(content, path, seed);
    preparations.push(prepared.summary);
    for (const region of ['quarry', 'ruins']) {
      for (const manaStock of path === 'staff' ? [0, 20, 120] : [0]) {
        windows.push({ path, ...combatWindow(content, prepared.state, region, manaStock) });
      }
    }
    if (path === 'gauntlet' && arg('mix') === 'true') {
      const variant = switchCombatTechnique(content, prepared.state, 'flame');
      mixed.push({
        path, preparation: variant.preparation,
        ...combatWindow(content, variant.state, 'ruins', 120),
      });
    }
  }
}
const report = {
  scope: 'Role and short-session candidate; paid preparation; no injected progression; no balance acceptance',
  ...(ordered && mode !== 'challenge' ? {
    scenarioVersion: mode === 'sustain' ? 'sustain-session.2' : 'ordered-session.2',
    policy: {
      equipment: 'Strict order; reserve is a cash floor for extras before the second weapon, removed after that weapon.',
      manuals: 'All routes buy and learn the advanced manual after bamboo first clear, before further equipment spending.',
      staff: 'Low keeps kindling; high keeps flame; supplied chooses flame only when a mana pill remains at departure.',
      supply: 'One purchase after learning, capped by mana-limit and current cash; no refill; low disables mana supply.',
      travel: mode === 'sustain'
        ? 'Active trips: rest to full; return below 25% HP, before an unfunded cast, or after a kill when first clear/purchase/growth management is ready. No fixed kill/time cap; defeat ends the route.'
        : 'Active trips: rest to full, at most 5 kills/60 seconds, retreat below 25% HP; defeat ends the route.',
      growth: mode === 'sustain' ? `${growthPolicy}; reserve next unlocked equipment and explicit purchase goals before crafting` : 'none',
      equipmentComparison: mode === 'sustain'
        ? `At each paid acquisition${compareAtEnd === 'true' ? ' and session-end weapon/accessory' : ''}: same-origin old/new slot, independently rest to full, no supplies, up to ${upgradeWindowSeconds}s; stop on defeat. Branch time/drop gains do not feed the main route.`
        : 'Panel snapshots only.',
      exclusions: 'No dwelling investment, second armor, overnight policy, or optimal-route claim.',
    },
  } : {}),
  ...(mode === 'challenge' ? {
    scenarioVersion: 'challenge-cycle.2',
    policy: {
      preparation: 'Paid ordered loadout and manual, actual available growth pills; staff earns cash for mana-limit before comparison. Meditate only if below requested level. No injected stats, practice, inventory, or enemy selection.',
      fights: 'Natural encounters; one kill then full recovery, up to fights or 120s per enemy. Stop on defeat or player level change. Not an optimal continuous farming policy.',
      supplies: 'No HP supply; staff low/high each compare zero mana supply with a real purchase up to mana-limit, limited by cash; no refills.',
      growth: 'Preparation consumes actual production; challenge drops remain in inventory. Independent branches do not feed preparation.',
    },
  } : {}),
  mode, seed, contentVersion: content.version, rulesVersion: content.rulesVersion, schemaVersion: content.schemaVersion,
  contentHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
  sessions, preparations, windows, mixed, challenges,
};
if (arg('output')) {
  const output = resolve(arg('output')!);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
}
const rate = (count: number, seconds: number, scale: number) =>
  seconds > 0 ? Number((count * scale / seconds).toFixed(2)) : null;
const header = {
  mode, seed, contentVersion: content.version, rulesVersion: content.rulesVersion,
  contentHash: report.contentHash,
  ...(arg('output') ? { report: resolve(arg('output')!) } : {}),
};
const sessionSummaries = sessions.map((s) => {
  const growthPills = content.items.filter((item) => item.use?.kind === 'growth').map((item) => {
    const received = (type: 'buy' | 'craft') => s.ledger.transactions.reduce((sum, entry) => {
      const delta = BigInt(entry.inventory[item.id] ?? '0');
      return sum + (entry.command.type === type && delta > 0n ? delta : 0n);
    }, 0n).toString();
    return {
      id: item.id, starter: content.settings.starterItems[item.id] ?? '0',
      dropped: s.ledger.drops[item.id] ?? '0', bought: received('buy'), crafted: received('craft'),
      consumed: String(s.growthConsumed[item.id] ?? 0), remaining: s.end.inventory[item.id] ?? '0',
    };
  }).filter(({ id, ...counts }) => Object.values(counts).some((count) => BigInt(count) > 0n));
  const spentStones = s.ledger.transactions.reduce((sum, entry) =>
    sum + (BigInt(entry.stones) < 0n ? -BigInt(entry.stones) : 0n), 0n).toString();
  return {
    path: s.path, policy: s.loadoutPolicy, strategy: s.strategy, seconds: s.end.atSeconds,
    kills: s.end.kills, times: s.end.times,
    restPercent: rate(s.end.times.idle, s.end.atSeconds, 100),
    combatCycleRestPercent: rate(s.end.times.idle, s.end.times.idle + s.end.times.dungeon, 100),
    killsPerCombatMinute: rate(Number(s.end.kills), s.end.times.dungeon, 60),
    stones: { earned: s.ledger.earnedStones, spent: spentStones, remaining: s.end.stones },
    growthPills, suppliesConsumed: s.ledger.consumed, stop: s.stop,
    materialDrops: Object.fromEntries(content.items.filter((item) =>
      item.kind === 'material' && s.ledger.drops[item.id]).map((item) => [item.id, s.ledger.drops[item.id]])),
    equipmentAcquired: s.upgrades.map((upgrade) => ({ id: upgrade.equipmentId, seconds: upgrade.atSeconds })),
    growth: s.end.growth, level: s.end.level, equipped: s.end.equipped,
    proficiencies: s.end.proficiencies, crafting: s.end.crafting,
    commandCount: s.commandCount, commandHash: s.commandHash, stateHash: s.stateHash,
    verified: { replay: s.replayVerified, ledger: s.ledger.reconciled, time: s.timeReconciled },
  };
});
const windowSummaries = [...windows, ...mixed].map((w) => ({
  path: w.path, regionId: w.regionId, manaStock: w.manaStock,
  purchaseCost: w.purchaseCost, result: w.snapshots.at(-1),
}));
const challengeSummaries = challenges.map((c) => ({
  path: c.path, technique: c.techniqueId, region: c.regionId, level: c.playerLevel,
  manaBought: c.manaBought, manaUsed: c.suppliesUsed[content.settings.manaSupply!.itemId] ?? '0',
  kills: c.kills, seconds: c.times, cultivation: c.cultivation, stones: c.earnedStones,
  outcomes: c.groups.map((g) => ({
    enemy: g.enemyId, enemyLevel: g.enemyLevel, rank: g.rank, gap: g.levelGap, attempts: g.attempts, wins: g.wins,
    meanSeconds: Number((g.seconds / g.attempts).toFixed(2)), minHpPercent: Number(g.minHpPercent.toFixed(1)),
    fallbacks: g.fallbacks,
  })),
  originStateHash: c.originStateHash, stateHash: c.stateHash,
  stop: c.stop, verified: c.replayVerified && c.ledgerReconciled,
}));
if (arg('summary-output')) {
  const output = resolve(arg('summary-output')!);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({
    ...header, scope: report.scope, schemaVersion: report.schemaVersion,
    scenarioVersion: report.scenarioVersion, policy: report.policy,
    sessions: sessionSummaries, windows: windowSummaries, challenges: challengeSummaries,
  }, null, 2) + '\n', 'utf8');
}
console.log(JSON.stringify(header));
for (const row of [...sessionSummaries, ...windowSummaries, ...challengeSummaries]) console.log(JSON.stringify(row));
