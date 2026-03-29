/**
 * Git commit co-author trailer helpers.
 *
 * These helpers are intentionally conservative:
 * - only rewrite `git commit ... -m "..."` / `-m '...'`
 * - leave other commit styles untouched when we cannot safely transform them
 * - never inject a duplicate Alice trailer
 */

export type ShellFlavor = 'bash' | 'powershell';

export const ALICE_COAUTHOR_TRAILER =
  'Co-authored-by: AliceIntelligence[bot] <AliceIntelligence[bot]@users.noreply.github.com>';

function escapeForBashAnsiCString(message: string): string {
  return `$'${message
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n')}'`;
}

function escapeForPowerShellDoubleQuotes(message: string): string {
  return `"${message
    .replace(/`/g, '``')
    .replace(/"/g, '`"')
    .replace(/\r?\n/g, '`n')}"`;
}

function encodeCommitMessage(message: string, shellFlavor: ShellFlavor): string {
  if (shellFlavor === 'powershell') {
    return escapeForPowerShellDoubleQuotes(message);
  }
  return escapeForBashAnsiCString(message);
}

function appendTrailer(message: string): string {
  if (/Co-authored-by:\s*AliceIntelligence\[bot\]/i.test(message)) {
    return message;
  }
  const trimmed = message.replace(/\s+$/g, '');
  return `${trimmed}\n\n${ALICE_COAUTHOR_TRAILER}`;
}

/**
 * Inject Alice's co-author trailer into `git commit -m ...` commands when safe.
 *
 * This handles the most common agent-generated pattern:
 * `git commit -m "message"` or `git commit -m 'message'`.
 *
 * For other commit flows (`-F`, editor-based commits, `--no-edit`) we keep the
 * original command unchanged rather than risk breaking the command line.
 */
export function injectAliceCoAuthorTrailer(
  command: string,
  shellFlavor: ShellFlavor,
  enabled = true,
): string {
  if (!enabled) {
    return command;
  }

  if (!/\bgit\s+commit\b/i.test(command)) {
    return command;
  }

  if (/Co-authored-by:\s*AliceIntelligence\[bot\]/i.test(command)) {
    return command;
  }

  let updated = command;

  updated = updated.replace(
    /(git\s+commit\b[^\n;&|]*?\s-m\s*)"((?:[^"\\]|\\.)*)"/gi,
    (_match, prefix: string, message: string) => {
      const nextMessage = appendTrailer(message);
      return `${prefix}${encodeCommitMessage(nextMessage, shellFlavor)}`;
    },
  );

  updated = updated.replace(
    /(git\s+commit\b[^\n;&|]*?\s-m\s*)'([^']*)'/gi,
    (_match, prefix: string, message: string) => {
      const nextMessage = appendTrailer(message);
      return `${prefix}${encodeCommitMessage(nextMessage, shellFlavor)}`;
    },
  );

  return updated;
}
