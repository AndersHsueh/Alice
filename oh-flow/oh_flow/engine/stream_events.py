"""Events yielded by the query engine."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AssistantTextDelta:
    """Incremental assistant text."""

    text: str


@dataclass(frozen=True)
class AssistantTurnComplete:
    """Completed assistant turn."""

    message: "ConversationMessage"
    usage: "UsageSnapshot"


@dataclass(frozen=True)
class ToolExecutionStarted:
    """The engine is about to execute a tool."""

    tool_name: str
    tool_input: dict[str, Any]


@dataclass(frozen=True)
class ToolExecutionCompleted:
    """A tool has finished executing."""

    tool_name: str
    output: str
    is_error: bool = False


@dataclass(frozen=True)
class ErrorEvent:
    """An error that should be surfaced to the user."""

    message: str
    recoverable: bool = True


@dataclass(frozen=True)
class StatusEvent:
    """A transient system status message shown to the user."""

    message: str


StreamEvent = (
    AssistantTextDelta
    | AssistantTurnComplete
    | ToolExecutionStarted
    | ToolExecutionCompleted
    | ErrorEvent
    | StatusEvent
)


# Forward reference for UsageSnapshot
class UsageSnapshot:
    """Token usage snapshot."""

    def __init__(
        self,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def __add__(self, other: "UsageSnapshot") -> "UsageSnapshot":
        return UsageSnapshot(
            self.input_tokens + other.input_tokens,
            self.output_tokens + other.output_tokens,
        )

    def __repr__(self) -> str:
        return f"UsageSnapshot(in={self.input_tokens}, out={self.output_tokens})"


# ConversationMessage is imported from messages.py
from oh_flow.engine.messages import ConversationMessage  # noqa: E402, F401
