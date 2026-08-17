# P0 音频资源

本目录包含美术资源 TODO 中的 P0 音频首版交付：

- `bgm_*.mp3`：主菜单 + 7 章节，共 8 首已接入运行时的循环 BGM；同名 WAV 为源目录中的兼容占位版本。
- `sfx_*.wav`：按钮、打字机、投篮、潜行、收集、转场、结局与翻墙反馈，共 12 条。

音频为项目内生成的原创素材，运行时由 `src/config.js` 的 `AUDIO_MANIFEST` 统一预加载，并由 `AudioManager` 按 `bgm_` / `sfx_` 前缀分流。Vite 开发服务器和生产构建都会提供 `assets/audio/bgm_*.mp3` 路径。
