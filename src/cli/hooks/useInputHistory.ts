/**
 * 输入框历史记录（上/下箭头）：状态与翻页逻辑
 */

import { useState, useCallback } from 'react';

export interface UseInputHistoryReturn {
  history: string[];
  historyIndex: number;
  setHistory: React.Dispatch<React.SetStateAction<string[]>>;
  setHistoryIndex: React.Dispatch<React.SetStateAction<number>>;
  handleHistoryUp: () => string | undefined;
  handleHistoryDown: () => string | undefined;
}

export function useInputHistory(): UseInputHistoryReturn {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const handleHistoryUp = useCallback((): string | undefined => {
    if (history.length === 0) return undefined;
    const nextIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
    setHistoryIndex(nextIndex);
    return history[history.length - 1 - nextIndex];
  }, [history, historyIndex]);

  const handleHistoryDown = useCallback((): string | undefined => {
    if (historyIndex <= 0) {
      setHistoryIndex(-1);
      return '';
    }
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    return history[history.length - 1 - newIndex];
  }, [history, historyIndex]);

  return {
    history,
    historyIndex,
    setHistory,
    setHistoryIndex,
    handleHistoryUp,
    handleHistoryDown,
  };
}
