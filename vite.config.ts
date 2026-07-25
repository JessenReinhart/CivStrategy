import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Dev-only plugin: relays game FPS + profile hogs browser → terminal via HMR. */
function fpsTerminalLogger(): Plugin {
  return {
    name: 'fps-terminal-logger',
    configureServer(server) {
      type Hog = { name: string; ms: number; pct: number };
      type FpsPayload = {
        fps: number;
        units: number;
        frameMs: number;
        updateMs: number;
        renderMs: number;
        hogs?: Hog[];
      };
      server.ws.on('game:fps', (data: FpsPayload) => {
        const { fps, units, frameMs, updateMs, renderMs, hogs } = data;
        const color = fps >= 55 ? '\x1b[32m' : fps >= 30 ? '\x1b[33m' : '\x1b[31m';
        const dim = '\x1b[2m';
        const reset = '\x1b[0m';
        const hogStr = (hogs && hogs.length > 0)
          ? hogs
              .slice(0, 5)
              .map((h) => `${h.name} ${h.ms.toFixed(1)}ms`)
              .join(' · ')
          : '…profiling';
        // Clear line + write rich one-liner (pads so leftover chars don't linger)
        const line =
          `${color}[FPS] ${fps.toFixed(1)} | ${frameMs.toFixed(1)}ms/frame` +
          `${reset}${dim} (upd ${updateMs.toFixed(1)} + ren ${renderMs.toFixed(1)})` +
          `${reset} | ${units}u | ${color}hogs: ${hogStr}${reset}`;
        process.stdout.write(`\r\x1b[K${line}   `);
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), fpsTerminalLogger()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Ensure large game assets don't break the build
    chunkSizeWarningLimit: 1000,
  }
});
