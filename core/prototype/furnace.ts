import { z } from 'zod';

export const furnaceTierSchema = z.union([z.literal(0), z.literal(2), z.literal(4)]);
export type FurnaceTier = z.infer<typeof furnaceTierSchema>;

interface FurnaceDefinition {
  name: string;
  description: string;
  upgrade: { tier: FurnaceTier; materials: Record<string, number> } | null;
}

export const FURNACES: Record<FurnaceTier, FurnaceDefinition> = {
  0: {
    name: '粗制小炉',
    description: '村中常见的小铁炉，炉壁粗厚，可以随行搬用。',
    upgrade: { tier: 2, materials: { 'azure-iron-ingot': 3, 'ember-coal': 1 } },
  },
  2: {
    name: '青纹炉',
    description: '青纹铁补铸的炉壁泛着细纹，内膛经地火煤烧炼，受热较为均匀。',
    upgrade: { tier: 4, materials: { 'deepsteel-ingot': 2, 'formation-core': 1 } },
  },
  4: {
    name: '沉渊炉',
    description: '沉渊钢重铸的炉体上嵌着修整过的阵枢，细密阵纹沿炉膛分布。',
    upgrade: null,
  },
};
