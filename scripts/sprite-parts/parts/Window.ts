import { darken, lighten, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface WindowConfig extends PartConfig {
  frame: Rgb;
  glass?: Rgb;
  crossbar?: boolean;
  glow?: boolean;
}

export const window: SpritePart<WindowConfig> = (renderer, box, config, _seed) => {
  const glass = config.glass ?? { r: 38, g: 71, b: 92 };
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  const width = Math.max(2, Math.round(box.width));
  const height = Math.max(2, Math.round(box.height));
  renderer.fillRect(left - 1, top - 1, width + 2, height + 2, withAlpha(config.frame, 255));
  renderer.fillRect(left, top, width, height, withAlpha(glass, 255));
  if (config.glow) renderer.fillRect(left + 1, top + 1, Math.max(1, width - 2), 1, withAlpha(lighten(glass, 0.5), 180));
  if (config.crossbar !== false) {
    renderer.line(left + width / 2, top, left + width / 2, top + height, withAlpha(config.frame, 255));
    renderer.line(left, top + height / 2, left + width, top + height / 2, withAlpha(config.frame, 255));
  }
  renderer.line(left, top + height, left + width, top + height, withAlpha(darken(config.frame, 0.25), 180));
};
