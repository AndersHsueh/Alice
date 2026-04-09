"""JSON-RPC 2.0 protocol handler for the OpenHarness bridge.

Implements the JSON-RPC 2.0 specification:
https://www.jsonrpc.org/specification

This module handles:
- Request parsing and validation
- Response/error serialization
- Error code definitions (-32600 ~ -32000)
- Streaming event framing
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator
import asyncio

log = logging.getLogger(__name__)


# JSON-RPC error codes
ERROR_PARSE_ERROR = -32700
ERROR_INVALID_REQUEST = -32600
ERROR_METHOD_NOT_FOUND = -32601
ERROR_INVALID_PARAMS = -32602
ERROR_INTERNAL_ERROR = -32603

# Transport-specific error codes (server-side)
ERROR_SERVER_STARTUP_FAILED = -32001
ERROR_SESSION_NOT_FOUND = -32002
ERROR_SESSION_ALREADY_EXISTS = -32003
ERROR_EXECUTION_FAILED = -32004
ERROR_TOOL_NOT_FOUND = -32005

# Reserved error codes (-32099 to -32000)
ERROR_TIMEOUT = -32099
ERROR_PERMISSION_DENIED = -32098
ERROR_STREAM_CLOSED = -32097
ERROR_BRIDGE_ERROR = -32096

JSONRPC_REQUEST_ID_NONE: int | str | None = None


def error_code_message(code: int) -> str:
    """Return a human-readable description for a JSON-RPC error code."""
    messages = {
        ERROR_PARSE_ERROR: "Parse error",
        ERROR_INVALID_REQUEST: "Invalid request",
        ERROR_METHOD_NOT_FOUND: "Method not found",
        ERROR_INVALID_PARAMS: "Invalid params",
        ERROR_INTERNAL_ERROR: "Internal error",
        ERROR_SERVER_STARTUP_FAILED: "Server startup failed",
        ERROR_SESSION_NOT_FOUND: "Session not found",
        ERROR_SESSION_ALREADY_EXISTS: "Session already exists",
        ERROR_EXECUTION_FAILED: "Execution failed",
        ERROR_TOOL_NOT_FOUND: "Tool not found",
        ERROR_TIMEOUT: "Operation timed out",
        ERROR_PERMISSION_DENIED: "Permission denied",
        ERROR_STREAM_CLOSED: "Stream closed",
        ERROR_BRIDGE_ERROR: "Bridge error",
    }
    return messages.get(code, "Unknown error")


@dataclass
class JsonRpcError(Exception):
    """JSON-RPC 2.0 error object."""

    code: int
    message: str
    data: Any = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to JSON-RPC error format."""
        result: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
        }
        if self.data is not None:
            result["data"] = self.data
        return result

    @classmethod
    def parse_error(cls, data: Any = None) -> "JsonRpcError":
        return cls(
            code=ERROR_PARSE_ERROR,
            message="Parse error: Invalid JSON was received",
            data=data,
        )

    @classmethod
    def invalid_request(cls, message: str = "The JSON sent is not a valid Request object", data: Any = None) -> "JsonRpcError":
        return cls(code=ERROR_INVALID_REQUEST, message=message, data=data)

    @classmethod
    def method_not_found(cls, method: str = "") -> "JsonRpcError":
        return cls(
            code=ERROR_METHOD_NOT_FOUND,
            message=f"Method not found: {method}" if method else "Method not found",
        )

    @classmethod
    def invalid_params(cls, message: str = "Invalid method parameter(s)", data: Any = None) -> "JsonRpcError":
        return cls(code=ERROR_INVALID_PARAMS, message=message, data=data)

    @classmethod
    def internal_error(cls, message: str = "Internal error", data: Any = None) -> "JsonRpcError":
        return cls(code=ERROR_INTERNAL_ERROR, message=message, data=data)

    @classmethod
    def session_not_found(cls, session_id: str = "") -> "JsonRpcError":
        return cls(
            code=ERROR_SESSION_NOT_FOUND,
            message=f"Session not found: {session_id}" if session_id else "Session not found",
        )

    @classmethod
    def session_already_exists(cls, session_id: str = "") -> "JsonRpcError":
        return cls(
            code=ERROR_SESSION_ALREADY_EXISTS,
            message=f"Session already exists: {session_id}" if session_id else "Session already exists",
        )

    @classmethod
    def execution_failed(cls, message: str = "Execution failed", data: Any = None) -> "JsonRpcError":
        return cls(code=ERROR_EXECUTION_FAILED, message=message, data=data)

    @classmethod
    def tool_not_found(cls, tool_name: str = "") -> "JsonRpcError":
        return cls(
            code=ERROR_TOOL_NOT_FOUND,
            message=f"Tool not found: {tool_name}" if tool_name else "Tool not found",
        )

    @classmethod
    def timeout(cls, message: str = "Operation timed out") -> "JsonRpcError":
        return cls(code=ERROR_TIMEOUT, message=message)

    @classmethod
    def permission_denied(cls, message: str = "Permission denied") -> "JsonRpcError":
        return cls(code=ERROR_PERMISSION_DENIED, message=message)

    @classmethod
    def stream_closed(cls) -> "JsonRpcError":
        return cls(code=ERROR_STREAM_CLOSED, message="Stream has been closed")


@dataclass
class JsonRpcRequest:
    """JSON-RPC 2.0 request object."""

    method: str
    jsonrpc: str = "2.0"
    id: int | str | None = None
    params: dict[str, Any] | list[Any] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "JsonRpcRequest":
        """Parse a dictionary into a JsonRpcRequest."""
        jsonrpc = data.get("jsonrpc", "2.0")
        if jsonrpc != "2.0":
            raise ValueError(f"Unsupported JSON-RPC version: {jsonrpc}")
        method = data.get("method")
        if not isinstance(method, str) or not method:
            raise ValueError("Missing or invalid 'method' field")
        return cls(
            jsonrpc=jsonrpc,
            method=method,
            id=data.get("id"),
            params=data.get("params"),
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize to JSON-RPC request format."""
        result: dict[str, Any] = {
            "jsonrpc": self.jsonrpc,
            "method": self.method,
        }
        if self.id is not None:
            result["id"] = self.id
        if self.params is not None:
            result["params"] = self.params
        return result


@dataclass
class JsonRpcResponse:
    """JSON-RPC 2.0 response object."""

    jsonrpc: str = "2.0"
    result: Any = None
    error: JsonRpcError | None = None
    id: int | str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to JSON-RPC response format."""
        out: dict[str, Any] = {
            "jsonrpc": self.jsonrpc,
        }
        if self.error is not None:
            out["error"] = self.error.to_dict()
        else:
            out["result"] = self.result
        if self.id is not None:
            out["id"] = self.id
        return out

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict())

    @classmethod
    def success(cls, result: Any, id: int | str | None = None) -> "JsonRpcResponse":
        """Create a successful response."""
        return cls(jsonrpc="2.0", result=result, id=id)

    @classmethod
    def error_response(cls, err: JsonRpcError, id: int | str | None = None) -> "JsonRpcResponse":
        """Create an error response."""
        return cls(jsonrpc="2.0", error=err, id=id)


class ProtocolHandler:
    """Handles JSON-RPC 2.0 message parsing and validation.

    Supports:
    - Single requests
    - Batch requests (array of requests)
    - Streaming event frames
    - Error response generation
    """

    def __init__(self) -> None:
        self._streaming_events: dict[str, AsyncIterator[str]] = {}

    def parse(self, raw: bytes | str) -> list[JsonRpcRequest | JsonRpcError]:
        """Parse raw input into JSON-RPC requests.

        Handles:
        - Single JSON objects
        - Batch arrays of JSON objects
        - Invalid JSON (returns parse error)
        - Invalid request objects (wrapped in error responses)

        Returns a list that may contain:
        - JsonRpcRequest objects for valid requests
        - JsonRpcError objects for parse errors or invalid request objects
        """
        results: list[JsonRpcRequest | JsonRpcError] = []

        # Step 1: Parse JSON
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            parsed = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            return [JsonRpcError.parse_error(str(exc))]

        # Step 2: Handle batch vs single
        if isinstance(parsed, list):
            # Batch request
            if not parsed:
                return [JsonRpcError.invalid_request("Batch array must not be empty")]
            for item in parsed:
                if not isinstance(item, dict):
                    results.append(JsonRpcError.invalid_request("Each batch item must be an object"))
                    continue
                try:
                    results.append(JsonRpcRequest.from_dict(item))
                except (ValueError, TypeError) as exc:
                    results.append(JsonRpcError.invalid_request(str(exc)))
        elif isinstance(parsed, dict):
            # Single request
            try:
                results.append(JsonRpcRequest.from_dict(parsed))
            except (ValueError, TypeError) as exc:
                results.append(JsonRpcError.invalid_request(str(exc)))
        else:
            return [JsonRpcError.invalid_request("Request must be a JSON object or array")]

        return results

    def serialize_response(self, response: JsonRpcResponse) -> bytes:
        """Serialize a JSON-RPC response to bytes."""
        return response.to_json().encode("utf-8") + b"\n"

    def serialize_batch_responses(self, responses: list[JsonRpcResponse]) -> bytes:
        """Serialize a batch of JSON-RPC responses to bytes."""
        batch = [r.to_dict() for r in responses]
        return json.dumps(batch).encode("utf-8") + b"\n"

    def serialize_error(self, error: JsonRpcError, request_id: int | str | None = None) -> bytes:
        """Serialize a JSON-RPC error to bytes."""
        response = JsonRpcResponse.error_response(error, id=request_id)
        return self.serialize_response(response)

    def serialize_notification(self, method: str, params: dict[str, Any] | None = None) -> bytes:
        """Serialize a JSON-RPC notification (request without id) to bytes."""
        request = JsonRpcRequest(jsonrpc="2.0", method=method, id=None, params=params)
        return json.dumps(request.to_dict()).encode("utf-8") + b"\n"

    def serialize_stream_event(self, stream_id: str, event_data: dict[str, Any]) -> bytes:
        """Serialize a streaming event frame.

        Event format: {"jsonrpc": "2.0", "method": "stream/event", "params": {"stream_id": "...", "data": {...}}}
        """
        msg = {
            "jsonrpc": "2.0",
            "method": "stream/event",
            "params": {
                "stream_id": stream_id,
                "data": event_data,
            },
        }
        return json.dumps(msg).encode("utf-8") + b"\n"

    def serialize_stream_end(self, stream_id: str, final_data: dict[str, Any] | None = None) -> bytes:
        """Serialize a stream completion marker."""
        msg: dict[str, Any] = {
            "jsonrpc": "2.0",
            "method": "stream/end",
            "params": {
                "stream_id": stream_id,
            },
        }
        if final_data is not None:
            msg["params"]["final_data"] = final_data
        return json.dumps(msg).encode("utf-8") + b"\n"

    def register_stream(self, stream_id: str, iterator: AsyncIterator[str]) -> None:
        """Register a streaming iterator for a given stream ID."""
        self._streaming_events[stream_id] = iterator

    def unregister_stream(self, stream_id: str) -> None:
        """Unregister a streaming iterator."""
        self._streaming_events.pop(stream_id, None)

    def has_stream(self, stream_id: str) -> bool:
        """Check if a stream is registered."""
        return stream_id in self._streaming_events

    def validate_request_id(self, request_id: Any) -> bool:
        """Validate that a request id is valid per JSON-RPC 2.0.

        Valid ids: string, number (including zero), null
        """
        if request_id is None:
            return True
        if isinstance(request_id, str):
            return len(request_id) > 0
        if isinstance(request_id, (int, float)):
            return True
        return False


# JSON-RPC 2.0 method registry
METHODS: dict[str, callable] = {}


def register_method(name: str) -> callable:
    """Decorator to register a JSON-RPC method handler."""
    def decorator(func: callable) -> callable:
        METHODS[name] = func
        return func
    return decorator


def get_method(name: str) -> callable | None:
    """Get a registered method handler by name."""
    return METHODS.get(name)
