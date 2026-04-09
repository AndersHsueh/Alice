"""Glob tool - find files by pattern."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, Field

from oh_flow.tools.base import BaseTool, ToolExecutionContext, ToolResult


class GlobToolInput(BaseModel):
    """Input schema for GlobTool."""

    pattern: Annotated[str, Field(description="Glob pattern (e.g., **/*.py, src/**/*.ts)")]
    cwd: Annotated[str | None, Field(default=None, description="Directory to search in")] = None
    max_results: Annotated[int, Field(default=50, description="Maximum number of results to return")] = 50


class GlobTool(BaseTool):
    """Find files matching a glob pattern."""

    name = "glob"
    description = "Find files matching a glob pattern. Supports ** for recursive matching. Returns a list of matching file paths."
    input_model = GlobToolInput

    async def execute(
        self,
        arguments: GlobToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        """Find files matching the pattern."""
        try:
            search_dir = Path(arguments.cwd) if arguments.cwd else context.cwd
            if not search_dir.is_dir():
                return ToolResult(output=f"Not a directory: {search_dir}", is_error=True)

            matches: list[str] = []
            pattern = arguments.pattern

            for root, dirs, files in os.walk(search_dir):
                root_path = Path(root)

                # Skip common ignored directories
                dirs[:] = [d for d in dirs if d not in (
                    'node_modules', '.git', '__pycache__', '.pytest_cache',
                    'dist', 'build', '.venv', 'venv',
                )]

                # Match files against pattern
                if '**' in pattern:
                    from fnmatch import fnmatch
                    for file in files:
                        rel_path = str(root_path / file)
                        if fnmatch(rel_path, pattern) or fnmatch(file, pattern.split('**/')[-1]):
                            matches.append(rel_path)
                            if len(matches) >= arguments.max_results:
                                break
                else:
                    for file in files:
                        from fnmatch import fnmatch
                        if fnmatch(file, pattern):
                            matches.append(str(root_path / file))
                            if len(matches) >= arguments.max_results:
                                break

                if len(matches) >= arguments.max_results:
                    break

            if not matches:
                return ToolResult(output="No files found", is_error=False)

            output = "\n".join(matches)
            if len(matches) >= arguments.max_results:
                output += f"\n... (showing first {arguments.max_results} of many)"
            return ToolResult(output=output)
        except Exception as exc:  # pragma: no cover
            return ToolResult(output=f"Error: {exc}", is_error=True)

    def is_read_only(self, arguments: GlobToolInput) -> bool:
        """Always read-only."""
        return True
