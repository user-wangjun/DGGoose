import { describe, expect, it, vi } from 'vitest';
import { GAME, MAIN_MENU_BACKGROUND_URL, MAIN_MENU_GOOSE_URL } from '../../src/config.js';
import { MainMenuScene } from '../../src/scenes/MainMenuScene.js';

function createScene({ assetLoader = null } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const scene = new MainMenuScene({
    sceneManager: { change: vi.fn() },
    saveSystem: { load: vi.fn(() => null) },
    settingsPanel: { show: vi.fn(), hide: vi.fn() },
    assetLoader,
    container,
  });

  return { scene, container };
}

describe('MainMenuScene 主菜单背景', () => {
  it('加载背景资源后按逻辑画布尺寸绘制', async () => {
    const image = { id: 'main-menu-background' };
    const assetLoader = { loadImage: vi.fn().mockResolvedValue(image) };
    const { scene, container } = createScene({ assetLoader });
    const ctx = { drawImage: vi.fn() };

    await scene._loadBackground();
    scene._drawBackground(ctx);

    expect(assetLoader.loadImage).toHaveBeenCalledWith(MAIN_MENU_BACKGROUND_URL);
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, GAME.WIDTH, GAME.HEIGHT);
    container.remove();
  });

  it('背景加载失败时保留渐变回退', () => {
    const { scene, container } = createScene();
    const gradient = { addColorStop: vi.fn() };
    const ctx = {
      createLinearGradient: vi.fn(() => gradient),
      fillRect: vi.fn(),
      fillStyle: '',
    };

    scene._drawBackground(ctx);

    expect(ctx.createLinearGradient).toHaveBeenCalledWith(0, 0, 0, GAME.HEIGHT);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, GAME.WIDTH, GAME.HEIGHT);
    container.remove();
  });

  it('加载正面莞小鹅并在主菜单站位做轻微摇头晃脑', async () => {
    const image = { naturalWidth: 599, naturalHeight: 1074 };
    const assetLoader = { loadImage: vi.fn().mockResolvedValue(image) };
    const { scene, container } = createScene({ assetLoader });
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
    };

    scene.update(0.5);
    await scene._loadMenuGoose();
    scene._drawGoose(ctx);

    expect(assetLoader.loadImage).toHaveBeenCalledWith(MAIN_MENU_GOOSE_URL);
    expect(ctx.rotate).toHaveBeenCalledWith(expect.any(Number));
    expect(ctx.drawImage).toHaveBeenCalledWith(
      image,
      0,
      0,
      image.naturalWidth,
      image.naturalHeight,
      expect.any(Number),
      expect.any(Number),
      128,
      230,
    );
    container.remove();
  });

  it('主菜单四个入口统一使用按钮主题并保留主次层级', () => {
    const { scene, container } = createScene();

    scene.onEnter();

    const buttons = [...container.querySelectorAll('[data-main-menu-buttons] [data-ui-button]')];
    expect(buttons).toHaveLength(4);
    expect(buttons.map((button) => button.dataset.variant)).toEqual([
      'primary',
      'primary',
      'secondary',
      'secondary',
    ]);
    expect(buttons[0].dataset.size).toBe('lg');
    expect(buttons[2].dataset.size).toBe('md');

    scene.onExit();
    expect(container.querySelector('[data-main-menu]')).toBeNull();
    container.remove();
  });
});
