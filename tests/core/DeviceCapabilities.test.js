import { describe, it, expect } from 'vitest';
import { isTouchDevice } from '../../src/core/DeviceCapabilities.js';

/**
 * 设备能力判断测试：桌面浏览器可能报告触摸点，但主指针仍然是鼠标。
 */
describe('DeviceCapabilities 输入设备判断', () => {
  const createEnvironment = ({ maxTouchPoints, coarse, fine }) => ({
    navigator: { maxTouchPoints },
    window: {
      matchMedia: (query) => ({
        matches: query === '(pointer: coarse)' ? coarse : fine,
      }),
    },
  });

  it('桌面浏览器误报触摸点但主指针为 fine → 不显示摇杆', () => {
    const environment = createEnvironment({
      maxTouchPoints: 10,
      coarse: false,
      fine: true,
    });

    expect(isTouchDevice(environment)).toBe(false);
  });

  it('手机/平板报告触摸点且主指针为 coarse → 显示摇杆', () => {
    const environment = createEnvironment({
      maxTouchPoints: 5,
      coarse: true,
      fine: false,
    });

    expect(isTouchDevice(environment)).toBe(true);
  });

  it('仅通过 ontouchstart 检测到触摸且浏览器没有 matchMedia → 保持兼容回退', () => {
    const environment = {
      navigator: { maxTouchPoints: 0 },
      window: { ontouchstart: null },
    };

    expect(isTouchDevice(environment)).toBe(true);
  });

  it('没有触摸能力 → 不显示摇杆', () => {
    const environment = createEnvironment({
      maxTouchPoints: 0,
      coarse: true,
      fine: false,
    });

    expect(isTouchDevice(environment)).toBe(false);
  });
});
