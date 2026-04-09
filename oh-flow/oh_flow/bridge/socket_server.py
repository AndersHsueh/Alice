"""AsyncIO Unix Socket Server for the OpenHarness bridge.

Implements a JSON-RPC 2.0 server over Unix domain sockets, supporting:
- Session lifecycle (create/close)
- Tool execution (single and streaming)
- Query streaming (AsyncIterator → Socket)
- Error handling with structured error codes
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator
from concurrent.futures import ThreadPoolExecutor

from oh_flow.bridge.protocol import (
    ERROR_EXECUTION_FAILED,
    ERROR_INVALID_REQUEST,
    ERROR_INVALID_PARAMS,
    ERROR_METHOD_NOT_FOUND,
    ERROR_SESSION_NOT_FOUND,
    ERROR_TIMEOUT,
    ERROR_PERMISSION_DENIED,
    JsonRpcError,
    JsonRpcRequest,
    JsonRpcResponse,
    ProtocolHandler,
    get_method,
    register_method,
)
from oh_flow.permissions.checker import (
    PermissionChecker,
    PermissionMode,
    PermissionSettings,
    PermissionDecision,
)
from oh_flow.bridge.session_persistence import PersistedSession, SessionPersistenceManager, get_persistence_manager
from oh_flow.metrics.collector import MetricsCollector, get_metrics_collector

log = logging.getLogger(__name__)
_SOURCE = "oh-flow"


def _fmt(msg: str, **kw: Any) -> str:
    """Format structured log message."""
    if kw:
        extra = " ".join(f"{k}={v}" for k, v in kw.items())
        return f"{msg} | {extra}"
    return msg


# Default socket path - can be overridden via environment or constructor
DEFAULT_SOCKET_PATH = os.path.expanduser("~/.oh-flow/bridge.sock")
DEFAULT_SOCKET_DIR = os.path.expanduser("~/.oh-flow")


@dataclass
class StreamContext:
    """Context for a streaming response."""

    stream_id: str
    queue: asyncio.Queue[dict[str, Any] | None]  # None = sentinel for stream end
    active: bool = True
    _writer: asyncio.StreamWriter | None = field(default=None, repr=False)

    def set_writer(self, writer: asyncio.StreamWriter) -> None:
        """Set the socket writer for direct socket writes."""
        self._writer = writer

    async def push(self, data: dict[str, Any]) -> None:
        """Push a data frame to the stream and write to socket."""
        await self.queue.put(data)
        # Write directly to socket as stream/event notification
        # Socket errors are non-fatal: the event is already queued
        if self._writer:
            try:
                frame = json.dumps({
                    "jsonrpc": "2.0",
                    "method": "stream/event",
                    "params": {"stream_id": self.stream_id, "data": data},
                }).encode() + b"\n"
                self._writer.write(frame)
                await self._writer.drain()
            except (ConnectionResetError, BrokenPipeError, OSError) as exc:
                log.debug(_fmt(f"Socket write failed (client disconnected)", exc=exc))
                self._writer = None

    async def close(self, final_data: dict[str, Any] | None = None) -> None:
        """Close the stream, write stream/end, and signal end of stream."""
        self.active = False
        if final_data is not None:
            await self.queue.put({"_final": final_data})
        await self.queue.put(None)  # Sentinel
        # Write stream/end notification to socket
        # Socket errors are non-fatal: the stream is closing anyway
        if self._writer:
            try:
                frame = json.dumps({
                    "jsonrpc": "2.0",
                    "method": "stream/end",
                    "params": {"stream_id": self.stream_id, "final_data": final_data},
                }).encode() + b"\n"
                self._writer.write(frame)
                await self._writer.drain()
            except (ConnectionResetError, BrokenPipeError, OSError) as exc:
                log.debug(_fmt("Socket write failed on close", exc=str(exc)))
                self._writer = None


@dataclass
class SessionContext:
    """Context for a bridge session."""

    session_id: str
    cwd: str
    created_at: float
    model: str = ""
    system_prompt: str = ""
    messages: list[dict[str, Any]] = field(default_factory=list)
    runtime: Any = None  # RuntimeBundle or None
    streams: dict[str, StreamContext] = field(default_factory=dict)

    def next_stream_id(self) -> str:
        """Generate a unique stream ID."""
        return f"{self.session_id}:{uuid.uuid4().hex[:8]}"

    def register_stream(self, stream_id: str) -> StreamContext:
        """Register a new stream for this session."""
        ctx = StreamContext(stream_id=stream_id, queue=asyncio.Queue())
        self.streams[stream_id] = ctx
        return ctx

    def get_stream(self, stream_id: str) -> StreamContext | None:
        """Get a stream context by ID."""
        return self.streams.get(stream_id)

    def close_stream(self, stream_id: str) -> None:
        """Close and remove a stream."""
        stream = self.streams.pop(stream_id, None)
        if stream is not None:
            stream.active = False


@dataclass
class SessionManager:
    """Manages bridge sessions with persistence to disk."""

    def __init__(
        self,
        persistence: SessionPersistenceManager | None = None,
    ) -> None:
        self._sessions: dict[str, SessionContext] = {}
        self._lock = asyncio.Lock()
        self._persistence = persistence or get_persistence_manager()
        # Recover sessions from disk on startup
        asyncio.create_task(self._recover_sessions())

    async def _recover_sessions(self) -> None:
        """Recover sessions from disk on startup."""
        try:
            persisted = await self._persistence.load_all()
            for session_id, ps in persisted.items():
                ctx = SessionContext(
                    session_id=ps.session_id,
                    cwd=ps.cwd,
                    created_at=ps.created_at,
                    model=ps.model,
                    system_prompt=ps.system_prompt,
                    messages=ps.messages,
                )
                self._sessions[ctx.session_id] = ctx
                log.info(_fmt("Session recovered", session_id=ctx.session_id, msg_count=len(ctx.messages)))
        except Exception as exc:
            log.warn(f"Session recovery failed: {exc}")

    async def _persist_session(self, session_id: str) -> None:
        """Persist a session to disk."""
        ctx = self._sessions.get(session_id)
        if ctx is None:
            return
        ps = PersistedSession(
            session_id=ctx.session_id,
            cwd=ctx.cwd,
            created_at=ctx.created_at,
            updated_at=0,
            model=ctx.model,
            system_prompt=ctx.system_prompt,
            messages=ctx.messages,
        )
        await self._persistence.save(ps)

    async def _delete_session_file(self, session_id: str) -> None:
        """Delete a session file from disk."""
        await self._persistence.delete(session_id)

    async def create_session(
        self,
        cwd: str | None = None,
        session_id: str | None = None,
        model: str = "",
        system_prompt: str = "",
    ) -> SessionContext:
        """Create a new session."""
        async with self._lock:
            if session_id is None:
                session_id = uuid.uuid4().hex[:12]
            if session_id in self._sessions:
                raise ValueError(f"Session already exists: {session_id}")

            import time

            ctx = SessionContext(
                session_id=session_id,
                cwd=cwd or os.getcwd(),
                created_at=time.time(),
                model=model,
                system_prompt=system_prompt,
            )
            self._sessions[session_id] = ctx
            await self._persist_session(session_id)
            log.info(f"Session created: {session_id} (cwd={ctx.cwd})")
            return ctx

    async def get_session(self, session_id: str) -> SessionContext | None:
        """Get a session by ID."""
        async with self._lock:
            return self._sessions.get(session_id)

    async def close_session(self, session_id: str) -> None:
        """Close and remove a session."""
        async with self._lock:
            ctx = self._sessions.pop(session_id, None)
            if ctx is not None:
                # Close all streams
                for stream_id in list(ctx.streams.keys()):
                    ctx.close_stream(stream_id)
                await self._delete_session_file(session_id)
                log.info(f"Session closed: {session_id}")

    def list_sessions(self) -> list[str]:
        """List all active session IDs."""
        return list(self._sessions.keys())

    @property
    def session_count(self) -> int:
        return len(self._sessions)


class SocketServer:
    """AsyncIO Unix Domain Socket server for JSON-RPC communication.

    Features:
    - Non-blocking Unix socket I/O
    - JSON-RPC 2.0 request handling
    - Session management
    - Streaming response support
    - Graceful shutdown

    Usage:
        server = SocketServer(socket_path="/tmp/bridge.sock")
        await server.serve()
    """

    def __init__(
        self,
        socket_path: str | Path | None = None,
        session_manager: SessionManager | None = None,
        protocol: ProtocolHandler | None = None,
        executor: ThreadPoolExecutor | None = None,
        read_buffer_size: int = 64 * 1024,
    ) -> None:
        self._socket_path = Path(socket_path or DEFAULT_SOCKET_PATH)
        self._session_manager = session_manager or SessionManager(
            persistence=get_persistence_manager(),
        )
        self._protocol = protocol or ProtocolHandler()
        self._executor = executor
        self._read_buffer_size = read_buffer_size
        self._server: asyncio.Server | None = None
        self._shutdown_event = asyncio.Event()
        self._started = False
        self._current_writer: asyncio.StreamWriter | None = None

        # Permission checker (default: deny-by-default)
        self._permission_checker = PermissionChecker.default()

        # Metrics collector
        self._metrics = get_metrics_collector()

        # Register built-in JSON-RPC methods
        self._register_builtin_methods()

    def _register_builtin_methods(self) -> None:
        """Register the built-in JSON-RPC method handlers."""
        register_method("bridge.list_sessions")(self._rpc_list_sessions)
        register_method("bridge.get_session")(self._rpc_get_session)
        register_method("bridge.ping")(self._rpc_ping)
        register_method("session.create")(self._rpc_session_create)
        register_method("session.close")(self._rpc_session_close)
        register_method("session.list")(self._rpc_session_list)
        register_method("session.save")(self._rpc_session_save)
        register_method("session.append_message")(self._rpc_session_append_message)
        register_method("session.stream")(self._rpc_session_stream)
        register_method("tool.execute")(self._rpc_execute_tool)
        register_method("cancel_stream")(self._rpc_cancel_stream)
        register_method("session.execute")(self._rpc_session_execute)
        register_method("stream.events")(self._rpc_stream_events)
        register_method("permission.check")(self._rpc_permission_check)
        register_method("permission.set_mode")(self._rpc_permission_set_mode)
        register_method("permission.get_mode")(self._rpc_permission_get_mode)
        register_method("command.execute")(self._rpc_command_execute)
        register_method("command.list")(self._rpc_command_list)
        register_method("command.help")(self._rpc_command_help)
        register_method("metrics.get")(self._rpc_metrics_get)
        register_method("metrics.reset")(self._rpc_metrics_reset)

    # -------------------------------------------------------------------------
    # Built-in JSON-RPC method handlers
    # -------------------------------------------------------------------------

    async def _rpc_list_sessions(self, params: dict[str, Any]) -> dict[str, Any]:
        """List all active sessions."""
        return {
            "sessions": self._session_manager.list_sessions(),
            "count": self._session_manager.session_count,
        }

    async def _rpc_get_session(self, params: dict[str, Any]) -> dict[str, Any]:
        """Get session details."""
        session_id = params.get("session_id")
        if not session_id:
            raise JsonRpcError.invalid_params("Missing required param: session_id")
        ctx = await self._session_manager.get_session(session_id)
        if ctx is None:
            raise JsonRpcError.session_not_found(session_id)
        return {
            "session_id": ctx.session_id,
            "cwd": ctx.cwd,
            "created_at": ctx.created_at,
            "model": ctx.model,
            "system_prompt": ctx.system_prompt,
            "message_count": len(ctx.messages),
            "messages": ctx.messages,
            "stream_count": len(ctx.streams),
        }

    async def _rpc_ping(self, params: dict[str, Any]) -> dict[str, Any]:
        """Health check / ping."""
        return {"status": "ok", "version": "1.0"}

    async def _rpc_session_create(self, params: dict[str, Any]) -> dict[str, Any]:
        """Create a new session, optionally loading from persisted state."""
        cwd = params.get("cwd")
        session_id = params.get("session_id")
        model = params.get("model", "")
        system_prompt = params.get("system_prompt", "")
        try:
            ctx = await self._session_manager.create_session(
                cwd=cwd, session_id=session_id, model=model, system_prompt=system_prompt
            )
            self._metrics.record_session_create()
            return {
                "session_id": ctx.session_id,
                "cwd": ctx.cwd,
                "created_at": ctx.created_at,
                "model": ctx.model,
                "system_prompt": ctx.system_prompt,
                "message_count": len(ctx.messages),
            }
        except ValueError as exc:
            raise JsonRpcError.session_already_exists(str(exc))

    async def _rpc_session_close(self, params: dict[str, Any]) -> dict[str, Any]:
        """Close a session."""
        session_id = params.get("session_id")
        if not session_id:
            raise JsonRpcError.invalid_params("Missing required param: session_id")
        ctx = await self._session_manager.get_session(session_id)
        if ctx is None:
            raise JsonRpcError.session_not_found(session_id)
        await self._session_manager.close_session(session_id)
        self._metrics.record_session_close()
        return {"session_id": session_id, "closed": True}

    async def _rpc_session_list(self, params: dict[str, Any]) -> dict[str, Any]:
        """List all sessions."""
        sessions = self._session_manager.list_sessions()
        return {"sessions": sessions, "count": len(sessions)}

    async def _rpc_session_save(self, params: dict[str, Any]) -> dict[str, Any]:
        """Persist a session's messages to disk."""
        session_id = params.get("session_id")
        if not session_id:
            raise JsonRpcError.invalid_params("Missing required param: session_id")
        ctx = await self._session_manager.get_session(session_id)
        if ctx is None:
            raise JsonRpcError.session_not_found(session_id)
        await self._session_manager._persist_session(session_id)
        return {
            "session_id": session_id,
            "saved": True,
            "message_count": len(ctx.messages),
        }

    async def _rpc_session_append_message(self, params: dict[str, Any]) -> dict[str, Any]:
        """Append a message to the session's message history."""
        session_id = params.get("session_id")
        if not session_id:
            raise JsonRpcError.invalid_params("Missing required param: session_id")
        ctx = await self._session_manager.get_session(session_id)
        if ctx is None:
            raise JsonRpcError.session_not_found(session_id)
        role = params.get("role")
        content = params.get("content")
        if not role or not content:
            raise JsonRpcError.invalid_params("Missing required params: role, content")
        ctx.messages.append({"role": role, "content": content})
        # Auto-save after appending message
        await self._session_manager._persist_session(session_id)
        return {
            "session_id": session_id,
            "message_count": len(ctx.messages),
        }

    async def _rpc_session_stream(self, params: dict[str, Any]) -> dict[str, Any]:
        """Start a streaming session query.

        Initiates a QueryEngine stream for the given session.
        The stream_id is returned immediately, and streaming events
        are sent as notifications to the client.
        """
        session_id = params.get("session_id")
        if not session_id:
            raise JsonRpcError.invalid_params("Missing required param: session_id")
        ctx = await self._session_manager.get_session(session_id)
        if ctx is None:
            raise JsonRpcError.session_not_found(session_id)

        stream_id = ctx.next_stream_id()
        stream_ctx = ctx.register_stream(stream_id)

        # Capture the writer reference before starting the background task
        writer = self._current_writer
        if writer is not None:
            stream_ctx.set_writer(writer)

        # Record stream start metric
        self._metrics.record_stream_start()

        # Get query parameters (TS sends "message", not "prompt")
        prompt = params.get("message", "")
        max_turns = params.get("max_turns")

        # Start streaming task in background
        asyncio.create_task(
            self._run_query_stream(
                ctx=ctx,
                stream_ctx=stream_ctx,
                stream_id=stream_id,
                prompt=prompt,
                max_turns=max_turns,
                writer=writer,
            )
        )

        return {
            "stream_id": stream_id,
            "session_id": session_id,
        }

    async def _run_query_stream(
        self,
        ctx: SessionContext,
        stream_ctx: StreamContext,
        stream_id: str,
        prompt: str,
        max_turns: int | None,
        writer: asyncio.StreamWriter | None,
    ) -> None:
        """Run QueryEngine and stream events to the client.

        Converts QueryEngine AsyncIterator events to socket frames:
        - AssistantTextDelta -> text_delta
        - ToolExecutionStarted -> tool_start
        - ToolExecutionCompleted -> tool_end
        - ErrorEvent -> error
        - AssistantTurnComplete -> done (final)
        """
        from oh_flow.engine.query_engine import QueryEngine
        from oh_flow.engine.stream_events import (
            AssistantTextDelta,
            AssistantTurnComplete,
            ToolExecutionCompleted,
            ToolExecutionStarted,
            ErrorEvent,
            StatusEvent,
        )

        # Ensure stream context has the writer for direct socket writes
        if writer is not None:
            stream_ctx.set_writer(writer)

        try:
            # Build a minimal QueryEngine if runtime is not set up
            if ctx.runtime is None:
                # Create a simple mock engine for testing
                # In Phase 3, this will use the real QueryEngine
                import time

                # Append user message to session history AND persist immediately
                # (before streaming to handle client disconnection gracefully)
                ctx.messages.append({"role": "user", "content": prompt})
                await self._session_manager._persist_session(ctx.session_id)
                assistant_text = ""

                # Simulate streaming text
                for i, chunk in enumerate(prompt.split()):
                    await asyncio.sleep(0.01)  # Simulate latency
                    assistant_text += chunk + " "
                    event = {
                        "type": "text_delta",
                        "delta": chunk + " ",
                    }
                    await stream_ctx.push(event)
                    self._metrics.record_stream_event()

                # Append assistant response and persist BEFORE closing socket
                ctx.messages.append({"role": "assistant", "content": assistant_text.strip()})
                await self._session_manager._persist_session(ctx.session_id)

                # Simulate done
                final = {
                    "type": "done",
                    "reply": assistant_text.strip(),
                    "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
                }
                await stream_ctx.close(final)
                self._metrics.record_stream_complete()
                return

            # Use the session's QueryEngine
            engine = ctx.runtime
            # Append user message to session history AND persist immediately
            # (before streaming to handle client disconnection gracefully)
            ctx.messages.append({"role": "user", "content": prompt})
            await self._session_manager._persist_session(ctx.session_id)
            assistant_text = ""
            async for event in engine.submit_message(prompt):
                self._metrics.record_stream_event()
                if isinstance(event, AssistantTextDelta):
                    assistant_text += event.text
                    await stream_ctx.push({
                        "type": "text_delta",
                        "delta": event.text,
                    })
                elif isinstance(event, ToolExecutionStarted):
                    await stream_ctx.push({
                        "type": "tool_call_start",
                        "tool_name": event.tool_name,
                        "tool_args": event.tool_input,
                    })
                elif isinstance(event, ToolExecutionCompleted):
                    await stream_ctx.push({
                        "type": "tool_call_end",
                        "tool_name": event.tool_name,
                        "output": event.output,
                        "success": not event.is_error,
                    })
                elif isinstance(event, ErrorEvent):
                    await stream_ctx.push({
                        "type": "error",
                        "message": event.message,
                    })
                elif isinstance(event, StatusEvent):
                    await stream_ctx.push({
                        "type": "progress",
                        "message": event.message,
                        "progress": 0,
                    })
                elif isinstance(event, AssistantTurnComplete):
                    # Append assistant response and persist to disk
                    ctx.messages.append({"role": "assistant", "content": event.message.text})
                    await self._session_manager._persist_session(ctx.session_id)
                    final = {
                        "type": "done",
                        "reply": event.message.text,
                        "usage": {
                            "input_tokens": event.usage.input_tokens,
                            "output_tokens": event.usage.output_tokens,
                            "total_tokens": event.usage.total_tokens,
                        },
                    }
                    await stream_ctx.close(final)
                    self._metrics.record_stream_complete()
                    return

        except asyncio.CancelledError:
            log.info(f"Stream cancelled: {stream_id}")
            await stream_ctx.close({"type": "error", "message": "Stream cancelled"})
            self._metrics.record_stream_cancelled()
        except Exception as exc:
            log.error(f"Stream error {stream_id}: {exc}", exc_info=True)
            await stream_ctx.close({
                "type": "error",
                "message": str(exc),
            })
            self._metrics.record_stream_complete()

    # -------------------------------------------------------------------------
    # Tool execution methods
    # -------------------------------------------------------------------------

    async def _rpc_execute_tool(self, params: dict[str, Any]) -> dict[str, Any]:
        """Execute a single tool and return the result.

        Params:
            tool_name: Name of the tool to execute
            tool_input: Dictionary of tool arguments
            session_id: Optional session ID for context
        """
        tool_name = params.get("tool_name")
        if not tool_name:
            raise JsonRpcError.invalid_params("Missing required param: tool_name")

        # Support both TS-side param name (tool_args) and internal name (tool_input)
        tool_input = params.get("tool_args") or params.get("tool_input", {})

        from oh_flow.tools.toolbox import get_default_registry

        registry = get_default_registry()
        # Case-insensitive lookup: try exact match first, then lowercase
        tool = registry.get(tool_name)
        if tool is None:
            tool = registry.get(tool_name.lower())
        if tool is None:
            raise JsonRpcError.tool_not_found(tool_name)

        # Permission check before execution
        decision = self._permission_checker.evaluate(tool_name)
        if not decision.allowed:
            return {
                "success": False,
                "allowed": False,
                "requires_confirmation": decision.requires_confirmation,
                "reason": decision.reason,
            }

        try:
            parsed = tool.input_model.model_validate(tool_input)
        except Exception as exc:
            raise JsonRpcError.invalid_params(f"Invalid tool input: {exc}")

        from oh_flow.tools.base import ToolExecutionContext
        from pathlib import Path
        import time as time_module

        exec_start = time_module.perf_counter()
        result = await tool.execute(
            parsed,
            ToolExecutionContext(cwd=Path.cwd()),
        )
        exec_latency_ms = (time_module.perf_counter() - exec_start) * 1000
        self._metrics.record_tool_execution(tool_name, success=not result.is_error, latency_ms=exec_latency_ms)

        return {
            "success": True,
            "output": result.output if not result.is_error else None,
            "error": result.output if result.is_error else None,
            "metadata": result.metadata,
        }

    async def _rpc_cancel_stream(self, params: dict[str, Any]) -> dict[str, Any]:
        """Cancel a running stream.

        Params:
            stream_id: The stream ID to cancel
        """
        stream_id = params.get("stream_id")
        if not stream_id:
            raise JsonRpcError.invalid_params("Missing required param: stream_id")

        # Find the stream in all sessions
        for session_id in self._session_manager.list_sessions():
            ctx = await self._session_manager.get_session(session_id)
            if ctx is None:
                continue
            stream_ctx = ctx.get_stream(stream_id)
            if stream_ctx is not None:
                stream_ctx.active = False
                ctx.close_stream(stream_id)
                return {"stream_id": stream_id, "cancelled": True}

        raise JsonRpcError.session_not_found(f"Stream not found: {stream_id}")

    async def _rpc_session_execute(self, params: dict[str, Any]) -> dict[str, Any]:
        """Execute a prompt in the session context (non-streaming).

        Params:
            session_id: Session ID
            prompt: The user prompt to execute
            max_turns: Optional max turns limit
        """
        session_id = params.get("session_id")
        if not session_id:
            raise JsonRpcError.invalid_params("Missing required param: session_id")
        ctx = await self._session_manager.get_session(session_id)
        if ctx is None:
            raise JsonRpcError.session_not_found(session_id)

        prompt = params.get("prompt", "")
        max_turns = params.get("max_turns")

        # For now, return a placeholder response
        # Full implementation in Phase 3
        return {
            "session_id": session_id,
            "prompt": prompt,
            "status": "not_implemented",
            "message": "Use session.stream for streaming execution",
        }

    async def _rpc_stream_events(self, params: dict[str, Any]) -> dict[str, Any]:
        """Pull accumulated stream events for a given stream_id.

        This is a notification-style method - it returns immediately
        with any queued events, and the caller should poll or await
        the stream completion.
        """
        stream_id = params.get("stream_id")
        if not stream_id:
            raise JsonRpcError.invalid_params("Missing required param: stream_id")

        # Find the stream
        for session_id in self._session_manager.list_sessions():
            ctx = await self._session_manager.get_session(session_id)
            if ctx is None:
                continue
            stream_ctx = ctx.get_stream(stream_id)
            if stream_ctx is not None:
                events = []
                while not stream_ctx.queue.empty():
                    event = stream_ctx.queue.get_nowait()
                    if event is None:
                        break
                    events.append(event)
                return {
                    "stream_id": stream_id,
                    "events": events,
                    "active": stream_ctx.active,
                }

        return {
            "stream_id": stream_id,
            "events": [],
            "active": False,
            "error": "Stream not found",
        }

    # -------------------------------------------------------------------------
    # Permission methods
    # -------------------------------------------------------------------------

    async def _rpc_permission_check(self, params: dict[str, Any]) -> dict[str, Any]:
        """Check if a tool invocation is allowed.

        Params:
            tool_name: Name of the tool to check
            tool_args: Optional tool arguments for path-based checks
        """
        tool_name = params.get("tool_name")
        if not tool_name:
            raise JsonRpcError.invalid_params("Missing required param: tool_name")

        command = None
        if tool_name.lower() == "bash":
            args = params.get("tool_args") or params.get("tool_input") or {}
            command = args.get("command")

        decision = self._permission_checker.evaluate(
            tool_name,
            command=command,
        )
        return {
            "tool_name": tool_name,
            "allowed": decision.allowed,
            "requires_confirmation": decision.requires_confirmation,
            "reason": decision.reason,
            "mode": self._permission_checker._settings.mode.value,
        }

    async def _rpc_permission_set_mode(self, params: dict[str, Any]) -> dict[str, Any]:
        """Set the permission mode.

        Params:
            mode: One of "default", "plan", "full_auto"
        """
        mode_str = params.get("mode")
        if not mode_str:
            raise JsonRpcError.invalid_params("Missing required param: mode")

        try:
            mode = PermissionMode(mode_str)
        except ValueError:
            raise JsonRpcError.invalid_params(
                f"Invalid mode: {mode_str}. Must be one of: default, plan, full_auto"
            )

        self._permission_checker.update_mode(mode)
        return {
            "mode": mode.value,
            "changed": True,
        }

    async def _rpc_permission_get_mode(self, params: dict[str, Any]) -> dict[str, Any]:
        """Get the current permission mode."""
        return {
            "mode": self._permission_checker._settings.mode.value,
        }

    # -------------------------------------------------------------------------
    # Metrics methods
    # -------------------------------------------------------------------------

    async def _rpc_metrics_get(self, params: dict[str, Any]) -> dict[str, Any]:
        """Get current metrics snapshot."""
        return self._metrics.get_snapshot()

    async def _rpc_metrics_reset(self, params: dict[str, Any]) -> dict[str, Any]:
        """Reset all metrics counters."""
        self._metrics.reset()
        return {"reset": True}

    # -------------------------------------------------------------------------
    # Command methods
    # -------------------------------------------------------------------------

    async def _rpc_command_execute(self, params: dict[str, Any]) -> dict[str, Any]:
        """Execute a slash command.

        Params:
            command: The command string (e.g. "/help" or "/model claude-opus-4")
            session_id: Optional session ID for context
        """
        command_str = params.get("command")
        if not command_str:
            raise JsonRpcError.invalid_params("Missing required param: command")
        if not command_str.startswith("/"):
            raise JsonRpcError.invalid_params("Command must start with /")

        from oh_flow.commands import CommandRegistry

        registry = CommandRegistry.get_default()
        parsed = registry.parse(command_str)
        if parsed is None:
            return {
                "success": False,
                "error": "Not a slash command",
            }

        cmd_name, args = parsed
        cmd = registry.get(cmd_name)
        if cmd is None:
            raise JsonRpcError.invalid_params(f"Unknown command: /{cmd_name}")

        session_id = params.get("session_id")
        context: dict[str, Any] = {
            "permission_mode": self._permission_checker._settings.mode.value,
        }
        if session_id:
            ctx = await self._session_manager.get_session(session_id)
            if ctx:
                context["session_id"] = session_id

        result = await cmd.execute(args, context)
        return {
            "command": cmd_name,
            "success": result.success,
            "output": result.output,
            "error": result.error,
            "data": result.data,
        }

    async def _rpc_command_list(self, params: dict[str, Any]) -> dict[str, Any]:
        """List all available commands."""
        from oh_flow.commands import CommandRegistry

        registry = CommandRegistry.get_default()
        commands = []
        for name in registry.list_commands():
            cmd = registry.get(name)
            if cmd:
                commands.append({
                    "name": cmd.name,
                    "description": cmd.description,
                    "usage": cmd.usage,
                    "aliases": cmd.aliases,
                })
        return {"commands": commands, "count": len(commands)}

    async def _rpc_command_help(self, params: dict[str, Any]) -> dict[str, Any]:
        """Get help for a specific command."""
        from oh_flow.commands import CommandRegistry

        registry = CommandRegistry.get_default()
        cmd_name = params.get("command", "").lstrip("/")

        if not cmd_name:
            # Return general help
            return await self._rpc_command_list(params)

        cmd = registry.get(cmd_name)
        if cmd is None:
            return {
                "error": f"Unknown command: /{cmd_name}",
            }
        return {
            "name": cmd.name,
            "description": cmd.description,
            "usage": cmd.usage,
            "aliases": cmd.aliases,
        }

    # -------------------------------------------------------------------------
    # Socket I/O
    # -------------------------------------------------------------------------

    async def _handle_client(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        """Handle a connected client."""
        client_addr = writer.get_extra_info("sockname")
        log.debug(f"Client connected: {client_addr}")

        buffer = b""
        try:
            while True:
                chunk = await reader.read(self._read_buffer_size)
                if not chunk:
                    # Client disconnected
                    break

                buffer += chunk

                # Process complete JSON messages (newline-delimited JSON)
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if not line.strip():
                        continue

                    # Set current writer (kept across awaits for background tasks)
                    self._current_writer = writer
                    await self._process_message(line)

        except asyncio.CancelledError:
            log.debug(f"Client disconnected (cancelled): {client_addr}")
        except Exception as exc:
            log.error(f"Client handler error: {exc}", exc_info=True)
        finally:
            writer.close()
            await writer.wait_closed()
            log.debug(f"Client disconnected: {client_addr}")

    async def _process_message(
        self,
        raw: bytes,
    ) -> None:
        """Process a single JSON-RPC message (request or batch)."""
        writer = self._current_writer
        if writer is None:
            return
        parsed = self._protocol.parse(raw)

        # Handle mixed results (some errors, some valid)
        requests: list[JsonRpcRequest] = []
        error_responses: list[JsonRpcResponse] = []

        for item in parsed:
            if isinstance(item, JsonRpcError):
                error_responses.append(
                    JsonRpcResponse.error_response(item, id=None)
                )
            else:
                requests.append(item)

        # Process valid requests
        responses: list[JsonRpcResponse] = []
        for req in requests:
            response = await self._dispatch_request(req)
            if response is not None:
                responses.append(response)

        # Send error responses first
        for resp in error_responses:
            data = self._protocol.serialize_response(resp)
            writer.write(data)
            await writer.drain()

        # Then send normal responses
        for resp in responses:
            data = self._protocol.serialize_response(resp)
            writer.write(data)
            await writer.drain()

    async def _dispatch_request(self, request: JsonRpcRequest) -> JsonRpcResponse | None:
        """Dispatch a JSON-RPC request to the appropriate handler.

        Returns None for notifications (no response expected).
        """
        # Notifications have no id - don't send a response
        is_notification = request.id is None

        # Validate request
        if not self._protocol.validate_request_id(request.id):
            return JsonRpcResponse.error_response(
                JsonRpcError.invalid_request("Invalid id type"),
                id=None,
            )

        # Look up method
        handler = get_method(request.method)
        if handler is None:
            return JsonRpcResponse.error_response(
                JsonRpcError.method_not_found(request.method),
                id=request.id,
            )

        # Execute method
        import time as time_module
        start = time_module.perf_counter()
        try:
            params = request.params or {}

            if isinstance(params, list):
                result = await handler(*params)
            else:
                result = await handler(params)

            latency_ms = (time_module.perf_counter() - start) * 1000
            self._metrics.record_method_call(request.method, latency_ms, error=False)

            if is_notification:
                return None
            return JsonRpcResponse.success(result, id=request.id)

        except JsonRpcError as exc:
            latency_ms = (time_module.perf_counter() - start) * 1000
            self._metrics.record_method_call(request.method, latency_ms, error=True)
            self._metrics.record_error(exc.code, request.method)
            if is_notification:
                return None
            return JsonRpcResponse.error_response(exc, id=request.id)

        except asyncio.TimeoutError:
            latency_ms = (time_module.perf_counter() - start) * 1000
            self._metrics.record_method_call(request.method, latency_ms, error=True)
            self._metrics.record_error(ERROR_TIMEOUT, request.method)
            if is_notification:
                return None
            return JsonRpcResponse.error_response(
                JsonRpcError.timeout(),
                id=request.id,
            )

        except Exception as exc:
            latency_ms = (time_module.perf_counter() - start) * 1000
            self._metrics.record_method_call(request.method, latency_ms, error=True)
            log.error(f"Method {request.method} raised: {exc}", exc_info=True)
            if is_notification:
                return None
            return JsonRpcResponse.error_response(
                JsonRpcError.internal_error(str(exc)),
                id=request.id,
            )

    # -------------------------------------------------------------------------
    # Server lifecycle
    # -------------------------------------------------------------------------

    async def serve(self) -> None:
        """Start the socket server and run until shutdown."""
        if self._started:
            raise RuntimeError("Server is already running")

        # Ensure socket directory exists
        self._socket_path.parent.mkdir(parents=True, exist_ok=True)

        # Remove existing socket file
        if self._socket_path.exists():
            self._socket_path.unlink()

        # Create and start server
        self._server = await asyncio.start_unix_server(
            self._handle_client,
            path=str(self._socket_path),
        )
        # Set socket permissions (only owner can access)
        self._socket_path.chmod(0o600)
        self._started = True
        log.info(f"Socket server listening on {self._socket_path}")

        # Set up signal handlers for graceful shutdown
        loop = asyncio.get_running_loop()
        _shutdown_task: asyncio.Task | None = None

        def _signal_callback() -> None:
            nonlocal _shutdown_task
            log.info(f"Shutdown signal received")
            if _shutdown_task is None:
                _shutdown_task = asyncio.create_task(self._async_shutdown())

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, _signal_callback)
            except NotImplementedError:
                # Windows doesn't support add_signal_handler
                pass

        # Wait for shutdown
        await self._shutdown_event.wait()

    async def _async_shutdown(self) -> None:
        """Handle shutdown signals."""
        log.info("Shutdown signal received")
        await self.shutdown()

    async def shutdown(self) -> None:
        """Gracefully shut down the server."""
        if not self._started:
            return

        log.info("Shutting down socket server...")

        # Close all sessions
        for session_id in list(self._session_manager.list_sessions()):
            await self._session_manager.close_session(session_id)

        # Close server
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

        self._started = False
        self._shutdown_event.set()

        # Remove socket file
        if self._socket_path.exists():
            self._socket_path.unlink()

        log.info("Socket server shut down complete")

    @property
    def is_running(self) -> bool:
        """Return True if the server is running."""
        return self._started

    @property
    def socket_path(self) -> Path:
        """Return the socket path."""
        return self._socket_path


# -------------------------------------------------------------------------
# CLI entry point
# -------------------------------------------------------------------------


async def run_server(socket_path: str | None = None) -> None:
    """Run the socket server as a standalone process."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] [oh-flow] %(name)s: %(message)s",
    )

    path = Path(socket_path) if socket_path else None
    server = SocketServer(socket_path=path)

    try:
        await server.serve()
    except KeyboardInterrupt:
        await server.shutdown()


if __name__ == "__main__":
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(run_server(path))
