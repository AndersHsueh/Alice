/**
 * 确认框（危险命令）与问答框（ask_user）状态与展示逻辑
 */

import { useState, useCallback } from 'react';

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

export interface UseDialogsReturn {
  confirmDialog: ConfirmDialogState | null;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmDialogState | null>>;
  questionDialog: QuestionDialogState | null;
  setQuestionDialog: React.Dispatch<React.SetStateAction<QuestionDialogState | null>>;
  showQuestionDialog: (
    question: string,
    choices: string[],
    allowFreeform: boolean
  ) => Promise<string>;
}

export function useDialogs(): UseDialogsReturn {
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [questionDialog, setQuestionDialog] = useState<QuestionDialogState | null>(null);

  const showQuestionDialog = useCallback(
    (question: string, choices: string[], allowFreeform: boolean): Promise<string> => {
      return new Promise((resolve) => {
        setQuestionDialog({
          question,
          choices,
          allowFreeform,
          onAnswer: (answer: string) => {
            setQuestionDialog(null);
            resolve(answer);
          },
        });
      });
    },
    []
  );

  return {
    confirmDialog,
    setConfirmDialog,
    questionDialog,
    setQuestionDialog,
    showQuestionDialog,
  };
}
