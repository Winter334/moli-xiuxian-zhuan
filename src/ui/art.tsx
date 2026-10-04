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
  ...Object.fromEntries([
    'green-vine-hill', 'renewal-valley', 'windstone-uplands',
    'cloudbreak-pass', 'redbanner-cliff', 'zhaoye-roadhead',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-cangzhao-v1.webp`])),
  ...Object.fromEntries([
    'whitebank-road', 'flowpetal-shallows', 'returning-current-bay', 'rosyreef-longshoal',
    'crossriver-stone-flat', 'zhaoye-waterfall', 'linzhao-crossing',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-zhaoye-v1.webp`])),
  ...Object.fromEntries([
    'qixia-overlook', 'rosyfall-plain', 'myriad-reed-marsh', 'flowcrystal-mountains',
    'layered-rosy-gardens', 'hanging-radiance-platform', 'qixia-veinguard', 'qixia-loop-array',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-qixia-v1.webp`])),
  ...Object.fromEntries([
    'chengzhao-lakeshore', 'mirror-tide-bay', 'thousand-crystal-marsh', 'silver-reed-ring',
    'floating-light-innerlake', 'cold-tide-lakeheart', 'chengzhao-gathering-array',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-chengzhao-v1.webp`])),
  ...Object.fromEntries([
    'jiyuan-ruins', 'collapsed-ward-street', 'fallen-tower-lanes', 'split-tower-courts',
    'empty-channel-ruinplain', 'hanging-bell-oldgate', 'jiyuan-lightchaser', 'ruin-meditation-room',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-jiyuan-v1.webp`])),
  ...Object.fromEntries([
    'jiyuan-brokenplain', 'fallen-edge-slope', 'bone-array-gully', 'split-stoneplain',
    'resting-armor-plain', 'remnant-flag-ringpass', 'layered-armor-gate',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-brokenplain-v1.webp`])),
  ...Object.fromEntries([
    'fallen-ark-outer', 'broken-gunwale-hall', 'four-aspect-puppet-workshop',
    'lost-command-corridor', 'armor-bearing-cabin', 'sealed-hub-forecourt',
    'ark-seizing-sidechamber', 'triangular-array-gate', 'hidden-hub-chamber',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-ark-outer-v1.webp`])),
  ...Object.fromEntries([
    'fallen-ark-inner', 'furnace-guard-corridor', 'essence-condensing-corridor',
    'energy-gathering-cabin', 'starbreaking-chamber', 'ark-meditation-cabin',
  ].map(id => [id, `/assets/art/scenes/${id}-sunburst-ark-inner-v1.webp`])),
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
  ...Object.fromEntries([
    'splitcrown-beast', 'core-shell-spirit', 'redbanner-saber-raider', 'chimebone-wingbeast',
    'mist-scale-chilong', 'walking-root-spirit', 'renewing-wood-spider', 'rockmarrow-carapace',
    'lanternbelly-mayfly', 'entwined-branch-spirit', 'silverbranch-spirit',
    'zhaochuan-material-steward', 'sacback-feral-beast', 'bladeridge-carapace',
    'windfold-scythebeast', 'redbanner-pass-guard', 'redbanner-chief',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-cangzhao-v1.png`])),
  ...Object.fromEntries([
    'redbanner-river-scout', 'mooring-wraith', 'tideshell-spirit-turtle', 'tidebound-bone-wight',
    'floatingblade-raider', 'flowpetal-water-shroom', 'mistbreathing-chilong', 'scarletarm-tidebeast',
    'cutstream-crossbowman', 'sunkentide-nightmarebeast', 'cutstream-heavy-bladesman',
    'mistcrown-shroom-spirit', 'coldboil-sacbeast', 'boatplundering-raider',
    'tideholding-reef-spirit', 'rosycloud-spirit', 'cutstream-chief', 'crossriver-bladesman',
    'poolguard-reef-spirit', 'jiuzhang-crossing-warden',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-zhaoye-v1.png`])),
  ...Object.fromEntries([
    'jiuzhang-plundering-cultivator', 'reedbinding-raider', 'pipebone-wraith',
    'petal-array-spirit', 'crystallimb-stone-spirit', 'gardenplundering-swordsman',
    'sickletail-crystal-scorpion', 'arrayback-shellbeast', 'rockcrown-longarm-beast',
    'veinguard-flame-spirit',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-qixia-v1.png`])),
  ...Object.fromEntries([
    'crystalplundering-bladesman', 'lake-ring-armored-guard', 'floating-ripple-spirit',
    'crystalspine-beast', 'reedbank-flame-spirit', 'frost-rune-guard',
    'horn-armored-lakebeast', 'crystalshell-stone-spirit', 'returning-edge-raider',
    'sacwing-lakebird', 'upright-goldfur-beast', 'tidebinding-gel-spirit',
    'layered-ripple-wraith', 'bluecrown-array-spirit', 'flowcloud-spell-spirit',
    'crystal-armored-spirit', 'frostreturn-wingbeast', 'ringeye-eightarm-beast',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-chengzhao-v1.png`])),
  'gathering-spell-spirit': '/assets/art/enemies/flowcloud-spell-spirit-flare-chengzhao-v1.png',
  'gathering-armored-spirit': '/assets/art/enemies/crystal-armored-spirit-flare-chengzhao-v1.png',
  'gathering-array-spirit': '/assets/art/enemies/bluecrown-array-spirit-flare-chengzhao-v1.png',
  ...Object.fromEntries([
    'ruin-patrolling-raider', 'chestbearing-shroom', 'brokenward-bladesman', 'withered-breath-raider',
    'bluebone-wraith', 'rustbrood-puppet', 'twinprism-spirit', 'thornshadow-ruinwraith',
    'marrowchasing-raider', 'bluemane-furbeast', 'ancient-rune-puppet', 'wandering-ruin-shadowbeast',
    'ringingedge-ruinbird', 'marrowchasing-leader', 'hiddenblade-earthbeast', 'lightchasing-nightmare',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-jiyuan-v1.png`])),
  'rustbrood-child': '/assets/art/enemies/rustbrood-puppet-flare-jiyuan-v1.png',
  ...Object.fromEntries([
    'gravel-armored-insect', 'layered-edge-wraith', 'galechasing-shadowbeast', 'ancient-coldiron-spirit',
    'darkfur-battlebeast', 'hidden-gel-spirit', 'contractbearing-raider', 'silkseizing-raider',
    'wormbone-wraith', 'arrayseizing-leader', 'mountaincrushing-beast', 'rampart-earthbeast',
    'flowing-silver-shadow', 'roadwaiting-old-raider', 'layered-armor-guardian',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-brokenplain-v1.png`])),
  ...Object.fromEntries([
    'layered-ark-guard', 'clamp-domain-puppet', 'thunderback-shellbeast', 'darkedge-heavy-puppet',
    'twinclamp-walking-puppet', 'crossarm-armor-puppet', 'turnbalance-heavy-puppet', 'wandering-rune-spirit',
    'blockedge-furnace-puppet', 'heavyhub-ark-guard', 'silveredge-blade-puppet', 'blackiron-war-puppet',
    'rampart-shield-puppet', 'batrobe-raider', 'sunchasing-heavy-puppet', 'edge-drinking-puppet',
    'piercing-light-turret', 'cabin-patrol-puppet', 'redhub-heavy-puppet',
    'triangular-hub-guard', 'hiddenhub-spirit-puppet',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-ark-outer-v1.png`])),
  'redbanner-ark-chief': '/assets/art/enemies/redbanner-chief-flare-cangzhao-v1.png',
  ...Object.fromEntries([
    'doorhub-command-armor', 'essence-drawing-array-spirit', 'radiant-beam-war-puppet',
    'triangular-patrol-puppet', 'thorncutting-walking-puppet', 'inversebalance-ark-spirit',
    'energy-gathering-core-spirit', 'breath-eroding-gel-wraith', 'golden-fur-beast',
    'silver-eye-core-spirit', 'threehead-wandering-serpent', 'starbreaking-heavy-puppet',
  ].map(id => [id, `/assets/art/enemies/${id}-flare-ark-inner-v1.png`])),
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
  ...Object.fromEntries([
    'century-willow', 'edgecleaving-pendant',
  ].map(id => [id, `/assets/art/icons/${id}-flare-cangzhao-study-v2.png`])),
  ...Object.fromEntries([
    'clear-tide-essence', 'waterfire-pendant',
  ].map(id => [id, `/assets/art/icons/${id}-flare-zhaoye-study-v1.png`])),
  ...Object.fromEntries([
    'tide-restraint-elixir', 'piercing-force-elixir', 'wound-guard-elixir',
    'returning-wind-elixir', 'sealed-spiritstone-crate', 'bulk-spiritstones',
  ].map(id => [id, `/assets/art/icons/${id}-flare-zhaoye-v1.png`])),
  ...Object.fromEntries([
    'purple-marrow', 'scarlet-marrow', 'cyan-marrow',
  ].map(id => [id, `/assets/art/icons/${id}-flare-marrow-study-v1.png`])),
  ...Object.fromEntries([
    'jade-reed-headwrap', 'jade-reed-leggings', 'jade-reed-boots',
    'jade-reed-headwrap-lined-resonant-head-shell',
    'jade-reed-leggings-lined-resonant-leg-shell', 'jade-reed-boots-lined-resonant-foot-shell',
    'jade-reed-headwrap-lined-returning-glow-head-shell',
    'jade-reed-leggings-lined-returning-glow-leg-shell', 'jade-reed-boots-lined-returning-glow-foot-shell',
  ].map(id => [id, `/assets/art/icons/${id}-flare-qixia-armor-v2.png`])),
  ...Object.fromEntries([
    'jade-reed-jacket', 'jade-reed-jacket-lined-resonant-body-shell',
    'jade-reed-jacket-lined-returning-glow-body-shell',
  ].map(id => [id, `/assets/art/icons/${id}-flare-qixia-armor-study-v2.png`])),
  ...Object.fromEntries([
    'rosy-spirit-reed', 'twining-crystal-powder', 'petal-array-fragment',
    'returning-glow-ingot', 'jade-reed-silk', 'returning-glow-blade', 'returning-glow-greatblade',
    'returning-glow-head-shell', 'returning-glow-body-shell',
    'returning-glow-leg-shell', 'returning-glow-foot-shell',
    'awakened-returning-glow-blade-weapon', 'awakened-returning-glow-greatblade-weapon',
  ].map(id => [id, `/assets/art/icons/${id}-flare-qixia-v1.png`])),
  ...Object.fromEntries([
    'chengzhao-core', 'bluegold-fragment', 'lakebeast-condensate', 'clear-crystal',
    'reed-veined-crystal', 'bluegold-ingot', 'crystal-hilt', 'bluegold-blade', 'bluegold-greatblade',
    'chengzhao-heart-pendant', 'blue-scaled-carp', 'green-veined-fish', 'cold-crystal-fish',
    'awakened-hilt-bluegold-blade-weapon', 'crystal-hilt-bluegold-blade-weapon',
    'crystal-returning-glow-blade-weapon',
  ].map(id => [id, `/assets/art/icons/${id}-flare-chengzhao-v1.png`])),
  ...Object.fromEntries([
    'awakened-hilt-bluegold-greatblade-weapon', 'crystal-hilt-bluegold-greatblade-weapon',
    'crystal-returning-glow-greatblade-weapon',
  ].map(id => [id, `/assets/art/icons/${id}-flare-chengzhao-greatsword-v2.png`])),
  ...Object.fromEntries([
    'ruin-essence', 'ruin-rune-fragment', 'green-cast-coin',
    'clearjade-blade', 'clearjade-greatblade', 'amber-marrow', 'azure-marrow', 'threephase-pendant',
    'clearjade-head-shell', 'clearjade-body-shell', 'clearjade-leg-shell', 'clearjade-foot-shell',
    'ruin-restoration-elixir', 'ruin-surge-elixir', 'ruin-meditation-kit',
    'crystal-clearjade-blade-weapon', 'crystal-clearjade-greatblade-weapon',
    'jade-reed-headwrap-lined-clearjade-head-shell', 'jade-reed-jacket-lined-clearjade-body-shell',
    'jade-reed-leggings-lined-clearjade-leg-shell', 'jade-reed-boots-lined-clearjade-foot-shell',
  ].map(id => [id, `/assets/art/icons/${id}-flare-jiyuan-v1.png`])),
  ...Object.fromEntries([
    'beast-marrow-fat', 'charged-gel', 'charged-silk', 'stable-essence-pill',
    'radiant-marrow', 'stellar-marrow', 'clearjade-ingot',
    'charged-headwrap', 'charged-jacket', 'charged-leggings', 'charged-boots',
    'charged-headwrap-lined-clearjade-head-shell', 'charged-jacket-lined-clearjade-body-shell',
    'charged-leggings-lined-clearjade-leg-shell', 'charged-boots-lined-clearjade-foot-shell',
  ].map(id => [id, `/assets/art/icons/${id}-flare-brokenplain-v1.png`])),
  ...Object.fromEntries([
    'forge-array-mark', 'thunder-spirit-symbol', 'foreign-contract-coin', 'high-ark-core',
    'old-armor-fragment', 'redglow-steel', 'condensed-gel-block', 'condensed-gel-hilt',
    'redglow-blade', 'redglow-greatblade',
    'condensed-redglow-blade-weapon', 'condensed-redglow-greatblade-weapon',
    'condensed-clearjade-blade-weapon', 'condensed-clearjade-greatblade-weapon',
    'breakfront-array-pendant', 'ancient-contract-disk', 'ark-ward-contract',
  ].map(id => [id, `/assets/art/icons/${id}-flare-ark-outer-v1.png`])),
  ...Object.fromEntries([
    'rising-blood-elixir', 'sealed-gel-crate', 'sealed-ark-core-crate',
    'purple-cast-coin', 'star-dissolution-disk',
  ].map(id => [id, `/assets/art/icons/${id}-flare-ark-inner-v1.png`])),
};
export const TECHNIQUE_ART: Record<string, string> = {
  ...Object.fromEntries([
    'cloudstep-art', 'mountainforce-art',
  ].map(id => [id, `/assets/art/techniques/${id}-flare-v3.png`])),
  'circulating-qi': '/assets/art/techniques/circulating-qi-flare-divine-v3.png',
  ...Object.fromEntries([
    'surging-tide-art', 'flowchasing-art', 'scattered-rain-art',
  ].map(id => [id, `/assets/art/techniques/${id}-flare-zhaoye-v1.png`])),
  domain: '/assets/art/techniques/domain-flare-brokenplain-v1.png',
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
