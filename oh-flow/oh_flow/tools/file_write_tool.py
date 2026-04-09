"""FileWrite tool - write content to files."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, Field

from oh_flow.tools.base import BaseTool, ToolExecutionContext, ToolResult


class FileWriteToolInput(BaseModel):
    """Input schema for FileWriteTool."""

    path: Annotated[str, Field(description="Absolute or relative path to the file to write")]
    content: Annotated[str, Field(description="Content to write to the file")]
    append: Annotated[bool, Field(default=False, description="Append to file instead of overwriting")] = False


class FileWriteTool(BaseTool):
    """Write content to a file."""

    name = "file_write"
    description = "Write content to a file. Creates parent directories if needed. Use append=true to append instead of overwrite."
    input_model = FileWriteToolInput

    async def execute(
        self,
        arguments: FileWriteToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        """Write the file."""
        try:
            file_path = Path(arguments.path)
            if not file_path.is_absolute():
                file_path = context.cwd / file_path
            file_path = file_path.resolve()

            file_path.parent.mkdir(parents=True, exist_ok=True)

            mode = 'a' if arguments.append else 'w'
            with file_path.open(mode, encoding='utf-8') as f:
                f.write(arguments.content)

            action = "Appended to" if arguments.append else "Written to"
            size = len(arguments.content)
            return ToolResult(output=f"{action} {file_path} ({size} chars)")
        except PermissionError:
            return ToolResult(output=f"Permission denied: {arguments.path}", is_error=True)
        except Exception as exc:  # pragma: no cover
            return ToolResult(output=f"Error writing file: {exc}", is_error=True)

    def is_read_only(self, arguments: FileWriteToolInput) -> bool:
        """Always writes, never read-only."""
        return False
