import { darken, lighten, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface PropConfig extends PartConfig {
  color: Rgb;
  accent?: Rgb;
  count?: number;
}

export const crate: SpritePart<PropConfig> = (renderer, box, config, _seed) => {
  const accent = config.accent ?? lighten(config.color, 0.3);
  const count = Math.max(1, Math.round(config.count ?? 1));
  const size = Math.max(2, Math.floor(Math.min(box.width, box.height) / Math.max(1, Math.ceil(Math.sqrt(count)))));
  for (let i = 0; i < count; i++) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const x = box.x + (i % cols) * size;
    const y = box.y + Math.floor(i / cols) * size;
    renderer.fillRect(x, y, size - 1, size - 1, withAlpha(config.color, 255));
    renderer.line(x, y, x + size - 2, y + size - 2, withAlpha(accent, 220));
    renderer.line(x + size - 2, y, x, y + size - 2, withAlpha(darken(config.color, 0.15), 180));
  }
};

export const barrel: SpritePart<PropConfig> = (renderer, box, config, _seed) => {
  const accent = config.accent ?? darken(config.color, 0.35);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  renderer.fillEllipse(cx, cy, Math.max(2, box.width / 2), Math.max(2, box.height / 2), withAlpha(config.color, 255));
  renderer.line(cx - box.width / 2, cy, cx + box.width / 2, cy, withAlpha(accent, 255), 1);
  renderer.line(cx, box.y + 1, cx, box.y + box.height - 1, withAlpha(lighten(config.color, 0.2), 140), 1);
};

export const hay: SpritePart<PropConfig> = (renderer, box, config, _seed) => {
  const accent = config.accent ?? lighten(config.color, 0.22);
  renderer.fillEllipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, withAlpha(config.color, 255));
  for (let i = 1; i < 4; i++) renderer.line(box.x + i * box.width / 4, box.y + 2, box.x + i * box.width / 4 - 1, box.y + box.height - 2, withAlpha(accent, 200));
};

export const prop = crate;
