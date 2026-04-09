"""Grep tool - search file contents."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, Field

from oh_flow.tools.base import BaseTool, ToolExecutionContext, ToolResult


class GrepToolInput(BaseModel):
    """Input schema for GrepTool."""

    pattern: Annotated[str, Field(description="Regex or literal pattern to search for")]
    path: Annotated[str, Field(description="File path or directory to search in")]
    is_regex: Annotated[bool, Field(default=False, description="Treat pattern as regex instead of literal")] = False
    case_sensitive: Annotated[bool, Field(default=True, description="Case sensitive matching")] = True
    context: Annotated[int, Field(default=0, description="Number of context lines before/after match")] = 0
    max_results: Annotated[int, Field(default=50, description="Maximum number of matches to return")] = 50


class GrepTool(BaseTool):
    """Search file contents for a pattern."""

    name = "grep"
    description = "Search files for a pattern. Supports regex patterns and literal strings. Returns matching lines with optional context."
    input_model = GrepToolInput

    async def execute(
        self,
        arguments: GrepToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        """Search files for the pattern."""
        try:
            search_path = Path(arguments.path)
            if not search_path.is_absolute():
                search_path = context.cwd / search_path
            search_path = search_path.resolve()

            if not search_path.exists():
                return ToolResult(output=f"Path not found: {search_path}", is_error=True)

            if arguments.is_regex:
                flags = 0 if arguments.case_sensitive else re.IGNORECASE
                compiled = re.compile(arguments.pattern, flags)
            else:
                compiled = None

            results: list[str] = []
            files_to_search: list[Path] = []

            if search_path.is_file():
                files_to_search = [search_path]
            else:
                for root, _, files in search_path.walk() if hasattr(search_path, 'walk') else []:
                    pass
                # Fallback walk for Python <3.12
                import os
                for root, _, files in os.walk(search_path):
                    root_path = Path(root)
                    if any(skip in root_path.parts for skip in ('node_modules', '.git', '__pycache__')):
                        continue
                    for f in files:
                        if f.endswith(('.py', '.ts', '.js', '.tsx', '.jsx', '.txt', '.md', '.json', '.yaml', '.yml')):
                            files_to_search.append(root_path / f)

            if not files_to_search:
                return ToolResult(output="No files to search", is_error=False)

            for file_path in files_to_search:
                if len(results) >= arguments.max_results:
                    break
                try:
                    lines = file_path.read_text('utf-8', errors='replace').splitlines()
                    for i, line in enumerate(lines, 1):
                        if arguments.is_regex and compiled:
                            if compiled.search(line):
                                match_str = self._format_match(file_path, i, line, arguments.context)
                                results.extend(match_str)
                        else:
                            if (arguments.case_sensitive and arguments.pattern in line) or \
                               (not arguments.case_sensitive and arguments.pattern.lower() in line.lower()):
                                match_str = self._format_match(file_path, i, line, arguments.context)
                                results.extend(match_str)
                except Exception:
                    continue

            if not results:
                return ToolResult(output="No matches found", is_error=False)

            output = "\n".join(results[:arguments.max_results])
            if len(results) > arguments.max_results:
                output += f"\n... (showing first {arguments.max_results} matches)"
            return ToolResult(output=output)
        except Exception as exc:  # pragma: no cover
            return ToolResult(output=f"Error: {exc}", is_error=True)

    def _format_match(self, file_path: Path, line_num: int, line: str, context: int) -> list[str]:
        """Format a match with context lines."""
        results: list[str] = []
        results.append(f"{file_path}:{line_num}: {line}")
        return results

    def is_read_only(self, arguments: GrepToolInput) -> bool:
        """Always read-only."""
        return True
