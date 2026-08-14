import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { EndingCG } from '../../src/ui/EndingCG.js';
import { ENDING_CG_URL_MAP } from '../../src/config.js';
import { ENDINGS } from '../../src/data/endings.js';
import { ENDING_CG_DISPLAY_CONFIG, getEndingCGDisplayConfig } from '../../src/ui/EndingCG.js';
import { EventBus } from '../../src/core/EventBus.js';

describe('正式结尾 CG', () => {
  let container;
  let endingCG;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    endingCG = new EndingCG({
      eventBus: new EventBus(),
      container,
      badgeSystem: { unlockOrReveal: () => {} },
    });
  });

  afterEach(() => {
    endingCG.hide();
    container.remove();
  });

  it('六个结局都有独立的本地 CG 资源', () => {
    expect(Object.keys(ENDING_CG_URL_MAP)).toHaveLength(6);
    expect(ENDING_CG_URL_MAP.basketball_life).toContain('cg_ending_basketball_life.png');
    expect(ENDING_CG_URL_MAP.lychee_heir).toContain('cg_ending_lychee_heir.png');
    expect(ENDING_CG_URL_MAP.goose_heir).toContain('cg_ending_goose_heir.png');
    expect(ENDING_CG_URL_MAP.tech_star).toContain('cg_ending_tech_star.png');
    expect(ENDING_CG_URL_MAP.college_freshman).toContain('cg_ending_college_freshman.png');
    expect(ENDING_CG_URL_MAP.intro_dongguan).toContain('cg_ending_intro_dongguan.png');
  });

  it('展示结局时渲染对应 CG 背景图', () => {
    endingCG.show('basketball_life');

    const background = container.querySelector('[data-ending-background]');
    expect(background).not.toBeNull();
    expect(background.src).toContain('cg_ending_basketball_life.png');
    expect(background.getAttribute('aria-hidden')).toBe('true');
  });

  it('六个 endingId 都有独立的安全区配置', () => {
    const endingIds = ENDINGS.map((ending) => ending.id);

    expect(Object.keys(ENDING_CG_DISPLAY_CONFIG).sort()).toEqual([...endingIds].sort());
    for (const endingId of endingIds) {
      const display = getEndingCGDisplayConfig(endingId);
      expect(['left', 'right']).toContain(display.panelSide);
      expect(display.objectPosition).toBe('center center');
    }
  });

  it('每个结局都渲染正确图片，完整保留 16:9 画面并只提供返回主菜单按钮', () => {
    for (const ending of ENDINGS) {
      endingCG.show(ending.id);

      const root = container.querySelector('[data-ending-cg]');
      const background = root.querySelector('[data-ending-background]');
      const image = root.querySelector(`[data-ending-cg-image="${ending.id}"]`);
      const copy = root.querySelector('[data-ending-copy]');
      const actions = root.querySelector('[data-ending-actions]');

      expect(root.getAttribute('data-ending-cg')).toBe(ending.id);
      expect(background.src).toContain(ENDING_CG_URL_MAP[ending.id].split('/').pop());
      expect(image.src).toContain(ENDING_CG_URL_MAP[ending.id].split('/').pop());
      expect(image.style.objectFit).toBe('contain');
      expect(root.style.overflow).toBe('hidden');
      expect(copy.style.overflowY).toBe('auto');
      expect(actions.style.flex).toContain('0 0 auto');
      const menuButton = actions.querySelector(`[data-ending-menu="${ending.id}"]`);
      expect(menuButton).not.toBeNull();
      expect(menuButton.textContent).toBe('返回主菜单');
      expect(menuButton.getAttribute('data-ending-action')).toBe('menu');
      expect(actions.querySelector('[data-ending-retry]')).toBeNull();
      expect(actions.querySelectorAll('button')).toHaveLength(1);
      expect(copy.contains(menuButton)).toBe(false);
    }
  });

  it('重复显示时只保留一个结局覆盖层，避免重试按钮重叠', () => {
    endingCG.show('basketball_life');
    endingCG.show('intro_dongguan');

    expect(container.querySelectorAll('[data-ending-cg]')).toHaveLength(1);
    expect(container.querySelector('[data-ending-cg]').getAttribute('data-ending-cg'))
      .toBe('intro_dongguan');
  });

  it('所有六个结局点击返回主菜单都触发退出回调', () => {
    const onExit = vi.fn();
    endingCG.onExit = onExit;

    for (const ending of ENDINGS) {
      endingCG.show(ending.id);
      const button = container.querySelector(`[data-ending-menu="${ending.id}"]`);
      button.click();
    }

    expect(onExit).toHaveBeenCalledTimes(6);
  });

});
