/**
 * ALICE 组件化 UI — 统一导出
 */

// 类型
export type {
  AliceComponentProps,
  FocusableProps,
  SelectListItem,
  LoaderStyle,
  ImageProtocol,
} from './types.js';

// 新增通用组件
export { Markdown } from './Markdown.js';
export type { MarkdownProps } from './Markdown.js';

export { SelectList } from './SelectList.js';
export type { SelectListProps } from './SelectList.js';

export { Loader } from './Loader.js';
export type { LoaderProps } from './Loader.js';

export { Editor } from './Editor.js';
export type { EditorProps } from './Editor.js';

export { Image } from './Image.js';
export type { ImageProps } from './Image.js';

// 已有组件
export { Overlay, useOverlay } from './Overlay.js';
export type { OverlayProps, OverlayOptions, OverlayAnchor } from './Overlay.js';

export { StreamingMessage, StaticMessage } from './StreamingMessage.js';
export type { StreamingMessageProps } from './StreamingMessage.js';

export { StreamingIndicator } from './StreamingIndicator.js';
export type { StreamingIndicatorProps } from './StreamingIndicator.js';
