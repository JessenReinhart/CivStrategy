import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateHouseFamily, generateHouseSprite } from '../definitions/HouseFamily.ts';
import { generateCivilianAtlas } from '../definitions/CivilianSpriteFamily.ts';
import { generatePropFamily } from '../definitions/PropFamily.ts';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Living City sprite pipeline', () => {
  it('generates identical house bytes for the same definition and seed', () => {
    const definition = { age: 'town' as const, faction: 'roman', variant: 2, seed: 90210 };
    const first = generateHouseSprite(definition).png;
    const second = generateHouseSprite(definition).png;
    expect(sha256(first)).toBe(sha256(second));
    expect(first).toEqual(second);
  });

  it('creates a coherent family with distinct village and town variants', () => {
    const family = generateHouseFamily(42);
    expect(family).toHaveLength(8);
    expect(new Set(family.map((sprite) => sprite.key)).size).toBe(8);
    expect(family.every((sprite) => sprite.width === 128 && sprite.height === 128)).toBe(true);
    expect(new Set(family.map((sprite) => sha256(sprite.png))).size).toBeGreaterThan(1);
    expect(family.some((sprite) => sprite.metadata.corner)).toBe(true);
  });

  it('keeps civilian and prop atlas generation deterministic', () => {
    const civiliansA = generateCivilianAtlas(116);
    const civiliansB = generateCivilianAtlas(116);
    expect(civiliansA.png).toEqual(civiliansB.png);
    expect(civiliansA.frames).toHaveLength(15);
    expect(generatePropFamily(0x517a9d31).map((sprite) => sha256(sprite.pixels))).toEqual(
      generatePropFamily(0x517a9d31).map((sprite) => sha256(sprite.pixels)),
    );
  });
});
