"""What the @extreact/runtime implements, read from runtime/manifest.json.

The manifest is written by the runtime's own test suite (tests/manifest.test.ts), which loads the runtime
and lists every registered class, alias, Ext.* static and class method, so it never drifts from the code.
The generator checks an application's framework usage against it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

RUNTIME_DIR = Path(__file__).resolve().parent.parent / "runtime"


@dataclass
class RuntimeManifest:
    classes: set[str] = field(default_factory=set)
    aliases: set[str] = field(default_factory=set)
    statics: set[str] = field(default_factory=set)
    parents: dict[str, str] = field(default_factory=dict)
    methods: dict[str, set[str]] = field(default_factory=dict)
    class_statics: dict[str, set[str]] = field(default_factory=dict)

    def has_class(self, name: str) -> bool:
        return name in self.classes

    def has_alias(self, alias: str) -> bool:
        return alias in self.aliases

    def has_api(self, chain: str) -> bool:
        """'Ext.Msg.confirm' is covered when Ext.Msg exists (instance members are not checked statically)."""
        if not chain.startswith("Ext."):
            return True
        rest = chain[4:]
        if rest in self.statics or chain in self.classes:
            return True
        parts = rest.split(".")
        # Ext.util.Format.number -> util.Format.number; walk up until a known static that is not a namespace
        for i in range(len(parts) - 1, 0, -1):
            head = ".".join(parts[:i])
            if head in self.statics and ("Ext." + head) not in self.classes and not self._is_namespace(head):
                return True
            if ("Ext." + head) in self.classes:
                name = "Ext." + head
                return (parts[i] in self.class_methods(name) or parts[i] in self.class_statics.get(name, set())
                        or parts[i] in self.statics_of(head))
        return False

    def _is_namespace(self, head: str) -> bool:
        prefix = head + "."
        return any(c.startswith("Ext." + prefix) for c in self.classes)

    def statics_of(self, head: str) -> set[str]:
        prefix = head + "."
        return {s[len(prefix):].split(".")[0] for s in self.statics if s.startswith(prefix)}

    def class_methods(self, name: str) -> set[str]:
        out: set[str] = set()
        seen = set()
        while name and name not in seen:
            seen.add(name)
            out |= self.methods.get(name, set())
            name = self.parents.get(name, "")
        return out


@lru_cache(maxsize=4)
def load_manifest(runtime_dir: str | None = None) -> RuntimeManifest:
    root = Path(runtime_dir) if runtime_dir else RUNTIME_DIR
    path = root / "manifest.json"
    if not path.is_file():
        raise FileNotFoundError(f"{path} is missing: run `npm test` in {root} to generate it")
    data = json.loads(path.read_text(encoding="utf-8"))
    return RuntimeManifest(
        classes=set(data.get("classes", [])),
        aliases=set(data.get("aliases", [])),
        statics=set(data.get("statics", [])),
        parents=dict(data.get("parents", {})),
        methods={k: set(v) for k, v in data.get("methods", {}).items()},
        class_statics={k: set(v) for k, v in data.get("classStatics", {}).items()},
    )
