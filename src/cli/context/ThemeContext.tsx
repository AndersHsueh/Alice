/**
 * Theme Context for React
 * 提供主题给所有组件使用
 */

import React, { createContext, useContext } from 'react';
import type { Theme } from '../theme.js';

interface ThemeContextType {
  theme: Theme;
  updateTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export interface ThemeProviderProps {
  theme: Theme;
  children: React.ReactNode;
  onThemeChange?: (theme: Theme) => void;
}

/**
 * Theme Provider 组件
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  theme,
  children,
  onThemeChange,
}) => {
  const [currentTheme, setCurrentTheme] = React.useState(theme);

  const updateTheme = (newTheme: Theme) => {
    setCurrentTheme(newTheme);
    onThemeChange?.(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme: currentTheme, updateTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * Hook 来使用 Theme
 */
export const useTheme = (): Theme => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context.theme;
};

/**
 * Hook 来更新 Theme
 */
export const useThemeUpdate = (): ((theme: Theme) => void) => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeUpdate must be used within ThemeProvider');
  }
  return context.updateTheme;
};
