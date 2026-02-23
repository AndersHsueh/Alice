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
import { SystemNotice } from './SystemNotice.js';
import type { SystemNoticeData } from './SystemNotice.js';
import { SlashMenu } from './SlashMenu.js';
import type { SlashCommand } from './SlashMenu.js';
import { InlinePicker } from './InlinePicker.js';
import type { PickerItem } from './InlinePicker.js';
import type { Message } from '../../types/index.js';
import type { ToolCallRecord } from '../../types/tool.js';
import type { StatusInfo } from '../../core/statusManager.js';
import type { PickRequest } from '../../core/commandRegistry.js';

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
  systemNotice?: SystemNoticeData | null;
  // slash menu
  slashQuery?: string | null;
  allCommands?: SlashCommand[];
  onSlashSelect?: (name: string) => void;
  onSlashCancel?: () => void;
  // generic picker (model / session)
  pickRequest?: PickRequest | null;
  onPickSelect?: (kind: string, id: string) => void;
  onPickCancel?: () => void;
  // session summaries（/sessions 用）
  sessionSummaries?: Array<{ id: string; caption: string | null; updatedAt: string; messageCount: number }>;
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
  systemNotice = null,
  slashQuery = null,
  allCommands = [],
  onSlashSelect,
  onSlashCancel,
  pickRequest = null,
  onPickSelect,
  onPickCancel,
  sessionSummaries = [],
  onSubmit,
  onHistoryUp,
  onHistoryDown,
}) => {
  const inputDisabled = isProcessing || !!confirmDialog || !!questionDialog;

  // 构建 session picker items
  const sessionItems: PickerItem[] = sessionSummaries.map(s => {
    const d = new Date(s.updatedAt);
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateStr = `${monthNames[d.getMonth()]}-${String(d.getDate()).padStart(2,'0')}`;
    return {
      id: s.id,
      label: s.caption ?? s.id.slice(0, 8),
      hint: `${dateStr}  ${s.messageCount} msgs`,
    };
  });

  // model picker items（从 pickRequest 取）
  const modelItems: PickerItem[] =
    pickRequest?.kind === 'model'
      ? pickRequest.items.map(i => ({ id: i.id, label: i.label, hint: i.hint }))
      : [];

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Header workspace={workspace} model={modelLabel} />

      {/* 聊天区 */}
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        <ChatArea
          messages={messages}
          isProcessing={isProcessing}
          streamingContent={streamingContent}
        />
      </Box>

      {/* 危险命令确认 */}
      {confirmDialog && (
        <Box paddingX={2} paddingY={1}>
          <DangerousCommandConfirm
            message={confirmDialog.message}
            command={confirmDialog.command}
            onConfirm={confirmDialog.onConfirm}
          />
        </Box>
      )}

      {/* 问答提示 */}
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

      {/* 生成状态 */}
      <GeneratingStatus phase={generatingPhase} />

      {/* Slash 命令菜单 */}
      {slashQuery !== null && (
        <SlashMenu
          query={slashQuery}
          commands={allCommands}
          onSelect={(cmd) => onSlashSelect?.(cmd.name)}
          onCancel={() => onSlashCancel?.()}
        />
      )}

      {/* Model picker */}
      {pickRequest?.kind === 'model' && (
        <InlinePicker
          items={modelItems}
          title={pickRequest.title}
          onSelect={(item) => onPickSelect?.('model', item.id)}
          onCancel={() => onPickCancel?.()}
        />
      )}

      {/* Session picker */}
      {pickRequest?.kind === 'session' && (
        <InlinePicker
          items={sessionItems}
          title="Resume session"
          onSelect={(item) => onPickSelect?.('session', item.id)}
          onCancel={() => onPickCancel?.()}
          maxVisible={10}
        />
      )}

      {/* 系统通知 */}
      {!slashQuery && !pickRequest && <SystemNotice notice={systemNotice} />}

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
