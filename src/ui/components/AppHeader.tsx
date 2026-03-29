/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Box } from 'ink';
import { Header } from './Header.js';
import { Tips } from './Tips.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { DaemonClient } from '../../utils/daemonClient.js';

interface AppHeaderProps {
  version: string;
}

/** Map raw channel key to display label. */
function channelLabel(raw: string): string {
  const map: Record<string, string> = {
    feishu: 'Feishu',
    dingtalk: 'DingTalk',
    wechat: 'WeChat',
  };
  return map[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

export const AppHeader = ({ version }: AppHeaderProps) => {
  const settings = useSettings();
  const config = useConfig();
  const uiState = useUIState();

  const [activeChannel, setActiveChannel] = useState<string | undefined>(undefined);

  useEffect(() => {
    const client = new DaemonClient();
    client.getStatus()
      .then((status) => {
        if (status?.defaultChannel) {
          setActiveChannel(channelLabel(status.defaultChannel));
        }
      })
      .catch(() => {});
  }, []);

  const model = uiState.currentModel;
  const agentMode = uiState.agentMode;
  const targetDir = config.getTargetDir();
  const showBanner = !config.getScreenReader();
  const showTips = !(settings.merged.ui?.hideTips || config.getScreenReader());

  return (
    <Box flexDirection="column">
      {showBanner && (
        <Header
          version={version}
          agentMode={agentMode}
          activeChannel={activeChannel}
          model={model}
          workingDirectory={targetDir}
        />
      )}
      {showTips && <Tips />}
    </Box>
  );
};
