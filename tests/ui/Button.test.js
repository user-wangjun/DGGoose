import { describe, expect, it, beforeEach } from 'vitest';
import { Button } from '../../src/ui/Button.js';
import { applyButtonStyle, BUTTON_THEME_STYLE_ID } from '../../src/ui/ButtonTheme.js';

describe('统一按钮系统', () => {
  beforeEach(() => {
    document.head.querySelector(`#${BUTTON_THEME_STYLE_ID}`)?.remove();
  });

  it('通用 Button 使用统一主题属性并只注入一份样式', () => {
    const first = new Button({ label: '开始', variant: 'primary' });
    const second = new Button({ label: '返回', variant: 'secondary', size: 'sm' });

    const firstElement = first.create();
    const secondElement = second.create();

    expect(firstElement.dataset.uiButton).toBe('');
    expect(firstElement.dataset.variant).toBe('primary');
    expect(firstElement.dataset.size).toBe('md');
    expect(secondElement.dataset.variant).toBe('secondary');
    expect(secondElement.dataset.size).toBe('sm');
    expect(document.head.querySelectorAll(`#${BUTTON_THEME_STYLE_ID}`)).toHaveLength(1);
  });

  it('按钮状态通过 data-state 表达，支持按下、释放和禁用', () => {
    const button = new Button({ label: '继续', onClick: () => {} });
    const element = button.create();

    expect(element.dataset.state).toBe('idle');
    element.dispatchEvent(new Event('pointerdown'));
    expect(element.dataset.state).toBe('pressed');
    element.dispatchEvent(new Event('pointerup'));
    expect(element.dataset.state).toBe('idle');

    button.setDisabled(true);
    expect(element.disabled).toBe(true);
    expect(element.dataset.state).toBe('disabled');
  });

  it('独立创建的按钮也能复用统一主题', () => {
    const element = document.createElement('button');
    applyButtonStyle(element, { variant: 'danger', size: 'sm', width: 'full' });

    expect(element.dataset.uiButton).toBe('');
    expect(element.dataset.variant).toBe('danger');
    expect(element.dataset.size).toBe('sm');
    expect(element.dataset.width).toBe('full');
    expect(element.type).toBe('button');
  });
});
