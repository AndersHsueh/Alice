"""Toolbox - register all core tools."""

from __future__ import annotations

from oh_flow.tools.base import ToolRegistry
from oh_flow.tools.bash_tool import BashTool
from oh_flow.tools.file_read_tool import FileReadTool
from oh_flow.tools.file_write_tool import FileWriteTool
from oh_flow.tools.glob_tool import GlobTool
from oh_flow.tools.grep_tool import GrepTool


def create_tool_registry() -> ToolRegistry:
    """Create a registry with all core tools registered."""
    registry = ToolRegistry()
    registry.register(BashTool())
    registry.register(FileReadTool())
    registry.register(FileWriteTool())
    registry.register(GlobTool())
    registry.register(GrepTool())
    return registry


# Default registry instance (lazy initialization)
_default_registry: ToolRegistry | None = None


def get_default_registry() -> ToolRegistry:
    """Return the default tool registry with all core tools."""
    global _default_registry
    if _default_registry is None:
        _default_registry = create_tool_registry()
    return _default_registry
