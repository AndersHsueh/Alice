"""Session persistence layer for oh-flow bridge.

Manages saving and loading session state (messages, model, system prompt, etc.)
to disk for recovery after server restart.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)
_SOURCE = "oh-flow"

# Default sessions directory
DEFAULT_SESSIONS_DIR = "~/.oh-flow/sessions"


@dataclass
class PersistedSession:
    """Persistent session data stored on disk."""

    session_id: str
    cwd: str
    created_at: float
    updated_at: float
    model: str
    system_prompt: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dictionary for JSON storage."""
        return {
            "session_id": self.session_id,
            "cwd": self.cwd,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "model": self.model,
            "system_prompt": self.system_prompt,
            "messages": self.messages,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PersistedSession":
        """Deserialize from dictionary loaded from JSON."""
        return cls(
            session_id=data["session_id"],
            cwd=data.get("cwd", "."),
            created_at=data.get("created_at", time.time()),
            updated_at=data.get("updated_at", time.time()),
            model=data.get("model", ""),
            system_prompt=data.get("system_prompt", ""),
            messages=data.get("messages", []),
            metadata=data.get("metadata", {}),
        )


class SessionPersistenceManager:
    """Manages session persistence to disk.

    Sessions are stored as individual JSON files in ~/.oh-flow/sessions/
    Each file is named {session_id}.json
    """

    def __init__(self, sessions_dir: str | Path | None = None) -> None:
        self._sessions_dir = Path(
            str(sessions_dir) if sessions_dir else DEFAULT_SESSIONS_DIR
        ).expanduser()
        self._sessions_dir.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()

    @property
    def sessions_dir(self) -> Path:
        """Return the sessions directory path."""
        return self._sessions_dir

    def _session_file(self, session_id: str) -> Path:
        """Return the file path for a session."""
        return self._sessions_dir / f"{session_id}.json"

    async def save(self, session: PersistedSession) -> None:
        """Save a session to disk.

        Thread-safe: acquires lock before writing.
        """
        async with self._lock:
            session.updated_at = time.time()
            file_path = self._session_file(session.session_id)
            temp_path = file_path.with_suffix(".tmp")
            try:
                temp_path.write_text(
                    json.dumps(session.to_dict(), indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                temp_path.replace(file_path)
                file_path.chmod(0o600)  # Restrict permissions: owner read/write only
                log.debug(f"Session saved: {session.session_id}")
            except Exception as exc:
                log.error(f"Failed to save session {session.session_id}: {exc}")
                # Clean up temp file if it exists
                if temp_path.exists():
                    temp_path.unlink(missing_ok=True)
                raise

    async def load(self, session_id: str) -> PersistedSession | None:
        """Load a session from disk by ID.

        Returns None if the session does not exist or is corrupted.
        """
        file_path = self._session_file(session_id)
        if not file_path.exists():
            return None
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            return PersistedSession.from_dict(data)
        except (json.JSONDecodeError, KeyError) as exc:
            log.warn(f"Failed to load session {session_id}: {exc}")
            return None

    async def delete(self, session_id: str) -> bool:
        """Delete a session from disk.

        Returns True if the session was deleted, False if it didn't exist.
        """
        async with self._lock:
            file_path = self._session_file(session_id)
            if not file_path.exists():
                return False
            try:
                file_path.unlink()
                log.debug(f"Session deleted: {session_id}")
                return True
            except Exception as exc:
                log.error(f"Failed to delete session {session_id}: {exc}")
                return False

    async def list_sessions(self) -> list[str]:
        """List all session IDs that have persisted data on disk."""
        session_ids: list[str] = []
        if not self._sessions_dir.exists():
            return session_ids
        for file_path in self._sessions_dir.iterdir():
            if file_path.is_file() and file_path.suffix == ".json":
                session_ids.append(file_path.stem)
        return session_ids

    async def load_all(self) -> dict[str, PersistedSession]:
        """Load all persisted sessions.

        Returns a dict mapping session_id -> PersistedSession.
        Only includes sessions that loaded successfully.
        """
        sessions: dict[str, PersistedSession] = {}
        for session_id in await self.list_sessions():
            session = await self.load(session_id)
            if session is not None:
                sessions[session_id] = session
        log.info(f"Loaded {len(sessions)} persisted sessions")
        return sessions


# Global singleton
_persistence_manager: SessionPersistenceManager | None = None


def get_persistence_manager() -> SessionPersistenceManager:
    """Return the global persistence manager instance."""
    global _persistence_manager
    if _persistence_manager is None:
        _persistence_manager = SessionPersistenceManager()
    return _persistence_manager
