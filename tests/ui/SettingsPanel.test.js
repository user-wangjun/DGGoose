import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT, SETTINGS_DEFAULTS } from '../../src/config.js';
import { SettingsPanel } from '../../src/ui/SettingsPanel.js';

function createEventBusMock() {
  const listeners = new Map();
  return {
    on: vi.fn((event, handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    }),
    off: vi.fn((event, handler) => listeners.get(event)?.delete(handler)),
    emit: vi.fn((event, data) => {
      for (const handler of [...(listeners.get(event) || [])]) handler(data);
    }),
  };
}

function createSettingsMock(eventBus, overrides = {}) {
  const values = { ...SETTINGS_DEFAULTS, ...overrides };
  return {
    get: vi.fn((key) => values[key] ?? null),
    getAll: vi.fn(() => ({ ...values })),
    set: vi.fn((key, value) => {
      values[key] = value;
      eventBus.emit(EVENT.SETTING_CHANGE, { key, value });
    }),
    reset: vi.fn(() => {
      Object.assign(values, SETTINGS_DEFAULTS);
      for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
        eventBus.emit(EVENT.SETTING_CHANGE, { key, value });
      }
    }),
    flush: vi.fn(),
    values,
  };
}

function inputEvent(target) {
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SettingsPanel 正式设置面板', () => {
  let container;
  let eventBus;
  let settingsService;
  let audioManager;
  let panel;

  beforeEach(() => {
    vi.useRealTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    eventBus = createEventBusMock();
    settingsService = createSettingsMock(eventBus);
    audioManager = {
      setBgmVolume: vi.fn(),
      setSfxVolume: vi.fn(),
    };
    panel = new SettingsPanel({ settingsService, audioManager, eventBus, container });
  });

  afterEach(() => {
    panel?.destroy();
    if (container?.parentNode) container.parentNode.removeChild(container);
    vi.useRealTimers();
    delete navigator.vibrate;
  });

  it('create 后存在正式面板根节点和 dialog 语义', () => {
    const root = panel.create();

    expect(root).toBe(container.querySelector('[data-settings-panel]'));
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(root.getAttribute('aria-labelledby')).toBe(root.querySelector('h2').id);
    expect(root.querySelector('[data-settings-title]').textContent).toBe('设置');
    expect(root.querySelector('[data-settings-overlay]')).toBeNull();
    expect(container.querySelector('[data-settings-overlay]')).not.toBeNull();
  });

  it('创建三个滑杆，保留原有 data 属性、范围和值显示', () => {
    panel.create();

    for (const [key, min, max] of [
      ['bgm', '0', '100'],
      ['sfx', '0', '100'],
      ['textSpeed', '1', '60'],
    ]) {
      const slider = container.querySelector(`[data-${key}-slider]`);
      expect(slider).not.toBeNull();
      expect(slider.min).toBe(min);
      expect(slider.max).toBe(max);
      expect(container.querySelector(`[data-${key}-value]`).textContent).toBe(slider.value);
    }
  });

  it('创建三个语言 radio，并同步当前语言', () => {
    settingsService = createSettingsMock(eventBus, { lang: 'en' });
    panel = new SettingsPanel({ settingsService, audioManager, eventBus, container });
    panel.create();

    const radios = [...container.querySelectorAll('[data-lang-radio]')];
    expect(radios.map((radio) => radio.value)).toEqual(['zh-CN', 'zh-TW', 'en']);
    expect(radios.find((radio) => radio.checked).value).toBe('en');
    expect(radios.every((radio) => radio.closest('[data-lang-option]'))).toBe(true);
  });

  it('创建震动开关并同步当前值；不支持 Vibration API 时显示提示', () => {
    panel.create();

    const toggle = container.querySelector('[data-shake-toggle]');
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(true);
    expect(container.querySelector('[data-vibration-hint]').textContent).toContain('不支持');
    expect(toggle.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('show 时从 SettingsService 同步全部控件和滑杆填充比例', () => {
    panel.create();
    settingsService.values.bgm = 12;
    settingsService.values.sfx = 88;
    settingsService.values.textSpeed = 6;
    settingsService.values.lang = 'zh-TW';
    settingsService.values.shake = false;

    panel.show();

    expect(container.querySelector('[data-bgm-slider]').value).toBe('12');
    expect(container.querySelector('[data-sfx-slider]').value).toBe('88');
    expect(container.querySelector('[data-textSpeed-slider]').value).toBe('6');
    expect(container.querySelector('[data-bgm-slider]').style.getPropertyValue('--settings-percent')).toBe('12%');
    expect(container.querySelector('[data-sfx-slider]').style.getPropertyValue('--settings-percent')).toBe('88%');
    expect(container.querySelector('[data-textSpeed-slider]').style.getPropertyValue('--settings-percent')).toBe('8.47457627118644%');
    expect(container.querySelector('[data-lang-radio][value="zh-TW"]').checked).toBe(true);
    expect(container.querySelector('[data-shake-toggle]').checked).toBe(false);
  });

  it('拖动 BGM 滑杆更新数值、调用 set 并保留音频联动路径', () => {
    panel.create();
    const slider = container.querySelector('[data-bgm-slider]');
    slider.value = '42';
    inputEvent(slider);

    expect(container.querySelector('[data-bgm-value]').textContent).toBe('42');
    expect(slider.style.getPropertyValue('--settings-percent')).toBe('42%');
    expect(settingsService.set).toHaveBeenCalledWith('bgm', 42);
    expect(audioManager.setBgmVolume).toHaveBeenCalledWith(42);
    expect(eventBus.emit).toHaveBeenCalledWith(EVENT.SETTING_CHANGE, { key: 'bgm', value: 42 });
  });

  it('兼容缺少 eventBus 的 SettingsService 装配，并保留 set 的事件广播路径', () => {
    const service = {
      eventBus: null,
      get: vi.fn((key) => SETTINGS_DEFAULTS[key]),
      getAll: vi.fn(() => ({ ...SETTINGS_DEFAULTS })),
      set(key, value) {
        this.eventBus.emit(EVENT.SETTING_CHANGE, { key, value });
      },
      reset: vi.fn(),
      flush: vi.fn(),
    };
    panel = new SettingsPanel({ settingsService: service, audioManager, eventBus, container });
    panel.create();
    const slider = container.querySelector('[data-bgm-slider]');
    slider.value = '41';
    inputEvent(slider);

    expect(service.eventBus).toBe(eventBus);
    expect(eventBus.emit).toHaveBeenCalledWith(EVENT.SETTING_CHANGE, { key: 'bgm', value: 41 });
  });

  it('拖动 SFX 和文字速度滑杆行为正确', () => {
    panel.create();

    const sfx = container.querySelector('[data-sfx-slider]');
    sfx.value = '23';
    inputEvent(sfx);
    const textSpeed = container.querySelector('[data-textSpeed-slider]');
    textSpeed.value = '55';
    inputEvent(textSpeed);

    expect(settingsService.set).toHaveBeenCalledWith('sfx', 23);
    expect(settingsService.set).toHaveBeenCalledWith('textSpeed', 55);
    expect(audioManager.setSfxVolume).toHaveBeenCalledWith(23);
    expect(container.querySelector('[data-sfx-value]').textContent).toBe('23');
    expect(container.querySelector('[data-textSpeed-value]').textContent).toBe('55');
  });

  it('语言切换调用 settingsService.set 并更新选中视觉状态', () => {
    panel.create();
    const radio = container.querySelector('[data-lang-radio][value="zh-TW"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));

    expect(settingsService.set).toHaveBeenCalledWith('lang', 'zh-TW');
    expect(radio.closest('[data-lang-option]').dataset.selected).toBe('true');
    expect(container.querySelector('[data-lang-radio][value="zh-CN"]').checked).toBe(false);
  });

  it('震动开关保存状态；支持 Vibration API 时仅在开启时触发短反馈', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    panel.create();
    const toggle = container.querySelector('[data-shake-toggle]');

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settingsService.set).toHaveBeenCalledWith('shake', false);
    expect(vibrate).not.toHaveBeenCalled();

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settingsService.set).toHaveBeenCalledWith('shake', true);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(50);
  });

  it('第一次点击重置按钮只进入确认状态，第二次才调用 reset', () => {
    panel.create();
    const reset = container.querySelector('[data-reset-btn]');

    reset.click();
    expect(reset.textContent).toBe('确认重置？');
    expect(reset.dataset.confirming).toBe('true');
    expect(settingsService.reset).not.toHaveBeenCalled();

    reset.click();
    expect(settingsService.reset).toHaveBeenCalledTimes(1);
    expect(reset.textContent).toBe('重置设置');
  });

  it('fake timers 验证 3 秒后自动取消重置确认状态', () => {
    vi.useFakeTimers();
    panel.create();
    const reset = container.querySelector('[data-reset-btn]');
    reset.click();

    vi.advanceTimersByTime(2999);
    expect(reset.dataset.confirming).toBe('true');
    vi.advanceTimersByTime(1);
    expect(reset.dataset.confirming).toBeUndefined();
    expect(reset.textContent).toBe('重置设置');
    expect(settingsService.reset).not.toHaveBeenCalled();
  });

  it('重置后所有控件、数值和填充比例重新同步默认设置', () => {
    settingsService = createSettingsMock(eventBus, { bgm: 2, sfx: 4, textSpeed: 59, lang: 'en', shake: false });
    panel = new SettingsPanel({ settingsService, audioManager, eventBus, container });
    panel.create();
    const reset = container.querySelector('[data-reset-btn]');
    reset.click();
    reset.click();

    expect(settingsService.reset).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-bgm-slider]').value).toBe(String(SETTINGS_DEFAULTS.bgm));
    expect(container.querySelector('[data-bgm-value]').textContent).toBe(String(SETTINGS_DEFAULTS.bgm));
    expect(container.querySelector('[data-bgm-slider]').style.getPropertyValue('--settings-percent')).toBe('70%');
    expect(container.querySelector('[data-sfx-slider]').value).toBe(String(SETTINGS_DEFAULTS.sfx));
    expect(container.querySelector('[data-textSpeed-slider]').value).toBe(String(SETTINGS_DEFAULTS.textSpeed));
    expect(container.querySelector('[data-lang-radio][value="zh-CN"]').checked).toBe(true);
    expect(container.querySelector('[data-shake-toggle]').checked).toBe(true);
  });

  it('关闭按钮和遮罩关闭都调用 flush；遮罩关闭后可以再次打开', () => {
    panel.create();
    panel.show();
    container.querySelector('[data-close-btn]').click();
    expect(settingsService.flush).toHaveBeenCalledTimes(1);
    expect(panel.element.style.display).toBe('none');

    panel.show();
    const overlay = container.querySelector('[data-settings-overlay]');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(settingsService.flush).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-settings-overlay]')).toBeNull();

    panel.show();
    expect(container.querySelector('[data-settings-overlay]')).not.toBeNull();
    expect(container.querySelector('[data-settings-panel]').style.display).toBe('block');
  });

  it('destroy 后移除事件订阅、清理 DOM 和重置计时器', () => {
    vi.useFakeTimers();
    panel.create();
    container.querySelector('[data-reset-btn]').click();
    expect(eventBus.on).toHaveBeenCalledWith(EVENT.SETTING_CHANGE, expect.any(Function));

    panel.destroy();

    expect(eventBus.off).toHaveBeenCalledWith(EVENT.SETTING_CHANGE, expect.any(Function));
    expect(container.querySelector('[data-settings-panel]')).toBeNull();
    expect(container.querySelector('[data-settings-overlay]')).toBeNull();
    vi.advanceTimersByTime(3000);
    expect(settingsService.reset).not.toHaveBeenCalled();
  });

  it('正式样式包含 844×390 横屏所需的最大高度、滚动、安全区和减弱动效契约', () => {
    panel.create();
    const css = document.getElementById('goose-escape-settings-panel-style').textContent;

    expect(css).toContain('max-height: calc(100dvh');
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('safe-area-inset-top');
    expect(css).toContain('safe-area-inset-right');
    expect(css).toContain('safe-area-inset-bottom');
    expect(css).toContain('safe-area-inset-left');
    expect(css).toContain('@media (orientation: landscape) and (max-height: 500px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('overflow-x: hidden');
  });

  it('关键控件保持键盘可操作性和 label 关联', () => {
    panel.create();
    const root = container.querySelector('[data-settings-panel]');

    for (const slider of root.querySelectorAll('[data-settings-slider]')) {
      expect(slider.tabIndex).toBeGreaterThanOrEqual(0);
      expect(root.querySelector(`label[for="${slider.id}"]`)).not.toBeNull();
    }
    for (const radio of root.querySelectorAll('[data-lang-radio]')) {
      expect(radio.tabIndex).toBeGreaterThanOrEqual(0);
      expect(radio.closest('label')).not.toBeNull();
    }
    const toggle = root.querySelector('[data-shake-toggle]');
    expect(toggle.tabIndex).toBeGreaterThanOrEqual(0);
    expect(root.querySelector(`label[for="${toggle.id}"]`)).not.toBeNull();
    expect(root.querySelector('[data-reset-btn]').type).toBe('button');
    expect(root.querySelector('[data-close-btn]').type).toBe('button');
  });

  it('不改变设置字段、默认值和既有服务接口', () => {
    panel.create();
    expect(Object.keys(settingsService.values)).toEqual(Object.keys(SETTINGS_DEFAULTS));
    expect(settingsService).toEqual(expect.objectContaining({
      get: expect.any(Function),
      getAll: expect.any(Function),
      set: expect.any(Function),
      reset: expect.any(Function),
      flush: expect.any(Function),
    }));
    expect(rootFieldNames(container)).toEqual([
      'bgm', 'sfx', 'textSpeed', 'lang', 'shake',
    ]);
  });
});

function rootFieldNames(container) {
  return [
    container.querySelector('[data-bgm-slider]')?.dataset.bgmSlider !== undefined ? 'bgm' : null,
    container.querySelector('[data-sfx-slider]')?.dataset.sfxSlider !== undefined ? 'sfx' : null,
    container.querySelector('[data-textSpeed-slider]')?.dataset.textspeedSlider !== undefined ? 'textSpeed' : null,
    container.querySelector('[data-lang-radio]') ? 'lang' : null,
    container.querySelector('[data-shake-toggle]') ? 'shake' : null,
  ].filter(Boolean);
}
