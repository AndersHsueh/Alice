"""Hooks module - lifecycle event hooks."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class HookEvent(Enum):
    """Lifecycle hook event types."""

    SESSION_START = "session_start"
    SESSION_END = "session_end"
    PRE_TOOL_USE = "pre_tool_use"
    POST_TOOL_USE = "post_tool_use"


@dataclass
class HookResult:
    """Result from a hook execution."""

    blocked: bool = False
    reason: str | None = None


@dataclass
class HookExecutionContext:
    """Context available during hook execution."""

    cwd: str
    api_client: Any = None
    default_model: str = ""


class HookExecutor:
    """Execute lifecycle hooks."""

    def __init__(self, registry: "HookRegistry | None" = None, context: HookExecutionContext | None = None) -> None:
        self._registry = registry
        self._context = context or HookExecutionContext(cwd=".")

    def current_registry(self) -> "HookRegistry | None":
        return self._registry

    async def execute(self, event: HookEvent, data: dict[str, Any]) -> HookResult:
        """Execute hooks for an event."""
        # Simplified: no hooks in v1
        return HookResult(blocked=False)

    def update_context(self, **kwargs: Any) -> None:
        """Update the execution context."""
        if self._context:
            for key, value in kwargs.items():
                if hasattr(self._context, key):
                    setattr(self._context, key, value)


class HookRegistry:
    """Registry of configured hooks."""

    def summary(self) -> str:
        """Return a human-readable summary of registered hooks."""
        return "No hooks configured"
