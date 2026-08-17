import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EndingReviewPanel } from '../../src/ui/EndingReviewPanel.js';
import { BadgeSystem } from '../../src/core/BadgeSystem.js';
import { EventBus } from '../../src/core/EventBus.js';
import { StorageService } from '../../src/core/StorageService.js';
import { ENDINGS } from '../../src/data/endings.js';
import { ENDING_CG_URL_MAP } from '../../src/config.js';

describe('结尾回顾面板', () => {
  let container;
  let review;
  let badgeSystem;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    badgeSystem = new BadgeSystem({
      storage: new StorageService(),
      eventBus: new EventBus(),
    });
    review = new EndingReviewPanel({
      container,
      badgeSystem,
      storage: new StorageService(),
    });
  });

  afterEach(() => {
    review.destroy();
    container.remove();
  });

  it('未通关时隐藏结局 CG，通关对应结局后才显示该 CG', () => {
    review.show();

    const lockedCard = container.querySelector('[data-ending-card="basketball_life"]');
    expect(lockedCard.dataset.unlocked).toBe('false');
    expect(lockedCard.querySelector('[data-ending-card-image]')).toBeNull();

    badgeSystem.unlock('training_camp');
    review.render();

    const unlockedCard = container.querySelector('[data-ending-card="basketball_life"]');
    expect(unlockedCard.dataset.unlocked).toBe('true');
    expect(unlockedCard.querySelector('[data-ending-card-image]').src)
      .toContain('cg_ending_basketball_life.png');
  });

  it('只展示已获得的印记详情，未获得的印记保持占位', () => {
    badgeSystem.unlock('factory_cert');
    review.show();

    const unlockedBadge = container.querySelector('[data-review-badge-card="factory_cert"]');
    const lockedBadge = container.querySelector('[data-review-badge-card="basketball"]');

    expect(unlockedBadge.dataset.unlocked).toBe('true');
    expect(unlockedBadge.textContent).toContain('出厂合格证');
    expect(lockedBadge.dataset.unlocked).toBe('false');
    expect(lockedBadge.textContent).toContain('???');
  });

  it('输入错误密码不会解锁，输入 0423 会解锁全部结局与印记并持久化回顾状态', () => {
    review.show();
    const input = container.querySelector('[data-review-unlock-input]');
    const submitButton = container.querySelector('[data-review-unlock-submit]');
    const feedback = container.querySelector('[data-review-unlock-feedback]');

    input.value = '0000';
    submitButton.click();
    expect(feedback.textContent).toContain('密码不正确');
    expect(container.querySelector('[data-ending-card="basketball_life"]').dataset.unlocked)
      .toBe('false');

    input.value = '0423';
    submitButton.click();

    expect(feedback.textContent).toContain('全部结尾 CG 与印记已解锁');
    expect(container.querySelectorAll('[data-ending-card][data-unlocked="true"]'))
      .toHaveLength(ENDINGS.length);
    expect(container.querySelectorAll('[data-review-badge-card][data-unlocked="true"]'))
      .toHaveLength(12);
    expect(badgeSystem.getProgress().collected).toBe(0);
    expect(localStorage.getItem('gxe:ending_review_demo_unlocked')).toBe('true');
  });

  it('点击已解锁结局可以打开对应详情，锁定结局不能打开', () => {
    review.show();
    const lockedAction = container.querySelector('[data-ending-card-action="basketball_life"]');
    lockedAction.click();
    expect(container.querySelector('[data-ending-detail]')).toBeNull();

    badgeSystem.unlock('training_camp');
    review.render();
    container.querySelector('[data-ending-card-action="basketball_life"]').click();

    const detail = container.querySelector('[data-ending-detail]');
    expect(detail).not.toBeNull();
    expect(detail.querySelector('[data-ending-detail-image]').src)
      .toContain('cg_ending_basketball_life.png');
  });

  it('六个结局卡片和详情都保持正确映射与完整图像显示', () => {
    review.demoUnlocked = true;
    review.show();

    expect(review.element.style.padding).toContain('env(safe-area-inset');
    expect(container.querySelector('[data-ending-review-actions]')).not.toBeNull();

    for (const ending of ENDINGS) {
      const card = container.querySelector(`[data-ending-card="${ending.id}"]`);
      const image = card.querySelector(`[data-ending-card-image="${ending.id}"]`);
      const imageName = ENDING_CG_URL_MAP[ending.id].split('/').pop();

      expect(card.dataset.unlocked).toBe('true');
      expect(image.src).toContain(imageName);
      expect(image.style.objectFit).toBe('contain');

      card.querySelector(`[data-ending-card-action="${ending.id}"]`).click();
      const detail = container.querySelector(`[data-ending-detail="${ending.id}"]`);
      const detailImage = detail.querySelector(`[data-ending-detail-image="${ending.id}"]`);
      const detailActions = detail.querySelector('[data-ending-detail-actions]');

      expect(detailImage.src).toContain(imageName);
      expect(detailImage.style.objectFit).toBe('contain');
      expect(detail.querySelector('[data-ending-detail-background]')).not.toBeNull();
      expect(detail.querySelector('[data-ending-detail-copy]')).not.toBeNull();
      expect(detailActions.style.flexWrap).toBe('wrap');
      detail.querySelector('[data-ending-detail-close]').click();
      expect(container.querySelector('[data-ending-detail]')).toBeNull();
    }
  });

  it('关闭时触发 onClose，并清理 DOM', () => {
    const onClose = vi.fn();
    review.onClose = onClose;
    review.show();
    review.hide();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(review.element.style.display).toBe('none');

    review.destroy();
    expect(container.querySelector('[data-ending-review]')).toBeNull();
  });
});
