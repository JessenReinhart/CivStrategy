import { darken, lighten, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface RoofConfig extends PartConfig {
  color: Rgb;
  style?: 'gable' | 'hip' | 'flat';
  ridge?: boolean;
}

export const roofMaterial: SpritePart<RoofConfig> = (renderer, box, config, _seed) => {
  const style = config.style ?? 'gable';
  const base = config.color;
  const light = lighten(base, 0.18);
  const dark = darken(base, 0.28);
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  const right = Math.round(box.x + box.width);
  const bottom = Math.round(box.y + box.height);
  const center = Math.round((left + right) / 2);

  if (style === 'flat') {
    renderer.fillRect(left, top + 3, box.width, Math.max(1, box.height - 3), withAlpha(base, 255));
    renderer.fillRect(left, top, box.width, 3, withAlpha(light, 255));
  } else {
    const rows = Math.max(1, Math.floor(box.height));
    for (let row = 0; row < rows; row++) {
      const t = rows === 1 ? 0 : row / (rows - 1);
      const half = style === 'hip' ? Math.round((box.width * 0.3) + (box.width * 0.5) * t) : Math.round((box.width * 0.12) + (box.width * 0.5) * t);
      const y = top + row;
      const x = center - half;
      renderer.fillRect(x, y, half * 2, 1, withAlpha(row < rows * 0.24 ? light : row > rows * 0.72 ? dark : base, 255));
      if (style === 'gable') renderer.line(center, y, center, y, withAlpha(light, 90));
    }
  }
  if (config.ridge !== false && style !== 'flat') renderer.fillRect(center - 2, top, 4, 2, withAlpha(light, 255));
  renderer.fillRect(left, bottom - 2, box.width, 2, withAlpha(dark, 220));
};
