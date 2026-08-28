import { darken, lighten, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface DoorConfig extends PartConfig {
  color: Rgb;
  trim?: Rgb;
  arch?: boolean;
  knob?: boolean;
}

export const door: SpritePart<DoorConfig> = (renderer, box, config, _seed) => {
  const trim = config.trim ?? lighten(config.color, 0.25);
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  const width = Math.max(2, Math.round(box.width));
  const height = Math.max(2, Math.round(box.height));
  renderer.fillRect(left - 1, top - 1, width + 2, height + 2, withAlpha(trim, 255));
  renderer.fillRect(left, top, width, height, withAlpha(config.color, 255));
  if (config.arch) renderer.fillEllipse(left + width / 2, top, width / 2, Math.max(1, width / 2), withAlpha(config.color, 255));
  renderer.line(left + width - 2, top + 2, left + width - 2, top + height - 2, withAlpha(darken(config.color, 0.3), 180));
  if (config.knob !== false) renderer.fillEllipse(left + width - 3, top + height * 0.55, 1, 1, withAlpha(lighten(config.color, 0.55), 255));
};
