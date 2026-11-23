"""LLM fallback for code the rules cannot port on their own.

The rules queue a member (one method or config value of an Ext.define body) when it uses a construct that is
invalid in ES modules or an Ext API the runtime does not implement. Each target is sent to a local model
(Ollama, offline) or to the platform's LLM gateway with the runtime's API list as context. A reply is only
accepted when it parses, keeps the member's shape (function stays function) and no longer uses what was
flagged; otherwise the original code stays and the report lists it for a person. Replies are cached on disk
by content hash, so re-running a migration is deterministic and free.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .jsast import parse

SYSTEM = (
    "You port Ext JS 7 classic code to run on @extreact/runtime, a React implementation of the Ext JS API that "
    "runs as strict-mode ES modules. Keep the Ext.define structure, names and behaviour. Only change what is "
    "needed to fix the stated problem, using APIs from the list given. Reply with the replacement JavaScript "
    "for the member value only (no property name, no markdown fences, no explanation)."
)


@dataclass
class LlmAttempt:
    file: str
    cls: str | None
    member: str | None
    reason: str
    status: str  # applied | rejected | skipped | failed | cached
    detail: str = ""
    provider: str = ""


@dataclass
class LlmFixer:
    provider: str = "none"  # none | ollama | platform
    model: str = "qwen2.5-coder:7b"
    url: str = "http://localhost:11434"
    cache_dir: Path | None = None
    timeout: float = 120.0
    api_hint: str = ""
    platform_generate: Callable[[str, str], str] | None = None  # (prompt, system) -> text, for the agent service
    attempts: list[LlmAttempt] = field(default_factory=list)

    @classmethod
    def from_env(cls, provider: str | None = None, cache_dir: Path | None = None) -> "LlmFixer":
        return cls(
            provider=(provider or os.environ.get("EXTJS_MIGRATE_LLM", "none")).lower(),
            model=os.environ.get("EXTJS_MIGRATE_MODEL", "qwen2.5-coder:7b"),
            url=os.environ.get("OLLAMA_URL", "http://localhost:11434"),
            cache_dir=cache_dir,
        )

    # ---- transport
    def _ask(self, prompt: str) -> str:
        if self.provider == "ollama":
            body = json.dumps({"model": self.model, "prompt": prompt, "system": SYSTEM, "stream": False,
                               "options": {"temperature": 0}}).encode()
            req = urllib.request.Request(self.url.rstrip("/") + "/api/generate", data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=self.timeout) as r:  # noqa: S310 - local, user-configured URL
                return json.loads(r.read().decode()).get("response", "")
        if self.provider == "platform" and self.platform_generate:
            return self.platform_generate(prompt, SYSTEM)
        raise RuntimeError(f"LLM provider '{self.provider}' is not available")

    def available(self) -> bool:
        if self.provider == "ollama":
            try:
                with urllib.request.urlopen(self.url.rstrip("/") + "/api/tags", timeout=3):  # noqa: S310
                    return True
            except (urllib.error.URLError, OSError):
                return False
        return self.provider == "platform" and self.platform_generate is not None

    # ---- cache
    def _cache_get(self, key: str) -> str | None:
        if not self.cache_dir:
            return None
        p = self.cache_dir / (key + ".js")
        return p.read_text(encoding="utf-8") if p.is_file() else None

    def _cache_put(self, key: str, text: str) -> None:
        if not self.cache_dir:
            return
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        (self.cache_dir / (key + ".js")).write_text(text, encoding="utf-8")

    # ---- fixing
    def fix(self, file: str, source: str, target: dict[str, Any]) -> str:
        """Returns the new file source (unchanged when the fix is not accepted)."""
        start, end = target["start"], target["end"]
        snippet = source[start:end]
        reason = target["reason"]
        att = LlmAttempt(file=file, cls=target.get("cls"), member=target.get("member"), reason=reason, status="skipped", provider=self.provider)
        self.attempts.append(att)
        if self.provider == "none":
            att.detail = "LLM fallback is off (--llm ollama or --llm platform enables it)"
            return source
        key = hashlib.sha256((self.model + "\n" + reason + "\n" + snippet).encode()).hexdigest()[:24]
        reply = self._cache_get(key)
        if reply is not None:
            att.status = "cached"
        else:
            prompt = (f"File: {file}\nClass: {target.get('cls')}\nMember: {target.get('member')}\nProblem: {reason}\n\n"
                      f"Available runtime APIs (subset):\n{self.api_hint}\n\nCode of the member value:\n{snippet}\n")
            try:
                reply = self._ask(prompt)
            except Exception as e:  # noqa: BLE001 - any transport failure means "keep the original"
                att.status = "failed"
                att.detail = str(e)[:300]
                return source
        candidate = _clean(reply)
        ok, why = _acceptable(snippet, candidate, reason)
        if not ok:
            att.status = "rejected"
            att.detail = why
            return source
        self._cache_put(key, candidate)
        if att.status != "cached":
            att.status = "applied"
        return source[:start] + candidate + source[end:]


def _clean(reply: str) -> str:
    text = reply.strip()
    m = re.search(r"```(?:javascript|js|typescript|ts)?\s*\n(.*?)```", text, re.S)
    if m:
        text = m.group(1).strip()
    return text.rstrip(",; \n")


def _acceptable(original: str, candidate: str, reason: str) -> tuple[bool, str]:
    if not candidate:
        return False, "empty reply"
    try:
        parse("(" + candidate + ");")
    except Exception as e:  # noqa: BLE001
        return False, f"reply does not parse: {e}"
    if original.lstrip().startswith("function") != candidate.lstrip().startswith(("function", "async function")):
        return False, "reply changed the member's kind"
    m = re.search(r"uses (Ext\.[\w.]+)", reason)
    if m and m.group(1) in candidate:
        return False, f"reply still uses {m.group(1)}"
    if "with statement" in reason and re.search(r"\bwith\s*\(", candidate):
        return False, "reply still uses with"
    if "arguments.callee" in reason and "arguments.callee" in candidate:
        return False, "reply still uses arguments.callee"
    return True, ""
