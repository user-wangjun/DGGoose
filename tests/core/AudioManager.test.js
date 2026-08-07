import { describe, expect, it } from 'vitest';
import { AudioManager } from '../../src/core/AudioManager.js';

function createAudioStub() {
  return {
    loop: false,
    cloneNode: () => ({ volume: 0, play: () => Promise.resolve() }),
  };
}

describe('AudioManager P0 资源分流', () => {
  it('按 URL 前缀自动把 BGM 与 SFX 放入各自缓存', () => {
    const manager = new AudioManager();
    manager.loadFromCache(new Map([
      ['assets/audio/bgm_menu.mp3', createAudioStub()],
      ['assets/audio/sfx_click.wav', createAudioStub()],
    ]));

    expect(manager.bgmCache.has('menu')).toBe(true);
    expect(manager.sfxCache.has('click')).toBe(true);
    expect(manager.bgmCache.get('menu').loop).toBe(true);
  });
});
