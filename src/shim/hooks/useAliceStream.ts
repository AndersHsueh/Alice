/**
 * useAliceStream - Replaces useGeminiStream for Alice's daemon-based backend.
 *
 * This hook connects the qwen-code TUI to Alice's DaemonClient instead of
 * Gemini's API. The daemon handles all tool execution server-side.
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import type {
  ThoughtSummary,
  Config,
} from '../qwen-code-core.js';
import {
  StreamingState,
  MessageType,
  ToolCallStatus,
  type HistoryItem,
  type HistoryItemWithoutId,
  type HistoryItemToolGroup,
  type IndividualToolCallDisplay,
} from '../../ui/types.js';
import type { UseHistoryManagerReturn } from '../../ui/hooks/useHistoryManager.js';
import { DaemonClient } from '../../utils/daemonClient.js';
import type { ChatStreamEvent } from '../../types/chatStream.js';
import type { ToolCallRecord } from '../../types/tool.js';
import type { SlashCommandProcessorResult } from '../../ui/types.js';
import { formatToolResult } from '../../runtime/tools/toolResultFormatter.js';

// ─── Tool call tracking ───────────────────────────────────────────────────────

interface TrackedToolCall {
  callId: string;
  toolName: string;
  status: ToolCallStatus;
  args?: Record<string, unknown>;
  resultDisplay?: string;
}

function isSlashCommandQuery(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith('//') || trimmed.startsWith('/*')) {
    return false;
  }
  return trimmed.startsWith('/') || trimmed.startsWith('?');
}

// ─── Main hook ────────────────────────────────────────────────────────────────

export const useAliceStream = (
  _geminiClient: any, // unused - kept for signature compat
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  config: Config,
  _settings: any,
  _onDebugMessage: (msg: string) => void,
  _handleSlashCommand: (cmd: any) => Promise<any>,
  _shellModeActive: boolean,
  _getPreferredEditor: () => any,
  _onAuthError: (err: string) => void,
  _performMemoryRefresh: () => Promise<void>,
  _modelSwitchedFromQuotaError: boolean,
  _setModelSwitchedFromQuotaError: (v: boolean) => void,
  _onEditorClose: () => void,
  _onCancelSubmit: () => void,
  _setShellInputFocused: (v: boolean) => void,
  _terminalWidth: number,
  _terminalHeight: number,
) => {
  // ── State ──────────────────────────────────────────────────────────────────
  const [streamingState, setStreamingState] = useState<StreamingState>(StreamingState.Idle);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [initError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState('');
  const [toolCalls, setToolCalls] = useState<TrackedToolCall[]>([]);
  const [userMessages, setUserMessages] = useState<string[]>([]);
  /** 是否处于模型降级状态（实际模型 ≠ 首选模型） */
  const [modelDegraded, setModelDegraded] = useState(false);
  /** 当前实际使用的模型名称（由 model_selected 事件更新） */
  const [activeModelName, setActiveModelName] = useState<string | undefined>(undefined);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const daemonClientRef = useRef<DaemonClient>(new DaemonClient());
  const lastPromptRef = useRef<string>('');
  const pendingTextRef = useRef('');
  const pendingItemIdRef = useRef<number | null>(null);
  const toolGroupIdRef = useRef<number | null>(null);

  // ── Cancel ────────────────────────────────────────────────────────────────
  const cancelOngoingRequest = useCallback(() => {
    if (streamingState === StreamingState.Responding) {
      abortControllerRef.current?.abort();
    }
  }, [streamingState]);

  // ── Submit query ──────────────────────────────────────────────────────────
  const submitQuery = useCallback(async (text: string | any) => {
    const prompt = typeof text === 'string' ? text : String(text);
    if (!prompt.trim()) return;

    if (streamingState === StreamingState.Responding) return;

    if (isSlashCommandQuery(prompt)) {
      const slashResult = await _handleSlashCommand(
        prompt.trim(),
      ) as SlashCommandProcessorResult | false;

      if (slashResult) {
        if (slashResult.type === 'submit_prompt') {
          await submitQuery(
            typeof slashResult.content === 'string'
              ? slashResult.content
              : String(slashResult.content),
          );
        }
        return;
      }
    }

    lastPromptRef.current = prompt;
    setUserMessages(prev => [...prev, prompt]);

    // Add user message to history
    const timestamp = Date.now();
    addItem({ type: 'user', text: prompt } as Omit<HistoryItem, 'id'>, timestamp);

    // Reset pending state
    setPendingText('');
    pendingTextRef.current = '';
    pendingItemIdRef.current = null;
    toolGroupIdRef.current = null;
    setToolCalls([]);
    setThought(null);

    setStreamingState(StreamingState.Responding);

    const ac = new AbortController();
    abortControllerRef.current = ac;

    try {
      const model = config.getModel?.() || undefined;
      const workspace = config.getWorkingDir?.() || process.cwd();

      const stream = daemonClientRef.current.chatStream({
        sessionId: sessionIdRef.current,
        message: prompt,
        model,
        workspace,
      });

      for await (const event of stream) {
        if (ac.signal.aborted) break;
        await handleStreamEvent(event, timestamp, addItem);
      }
    } catch (err: any) {
      if (!ac.signal.aborted) {
        const errMsg = err?.message || String(err);
        addItem({ type: 'error', text: `Error: ${errMsg}` } as Omit<HistoryItem, 'id'>, Date.now());
      }
    } finally {
      setStreamingState(StreamingState.Idle);
    }
  }, [streamingState, config, addItem, _handleSlashCommand]);

  // ── Stream event handler ──────────────────────────────────────────────────
  const handleStreamEvent = useCallback(async (
    event: ChatStreamEvent,
    _baseTimestamp: number,
    addItemFn: UseHistoryManagerReturn['addItem'],
  ) => {
    if (event.type === 'text') {
      const newText = pendingTextRef.current + event.content;
      pendingTextRef.current = newText;
      setPendingText(newText);
    } else if (event.type === 'tool_call') {
      handleToolCallEvent(event.record, addItemFn);
    } else if (event.type === 'done') {
      // Finalize text
      const finalText = pendingTextRef.current;
      if (finalText) {
        addItemFn(
          { type: 'gemini', text: finalText } as Omit<HistoryItem, 'id'>,
          Date.now(),
        );
        pendingTextRef.current = '';
        setPendingText('');
      }
      if (event.sessionId) {
        sessionIdRef.current = event.sessionId;
      }
    } else if (event.type === 'model_selected') {
      setModelDegraded(event.degraded);
      setActiveModelName(event.modelName);
    }
  }, []);

  // ── Tool call event handling ──────────────────────────────────────────────
  const handleToolCallEvent = useCallback((
    record: ToolCallRecord,
    addItemFn: UseHistoryManagerReturn['addItem'],
  ) => {
    const callId = record.id || `tool-${Date.now()}`;
    const status = record.status === 'success'
      ? ToolCallStatus.Success
      : record.status === 'error'
        ? ToolCallStatus.Error
        : record.status === 'running'
          ? ToolCallStatus.Executing
          : ToolCallStatus.Pending;

    const toolDisplay: IndividualToolCallDisplay = {
      callId,
      name: record.toolName,
      description: `${record.toolName}(${JSON.stringify(record.params || {}).slice(0, 100)})`,
      status,
      resultDisplay: formatToolResult(record),
      confirmationDetails: undefined,
      renderOutputAsMarkdown: false,
    };

    setToolCalls(prev => {
      const existingIdx = prev.findIndex(t => t.callId === callId);
      const updated: TrackedToolCall = {
        callId,
        toolName: record.toolName,
        status,
        args: record.params,
        resultDisplay: formatToolResult(record),
      };
      if (existingIdx >= 0) {
        const arr = [...prev];
        arr[existingIdx] = updated;
        return arr;
      }
      return [...prev, updated];
    });

    // Add or update the tool group in history
    if (toolGroupIdRef.current !== null) {
      // Update existing tool group - would need updateItem but we don't have it here
      // For now, we'll just create new items
    } else {
      const id = addItemFn(
        {
          type: 'tool_group',
          tools: [toolDisplay],
        } as Omit<HistoryItem, 'id'>,
        Date.now(),
      );
      toolGroupIdRef.current = id;
    }
  }, []);

  // ── Retry ────────────────────────────────────────────────────────────────
  const retryLastPrompt = useCallback(async () => {
    if (streamingState !== StreamingState.Idle) return;
    const last = lastPromptRef.current;
    if (last) {
      await submitQuery(last);
    }
  }, [streamingState, submitQuery]);

  // ── handleApprovalModeChange (no-op for Alice - daemon handles approvals) ─
  const handleApprovalModeChange = useCallback((_mode: any) => {
    // Alice daemon handles approval mode
  }, []);

  // ── Pending history items (text being streamed) ───────────────────────────
  const pendingHistoryItems = useMemo((): HistoryItemWithoutId[] => {
    const items: HistoryItemWithoutId[] = [];
    if (pendingText) {
      items.push({ type: 'gemini', text: pendingText } as HistoryItemWithoutId);
    }
    return items;
  }, [pendingText]);

  return {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems,
    thought,
    cancelOngoingRequest,
    retryLastPrompt,
    pendingToolCalls: toolCalls,
    handleApprovalModeChange,
    activePtyId: undefined as number | undefined,
    loopDetectionConfirmationRequest: null,
    modelDegraded,
    activeModelName,
  };
};
