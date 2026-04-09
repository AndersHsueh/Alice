"""FileRead tool - read file contents."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, Field

from oh_flow.tools.base import BaseTool, ToolExecutionContext, ToolResult


class FileReadToolInput(BaseModel):
    """Input schema for FileReadTool."""

    path: Annotated[str, Field(description="Absolute or relative path to the file to read")]
    offset: Annotated[int | None, Field(default=None, description="Line number to start reading from (0-based)")] = None
    limit: Annotated[int | None, Field(default=None, description="Maximum number of lines to read")] = None


class FileReadTool(BaseTool):
    """Read the contents of a file."""

    name = "file_read"
    description = "Read the contents of a file. Supports partial reads with offset and limit. Returns file contents or an error message."
    input_model = FileReadToolInput

    async def execute(
        self,
        arguments: FileReadToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        """Read the file."""
        try:
            file_path = Path(arguments.path)
            if not file_path.is_absolute():
                file_path = context.cwd / file_path
            file_path = file_path.resolve()

            if not file_path.exists():
                return ToolResult(output=f"File not found: {file_path}", is_error=True)
            if not file_path.is_file():
                return ToolResult(output=f"Not a file: {file_path}", is_error=True)

            content = file_path.read_text('utf-8', errors='replace')
            lines = content.splitlines(keepends=True)

            offset = arguments.offset if arguments.offset is not None else 0
            if offset < 0:
                offset = 0
            if offset >= len(lines):
                return ToolResult(output="<empty - offset past end of file>", is_error=False)

            if arguments.limit is not None and arguments.limit > 0:
                lines = lines[offset:offset + arguments.limit]
            else:
                lines = lines[offset:]

            return ToolResult(output=''.join(lines))
        except PermissionError:
            return ToolResult(output=f"Permission denied: {arguments.path}", is_error=True)
        except Exception as exc:  # pragma: no cover
            return ToolResult(output=f"Error reading file: {exc}", is_error=True)

    def is_read_only(self, arguments: FileReadToolInput) -> bool:
        """Always read-only."""
        return True
