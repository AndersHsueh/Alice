import React from 'react';
import { Box } from 'ink';
import { Header } from './Header.js';
import { ChatArea } from './ChatArea.js';
import { InputBox } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { DangerousCommandConfirm } from './DangerousCommandConfirm.js';
import { QuestionPrompt } from './QuestionPrompt.js';
import { GeneratingStatus } from './GeneratingStatus.js';
import type { GeneratingPhase } from './GeneratingStatus.js';
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
  generatingPhase?: GeneratingPhase;
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
  generatingPhase = { type: 'idle' } as GeneratingPhase,
  onSubmit,
  onHistoryUp,
  onHistoryDown,
}) => {
  const inputDisabled = isProcessing || !!confirmDialog || !!questionDialog;

  return (
    <Box flexDirection="column" height="100%">
      {/* Header：轻量一行 */}
      <Header workspace={workspace} model={modelLabel} />

      {/* 聊天区：占满剩余空间 */}
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        <ChatArea
          messages={messages}
          isProcessing={isProcessing}
          streamingContent={streamingContent}
        />
      </Box>

      {/* 浮层：危险命令确认 */}
      {confirmDialog && (
        <Box paddingX={2} paddingY={1}>
          <DangerousCommandConfirm
            message={confirmDialog.message}
            command={confirmDialog.command}
            onConfirm={confirmDialog.onConfirm}
          />
        </Box>
      )}

      {/* 浮层：问答提示 */}
      {questionDialog && (
        <Box paddingX={2}>
          <QuestionPrompt
            question={questionDialog.question}
            choices={questionDialog.choices}
            allowFreeform={questionDialog.allowFreeform}
            onAnswer={questionDialog.onAnswer}
          />
        </Box>
      )}

      {/* 生成状态指示器：Processing / Generating / Tool */}
      <GeneratingStatus phase={generatingPhase} />

      {/* 输入框 */}
      <InputBox
        onSubmit={onSubmit}
        disabled={inputDisabled}
        onHistoryUp={onHistoryUp}
        onHistoryDown={onHistoryDown}
      />

      {/* 状态栏 */}
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
