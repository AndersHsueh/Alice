"""Permission checking for tool execution."""

from __future__ import annotations

import fnmatch
import logging
from dataclasses import dataclass
from enum import Enum

log = logging.getLogger(__name__)
_SOURCE = "oh-flow"


class PermissionMode(Enum):
    """Permission mode for tool execution."""

    DEFAULT = "default"
    PLAN = "plan"
    FULL_AUTO = "full_auto"


@dataclass(frozen=True)
class PermissionDecision:
    """Result of checking whether a tool invocation may run."""

    allowed: bool
    requires_confirmation: bool = False
    reason: str = ""


@dataclass(frozen=True)
class PathRule:
    """A glob-based path permission rule."""

    pattern: str
    allow: bool  # True = allow, False = deny


@dataclass
class PermissionSettings:
    """Permission configuration."""

    mode: PermissionMode = PermissionMode.DEFAULT
    allowed_tools: list[str] = None
    denied_tools: list[str] = None
    path_rules: list[PathRule] = None
    denied_commands: list[str] = None

    def __post_init__(self) -> None:
        if self.allowed_tools is None:
            self.allowed_tools = []
        if self.denied_tools is None:
            self.denied_tools = []
        if self.path_rules is None:
            self.path_rules = []
        if self.denied_commands is None:
            self.denied_commands = []


class PermissionChecker:
    """Evaluate tool usage against the configured permission mode and rules."""

    def __init__(self, settings: PermissionSettings) -> None:
        self._settings = settings
        self._path_rules: list[PathRule] = list(settings.path_rules)

    @classmethod
    def default(cls) -> "PermissionChecker":
        """Create a checker with default (deny-by-default) settings."""
        return cls(PermissionSettings())

    @classmethod
    def full_auto(cls) -> "PermissionChecker":
        """Create a checker with full auto (allow all) settings."""
        return cls(PermissionSettings(mode=PermissionMode.FULL_AUTO))

    def evaluate(
        self,
        tool_name: str,
        *,
        is_read_only: bool = False,
        file_path: str | None = None,
        command: str | None = None,
    ) -> PermissionDecision:
        """Return whether the tool may run immediately."""
        # Explicit tool deny list
        if tool_name in self._settings.denied_tools:
            return PermissionDecision(allowed=False, reason=f"{tool_name} is explicitly denied")

        # Explicit tool allow list
        if tool_name in self._settings.allowed_tools:
            return PermissionDecision(allowed=True, reason=f"{tool_name} is explicitly allowed")

        # Check path-level rules (before is_read_only, so allow rules take effect)
        if file_path and self._path_rules:
            for rule in self._path_rules:
                if fnmatch.fnmatch(file_path, rule.pattern):
                    if rule.allow:
                        return PermissionDecision(
                            allowed=True,
                            reason=f"Path {file_path} matches allow rule: {rule.pattern}",
                        )
                    else:
                        return PermissionDecision(
                            allowed=False,
                            reason=f"Path {file_path} matches deny rule: {rule.pattern}",
                        )

        # Check command deny patterns (e.g. deny "rm -rf /")
        if command:
            for pattern in self._settings.denied_commands:
                if isinstance(pattern, str) and fnmatch.fnmatch(command, pattern):
                    return PermissionDecision(
                        allowed=False,
                        reason=f"Command matches deny pattern: {pattern}",
                    )

        # Full auto: allow everything
        if self._settings.mode == PermissionMode.FULL_AUTO:
            return PermissionDecision(allowed=True, reason="Auto mode allows all tools")

        # Plan mode: block all tools (before is_read_only check)
        if self._settings.mode == PermissionMode.PLAN:
            return PermissionDecision(
                allowed=False,
                reason="Plan mode blocks all tools until the user exits plan mode",
            )

        # Read-only tools always allowed (after mode checks)
        if is_read_only:
            return PermissionDecision(allowed=True, reason="read-only tools are allowed")

        # Default mode: require confirmation for mutating tools
        return PermissionDecision(
            allowed=False,
            requires_confirmation=True,
            reason="Mutating tools require user confirmation in default mode",
        )

    def update_mode(self, mode: PermissionMode) -> None:
        """Update the permission mode at runtime."""
        self._settings.mode = mode
