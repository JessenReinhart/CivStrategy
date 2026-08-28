import { darken, lighten, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface FenceConfig extends PartConfig {
  color: Rgb;
  posts?: number;
  rails?: number;
}

export const fence: SpritePart<FenceConfig> = (renderer, box, config, _seed) => {
  const posts = Math.max(2, Math.round(config.posts ?? Math.max(2, box.width / 10)));
  const rails = Math.max(1, Math.round(config.rails ?? 2));
  const light = lighten(config.color, 0.18);
  const dark = darken(config.color, 0.25);
  for (let i = 0; i < posts; i++) {
    const x = box.x + (posts === 1 ? 0 : i * box.width / (posts - 1));
    renderer.fillRect(Math.round(x - 1), box.y, 2, box.height, withAlpha(config.color, 255));
    renderer.fillRect(Math.round(x - 1), box.y, 1, box.height, withAlpha(light, 220));
  }
  for (let i = 1; i <= rails; i++) {
    const y = box.y + i * box.height / (rails + 1);
    renderer.line(box.x, y, box.x + box.width, y, withAlpha(dark, 255), 2);
  }
};
