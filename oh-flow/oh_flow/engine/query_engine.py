"""High-level conversation engine."""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

from pathlib import Path
from typing import AsyncIterator

from oh_flow.engine.messages import ConversationMessage, ToolResultBlock
from oh_flow.engine.query import AskUserPrompt, PermissionPrompt, QueryContext, run_query
from oh_flow.engine.stream_events import StreamEvent, UsageSnapshot


class CostTracker:
    """Track cumulative API usage across turns."""

    def __init__(self) -> None:
        self._usage = UsageSnapshot()

    @property
    def total(self) -> UsageSnapshot:
        return self._usage

    def add(self, usage: UsageSnapshot) -> None:
        self._usage = self._usage + usage

    def reset(self) -> None:
        self._usage = UsageSnapshot()


class QueryEngine:
    """Owns conversation history and the tool-aware model loop."""

    def __init__(
        self,
        *,
        api_client: "SupportsStreamingMessages",
        tool_registry: "ToolRegistry",
        permission_checker: "PermissionChecker",
        cwd: str | Path,
        model: str,
        system_prompt: str,
        max_tokens: int = 4096,
        max_turns: int | None = 8,
        permission_prompt: PermissionPrompt | None = None,
        ask_user_prompt: AskUserPrompt | None = None,
        hook_executor: "HookExecutor | None" = None,
        tool_metadata: dict[str, object] | None = None,
    ) -> None:
        self._api_client = api_client
        self._tool_registry = tool_registry
        self._permission_checker = permission_checker
        self._cwd = Path(cwd).resolve()
        self._model = model
        self._system_prompt = system_prompt
        self._max_tokens = max_tokens
        self._max_turns = max_turns
        self._permission_prompt = permission_prompt
        self._ask_user_prompt = ask_user_prompt
        self._hook_executor = hook_executor
        self._tool_metadata = tool_metadata or {}
        self._messages: list[ConversationMessage] = []
        self._cost_tracker = CostTracker()

    @property
    def messages(self) -> list[ConversationMessage]:
        """Return the current conversation history."""
        return list(self._messages)

    @property
    def max_turns(self) -> int | None:
        """Return the maximum number of agentic turns per user input, if capped."""
        return self._max_turns

    @property
    def total_usage(self) -> UsageSnapshot:
        """Return the total usage across all turns."""
        return self._cost_tracker.total

    def clear(self) -> None:
        """Clear the in-memory conversation history."""
        self._messages.clear()
        self._cost_tracker.reset()

    def set_system_prompt(self, prompt: str) -> None:
        """Update the active system prompt for future turns."""
        self._system_prompt = prompt

    def set_model(self, model: str) -> None:
        """Update the active model for future turns."""
        self._model = model

    def set_api_client(self, api_client: "SupportsStreamingMessages") -> None:
        """Update the active API client for future turns."""
        self._api_client = api_client

    def set_max_turns(self, max_turns: int | None) -> None:
        """Update the maximum number of agentic turns per user input."""
        self._max_turns = None if max_turns is None else max(1, int(max_turns))

    def set_permission_checker(self, checker: "PermissionChecker") -> None:
        """Update the active permission checker for future turns."""
        self._permission_checker = checker

    def load_messages(self, messages: list[ConversationMessage]) -> None:
        """Replace the in-memory conversation history."""
        self._messages = list(messages)

    def has_pending_continuation(self) -> bool:
        """Return True when the conversation ends with tool results awaiting a follow-up model turn."""
        if not self._messages:
            return False
        last = self._messages[-1]
        if last.role != "user":
            return False
        if not any(isinstance(block, ToolResultBlock) for block in last.content):
            return False
        for msg in reversed(self._messages[:-1]):
            if msg.role != "assistant":
                continue
            return bool(msg.tool_uses)
        return False

    async def submit_message(self, prompt: str) -> AsyncIterator[StreamEvent]:
        """Append a user message and execute the query loop."""
        from oh_flow.engine.query import MaxTurnsExceeded

        self._messages.append(ConversationMessage.from_user_text(prompt))
        context = QueryContext(
            api_client=self._api_client,
            tool_registry=self._tool_registry,
            permission_checker=self._permission_checker,
            cwd=self._cwd,
            model=self._model,
            system_prompt=self._system_prompt,
            max_tokens=self._max_tokens,
            max_turns=self._max_turns,
            permission_prompt=self._permission_prompt,
            ask_user_prompt=self._ask_user_prompt,
            hook_executor=self._hook_executor,
            tool_metadata=self._tool_metadata,
        )
        async for event, usage in run_query(context, self._messages):
            if usage is not None:
                self._cost_tracker.add(usage)
            yield event

    async def continue_pending(self, *, max_turns: int | None = None) -> AsyncIterator[StreamEvent]:
        """Continue an interrupted tool loop without appending a new user message."""
        from oh_flow.engine.query import MaxTurnsExceeded

        context = QueryContext(
            api_client=self._api_client,
            tool_registry=self._tool_registry,
            permission_checker=self._permission_checker,
            cwd=self._cwd,
            model=self._model,
            system_prompt=self._system_prompt,
            max_tokens=self._max_tokens,
            max_turns=max_turns if max_turns is not None else self._max_turns,
            permission_prompt=self._permission_prompt,
            ask_user_prompt=self._ask_user_prompt,
            hook_executor=self._hook_executor,
            tool_metadata=self._tool_metadata,
        )
        async for event, usage in run_query(context, self._messages):
            if usage is not None:
                self._cost_tracker.add(usage)
            yield event


# Type imports
from oh_flow.engine.query import SupportsStreamingMessages  # noqa: E402
from oh_flow.tools.base import ToolRegistry  # noqa: E402
from oh_flow.permissions.checker import PermissionChecker  # noqa: E402
from oh_flow.hooks import HookExecutor  # noqa: E402
