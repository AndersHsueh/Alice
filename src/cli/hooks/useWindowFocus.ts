/**
 * useWindowFocus
 * 监听 xterm focus tracking 事件（\033[I = 获焦，\033[O = 失焦）
 * 需要终端支持 focus reporting（Ghostty、xterm、iTerm2 等均支持）
 * 在 index.tsx 启动时写入 \x1b[?1004h 开启此模式
 */

import { useState, useEffect } from 'react';

export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (!process.stdin.isTTY) return;

    const handler = (data: Buffer) => {
      const str = data.toString();
      if (str === '\x1b[I') {
        setFocused(true);
      } else if (str === '\x1b[O') {
        setFocused(false);
      }
    };

    process.stdin.on('data', handler);
    return () => {
      process.stdin.off('data', handler);
    };
  }, []);

  return focused;
}
