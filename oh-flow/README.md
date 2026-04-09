# oh-flow

OpenHarness flow bridge - Python socket server providing JSON-RPC 2.0 communication for the OpenHarness agent framework.

## Overview

`oh-flow` is a lightweight Python bridge that provides Unix domain socket-based JSON-RPC 2.0 communication for OpenHarness. It enables the TypeScript/Node.js frontend to communicate with Python backend services through a well-defined protocol.

## Architecture

```
oh-flow/
├── bridge/
│   ├── socket_server.py  # AsyncIO Unix socket server
│   ├── protocol.py       # JSON-RPC 2.0 protocol handler
│   ├── types.py          # Bridge configuration types
│   ├── work_secret.py    # Work secret encoding/decoding
│   └── session_runner.py # Bridge session spawning
├── engine/
│   ├── query.py          # Core tool-aware query loop
│   ├── query_engine.py   # High-level conversation engine
│   ├── messages.py       # Conversation message models
│   └── stream_events.py  # Streaming event types
├── tools/
│   └── base.py           # Tool abstractions and registry
├── permissions/
│   └── checker.py        # Permission checking
├── state/
│   └── app_state.py      # Application state management
└── hooks/
    └── __init__.py       # Lifecycle event hooks
```

## JSON-RPC Methods

### Bridge Methods
- `bridge.list_sessions` - List all active sessions
- `bridge.get_session` - Get session details
- `bridge.ping` - Health check

### Session Methods
- `session.create` - Create a new session
- `session.close` - Close a session
- `session.list` - List all sessions
- `session.stream` - Start a streaming session

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | Parse Error | Invalid JSON |
| -32600 | Invalid Request | Invalid JSON-RPC request |
| -32601 | Method Not Found | Unknown method |
| -32602 | Invalid Params | Invalid method parameters |
| -32603 | Internal Error | Internal server error |
| -32001 | Server Startup Failed | Server failed to start |
| -32002 | Session Not Found | Unknown session ID |
| -32003 | Session Already Exists | Session ID collision |
| -32004 | Execution Failed | Method execution error |
| -32005 | Tool Not Found | Unknown tool name |

## Usage

```python
import asyncio
from oh_flow.bridge import SocketServer

async def main():
    server = SocketServer(socket_path="/tmp/bridge.sock")
    await server.serve()

asyncio.run(main())
```

## Protocol

Communication is newline-delimited JSON over a Unix domain socket.

### Request
```json
{"jsonrpc": "2.0", "method": "bridge.ping", "id": 1}
```

### Response
```json
{"jsonrpc": "2.0", "result": {"status": "ok"}, "id": 1}
```

### Error Response
```json
{"jsonrpc": "2.0", "error": {"code": -32601, "message": "Method not found"}, "id": 1}
```

### Streaming Events
```
{"jsonrpc": "2.0", "method": "stream/event", "params": {"stream_id": "abc123", "data": {...}}}
{"jsonrpc": "2.0", "method": "stream/end", "params": {"stream_id": "abc123"}}
```
