import { darken, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface FoundationConfig extends PartConfig {
  color: Rgb;
  depth?: number;
}

export const foundation: SpritePart<FoundationConfig> = (renderer, box, config, _seed) => {
  const depth = Math.max(1, Math.round(config.depth ?? Math.min(8, box.height * 0.18)));
  renderer.fillRect(box.x, box.y + box.height - depth, box.width, depth, withAlpha(config.color, 255));
  renderer.fillRect(box.x, box.y + box.height - 2, box.width, 2, withAlpha(darken(config.color, 0.28), 255));
};
