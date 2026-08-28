import { darken, lighten, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface PorchConfig extends PartConfig {
  color: Rgb;
  posts?: number;
}

export const porch: SpritePart<PorchConfig> = (renderer, box, config, _seed) => {
  const depth = Math.max(2, Math.round(box.height * 0.3));
  const deckY = box.y + box.height - depth;
  renderer.fillRect(box.x, deckY, box.width, depth, withAlpha(config.color, 255));
  renderer.fillRect(box.x, deckY + depth - 2, box.width, 2, withAlpha(darken(config.color, 0.25), 255));
  const posts = Math.max(2, Math.round(config.posts ?? 2));
  for (let i = 0; i < posts; i++) {
    const x = box.x + (posts === 1 ? box.width / 2 : i * box.width / (posts - 1));
    renderer.fillRect(Math.round(x - 1), box.y, 2, depth, withAlpha(lighten(config.color, 0.2), 255));
  }
};
