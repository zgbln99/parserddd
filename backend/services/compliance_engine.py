"""Bridge to the TypeScript compliance engine.

The engine is a deterministic Node.js process invoked via JSON over stdio.
This module hides the subprocess plumbing behind a small, typed-ish API:

    engine = ComplianceEngine()
    result = engine.evaluate(payload)
    report = engine.report(result, locale="pl")

Both methods raise ``ComplianceEngineError`` on engine failure with the
captured stderr attached. The engine is stateless — every call is
self-contained — so the wrapper is safe to call from request handlers.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RULES_ROOT = REPO_ROOT / "rules"
DEFAULT_DIST = REPO_ROOT / "src" / "compliance" / "dist"
DEFAULT_CLI = DEFAULT_DIST / "cli" / "engine-cli.js"


class ComplianceEngineError(RuntimeError):
    """Raised when the Node.js engine exits non-zero or returns invalid JSON."""

    def __init__(self, message: str, *, stderr: str = "", exit_code: int | None = None):
        super().__init__(message)
        self.stderr = stderr
        self.exit_code = exit_code


@dataclass(frozen=True)
class ComplianceEngineConfig:
    """Where to find the Node binary and the compiled engine entry point."""

    node_bin: str
    cli_entry: Path
    rules_root: Path
    timeout_seconds: float

    @classmethod
    def from_env(cls) -> "ComplianceEngineConfig":
        node_bin = os.environ.get("COMPLIANCE_NODE_BIN") or shutil.which("node") or "node"
        cli_entry = Path(os.environ.get("COMPLIANCE_CLI_ENTRY", str(DEFAULT_CLI)))
        rules_root = Path(os.environ.get("COMPLIANCE_RULES_ROOT", str(DEFAULT_RULES_ROOT)))
        timeout = float(os.environ.get("COMPLIANCE_TIMEOUT_SECONDS", "30"))
        return cls(node_bin=node_bin, cli_entry=cli_entry, rules_root=rules_root, timeout_seconds=timeout)


class ComplianceEngine:
    """Thin Python facade around ``node dist/cli/engine-cli.js``."""

    def __init__(self, config: ComplianceEngineConfig | None = None):
        self.config = config or ComplianceEngineConfig.from_env()

    # ----- public API ----------------------------------------------------

    def evaluate(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        """Run the ``evaluate`` command.

        ``payload`` should match the engine input shape. ``rules_root`` is
        injected automatically when not supplied, so callers don't need to
        know where the YAML pack lives.
        """
        full_payload = dict(payload)
        full_payload.setdefault("rules_root", str(self.config.rules_root))
        return self._invoke(["evaluate"], full_payload)

    def report(
        self,
        evaluation_result: Mapping[str, Any],
        *,
        locale: str = "de",
    ) -> dict[str, Any]:
        """Build a localized PDF-ready report from an evaluation result."""
        if locale not in {"de", "en", "pl"}:
            raise ValueError(f"unsupported locale: {locale!r}")
        return self._invoke(["report", f"--locale={locale}"], evaluation_result)

    # ----- internals -----------------------------------------------------

    def _invoke(self, args: list[str], payload: Mapping[str, Any]) -> dict[str, Any]:
        if not self.config.cli_entry.exists():
            raise ComplianceEngineError(
                f"engine entry not found at {self.config.cli_entry} — did you run `npm run build`?",
            )
        cmd = [self.config.node_bin, str(self.config.cli_entry), *args]
        try:
            proc = subprocess.run(
                cmd,
                input=json.dumps(payload, default=_json_default),
                capture_output=True,
                text=True,
                timeout=self.config.timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            raise ComplianceEngineError(
                f"engine timeout after {self.config.timeout_seconds}s",
                stderr=str(exc.stderr or ""),
            ) from exc
        except FileNotFoundError as exc:
            raise ComplianceEngineError(
                f"node binary not executable: {self.config.node_bin}",
            ) from exc

        if proc.returncode != 0:
            raise ComplianceEngineError(
                f"engine exited with code {proc.returncode}",
                stderr=proc.stderr,
                exit_code=proc.returncode,
            )
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise ComplianceEngineError(
                f"engine returned non-JSON output: {exc}",
                stderr=proc.stderr,
            ) from exc


def _json_default(value: Any) -> Any:
    """Allow datetime / Path inside payloads to serialize cleanly."""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"object of type {type(value).__name__} is not JSON-serializable")


__all__ = [
    "ComplianceEngine",
    "ComplianceEngineConfig",
    "ComplianceEngineError",
    "DEFAULT_CLI",
    "DEFAULT_RULES_ROOT",
]
