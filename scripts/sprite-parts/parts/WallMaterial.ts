import { darken, lighten, withAlpha } from '../CanvasRenderer.ts';
import type { PartConfig, Rgb, SpritePart } from '../types.ts';

export interface WallConfig extends PartConfig {
  color: Rgb;
  style?: 'plaster' | 'wood' | 'stone';
  shade?: boolean;
}

export const wallMaterial: SpritePart<WallConfig> = (renderer, box, config, _seed) => {
  const style = config.style ?? 'plaster';
  const color = config.color;
  const light = lighten(color, 0.15);
  const dark = darken(color, 0.2);

  const left = Math.round(box.x);
  const top = Math.round(box.y);
  const right = Math.round(box.x + box.width);
  const bottom = Math.round(box.y + box.height);
  const centerX = Math.round(left + box.width * 0.5);

  // Main wall face
  renderer.fillRect(left, top, box.width, box.height, withAlpha(color, 255));

  if (style === 'wood') {
    // Vertical planks
    const plankCount = Math.max(2, Math.floor(box.width / 8));
    const plankWidth = box.width / plankCount;
    for (let i = 1; i < plankCount; i++) {
      const x = Math.round(left + i * plankWidth);
      renderer.line(x, top, x, bottom, withAlpha(dark, 255), 1);
    }
  } else if (style === 'stone') {
    // Irregular stones as small inset rectangles
    const rows = Math.max(2, Math.floor(box.height / 6));
    const cols = Math.max(2, Math.floor(box.width / 6));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sx = left + col * 6 + (row % 2) * 3;
        const sy = top + row * 6;
        if (sx + 4 <= right && sy + 4 <= bottom) {
          renderer.fillRect(sx + 1, sy + 1, 4, 4, withAlpha(dark, 255));
        }
      }
    }
  }

  // Simple light/shadow planes to fake an isometric corner
  if (config.shade !== false) {
    renderer.fillRect(left, top, Math.max(1, centerX - left), box.height, withAlpha(light, 60));
    renderer.fillRect(centerX, top, Math.max(1, right - centerX), box.height, withAlpha(dark, 60));
  }
};
