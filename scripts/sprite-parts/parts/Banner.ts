import { darken, lighten, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface BannerConfig extends PartConfig {
  color: Rgb;
  pole?: Rgb;
  swallowtail?: boolean;
}

export const banner: SpritePart<BannerConfig> = (renderer, box, config, _seed) => {
  const pole = config.pole ?? { r: 82, g: 57, b: 34 };
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  const width = Math.max(2, Math.round(box.width));
  const height = Math.max(2, Math.round(box.height));
  renderer.line(left, top - 2, left, top + height + 2, withAlpha(pole, 255), 1);
  const bottom = config.swallowtail ? top + height - 2 : top + height;
  const points = config.swallowtail
    ? [{ x: left + 1, y: top }, { x: left + width, y: top }, { x: left + width - 2, y: bottom }, { x: left + width / 2, y: bottom - 2 }, { x: left + 1, y: bottom }]
    : [{ x: left + 1, y: top }, { x: left + width, y: top }, { x: left + width, y: bottom }, { x: left + 1, y: bottom }];
  renderer.fillPolygon(points, withAlpha(config.color, 255));
  renderer.line(left + 2, top + 1, left + width - 2, top + 1, withAlpha(lighten(config.color, 0.35), 190));
  renderer.line(left + width - 1, top, left + width - 1, bottom, withAlpha(darken(config.color, 0.25), 180));
};
