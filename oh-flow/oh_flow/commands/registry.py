"""Command registry for /slash commands."""

from __future__ import annotations

import asyncio
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class CommandResult:
    """Result of a command execution."""

    success: bool
    output: str = ""
    error: str = ""
    data: dict[str, Any] | None = None


class Command(ABC):
    """Base class for slash commands."""

    name: str
    description: str
    aliases: list[str] = field(default_factory=list)
    usage: str = ""

    @abstractmethod
    async def execute(self, args: str, context: dict[str, Any]) -> CommandResult:
        """Execute the command with the given arguments."""

    def matches(self, name: str) -> bool:
        """Check if this command matches the given name."""
        return name == self.name or name in self.aliases


@dataclass
class ExitCommand(Command):
    """Exit the session."""

    name = "exit"
    description = "Exit the current session"
    aliases = ["quit", "q"]
    usage = "/exit"

    async def execute(self, args: str, context: dict[str, Any]) -> CommandResult:
        return CommandResult(
            success=True,
            output="Goodbye!",
            data={"action": "exit"},
        )


@dataclass
class CompactCommand(Command):
    """Compact the conversation context."""

    name = "compact"
    description = "Compact the conversation history to reduce context"
    aliases = ["summarize"]
    usage = "/compact [reason]"

    async def execute(self, args: str, context: dict[str, Any]) -> CommandResult:
        return CommandResult(
            success=True,
            output=f"Context compacted.{f' Reason: {args}' if args else ''}",
            data={"action": "compact", "reason": args},
        )


@dataclass
class ModelCommand(Command):
    """Switch or show the current model."""

    name = "model"
    description = "Show or switch the current model"
    aliases = ["model"]
    usage = "/model [model-name]"

    async def execute(self, args: str, context: dict[str, Any]) -> CommandResult:
        current = context.get("model", "claude-opus-4")
        if not args:
            return CommandResult(success=True, output=f"Current model: {current}")
        # Validate model name
        valid_models = ["claude-opus-4", "claude-sonnet-4", "claude-haiku-3"]
        if args.lower() not in valid_models:
            return CommandResult(
                success=False,
                error=f"Unknown model: {args}. Valid: {', '.join(valid_models)}",
            )
        return CommandResult(
            success=True,
            output=f"Switched from {current} to {args}",
            data={"action": "model_switch", "model": args, "previous": current},
        )


@dataclass
class HelpCommand(Command):
    """Show help for commands."""

    name = "help"
    description = "Show help for all commands or a specific command"
    aliases = ["?"]
    usage = "/help [command]"

    async def execute(self, args: str, context: dict[str, Any]) -> CommandResult:
        from oh_flow.commands import CommandRegistry

        registry = CommandRegistry()
        if args:
            cmd = registry.get(args.lstrip("/"))
            if cmd is None:
                return CommandResult(success=False, error=f"Unknown command: /{args}")
            output = f"/{cmd.name} - {cmd.description}\nUsage: {cmd.usage}"
        else:
            lines = ["Available commands:"]
            for cmd_name in registry.list_commands():
                cmd = registry.get(cmd_name)
                if cmd:
                    lines.append(f"  /{cmd.name:<12} {cmd.description}")
            lines.append("\nType /help <command> for detailed usage.")
            output = "\n".join(lines)
        return CommandResult(success=True, output=output)


@dataclass
class ClearCommand(Command):
    """Clear the conversation."""

    name = "clear"
    description = "Clear the conversation history"
    aliases = ["reset"]
    usage = "/clear"

    async def execute(self, args: str, context: dict[str, Any]) -> CommandResult:
        return CommandResult(
            success=True,
            output="Conversation cleared.",
            data={"action": "clear"},
        )


@dataclass
class PermissionCommand(Command):
    """Show or change permission mode."""

    name = "permission"
    description = "Show or change permission mode (default/plan/full_auto)"
    aliases = ["perms", "perm"]
    usage = "/permission [mode]"

    async def execute(self, args: str, context: dict[str, Any]) -> CommandResult:
        if not args:
            mode = context.get("permission_mode", "default")
            return CommandResult(
                success=True,
                output=f"Current permission mode: {mode}",
            )
        valid_modes = ["default", "plan", "full_auto"]
        if args not in valid_modes:
            return CommandResult(
                success=False,
                error=f"Invalid mode: {args}. Valid: {', '.join(valid_modes)}",
            )
        return CommandResult(
            success=True,
            output=f"Permission mode changed to: {args}",
            data={"action": "permission_mode", "mode": args},
        )


@dataclass
class ContextCommand(Command):
    """Show context usage information."""

    name = "context"
    description = "Show current context usage and limits"
    aliases = ["ctx"]
    usage = "/context"

    async def execute(self, args: str, context: dict[str, Any]) -> CommandResult:
        messages = context.get("message_count", 0)
        tokens = context.get("token_estimate", 0)
        max_tokens = context.get("max_tokens", 200000)
        return CommandResult(
            success=True,
            output=f"Context: ~{messages} messages, ~{tokens} tokens (limit: {max_tokens})",
        )


class CommandRegistry:
    """Registry for slash commands."""

    _instance: "CommandRegistry | None" = None

    def __init__(self) -> None:
        self._commands: dict[str, Command] = {}
        self._register_builtins()

    def _register_builtins(self) -> None:
        """Register all built-in commands."""
        builtins: list[Command] = [
            ExitCommand(),
            CompactCommand(),
            ModelCommand(),
            HelpCommand(),
            ClearCommand(),
            PermissionCommand(),
            ContextCommand(),
        ]
        for cmd in builtins:
            self._commands[cmd.name] = cmd
            for alias in cmd.aliases:
                self._commands[alias] = cmd

    @classmethod
    def get_default(cls) -> "CommandRegistry":
        """Get the default registry instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def register(self, command: Command) -> None:
        """Register a command."""
        self._commands[command.name] = command
        for alias in command.aliases:
            self._commands[alias] = command

    def get(self, name: str) -> Command | None:
        """Get a command by name or alias."""
        return self._commands.get(name)

    def list_commands(self) -> list[str]:
        """List all registered command names (excluding aliases)."""
        # Return unique command names (not aliases pointing to the same command)
        seen: set[str] = set()
        unique: list[str] = []
        for name in self._commands:
            cmd = self._commands[name]
            if cmd.name not in seen:
                seen.add(cmd.name)
                unique.append(cmd.name)
        return unique

    def list_all(self) -> list[Command]:
        """List all registered commands."""
        return [self.get(name) for name in self.list_commands()]

    def parse(self, input_str: str) -> tuple[str, str] | None:
        """Parse a command string into (command_name, args).

        Handles:
        - /command args
        - /command
        - non-slash input (returns None)
        """
        input_str = input_str.strip()
        if not input_str.startswith("/"):
            return None
        # Split on whitespace, but preserve args that might contain quoted strings
        parts = input_str[1:].split(None, 1)
        return (parts[0], parts[1] if len(parts) > 1 else "")
