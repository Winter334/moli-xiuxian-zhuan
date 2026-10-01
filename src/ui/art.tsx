import { useState } from 'react';
import { Mountain, Swords, UserRound } from 'lucide-react';

// Generated art is mounted for user review; load failures retain the functional fallback.
export const SCENE_ART: Record<string, string> = {
  ...Object.fromEntries([
    'village-outskirts', 'abandoned-road', 'stony-trail', 'hermit-stone-chamber',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-v4.webp`])),
  'qingshi-village': '/assets/art/scenes/qingshi-village-sunburst-v2.webp',
  ...Object.fromEntries([
    'foothill-camp', 'mine-tunnels', 'mine-depths', 'mountain-pass', 'serpent-ridge',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-huiji-v1.webp`])),
  'mine-front': '/assets/art/scenes/mine-front-sunburst-huiji-v2.webp',
  ...Object.fromEntries([
    'hillside-market', 'kiln-alley', 'market-gardens', 'market-outer-road', 'stone-gate-pass',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-shiqiao-v1.webp`])),
  ...Object.fromEntries([
    'market-backstreets', 'scripture-cave', 'old-ferry-bank',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-shiqiao-v2.webp`])),
  ...Object.fromEntries([
    'reed-marsh', 'stonefang-wilds', 'thornwild-slope', 'baleful-valley', 'ruined-shrine-road',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-wangchuan-v1.webp`])),
  ...Object.fromEntries([
    'waystation-duel', 'stone-training-ground', 'pine-ravine', 'stoneforge-hamlet', 'shrine-gate-duel',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-wangchuan-v2.webp`])),
  'cloudfoot-waystation': '/assets/art/scenes/cloudfoot-waystation-sunburst-wangchuan-v3.webp',
  ...Object.fromEntries([
    'seal-guardian-ring', 'rusted-corridor', 'puppet-court', 'buried-gallery',
    'stone-root-court', 'sealed-vault', 'manor-seal-gate',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-hanyue-courts-v1.webp`])),
  ...Object.fromEntries([
    'sunken-manor-entrance', 'manor-outer-court',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-hanyue-courts-v2.webp`])),
  ...Object.fromEntries([
    'rootbound-passage', 'earthfire-platform', 'ruined-elixir-hall', 'edict-corridor',
    'hidden-furnace-wall', 'earthvein-workroom', 'brood-cavern', 'relic-underchannel', 'manor-heart',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-hanyue-inner-v1.webp`])),
  ...Object.fromEntries([
    'manor-inner-threshold', 'heartward-path',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-hanyue-inner-v2.webp`])),
  ...Object.fromEntries([
    'forest-edge-camp', 'oldwood-edge', 'oldwood-fringe', 'condensing-spring-cavern',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-baiqu-v1.webp`])),
};
export const ENEMY_AVATARS: Record<string, string> = {
  ...Object.fromEntries([
    'mountain-rat', 'wild-badger', 'stray-dog', 'roadside-thief', 'club-raider',
    'hide-bandit', 'wildcat', 'mountain-wight',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-v3.png`])),
  'black-backed-wolf': '/assets/art/enemies/black-backed-wolf-flare-v2.png',
  'fire-thrower': '/assets/art/enemies/fire-thrower-flare-v2.png',
  ...Object.fromEntries([
    'masked-bladesman', 'mine-brigand', 'twin-blade-raider', 'mine-sentry',
    'red-eyed-shanxiao', 'bone-gnawing-shanxiao', 'ambush-ape', 'ward-eye',
    'ember-cultivator', 'armored-bandit-chief', 'outlaw-swordsman', 'cave-boar',
    'green-backed-wolf', 'charred-wood-puppet', 'ridge-python',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-huiji-v1.png`])),
  ...Object.fromEntries([
    'extortionist', 'light-armored-construct', 'swift-blade-puppet', 'cave-guardian',
    'red-backed-badger', 'vinebound-beast', 'miasma-toad', 'stone-ward-spirit',
    'venom-cultivator', 'black-scarf-raider', 'wandering-saber-cultivator', 'body-tempering-rogue',
    'layered-talisman-cultivator', 'bark-armored-shanxiao', 'gate-stone-warden',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-shiqiao-v1.png`])),
  ...Object.fromEntries([
    'rending-shanxiao', 'ravine-ambusher', 'inverted-mark-fox',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-shiqiao-v2.png`])),
  'brocade-marten': '/assets/art/enemies/brocade-marten-flare-cutout-v3.png',
  ...Object.fromEntries([
    'stonebreaker-adept', 'brocade-horn-deer', 'razorleaf-mantis', 'miasma-serpent',
    'twin-saber-outlaw', 'iron-robed-cultivator', 'withered-staff-cultivator', 'baleful-saber-cultivator',
    'ironplume-vulture', 'stoneback-rhino', 'windskimming-falcon', 'shrine-gate-warden',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-wangchuan-v1.png`])),
  'burrowing-centipede': '/assets/art/enemies/burrowing-centipede-flare-cutout-v2.png',
  ...Object.fromEntries([
    'vein-stone-spirit', 'spring-wisp', 'swift-shadow-wight', 'jade-inlaid-puppet',
    'coinbound-wraith', 'kindling-wisp', 'vinebound-ape', 'baleful-vine-spirit',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-wangchuan-v2.png`])),
  ...Object.fromEntries([
    'mirror-wisp', 'spirit-knot', 'inverted-seal-spirit', 'marrow-flame',
    'oathbound-swordsman', 'array-blade-puppet', 'binding-puppet', 'hollow-armor-soldier',
    'stone-eyed-toad', 'buried-spine-beast', 'spore-veiled-wight', 'grudge-delver',
    'gale-bronze-guard', 'vault-armored-guard', 'four-seal-warden', 'root-entwined-idol',
    'blood-oath-shadow',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-hanyue-courts-v1.png`])),
  ...Object.fromEntries([
    'uprooted-wood-wight', 'bloodpool-shadow', 'soulbinding-wraith', 'essence-thieving-bat',
    'renegade-manor-saber', 'broken-talisman-cultivator', 'relic-plundering-cultivator',
    'redspine-feral-beast', 'armored-moss-spirit', 'web-broodmother', 'budding-moss-spirit',
    'rock-piercing-owl', 'warped-fungus-puppet', 'rift-chasing-wight', 'furnace-guard-wight',
    'pale-bone-tendril', 'earthfire-wisp', 'earthfire-core', 'fivefold-curse',
    'softbone-spirit-moth', 'earthshaking-feral-beast', 'manor-spirit-vessel',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-hanyue-inner-v1.png`])),
  ...Object.fromEntries([
    'edict-enforcer', 'vault-bronze-sentinel', 'frenzied-bone-general', 'unbroken-stone-sentinel',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-hanyue-inner-v2.png`])),
  ...Object.fromEntries([
    'withering-fungus', 'jade-scale-moth', 'woodland-crossbowman', 'spring-jade-toad', 'jade-toad-chief',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-baiqu-v1.png`])),
  'leaf-talisman-adept': '/assets/art/enemies/leaf-talisman-adept-flare-baiqu-v2.png',
};
export const PLAYER_ART: { avatar?: string } = {};
export const ITEM_ICONS: Record<string, string> = {
  ...Object.fromEntries([
    'small-coin-string', 'hundred-coin-string', 'silver-ingot',
    'charcoal', 'hide-scrap', 'hemp-thread', 'old-timber',
    'fresh-meat', 'stitched-hide', 'hide-headwrap', 'hide-leggings', 'hide-boots',
  ].map(id => [id, `/assets/art/icons/${id}-flare-v3.png`])),
  'copper-coin': '/assets/art/icons/copper-coin-flare-v3.png',
  'cloudy-jade': '/assets/art/icons/cloudy-jade-flare-v3.png',
  'cloudy-marrow': '/assets/art/icons/cloudy-marrow-flare-v4.png',
  'clear-marrow': '/assets/art/icons/clear-marrow-flare-v4.png',
  ...Object.fromEntries([
    'iron-birch-wood', 'whole-hide', 'condensed-marrow',
  ].map(id => [id, `/assets/art/icons/${id}-flare-huiji-v1.png`])),
  ...Object.fromEntries([
    'rich-beast-meat', 'tough-beast-hide', 'lustrous-hide', 'profound-marrow', 'earth-vein-dew',
    'beasthide-headwrap', 'beasthide-leggings', 'beasthide-boots',
  ].map(id => [id, `/assets/art/icons/${id}-flare-shiqiao-v1.png`])),
  ...Object.fromEntries([
    'iron-birch-sword', 'wood-hilt-dark-steel-sword',
    'scrap-iron', 'iron-blade',
    'dark-steel-scrap', 'dark-steel-blade',
  ].map(id => [id, `/assets/art/icons/${id}-flare-refined-v5.png`])),
  ...Object.fromEntries([
    'hide-jacket', 'wood-hilt-sword', 'crude-iron-ingot',
    'beasthide-jacket', 'dark-steel-sword', 'dark-steel-ingot',
  ].map(id => [id, `/assets/art/icons/${id}-flare-refined-study-v2.png`])),
  ...Object.fromEntries([
    'old-wood-hilt', 'iron-birch-hilt', 'dried-meat', 'rich-jerky',
  ].map(id => [id, `/assets/art/icons/${id}-flare-refined-v3.png`])),
  ...Object.fromEntries([
    'azure-ore', 'ember-coal', 'azure-iron-ingot', 'azure-iron-blade',
    'verdant-essence', 'windwoven-fiber', 'spirit-beast-meat', 'weathered-route-chart',
    'luminous-marrow', 'jade-marrow', 'marrow-crystal', 'spirit-treated-wood', 'spiritwood-hilt',
    'azure-head-shell', 'azure-body-shell', 'azure-leg-shell', 'azure-foot-shell',
    'wood-hilt-azure-sword', 'azure-iron-sword', 'spiritwood-azure-sword',
    'spiritwood-iron-sword', 'spiritwood-dark-steel-sword',
    'hide-lined-azure-head-shell', 'hide-lined-azure-body-shell',
    'hide-lined-azure-leg-shell', 'hide-lined-azure-foot-shell',
    'beasthide-lined-azure-head-shell', 'beasthide-lined-azure-body-shell',
    'beasthide-lined-azure-leg-shell', 'beasthide-lined-azure-foot-shell',
  ].map(id => [id, `/assets/art/icons/${id}-flare-wangchuan-v1.png`])),
  'spirit-jerky': '/assets/art/icons/spirit-jerky-flare-v5.png',
  ...Object.fromEntries([
    'soul-ember', 'spirit-eye', 'formation-core', 'fractured-spirit-blade',
    'warding-notes', 'crimson-marrow', 'vault-bond', 'recovery-draught', 'surge-pill',
    'marrow-pendant', 'vital-eye', 'mountaincleaver-pendant', 'returning-lamp',
    'baleful-head-shell', 'baleful-body-shell', 'baleful-leg-shell', 'baleful-foot-shell',
    'wood-hilt-baleful-sword', 'iron-birch-baleful-sword', 'spiritwood-baleful-sword',
  ].map(id => [id, `/assets/art/icons/${id}-flare-hanyue-courts-v1.png`])),
  ...Object.fromEntries([
    'wood-hilt-deepsteel-sword', 'iron-birch-deepsteel-sword', 'spiritwood-deepsteel-sword',
    'hide-lined-baleful-head-shell', 'hide-lined-baleful-body-shell',
    'hide-lined-baleful-leg-shell', 'hide-lined-baleful-foot-shell',
  ].map(id => [id, `/assets/art/icons/${id}-flare-hanyue-courts-v2.png`])),
  ...Object.fromEntries([
    'baleful-alloy', 'baleful-blade', 'deepsteel-ingot', 'deepsteel-blade',
    'beasthide-lined-baleful-head-shell', 'beasthide-lined-baleful-body-shell',
    'beasthide-lined-baleful-leg-shell', 'beasthide-lined-baleful-foot-shell',
  ].map(id => [id, `/assets/art/icons/${id}-flare-hanyue-courts-v3.png`])),
  ...Object.fromEntries([
    'flowing-essence-gel', 'frost-veined-hide', 'feral-heart-meat', 'renewal-silk',
    'verdant-marrow', 'golden-marrow', 'manor-command-seal', 'voidstep-knot', 'essence-broth',
    'renewal-lined-azure-head-shell', 'renewal-lined-azure-body-shell',
    'renewal-lined-azure-leg-shell', 'renewal-lined-azure-foot-shell',
    'renewal-lined-baleful-head-shell', 'renewal-lined-baleful-body-shell',
    'renewal-lined-baleful-leg-shell', 'renewal-lined-baleful-foot-shell',
  ].map(id => [id, `/assets/art/icons/${id}-flare-hanyue-inner-v1.png`])),
  ...Object.fromEntries([
    'renewal-headwrap', 'renewal-jacket', 'renewal-leggings', 'renewal-boots',
  ].map(id => [id, `/assets/art/icons/${id}-flare-hanyue-inner-v2.png`])),
  ...Object.fromEntries([
    'feral-blood-essence', 'beast-core-shard', 'marsh-lotus-seed', 'carapace-fragment',
    'woodland-roast', 'foundation-pill', 'jade-fluid-foundation-pill', 'ninefold-foundation-pill',
    'resonant-blade', 'resonant-greatblade',
    'resonant-head-shell', 'resonant-body-shell', 'resonant-leg-shell', 'resonant-foot-shell',
    'awakened-iron-blade-sword', 'awakened-dark-steel-blade-sword', 'awakened-azure-iron-blade-sword',
    'awakened-baleful-blade-sword', 'awakened-deepsteel-blade-sword',
    'old-wood-hilt-resonant-blade-weapon', 'iron-birch-hilt-resonant-blade-weapon',
    'spiritwood-hilt-resonant-blade-weapon', 'awakened-hilt-resonant-blade-weapon',
    'hide-lined-resonant-head-shell', 'hide-lined-resonant-body-shell',
    'hide-lined-resonant-leg-shell', 'hide-lined-resonant-foot-shell',
    'beasthide-lined-resonant-head-shell', 'beasthide-lined-resonant-body-shell',
    'beasthide-lined-resonant-leg-shell', 'beasthide-lined-resonant-foot-shell',
    'renewal-lined-resonant-head-shell', 'renewal-lined-resonant-body-shell',
    'renewal-lined-resonant-leg-shell', 'renewal-lined-resonant-foot-shell',
  ].map(id => [id, `/assets/art/icons/${id}-flare-baiqu-v1.png`])),
  ...Object.fromEntries([
    'spirit-rib-meat', 'awakened-wood', 'resonant-ingot', 'awakened-hilt',
    'old-wood-hilt-resonant-greatblade-weapon', 'iron-birch-hilt-resonant-greatblade-weapon',
    'spiritwood-hilt-resonant-greatblade-weapon', 'awakened-hilt-resonant-greatblade-weapon',
  ].map(id => [id, `/assets/art/icons/${id}-flare-baiqu-v2.png`])),
  ...Object.fromEntries([
    'clear-spring-saliva', 'harmonizing-elixir', 'foundation-insight',
  ].map(id => [id, `/assets/art/icons/${id}-flare-baiqu-v3.png`])),
};
export const TECHNIQUE_ART: Record<string, string> = {
  ...Object.fromEntries([
    'cloudstep-art', 'mountainforce-art',
  ].map(id => [id, `/assets/art/techniques/${id}-flare-v3.png`])),
  'circulating-qi': '/assets/art/techniques/circulating-qi-flare-divine-v3.png',
};

export function SceneArt({ locationId, name }: { locationId: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = SCENE_ART[locationId];
  return <div className="scene-art" role="img" aria-label={`${name}场景`}>
    {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} />
      : <div className="scene-empty"><Mountain size={44} strokeWidth={1} /><span>{name}</span></div>}
  </div>;
}
export function CombatAvatar({ enemyId, name }: { enemyId?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = enemyId ? ENEMY_AVATARS[enemyId] : PLAYER_ART.avatar;
  const Icon = enemyId ? Swords : UserRound;
  return <div className={`combat-avatar ${enemyId ? 'hostile' : ''}`} role="img" aria-label={`${name}头像`}>
    {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <Icon size={38} strokeWidth={1.1} />}
  </div>;
}
