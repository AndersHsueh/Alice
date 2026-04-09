"""Metrics collector for the bridge server.

Collects operational metrics including:
- Method call counts and latencies
- Session statistics
- Tool execution statistics
- Stream statistics
- Error statistics
"""

from __future__ import annotations

import time
import threading
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


@dataclass
class MethodStats:
    """Statistics for a single method."""

    calls: int = 0
    errors: int = 0
    total_latency_ms: float = 0.0
    min_latency_ms: float = float("inf")
    max_latency_ms: float = 0.0

    @property
    def avg_latency_ms(self) -> float:
        return self.total_latency_ms / self.calls if self.calls > 0 else 0.0

    def record(self, latency_ms: float, error: bool = False) -> None:
        self.calls += 1
        if error:
            self.errors += 1
        self.total_latency_ms += latency_ms
        if latency_ms < self.min_latency_ms:
            self.min_latency_ms = latency_ms
        if latency_ms > self.max_latency_ms:
            self.max_latency_ms = latency_ms

    def to_dict(self) -> dict[str, Any]:
        return {
            "calls": self.calls,
            "errors": self.errors,
            "avg_latency_ms": round(self.avg_latency_ms, 3),
            "min_latency_ms": round(self.min_latency_ms, 3) if self.min_latency_ms != float("inf") else 0,
            "max_latency_ms": round(self.max_latency_ms, 3),
        }


@dataclass
class ToolStats:
    """Statistics for tool executions."""

    calls: int = 0
    successes: int = 0
    failures: int = 0
    total_latency_ms: float = 0.0
    by_tool: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def record(self, success: bool, latency_ms: float, tool_name: str) -> None:
        self.calls += 1
        if success:
            self.successes += 1
        else:
            self.failures += 1
        self.total_latency_ms += latency_ms
        self.by_tool[tool_name] += 1

    @property
    def avg_latency_ms(self) -> float:
        return self.total_latency_ms / self.calls if self.calls > 0 else 0.0

    @property
    def success_rate(self) -> float:
        return self.successes / self.calls if self.calls > 0 else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_calls": self.calls,
            "successes": self.successes,
            "failures": self.failures,
            "success_rate": round(self.success_rate, 4),
            "avg_latency_ms": round(self.avg_latency_ms, 3),
            "by_tool": dict(self.by_tool),
        }


@dataclass
class StreamStats:
    """Statistics for streaming sessions."""

    streams_started: int = 0
    streams_completed: int = 0
    streams_cancelled: int = 0
    total_events: int = 0
    active_streams: int = 0

    def record_start(self) -> None:
        self.streams_started += 1
        self.active_streams += 1

    def record_event(self) -> None:
        self.total_events += 1

    def record_complete(self) -> None:
        self.streams_completed += 1
        self.active_streams = max(0, self.active_streams - 1)

    def record_cancelled(self) -> None:
        self.streams_cancelled += 1
        self.active_streams = max(0, self.active_streams - 1)

    def to_dict(self) -> dict[str, Any]:
        return {
            "streams_started": self.streams_started,
            "streams_completed": self.streams_completed,
            "streams_cancelled": self.streams_cancelled,
            "active_streams": self.active_streams,
            "total_events": self.total_events,
        }


@dataclass
class ErrorStats:
    """Statistics for errors."""

    by_code: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    by_method: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def record(self, error_code: int, method: str) -> None:
        self.by_code[error_code] += 1
        self.by_method[method] += 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "by_code": {str(k): v for k, v in self.by_code.items()},
            "by_method": dict(self.by_method),
        }


@dataclass
class SessionStats:
    """Statistics for sessions."""

    created: int = 0
    closed: int = 0
    active: int = 0

    def record_create(self) -> None:
        self.created += 1
        self.active += 1

    def record_close(self) -> None:
        self.closed += 1
        self.active = max(0, self.active - 1)

    def to_dict(self) -> dict[str, Any]:
        return {
            "created": self.created,
            "closed": self.closed,
            "active": self.active,
        }


class MetricsCollector:
    """Central metrics collector for the bridge server.

    Thread-safe for collecting metrics from async and sync contexts.
    """

    _instance: "MetricsCollector | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._methods: dict[str, MethodStats] = defaultdict(MethodStats)
        self._tools = ToolStats()
        self._streams = StreamStats()
        self._errors = ErrorStats()
        self._sessions = SessionStats()
        self._start_time = time.time()
        self._mu = threading.Lock()

    @classmethod
    def get_instance(cls) -> "MetricsCollector":
        """Get the singleton metrics collector."""
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def reset(self) -> None:
        """Reset all counters."""
        with self._mu:
            self._methods.clear()
            self._tools = ToolStats()
            self._streams = StreamStats()
            self._errors = ErrorStats()
            self._sessions = SessionStats()
            self._start_time = time.time()

    def record_method_call(self, method: str, latency_ms: float, error: bool = False) -> None:
        """Record a method call."""
        with self._mu:
            self._methods[method].record(latency_ms, error)

    def record_tool_execution(
        self, tool_name: str, success: bool, latency_ms: float
    ) -> None:
        """Record a tool execution."""
        with self._mu:
            self._tools.record(success, latency_ms, tool_name)

    def record_stream_start(self) -> None:
        """Record a stream starting."""
        with self._mu:
            self._streams.record_start()

    def record_stream_event(self) -> None:
        """Record a stream event."""
        with self._mu:
            self._streams.record_event()

    def record_stream_complete(self) -> None:
        """Record a stream completing."""
        with self._mu:
            self._streams.record_complete()

    def record_stream_cancelled(self) -> None:
        """Record a stream being cancelled."""
        with self._mu:
            self._streams.record_cancelled()

    def record_error(self, error_code: int, method: str) -> None:
        """Record an error."""
        with self._mu:
            self._errors.record(error_code, method)

    def record_session_create(self) -> None:
        """Record a session being created."""
        with self._mu:
            self._sessions.record_create()

    def record_session_close(self) -> None:
        """Record a session being closed."""
        with self._mu:
            self._sessions.record_close()

    def get_snapshot(self) -> dict[str, Any]:
        """Get a snapshot of all metrics."""
        with self._mu:
            uptime = time.time() - self._start_time
            return {
                "uptime_seconds": round(uptime, 3),
                "methods": {m: s.to_dict() for m, s in self._methods.items()},
                "tools": self._tools.to_dict(),
                "streams": self._streams.to_dict(),
                "errors": self._errors.to_dict(),
                "sessions": self._sessions.to_dict(),
            }


def get_metrics_collector() -> MetricsCollector:
    """Return the global metrics collector instance."""
    return MetricsCollector.get_instance()


# Convenience decorator for timing async methods
import functools
import asyncio


def timed_method(method_name: str | None = None):
    """Decorator to automatically record method timing."""
    def decorator(func):
        name = method_name or func.__name__
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            collector = get_metrics_collector()
            start = time.perf_counter()
            error = False
            try:
                return await func(*args, **kwargs)
            except Exception:
                error = True
                raise
            finally:
                latency_ms = (time.perf_counter() - start) * 1000
                collector.record_method_call(name, latency_ms, error)
        return wrapper
    return decorator
