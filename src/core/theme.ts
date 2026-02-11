/**
 * 主题系统
 * 支持可自定义的颜色主题和热重载
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { watch } from 'fs';
import { configManager } from '../utils/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 主题配色接口
 */
export interface ThemeColor {
  primary: string;      // 主色（通常是青色）
  secondary: string;    // 辅助色（灰色）
  accent: string;       // 强调色（绿色、红色等）
  error: string;        // 错误色
  warning: string;      // 警告色
  success: string;      // 成功色
  info: string;         // 信息色
  dim: string;          // 暗色（用于 dimColor）
}

/**
 * 完整主题接口
 */
export interface Theme extends ThemeColor {
  name: string;
  components?: {
    header?: {
      foreground?: string;
      background?: string;
    };
    inputBox?: {
      prompt?: string;
      cursor?: string;
      border?: string;
    };
    statusBar?: {
      foreground?: string;
      background?: string;
    };
    chatArea?: {
      userMessage?: string;
      aiMessage?: string;
      timestamp?: string;
    };
  };
}

/**
 * 默认主题：科技蓝
 */
const THEME_TECH_BLUE: Theme = {
  name: 'tech-blue',
  primary: 'cyan',      // #00D9FF
  secondary: 'gray',
  accent: 'green',
  error: 'red',
  warning: 'yellow',
  success: 'green',
  info: 'cyan',
  dim: 'gray',
};

/**
 * 默认主题：深海蓝
 */
const THEME_OCEAN_DARK: Theme = {
  name: 'ocean-dark',
  primary: 'blue',
  secondary: 'gray',
  accent: 'cyan',
  error: 'red',
  warning: 'yellow',
  success: 'green',
  info: 'cyan',
  dim: 'gray',
};

/**
 * 所有内置主题
 */
const BUILTIN_THEMES: Record<string, Theme> = {
  'tech-blue': THEME_TECH_BLUE,
  'ocean-dark': THEME_OCEAN_DARK,
};

/**
 * 主题管理器
 */
export class ThemeManager {
  private currentTheme: Theme = THEME_TECH_BLUE;
  private themesDir: string;
  private watchers: Map<string, ReturnType<typeof watch>> = new Map();

  constructor() {
    this.themesDir = path.join(configManager.getConfigDir(), 'themes');
  }

  async init(): Promise<void> {
    // 创建主题目录
    await fs.mkdir(this.themesDir, { recursive: true });

    // 加载配置中指定的主题
    const config = configManager.get();
    const themeName = config.ui?.theme || 'tech-blue';
    
    await this.loadTheme(themeName);
  }

  /**
   * 加载主题（先查自定义，再查内置）
   */
  async loadTheme(themeName: string): Promise<void> {
    // 先查自定义主题文件
    const customThemePath = path.join(this.themesDir, `${themeName}.json`);
    try {
      const content = await fs.readFile(customThemePath, 'utf-8');
      this.currentTheme = JSON.parse(content);
      return;
    } catch {
      // 自定义主题不存在，继续查内置主题
    }

    // 查内置主题
    if (BUILTIN_THEMES[themeName]) {
      this.currentTheme = BUILTIN_THEMES[themeName];
    } else {
      // 主题不存在，回退到默认
      this.currentTheme = THEME_TECH_BLUE;
    }
  }

  /**
   * 获取当前主题
   */
  getTheme(): Theme {
    return { ...this.currentTheme };
  }

  /**
   * 获取主题颜色
   */
  getColor(key: keyof ThemeColor): string {
    return this.currentTheme[key];
  }

  /**
   * 获取组件级样式
   */
  getComponentStyle(component: string = 'header'): any {
    return this.currentTheme.components?.[component as keyof Theme['components']] || {};
  }

  /**
   * 获取所有可用主题（内置 + 自定义）
   */
  async getAvailableThemes(): Promise<string[]> {
    const builtinNames = Object.keys(BUILTIN_THEMES);
    
    try {
      const files = await fs.readdir(this.themesDir);
      const customNames = files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
      
      return [...builtinNames, ...customNames];
    } catch {
      return builtinNames;
    }
  }

  /**
   * 启用主题文件热重载
   * @param callback 主题变化时的回调
   */
  watchThemeFile(themeName: string, callback: (theme: Theme) => void): void {
    const customThemePath = path.join(this.themesDir, `${themeName}.json`);
    
    // 移除旧的 watcher
    const oldWatcher = this.watchers.get(themeName);
    if (oldWatcher) {
      oldWatcher.close();
    }

    // 如果是内置主题，不需要 watch
    if (BUILTIN_THEMES[themeName]) {
      return;
    }

    // 只 watch 自定义主题文件
    try {
      const watcher = watch(customThemePath, { encoding: 'utf-8' }, async (eventType: string) => {
        if (eventType === 'change') {
          try {
            const content = await fs.readFile(customThemePath, 'utf-8');
            const theme = JSON.parse(content);
            this.currentTheme = theme;
            callback(theme);
          } catch (error) {
            console.error('Failed to reload theme:', error);
          }
        }
      });
      
      this.watchers.set(themeName, watcher);
    } catch {
      // 文件不存在，跳过 watch
    }
  }

  /**
   * 停止监听主题文件
   */
  unwatchThemeFile(themeName: string): void {
    const watcher = this.watchers.get(themeName);
    if (watcher) {
      watcher.close();
      this.watchers.delete(themeName);
    }
  }

  /**
   * 保存自定义主题
   */
  async saveCustomTheme(themeName: string, theme: Partial<Theme>): Promise<void> {
    const filePath = path.join(this.themesDir, `${themeName}.json`);
    const fullTheme: Theme = {
      ...this.currentTheme,
      ...theme,
      name: themeName,
    };
    await fs.writeFile(filePath, JSON.stringify(fullTheme, null, 2), 'utf-8');
  }

  /**
   * 获取主题描述
   */
  getThemeDescription(themeName: string): string {
    const descriptions: Record<string, string> = {
      'tech-blue': '科技蓝风格（推荐）- 青色为主，现代简洁',
      'ocean-dark': '深海蓝风格 - 深蓝色背景，更柔和',
    };
    return descriptions[themeName] || '自定义主题';
  }
}

export const themeManager = new ThemeManager();
