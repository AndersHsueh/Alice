/**
 * 退出汇报全屏
 */

import React from 'react';
import { Box } from 'ink';
import { ExitReport } from './ExitReport.js';
import type { SessionStats } from '../../core/statsTracker.js';

export interface ExitReportScreenProps {
  sessionId: string;
  stats: SessionStats;
}

export const ExitReportScreen: React.FC<ExitReportScreenProps> = ({ sessionId, stats }) => (
  <Box flexDirection="column">
    <ExitReport sessionId={sessionId} stats={stats} />
  </Box>
);
