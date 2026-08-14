import { describe, expect, it, vi } from 'vitest';
import { GAME, MAIN_MENU_BACKGROUND_URL } from '../../src/config.js';
import { GXE_SPRITE_SPECS } from '../../src/core/GooseSprite.js';
import { MainMenuScene } from '../../src/scenes/MainMenuScene.js';

function createScene({ assetLoader = null, saveData = null } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const endingReviewPanel = {
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    onClose: null,
  };

  const sceneManager = { change: vi.fn() };
  const saveSystem = {
    load: vi.fn(() => saveData),
    getProgress: vi.fn(() => 42),
  };
  const scene = new MainMenuScene({
    sceneManager,
    saveSystem,
    settingsPanel: { show: vi.fn(), hide: vi.fn() },
    endingReviewPanel,
    assetLoader,
    container,
  });

  return { scene, container, endingReviewPanel, sceneManager, saveSystem };
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

  it('加载游戏内正式待机图集并裁切当前帧到主菜单站位', async () => {
    const image = { naturalWidth: 1024, naturalHeight: 512 };
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

    await scene._loadMenuGoose();
    scene._drawGoose(ctx);

    expect(assetLoader.loadImage).toHaveBeenCalledWith(GXE_SPRITE_SPECS.idle.src);
    expect(assetLoader.loadImage).toHaveBeenCalledWith(GXE_SPRITE_SPECS.walk.src);
    expect(ctx.rotate).toHaveBeenCalledWith(expect.any(Number));
    expect(ctx.drawImage).toHaveBeenCalledWith(
      image,
      0,
      0,
      GXE_SPRITE_SPECS.idle.config.atlas.frameW,
      GXE_SPRITE_SPECS.idle.config.atlas.frameH,
      expect.any(Number),
      expect.any(Number),
      190,
      230,
    );
    container.remove();
  });

  it('主菜单莞小鹅按游戏内待机帧率推进图集帧', async () => {
    const image = { naturalWidth: 1024, naturalHeight: 512 };
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

    await scene._loadMenuGoose();
    scene.update(1 / GXE_SPRITE_SPECS.walk.config.animations.walk.fps);
    scene._drawGoose(ctx);

    expect(ctx.drawImage).toHaveBeenCalledWith(
      image,
      GXE_SPRITE_SPECS.idle.config.atlas.frameW,
      0,
      GXE_SPRITE_SPECS.idle.config.atlas.frameW,
      GXE_SPRITE_SPECS.idle.config.atlas.frameH,
      expect.any(Number),
      expect.any(Number),
      190,
      230,
    );
    container.remove();
  });

  it('主菜单使用与游戏内相同的逐帧落脚点锚点', async () => {
    const image = { naturalWidth: 1024, naturalHeight: 1024 };
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

    await scene._loadMenuGoose();
    scene._drawGoose(ctx);

    const anchor = GXE_SPRITE_SPECS.walk.config.animations.walk.frameAnchors[0];
    expect(ctx.drawImage).toHaveBeenLastCalledWith(
      image,
      0,
      0,
      256,
      256,
      -190 * anchor.x,
      -230 * anchor.y,
      190,
      230,
    );
    container.remove();
  });

  it('主菜单莞小鹅会在出发位与工厂门口之间往返，而不是静态摆放', async () => {
    const image = { naturalWidth: 1024, naturalHeight: 512 };
    const assetLoader = { loadImage: vi.fn().mockResolvedValue(image) };
    const { scene, container } = createScene({ assetLoader });

    await scene._loadMenuGoose();

    expect(scene._getMenuGoosePose()).toMatchObject({ mode: 'walk', flipX: false });
    scene.motionTime = 3;
    expect(scene._getMenuGoosePose()).toMatchObject({ mode: 'idle', flipX: false });
    scene.motionTime = 9;
    expect(scene._getMenuGoosePose()).toMatchObject({ mode: 'walk', flipX: true });

    container.remove();
  });

  it('主菜单五个入口统一使用按钮主题并保留主次层级', () => {
    const { scene, container } = createScene();

    scene.onEnter();

    const buttons = [...container.querySelectorAll('[data-main-menu-buttons] [data-ui-button]')];
    expect(buttons).toHaveLength(5);
    expect(buttons.map((button) => button.dataset.variant)).toEqual([
      'primary',
      'primary',
      'secondary',
      'secondary',
      'secondary',
    ]);
    expect(buttons[0].dataset.size).toBe('lg');
    expect(buttons[2].dataset.size).toBe('md');

    scene.onExit();
    expect(container.querySelector('[data-main-menu]')).toBeNull();
    container.remove();
  });

  it('主菜单按钮悬停态保持正式材质的完整铺陈规则', () => {
    const { scene, container } = createScene();

    scene.onEnter();

    const styleText = document.getElementById('main-menu-formal-ui-styles').textContent;
    const hoverRule = styleText.match(
      /\[data-main-menu-buttons\] \[data-main-menu-button\]:hover:not\(:disabled\),\s*\[data-main-menu-buttons\] \[data-main-menu-button\]\[data-state="hover"\] \{([\s\S]*?)\}/,
    )?.[1] ?? '';

    expect(hoverRule).toContain('background-position: center;');
    expect(hoverRule).toContain('background-repeat: no-repeat;');
    expect(hoverRule).toContain('background-size: 100% 100%;');

    scene.onExit();
    container.remove();
  });

  it('窄横屏将五个入口压缩为 2 列网格，避免按钮挤满短屏', () => {
    const { scene, container } = createScene();

    scene.onEnter();

    const styleText = document.getElementById('main-menu-formal-ui-styles').textContent;
    expect(styleText).toContain('@media (max-width: 1100px)');
    expect(styleText).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(styleText).toContain('grid-column: 1 / -1;');
    expect(styleText).toContain('aspect-ratio: 960 / 313;');

    scene.onExit();
    container.remove();
  });

  it('点击结尾回顾入口打开回顾面板', () => {
    const { scene, container, endingReviewPanel } = createScene();

    scene.onEnter();
    const reviewButton = [...container.querySelectorAll('[data-main-menu-buttons] [data-ui-button]')]
      .find((button) => button.textContent === '结尾回顾');

    reviewButton.click();

    expect(endingReviewPanel.show).toHaveBeenCalledTimes(1);
    scene.onExit();
    expect(endingReviewPanel.close).toHaveBeenCalled();
    container.remove();
  });

  it('继续游戏把章节内快照一并传给目标场景', () => {
    const saveData = {
      chapter: 'ch2',
      checkpoint: { phase: 'explore', player: { x: 512, y: 388 } },
    };
    const { scene, container, sceneManager } = createScene({ saveData });

    scene.onEnter();
    scene._onContinueClick();

    expect(sceneManager.change).toHaveBeenCalledWith('ch2', {
      saveData,
      restore: saveData.checkpoint,
    });
    scene.onExit();
    container.remove();
  });
});
