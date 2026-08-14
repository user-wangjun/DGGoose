/**
 * 判断当前页面是否应启用触摸摇杆。
 *
 * 桌面浏览器或自动化环境可能报告 maxTouchPoints，但如果主指针仍是精细鼠标，
 * 就不应把当前页面当成移动端；否则摇杆会误显示在电脑网页端。
 * @param {Object} [environment] - 可注入的浏览器能力对象，便于单元测试
 * @param {Navigator} [environment.navigator] - navigator 对象
 * @param {Window} [environment.window] - window 对象
 * @returns {boolean}
 */
export function isTouchDevice({ navigator: navigatorObject = globalThis.navigator, window: windowObject = globalThis.window } = {}) {
  const hasTouch = Number(navigatorObject?.maxTouchPoints) > 0
    || 'ontouchstart' in (windowObject || {});

  if (!hasTouch) return false;

  // 老旧浏览器没有 matchMedia 时保留原有触摸检测，避免误伤移动端兼容性。
  if (!windowObject || typeof windowObject.matchMedia !== 'function') return true;

  const coarsePointer = windowObject.matchMedia('(pointer: coarse)').matches;
  const finePointer = windowObject.matchMedia('(pointer: fine)').matches;

  // 主指针为 coarse 才视为移动端；两类查询都不支持时按触摸设备回退。
  return coarsePointer || !finePointer;
}
