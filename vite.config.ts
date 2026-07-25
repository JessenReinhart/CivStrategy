import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Dev-only plugin: relays game FPS from browser → terminal via HMR WebSocket. */
function fpsTerminalLogger(): Plugin {
  return {
    name: 'fps-terminal-logger',
    configureServer(server) {
      server.ws.on('game:fps', (data: { fps: number; units: number; frameMs: number }) => {
        const { fps, units, frameMs } = data;
        const color = fps >= 55 ? '\x1b[32m' : fps >= 30 ? '\x1b[33m' : '\x1b[31m';
        const reset = '\x1b[0m';
        process.stdout.write(
          `\r${color}[FPS] ${fps.toFixed(1)} | ${units} units | ${frameMs.toFixed(1)}ms/frame${reset}   `
        );
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
