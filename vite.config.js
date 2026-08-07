import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const BGM_AUDIO_FILES = [
  'bgm_menu.mp3',
  'bgm_factory.mp3',
  'bgm_basketball.mp3',
  'bgm_lychee.mp3',
  'bgm_goose.mp3',
  'bgm_industrial.mp3',
  'bgm_campus.mp3',
  'bgm_songshan.mp3',
];

function serveAndCopyBgmAssets() {
  const sourceDir = path.resolve('assets/audio');
  let buildAudioDir;

  return {
    name: 'serve-and-copy-bgm-assets',
    configResolved(config) {
      buildAudioDir = path.resolve(config.root, config.build.outDir, 'assets/audio');
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0] ?? '';
        const prefix = '/assets/audio/';
        if (!pathname.startsWith(prefix)) {
          next();
          return;
        }

        const filename = decodeURIComponent(pathname.slice(prefix.length));
        if (!BGM_AUDIO_FILES.includes(filename)) {
          next();
          return;
        }

        const filePath = path.resolve(sourceDir, filename);
        if (!filePath.startsWith(`${sourceDir}${path.sep}`) || !fs.existsSync(filePath)) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader('Content-Type', 'audio/mpeg');
        fs.createReadStream(filePath).pipe(response);
      });
    },
    closeBundle() {
      fs.mkdirSync(buildAudioDir, { recursive: true });
      for (const filename of BGM_AUDIO_FILES) {
        fs.copyFileSync(path.join(sourceDir, filename), path.join(buildAudioDir, filename));
      }
    },
  };
}

// Vite 配置：base 相对路径保证可放任意子目录离线部署，dev 端口固定 5173
export default defineConfig({
  base: './',
  plugins: [serveAndCopyBgmAssets()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js'],
  },
});
