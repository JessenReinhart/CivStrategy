import { darken, lighten, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface ChimneyConfig extends PartConfig {
  color: Rgb;
  cap?: boolean;
  smoke?: boolean;
}

export const chimney: SpritePart<ChimneyConfig> = (renderer, box, config, seed) => {
  const width = Math.max(2, Math.round(box.width));
  const height = Math.max(2, Math.round(box.height));
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  renderer.fillRect(left, top, width, height, withAlpha(config.color, 255));
  renderer.fillRect(left, top, width, 2, withAlpha(lighten(config.color, 0.2), 255));
  renderer.fillRect(left + width - 2, top, 2, height, withAlpha(darken(config.color, 0.2), 220));
  if (config.cap !== false) renderer.fillRect(left - 1, top - 1, width + 2, 2, withAlpha(darken(config.color, 0.25), 255));
  if (config.smoke) {
    const drift = ((Math.trunc(seed) >>> 0) % 3) - 1;
    renderer.fillEllipse(left + width / 2 + drift, top - 4, 2, 2, withAlpha({ r: 112, g: 113, b: 107 }, 120));
    renderer.fillEllipse(left + width / 2 + drift * 2, top - 8, 2, 2, withAlpha({ r: 140, g: 140, b: 130 }, 90));
  }
};
