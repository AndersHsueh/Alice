/**
 * ALICE 组件化 UI 架构 — 统一类型定义
 *
 * 所有通用 UI 组件都应遵循这些接口约定，
 * 以保证一致的可见性、禁用、聚焦行为。
 */

/**
 * 所有 ALICE UI 组件的通用 props
 */
export interface AliceComponentProps {
  /** 是否禁用（禁止交互） */
  disabled?: boolean;
  /** 是否可见（false 时不渲染） */
  visible?: boolean;
}

/**
 * 可聚焦组件（能接收键盘输入）
 */
export interface FocusableProps extends AliceComponentProps {
  /** 当前是否拥有焦点 */
  focused?: boolean;
  /** 焦点状态变化回调 */
  onFocusChange?: (focused: boolean) => void;
}

/**
 * SelectList 选项
 */
export interface SelectListItem {
  /** 选项唯一标识 */
  key: string;
  /** 显示文本 */
  label: string;
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * Loader 动画样式
 */
export type LoaderStyle = 'dots' | 'pulse' | 'bar' | 'spinner';

/**
 * Image 协议
 */
export type ImageProtocol = 'sixel' | 'kitty' | 'iterm2' | 'fallback';
