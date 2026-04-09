"""Bash tool - execute shell commands."""

from __future__ import annotations

import asyncio
import shlex
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, Field

from oh_flow.tools.base import BaseTool, ToolExecutionContext, ToolResult


class BashToolInput(BaseModel):
    """Input schema for BashTool."""

    command: Annotated[str, Field(description="The shell command to execute")]
    timeout: Annotated[int | None, Field(default=30, description="Timeout in seconds")] = 30
    cwd: Annotated[str | None, Field(default=None, description="Working directory")] = None


class BashTool(BaseTool):
    """Execute a shell command and return its output."""

    name = "bash"
    description = "Execute a shell command and return stdout/stderr. Use for running scripts, git commands, file operations, etc."
    input_model = BashToolInput

    async def execute(
        self,
        arguments: BashToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        """Execute the bash command."""
        import signal

        cwd = Path(arguments.cwd) if arguments.cwd else context.cwd

        try:
            proc = await asyncio.create_subprocess_shell(
                arguments.command,
                cwd=str(cwd),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=arguments.timeout,
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                return ToolResult(
                    output=f"Command timed out after {arguments.timeout}s",
                    is_error=True,
                )

            stdout = stdout_bytes.decode('utf-8', errors='replace') if stdout_bytes else ""
            stderr = stderr_bytes.decode('utf-8', errors='replace') if stderr_bytes else ""

            if proc.returncode != 0:
                output = f"[exit {proc.returncode}]\n"
                if stderr:
                    output += f"STDERR:\n{stderr}\n"
                if stdout:
                    output += f"STDOUT:\n{stdout}"
                return ToolResult(output=output, is_error=True)
            else:
                output = stdout
                if stderr:
                    output += f"\n[stderr]: {stderr}"
                return ToolResult(output=output)
        except Exception as exc:  # pragma: no cover
            return ToolResult(output=f"Error: {exc}", is_error=True)

    def is_read_only(self, arguments: BashToolInput) -> bool:
        """Return True for read-only commands."""
        readonly_prefixes = (
            'git status', 'git log', 'git diff', 'git show', 'git branch',
            'ls ', 'cat ', 'head ', 'tail ', 'grep ', 'find ', 'wc ', 'du ',
            'pwd', 'echo ', 'which ', 'type ', 'env ', 'printenv',
        )
        cmd = arguments.command.strip()
        return any(cmd.startswith(p) for p in readonly_prefixes)
