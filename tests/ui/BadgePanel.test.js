import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadgePanel } from '../../src/ui/BadgePanel.js';
import { BadgeSystem } from '../../src/core/BadgeSystem.js';
import { EventBus } from '../../src/core/EventBus.js';
import { StorageService } from '../../src/core/StorageService.js';

describe('东莞印记正式资源面板', () => {
  let container;
  let panel;
  let badgeSystem;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    badgeSystem = new BadgeSystem({ storage: new StorageService(), eventBus: new EventBus() });
    panel = new BadgePanel({ container, badgeSystem, eventBus: new EventBus() });
    panel.create();
  });

  afterEach(() => {
    panel.destroy();
    container.remove();
  });

  it('未获得印记显示正式灰态图，获得后切换为彩色图', () => {
    let image = container.querySelector('[data-badge-card-image="factory_cert"]');
    expect(image.src).toContain('badge_factory_gray.png');

    badgeSystem.unlock('factory_cert');
    panel.render();
    image = container.querySelector('[data-badge-card-image="factory_cert"]');
    expect(image.src).toContain('badge_factory_color.png');
  });
});
