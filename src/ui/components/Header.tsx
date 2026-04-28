/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 * Updated by AndersHsueh — Alice-style Claude banner
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { shortenPath, tildeifyPath } from '@qwen-code/qwen-code-core';
import { theme } from '../semantic-colors.js';
import { getCachedStringWidth } from '../utils/textUtils.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

interface HeaderProps {
  customAsciiArt?: string; // unused in new layout, kept for compat
  version: string;
  agentMode: 'office' | 'coder';
  activeChannel?: string;
  model: string;
  workingDirectory: string;
  /** 是否处于模型降级状态（实际模型 ≠ 首选模型） */
  modelDegraded?: boolean;
  /** 当前实际使用的模型名称（由 model_selected 事件驱动） */
  activeModelName?: string;
}

import { robotArtLines } from './RobotArt.js';

// ── Alice blue theme ──────────────────────────────────────────────────────────
const ALICE_BLUE = '#00D9FF';
const DIM_COLOR = '#808080';

// ── Robot art (imported from RobotArt.ts) ─────────────────────────────────────
const ROBOT_LINES = robotArtLines;

/** Pad / truncate a string to exactly `width` visual columns. */
function fixedWidth(s: string, width: number): string {
  const w = getCachedStringWidth(s);
  if (w >= width) {
    // Truncate — rough but sufficient for banner content
    return s.slice(0, Math.max(0, width));
  }
  return s + ' '.repeat(width - w);
}

/** Center a string within `width` columns. */
function centerIn(s: string, width: number): string {
  const w = getCachedStringWidth(s);
  const pad = Math.max(0, width - w);
  const lpad = Math.floor(pad / 2);
  const rpad = pad - lpad;
  return ' '.repeat(lpad) + s + ' '.repeat(rpad);
}

// ── Row renderer ──────────────────────────────────────────────────────────────

interface RowProps {
  /** Content for the left column (without padding). */
  left?: string;
  /** Content for the right column (without padding). */
  right?: string;
  leftWidth: number;
  rightWidth: number;
  /** Render the left content centered. */
  centerLeft?: boolean;
  /** Whether this row is a divider row (─── separator inside columns). */
  isDivider?: boolean;
  /** Color for the left text. */
  leftColor?: string;
  /** Color for the right text. */
  rightColor?: string;
  /** If true, render the robot art line in blue. */
  isRobot?: boolean;
}

const Row: React.FC<RowProps> = ({
  left = '',
  right = '',
  leftWidth,
  rightWidth,
  centerLeft = false,
  isDivider = false,
  leftColor,
  rightColor,
  isRobot = false,
}) => {
  const lContent = centerLeft ? centerIn(left, leftWidth) : fixedWidth(left, leftWidth);
  const rContent = fixedWidth(right, rightWidth);

  if (isDivider) {
    // Inner divider line ─────────────────────
    const lLine = '─'.repeat(leftWidth + 2);  // +2 for the padding spaces
    const rLine = '─'.repeat(rightWidth + 2);
    return (
      <Box>
        <Text color={ALICE_BLUE}>{'│'}</Text>
        <Text color={ALICE_BLUE}>{lLine}</Text>
        <Text color={ALICE_BLUE}>{'┼'}</Text>
        <Text color={ALICE_BLUE}>{rLine}</Text>
        <Text color={ALICE_BLUE}>{'│'}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color={ALICE_BLUE}>{'│'}</Text>
      <Text color={ALICE_BLUE}>{' '}</Text>
      {isRobot ? (
        <Text color={ALICE_BLUE}>{lContent}</Text>
      ) : (
        <Text color={leftColor ?? theme.text.primary}>{lContent}</Text>
      )}
      <Text color={ALICE_BLUE}>{' │ '}</Text>
      <Text color={rightColor ?? DIM_COLOR}>{rContent}</Text>
      <Text color={ALICE_BLUE}>{' │'}</Text>
    </Box>
  );
};

// ── Main Header ───────────────────────────────────────────────────────────────

export const Header: React.FC<HeaderProps> = ({
  version,
  agentMode,
  activeChannel,
  model,
  workingDirectory,
  modelDegraded,
  activeModelName,
}) => {
  const { columns: terminalWidth } = useTerminalSize();

  // Total usable width (leave 1 col margin each side)
  const totalWidth = Math.max(60, Math.min(terminalWidth - 2, 120));

  // Title in top border: ╭─── Alice v0.5.6 ─── ... ╮
  const titleStr = ` Alice v${version} `;
  const titleVis = getCachedStringWidth(titleStr);
  const dashTotal = Math.max(0, totalWidth - 2 - 4 - titleVis); // 2 corners, 4 opening dashes
  const dashRight = '─'.repeat(dashTotal);
  const topBorder = `╭────${titleStr}${dashRight}╮`;
  const bottomBorder = `╰${'─'.repeat(totalWidth - 2)}╯`;

  // Column widths: 50/50 split, right col min 28
  const innerWidth = totalWidth - 2; // minus 2 border chars
  const leftColWidth = Math.floor(innerWidth * 0.50) - 3; // -3 for │ + 2 spaces
  const rightColWidth = innerWidth - leftColWidth - 5; // -5 for │ sp │ sp │

  // Left column content
  const modeLabel = agentMode === 'coder' ? 'Coder' : 'Office';

  // 模型显示名称：优先用 activeModelName（实时），fallback 到 model（来自 config）
  const displayModelName = activeModelName ?? model;

  // 模型来源图标 + 降级标记
  // ⚡ 本地模型 / ☁ 云端模型 / ↓ 降级状态
  const isLocal = displayModelName.includes('local') || displayModelName.includes('localhost') ||
    displayModelName.includes('lmstudio') || displayModelName.includes('ollama')
  const sourceIcon = isLocal ? ' [Local]' : ' [Cloud]'
  const degradedSuffix = modelDegraded ? ' ↓' : ' '
  const modelDisplayStr = `${displayModelName}${sourceIcon}${degradedSuffix}`

  const modelLine = activeChannel
    ? `${modelDisplayStr} · ${modeLabel} · ${activeChannel} `
    : `${modelDisplayStr} · ${modeLabel} `;
  const home = process.env.HOME ?? '';
  const tildeDir = home && workingDirectory.startsWith(home)
    ? '~' + workingDirectory.slice(home.length)
    : tildeifyPath(workingDirectory);
  const shortDir = shortenPath(tildeDir, leftColWidth);

  // Right column — tips
  const rightLines = [
    { text: 'Tips for getting started', accent: true },
    { text: '─'.repeat(Math.min(rightColWidth, 28)) },
    { text: 'Type / for command popup' },
    { text: 'Tab: autocomplete' },
    { text: 'Shift+Tab: approval mode' },
    { text: 'Ctrl+C: cancel / exit' },
  ];

  // Build left column rows (matched to right col length)
  const leftLines: Array<{ text: string; robot?: boolean; center?: boolean; color?: string }> = [
    { text: '' },
    { text: 'Welcome to ALICE!', center: true },
    { text: '' },
    { text: ROBOT_LINES[0], robot: true, center: true },
    { text: ROBOT_LINES[1], robot: true, center: true },
    { text: '' },
    // 降级状态用淡黄色提示（不用红色，红色暗示错误）
    { text: modelLine, center: true, color: modelDegraded ? '#B8A000' : undefined },
    { text: shortDir, center: true },
    { text: '' },
  ];

  // Align row count
  const rowCount = Math.max(leftLines.length, rightLines.length);
  while (leftLines.length < rowCount) leftLines.push({ text: '' });
  while (rightLines.length < rowCount) rightLines.push({ text: '' });

  return (
    <Box flexDirection="column" marginX={1}>
      {/* Top border */}
      <Text color={ALICE_BLUE}>{topBorder}</Text>

      {/* Content rows */}
      {Array.from({ length: rowCount }).map((_, i) => {
        const lEntry = leftLines[i] ?? { text: '' };
        const rEntry = rightLines[i] ?? { text: '' };
        const rText = typeof rEntry === 'string' ? rEntry : rEntry.text;
        const rAccent = typeof rEntry === 'object' && rEntry.accent;
        return (
          <Row
            key={i}
            left={lEntry.text}
            right={rText}
            leftWidth={leftColWidth}
            rightWidth={rightColWidth}
            centerLeft={lEntry.center}
            isRobot={lEntry.robot}
            leftColor={lEntry.robot ? ALICE_BLUE : (lEntry.color ?? theme.text.primary)}
            rightColor={rAccent ? ALICE_BLUE : DIM_COLOR}
          />
        );
      })}

      {/* Bottom border */}
      <Text color={ALICE_BLUE}>{bottomBorder}</Text>
    </Box>
  );
};
