import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsService } from '../../src/core/SettingsService.js';
import { StorageService } from '../../src/core/StorageService.js';
import { EventBus } from '../../src/core/EventBus.js';
import { SETTINGS_DEFAULTS, EVENT } from '../../src/config.js';

/**
 * SettingsService 设置系统单元测试
 * 覆盖：默认值、单字段设置、批量设置、持久化、节流写入、范围校验、重置、事件通知、副本隔离
 */
describe('SettingsService 设置系统', () => {
  let storage;
  let eventBus;

  beforeEach(() => {
    // 每个测试前清空 localStorage，保证隔离
    localStorage.clear();
    storage = new StorageService();
    eventBus = new EventBus();
  });

  afterEach(() => {
    // 确保每个测试后恢复真实计时器，避免泄漏
    vi.useRealTimers();
  });

  // ---------- 默认值 ----------
  it('未存储时返回 SETTINGS_DEFAULTS', () => {
    const settings = new SettingsService({ storage, eventBus });

    expect(settings.get('bgm')).toBe(SETTINGS_DEFAULTS.bgm);
    expect(settings.get('sfx')).toBe(SETTINGS_DEFAULTS.sfx);
    expect(settings.get('textSpeed')).toBe(SETTINGS_DEFAULTS.textSpeed);
    expect(settings.get('lang')).toBe(SETTINGS_DEFAULTS.lang);
    expect(settings.get('shake')).toBe(SETTINGS_DEFAULTS.shake);
  });

  // ---------- 设置单个字段 ----------
  it('set 单个字段后 get 返回新值', () => {
    const settings = new SettingsService({ storage, eventBus });

    settings.set('bgm', 50);

    expect(settings.get('bgm')).toBe(50);
  });

  // ---------- 批量设置 ----------
  it('setAll 批量设置多个字段', () => {
    const settings = new SettingsService({ storage, eventBus });

    settings.setAll({ bgm: 30, sfx: 80, lang: 'en' });

    expect(settings.get('bgm')).toBe(30);
    expect(settings.get('sfx')).toBe(80);
    expect(settings.get('lang')).toBe('en');
    // 未设置的字段保持默认
    expect(settings.get('textSpeed')).toBe(SETTINGS_DEFAULTS.textSpeed);
  });

  // ---------- 持久化读取 ----------
  it('写入后重新创建实例能读取到持久化数据', () => {
    const settings1 = new SettingsService({ storage, eventBus });
    settings1.set('bgm', 42);
    settings1.flush();

    // 重新创建实例，模拟游戏重启
    const settings2 = new SettingsService({ storage, eventBus });

    expect(settings2.get('bgm')).toBe(42);
  });

  // ---------- 节流写入 ----------
  it('快速多次 set 只触发一次持久化写入', () => {
    vi.useFakeTimers();
    const settings = new SettingsService({ storage, eventBus });
    const setSpy = vi.spyOn(storage, 'set');

    settings.set('bgm', 10);
    settings.set('bgm', 20);
    settings.set('bgm', 30);

    // 节流窗口内不应写入存储
    expect(setSpy).not.toHaveBeenCalled();

    // 150ms 后触发一次延迟写入
    vi.advanceTimersByTime(150);

    expect(setSpy).toHaveBeenCalledTimes(1);
    // 写入的应是最后一次的值
    const stored = storage.get('settings');
    expect(stored.bgm).toBe(30);
  });

  // ---------- 范围校验 ----------
  it('bgm 超过 100 截断为 100', () => {
    const settings = new SettingsService({ storage, eventBus });

    settings.set('bgm', 150);

    expect(settings.get('bgm')).toBe(100);
  });

  it('bgm 小于 0 截断为 0', () => {
    const settings = new SettingsService({ storage, eventBus });

    settings.set('bgm', -10);

    expect(settings.get('bgm')).toBe(0);
  });

  it('textSpeed 小于 1 截断为 1', () => {
    const settings = new SettingsService({ storage, eventBus });

    settings.set('textSpeed', 0);

    expect(settings.get('textSpeed')).toBe(1);
  });

  it('textSpeed 超过 60 截断为 60', () => {
    const settings = new SettingsService({ storage, eventBus });

    settings.set('textSpeed', 100);

    expect(settings.get('textSpeed')).toBe(60);
  });

  it('lang 设置非法值时保持默认', () => {
    const settings = new SettingsService({ storage, eventBus });

    settings.set('lang', 'fr-FR');

    expect(settings.get('lang')).toBe(SETTINGS_DEFAULTS.lang);
  });

  it('lang 设置合法值 zh-TW 正常生效', () => {
    const settings = new SettingsService({ storage, eventBus });

    settings.set('lang', 'zh-TW');

    expect(settings.get('lang')).toBe('zh-TW');
  });

  it('shake 设置非布尔值时转为布尔', () => {
    const settings = new SettingsService({ storage, eventBus });

    settings.set('shake', 0);
    expect(settings.get('shake')).toBe(false);

    settings.set('shake', 1);
    expect(settings.get('shake')).toBe(true);
  });

  // ---------- 重置设置 ----------
  it('reset 后恢复默认值', () => {
    const settings = new SettingsService({ storage, eventBus });
    settings.setAll({ bgm: 10, sfx: 20, textSpeed: 5, lang: 'en', shake: false });

    settings.reset();

    expect(settings.getAll()).toEqual(SETTINGS_DEFAULTS);
  });

  it('reset 后持久化数据也被清除', () => {
    vi.useFakeTimers();
    const settings = new SettingsService({ storage, eventBus });
    settings.setAll({ bgm: 10, sfx: 20 });
    settings.flush();

    settings.reset();
    settings.flush();

    // 重新创建实例验证持久化
    const settings2 = new SettingsService({ storage, eventBus });
    expect(settings2.getAll()).toEqual(SETTINGS_DEFAULTS);
  });

  // ---------- 事件通知 ----------
  it('set 时触发 SETTING_CHANGE 事件，携带 key 和 value', () => {
    const settings = new SettingsService({ storage, eventBus });
    const handler = vi.fn();
    eventBus.on(EVENT.SETTING_CHANGE, handler);

    settings.set('bgm', 50);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ key: 'bgm', value: 50 });
  });

  it('setAll 时为每个变更字段触发 SETTING_CHANGE 事件', () => {
    const settings = new SettingsService({ storage, eventBus });
    const handler = vi.fn();
    eventBus.on(EVENT.SETTING_CHANGE, handler);

    settings.setAll({ bgm: 30, sfx: 80 });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('reset 时为每个字段触发 SETTING_CHANGE 事件', () => {
    const settings = new SettingsService({ storage, eventBus });
    // 先改成非默认值
    settings.setAll({ bgm: 10, sfx: 20, textSpeed: 5, lang: 'en', shake: false });

    const handler = vi.fn();
    eventBus.on(EVENT.SETTING_CHANGE, handler);

    settings.reset();

    // 5 个字段全部恢复默认，应触发 5 次
    expect(handler).toHaveBeenCalledTimes(5);
  });

  // ---------- getAll 返回副本 ----------
  it('getAll 返回全部设置副本，修改不影响内部状态', () => {
    const settings = new SettingsService({ storage, eventBus });

    const all = settings.getAll();
    all.bgm = 999;

    expect(settings.get('bgm')).toBe(SETTINGS_DEFAULTS.bgm);
  });

  // ---------- flush 强制立即持久化 ----------
  it('flush 在节流未执行时立即写入存储', () => {
    vi.useFakeTimers();
    const settings = new SettingsService({ storage, eventBus });
    const setSpy = vi.spyOn(storage, 'set');

    settings.set('bgm', 60);
    // 节流窗口内尚未写入
    expect(setSpy).not.toHaveBeenCalled();

    settings.flush();

    expect(setSpy).toHaveBeenCalledTimes(1);

    // flush 后不应再触发延迟写入
    vi.advanceTimersByTime(200);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  // ---------- 未知 key 安全处理 ----------
  it('get 未知 key 返回 null', () => {
    const settings = new SettingsService({ storage, eventBus });

    expect(settings.get('unknownKey')).toBeNull();
  });

  it('set 未知 key 不影响现有设置', () => {
    const settings = new SettingsService({ storage, eventBus });

    settings.set('unknownKey', 123);

    expect(settings.get('unknownKey')).toBeNull();
    expect(settings.getAll()).toEqual(SETTINGS_DEFAULTS);
  });
});
