"""Input guardrails (Arch §18 prompt-injection controls).

Deliberately conservative heuristics: they catch common injection phrasing and
oversized input. Mode ``flag`` records the finding in the execution context and
audit log; ``block`` rejects the request. Plug a model-based classifier in by
implementing ``Guardrail``.
"""

from __future__ import annotations

import re
from typing import Protocol

from pydantic import BaseModel, Field

from ai_core.errors import GuardrailViolation

INJECTION_PATTERNS = [
    r"ignore (all |any |the )?(previous|prior|above) (instructions|prompts|rules)",
    r"disregard (all |the )?(previous|prior|above|system)",
    r"(reveal|print|show|repeat) (me )?(your|the) (system|hidden|initial) (prompt|instructions)",
    r"you are now (?:in )?(developer|dan|jailbreak)",
    r"act as (an? )?(unrestricted|unfiltered)",
    r"<\s*/?\s*(system|assistant)\s*>",
    r"\bBEGIN (SYSTEM|ADMIN) PROMPT\b",
]


class GuardrailFinding(BaseModel):
    guardrail: str
    severity: str = "medium"
    message: str
    matches: list[str] = Field(default_factory=list)


class Guardrail(Protocol):
    name: str

    def check(self, text: str) -> list[GuardrailFinding]: ...


class PromptInjectionGuardrail:
    name = "prompt-injection"

    def __init__(self, patterns: list[str] | None = None) -> None:
        self._patterns = [re.compile(p, re.IGNORECASE) for p in (patterns or INJECTION_PATTERNS)]

    def check(self, text: str) -> list[GuardrailFinding]:
        matches = [m.group(0) for p in self._patterns if (m := p.search(text))]
        if not matches:
            return []
        return [
            GuardrailFinding(
                guardrail=self.name,
                severity="high",
                message="Possible prompt-injection attempt",
                matches=matches,
            )
        ]


class LengthGuardrail:
    name = "max-length"

    def __init__(self, max_chars: int) -> None:
        self.max_chars = max_chars

    def check(self, text: str) -> list[GuardrailFinding]:
        if len(text) <= self.max_chars:
            return []
        return [
            GuardrailFinding(
                guardrail=self.name,
                severity="high",
                message=f"Message exceeds {self.max_chars} characters",
            )
        ]


class GuardrailService:
    def __init__(self, mode: str, guardrails: list[Guardrail]) -> None:
        self.mode = mode
        self.guardrails = guardrails

    def inspect(self, text: str) -> list[GuardrailFinding]:
        if self.mode == "off":
            return []
        findings: list[GuardrailFinding] = []
        for g in self.guardrails:
            findings.extend(g.check(text))
        # Length is always enforced, independent of mode.
        hard = [f for f in findings if f.guardrail == "max-length"]
        if hard or (self.mode == "block" and findings):
            raise GuardrailViolation(
                "; ".join(f.message for f in (hard or findings)),
                details={"findings": [f.model_dump() for f in findings]},
            )
        return findings
