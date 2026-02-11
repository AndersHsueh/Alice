/**
 * 键绑定管理系统
 * 支持可配置的快捷键绑定
 */

/**
 * 键盘操作枚举
 */
export enum KeyAction {
  // 编辑器操作
  Submit = 'submit',              // 提交输入
  NewLine = 'newline',            // 插入换行（未来支持多行）
  HistoryUp = 'history_up',       // 历史记录向上
  HistoryDown = 'history_down',   // 历史记录向下
  DeleteChar = 'delete_char',     // 删除字符
  
  // 应用级操作
  Quit = 'quit',                  // 退出应用
  Abort = 'abort',                // 中止当前操作
  
  // 确认对话框
  Confirm = 'confirm',            // 确认（y）
  Cancel = 'cancel',              // 取消（n）
}

/**
 * 键绑定配置接口
 */
export interface KeyBinding {
  action: KeyAction;
  key: string;                    // 键名: 'enter', 'escape', 'up', 'down', etc.
  ctrl?: boolean;                 // Ctrl修饰键
  shift?: boolean;                // Shift修饰键
  meta?: boolean;                 // Meta/Cmd修饰键
  alt?: boolean;                  // Alt修饰键
}

/**
 * 默认键绑定配置
 */
export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // 编辑器
  { action: KeyAction.Submit, key: 'return' },
  { action: KeyAction.NewLine, key: 'return', shift: true },
  { action: KeyAction.HistoryUp, key: 'upArrow' },
  { action: KeyAction.HistoryDown, key: 'downArrow' },
  { action: KeyAction.DeleteChar, key: 'backspace' },
  { action: KeyAction.DeleteChar, key: 'delete' },
  
  // 应用级
  { action: KeyAction.Quit, key: 'c', ctrl: true },
  { action: KeyAction.Abort, key: 'escape' },
  
  // 确认对话框
  { action: KeyAction.Confirm, key: 'y' },
  { action: KeyAction.Confirm, key: 'Y' },
  { action: KeyAction.Cancel, key: 'n' },
  { action: KeyAction.Cancel, key: 'N' },
  { action: KeyAction.Cancel, key: 'escape' },
];

/**
 * Ink useInput 的 Key 对象接口
 */
interface InkKey {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  alt?: boolean;
  backspace?: boolean;
  delete?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  tab?: boolean;
}

/**
 * 键绑定管理器
 */
export class KeybindingManager {
  private bindings: KeyBinding[];

  constructor(customBindings: KeyBinding[] = []) {
    // 合并自定义绑定和默认绑定（自定义优先）
    this.bindings = [...customBindings, ...DEFAULT_KEYBINDINGS];
  }

  /**
   * 匹配键盘输入到操作
   * @param input - 输入的字符
   * @param key - Ink 的 key 对象
   * @returns 匹配的操作，如果没有匹配则返回 null
   */
  match(input: string, key: InkKey): KeyAction | null {
    for (const binding of this.bindings) {
      if (this.isMatch(binding, input, key)) {
        return binding.action;
      }
    }
    return null;
  }

  /**
   * 检查单个绑定是否匹配
   */
  private isMatch(binding: KeyBinding, input: string, key: InkKey): boolean {
    // 检查修饰键
    if (binding.ctrl && !key.ctrl) return false;
    if (binding.shift && !key.shift) return false;
    if (binding.meta && !key.meta) return false;
    if (binding.alt && !key.alt) return false;

    // 检查键名（特殊键）
    if (binding.key === 'return' && key.return) return true;
    if (binding.key === 'escape' && key.escape) return true;
    if (binding.key === 'upArrow' && key.upArrow) return true;
    if (binding.key === 'downArrow' && key.downArrow) return true;
    if (binding.key === 'leftArrow' && key.leftArrow) return true;
    if (binding.key === 'rightArrow' && key.rightArrow) return true;
    if (binding.key === 'backspace' && key.backspace) return true;
    if (binding.key === 'delete' && key.delete) return true;
    if (binding.key === 'tab' && key.tab) return true;
    if (binding.key === 'pageUp' && key.pageUp) return true;
    if (binding.key === 'pageDown' && key.pageDown) return true;

    // 检查普通字符（input）
    // 只有当没有修饰键或只有shift时才匹配字符
    if (binding.key === input && !binding.ctrl && !binding.meta && !binding.alt) {
      return true;
    }

    return false;
  }

  /**
   * 获取操作的键绑定描述（用于帮助文本）
   */
  getBindingDescription(action: KeyAction): string {
    const matches = this.bindings.filter(b => b.action === action);
    if (matches.length === 0) return '';

    return matches.map(b => {
      const parts: string[] = [];
      if (b.ctrl) parts.push('Ctrl');
      if (b.shift) parts.push('Shift');
      if (b.meta) parts.push('Cmd');
      if (b.alt) parts.push('Alt');
      
      // 特殊键名映射
      const keyMap: Record<string, string> = {
        return: 'Enter',
        escape: 'Esc',
        upArrow: '↑',
        downArrow: '↓',
        leftArrow: '←',
        rightArrow: '→',
        backspace: 'Backspace',
        delete: 'Del',
        tab: 'Tab',
      };
      
      parts.push(keyMap[b.key] || b.key.toUpperCase());
      return parts.join('+');
    }).join(' / ');
  }

  /**
   * 获取所有绑定
   */
  getAllBindings(): KeyBinding[] {
    return [...this.bindings];
  }
}

/**
 * 从配置对象解析键绑定
 */
export function parseKeybindings(config: Record<string, string | string[]>): KeyBinding[] {
  const bindings: KeyBinding[] = [];

  for (const [actionStr, keyStr] of Object.entries(config)) {
    const action = actionStr as KeyAction;
    const keys = Array.isArray(keyStr) ? keyStr : [keyStr];

    for (const key of keys) {
      const binding = parseKeybinding(action, key);
      if (binding) {
        bindings.push(binding);
      }
    }
  }

  return bindings;
}

/**
 * 解析单个键绑定字符串
 * 例如: "ctrl+c", "shift+enter", "escape"
 */
function parseKeybinding(action: KeyAction, keyStr: string): KeyBinding | null {
  const parts = keyStr.toLowerCase().split('+');
  const binding: KeyBinding = { action, key: '' };

  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') {
      binding.ctrl = true;
    } else if (part === 'shift') {
      binding.shift = true;
    } else if (part === 'meta' || part === 'cmd') {
      binding.meta = true;
    } else if (part === 'alt' || part === 'option') {
      binding.alt = true;
    } else if (part === 'enter') {
      binding.key = 'return';
    } else if (part === 'esc') {
      binding.key = 'escape';
    } else if (part === 'up') {
      binding.key = 'upArrow';
    } else if (part === 'down') {
      binding.key = 'downArrow';
    } else if (part === 'left') {
      binding.key = 'leftArrow';
    } else if (part === 'right') {
      binding.key = 'rightArrow';
    } else {
      binding.key = part;
    }
  }

  return binding.key ? binding : null;
}
