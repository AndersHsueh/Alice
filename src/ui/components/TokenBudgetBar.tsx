/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TokenBudgetBar — TUI 状态栏上的 token 预算用量指示(IK8MWR #12)
 *
 * 设计:
 *  - 数据源:UIState.tokenBudget(BudgetUsage | null),由 useAliceStream 写入
 *  - 渲染:`[ctx NN%]` 文本;接近耗尽时追加 ⚠exh,收益递减时 ⚠dim
 *  - 未启用预算或 total=0 时返回 null(保持 Footer 干净)
 */

import type React from 'react';
import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import type { BudgetUsage } from '../../runtime/agent/tokenBudget.js';

export const TokenBudgetBar: React.FC<{ usage: BudgetUsage | null | undefined }> = ({
  usage,
}) => {
  if (!usage || usage.total <= 0) {
    return null;
  }
  const pct = Math.round(usage.pct * 100);
  // diminishing 优先级最高(模型即将被强制停止)
  let suffix = '';
  let color = theme.text.secondary;
  if (usage.nearDiminishing) {
    suffix = ' ⚠dim';
    color = theme.status.error;
  } else if (usage.nearCompletion) {
    suffix = ' ⚠exh';
    color = theme.status.warning;
  }
  return (
    <Text color={color}>
      [ctx {pct}%]{suffix}
    </Text>
  );
};
