/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Header } from './Header.js';
import * as useTerminalSize from '../hooks/useTerminalSize.js';

vi.mock('../hooks/useTerminalSize.js');
const useTerminalSizeMock = vi.mocked(useTerminalSize.useTerminalSize);

const defaultProps = {
  version: '1.0.0',
  agentMode: 'office' as const,
  activeChannel: 'Feishu',
  model: 'qwen-coder-plus',
  workingDirectory: '/home/user/projects/test',
};

describe('<Header />', () => {
  beforeEach(() => {
    useTerminalSizeMock.mockReturnValue({ columns: 120, rows: 24 });
  });

  it('renders the ASCII logo on wide terminal', () => {
    const { lastFrame } = render(<Header {...defaultProps} />);
    expect(lastFrame()).toContain('██╔═══██╗');
  });

  it('hides the ASCII logo on narrow terminal', () => {
    useTerminalSizeMock.mockReturnValue({ columns: 60, rows: 24 });
    const { lastFrame } = render(<Header {...defaultProps} />);
    expect(lastFrame()).not.toContain('██╔═══██╗');
    expect(lastFrame()).toContain('>_ Qwen Code');
  });

  it('displays the version number', () => {
    const { lastFrame } = render(<Header {...defaultProps} />);
    expect(lastFrame()).toContain('v1.0.0');
  });

  it('displays mode and model', () => {
    const { lastFrame } = render(<Header {...defaultProps} />);
    expect(lastFrame()).toContain('Office');
    expect(lastFrame()).toContain('qwen-coder-plus');
  });

  it('displays coder mode', () => {
    const { lastFrame } = render(
      <Header {...defaultProps} agentMode="coder" />,
    );
    expect(lastFrame()).toContain('Coder');
  });

  it('displays active channel', () => {
    const { lastFrame } = render(<Header {...defaultProps} activeChannel="Feishu" />);
    expect(lastFrame()).toContain('Feishu');
  });

  it('omits channel when not provided', () => {
    const { lastFrame } = render(
      <Header {...defaultProps} activeChannel={undefined} />,
    );
    expect(lastFrame()).not.toContain('· undefined');
  });

  it('displays working directory', () => {
    const { lastFrame } = render(<Header {...defaultProps} />);
    expect(lastFrame()).toContain('/home/user/projects/test');
  });

  it('renders with border around info panel', () => {
    const { lastFrame } = render(<Header {...defaultProps} />);
    expect(lastFrame()).toContain('┌');
    expect(lastFrame()).toContain('┐');
  });
});
