import { useEffect, useState } from 'react';

export function useWindowFocus(): boolean {
  const [isFocused, setIsFocused] = useState(true);

  useEffect(() => {
    if (!process.stdout.isTTY) return;
    process.stdout.write('\x1b[?1004h');
    const handler = (data: Buffer) => {
      const s = data.toString();
      if (s === '\x1b[I') setIsFocused(true);
      else if (s === '\x1b[O') setIsFocused(false);
    };
    process.stdin.on('data', handler);
    return () => {
      process.stdout.write('\x1b[?1004l');
      process.stdin.off('data', handler);
    };
  }, []);

  return isFocused;
}
