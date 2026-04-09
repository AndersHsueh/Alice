"""Minimal application state model."""

from __future__ import annotations

from typing import Any
from dataclasses import dataclass, field


@dataclass
class AppState:
    """Shared mutable UI/session state."""

    model: str = "claude-sonnet-4-6"
    permission_mode: str = "default"
    theme: str = "default"
    cwd: str = "."
    provider: str = "anthropic"
    auth_status: str = "missing"
    base_url: str = ""
    vim_enabled: bool = False
    voice_enabled: bool = False
    voice_available: bool = False
    voice_reason: str = ""
    fast_mode: bool = False
    effort: str = "medium"
    passes: int = 1
    mcp_connected: int = 0
    mcp_failed: int = 0
    bridge_sessions: int = 0
    output_style: str = "default"
    keybindings: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "model": self.model,
            "permission_mode": self.permission_mode,
            "theme": self.theme,
            "cwd": self.cwd,
            "provider": self.provider,
            "auth_status": self.auth_status,
            "base_url": self.base_url,
            "vim_enabled": self.vim_enabled,
            "voice_enabled": self.voice_enabled,
            "voice_available": self.voice_available,
            "voice_reason": self.voice_reason,
            "fast_mode": self.fast_mode,
            "effort": self.effort,
            "passes": self.passes,
            "mcp_connected": self.mcp_connected,
            "mcp_failed": self.mcp_failed,
            "bridge_sessions": self.bridge_sessions,
            "output_style": self.output_style,
            "keybindings": dict(self.keybindings),
        }


class AppStateStore:
    """Thread-safe wrapper around AppState for concurrent access."""

    def __init__(self, state: AppState | None = None) -> None:
        import threading

        self._state = state or AppState()
        self._lock = threading.RLock()

    def get(self) -> AppState:
        """Get a snapshot of the current state."""
        with self._lock:
            return AppState(
                model=self._state.model,
                permission_mode=self._state.permission_mode,
                theme=self._state.theme,
                cwd=self._state.cwd,
                provider=self._state.provider,
                auth_status=self._state.auth_status,
                base_url=self._state.base_url,
                vim_enabled=self._state.vim_enabled,
                voice_enabled=self._state.voice_enabled,
                voice_available=self._state.voice_available,
                voice_reason=self._state.voice_reason,
                fast_mode=self._state.fast_mode,
                effort=self._state.effort,
                passes=self._state.passes,
                mcp_connected=self._state.mcp_connected,
                mcp_failed=self._state.mcp_failed,
                bridge_sessions=self._state.bridge_sessions,
                output_style=self._state.output_style,
                keybindings=dict(self._state.keybindings),
            )

    def set(self, **kwargs: Any) -> None:
        """Update state fields."""
        with self._lock:
            for key, value in kwargs.items():
                if hasattr(self._state, key):
                    setattr(self._state, key, value)
