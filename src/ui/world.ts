import { REGIONS, SAFE_LOCATIONS } from '../../core/prototype/content';
import type { OpeningView } from '../../shared/opening-contracts';

// Presentation regions are not travel restrictions or unlock conditions.
export const AREAS = [
  { id: 'village', name: '槐溪群山', subtitle: '群山深处', locations: ['qingshi-village', 'village-outskirts', 'abandoned-road', 'stony-trail', 'hermit-stone-chamber'] },
  { id: 'ridge', name: '灰脊山道', subtitle: '越岭出山', locations: ['foothill-camp', 'mine-front', 'mine-tunnels', 'mine-depths', 'mountain-pass', 'serpent-ridge'] },
  { id: 'river', name: '石桥河谷', subtitle: '沧流江畔', locations: ['hillside-market', 'market-backstreets', 'kiln-alley', 'scripture-cave', 'market-gardens', 'market-outer-road', 'old-ferry-bank', 'stone-gate-pass'] },
  { id: 'city', name: '望川城域', subtitle: '江城与群峰', locations: ['cloudfoot-waystation', 'waystation-duel', 'reed-marsh', 'stone-training-ground', 'pine-ravine', 'stoneforge-hamlet', 'stonefang-wilds', 'thornwild-slope', 'baleful-valley', 'ruined-shrine-road', 'shrine-gate-duel'] },
  { id: 'courts', name: '涵岳前庭', subtitle: '旧院山门', locations: ['sunken-manor-entrance', 'seal-guardian-ring', 'manor-outer-court', 'rusted-corridor', 'puppet-court', 'buried-gallery', 'stone-root-court', 'sealed-vault', 'manor-seal-gate'] },
  { id: 'inner', name: '涵岳内院', subtitle: '山腹遗迹', locations: ['manor-inner-threshold', 'rootbound-passage', 'earthfire-platform', 'ruined-elixir-hall', 'edict-corridor', 'hidden-furnace-wall', 'earthvein-workroom', 'brood-cavern', 'relic-underchannel', 'heartward-path', 'manor-heart'] },
  { id: 'marsh', name: '百渠泽地', subtitle: '山背大泽', locations: ['forest-edge-camp', 'oldwood-edge', 'oldwood-fringe', 'condensing-spring-cavern'] },
  { id: 'uplands', name: '苍照山原', subtitle: '灵林与石原', locations: ['green-vine-hill', 'renewal-valley', 'windstone-uplands', 'cloudbreak-pass', 'redbanner-cliff', 'zhaoye-roadhead'] },
  { id: 'zhaoye', name: '照野江路', subtitle: '灵江与长洲', locations: ['whitebank-road', 'flowpetal-shallows', 'returning-current-bay', 'rosyreef-longshoal', 'crossriver-stone-flat', 'zhaoye-waterfall', 'linzhao-crossing'] },
];
export function areaFor(id: string) { return AREAS.find(area => area.locations.includes(id)) ?? AREAS[0]; }
export function knownAreas(game: OpeningView) {
  const ids = new Set([...game.destinations, ...game.regions].map(location => location.id));
  return AREAS.filter(area => area.locations.some(id => ids.has(id)));
}
export function prerequisite(id: string) { return (REGIONS[id] ?? SAFE_LOCATIONS[id])?.prerequisite ?? null; }

export interface MapPoint { x: number; y: number }
export interface MapCamera extends MapPoint { k: number; width: number; height: number }
export const AREA_CENTERS: Record<string, MapPoint> = {
  village: { x: 0, y: 0 }, ridge: { x: 1100, y: -650 }, river: { x: 2250, y: -250 },
  city: { x: 3450, y: -1050 }, courts: { x: 4750, y: -500 },
  inner: { x: 5900, y: -1400 }, marsh: { x: 7100, y: -750 },
  uplands: { x: 8250, y: -1500 },
  zhaoye: { x: 9400, y: -850 },
};
// Stable geographical positions, independent of which destinations have been revealed.
const LOCAL_POINTS: Record<string, [number, number]> = {
  'qingshi-village': [-290, 170], 'village-outskirts': [-240, -20],
  'abandoned-road': [0, -100], 'stony-trail': [260, -170], 'hermit-stone-chamber': [270, 80],
  'foothill-camp': [-330, 120], 'mine-front': [-150, -100], 'mine-tunnels': [60, -210],
  'mine-depths': [290, -250], 'mountain-pass': [30, 110], 'serpent-ridge': [300, 190],
  'hillside-market': [-320, 30], 'market-backstreets': [-300, -180], 'kiln-alley': [-60, -260],
  'scripture-cave': [190, -270], 'market-gardens': [-70, 0], 'market-outer-road': [170, 100],
  'old-ferry-bank': [390, -90], 'stone-gate-pass': [410, 210],
  'cloudfoot-waystation': [-400, 170], 'waystation-duel': [-460, -40], 'reed-marsh': [-250, -250],
  'stone-training-ground': [-20, -280], 'pine-ravine': [-140, 20], 'stoneforge-hamlet': [100, 160],
  'stonefang-wilds': [130, -60], 'thornwild-slope': [240, -300],
  'baleful-valley': [440, -170], 'ruined-shrine-road': [400, 60], 'shrine-gate-duel': [410, 300],
  'sunken-manor-entrance': [-380, 200], 'seal-guardian-ring': [-410, -30],
  'manor-outer-court': [-200, -190], 'rusted-corridor': [40, -290], 'puppet-court': [60, -70],
  'buried-gallery': [-70, 170], 'stone-root-court': [180, 230],
  'sealed-vault': [330, -250], 'manor-seal-gate': [340, 0],
  'manor-inner-threshold': [-430, 190], 'rootbound-passage': [-430, -40],
  'earthfire-platform': [-350, -280], 'ruined-elixir-hall': [-120, 70],
  'edict-corridor': [-100, -180], 'hidden-furnace-wall': [100, -360],
  'earthvein-workroom': [360, -300], 'brood-cavern': [150, -80],
  'relic-underchannel': [130, 170], 'heartward-path': [380, 240], 'manor-heart': [420, -30],
  'forest-edge-camp': [-290, 160], 'oldwood-edge': [-200, -60],
  'oldwood-fringe': [100, -160], 'condensing-spring-cavern': [290, 120],
  'green-vine-hill': [-360, 100], 'renewal-valley': [-160, -120],
  'windstone-uplands': [70, -220], 'cloudbreak-pass': [240, -20],
  'redbanner-cliff': [100, 230], 'zhaoye-roadhead': [460, 90],
  'whitebank-road': [-350, 30], 'flowpetal-shallows': [-130, -190],
  'returning-current-bay': [80, -40], 'rosyreef-longshoal': [260, 170],
  'crossriver-stone-flat': [-270, 250], 'zhaoye-waterfall': [-110, -420],
  'linzhao-crossing': [480, -90],
};
export function mapPoint(id: string): MapPoint {
  const center = AREA_CENTERS[areaFor(id).id];
  const [x, y] = LOCAL_POINTS[id] ?? [0, 0];
  return { x: center.x + x, y: center.y + y };
}
