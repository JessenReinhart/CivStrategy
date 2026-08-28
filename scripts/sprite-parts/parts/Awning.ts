import { darken, lighten, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface AwningConfig extends PartConfig {
  color: Rgb;
  stripes?: Rgb;
}

export const awning: SpritePart<AwningConfig> = (renderer, box, config, _seed) => {
  const stripe = config.stripes ?? lighten(config.color, 0.35);
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  const width = Math.max(2, Math.round(box.width));
  const height = Math.max(2, Math.round(box.height));
  renderer.fillPolygon([{ x: left, y: top }, { x: left + width, y: top }, { x: left + width - 2, y: top + height }, { x: left + 2, y: top + height }], withAlpha(config.color, 255));
  for (let x = 2; x < width - 1; x += 4) renderer.line(left + x, top + 1, left + x - 1, top + height - 1, withAlpha(stripe, 210));
  renderer.line(left + 1, top + height, left + width - 1, top + height, withAlpha(darken(config.color, 0.25), 255));
};
