import { BASE_STATS } from './stats';
import { dec, text } from '../numbers';
import type { EncounterEntry, EnemyDefinition, StatSource } from './types';
import type { FoundationRoot } from './foundation';

export const CONTENT_VERSION = 'neko-opening-3';
export const SLOTS = ['weapon', 'head', 'body', 'legs', 'feet', 'accessory', 'artifact', 'special'] as const;
export type EquipmentSlot = typeof SLOTS[number];
export const MANOR_AID = {
  locationId: 'manor-inner-threshold', prerequisite: 'manor-seal-gate', itemId: 'manor-command-seal',
  finalRegionId: 'manor-heart', enemyId: 'manor-spirit-vessel',
} as const;
export const FOUNDATION = { insightItemId: 'foundation-insight' } as const;

export const FOOD_EFFECTS: Record<string, {
  name: string; durationMs: number; maxRealm: number; polarity: 'benefit' | 'cost'; source: StatSource;
}> = {
  nourished: {
    name: '饱腹', durationMs: 60_000, maxRealm: 5, polarity: 'benefit',
    source: { id: 'food', flat: { hpRegen: '40' } },
  },
  'rich-nourishment': {
    name: '精肉滋养', durationMs: 60_000, maxRealm: 7, polarity: 'benefit',
    source: { id: 'rich-food', flat: { hpRegen: '80' } },
  },
  'spirit-nourishment': {
    name: '培元', durationMs: 60_000, maxRealm: 8, polarity: 'benefit',
    source: { id: 'spirit-food', flat: { hpRegen: '400', attack: '20', defense: '20', agility: '20' } },
  },
  'meridian-restoration': {
    name: '续脉', durationMs: 60_000, maxRealm: 11, polarity: 'benefit',
    source: { id: 'meridian-restoration', flat: { hpRegen: '1500' } },
  },
  'blood-surge': {
    name: '燃血', durationMs: 30_000, maxRealm: 11, polarity: 'benefit',
    source: { id: 'blood-surge', flat: { attack: '1600', defense: '1600', agility: '1600', hpRegenPercent: '0.01' } },
  },
  'blood-exhaustion': {
    name: '气血亏空', durationMs: 90_000, maxRealm: 11, polarity: 'cost',
    source: { id: 'blood-exhaustion', flat: { hpRegenPercent: '-0.01' } },
  },
  'essence-nourishment': {
    name: '凝元', durationMs: 90_000, maxRealm: 11, polarity: 'benefit',
    source: { id: 'essence-food', flat: { hpRegen: '2000', attack: '400', defense: '400', agility: '400' } },
  },
  'woodland-nourishment': {
    name: '养元', durationMs: 60_000, maxRealm: 14, polarity: 'benefit',
    source: { id: 'woodland-food', flat: { hpRegen: '12000', attack: '800', defense: '800', agility: '800' } },
  },
};

export function foodEffectSource(id: string): StatSource {
  const effect = lookup(FOOD_EFFECTS, id);
  return { ...structuredClone(effect.source), tags: ['supply', effect.polarity] };
}

export interface ItemDefinition {
  name: string;
  description?: string;
  effectDescription?: string;
  kind: 'material' | 'food' | 'marrow' | 'insight' | 'foundation-pill' | 'part' | 'equipment';
  value: string;
  tier?: number;
  slot?: EquipmentSlot;
  defense?: string;
  blade?: string;
  hilt?: string;
  attack?: string;
  critChance?: string;
  attackSpeed?: string;
  attackMultiplier?: string;
  weaponSkill?: 'sword' | 'greatsword';
  experience?: { amount: string };
  foundationRoot?: FoundationRoot;
  marrowValue?: number;
  foodEffects?: string[];
  interior?: string;
  exterior?: string;
  bonusFlat?: StatSource['flat'];
  fixedStats?: Omit<StatSource, 'id'>;
  sturdyCap?: number;
}

const material = (name: string, value: number): ItemDefinition =>
  ({ name, kind: 'material', value: String(value) });
const part = (name: string, value: number, tier: number): ItemDefinition =>
  ({ name, kind: 'part', value: String(value), tier });
const armor = (name: string, value: number, slot: EquipmentSlot, defense: number, tier = 0): ItemDefinition =>
  ({ name, kind: 'equipment', value: String(value), tier, slot, defense: String(defense) });

export const ITEMS: Record<string, ItemDefinition> = {
  'copper-coin': material('灵石', 1),
  'small-coin-string': material('小袋灵石', 5),
  'hundred-coin-string': material('大袋灵石', 100),
  'dark-steel-scrap': {
    ...material('乌钢碎料', 150), description: '旧刃与甲片中拣出的乌黑钢料，断口仍有细亮纹路。与粗铁、木炭同炉复熔，可铸成乌钢锭。',
  },
  'rich-beast-meat': {
    ...material('妖兽精肉', 200), description: '从妖兽身上取下的紧实肉块，纹理细密，血色浓厚。以炭火烘成精肉脯后，便于外出时补养气血。',
  },
  'spirit-beast-meat': {
    ...material('蕴灵兽肉', 5000), description: '灵性浸入筋肉的兽肉，切面带着细润光泽，常从高原妖禽与大兽身上取得。可配地火煤提炼精华，凝制培元丹。',
  },
  'tough-beast-hide': {
    ...material('韧妖皮', 500), description: '妖兽身上剥取的柔韧皮料，反复弯折仍不易开裂。裁薄后可制护额、内甲、长裤和鞋靴。',
  },
  'lustrous-hide': {
    ...material('锦纹兽皮', 75), description: '皮面保留着鲜明的天然花纹，光泽均匀。仅作售卖皮货，不用于炼制；售出可换取灵石。',
  },
  'silver-ingot': material('整匣灵石', 1000),
  'dark-steel-ingot': {
    ...material('乌钢锭', 400), description: '乌钢碎料与粗铁复熔后铸成的厚实梯形锭，锭肩齐整，断面细密而乌亮。继续锻炼可制成兵刃所用的乌钢精料。',
  },
  'earth-vein-dew': {
    ...material('地脉浊露', 2000), description: '岩隙间凝出的浑浊灵露，汲聚地气的石灵体内也有积存。熔炼青纹铁时用来调和矿性。',
  },
  'verdant-essence': {
    ...material('草木灵露', 2500), description: '含灵草木的精华凝成的碧绿露液，食草妖物与泉中灵物也会积存。是浸炼养灵木的用料。',
  },
  'windwoven-fiber': {
    ...material('风纹灵丝', 3000), description: '缠附在含灵草木与妖物身上的细丝，受风牵引时浮起浅纹。与草木灵露一同炼入铁桦木，可制养灵木。',
  },
  'weathered-route-chart': {
    ...material('凝风长翎', 999), description: '盘崖妖雕翼上的完整长翎，羽轴内凝着细白纹路，迎风时发出低鸣。仅作售卖战利品，没有使用或炼制用途；售出可换取灵石。',
  },
  'azure-ore': {
    ...material('青纹矿', 2222), description: '灰白岩层中夹生的含灵矿石，断面交错着青色细纹。配以地脉浊露和地火煤熔炼，可得青纹铁。',
  },
  'ember-coal': {
    ...material('地火煤', 999), description: '深层岩缝中采出的乌黑煤块，剖面夹着暗红纹理，入炉后火势绵长。用于熔炼青纹铁、炼制培元丹，也用于炉体烧炼。',
  },
  'azure-iron-ingot': {
    ...material('青纹铁', 16666), description: '青纹矿经灵露与炉火熔炼成锭，青纹贯穿金属断面。可加工兵刃精料和防具升炼材料，也可补铸自用炉鼎。',
  },
  'spirit-treated-wood': {
    ...material('养灵木', 10000), description: '铁桦木以草木灵露和风纹灵丝炼合，木纹间留下细润光泽。可继续提炼为养灵淬液。',
  },
  'soul-ember': { ...material('凝魄砂', 80000), description: '细砂中凝着零碎灵光，多见于阵灵散形后的残留，也会随旧渠沉砂积入藤根与泽兽体内。可与石精灵眼配成续脉散，也可投入燃血丹及灵材的炼制。' },
  'spirit-eye': {
    ...material('石精灵眼', 100000), description: '妖蟾与岩穴妖兽体内结成的眼状灵珠，外壳有石纹，内里透着润泽光晕。可用于炼制续脉散与命枢珠。',
  },
  'formation-core': { ...material('阵枢残核', 120000), description: '破损阵枢中仍能聚灵的内核，边沿留着多次接补的刻槽。炼铁、制药与炼制饰物都能用到，也可补铸自有炉鼎。' },
  'fractured-spirit-blade': {
    ...material('残损灵刃', 80000), description: '旧兵器与刃傀上遗留的断刃，刃口崩缺，内部灵纹仍有微光。配以青纹铁和阵枢残核，可重炼成玄煞铁。',
  },
  'baleful-alloy': { ...material('玄煞铁', 200000), description: '以灵刃和阵枢残料重炼的乌黑灵铁，也用于旧库卫的甲壳。可制兵甲与命枢珠；用它升炼的防具坚硬，却会持续蚀耗穿戴者的气血。' },
  'marrow-crystal': {
    ...material('灵髓晶', 120000), description: '凝灵髓、玄灵髓与莹灵髓一同凝炼的晶体，几种色泽在晶心交叠。配合阵枢残核，可炼成养元佩。',
  },
  'warding-notes': { ...material('工坊阵图残页', 11037), description: '夹在旧傀甲内的阵图残页，标着牵丝与聚灵部件的位置。仅作售卖旧物，不能学习、解锁配方或用于炼制；售出可换取灵石。' },
  'vault-bond': { ...material('赤纹灵金', 1000000), description: '金色料片中贯穿着赤红灵纹，旧阵枢与守卫以它接引灵力。离开原阵后仍是贵重器料，可用于沉渊钢、断岳佩和鸣金锭的炼制。' },
  'feral-heart-meat': {
    ...material('凶兽心肉', 300000), description: '凶兽心腔附近凝聚精血的厚实肉块，切面深红，灵性比寻常筋肉更浓。配合阵枢残核聚拢药力，可炼制凝元丹。',
  },
  'frost-veined-hide': {
    ...material('寒纹灵皮', 400000), description: '含灵妖物身上带着冷白细纹的柔韧皮膜，兽皮、翼膜与凝厚菌膜中都能取得。可与流灵凝胶、凝魄砂织炼回春灵绢，也常被裁作承载符纹的皮片。',
  },
  'flowing-essence-gel': {
    ...material('流灵凝胶', 500000), description: '胶灵、含灵苔菌、藤根及妖蛛体内凝成的半透明胶质，离体后仍缓缓聚拢，旧院湿槽与药泽根团间常留有胶痕。可用于织炼回春灵绢，也可聚炼为踏虚结。',
  },
  'deepsteel-ingot': {
    ...material('沉渊钢', 1300000), description: '赤纹灵金与凝魄砂、阵枢残核同炉熔炼所得的深色灵钢，细纹沉在断面深处。可继续炼制器物，也可补铸自有炉鼎。',
  },
  'renewal-silk': {
    ...material('回春灵绢', 1100000), description: '寒纹灵皮重新织炼成的细绢，皮纹化入丝理，细小裂口能够自行弥合。可裁炼为头巾、法衣、长裤与软履。',
  },
  'feral-blood-essence': {
    ...material('泽兽精粹', 1500000),
    description: '含灵泽兽组织中凝出的浓稠精华，色泽碧润，离体后仍有细光流动。可用于批量精织回春灵绢，也可与凝魄砂炼成调元药液。',
  },
  'beast-core-shard': {
    ...material('聚灵砂核', 960000),
    description: '含灵细砂长久聚结成的小核，内里的灵光收而不散。寻材者常将它收在药匣中，符修也用来温养符材；可用于养元丹、筑基丹药与鸣金锭的炼制。',
  },
  'marsh-lotus-seed': {
    ...material('泽心莲实', 80000),
    description: '药泽含灵莲丛结出的深青色莲实，坚壳内的莲仁泛着温润灵光，是三种筑基丹的共同主药。旧渠旁被藤根缠住的莲蓬，以及寻材者携带的药包中，都可能留有成熟莲实。',
  },
  'clear-spring-saliva': {
    ...material('澄泉灵涎', 300000),
    description: '玉蟾汲聚泉中灵性后凝出的清润药涎，盛入小瓶仍有淡淡玉光。可作炼制上品筑基丹药的附药，多余部分也可出售给商会。',
  },
  'harmonizing-elixir': {
    ...material('调元药液', 600000),
    description: '泽兽精粹与凝魄砂同炼后滤出的碧润药液，药性柔和而凝聚。可作为玉液筑基丹与九转筑基丹的辅药。',
  },
  'carapace-fragment': {
    ...material('坚甲碎片', 1350000),
    description: '厚重妖甲破下的硬片，断面交错着细密层纹。泽中劫匪常把它钉在护甲与弩臂上；与赤纹灵金、聚灵砂核同炉，可炼成鸣金锭。',
  },
  'spirit-rib-meat': {
    ...material('灵兽肋肉', 1200000),
    description: '含灵大兽肋侧的厚肉，筋膜间透着细润灵光。商会以封灵纸包裹运来，配合聚灵砂核可炼制养元丹。',
  },
  'awakened-wood': {
    ...material('苏灵木', 2333000),
    description: '久受灵气滋养的木料，切口的细纹仍会缓缓收拢。商会将不同产地的料段封装收贮，可取其汁液炼成苏灵淬液。',
  },
  'resonant-ingot': {
    ...material('鸣金锭', 6666000),
    description: '赤纹灵金、坚甲碎片与聚灵砂核同炉炼成的金属锭，轻叩时鸣声绵长。可继续加工兵刃精料、重料及防具升炼用砂。',
  },
  'hide-scrap': {
    ...material('碎兽皮', 1), description: '剥取后留下的小片兽皮，大小不齐。用麻线缝合后，仍可裁制护身衣物。',
  },
  'hemp-thread': {
    ...material('粗麻线', 8), description: '山民搓成的粗线，常用来缝皮、捆柴和编猎套。',
  },
  'scrap-iron': {
    ...material('碎铁料', 4), description: '断裂农具、旧猎夹与废旧器物留下的铁料，除去浮锈后可以回炉。',
  },
  charcoal: {
    ...material('木炭', 6), description: '烧透的杂木炭块，质地疏松。可用于烘肉、熔铁与提炼灵髓，山村和行路人的火塘边都能见到。',
  },
  'old-timber': {
    ...material('干木料', 6), description: '收拢晒干的枝木与旧木块，可用来提取粗制淬液。',
  },
  'cloudy-jade': {
    ...material('含灵玉石', 5), description: '夹有浑浊玉质的石块，山溪砂砾间偶能找到。借炭火提炼，可析出少量浊灵髓。',
  },
  'fresh-meat': {
    ...material('鲜兽肉', 8), description: '从山野猎物上取下的鲜肉，切条烘干后便于随身携带。',
  },
  'iron-birch-wood': {
    ...material('铁桦木', 20), description: '山岭铁桦的坚硬木料，断面纹理细密。提取并滤净其中的木脂，可制成炼器所用的桦脂淬液。',
  },
  'whole-hide': {
    ...material('完整兽皮', 75), description: '剥取较为完整的一张兽皮，皮面少有破洞，便于收卷。仅作售卖皮货，不用于炼制；售出可换取灵石。',
  },
  'crude-iron-ingot': {
    ...material('粗铁锭', 30), description: '碎铁料经炭火熔炼所得的低扁铸块，边缘粗钝，表面尚有炉渣。继续锻炼后可作制剑主材。',
  },
  'stitched-hide': {
    ...material('缝合皮料', 12), description: '用粗麻线将碎兽皮拼缝成片，裁开便可制成头巾、短衣、长裤或靴履。',
  },
  'dried-meat': {
    name: '肉干', kind: 'food', value: '20', foodEffects: ['nourished'],
    description: '切成薄条烘干的兽肉。山民出远门时常将它包在布中，挂在腰侧。',
  },
  'rich-jerky': {
    name: '精肉脯', kind: 'food', value: '240', foodEffects: ['rich-nourishment'],
    description: '去筋留肉，压成厚薄均匀的宽肉片，切边齐整，便于携带。肉质紧实，比寻常肉干更耐嚼。',
  },
  'spirit-jerky': {
    name: '培元丹', kind: 'food', value: '6000', foodEffects: ['spirit-nourishment'],
    description: '从蕴灵兽肉中提取精华凝成的褐色丹丸，断面细密，仍有少许肉腥气。',
  },
  'recovery-draught': {
    name: '续脉散', kind: 'food', value: '210000', foodEffects: ['meridian-restoration'],
    description: '色泽灰白的细散，混有磨碎的灵眼结晶。药铺按次分包，外纸折口压得很紧。',
  },
  'surge-pill': {
    name: '燃血丹', kind: 'food', value: '420000', foodEffects: ['blood-surge', 'blood-exhaustion'],
    description: '赤褐色丹丸，服后气血迅速催发。药力退去后，亏耗仍会持续一段时间。',
  },
  'essence-broth': {
    name: '凝元丹', kind: 'food', value: '500000', foodEffects: ['essence-nourishment'],
    description: '以凶兽心肉中的精血凝炼成丸。炼制时借阵枢残核聚拢药力，成丹后已不见血色。',
  },
  'woodland-roast': {
    name: '养元丹', kind: 'food', value: '1800000', foodEffects: ['woodland-nourishment'],
    description: '灵兽肋肉与聚灵砂核同炼所得。丹衣薄而匀整，内里留有细小的晶点。',
  },
  'foundation-insight': {
    name: '蕴元灵露', kind: 'insight', value: '0', experience: { amount: '10000000' },
    description: '百渠药泽的灵草叶心与石槽凹处汇聚的淡青凝露，草木药气沉在露底。收拢封瓶后，可留待炼化、增进修为。',
  },
  'foundation-pill': {
    name: '筑基丹', kind: 'foundation-pill', value: '840000', foundationRoot: 'human',
    description: '以泽心莲实为主药，凝魄砂调和、聚灵砂核凝炼成丸。药力沉稳，可助炼气圆满者筑成人道根基。',
  },
  'jade-fluid-foundation-pill': {
    name: '玉液筑基丹', kind: 'foundation-pill', value: '1440000', foundationRoot: 'earth',
    description: '在共用筑基药材中炼入调元药液，成丹后内蕴温润玉色。药力更为凝合，可筑成地道根基。',
  },
  'ninefold-foundation-pill': {
    name: '九转筑基丹', kind: 'foundation-pill', value: '2340000', foundationRoot: 'heaven',
    description: '以更多调元药液与澄泉灵涎同炼，细密丹纹层层收拢药力。可筑成天道根基，并非反复服用或多次突破之物。',
  },
  'cloudy-marrow': {
    name: '浊灵髓', kind: 'marrow', value: '1', marrowValue: 1,
    description: '山野生灵与含灵石质中凝聚的微量灵髓，色泽浑浊。炼化可温养体魄，也能继续精炼。',
  },
  'clear-marrow': {
    name: '清灵髓', kind: 'marrow', value: '2', marrowValue: 2,
    description: '杂质较少的灵髓，迎光可见浅淡纹理。山野灵物中偶有凝成，也可由浊灵髓精炼而得，炼化后温养体魄。',
  },
  'condensed-marrow': {
    name: '凝灵髓', kind: 'marrow', value: '5', marrowValue: 5,
    description: '凝结紧密的灵髓，断面带着润泽光晕。灵性较强的生灵体内能够凝成，是散修炼化养身的常用物资。',
  },
  'profound-marrow': {
    name: '玄灵髓', kind: 'marrow', value: '10', marrowValue: 10,
    description: '深色灵髓中浮着细密光纹，灵性凝厚的生灵体内能够结成，修士也常将其收存于小匣。可炼化养身，亦是凝炼灵髓晶的材料。',
  },
  'luminous-marrow': {
    name: '莹灵髓', kind: 'marrow', value: '20', marrowValue: 20,
    description: '通体莹润的灵髓，内部光泽凝而不散。灵性深厚的生灵能够凝成，修士也常随身收存；可炼化养身，亦用于凝炼灵髓晶。',
  },
  'jade-marrow': {
    name: '玉灵髓', kind: 'marrow', value: '50', marrowValue: 50,
    description: '质地如润玉的灵髓，细纹层层相叠。除生灵体内凝结之物外，含灵岩脉中也有积成的玉髓，取出后可炼化温养体魄。',
  },
  'crimson-marrow': {
    name: '赤灵髓', kind: 'marrow', value: '100', marrowValue: 100,
    description: '赤色灵光凝在髓质深处，生灵体内与长久供灵的阵枢中都能积成。质地比玉灵髓更为凝厚，可炼化温养体魄。',
  },
  'verdant-marrow': {
    name: '碧灵髓', kind: 'marrow', value: '200', marrowValue: 200,
    description: '深碧髓质中凝着层叠灵光，含灵生灵体内与长年聚灵的旧阵枢中都能积成。质地比赤灵髓更为凝厚，可炼化温养体魄。',
  },
  'golden-marrow': {
    name: '金灵髓', kind: 'marrow', value: '500', marrowValue: 500,
    description: '灵性高度凝聚的金色髓质，澄亮光泽透过外壳。旧聚火阵中长年凝成的髓核也属此类，脱离火煞后仍可炼化温养体魄。',
  },
  'iron-blade': {
    ...part('百炼铁料', 125, 0), attack: '16', critChance: '.05', attackSpeed: '1.02',
    description: '粗铁反复锻炼后压成的宽扁料条，截面薄而齐整，表面留着规则锤痕。',
  },
  'dark-steel-blade': {
    ...part('乌钢精料', 900, 1), attack: '48', critChance: '.06', attackSpeed: '1.04',
    description: '乌钢经复炼除去浮渣，锻成厚实的六棱料条，端面细密，棱缘泛着冷亮暗光。',
  },
  'azure-iron-blade': {
    ...part('青纹精料', 40000, 2), attack: '200', critChance: '.07', attackSpeed: '1.06',
    description: '折炼后的青纹铁料，青色纹理贯穿内外，并非表面涂染。',
  },
  'baleful-blade': {
    ...part('玄煞精料', 120000, 3), attack: '640', critChance: '.08', attackSpeed: '1.08', bonusFlat: { agility: '80' },
    description: '玄煞铁凝炼成的乌黑料块，稍加打磨便显出细长的亮纹。',
  },
  'deepsteel-blade': {
    ...part('沉渊精料', 2800000, 4), attack: '1440', critChance: '.09', attackSpeed: '1.10', bonusFlat: { agility: '-320' },
    description: '沉渊钢凝炼成的小块器料，入手远比看上去沉重。',
  },
  'resonant-blade': {
    ...part('鸣金精料', 15000000, 5), attack: '4320', critChance: '0.10', attackSpeed: '1.11',
    description: '复炼后的鸣金器料，轻叩时能听见短促而清晰的余音。',
  },
  'resonant-greatblade': {
    ...part('鸣金重料', 45000000, 5), attack: '6000', critChance: '0.10', attackSpeed: '0.50',
    attackMultiplier: '3', weaponSkill: 'greatsword',
    description: '多份鸣金复炼为一块重料，叠锻纹理宽厚，适合铸成重兵。',
  },
  'old-wood-hilt': {
    ...part('粗制淬液', 15, 0),
    description: '干木料干馏后收取的浑浊淬液，静置便有沉渣。村中铁匠也用这种便宜辅料。',
  },
  'iron-birch-hilt': {
    ...part('桦脂淬液', 50, 1),
    description: '从铁桦木中提炼并滤净的淬液，黏度均匀，液面不见碎屑。',
  },
  'spiritwood-hilt': {
    ...part('养灵淬液', 25000, 2), bonusFlat: { agility: '40', critMultiplier: '.1' },
    description: '养灵木提炼出的青色淬液，盛放日久也少有沉淀。',
  },
  'awakened-hilt': {
    ...part('苏灵淬液', 5000000, 4), bonusFlat: { agility: '2000', critMultiplier: '0.2', attackMultiplier: '0.1' },
    description: '苏灵木中的汁液经炼化浓缩，滴在金属上会铺成极薄的一层。',
  },
  'wood-hilt-sword': {
    name: '粗炼铁剑', kind: 'equipment', value: '140', slot: 'weapon', blade: 'iron-blade', hilt: 'old-wood-hilt',
  },
  'iron-birch-sword': {
    name: '铁剑', kind: 'equipment', value: '175', slot: 'weapon', blade: 'iron-blade', hilt: 'iron-birch-hilt',
  },
  'dark-steel-sword': {
    name: '乌钢剑', kind: 'equipment', value: '950', slot: 'weapon', blade: 'dark-steel-blade', hilt: 'iron-birch-hilt',
  },
  'wood-hilt-dark-steel-sword': {
    name: '粗炼乌钢剑', kind: 'equipment', value: '915', slot: 'weapon', blade: 'dark-steel-blade', hilt: 'old-wood-hilt',
  },
  ...Object.fromEntries([
    ['wood-hilt-azure-sword', '粗炼青纹剑', 'azure-iron-blade', 'old-wood-hilt', 40015],
    ['azure-iron-sword', '青纹剑', 'azure-iron-blade', 'iron-birch-hilt', 40050],
    ['spiritwood-iron-sword', '养灵铁剑', 'iron-blade', 'spiritwood-hilt', 25125],
    ['spiritwood-dark-steel-sword', '养灵乌钢剑', 'dark-steel-blade', 'spiritwood-hilt', 25900],
    ['spiritwood-azure-sword', '养灵青纹剑', 'azure-iron-blade', 'spiritwood-hilt', 65000],
    ['wood-hilt-baleful-sword', '粗炼玄煞剑', 'baleful-blade', 'old-wood-hilt', 120015],
    ['iron-birch-baleful-sword', '玄煞剑', 'baleful-blade', 'iron-birch-hilt', 120050],
    ['spiritwood-baleful-sword', '养灵玄煞剑', 'baleful-blade', 'spiritwood-hilt', 145000],
    ['wood-hilt-deepsteel-sword', '粗炼沉渊剑', 'deepsteel-blade', 'old-wood-hilt', 2800015],
    ['iron-birch-deepsteel-sword', '沉渊剑', 'deepsteel-blade', 'iron-birch-hilt', 2800050],
    ['spiritwood-deepsteel-sword', '养灵沉渊剑', 'deepsteel-blade', 'spiritwood-hilt', 2825000],
  ].map(([id, name, blade, hilt, value]) => [id, {
    name, kind: 'equipment', value: String(value), slot: 'weapon', blade, hilt,
  } as ItemDefinition])),
  'hide-headwrap': { ...armor('夹皮头巾', 45, 'head', 2), description: '粗布中夹入薄皮，额前多缝了一道线。' },
  'hide-jacket': { ...armor('夹皮短衣', 60, 'body', 4), description: '短衣在肩背处缀有皮料，仍保留了劳作时常用的宽袖。' },
  'hide-leggings': { ...armor('夹皮长裤', 60, 'legs', 3), description: '膝部补有厚皮，裤脚收紧，行山路时不易挂住枝条。' },
  'hide-boots': { ...armor('软皮靴', 30, 'feet', 2), description: '软皮缝成的短靴，靴底叠了数层，磨损后还能重新缝补。' },
  'beasthide-headwrap': { ...armor('妖皮护额', 1800, 'head', 10, 1), description: '裁薄的韧妖皮束在额前，系带处仍可见原有皮纹。' },
  'beasthide-jacket': { ...armor('妖皮内甲', 2400, 'body', 16, 1), description: '古式无袖软甲，柔韧皮片分层搭合，襟边整齐，以系带收束，外面可以照常穿衣。' },
  'beasthide-leggings': { ...armor('妖皮长裤', 2400, 'legs', 14, 1), description: '韧妖皮制成的长裤，内侧磨得光滑，膝后留有活动褶。' },
  'beasthide-boots': { ...armor('妖皮靴', 1200, 'feet', 8, 1), description: '韧妖皮缝成的长靴，靴口以皮绳束紧。' },
  'renewal-headwrap': {
    ...armor('回春巾', 3300000, 'head', 360, 4), bonusFlat: { hpRegen: '30' },
    description: '回春灵绢裁成的方巾，细小裂口会沿织纹缓缓合拢。',
  },
  'renewal-jacket': {
    ...armor('回春法衣', 4400000, 'body', 480, 4), bonusFlat: { hpRegen: '40' },
    description: '以回春灵绢织成的法衣，衣摆接缝处的细丝仍能自行续合。',
  },
  'renewal-leggings': {
    ...armor('回春长裤', 4400000, 'legs', 480, 4), bonusFlat: { hpRegen: '40' },
    description: '灵绢织成的长裤，裤膝反复弯折，也少见断丝。',
  },
  'renewal-boots': {
    ...armor('回春履', 2200000, 'feet', 240, 4), bonusFlat: { hpRegen: '20' },
    description: '履面以灵绢缝合，细丝沿针脚交织，遮住了大部分接缝。',
  },
  'azure-head-shell': { ...part('青纹束额砂', 60000, 2), defense: '45', bonusFlat: { agility: '45' } },
  'azure-body-shell': { ...part('青纹护衣砂', 80000, 2), defense: '60', bonusFlat: { agility: '60' } },
  'azure-leg-shell': { ...part('青纹护腿砂', 80000, 2), defense: '60', bonusFlat: { agility: '60' } },
  'azure-foot-shell': { ...part('青纹护履砂', 40000, 2), defense: '30', bonusFlat: { agility: '30' } },
  'baleful-head-shell': { ...part('玄煞束额砂', 270000, 3), defense: '180', bonusFlat: { hpRegen: '-60' } },
  'baleful-body-shell': { ...part('玄煞护衣砂', 360000, 3), defense: '240', bonusFlat: { hpRegen: '-80' } },
  'baleful-leg-shell': { ...part('玄煞护腿砂', 360000, 3), defense: '240', bonusFlat: { hpRegen: '-80' } },
  'baleful-foot-shell': { ...part('玄煞护履砂', 180000, 3), defense: '120', bonusFlat: { hpRegen: '-40' } },
  'resonant-head-shell': { ...part('鸣金束额砂', 21000000, 5), defense: '900', bonusFlat: { attack: '225' } },
  'resonant-body-shell': { ...part('鸣金护衣砂', 28000000, 5), defense: '1200', bonusFlat: { attack: '300' } },
  'resonant-leg-shell': { ...part('鸣金护腿砂', 28000000, 5), defense: '1200', bonusFlat: { attack: '300' } },
  'resonant-foot-shell': { ...part('鸣金护履砂', 14000000, 5), defense: '600', bonusFlat: { attack: '150' } },
  'marrow-pendant': {
    name: '养元佩', kind: 'equipment', slot: 'accessory', value: '545455', fixedStats: { flat: { hpRegen: '225' } },
    description: '灵髓晶围着阵枢残核凝成佩身，交叠的色泽从中央向外散开。佩在身上，温润灵息便缓缓渗入经脉。',
  },
  'vital-eye': {
    name: '命枢珠', kind: 'equipment', slot: 'accessory', value: '4444444', fixedStats: { flat: { maxHp: '450000' } },
    description: '玄煞铁铸成的珠壳内收着数枚灵眼，阵枢将其中生机聚在一处。珠面微光随持有者的脉动明灭。',
  },
  'voidstep-knot': {
    name: '踏虚结', kind: 'equipment', slot: 'accessory', value: '7777777',
    fixedStats: { flat: { attack: '-1000', defense: '-1000', agility: '6000' } },
    description: '流灵凝胶引成细缕，与凝魄砂绕着阵核结成绳结。系上后步履轻捷，发力与护身灵息却随之散弱。',
  },
  'mountaincleaver-pendant': {
    name: '断岳佩', kind: 'equipment', slot: 'accessory', value: '23456789',
    fixedStats: { flat: { attack: '6000', hpRegenPercent: '-0.01' } },
    description: '赤纹灵金裹着熔合的残刃，养灵木的细纹贯穿其间，将未尽锋芒聚在佩中。催发时力道沉猛，却须持续以佩戴者的气血温养。',
  },
  'returning-lamp': {
    name: '归息盏', kind: 'equipment', slot: 'artifact', value: '909090', fixedStats: { flat: { hpRegen: '100' } },
    description: '榕庭石龛中留存的青铜灯盏，灯座附着细根，盏沿已被磨亮。灯壁刻着吐纳纹路，芯中余光随持灯者的呼吸轻轻明灭。',
    effectDescription: '装备后命中增长归息盏熟练；1/2/3级全经验累计约为×2/×3/×4，已得里程碑卸下仍保留。',
  },
  'manor-command-seal': {
    name: '巡枢残印', kind: 'equipment', slot: 'special', value: '861082713',
    fixedStats: { multiplier: { maxHp: '1.3', attack: '1.3', defense: '1.3', agility: '1.3' } }, sturdyCap: 4,
    description: '印侧刻着「巡枢」二字，边角已有裂纹，印面阵线与内院石台的凹槽相合。握持时，残存灵光仍会沿掌心流动。',
    effectDescription: '坚固的中间伤害上限升至4；装备入场可将涵岳枢灵的攻防敏血压至1%。击败后回收持有残印，仅可领取一次；出售后不能重领。',
  },
};

export interface LootEntry { itemId: string; chance: string; ignoreLuck?: boolean }
export interface EnemyContent {
  name: string;
  description?: string;
  realm: number;
  xp: string;
  definition: EnemyDefinition;
  loot: LootEntry[];
}
const drop = (itemId: string, chance: number): LootEntry => ({ itemId, chance: String(chance) });
const cloudyMarrow = (chance: number) => drop('cloudy-marrow', chance);
const clearMarrow = (chance: number) => drop('clear-marrow', chance);
const foe = (
  id: string, name: string, realm: number, xp: number,
  panel: [number, number, number, number, number], loot: LootEntry[], abilities: EnemyDefinition['abilities'] = {},
): EnemyContent => ({
  name, realm, xp: String(xp), loot,
  definition: {
    id, abilities,
    stats: {
      ...BASE_STATS, maxHp: String(panel[0]), attack: String(panel[1]), defense: String(panel[2]),
      agility: String(panel[3]), attackSpeed: String(panel[4]), critChance: '0.1', critMultiplier: '2',
    },
  },
});

// Repeated loot entries are independent rolls, not a mutually exclusive pool.
export const ENEMIES: Record<string, EnemyContent> = Object.fromEntries([
  { ...foe('mountain-rat', '灰毛山鼠', 0, 1, [3, 3, 0, 1, 1],
    [drop('hide-scrap', .04), cloudyMarrow(.015)]),
    description: '在田埂和柴堆间打洞，受惊后会咬住靠近的手脚。' },
  { ...foe('wild-badger', '掘土獾', 0, 1, [4, 4, 0, 1, .8],
    [drop('hide-scrap', .01), drop('scrap-iron', .01), cloudyMarrow(.015)]),
    description: '前爪粗短有力，常沿旧猎径翻土觅食。被堵住退路时便低头扑咬。' },
  { ...foe('stray-dog', '灰背野犬', 0, 1, [5, 6, 0, 1.5, 1],
    [drop('hide-scrap', .06), cloudyMarrow(.015)]),
    description: '在林缘争食的野犬，常追逐落单猎物，也会逼近晾肉的棚架。' },
  { ...foe('roadside-thief', '扑枝山狸', 0, 1, [3, 10, 0, 4, 1],
    [drop('hemp-thread', .01), cloudyMarrow(.015)], { entryStrikes: 1 }),
    description: '伏在横枝上的小兽，接近时会突然跃下，先抓向来者的面门。' },
  { ...foe('club-raider', '折枝猿', 1, 2, [12, 7, 1, 1.8, 1],
    [drop('old-timber', .02), cloudyMarrow(.045)]),
    description: '前臂长而有力，常折下硬枝挥打闯入领地的人兽。' },
  { ...foe('hide-bandit', '厚皮野豕', 1, 2, [10, 8, 2, 2.2, 1],
    [drop('hide-scrap', .06), drop('scrap-iron', .02), cloudyMarrow(.045)]),
    description: '肩背覆着硬皮与干泥，在林下拱食草根，受惊后会径直撞来。' },
  { ...foe('fire-thrower', '赤囊毒蟾', 1, 2, [6, 3, 3, 3, 1],
    [drop('charcoal', .03), cloudyMarrow(.045)], { ignoreDefense: true }),
    description: '藏在潮湿炭土里的蟾兽，颈侧鼓着赤囊。喷出的毒液沾身即痛，普通衣甲难以遮挡。' },
  { ...foe('wildcat', '斑尾山猫', 1, 2, [14, 12, 2, 3, 1],
    [drop('fresh-meat', .01), drop('old-timber', .01), cloudyMarrow(.045)], { strikes: 2 }),
    description: '沿石隙潜行的山猫，跃起后双爪接连抓挠，很少在原地停留。' },
  { ...foe('mountain-wight', '苔背石蜥', 2, 3, [15, 18, 6, 6, 1],
    [drop('cloudy-jade', .04), drop('charcoal', .04), cloudyMarrow(.075)]),
    description: '伏在含玉岩层附近，背鳞覆着青苔与细砂，静止时近似一块湿石。' },
  { ...foe('black-backed-wolf', '黑背山狼', 2, 3, [8, 16, 3, 6, 1],
    [drop('hide-scrap', .1), drop('charcoal', .04), cloudyMarrow(.075)]),
    description: '循兽道来到溪边饮水，黑色背毛间夹着旧伤，扑咬时惯于绕向侧面。' },
  { ...foe('masked-bladesman', '蒙面截道客', 2, 3, [42, 21, 0, 16, 1],
    [drop('hemp-thread', .04), drop('charcoal', .06), cloudyMarrow(.075)]),
    description: '用旧布遮住面孔，腰间缠着捆货麻绳。藏在山外支路旁，见行人落单便拔刀索财。' },
  { ...foe('red-eyed-shanxiao', '赤眼山魈', 2, 3, [20, 30, 5, 12, 1],
    [drop('hide-scrap', .1), drop('whole-hide', .01), cloudyMarrow(.075)], { entryStrikes: 1 }),
    description: '眼周生着一圈红毛，常伏在高处岩石后。来者走近时便突然扑下，先抓向肩颈。' },
  { ...foe('mine-brigand', '横木路匪', 2, 3, [40, 21, 9, 10, 1],
    [drop('old-timber', .1), drop('scrap-iron', .08), drop('charcoal', .05), cloudyMarrow(.075)]),
    description: '把断木横在岔路上，腰边挂着生锈的铁钩。拦下行人后便翻找行囊，临时窝棚旁堆着拆散的货架。' },
  { ...foe('twin-blade-raider', '双刀截道匪', 2, 3, [33, 18, 9, 8, 1],
    [drop('hemp-thread', .1), cloudyMarrow(.075)], { strikes: 2 }),
    description: '两手各持短刀，以麻线缠紧刀柄。动手时左右刀接连劈来，逼得行人退向同伙设下的路障。' },
  { ...foe('mine-sentry', '守卡悍匪', 3, 5, [32, 45, 8, 16, 1.1],
    [drop('charcoal', .1), drop('scrap-iron', .1), cloudyMarrow(.12)]),
    description: '据守林道转角的劫匪，脚边常放着取暖炭盆。钉铁木栅挡住窄路，他专向试图绕行的人挥刀。' },
  { ...foe('ward-eye', '抱玉石灵', 3, 5, [4, 36, 0, 12, 1.1],
    [drop('cloudy-jade', .2), drop('charcoal', .04), cloudyMarrow(.12)], { sturdy: true }),
    description: '几片紧扣的石壳裹着一粒浊玉，在树根与碎石间滚动。石壳十分坚硬，受击后只崩落细小碎屑。' },
  { ...foe('bone-gnawing-shanxiao', '噬骨山魈', 3, 5, [48, 49, 12, 20, 1.1],
    [cloudyMarrow(.12), drop('whole-hide', .04)]),
    description: '颌骨粗大，栖处散着咬碎的兽骨。嗅到血气便追出岩棚，对接近食物的人兽都张口扑咬。' },
  { ...foe('ambush-ape', '伏袭凶猿', 3, 5, [40, 63, 14, 24, 1.1],
    [drop('iron-birch-wood', .1), cloudyMarrow(.12)], { entryStrikes: 3 }),
    description: '攥着折下的铁桦硬枝，藏在枝叶与岩壁间。现身时接连挥击，往往还未看清身形便已挨到数下。' },
  { ...foe('ember-cultivator', '纵火劫修', 3, 5, [70, 17, 17, 24, 1.1],
    [drop('charcoal', .15), cloudyMarrow(.12)], { ignoreDefense: true }),
    description: '随身带着炭粉，以引火术助人劫道。火舌贴着衣甲缝隙钻入，留下焦黑而细窄的灼痕。' },
  { ...foe('armored-bandit-chief', '披甲匪首', 3, 5, [120, 56, 16, 24, 1.1],
    [drop('hide-scrap', .1), drop('whole-hide', .02), drop('scrap-iron', .15), cloudyMarrow(.12), clearMarrow(.015)]),
    description: '将不同尺寸的旧铁片钉在厚皮衣上，领着几名劫匪盘踞险坡。身边的皮袋与货包来自被截下的行人。' },
  { ...foe('cave-boar', '厚甲岩豕', 3, 5, [360, 50, 24, 24, 1.1],
    [drop('fresh-meat', .2), drop('scrap-iron', .15), cloudyMarrow(.12), clearMarrow(.015)]),
    description: '卧在崩石下的岩棚里，肩背裹着厚泥与硬皮。觅食时连废猎夹也一并拱开，遭人靠近便低头顶撞。' },
  { ...foe('outlaw-swordsman', '亡命刀客', 3, 5, [120, 72, 15, 24, 1.1],
    [drop('copper-coin', .4), drop('copper-coin', .4), drop('copper-coin', .4),
      drop('small-coin-string', .2), cloudyMarrow(.12), clearMarrow(.015)]),
    description: '刀锋磨得薄而亮，衣袋里塞着来路不一的灵石。尾随携货行人离开大路后，便抢上前挥刀夺财。' },
  { ...foe('green-backed-wolf', '青背妖狼', 4, 8, [180, 84, 18, 40, 1.1],
    [drop('hide-scrap', .1), drop('charcoal', .1), drop('whole-hide', .05), cloudyMarrow(.06), clearMarrow(.045)]),
    description: '背毛在日光下泛着青色，常在行路人留下的火塘附近嗅探。体形比山狼壮大，敢迎面扑向持械者。' },
  { ...foe('charred-wood-puppet', '焦根木妖', 4, 8, [240, 69, 35, 40, 1.1],
    [drop('charcoal', 1), cloudyMarrow(.06), clearMarrow(.045)]),
    description: '山火烧过的老根仍裹着厚炭壳，根须却能攀地移动。遇到活物便举根抽打，折断处落下干燥炭块。' },
  { ...foe('ridge-python', '岩脊巨豕', 5, 13, [3444, 111, 44, 60, 1.1],
    [drop('condensed-marrow', 1), drop('condensed-marrow', 1), clearMarrow(1), clearMarrow(1)], { restraint: true }),
    description: '背脊隆起如岩，獠牙在隘口石壁上磨出道道白痕。常把闯入者逼到岩壁前，以肩背和獠牙持续挤压。' },
  { ...foe('extortionist', '拦滩劫修', 5, 13, [344, 111, 44, 60, 1.1],
    [clearMarrow(.045), drop('condensed-marrow', .008), drop('hundred-coin-string', .1), drop('scrap-iron', .4)], { restraint: true }),
    description: '守在离镇较远的滩路上，专向背着猎获的人索财。动手便以铁索逼近，勒住衣甲后扯向身前。' },
  { ...foe('red-backed-badger', '赤背妖獾', 4, 8, [97, 97, 42, 60, 1.1],
    [clearMarrow(.045), drop('condensed-marrow', .008), drop('hide-scrap', .3), drop('whole-hide', .1), drop('charcoal', .1)]),
    description: '在芦根与干燥高地间掘穴，背毛被河泥染成暗红色。寻食时常翻动旧营火，护穴时会扑向来者的腿脚。' },
  { ...foe('light-armored-construct', '披铁路匪', 4, 8, [150, 103, 33, 80, 1.2],
    [clearMarrow(.045), drop('condensed-marrow', .008), drop('scrap-iron', .3), drop('dark-steel-scrap', .05)]),
    description: '将捡来的铁片与旧乌钢甲片缀在外衣上，沿旧埠小径截人。衣甲轻重不齐，仍敢迎着刀锋上前争抢行囊。' },
  { ...foe('vinebound-beast', '青腹泽蟒', 4, 8, [840, 128, 16, 60, 1.2],
    [clearMarrow(.045), drop('rich-beast-meat', .03), drop('tough-beast-hide', .01)], { restraint: true }),
    description: '腹鳞泛青，伏在芦根与浅水交接处。粗长身躯卷住猎物后逐渐收紧，坚韧鳞皮随肌肉起伏。' },
  { ...foe('swift-blade-puppet', '疾刃劫修', 5, 13, [150, 180, 0, 120, 1.1],
    [clearMarrow(.045), drop('condensed-marrow', .015), drop('scrap-iron', .2), drop('dark-steel-scrap', .1)], { strikes: 3 }),
    description: '携着磨薄的乌钢短刃，藏在高苇遮住的窄路旁。出手便接连削向肩、腰与腿，不给携货者整顿行装的空隙。' },
  { ...foe('miasma-toad', '黄瘴妖蟾', 5, 13, [600, 20, 45, 80, 1.1],
    [clearMarrow(.045), drop('condensed-marrow', .015), drop('hide-scrap', .3), drop('whole-hide', .2), drop('charcoal', .15)],
    { ignoreDefense: true }),
    description: '黄囊鼓胀的蟾兽，栖在积水与腐叶间。受惊后喷出带腥气的毒雾，贴身衣甲挡不住细雾侵入。' },
  { ...foe('stone-ward-spirit', '闭壳玉蚌', 5, 13, [4, 140, 0, 60, 1.1],
    [clearMarrow(.045), drop('condensed-marrow', .015), drop('cloudy-jade', .3), drop('hundred-coin-string', .12)], { sturdy: true }),
    description: '伏在旧河床的淤石中，厚壳间嵌着浑浊玉质。受扰便猛然夹击，合拢的壳面坚硬得只留下细小刃痕。' },
  { ...foe('cave-guardian', '守赃劫修', 5, 13, [6600, 144, 60, 90, 1.1],
    [drop('hundred-coin-string', 1), drop('hundred-coin-string', 1)], { entryStrikes: 1 }),
    description: '替同伙看守废埠货棚，刀旁堆着截来的货袋。见陌生人逼近便抢先挥刃，身后棚柱上留着旧日装卸用的绳槽。' },
  { ...foe('brocade-marten', '锦皮妖貂', 5, 13, [300, 175, 30, 90, 1.1],
    [clearMarrow(.045), drop('condensed-marrow', .015), drop('hide-scrap', .4), drop('lustrous-hide', .3), drop('charcoal', .15)]),
    description: '毛皮上交错着细密斑纹，沿滩边树根与浮木捕食。遇到逼近的脚步便伏低身子，随后窜起咬向手腕。' },
  { ...foe('rending-shanxiao', '裂爪泽魈', 5, 13, [440, 120, 50, 90, 1.1],
    [clearMarrow(.045), drop('condensed-marrow', .015), drop('tough-beast-hide', .05), drop('charcoal', .15)], { rending: true }),
    description: '攀在临水老树上的长臂异兽，爪缘锐利，树皮常被它成片剥下。扑到近处便撕扯皮肉，留下深而参差的伤口。' },
  { ...foe('venom-cultivator', '施毒劫修', 6, 21, [700, 151, 70, 120, 1.2],
    [clearMarrow(.03), drop('condensed-marrow', .04), drop('dark-steel-scrap', .1), drop('scrap-iron', .4), drop('silver-ingot', .02)],
    { weakening: 10 }),
    description: '将毒粉藏在袖中，专挑深入苇荡的独行者动手。交锋时扬粉近身，沾染后筋肉发酸，攻守都难以用足气力。' },
  { ...foe('black-scarf-raider', '黑巾劫修', 5, 13, [660, 144, 60, 90, 1.1],
    [clearMarrow(.045), drop('condensed-marrow', .015), drop('hundred-coin-string', .15), drop('scrap-iron', .3)],
    { entryStrikes: 1 }),
    description: '以黑巾遮面，压住气息尾随携货行人，趁对方绕下堤路时突然出刃。腰间系着抢来的钱袋，护臂由碎铁片缀成。' },
  { ...foe('wandering-saber-cultivator', '截舟刀修', 6, 21, [560, 230, 48, 120, 1.2],
    [clearMarrow(.03), drop('condensed-marrow', .04), drop('dark-steel-scrap', .12),
      drop('hundred-coin-string', .25), drop('crude-iron-ingot', .25)]),
    description: '守在小舟系泊的野岸，专劫下船落单的修士。乌钢刀口崩缺不齐，岸边藏着拆散的铁料货包，见人靠近便持刀迎上。' },
  { ...foe('ravine-ambusher', '伏涧妖猿', 6, 21, [190, 340, 60, 120, 1.2],
    [clearMarrow(.03), drop('condensed-marrow', .04), drop('tough-beast-hide', .08), drop('rich-beast-meat', .08)],
    { entryStrikes: 3 }),
    description: '伏在支涧岩缝与临江树冠间，四肢细长，筋肉紧实。猎物从下方经过时便跃落，落地前后接连挥爪击打。' },
  { ...foe('inverted-mark-fox', '逆纹妖狐', 6, 21, [560, 230, 48, 120, 1.2],
    [clearMarrow(.03), drop('condensed-marrow', .04), drop('charcoal', .5), drop('tough-beast-hide', .12)],
    { reversal: true }),
    description: '常在弃营的炭堆旁徘徊，皮上逆生的纹路随妖气明灭。交锋时扰乱对手的攻守气机，使护体之力化为攻势、出手之力转作防护。' },
  { ...foe('body-tempering-rogue', '横练劫修', 6, 21, [900, 181, 40, 140, 1.2],
    [clearMarrow(.03), drop('condensed-marrow', .04), drop('silver-ingot', .01), drop('hundred-coin-string', .4)]),
    description: '常截住离开大队的携货者，凭着凝实筋骨迎刃冲撞。衣摆下缝着数只灵石袋，手臂留有多次硬接兵刃的疤痕。' },
  { ...foe('layered-talisman-cultivator', '叠符劫修', 6, 21, [900, 240, 80, 150, 1.2],
    [clearMarrow(.03), drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('charcoal', .5), drop('silver-ingot', .08)],
    { strikes: ['0.8', '1.2'] }),
    description: '将轻重两道攻符叠在指间，先以轻符试探，重符紧随而至。靠伏击渡岸修士夺取灵石和灵髓，符袋里混着不同来路的封签。' },
  { ...foe('bark-armored-shanxiao', '披木山魈', 6, 21, [1120, 236, 105, 160, 1.2],
    [clearMarrow(.03), drop('condensed-marrow', .04), drop('iron-birch-wood', .6), drop('rich-beast-meat', .15), drop('tough-beast-hide', .1)]),
    description: '栖在江岸向山野延伸的铁桦林里，以厚树皮和硬枝裹住肩背。庞大身躯擦过树干时留下深槽，护食时会连同木壳撞向来者。' },
  { ...foe('gate-stone-warden', '汲脉石魁', 7, 34, [17700, 380, 160, 200, 1.2],
    [drop('profound-marrow', 1), drop('profound-marrow', 1), drop('earth-vein-dew', 1), drop('earth-vein-dew', 1)]),
    description: '地脉灵气在岩层中聚成的石灵，躯壳嵌着深色灵髓，关节渗出浑浊灵露。盘踞石梁狭处，挥臂时整片岩壳随之挪动。' },
  { ...foe('stonebreaker-adept', '盘崖妖雕', 7, 34, [9000, 540, 50, 200, 1.2],
    [drop('profound-marrow', 1), drop('profound-marrow', 1)]),
    description: '盘踞高崖的巨雕，双翼展开时将山道罩在影下。胸腹凝着厚重灵气，以翼拍击逼近巢台的来者，巢边散有带白纹的长翎。' },
  { ...foe('vein-stone-spirit', '浊脉石灵', 7, 34, [1770, 380, 160, 200, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('earth-vein-dew', .08)]),
    description: '贴着泉眼与矿层露头缓慢移动的石灵，泥石缝中渗出浑浊灵露。平时蜷成一块湿岩，受扰时撑起岩臂撞向近处。' },
  { ...foe('brocade-horn-deer', '锦角妖鹿', 6, 21, [375, 438, 135, 160, 1.2],
    [drop('condensed-marrow', .04), drop('lustrous-hide', .5), drop('verdant-essence', .01)]),
    description: '角上锦纹清晰，常在灵泉旁啃食含灵草叶，毛皮泛着细亮光泽。护住觅食地时低头冲撞，口鼻间带有草木露液的清气。' },
  { ...foe('razorleaf-mantis', '裂叶妖螳', 6, 21, [520, 380, 150, 140, 1.2],
    [drop('condensed-marrow', .04), drop('windwoven-fiber', .03)], { rending: true }),
    description: '伏在阔叶间，腿甲缠着随风浮动的灵丝。两只前肢薄如锋刃，挥过时将枝叶与皮肉一并划开，留下狭长伤口。' },
  { ...foe('miasma-serpent', '雾毒青蛇', 6, 21, [850, 360, 90, 180, 1.2],
    [drop('profound-marrow', .03), drop('earth-vein-dew', .04)], { weakening: 10 }),
    description: '沿湿石与泉根游走的青鳞妖蛇，鳞缝沾着地脉浊露。交锋时吐出灰白毒雾，沾染者筋骨发软，出手与护身都难以用足气力。' },
  { ...foe('spring-wisp', '泉华水魅', 7, 34, [1400, 415, 50, 220, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('verdant-essence', .06)]),
    description: '灵泉与草木精华聚成的半透明水灵，身形中裹着碧色露珠。水面无风时也会逆流隆起，凝成粗长水臂拍向踏入浅泉的生灵。' },
  { ...foe('twin-saber-outlaw', '双刀劫修', 7, 34, [1400, 464, 190, 240, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('hundred-coin-string', .6), drop('silver-ingot', .1)],
    { strikes: 2 }),
    description: '藏在山谷栈道的转弯处，截住带着灵材返城的修士。两柄短刀的刃纹随掌中灵息亮起，交错斩出时各拖出一线青白锋光；腰间灵石袋的绳结与衣带样式各不相同。' },
  { ...foe('swift-shadow-wight', '掠影山鬼', 7, 34, [290, 875, 125, 360, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02)], { entryStrikes: 1 }),
    description: '山间阴湿之气聚成的灰影，形貌在薄雾下时聚时散。循着脚步贴地掠近，初现时便扑向来者，所过草叶向两侧伏倒。' },
  { ...foe('iron-robed-cultivator', '铁衣劫修', 7, 34, [1080, 550, 230, 300, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('dark-steel-ingot', .5), drop('hundred-coin-string', .5)]),
    description: '身穿嵌有乌钢片的厚袍，接引灵息的细纹贯通衣内甲片，衣摆沉重却不妨碍运步。专守林中窄路劫掠采料修士，反复修补的铆痕间仍有微光；货袋里混装着乌钢锭和零散灵石。' },
  { ...foe('ironplume-vulture', '铁翎妖鹫', 7, 34, [1080, 910, 190, 320, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('windwoven-fiber', .04), drop('spirit-beast-meat', .03)],
    { restraint: true }),
    description: '沿高原热流盘旋的妖鹫，硬翎泛着铁色，羽根缠有细亮灵丝。落地后用双翼与利爪将猎物压向岩面，胸腹筋肉间蓄着浓厚灵性。' },
  { ...foe('stoneback-rhino', '岩背妖犀', 7, 34, [870, 610, 190, 300, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('spirit-beast-meat', .05)]),
    description: '背上硬皮起伏如岩，常在宽阔草甸啃食含灵根茎。庞大身躯在泉沟旁踏出深坑，受扰时迎着来者低头冲撞。' },
  { ...foe('windskimming-falcon', '掠风妖隼', 7, 34, [720, 670, 210, 360, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('verdant-essence', .03),
      drop('earth-vein-dew', .03), drop('tough-beast-hide', .15)]),
    description: '贴着高原与石壁间的风口掠飞，常在含灵泉沟旁捕食。颈下皮膜柔韧，爪间沾着草木与地脉露液，见到活动的身影便折翼扑近。' },
  { ...foe('jade-inlaid-puppet', '引渠石傀', 8, 55, [1600, 585, 320, 360, 1.2],
    [drop('condensed-marrow', .2), drop('profound-marrow', .2)]),
    description: '胸腹嵌着灵髓，石臂上留有夹持石料的卡槽。沿干涸水渠反复搬动碎石，活物进入作业范围便被推撞驱离。' },
  { ...foe('burrowing-centipede', '钻地毒蚣', 8, 55, [700, 288, 288, 300, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('earth-vein-dew', .2), drop('tough-beast-hide', .2)],
    { ignoreDefense: true, rending: true }),
    description: '从湿暖岩缝钻出的长节毒虫，甲壳柔韧，腹足间挂着浑浊灵露。尖颚能探入衣甲缝隙，咬开皮肉后留下难以合拢的裂口。' },
  { ...foe('withered-staff-cultivator', '枯杖劫修', 8, 55, [2000, 700, 350, 270, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('ember-coal', .15), drop('tough-beast-hide', .6)]),
    description: '披着多层妖皮，在废渠与岩壁间劫掠寻材修士。枯杖以含灵老根炼成，木节嵌着磨暗的铜箍，举杖时掌中灵息沿根纹收束，落杖沉重。行囊里塞着夺来的地火煤与折好的皮料。' },
  { ...foe('coinbound-wraith', '逐财游魂', 8, 55, [3430, 720, 0, 400, 1.2],
    [drop('condensed-marrow', .04), drop('profound-marrow', .02), drop('ember-coal', .15)],
    { walletSuppressionUnit: '2000' }),
    description: '徘徊在旧行囊与散落炉煤间的游魂，扑来时仍伸着抓取财物的手。近处灵石的气息越浓，魂影越容易分散，落下的魂掌反而虚浮无力。' },
  { ...foe('baleful-saber-cultivator', '煞刀劫修', 9, 144, [2990, 1225, 400, 600, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .01), drop('earth-vein-dew', .6), drop('azure-iron-ingot', .2)],
    { strikes: 2 }),
    description: '专截携带炼材和灵髓的行路修士，刀锋带着暗红煞纹。起手两道刀势紧接而落，腰包里混装着青纹铁和封存灵露的小瓶。' },
  { ...foe('kindling-wisp', '地火木魅', 8, 55, [2100, 750, 100, 360, 1.2],
    [drop('condensed-marrow', .02), drop('profound-marrow', .04), drop('verdant-essence', .35)],
    { rampingDamage: true }),
    description: '受地火熏灼的老根聚成的灵怪，炭壳下透出碧色液光。每次鼓起根须扑击，裂隙中的火舌便再窜高一层，近身的热浪也愈发猛烈。' },
  { ...foe('vinebound-ape', '缚藤妖猿', 8, 55, [1350, 960, 240, 400, 1.2],
    [drop('condensed-marrow', .02), drop('profound-marrow', .04), drop('windwoven-fiber', .2), drop('spirit-treated-wood', .03)]),
    description: '栖在暖谷老藤中，攀援时连根扯起缠身的长蔓。常从旧栈架拆下浸养过的木条拖回巢边，伏身后以长臂猛击来者。' },
  { ...foe('baleful-vine-spirit', '汲泉藤妖', 8, 55, [3430, 720, 0, 400, 1.2],
    [drop('condensed-marrow', .02), drop('profound-marrow', .04), drop('earth-vein-dew', .15),
      drop('verdant-essence', .1), drop('windwoven-fiber', .15)]),
    description: '根须沿岩隙追着灵泉生长，粗藤内积着草木精华与地脉露液。有人触到藤网便扬起枝条抽打，撕开的外皮间拖出细长灵丝。' },
  { ...foe('shrine-gate-warden', '镇阶石卫', 9, 144, [29900, 1225, 400, 600, 1.2], [], { entryStrikes: 1 }),
    description: '高大石躯立在涵岳山门两侧，掌下石阶被磨出深凹。脚底阵纹断续闪动，来者踏近门槛便抢先挥臂，仍按旧日界线驱赶闯入者。' },
  { ...foe('mirror-wisp', '照形魅', 8, 55, [1000, 1800, 0, 700, 1.2],
    [drop('luminous-marrow', .02), drop('verdant-essence', .36)], { mirrorOpening: true }),
    description: '验器水槽的镜面上聚起薄薄灵影，底下仍有浸养木料留下的碧色露液。交手之初，灵影会照着来者的招势再挥出一击，随后轮廓渐渐散乱。' },
  { ...foe('oathbound-swordsman', '巡廊剑傀', 9, 144, [4000, 1450, 500, 800, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .01), drop('fractured-spirit-blade', .025), drop('azure-iron-ingot', .18)]),
    description: '青纹铁骨架外覆着旧甲，握剑沿校器长廊来回行走。剑刃多处崩断，臂内传动的灵纹仍会在有人靠近时亮起。' },
  { ...foe('spirit-knot', '凝砂游灵', 9, 144, [980, 830, 830, 830, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .01), drop('soul-ember', .06)], { ignoreDefense: true }),
    description: '旧聚灵槽中的细砂被残存灵意牵成一团，飘动时露出其中凝亮的砂心。它将细长灵丝探过衣甲，直接抽打护身气息。' },
  { ...foe('stone-eyed-toad', '石目妖蟾', 9, 144, [7500, 1300, 800, 650, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .01), drop('spirit-eye', .05)]),
    description: '栖在工坊积水和引渠湿石间的大蟾，眼周石纹层层隆起。长久吞食含灵水虫，体内结出眼状灵珠，遇人便鼓腹扑撞。' },
  { ...foe('array-blade-puppet', '列刃木傀', 9, 144, [1920, 2580, 280, 880, .9],
    [drop('luminous-marrow', .04), drop('jade-marrow', .01), drop('fractured-spirit-blade', .03), drop('spirit-treated-wood', .25)],
    { arrayStrikes: true }),
    description: '浸养过的木架托着数列旧灵刃，转轴上标有次序。交手越久，接通的刃列越多，额外挥出的剑势也愈发沉重。' },
  { ...foe('inverted-seal-spirit', '倒纹阵灵', 9, 144, [5800, 1150, 300, 900, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .01), drop('soul-ember', .045), drop('formation-core', .02)],
    { reversal: true }),
    description: '错接的阵线围着破损内核反复回转，散出裹着细砂的灵影。近身时，催锋与护体的灵力被牵向相反方向，纹光也随之倒转。' },
  { ...foe('binding-puppet', '牵丝工傀', 9, 144, [3000, 2500, 600, 900, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .01), drop('warding-notes', .01)], { restraint: true }),
    description: '用于固定器胚的长臂工傀，甲片内夹着残破装配图。腕间牵丝垂到地面，接近时便甩向来者衣甲，拖住腾挪的脚步。' },
  { ...foe('hollow-armor-soldier', '运材甲傀', 9, 233, [6400, 1700, 750, 1200, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .02), drop('warding-notes', .001),
      drop('fractured-spirit-blade', .05), drop('spirit-treated-wood', .5)]),
    description: '宽背甲壳下是厚重木架，两肩仍卡着搬运料箱的托钩。箱中混着断刃和浸养木条，旧驱令使它不断沿工坊与材库之间的道路巡走。' },
  { ...foe('buried-spine-beast', '伏砂棘兽', 9, 233, [6300, 2400, 1200, 1080, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .02), drop('spirit-eye', .06), drop('formation-core', .02)]),
    description: '伏在引渠积砂下的岩穴妖兽，背棘与碎石颜色相近。常把含灵碎核吞入腹中，体内也结有石纹灵珠；砂面一动便抬起棘背猛撞。' },
  { ...foe('grudge-delver', '搜材凶修', 9, 233, [3000, 4000, 1500, 1600, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .02), drop('soul-ember', .225), drop('formation-core', .06)],
    { rampingDamage: true, rampingDamageStep: 2 }),
    description: '伏在库廊中劫掠寻材者的修士，腰囊装满凝魄砂和拆下的阵核。起手后不断催动掌中凶煞，接连挥出的攻势一轮重过一轮。' },
  { ...foe('spore-veiled-wight', '菌甲木傀', 9, 233, [7000, 2250, 400, 1400, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .02), drop('azure-iron-ingot', .35), drop('earth-vein-dew', 1)],
    { weakening: 10 }),
    description: '湿渠中泡涨的木架披着青纹铁甲，菌层吸满渗入的地脉浊露。抬臂便扬起细密菌尘，沾身后使催劲与护体的气息一并受阻。' },
  { ...foe('gale-bronze-guard', '御风铜卫', 9, 233, [2800, 1800, 1000, 1600, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .02), drop('fractured-spirit-blade', .06), drop('formation-core', .02)],
    { entryStrikes: 4, entryDamageMultiplier: '5' }),
    description: '足下风纹连着铜甲内的阵枢，双臂装着宽薄灵刃。有人踏近巡守线，积存的风力便骤然放出，托起沉重身躯连番抢攻。' },
  { ...foe('marrow-flame', '游炉灵焰', 9, 233, [4200, 800, 800, 1500, 1.2],
    [drop('luminous-marrow', .04), drop('jade-marrow', .02), drop('formation-core', .06)], { ignoreDefense: true }),
    description: '温养器料的旧火座旁游动着一团灵焰，焰心裹着尚未熄灭的炉枢。细火会绕过衣甲钻向护身灵息，散开时露出内里的残核。' },
  { ...foe('vault-armored-guard', '玄煞库卫', 10, 377, [5500, 3360, 1280, 1800, 1.2],
    [drop('jade-marrow', .04), drop('crimson-marrow', .005), drop('baleful-alloy', .03)]),
    description: '材库重门旁的厚甲守卫，玄煞铁甲片叠到膝下，胸内灵髓仍在供灵。它沿料架间的石轨缓步巡行，举起沉臂击退靠近者。' },
  { ...foe('four-seal-warden', '镇枢金卫', 11, 987, [270000, 7500, 3750, 5000, 1.2],
    [drop('crimson-marrow', 1), drop('crimson-marrow', 1), drop('vault-bond', 1)], { noToughnessXp: true }),
    description: '镇守侧坪阵枢的高大傀卫，甲内赤色灵髓映亮层叠金片。躯干中的赤纹灵金连向足下阵座，仍在驱动它守住各自的旧界线。' },
  { ...foe('root-entwined-idol', '榕根古像', 10, 377, [135000, 2900, 1800, 2000, 1.2],
    [drop('returning-lamp', 1)], { entryStrikes: 4, entryDamageMultiplier: '5' }),
    description: '老榕根须穿过庭中石像，掌下石龛留着一盏青铜灯。来者靠近时，盘结的根条与石臂一同扬起，接连扫过龛前空地。' },
  { ...foe('blood-oath-shadow', '照血阵影', 10, 377, [81000, 4800, 2000, 2000, 1.2],
    [drop('crimson-marrow', 1), drop('jade-marrow', 1), drop('jade-marrow', 1)], { currentHpAttackDivisor: '200' }),
    description: '内院关口的赤色阵纹映出人形，光脉随着来者的气血起伏。近前之人气血越充盈，影中聚起的锋芒便越强，身后供灵的髓光也随之闪动。' },
  { ...foe('uprooted-wood-wight', '渠根木魅', 10, 377, [13500, 2900, 1800, 3000, 1.2],
    [drop('jade-marrow', .04), drop('crimson-marrow', .005), drop('formation-core', .12)],
    { entryStrikes: 4, entryDamageMultiplier: '5' }),
    description: '穿入旧渠阵匣的根须缠着残核，木身拖出淤泥时仍带着碎石塞。来者踏近，数条粗根便接连暴起，扫过狭长渠沿。' },
  { ...foe('bloodpool-shadow', '照血胶灵', 10, 377, [8100, 4800, 2000, 3000, 1.2],
    [drop('jade-marrow', .04), drop('crimson-marrow', .005), drop('flowing-essence-gel', .03)],
    { currentHpAttackDivisor: '200' }),
    description: '积在废槽中的凝胶裹住了赤色阵纹，沿石壁拉出半透人形。它映着来者的气血起伏，气血越充盈，胶体中凝出的锋芒便越强。' },
  { ...foe('soulbinding-wraith', '缚渠阵灵', 10, 377, [3750, 5000, 900, 3600, 1.2],
    [drop('jade-marrow', .04), drop('crimson-marrow', .005), drop('soul-ember', .2)], { strikes: 3, rending: true }),
    description: '旧渠闸旁的束流阵纹早已错位，裹着细砂的灵光仍反复收束。数道光索接连抽向经过者，索缘留下撕裂的伤口，散落砂粒间犹有微光。' },
  { ...foe('renegade-manor-saber', '伏渠刀修', 10, 377, [3000, 5500, 3000, 4200, 1.2],
    [drop('jade-marrow', .04), drop('crimson-marrow', .005), drop('fractured-spirit-blade', .25)]),
    description: '潜伏在封停支渠中的劫掠刀修，手中灵刃留着重炼后的接痕，催气时断续刃纹贯成一线。专截携料离院的修士，腰间串着几截折断灵刃，行囊里混放着夺来的灵髓与旧器。' },
  { ...foe('essence-thieving-bat', '映灵妖蝠', 10, 610, [22200, 4800, 1000, 3750, 1.2],
    [drop('jade-marrow', .03), drop('crimson-marrow', .02), drop('frost-veined-hide', .05), drop('soul-ember', .1)],
    { entryStatRatio: '0.1' }),
    description: '倒悬在湿廊与丹房顶隙间的妖蝠，翼膜交错着冷白细纹，腹下凝有含灵砂粒。迎向来者时，翼纹映出相似的灵息，爪翼也随之强健敏捷。' },
  { ...foe('armored-moss-spirit', '披甲苔灵', 10, 610, [8900, 6000, 2400, 4800, 1.2],
    [drop('jade-marrow', .03), drop('crimson-marrow', .02), drop('flowing-essence-gel', .04), drop('baleful-alloy', .04)]),
    description: '废弃甲片上的湿苔积成团块，根丝把玄煞铁残片拢成外壳。挪动时胶质从甲缝缓缓挤出，铁片相互碰撞，拖过丹房的石砖。' },
  { ...foe('redspine-feral-beast', '赤脊凶兽', 10, 610, [10500, 3400, 2600, 4800, 1.2],
    [drop('jade-marrow', .03), drop('crimson-marrow', .02), drop('feral-heart-meat', .09), drop('spirit-eye', .1)],
    { extraStrike: { coefficient: '1.5', damageMultiplier: '2' } }),
    description: '沿暖热石槽活动的大兽，赤色脊骨从厚皮下隆起，体内蓄着浓厚精血与石纹灵珠。扑咬之后会猛然甩身，以脊背补上一记重击。' },
  { ...foe('earthfire-wisp', '地火游煞', 10, 610, [1080, 16000, 4000, 5400, 1.2],
    [drop('jade-marrow', .03), drop('crimson-marrow', .02), drop('soul-ember', .45)]),
    description: '失修通火槽中聚起的火煞，暗红焰身裹着细砂与髓光，沿旧槽游移。靠近时火光骤然团起，迎面撞向来者。' },
  { ...foe('broken-talisman-cultivator', '残符邪修', 10, 610, [7500, 3000, 3000, 5500, 1.2],
    [drop('jade-marrow', .03), drop('crimson-marrow', .02), drop('frost-veined-hide', .07)],
    { ignoreDefense: true, restraint: true }),
    description: '以寒纹皮片续补残符的劫掠修士，袖口还挂着从他人行囊上割下的绳扣。符光贴住对手身形，细芒绕过衣甲落下。' },
  { ...foe('fivefold-curse', '五重炉禁', 10, 610, [16900, 5750, 1800, 5750, 1.2],
    [drop('jade-marrow', .03), drop('crimson-marrow', .02), drop('formation-core', .25)],
    { entryStrikes: 5, entryAttackCoefficient: '0.9' }),
    description: '丹房炉座外的五层旧禁脱离了石壁，围着破裂阵核叠合游动。感到外物靠近，五层符光便依次弹出，炉座上的引火阵线却早已断开。' },
  { ...foe('edict-enforcer', '护枢禁卫', 11, 987, [9999, 6999, 3499, 6000, 1.2],
    [drop('crimson-marrow', .04), drop('verdant-marrow', .005), drop('vault-bond', .05)],
    { ignoreDefense: true, defensiveFlash: true }),
    description: '守在总渠阵匣附近的旧禁卫，赤纹灵金贯通外甲，胸内髓光映出一层护罡。臂上短戈吐出的细芒能越过衣甲，外甲上的光纹则在受击时骤然收紧。' },
  { ...foe('vault-bronze-sentinel', '护材铜卫', 11, 987, [27000, 7500, 3750, 6000, 1.2],
    [drop('crimson-marrow', .04), drop('verdant-marrow', .005), drop('formation-core', .2), drop('vault-bond', .05)]),
    description: '往返于育材槽与库廊之间的铜卫，胸腹厚甲护住聚灵阵核，灵金料片沿关节嵌合。旧料架已经搬空，它仍举着铜臂阻挡踏入旧界线的人。' },
  { ...foe('frenzied-bone-general', '叠劲工傀', 11, 987, [8450, 8880, 4440, 6000, 1.2],
    [drop('crimson-marrow', .04), drop('verdant-marrow', .005), drop('formation-core', .2), drop('soul-ember', .3)],
    { rampingDamage: true }),
    description: '曾用于搬动沉重石槽的铁骨工傀，臂架比身躯更宽，破裂枢核周围积着含灵细砂。每次挥臂，层叠劲纹便再亮起一重，落下的力道也一击重过一击。' },
  { ...foe('web-broodmother', '盘丝母蛛', 11, 987, [8000, 9500, 4000, 7800, 1.2],
    [drop('crimson-marrow', .04), drop('verdant-marrow', .005), drop('flowing-essence-gel', .1)], { strikes: 2 }),
    description: '占住育材石床的大型妖蛛，腹下鼓着半透明胶囊，厚网从废槽一直牵到岩顶。两只坚硬前足交替刺出，网面随它的挪动沉沉起伏。' },
  { ...foe('budding-moss-spirit', '分芽苔灵', 11, 987, [5000, 7600, 3800, 4800, 1.2],
    [drop('crimson-marrow', .04), drop('verdant-marrow', .005), drop('formation-core', .1), drop('flowing-essence-gel', .08)],
    { strikes: 3 }),
    description: '育材槽中的苔芽裹着残核长成团块，透明胶质连着几簇隆起的苔冠。察觉震动后，苔冠接连探出抽击，根部却始终拢在同一团胶体上。' },
  { ...foe('rock-piercing-owl', '穿岩枭', 11, 987, [17500, 8000, 3500, 7200, 1.2],
    [drop('crimson-marrow', .04), drop('verdant-marrow', .005), drop('feral-heart-meat', .075),
      drop('spirit-eye', .15), drop('frost-veined-hide', .1)]),
    description: '在石窟通风口筑巢的妖枭，喙爪坚硬，翼下薄皮带着寒白灵纹。它啄食含灵石粒与穴中生灵，胸腹精血浓厚，体内也结出眼状石纹灵珠。' },
  { ...foe('relic-plundering-cultivator', '借命劫修', 11, 1597, [1, 15000, 6500, 7800, 1.2],
    [drop('crimson-marrow', .03), drop('verdant-marrow', .01), drop('soul-ember', 1)], { entryHealthRatio: '0.5' }),
    description: '潜伏在后凿窄洞中的劫修，腰挂夺来的行囊，衣内借命符以凝魄砂描成。交手前符光映照来者的攻守气机，原本枯瘦的躯体随之鼓起，气血一时充盈。' },
  { ...foe('earthshaking-feral-beast', '撼地凶猊', 11, 1597, [25000, 9000, 5000, 8400, 1.2],
    [drop('crimson-marrow', .03), drop('verdant-marrow', .01), drop('feral-heart-meat', .3), drop('spirit-eye', .25)]),
    description: '循着水声钻入院底的厚颈凶兽，宽掌踏过浅渠，石面也随之震动。体内蓄着浓厚精血与石纹灵珠，拱起肩背时便猛然撞向近处的身影。' },
  { ...foe('warped-fungus-puppet', '畸生菌傀', 11, 1597, [14000, 5500, 6500, 8000, 1.2],
    [drop('crimson-marrow', .03), drop('verdant-marrow', .01), drop('flowing-essence-gel', .1), drop('frost-veined-hide', .1)],
    { attackCoefficientMultiplier: '2' }),
    description: '湿槽中的菌丝托起废弃傀架，凝厚菌膜浮着寒白细纹，关节间挤出半透明胶液。两臂长短不一，菌束收紧时却能把朽木架挥得沉猛异常。' },
  { ...foe('rift-chasing-wight', '逐隙灵魈', 11, 1587, [36500, 10040, 2333, 8000, 1.2],
    [drop('crimson-marrow', .03), drop('verdant-marrow', .02), drop('flowing-essence-gel', .18)],
    { agilityDeficit: { threshold: '8000', scale: '5' } }),
    description: '旧渠凝胶聚成的灵魈，半透躯体在石隙中伸缩，细碎髓光藏在胸腹。它循着来者转步的空隙逼近，步法越迟缓，胶臂越能聚实了击落。' },
  { ...foe('softbone-spirit-moth', '柔翅灵蛾', 11, 1597, [14000, 5500, 6500, 8000, 1.2],
    [drop('crimson-marrow', .03), drop('verdant-marrow', .01), drop('frost-veined-hide', .22)],
    { entryStrikes: 5, entryAttackCoefficient: '0.9', softBones: true }),
    description: '附着在温湿阵槽边的灵蛾，柔韧翼膜上交错着冷白细纹。近身时翅缘接连掠过，受击便贴着力道弯折；前扑的薄翼也容易被强劲攻势压回。' },
  { ...foe('pale-bone-tendril', '白须菌灵', 11, 1597, [6000, 13000, 7200, 9000, 1.2],
    [drop('crimson-marrow', .03), drop('verdant-marrow', .01), drop('flowing-essence-gel', .12), drop('vault-bond', .06)]),
    description: '阵槽裂隙中垂下的苍白菌须，根团裹着从旧阵线上剥离的灵金片，胶质沿须缓缓下坠。下端细须贴地探行，遇到震动便拢成一束横扫。' },
  { ...foe('unbroken-stone-sentinel', '封枢石卫', 12, 2584, [32, 11111, 0, 10081, 1.2],
    [drop('verdant-marrow', .015), drop('vault-bond', .16)], { sturdy: true }),
    description: '列在总枢门前的石卫，层层紧扣的石甲护住髓核，赤纹灵金从甲缝穿过。兵刃落在壳面上只崩出细屑，石臂仍沿着旧阵座的边界挥击。' },
  { ...foe('earthfire-core', '聚火煞灵', 10, 610, [10800, 16000, 4000, 5400, 1.2],
    [drop('golden-marrow', 1)]),
    description: '悬台聚火阵中长年凝起的火煞，焰身围着一块金色髓核转动。分火构件虽已拆走，它仍聚在旧穴上方，将伸向穴口的身影撞开。' },
  { ...foe('furnace-guard-wight', '蹑隙灵魈', 11, 1587, [365000, 10040, 2333, 8000, 1.2], [],
    { agilityDeficit: { threshold: '8000', scale: '5' } }),
    description: '盘踞调火廊隙的灵魈，长臂贴着石壁游走，身形随来者脚步忽隐忽现。对手步法越迟缓，它越能循着空隙逼近，落掌时的力道也越重。' },
  { ...foe('manor-spirit-vessel', '涵岳枢灵', 18, 1346269, [120000000, 4000000, 600000, 800000, 1], [],
    { noToughnessXp: true }),
    description: '各层水火阵线在总枢石台上聚成披着光纹的阵灵，胸前残缺的巡枢印纹仍与旧令呼应。主匣早已拆空，它却依旧汲取残存阵力，将靠近者阻在封停界线之外。' },
  { ...foe('withering-fungus', '缠渠藤妖', 12, 2584, [36000, 13600, 6400, 8000, 1],
    [drop('verdant-marrow', .015), drop('soul-ember', .5), drop('flowing-essence-gel', .24),
      drop('marsh-lotus-seed', .3)], { weakening: 10 }),
    description: '粗藤沿失修石渠缠成根团，胶液间裹着含灵沉砂与成熟莲蓬。藤条逼近时渗出灰绿气息，使交手者发力与护身都显得迟滞。' },
  { ...foe('jade-scale-moth', '碧背泽蜥', 12, 2584, [16000, 14000, 7000, 8400, 1.3],
    [drop('verdant-marrow', .015), drop('feral-blood-essence', .08), drop('soul-ember', .5)]),
    description: '碧背长蜥伏在药泽浅水与旧渠石沿间，腹中积着吞入的含灵细砂，筋肉中凝有碧润精粹。它贴着水面迅速扑咬，湿鳞在转身时闪出细光。' },
  { ...foe('leaf-talisman-adept', '掠药符修', 12, 2584, [23000, 8000, 8000, 8000, 1.3],
    [drop('verdant-marrow', .015), drop('vault-bond', .08), drop('beast-core-shard', .08),
      drop('marsh-lotus-seed', .3)], { ignoreDefense: true }),
    description: '专劫寻材者药包的符修，腰间药匣混放着莲实、聚灵砂核与拆取的赤纹灵金。指间符光凝成细芒，沿衣甲难以遮护的缝隙钻入。' },
  { ...foe('woodland-crossbowman', '伏泽弩修', 12, 2584, [9900, 70000, 7000, 9000, 1],
    [drop('verdant-marrow', .015), drop('vault-bond', .03), drop('carapace-fragment', .10)], { missPunishment: '1000' }),
    description: '藏在药泽断堤中的劫修，怀抱以妖甲硬片加固的灵弩，赤纹灵金沿弩臂接入机槽。催器时弦槽聚起细亮灵光，近身发射力道极重；专截携料归埠的修士，对手一击落空便趁隙划出伤口。' },
  { ...foe('spring-jade-toad', '盘泉玉蟾', 12, 2584, [48000, 18000, 5000, 7600, 1],
    [drop('clear-spring-saliva', .25), drop('soul-ember', .5), drop('verdant-marrow', .015)],
    { periodicStrike: { every: 3, coefficient: '1.5' } }),
    description: '玉色妖蟾伏在泉池石沿，颈腹间透着汲聚泉水而生的微光，唇边凝有清润药涎。它接连扑击两次后鼓腹收肢，再猛然蹬石撞出，随后重新伏稳蓄劲。' },
  { ...foe('jade-toad-chief', '抱玉蟾魁', 12, 5168, [144000, 18000, 5000, 7600, 1],
    [drop('clear-spring-saliva', .5), drop('soul-ember', 1), drop('verdant-marrow', .03)],
    { periodicStrike: { every: 3, coefficient: '1.5' } }),
    description: '泉窟深池的玉蟾首领，伏身收肢时如抱着一团泉光，颈腹玉色透过厚皮。它沿用两次扑击后鼓腹重撞的节奏，身躯更耐久，能在池沿与来者久久相持。' },
].map((entry) => [entry.definition.id, entry]));

export interface RegionDefinition {
  // The associated safe location is the retreat/defeat destination, not an entry requirement.
  name: string; parent: string; prerequisite: string | null;
  description?: string;
  pool: string[]; groupSize: 1 | 2; groups: number; firstXp: string; repeatXp: string; challenge: boolean;
  // One-based group positions within each clear override the ordinary random pool.
  encounterPools?: Record<number, string[]>;
  firstItems?: Record<string, number>;
  repeatLoot?: { maxLevel: number; entries: LootEntry[] };
  enemyMultiplier?: string;
}
const region = (
  name: string, parent: string, prerequisite: string | null, pool: string[],
  firstXp: number, repeatXp: number, groupSize: 1 | 2 = 1,
): RegionDefinition => ({
  name, parent, prerequisite, pool, groupSize,
  groups: 20, firstXp: String(firstXp), repeatXp: String(repeatXp), challenge: false,
});
export const REGIONS: Record<string, RegionDefinition> = {
  'village-outskirts': {
    ...region('近村柴坡', 'qingshi-village', null,
      ['mountain-rat', 'wild-badger', 'stray-dog'], 8, 4),
    description: '田埂尽头接着打柴的小坡。柴棚和旧猎夹散在林缘，野兽时常下坡觅食；沿溪的小径通向上游炭林。',
  },
  'abandoned-road': {
    ...region('旧炭林', 'qingshi-village', 'village-outskirts',
      ['stray-dog', 'roadside-thief', 'club-raider', 'hide-bandit', 'fire-thrower'], 12, 6),
    description: '几座停用的土炭窑藏在杂木间，炭屑混入林土，树上还挂着残断的麻绳猎套。林深处已有野兽占窝。',
  },
  'stony-trail': {
    ...region('溪源裂壁', 'qingshi-village', 'abandoned-road',
      ['club-raider', 'wildcat', 'mountain-wight', 'black-backed-wolf'], 16, 2),
    description: '溪谷渐窄，水边散着含玉石砾与旧营火的炭迹。滑落的岩土下露出整齐凿痕，一段封石已裂开；另一条猎径绕向山脚。',
  },
  'mine-front': {
    ...region('灰脊外坡', 'foothill-camp', 'stony-trail',
      ['black-backed-wolf', 'masked-bladesman', 'red-eyed-shanxiao', 'twin-blade-raider', 'mine-brigand'], 20, 3),
    description: '翻过分水岭，山径朝外侧河谷延伸。兽蹄印间逐渐多了草鞋印，山外岔路接到坡上；岩后散着割断的绑货绳，横木挡住了几处窄道。',
  },
  'mine-tunnels': {
    ...region('铁桦夹道', 'foothill-camp', 'mine-front',
      ['mine-brigand', 'mine-sentry', 'ward-eye', 'bone-gnawing-shanxiao', 'ambush-ape'], 30, 5),
    description: '铁桦与两侧岩壁夹着一线山道，树根间露出含玉碎石。高枝上有新折的断口，转角处立着钉铁木栅，几只炭盆摆在路旁。',
  },
  'mine-depths': {
    ...region('崩石险坡', 'foothill-camp', 'mine-tunnels',
      ['bone-gnawing-shanxiao', 'ambush-ape', 'ember-cultivator', 'armored-bandit-chief', 'cave-boar', 'outlaw-swordsman'], 40, 7),
    description: '旧行路贴着崩塌的山坡绕行，几处岩棚下堆着兽骨与废猎夹。较宽的棚中晾着皮衣，拆开的货包围在火塘边，坡上留下了新的刀痕。',
  },
  'mountain-pass': {
    ...region('河谷岔道', 'foothill-camp', 'mine-depths',
      ['charred-wood-puppet', 'ambush-ape', 'masked-bladesman', 'green-backed-wolf', 'cave-boar', 'outlaw-swordsman'], 50, 10, 2),
    description: '坡势渐缓，几条支路沿河谷汇合，远处已能看到宽阔车辙。支路边留着过火的老根和废营火，树丛与巨石遮住了通往隘口的视线。',
  },
  'serpent-ridge': {
    ...region('横岩隘口', 'foothill-camp', 'mountain-pass', ['ridge-python'], 0, 0),
    groups: 1, challenge: true,
    description: '横出的巨岩将道路挤成窄口，地面布满深蹄印，粗硬鬃毛挂在石缝间。隘外铺路石上的修补痕迹清晰可见，车辙沿河通向山外市镇。',
  },
  'market-backstreets': {
    ...region('镇外芦滩', 'hillside-market', 'serpent-ridge',
      ['charred-wood-puppet', 'extortionist', 'red-backed-badger', 'light-armored-construct', 'vinebound-beast'], 75, 18),
    description: '河道改流后留下的浅滩，芦根间夹着冲来的焦木。靠镇一侧还留着晒皮架，往外的窄路已被高草遮住；泥上交叠着拖行的腹痕与新旧脚印。',
  },
  'kiln-alley': {
    ...region('淤湾苇荡', 'hillside-market', 'market-backstreets',
      ['red-backed-badger', 'light-armored-construct', 'vinebound-beast', 'swift-blade-puppet', 'miasma-toad', 'stone-ward-spirit'], 90, 24),
    description: '旧河床在这里积成回弯，断桩旁埋着沉下的旧货，含玉砾石露出淤泥。高苇掩住水洼，也掩住通向废埠货棚的脚印。',
  },
  'scripture-cave': {
    ...region('废埠匪窝', 'hillside-market', 'kiln-alley', ['cave-guardian'], 0, 0, 2),
    groups: 1, challenge: true,
    description: '搬迁后闲置的旧货棚被芦苇遮住，棚内堆着不同商号的货袋。两名持刃劫修守住入口，地上的拖痕一路通向滩边。',
  },
  'market-gardens': {
    ...region('回水深滩', 'hillside-market', 'kiln-alley',
      ['swift-blade-puppet', 'miasma-toad', 'stone-ward-spirit', 'brocade-marten', 'rending-shanxiao', 'venom-cultivator'], 110, 28),
    description: '深潭绕着几片高地，临水老树连成遮阴的密林。树下散着兽毛与剥落的皮片，较干的路边却留有拆开的药纸和刃痕；沿旧堤可循路返镇。',
  },
  'market-outer-road': {
    ...region('汇川长堤', 'hillside-market', 'market-gardens',
      ['rending-shanxiao', 'venom-cultivator', 'black-scarf-raider', 'wandering-saber-cultivator', 'ravine-ambusher', 'inverted-mark-fox'], 130, 32),
    description: '镇河在长堤尽头汇入沧流江，对岸山脊隔着宽阔水面铺开。刻着分水纹的货舟逆流而行，远处成排的阵灯标着航道；堤脚林路穿过支汊，兽迹与截断的货绳散在苇间。',
  },
  'old-ferry-bank': {
    ...region('沧流故渡', 'hillside-market', 'market-outer-road',
      ['wandering-saber-cultivator', 'ravine-ambusher', 'inverted-mark-fox', 'body-tempering-rogue',
        'layered-talisman-cultivator', 'bark-armored-shanxiao'], 150, 40, 2),
    description: '旧渡阶沿江岸没入水中，下游新埠的高桅与楼台已连成一片。大队货舟循阵灯驶过，旧岸的小径却被密林和支涧隔断，倒伏的系舟柱后留着藏货的浅坑。沿岸越过石梁便能抵达望川外埠。',
  },
  'stone-gate-pass': {
    ...region('悬江石梁', 'hillside-market', 'old-ferry-bank', ['gate-stone-warden'], 0, 0),
    groups: 1, challenge: true,
    description: '临江旧路借一脊天然石梁横过支峡，峡水在数十丈下汇入大江。裸露岩层泛着湿润灵光，汲聚地气的石魁堵住窄处；越过梁脊，已能看见沿高岸层层铺开的望川城埠。',
  },
  'waystation-duel': {
    ...region('回风崖口', 'cloudfoot-waystation', 'stone-gate-pass', ['stonebreaker-adept'], 0, 0),
    groups: 1, challenge: true, firstItems: { 'weathered-route-chart': 1 },
    description: '山路绕过一面迎风高崖，沧流江与望川城街在下方展开，远处群峰间留着一线明亮天光。盘崖妖雕据着崖边岩台，长翎随风低鸣；越过巢台，白瀑与苍翠岩地逐层显露。',
  },
  'reed-marsh': {
    ...region('叠泉台地', 'cloudfoot-waystation', 'waystation-duel',
      ['bark-armored-shanxiao', 'vein-stone-spirit', 'brocade-horn-deer', 'razorleaf-mantis', 'miasma-serpent', 'spring-wisp'], 200, 50),
    description: '宽阔岩台沿山势逐层展开，几道白瀑将苍翠草木分成深浅不同的长带。灵泉旁的叶心凝着碧露，细丝在风中浮起淡纹；晴光落在石面上，泉雾仍久久停在低处。高台可远望城埠，林泉深处有妖物往来。',
  },
  'pine-ravine': {
    ...region('青岚灵谷', 'cloudfoot-waystation', 'reed-marsh',
      ['miasma-serpent', 'spring-wisp', 'twin-saber-outlaw', 'swift-shadow-wight', 'iron-robed-cultivator'], 220, 54),
    description: '长谷两侧的青白岩壁相对展开，灵泉绕过苍翠林地，岩根露出交错青纹的矿层。谷中晴光明净，林隙却留着不散的青雾，旧栈道隐入其中；翻倒料筐与刃痕留在返城路边，谷外通往望川西市。',
  },
  'stonefang-wilds': {
    ...region('云屏高原', 'cloudfoot-waystation', 'pine-ravine',
      ['ironplume-vulture', 'iron-robed-cultivator', 'stoneback-rhino', 'windskimming-falcon', 'jade-inlaid-puppet'], 240, 60),
    description: '苍翠草甸越过一道道白色岩脊，远峰如屏，云影在开阔山地缓缓移过。望川城街已缩成江畔一线，大兽沿含灵草地迁行，妖禽乘热流盘旋；旧石渠只在几处低地横过，嵌髓石傀仍搬动着散落石料。',
  },
  'thornwild-slope': {
    ...region('盘藤石壁', 'cloudfoot-waystation', 'stonefang-wilds',
      ['windskimming-falcon', 'jade-inlaid-puppet', 'burrowing-centipede', 'withered-staff-cultivator',
        'coinbound-wraith', 'baleful-vine-spirit'], 300, 80),
    enemyMultiplier: '1.1',
    description: '高原尽头，长藤沿青白石壁垂成数道翠幕，老栈架绕过岩间平台。部分含灵藤叶在背阴处仍透着润泽光色，暖泉从低处石隙涌出；干涸旧渠隐在藤后，虫影与劫掠者藏于断栈之间。',
  },
  'baleful-valley': {
    ...region('地火裂谷', 'cloudfoot-waystation', 'thornwild-slope',
      ['withered-staff-cultivator', 'coinbound-wraith', 'baleful-saber-cultivator',
        'kindling-wisp', 'vinebound-ape', 'baleful-vine-spirit'], 360, 100),
    enemyMultiplier: '1.1',
    description: '赤色岩壁间，几道地火裂隙映亮谷底，暖泉两侧却长着青碧密林。火光与草木露光在岩面相接，旧养木台散在高低石地上；通山石道越过窄裂，藤根、火魅与持械伏影盘踞路旁。',
  },
  'ruined-shrine-road': {
    ...region('引泉长阶', 'cloudfoot-waystation', 'baleful-valley',
      ['withered-staff-cultivator', 'coinbound-wraith', 'baleful-saber-cultivator',
        'kindling-wisp', 'vinebound-ape', 'baleful-vine-spirit'], 420, 120),
    enemyMultiplier: '1.2',
    description: '宽阔石阶沿山腰升向涵岳，白墙与殿檐从林间一层层露出。阶旁古引泉槽仍留着浅淡阵纹，残泉受纹路牵引，贴着石沿越过一处缺口；根藤侵入停用的蓄水台，暖雾隔开前后几段长阶。',
  },
  'shrine-gate-duel': {
    ...region('涵岳山门', 'cloudfoot-waystation', 'ruined-shrine-road', ['shrine-gate-warden'], 0, 0, 2),
    groups: 1, challenge: true,
    description: '两列石柱托起宽大山门，门额刻着「涵岳」，重檐后的白墙随山势层层升高。古泉槽从柱后分入院落，两尊镇阶石卫立在阶顶；逼近时，足下旧阵由近及远亮起，映出门内悠长的廊影。',
  },
  'seal-guardian-ring': {
    ...region('四枢阵坪', 'sunken-manor-entrance', 'shrine-gate-duel', ['four-seal-warden'], 0, 0),
    groups: 4, challenge: true,
    description: '侧道连接四座依山展开的阵坪，方整石地与崖外层叠青峰相对。供灵纹路从山壁延入阵座，每坪的镇枢金卫各守一方，赤纹金片在甲内明灭；通往前庭的主路从侧旁绕过。',
  },
  'rusted-corridor': {
    ...region('校器长廊', 'manor-outer-court', 'shrine-gate-duel',
      ['mirror-wisp', 'oathbound-swordsman', 'spirit-knot', 'binding-puppet', 'array-blade-puppet'], 480, 160),
    description: '开阔长廊沿高窗伸向几座旧器坊，柱影与庭外晴光在地面交替。墙边验器水槽无风自平，浸过的灵刃将细纹映入水底，几道灵影仍在镜面游动；巡廊傀儡守着验刃石与牵丝架。',
  },
  'puppet-court': {
    ...region('制傀工坊', 'manor-outer-court', 'rusted-corridor',
      ['stone-eyed-toad', 'array-blade-puppet', 'inverted-seal-spirit', 'binding-puppet', 'hollow-armor-soldier'], 540, 180),
    description: '高顶器坊环抱一片敞院，未装完的木架傀躯立在石案旁，铁骨与灵枢仍嵌在装配槽内。几缕旧阵牵丝悬着待接的傀臂，浸木池映出倒转阵光；仍在动作的工傀沿空工位来回行走。',
  },
  'buried-gallery': {
    ...region('沉砂引渠', 'manor-outer-court', 'puppet-court',
      ['hollow-armor-soldier', 'stone-eyed-toad', 'buried-spine-beast', 'spore-veiled-wight', 'gale-bronze-guard'], 600, 200),
    description: '山腹阔廊以石拱分出几层高低通道，天光从上方长隙落下，照亮缓缓流动的泉水与沉砂。旧引泉纹在局部渠壁上仍有微光，浅水贴着石面穿过高低错层；铜卫沿上层运材道巡行，旧甲与兽影藏在积砂间。',
  },
  'sealed-vault': {
    ...region('涵岳材库', 'manor-outer-court', 'buried-gallery',
      ['buried-spine-beast', 'grudge-delver', 'spore-veiled-wight', 'gale-bronze-guard', 'marrow-flame', 'vault-armored-guard'], 720, 240),
    description: '几座沿山叠起的高库以深廊相连，厚重石门后的封灵匣分别收存木料、灵铁与阵枢。空架间，温养火座浮着不随穿堂风摇动的余焰；门沿旧禁与匣内髓光交映，守卫和劫掠者各占不同廊口。',
  },
  'stone-root-court': {
    ...region('静养榕庭', 'manor-outer-court', 'buried-gallery', ['root-entwined-idol'], 0, 0),
    groups: 1, challenge: true,
    description: '支阶尽头，老榕将树冠铺过一座安静庭院，枝隙天光落在围池石座上。根须穿入座前灯龛，浅水倒映着层层绿叶，树下无风时细根也缓缓舒展；最深处古像的掌下仍留着一盏微亮青灯。',
  },
  'manor-seal-gate': {
    ...region('内院灵关', 'manor-outer-court', 'sealed-vault', ['blood-oath-shadow'], 0, 0),
    groups: 1, challenge: true,
    description: '材库后方的长阶收束于内院石门，成对墙柱将庭外天光留在身后。泉槽与火座的细纹汇入门沿，赤色阵影在静止的光脉间凝成人形，随来者气血明灭；门后另一层石台通向幽深院房。',
  },
  'rootbound-passage': {
    ...region('封渠地廊', 'manor-inner-threshold', 'manor-seal-gate',
      ['uprooted-wood-wight', 'bloodpool-shadow', 'soulbinding-wraith', 'renegade-manor-saber', 'essence-thieving-bat'], 1200, 400),
    description: '内院下方，成列石拱将长廊引入山腹，壁上院房号次与整齐封塞留下撤停的痕迹。分泉槽中的残光沿石面转过拱脚，根须已穿入废置阵匣；昏明交替的远端分别通向丹房与分火悬台。',
  },
  'ruined-elixir-hall': {
    ...region('涵岳丹坊', 'manor-inner-threshold', 'rootbound-passage',
      ['essence-thieving-bat', 'armored-moss-spirit', 'redspine-feral-beast', 'earthfire-wisp',
        'broken-talisman-cultivator', 'fivefold-curse'], 1500, 500),
    description: '丹房沿山腹层层展开，深处地火将空炉座映成温红色，院顶泉气凝成淡白长带。炉座外残留的符禁已脱离石壁，围着碎核缓缓叠合；空运器架与拆卸卡槽仍在，门侧刻着“丹器迁运，地炉封存”。',
  },
  'edict-corridor': {
    ...region('巡枢长廊', 'manor-inner-threshold', 'ruined-elixir-hall',
      ['redspine-feral-beast', 'earthfire-wisp', 'broken-talisman-cultivator', 'edict-enforcer',
        'vault-bronze-sentinel', 'frenzied-bone-general'], 1800, 600),
    description: '丹坊后，高窗长廊连通多层院房，廊外白墙与青瓦在山雾间时隐时现。壁中灵金阵线分向泉闸、地炉与育材石窟，几段已经拆空，铜牌仍悬在旧位；傀卫经过时，残纹逐段亮起又沉下。',
  },
  'brood-cavern': {
    ...region('育材石窟', 'manor-inner-threshold', 'edict-corridor',
      ['edict-enforcer', 'vault-bronze-sentinel', 'frenzied-bone-general', 'web-broodmother',
        'budding-moss-spirit', 'rock-piercing-owl'], 2100, 700),
    description: '几层岩台环抱开阔石窟，上方天隙照亮苍翠菌冠与浸养木料。旧育材槽仍聚着温润泉气，含灵菌苔沿空匣位长成厚垫，胶珠在叶状菌膜间缓缓聚拢；蛛网与妖禽巢穴占着高处通风口。',
  },
  'relic-underchannel': {
    ...region('回流暗渠', 'manor-inner-threshold', 'brood-cavern',
      ['budding-moss-spirit', 'rock-piercing-owl', 'relic-plundering-cultivator', 'earthshaking-feral-beast',
        'warped-fungus-puppet', 'rift-chasing-wight'], 2400, 800, 2),
    description: '育材区下方，石拱与旧闸跨过一片暗水，胶质和含灵沉砂积在院底石池中。水面将断续阵光映到拱顶，几团胶影在岩隙间伸缩；后凿窄洞里留着撬痕、断背带和兽爪印，渠末石阶沿残纹向上。',
  },
  'heartward-path': {
    ...region('归枢长阶', 'manor-inner-threshold', 'relic-underchannel',
      ['earthshaking-feral-beast', 'warped-fungus-puppet', 'rift-chasing-wight', 'softbone-spirit-moth',
        'pale-bone-tendril', 'unbroken-stone-sentinel'], 3000, 1000, 2),
    description: '宽阔长阶在层叠院墙间升向总枢，高处殿檐隔着山雾，只露出安静的青黑轮廓。泉闸、地炉与育材区的阵线逐段汇入阶下，灵金细纹从拆空支槽旁延过；石卫背后，一扇重门收住了内院阵光。',
  },
  'earthfire-platform': {
    ...region('分火悬台', 'manor-inner-threshold', 'rootbound-passage', ['earthfire-core'], 0, 0),
    groups: 2, challenge: true, description: '两座依崖悬台伸入地火竖井上方，石道沿赤色岩壁将它们相连，远处高低院房隔着暖气展开。分火铜环已经卸走，空榫旁的聚火阵仍将焰光拢向旧穴；金色髓光在两团火煞中浮动。',
  },
  'hidden-furnace-wall': {
    ...region('调火石廊', 'manor-inner-threshold', 'edict-corridor', ['furnace-guard-wight'], 0, 0),
    groups: 2, challenge: true, description: '侧廊绕过封存地炉，暖红光色沿方整壁龛延向昔日值守处，旧铜环石座已空。两道长臂灵影随脚步在龛间忽隐忽现；廊末隔火厚墙后的门扉完整，淡白泉气从门下缓缓逸出。',
  },
  'manor-heart': {
    ...region('涵岳总枢', 'manor-inner-threshold', 'heartward-path', ['manor-spirit-vessel'], 0, 0),
    groups: 1, challenge: true, enemyMultiplier: '1.2',
    description: '门后高堂以方整石台承接全院阵线，深色主匣虽已拆空，泉光与火色仍在上方聚成阵灵。台沿刻着「封停各渠，巡枢归印」，残印纹与旧令相应；后侧石廊透来山背天光，堂内的光脉却始终留在旧界线上。',
  },
  'oldwood-fringe': {
    ...region('百渠药泽', 'oldwood-edge', 'manor-heart',
      ['withering-fungus', 'jade-scale-moth', 'leaf-talisman-adept', 'woodland-crossbowman'], 3600, 1200),
    firstItems: { 'foundation-insight': 1 },
    repeatLoot: { maxLevel: 12, entries: [drop('foundation-insight', .1)] },
    description: '苍翠药植沿旧石田与浅泽铺开，层层莲叶在晴光下泛着青碧色，田间残墙隐在淡白药雾中。少数养药旧纹仍将凝露拢在叶心与槽底，藤根缠住成熟莲蓬，泽蜥贴着浅水游动；修士药包也是劫掠者争夺的目标。',
  },
  'condensing-spring-cavern': {
    ...region('凝露泉窟', 'oldwood-edge', 'oldwood-fringe',
      ['spring-jade-toad', 'withering-fungus', 'jade-scale-moth'], 1200, 400),
    groups: 13,
    encounterPools: { 1: ['spring-jade-toad'], 13: ['jade-toad-chief'] },
    description: '泉洞沿层叠浅池深入山腹，天隙将清光送入近处，深池则映着玉蟾颈腹的温润玉光。停用引水槽隐在湿石与藤根之间，凝润药涎留在池沿；浅池玉蟾与泽蜥盘踞其间，深处巨蟾伏身守着一片静水。',
  },
};

export function encounterPool(regionId: string, clearedGroups: string): readonly string[] {
  const region = lookup(REGIONS, regionId);
  const position = Number(BigInt(clearedGroups) % BigInt(region.groups)) + 1;
  return region.encounterPools?.[position] ?? region.pool;
}

export function encounterNeedsEntry(regionId: string, enemyIds: string[]): boolean {
  return regionId === MANOR_AID.finalRegionId || enemyIds.some(id => {
    const abilities = lookup(ENEMIES, id).definition.abilities;
    return Boolean(abilities?.entryStatRatio || abilities?.entryHealthRatio);
  });
}

// Entry context changes panels only; reward callers intentionally use the unmodified XP and loot.
export function encounterEnemy(regionId: string, enemyId: string, entry?: EncounterEntry): EnemyContent & { lootMultiplier: string } {
  const region = lookup(REGIONS, regionId);
  const enemy = lookup(ENEMIES, enemyId);
  const multiplier = region.enemyMultiplier ?? '1';
  const stats = { ...enemy.definition.stats };
  for (const key of ['maxHp', 'attack', 'defense', 'agility'] as const) {
    stats[key] = text(dec(stats[key]).mul(multiplier));
  }
  if (entry) {
    const abilities = enemy.definition.abilities;
    if (abilities?.entryStatRatio) {
      for (const key of ['attack', 'defense', 'agility'] as const) {
        stats[key] = text(dec(stats[key]).plus(dec(entry[key]).mul(abilities.entryStatRatio)));
      }
    }
    if (abilities?.entryHealthRatio) {
      stats.maxHp = text(dec(stats.maxHp).plus(dec(entry.attack).plus(entry.defense).mul(abilities.entryHealthRatio)));
    }
    if (regionId === MANOR_AID.finalRegionId && enemyId === MANOR_AID.enemyId && entry.manorSeal) {
      for (const key of ['maxHp', 'attack', 'defense', 'agility'] as const) stats[key] = text(dec(stats[key]).mul('0.01'));
    }
  }
  return {
    ...enemy, definition: { ...enemy.definition, stats },
    xp: text(dec(enemy.xp).mul(dec(multiplier).pow('1.5'))), lootMultiplier: multiplier,
  };
}

export const SAFE_LOCATIONS: Record<string, {
  name: string; prerequisite: string | null;
  description?: string;
  meditation?: boolean;
  rankings?: boolean;
}> = {
  'qingshi-village': {
    name: '槐溪村', prerequisite: null, meditation: true,
    description: '群山深处的溪边村落，与石坪、南洼两村沿山径往来。村民耕田、打猎，村口货摊由各家合办，摆着皮货、麻线、铁料和行粮。长辈相传的养生口诀仍用于劳作间调匀呼吸。',
  },
  'hermit-stone-chamber': {
    name: '隐居者石室', prerequisite: 'stony-trail', meditation: true,
    description: '破损封石后是一间干燥石室，没有床铺与炉火。石台上的陶匣包着《穿云诀》《撼山功》，旁置几件收好的旧器。署名沈安的行记记着早年寻药、分账与争执，末页只写了「收存旧物，不再远游」，附有顺溪越岭、往大河去的旧路记。',
  },
  'foothill-camp': {
    name: '灰脊避风坪', prerequisite: 'stony-trail', meditation: true,
    description: '溪源旁的猎径绕到山脊背面，岩壁下留有挡风石垒与冷火塘。回程可循溪返村，向外则要越过分水岭，沿灰白岩脊走向河谷。',
  },
  'hillside-market': {
    name: '石桥镇', prerequisite: 'serpent-ridge', meditation: true, rankings: true,
    description: '跨河石桥连接两岸街市，桥下舟船往来装卸。桥头商会挂着四海商盟的标记，铁料、妖皮和行粮分架摆放，货签写着不同产地。来往修士的器物新旧不一，镇外旧河道旁则长满芦苇。',
  },
  'cloudfoot-waystation': {
    name: '望川外埠', prerequisite: 'stone-gate-pass', meditation: true, rankings: true,
    description: '望川城依高岸而起，白墙、青瓦与宽阔城门沿山势层层展开，江上晴光映进外埠石廊。运货灵舟凭舟底分水阵逆流入泊，仓门封纹与商盟标记相接，岸上修士收存封好的灵材匣；廊后道路通往城郊群峰。',
  },
  'stone-training-ground': {
    name: '临风演武台', prerequisite: 'reed-marsh',
    description: '面向江谷的开阔石台分作两片练功场。引风石桩将崖风导成交错风流，修士催气轻身，在风中调整落步；另一侧镇压石印嵌在阵座内，纹路将压力铺向石地，修士以行气承压锤炼筋骨。',
  },
  'stoneforge-hamlet': {
    name: '望川西市', prerequisite: 'pine-ravine', meditation: true, rankings: true,
    description: '宽阔市街沿山台展开，青瓦器坊与白墙楼阁相接，驭火阵将炉焰拢成稳定的焰柱，暖光透过高窗。楼间吊架以牵引阵运送器料，商会收售矿料、灵露、炼材与丹药；城西岩坡仍可开采青纹矿和地火煤，街后静廊供修士歇脚。',
  },
  'sunken-manor-entrance': {
    name: '涵岳外台', prerequisite: 'shrine-gate-duel',
    description: '山门后的外台沿崖展开，前庭殿檐从高低白墙间露出，远山晴光与近处泉雾相隔。主道通往院内，侧坪旧阵仍泛着灵光；台边岩壁的玉髓细脉留着密集凿痕，含髓纹理向岩内收窄，原路可返回望川外埠。',
  },
  'manor-outer-court': {
    name: '涵岳前庭', prerequisite: 'shrine-gate-duel', meditation: true,
    description: '几层临山庭院以宽阶和回廊相连，白墙青瓦在山腰错落展开，高处旧引泉槽仍有阵光牵着细流。散修借临崖偏院暂住，棚屋与商盟铁料货棚靠在旧墙一侧，静廊供人调息；更深器坊间仍有傀影巡行。',
  },
  'manor-inner-threshold': {
    name: '内院阵台', prerequisite: 'manor-seal-gate',
    description: '内院石台嵌在两重庭墙之间，泉槽与导火纹从台下分向各层院房。凹槽托着一枚裂印，旁刻「巡枢用印，事毕归槽」；前方廊道在断续阵光间渐深，回望可见前庭青瓦与临崖住屋。',
  },
  'earthvein-workroom': {
    name: '暖泉静室', prerequisite: 'hidden-furnace-wall', meditation: true,
    description: '厚石墙将地炉热风留在门外，一扇高窗把清光送到环泉石座上。温水沿浅槽缓缓流过，墙上行息刻图仍完整，泉气在低处散成淡白薄带；席垫虽已朽坏，供轮值修士歇息的石面依旧平整干燥。',
  },
  'forest-edge-camp': {
    name: '千渠埠', prerequisite: 'manor-heart', meditation: true, rankings: true,
    description: '山背灵泽边，青瓦住屋与收料仓楼沿旧石台相接，远处药植将泽面分成深浅青碧的长带。修士货舟泊在刻有分水纹的石栈外，商会柜前摆着封灵药匣，静廊供行旅调息；堤路通向药泽，回望仍能看见涵岳院墙。',
  },
  'oldwood-edge': {
    name: '百渠堤口', prerequisite: 'manor-heart',
    description: '埠外石堤在旧分水碑旁展开，苍翠药田、青碧莲泽与远处山壁一同映入眼中。残存养药纹在断石间明灭，泉气沿田沿聚成薄雾；携料修士沿堤归埠，临水石坪可作短暂停留。',
  },
};

export interface RecipeDefinition {
  name: string; path: 'ordinary' | 'component'; output: string; materials: Record<string, number>; difficulty: number;
  outputCount?: number;
}
export const RECIPES: Record<string, RecipeDefinition> = {
  'smelt-iron': { name: '熔炼粗铁锭', path: 'ordinary', output: 'crude-iron-ingot', materials: { 'scrap-iron': 3, charcoal: 1 }, difficulty: 5 },
  'smelt-dark-steel': {
    name: '熔炼乌钢锭', path: 'ordinary', output: 'dark-steel-ingot',
    materials: { 'crude-iron-ingot': 1, 'dark-steel-scrap': 2, charcoal: 3 }, difficulty: 7,
  },
  'smelt-azure-iron': {
    name: '熔炼青纹铁', path: 'ordinary', output: 'azure-iron-ingot',
    materials: { 'azure-ore': 2, 'earth-vein-dew': 1, 'ember-coal': 1 }, difficulty: 11,
  },
  'infuse-spiritwood': {
    name: '炼制养灵木', path: 'ordinary', output: 'spirit-treated-wood',
    materials: { 'iron-birch-wood': 1, 'windwoven-fiber': 1, 'verdant-essence': 2 }, difficulty: 12,
  },
  'stitch-hide': { name: '缝制皮料', path: 'ordinary', output: 'stitched-hide', materials: { 'hide-scrap': 1, 'hemp-thread': 1 }, difficulty: 2 },
  'dry-meat': { name: '烘制肉干', path: 'ordinary', output: 'dried-meat', materials: { 'fresh-meat': 1, charcoal: 1 }, difficulty: 3 },
  'dry-rich-meat': { name: '烘制精肉脯', path: 'ordinary', output: 'rich-jerky', materials: { 'rich-beast-meat': 1, charcoal: 3 }, difficulty: 5 },
  'dry-spirit-meat': {
    name: '炼制培元丹', path: 'ordinary', output: 'spirit-jerky',
    materials: { 'spirit-beast-meat': 1, 'ember-coal': 1 }, difficulty: 8,
  },
  'refine-cloudy-marrow': { name: '提炼浊灵髓', path: 'ordinary', output: 'cloudy-marrow', materials: { 'cloudy-jade': 1, charcoal: 1 }, difficulty: 6 },
  'refine-clear-marrow': { name: '精炼清灵髓', path: 'ordinary', output: 'clear-marrow', materials: { 'cloudy-marrow': 5, charcoal: 2 }, difficulty: 8 },
  'smelt-baleful-alloy': {
    name: '熔炼玄煞铁', path: 'ordinary', output: 'baleful-alloy',
    materials: { 'azure-iron-ingot': 1, 'fractured-spirit-blade': 3, 'formation-core': 1 }, difficulty: 13,
  },
  'fuse-marrow-crystal': {
    name: '凝炼灵髓晶', path: 'ordinary', output: 'marrow-crystal',
    materials: { 'condensed-marrow': 2, 'profound-marrow': 4, 'luminous-marrow': 2 }, difficulty: 13,
  },
  'marrow-pendant': {
    name: '炼制养元佩', path: 'ordinary', output: 'marrow-pendant',
    materials: { 'marrow-crystal': 4, 'formation-core': 1 }, difficulty: 12,
  },
  'vital-eye': {
    name: '炼制命枢珠', path: 'ordinary', output: 'vital-eye',
    materials: { 'baleful-alloy': 20, 'formation-core': 10, 'spirit-eye': 5 }, difficulty: 18,
  },
  'recovery-draught': {
    name: '炼制续脉散', path: 'ordinary', output: 'recovery-draught',
    materials: { 'soul-ember': 1, 'spirit-eye': 1 }, difficulty: 11,
  },
  'surge-pill': {
    name: '炼制燃血丹', path: 'ordinary', output: 'surge-pill',
    materials: { 'soul-ember': 3, 'formation-core': 1 }, difficulty: 12,
  },
  'smelt-deepsteel': {
    name: '熔炼沉渊钢', path: 'ordinary', output: 'deepsteel-ingot',
    materials: { 'vault-bond': 1, 'soul-ember': 1, 'formation-core': 1 }, difficulty: 18,
  },
  'weave-renewal-silk': {
    name: '织炼回春灵绢', path: 'ordinary', output: 'renewal-silk',
    materials: { 'flowing-essence-gel': 1, 'frost-veined-hide': 1, 'soul-ember': 1 }, difficulty: 20,
  },
  'cook-essence-broth': {
    name: '炼制凝元丹', path: 'ordinary', output: 'essence-broth',
    materials: { 'feral-heart-meat': 1, 'formation-core': 1 }, difficulty: 12,
  },
  'voidstep-knot': {
    name: '炼制踏虚结', path: 'ordinary', output: 'voidstep-knot',
    materials: { 'flowing-essence-gel': 20, 'soul-ember': 10, 'formation-core': 5 }, difficulty: 20,
  },
  'mountaincleaver-pendant': {
    name: '炼制断岳佩', path: 'ordinary', output: 'mountaincleaver-pendant',
    materials: { 'vault-bond': 20, 'fractured-spirit-blade': 10, 'spirit-treated-wood': 5 }, difficulty: 22,
  },
  'smelt-resonant-ingot': {
    name: '粗炼鸣金锭', path: 'ordinary', output: 'resonant-ingot', difficulty: 20,
    materials: { 'vault-bond': 1, 'carapace-fragment': 4, 'beast-core-shard': 2 },
  },
  'weave-renewal-silk-bulk': {
    name: '精织回春灵绢', path: 'ordinary', output: 'renewal-silk', outputCount: 15, difficulty: 21,
    materials: { 'frost-veined-hide': 10, 'feral-blood-essence': 1 },
  },
  'cook-woodland-roast': {
    name: '炼制养元丹', path: 'ordinary', output: 'woodland-roast', difficulty: 17,
    materials: { 'spirit-rib-meat': 1, 'beast-core-shard': 1 },
  },
  'refine-harmonizing-elixir': {
    name: '炼制调元药液', path: 'ordinary', output: 'harmonizing-elixir', outputCount: 2, difficulty: 12,
    materials: { 'feral-blood-essence': 1, 'soul-ember': 4 },
  },
  'refine-foundation-pill': {
    name: '炼制筑基丹', path: 'ordinary', output: 'foundation-pill', difficulty: 18,
    materials: { 'marsh-lotus-seed': 3, 'soul-ember': 6, 'beast-core-shard': 1 },
  },
  'refine-jade-fluid-foundation-pill': {
    name: '炼制玉液筑基丹', path: 'ordinary', output: 'jade-fluid-foundation-pill', difficulty: 20,
    materials: { 'marsh-lotus-seed': 3, 'soul-ember': 6, 'beast-core-shard': 1, 'harmonizing-elixir': 2 },
  },
  'refine-ninefold-foundation-pill': {
    name: '炼制九转筑基丹', path: 'ordinary', output: 'ninefold-foundation-pill', difficulty: 22,
    materials: {
      'marsh-lotus-seed': 3, 'soul-ember': 6, 'beast-core-shard': 1, 'harmonizing-elixir': 4, 'clear-spring-saliva': 2,
    },
  },
  ...Object.fromEntries([
    ['iron-blade', 'crude-iron-ingot', 2], ['old-wood-hilt', 'old-timber', 2], ['iron-birch-hilt', 'iron-birch-wood', 2],
    ['hide-headwrap', 'stitched-hide', 3], ['hide-jacket', 'stitched-hide', 4],
    ['hide-leggings', 'stitched-hide', 4], ['hide-boots', 'stitched-hide', 2],
    ['dark-steel-blade', 'dark-steel-ingot', 2],
    ['beasthide-headwrap', 'tough-beast-hide', 3], ['beasthide-jacket', 'tough-beast-hide', 4],
    ['beasthide-leggings', 'tough-beast-hide', 4], ['beasthide-boots', 'tough-beast-hide', 2],
    ['azure-iron-blade', 'azure-iron-ingot', 2], ['spiritwood-hilt', 'spirit-treated-wood', 2],
    ['azure-head-shell', 'azure-iron-ingot', 3], ['azure-body-shell', 'azure-iron-ingot', 4],
    ['azure-leg-shell', 'azure-iron-ingot', 4], ['azure-foot-shell', 'azure-iron-ingot', 2],
    ['baleful-blade', 'baleful-alloy', 2],
    ['baleful-head-shell', 'baleful-alloy', 3], ['baleful-body-shell', 'baleful-alloy', 4],
    ['baleful-leg-shell', 'baleful-alloy', 4], ['baleful-foot-shell', 'baleful-alloy', 2],
    ['deepsteel-blade', 'deepsteel-ingot', 2],
    ['renewal-headwrap', 'renewal-silk', 3], ['renewal-jacket', 'renewal-silk', 4],
    ['renewal-leggings', 'renewal-silk', 4], ['renewal-boots', 'renewal-silk', 2],
    ['resonant-blade', 'resonant-ingot', 2], ['resonant-greatblade', 'resonant-ingot', 6],
    ['awakened-hilt', 'awakened-wood', 2],
    ['resonant-head-shell', 'resonant-ingot', 3], ['resonant-body-shell', 'resonant-ingot', 4],
    ['resonant-leg-shell', 'resonant-ingot', 4], ['resonant-foot-shell', 'resonant-ingot', 2],
  ].map(([output, input, count]) => [String(output), {
    name: ITEMS[output].name, path: 'component', output: String(output),
    materials: { [input]: Number(count) }, difficulty: 0,
  }])),
};

const woodlandAssemblies = [
  ...['iron-blade', 'dark-steel-blade', 'azure-iron-blade', 'baleful-blade', 'deepsteel-blade']
    .map(blade => ({ blade, hilt: 'awakened-hilt', output: `awakened-${blade}-sword` })),
  ...['resonant-blade', 'resonant-greatblade'].flatMap(blade =>
    ['old-wood-hilt', 'iron-birch-hilt', 'spiritwood-hilt', 'awakened-hilt'].map(hilt => ({
      blade, hilt, output: `${hilt}-${blade}-weapon`,
    }))),
];
const weaponNames: Record<string, string> = {
  'iron-blade': '铁剑', 'dark-steel-blade': '乌钢剑', 'azure-iron-blade': '青纹剑',
  'baleful-blade': '玄煞剑', 'deepsteel-blade': '沉渊剑', 'resonant-blade': '鸣金剑', 'resonant-greatblade': '鸣金重剑',
};
const weaponPrefixes: Record<string, string> = {
  'old-wood-hilt': '粗炼', 'iron-birch-hilt': '', 'spiritwood-hilt': '养灵', 'awakened-hilt': '苏灵',
};
for (const { blade, hilt, output } of woodlandAssemblies) {
  const bladeItem = ITEMS[blade];
  ITEMS[output] = {
    name: `${weaponPrefixes[hilt]}${weaponNames[blade]}`, kind: 'equipment', slot: 'weapon', blade, hilt,
    value: text(dec(bladeItem.value).plus(ITEMS[hilt].value)), weaponSkill: bladeItem.weaponSkill ?? 'sword',
  };
}

export const ASSEMBLIES = [
  { blade: 'iron-blade', hilt: 'old-wood-hilt', output: 'wood-hilt-sword' },
  { blade: 'iron-blade', hilt: 'iron-birch-hilt', output: 'iron-birch-sword' },
  { blade: 'dark-steel-blade', hilt: 'old-wood-hilt', output: 'wood-hilt-dark-steel-sword' },
  { blade: 'dark-steel-blade', hilt: 'iron-birch-hilt', output: 'dark-steel-sword' },
  { blade: 'azure-iron-blade', hilt: 'old-wood-hilt', output: 'wood-hilt-azure-sword' },
  { blade: 'azure-iron-blade', hilt: 'iron-birch-hilt', output: 'azure-iron-sword' },
  { blade: 'iron-blade', hilt: 'spiritwood-hilt', output: 'spiritwood-iron-sword' },
  { blade: 'dark-steel-blade', hilt: 'spiritwood-hilt', output: 'spiritwood-dark-steel-sword' },
  { blade: 'azure-iron-blade', hilt: 'spiritwood-hilt', output: 'spiritwood-azure-sword' },
  { blade: 'baleful-blade', hilt: 'old-wood-hilt', output: 'wood-hilt-baleful-sword' },
  { blade: 'baleful-blade', hilt: 'iron-birch-hilt', output: 'iron-birch-baleful-sword' },
  { blade: 'baleful-blade', hilt: 'spiritwood-hilt', output: 'spiritwood-baleful-sword' },
  { blade: 'deepsteel-blade', hilt: 'old-wood-hilt', output: 'wood-hilt-deepsteel-sword' },
  { blade: 'deepsteel-blade', hilt: 'iron-birch-hilt', output: 'iron-birch-deepsteel-sword' },
  { blade: 'deepsteel-blade', hilt: 'spiritwood-hilt', output: 'spiritwood-deepsteel-sword' },
  ...woodlandAssemblies,
] as const;

const weaponFinishes: Record<string, string> = {
  'old-wood-hilt': '粗淬留下斑驳色泽，刃线也不甚齐整。',
  'iron-birch-hilt': '桦脂淬炼后色泽均匀，刃口打磨平整。',
  'spiritwood-hilt': '以养灵淬液处理，器表留有一层浅青细纹。',
  'awakened-hilt': '以苏灵淬液处理，细密的灵纹沿器身延伸。',
};
const weaponForms: Record<string, string> = {
  'wood-hilt-sword': '百炼铁料铸成的短直剑，剑格短小，握柄以粗绳束缠。',
  'iron-birch-sword': '百炼铁料铸成的修长铁剑，菱脊清楚，弧形剑格护住握柄。',
  'wood-hilt-dark-steel-sword': '乌钢精料铸成的宽厚叶刃剑，剑肩厚实，方短剑格不加修饰。',
  'dark-steel-sword': '乌钢精料铸成的宽肩收锋剑，双翼剑格与护柄金属箍合得齐整。',
};
for (const { blade, hilt, output } of ASSEMBLIES) {
  ITEMS[output].description = `${weaponForms[output] ?? `${ITEMS[blade].name}铸成的兵刃。`}${weaponFinishes[hilt]}`;
}

const armorTreatments: Record<string, { material: string; finish: string }> = {
  青纹: { material: '青纹铁', finish: '青色细纹固入原有衣料，弯折时仍能随之舒展。' },
  玄煞: { material: '玄煞铁', finish: '暗纹沿接缝连成一片，护身时也会持续耗损穿戴者的气血。' },
  鸣金: { material: '鸣金锭', finish: '金色细纹分布在原有衣料上，运劲时随之微微震鸣。' },
};
const armorPositions: Record<string, string> = { head: '头部', body: '上身', legs: '腿部', feet: '足部' };
const armorUpgradeForms: Partial<Record<string, { name: string; description: string }>> = {
  'beasthide-jacket': { name: '妖甲', description: '韧妖皮反复炼合成甲，甲面仍能辨出细密皮纹。' },
};
export const ARMOR_ASSEMBLIES = [
  ['head', 'azure-head-shell', 'headwrap', '青纹'],
  ['body', 'azure-body-shell', 'jacket', '青纹'],
  ['legs', 'azure-leg-shell', 'leggings', '青纹'],
  ['feet', 'azure-foot-shell', 'boots', '青纹'],
  ['head', 'baleful-head-shell', 'headwrap', '玄煞'],
  ['body', 'baleful-body-shell', 'jacket', '玄煞'],
  ['legs', 'baleful-leg-shell', 'leggings', '玄煞'],
  ['feet', 'baleful-foot-shell', 'boots', '玄煞'],
  ['head', 'resonant-head-shell', 'headwrap', '鸣金'],
  ['body', 'resonant-body-shell', 'jacket', '鸣金'],
  ['legs', 'resonant-leg-shell', 'leggings', '鸣金'],
  ['feet', 'resonant-foot-shell', 'boots', '鸣金'],
].flatMap(([slot, exterior, nameSuffix, name]) => {
  const treatment = armorTreatments[name];
  const position = armorPositions[slot];
  ITEMS[exterior].description = `${treatment.material}研炼成的细砂，按${position}防具的纹式处理后分装。`;
  return (['hide', 'beasthide', 'renewal'] as const).map(lining => {
    const interior = `${lining}-${nameSuffix}`;
    const output = `${lining}-lined-${exterior}`;
    const form = armorUpgradeForms[interior] ?? ITEMS[interior];
    ITEMS[output] = {
      name: `${name}${form.name}`, kind: 'equipment', slot: slot as EquipmentSlot,
      value: String(Number(ITEMS[interior].value) + Number(ITEMS[exterior].value)), interior, exterior,
      description: `${form.description}${treatment.finish}`,
    };
    return { interior, exterior, output };
  });
});

interface ShopStock {
  itemId: string; chance: number; min: number; max: number; quality?: [number, number];
}
interface ShopDefinition {
  name: string; locationId: string; prerequisite: string | null; margin: string;
  stateKey: 'shop' | 'marketShop' | 'stoneforgeShop' | 'manorShop' | 'forestShop'; stock: ShopStock[];
}
export const SHOP_IDS = ['village-stall', 'market-supplies', 'stoneforge-supplies', 'manor-metalwork', 'forest-supplies'] as const;
export type ShopId = typeof SHOP_IDS[number];

const villageStock: ShopStock[] = [
  { itemId: 'hide-scrap', chance: 1, min: 5, max: 10 },
  { itemId: 'hemp-thread', chance: 1, min: 5, max: 10 },
  { itemId: 'scrap-iron', chance: 1, min: 5, max: 10 },
  { itemId: 'charcoal', chance: 1, min: 5, max: 10 },
  { itemId: 'old-timber', chance: 1, min: 2, max: 5 },
  { itemId: 'dried-meat', chance: .5, min: 2, max: 5 },
  { itemId: 'wood-hilt-sword', chance: .8, min: 1, max: 1, quality: [61, 100] },
  { itemId: 'iron-birch-sword', chance: .2, min: 1, max: 1, quality: [81, 120] },
  ...['hide-headwrap', 'hide-jacket', 'hide-leggings', 'hide-boots'].map((itemId): ShopStock =>
    ({ itemId, chance: .5, min: 1, max: 1, quality: [61, 100] })),
];

export const SHOPS: Record<ShopId, ShopDefinition> = {
  'forest-supplies': {
    name: '四海商盟·千渠商会', locationId: 'forest-edge-camp', prerequisite: 'manor-heart', margin: '3.6', stateKey: 'forestShop',
    stock: [
      ...['formation-core', 'vault-bond', 'frost-veined-hide', 'essence-broth']
        .map((itemId): ShopStock => ({ itemId, chance: 1, min: 100, max: 250 })),
      { itemId: 'feral-blood-essence', chance: 1, min: 3, max: 5 },
      ...['beast-core-shard', 'carapace-fragment', 'awakened-wood']
        .map((itemId): ShopStock => ({ itemId, chance: .8, min: 5, max: 10 })),
      { itemId: 'spirit-rib-meat', chance: .8, min: 2, max: 5 },
      { itemId: 'awakened-hilt-resonant-blade-weapon', chance: .5, min: 1, max: 1, quality: [81, 120] },
      { itemId: 'awakened-hilt-resonant-greatblade-weapon', chance: .2, min: 1, max: 1, quality: [71, 110] },
      ...['renewal-headwrap', 'renewal-jacket', 'renewal-leggings']
        .map((itemId): ShopStock => ({ itemId, chance: .8, min: 1, max: 1, quality: [91, 120] })),
      { itemId: 'renewal-boots', chance: .8, min: 1, max: 1, quality: [91, 110] },
    ],
  },
  'manor-metalwork': {
    name: '四海商盟·涵岳商会', locationId: 'manor-outer-court', prerequisite: 'puppet-court', margin: '1.5', stateKey: 'manorShop',
    stock: [{ itemId: 'baleful-alloy', chance: 1, min: 999, max: 999 }],
  },
  'village-stall': {
    name: '村口货摊', locationId: 'qingshi-village', prerequisite: null, margin: '2', stateKey: 'shop',
    stock: villageStock,
  },
  'market-supplies': {
    name: '四海商盟·石桥商会', locationId: 'hillside-market', prerequisite: 'market-gardens', margin: '3', stateKey: 'marketShop',
    stock: [
      { itemId: 'scrap-iron', chance: 1, min: 10, max: 25 },
      { itemId: 'charcoal', chance: 1, min: 10, max: 25 },
      { itemId: 'crude-iron-ingot', chance: 1, min: 5, max: 15 },
      { itemId: 'dark-steel-scrap', chance: .8, min: 1, max: 10 },
      { itemId: 'tough-beast-hide', chance: .8, min: 1, max: 25 },
      { itemId: 'rich-jerky', chance: .8, min: 2, max: 5 },
      { itemId: 'iron-birch-sword', chance: .8, min: 1, max: 1, quality: [81, 120] },
      { itemId: 'dark-steel-sword', chance: .3, min: 1, max: 1, quality: [71, 110] },
      ...['beasthide-headwrap', 'beasthide-jacket', 'beasthide-leggings', 'beasthide-boots'].map((itemId): ShopStock =>
        ({ itemId, chance: .5, min: 1, max: 1, quality: [61, 100] })),
    ],
  },
  'stoneforge-supplies': {
    name: '四海商盟·望川商会', locationId: 'stoneforge-hamlet', prerequisite: 'pine-ravine', margin: '3.2', stateKey: 'stoneforgeShop',
    stock: [
      { itemId: 'tough-beast-hide', chance: 1, min: 15, max: 40 },
      { itemId: 'iron-birch-wood', chance: 1, min: 10, max: 25 },
      { itemId: 'dark-steel-ingot', chance: 1, min: 5, max: 15 },
      { itemId: 'azure-ore', chance: .7, min: 1, max: 12 },
      ...['ember-coal', 'verdant-essence', 'earth-vein-dew'].map((itemId): ShopStock =>
        ({ itemId, chance: .8, min: 1, max: 12 })),
      { itemId: 'spirit-treated-wood', chance: .4, min: 2, max: 4 },
      { itemId: 'spirit-jerky', chance: .9, min: 2, max: 5 },
      ...['azure-head-shell', 'azure-body-shell', 'azure-leg-shell', 'azure-foot-shell'].map((itemId): ShopStock =>
        ({ itemId, chance: .4, min: 1, max: 1, quality: [41, 80] })),
    ],
  },
};

export function shopAtLocation(locationId: string): ShopId | undefined {
  return SHOP_IDS.find(id => SHOPS[id].locationId === locationId);
}

export function lookup<T>(table: Record<string, T>, id: string): T {
  if (!Object.hasOwn(table, id)) throw new Error(`Unknown content ID: ${id}`);
  return table[id];
}
