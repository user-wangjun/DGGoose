import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageService } from '../../src/core/StorageService.js';

describe('StorageService 本地存储', () => {
  let storage;

  beforeEach(() => {
    // 使用真实的 localStorage（jsdom 环境提供），每个测试前清空
    localStorage.clear();
    storage = new StorageService();
  });

  it('set/get 读写一致', () => {
    storage.set('save1', { chapter: 2, badges: ['a'] });

    const result = storage.get('save1');
    expect(result).toEqual({ chapter: 2, badges: ['a'] });
  });

  it('get 不存在的 key 返回默认值', () => {
    expect(storage.get('missing')).toBeNull();
    expect(storage.get('missing', { fallback: true })).toEqual({ fallback: true });
  });

  it('key 自动加 gxe: 前缀', () => {
    storage.set('settings', { bgm: 70 });
    expect(localStorage.getItem('gxe:settings')).toBeTruthy();
  });

  it('损坏 JSON 返回默认值', () => {
    localStorage.setItem('gxe:broken', '{invalid json');

    expect(storage.get('broken')).toBeNull();
    expect(storage.get('broken', 'default')).toBe('default');
  });

  it('remove 删除数据', () => {
    storage.set('temp', { x: 1 });
    storage.remove('temp');

    expect(storage.get('temp')).toBeNull();
  });

  it('写入超过 8KB 容量限制时抛错', () => {
    // 构造 >8KB 的数据
    const bigData = { data: 'x'.repeat(9000) };

    expect(() => storage.set('big', bigData, 8192)).toThrow();
    // 超限后应回滚，原值不被破坏
    expect(storage.get('big')).toBeNull();
  });

  it('默认 8KB 限制下正常大小的存档可写入', () => {
    const saveData = {
      version: 1,
      chapter: 'ch2',
      checkpoint: 'start',
      badges: ['basketball'],
      settings: { bgm: 70, sfx: 55 },
      timestamp: 1723000000000,
    };

    storage.set('save1', saveData);
    expect(storage.get('save1')).toEqual(saveData);
  });

  it('set 后立即 get 值一致（含中文）', () => {
    const data = { name: '莞小鹅', chapter: '荔枝园', desc: '岭南风物' };

    storage.set('cn', data);
    expect(storage.get('cn')).toEqual(data);
  });
});
