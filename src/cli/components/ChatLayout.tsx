/**
 * 主 TUI 布局：Header + 聊天区 + 确认/问答浮层 + 输入框 + 状态栏
 * 仅负责组合与展示，业务状态与回调由 App 传入
 */

import React from 'react';
import { Box, Static } from 'ink';
import { Header } from './Header.js';
import { ChatArea } from './ChatArea.js';
import { InputBox } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { DangerousCommandConfirm } from './DangerousCommandConfirm.js';
import { QuestionPrompt } from './QuestionPrompt.js';
import type { Message } from '../../types/index.js';
import type { ToolCallRecord } from '../../types/tool.js';
import type { StatusInfo } from '../../core/statusManager.js';

export interface ConfirmDialogState {
  message: string;
  command: string;
  onConfirm: (confirmed: boolean) => void;
}

export interface QuestionDialogState {
  question: string;
  choices: string[];
  allowFreeform: boolean;
  onAnswer: (answer: string) => void;
}

export interface ChatLayoutProps {
  workspace: string;
  modelLabel: string;
  messages: Message[];
  isProcessing: boolean;
  streamingContent: string;
  confirmDialog: ConfirmDialogState | null;
  questionDialog: QuestionDialogState | null;
  statusInfo: StatusInfo;
  latestToolRecord: ToolCallRecord | undefined;
  statusBarEnabled?: boolean;
  onSubmit: (input: string) => void | Promise<void>;
  onHistoryUp: () => string | undefined;
  onHistoryDown: () => string | undefined;
}

export const ChatLayout: React.FC<ChatLayoutProps> = ({
  workspace,
  modelLabel,
  messages,
  isProcessing,
  streamingContent,
  confirmDialog,
  questionDialog,
  statusInfo,
  latestToolRecord,
  statusBarEnabled = true,
  onSubmit,
  onHistoryUp,
  onHistoryDown,
}) => {
  const inputDisabled = isProcessing || !!confirmDialog || !!questionDialog;

  return (
    <Box flexDirection="column" height="100%">
      <Static items={['header']}>
        {() => <Header key="header" workspace={workspace} model={modelLabel} />}
      </Static>

      <ChatArea
        messages={messages}
        isProcessing={isProcessing}
        streamingContent={streamingContent}
      />

      {confirmDialog && (
        <DangerousCommandConfirm
          message={confirmDialog.message}
          command={confirmDialog.command}
          onConfirm={confirmDialog.onConfirm}
        />
      )}

      {questionDialog && (
        <Box marginLeft={2} marginRight={2}>
          <QuestionPrompt
            question={questionDialog.question}
            choices={questionDialog.choices}
            allowFreeform={questionDialog.allowFreeform}
            onAnswer={questionDialog.onAnswer}
          />
        </Box>
      )}

      <InputBox
        onSubmit={onSubmit}
        disabled={inputDisabled}
        onHistoryUp={onHistoryUp}
        onHistoryDown={onHistoryDown}
      />

      <StatusBar
        model={modelLabel}
        connectionStatus={statusInfo.connectionStatus}
        tokenUsage={statusInfo.tokenUsage}
        responseTime={statusInfo.responseTime}
        sessionId={statusInfo.sessionId}
        enabled={statusBarEnabled}
        latestToolRecord={latestToolRecord ?? null}
      />
    </Box>
  );
};
