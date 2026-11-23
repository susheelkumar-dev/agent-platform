"""Plan and apply: what generation would change, shown before anything is written.

Like `terraform plan / apply`:

* plan()  computes every file the schemas produce and compares it with the disk and the lock file
          (ui-forge.lock.json in the app root: the hash of each file as UI Forge last wrote it).
* apply() recomputes the plan, refuses if it differs from the one the developer reviewed (plan hash), writes,
          and updates the lock. Nothing outside the configured roots is ever touched.

Statuses
  create     the file does not exist
  update     a generated file whose schema changed; the file on disk is what UI Forge wrote last time
  unchanged  nothing to do
  conflict   a generated file was edited by hand (its hash differs from the lock); kept unless forced,
             and then the old file is backed up first
  keep       a developer-owned file that exists; never touched
  orphan     a file UI Forge wrote earlier that no schema produces any more; reported, deleted only with prune
             and only when unedited
  retire     a developer-owned file (component, hooks) whose display or entity was deleted. It imports generated
             files that are gone, so it would break the build; with prune it is moved (never deleted) to
             .ui-forge/retired/<time>/ so the code can still be copied from there
  blocked    a file the generator cannot change safely (e.g. src/displays.ts without mergeDisplays)

Every file under src/modules/, registration/ and src/displays.ts is also planned in the mirror root (the
app-files folder extjs-migrate copies in), with its own lock entries.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import shutil
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .files import GeneratedFile
from .gen_backend import backend_files
from .gen_contract import contract_files
from .gen_frontend import frontend_files, wire_displays_ts
from .gen_registration import manifests
from .project import MIRRORED, Project
from .workspace import Workspace

LOCK_FILE = "ui-forge.lock.json"
GENERATOR_VERSION = "1.0.0"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class Change:
    key: str           # root:path
    root: str
    path: str
    owner: str
    status: str
    content: str | None = None
    current: str | None = None
    note: str = ""
    source: str = ""

    def diff(self, context: int = 3) -> str:
        if self.status in ("unchanged", "keep") or self.content is None:
            return ""
        a = (self.current or "").splitlines(keepends=True)
        b = self.content.splitlines(keepends=True)
        return "".join(difflib.unified_diff(a, b, f"a/{self.path}", f"b/{self.path}", n=context))

    def as_dict(self, with_content: bool = False, with_diff: bool = True) -> dict[str, Any]:
        d = {"key": self.key, "root": self.root, "path": self.path, "owner": self.owner, "status": self.status,
             "note": self.note, "source": self.source}
        if with_diff:
            d["diff"] = self.diff()
        if with_content:
            d["content"] = self.content
            d["current"] = self.current
        return d


@dataclass
class Plan:
    changes: list[Change] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    @property
    def hash(self) -> str:
        h = hashlib.sha256()
        for c in sorted(self.changes, key=lambda x: x.key):
            h.update(f"{c.key}|{c.status}|{sha(c.content) if c.content is not None else ''}|{sha(c.current) if c.current is not None else ''}\n".encode())
        return h.hexdigest()[:16]

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for c in self.changes:
            out[c.status] = out.get(c.status, 0) + 1
        return out

    def as_dict(self, with_content: bool = False) -> dict[str, Any]:
        return {"hash": self.hash, "counts": self.counts(), "problems": self.problems,
                "changes": [c.as_dict(with_content) for c in sorted(self.changes, key=lambda x: (x.root, x.path))]}


def _read(p: Path) -> str | None:
    try:
        return p.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def load_lock(project: Project) -> dict[str, Any]:
    # after a fresh migration the app has the mirror's copy (extjs-migrate --app-files carries ui-forge.lock.json)
    raw = _read(project.app_root / LOCK_FILE) or (_read(project.mirror_root / LOCK_FILE) if project.mirror_root else None)
    if not raw:
        return {"generator": GENERATOR_VERSION, "files": {}, "developer": {}}
    try:
        lock = json.loads(raw)
        lock.setdefault("files", {})
        lock.setdefault("developer", {})
        return lock
    except json.JSONDecodeError:
        return {"generator": GENERATOR_VERSION, "files": {}, "developer": {}}


def _remove_empty_dirs(d: Path, stop: Path) -> None:
    """Removes now-empty folders up to (not including) a root."""
    stop = stop.resolve()
    d = d.resolve()
    while d != stop and stop in d.parents:
        try:
            d.rmdir()
        except OSError:
            return
        d = d.parent


def _target(project: Project, root: str, rel: str) -> Path:
    base = project.root(root).resolve()
    p = (base / rel).resolve()
    if base != p and base not in p.parents:
        raise ValueError(f"{rel} would be written outside the {root} root")
    return p


def desired_files(project: Project, ws: Workspace, audit_endpoint: str = "/audit") -> tuple[list[GeneratedFile], list[str]]:
    files = frontend_files(ws, audit_endpoint) + contract_files(ws) + manifests(project, ws) + backend_files(project, ws)
    problems: list[str] = []
    displays_ts = project.app_root / "src" / "displays.ts"
    text = _read(displays_ts) or ""
    wired, problem = wire_displays_ts(text)
    if problem:
        problems.append(problem)
    else:
        files.append(GeneratedFile("app", "src/displays.ts", wired, owner="block", source="workspace",
                                   note="adds the generated registry between // <ui-forge:...> markers"))
    if project.mirror_root is not None:
        mirrored = []
        for f in files:
            if f.root == "app" and f.path.startswith(MIRRORED):
                mirrored.append(GeneratedFile("mirror", f.path, f.content, owner=f.owner, source=f.source, note="copy for the app-files folder"))
        # the schema documents themselves are app-owned sources: mirror them too
        for rel in sorted(ws.files.values()):
            text = _read(project.app_root / rel)
            if text is not None:
                mirrored.append(GeneratedFile("mirror", rel, text, owner="generated", source=rel, note="schema document"))
        # the mirror's displays.ts is wired in its own text
        files = [f for f in files] + [m for m in mirrored if m.path != "src/displays.ts"]
        mtext = _read(project.mirror_root / "src" / "displays.ts")
        if mtext is not None:
            mw, mp = wire_displays_ts(mtext)
            if mp:
                problems.append("mirror: " + mp)
            else:
                files.append(GeneratedFile("mirror", "src/displays.ts", mw, owner="block", source="workspace", note="copy for the app-files folder"))
    return files, problems


def plan(project: Project, ws: Workspace, audit_endpoint: str = "/audit", prune: bool = False,
         overrides: dict[str, str] | None = None) -> Plan:
    """`overrides`: initial content for developer-owned files that do not exist yet (edited in the builder)."""
    lock_doc = load_lock(project)
    lock = lock_doc["files"]
    dev_lock = lock_doc["developer"]
    files, problems = desired_files(project, ws, audit_endpoint)
    for f in files:
        if overrides and f.owner == "developer" and f.key in overrides:
            f.content = overrides[f.key]
        if overrides and f.owner == "developer" and f.root == "mirror" and f"app:{f.path}" in overrides:
            f.content = overrides[f"app:{f.path}"]
    out = Plan(problems=problems)
    seen = set()
    for f in files:
        if f.key in seen:
            out.problems.append(f"{f.key} is produced twice")
            continue
        seen.add(f.key)
        p = _target(project, f.root, f.path)
        cur = _read(p)
        if f.owner == "developer":
            st = "create" if cur is None else "keep"
            out.changes.append(Change(f.key, f.root, f.path, f.owner, st, f.content if st == "create" else None, cur, f.note, f.source))
            continue
        if cur is None:
            st = "create"
        elif cur == f.content:
            st = "unchanged"
        elif f.owner == "block":
            st = "update"
        else:
            locked = lock.get(f.key)
            st = "update" if locked and locked == sha(cur) else "conflict"
        note = f.note
        if st == "conflict":
            note = "edited by hand since UI Forge wrote it" if f.key in lock else "exists and was not written by UI Forge"
        out.changes.append(Change(f.key, f.root, f.path, f.owner, st, f.content, cur, note, f.source))
    for key, h in sorted(lock.items()):
        if key in seen:
            continue
        root, _, rel = key.partition(":")
        try:
            p = _target(project, root, rel)
        except ValueError:
            continue
        cur = _read(p)
        if cur is None:
            continue
        edited = sha(cur) != h
        out.changes.append(Change(key, root, rel, "generated", "orphan", None, cur,
                                  "no schema produces this file any more" + ("; edited by hand, kept" if edited else ("; will be deleted" if prune else "")), ""))
    for key in sorted(dev_lock):
        if key in seen:
            continue
        root, _, rel = key.partition(":")
        try:
            p = _target(project, root, rel)
        except ValueError:
            continue
        cur = _read(p)
        if cur is None:
            continue
        out.changes.append(Change(key, root, rel, "developer", "retire", None, cur,
                                  "your file; its display or entity is gone" + ("; will be moved to .ui-forge/retired" if prune else "; prune moves it aside (it would not compile)"), ""))
    return out


@dataclass
class ApplyResult:
    written: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    backups: list[str] = field(default_factory=list)
    retired: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"written": self.written, "skipped": self.skipped, "deleted": self.deleted, "backups": self.backups, "retired": self.retired}


class StalePlan(Exception):
    pass


def apply(project: Project, ws: Workspace, plan_hash: str, force: set[str] | None = None, prune: bool = False,
          audit_endpoint: str = "/audit", overrides: dict[str, str] | None = None) -> tuple[ApplyResult, Plan]:
    force = force or set()
    current = plan(project, ws, audit_endpoint, prune, overrides)
    if current.hash != plan_hash:
        raise StalePlan(f"the files or schemas changed since the plan was made (plan {plan_hash}, now {current.hash}); review the new plan")
    if current.problems:
        raise ValueError("; ".join(current.problems))
    lock_doc = load_lock(project)
    lock = lock_doc["files"]
    dev_lock = lock_doc["developer"]
    res = ApplyResult()
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    for c in current.changes:
        p = _target(project, c.root, c.path)
        if c.status in ("unchanged", "keep"):
            if c.status == "unchanged" and c.owner != "developer":
                lock[c.key] = sha(c.current or "")
            if c.owner == "developer":
                dev_lock.setdefault(c.key, sha(c.current or ""))
            continue
        if c.status == "retire":
            if prune:
                dest = project.app_root / ".ui-forge" / "retired" / stamp / c.root / c.path
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(p), dest)
                _remove_empty_dirs(p.parent, _target(project, c.root, ""))
                dev_lock.pop(c.key, None)
                res.retired.append(dest.relative_to(project.app_root).as_posix())
            continue
        if c.status == "orphan":
            if prune and c.current is not None and sha(c.current) == lock.get(c.key):
                p.unlink()
                _remove_empty_dirs(p.parent, _target(project, c.root, ""))
                lock.pop(c.key, None)
                res.deleted.append(c.key)
            continue
        if c.status == "conflict" and c.key not in force:
            res.skipped.append(c.key)
            continue
        if c.current is not None and (c.status == "conflict" or c.owner == "block"):
            backup = project.app_root / ".ui-forge" / "backups" / stamp / c.root / c.path
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, backup)
            res.backups.append(backup.relative_to(project.app_root).as_posix())
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".ui-forge-tmp")
        tmp.write_text(c.content or "", encoding="utf-8", newline="\n")
        tmp.replace(p)
        res.written.append(c.key)
        if c.owner != "developer":
            lock[c.key] = sha(c.content or "")
        else:
            dev_lock[c.key] = sha(c.content or "")
    lock_doc["generator"] = GENERATOR_VERSION
    lock_doc["files"] = dict(sorted(lock.items()))
    def still_there(key: str) -> bool:
        root, _, rel = key.partition(":")
        try:
            return _read(_target(project, root, rel)) is not None
        except ValueError:
            return True  # a root not configured this time (e.g. no --api): keep what was recorded for it
    lock_doc["developer"] = {k: v for k, v in sorted(dev_lock.items()) if still_there(k)}
    text = json.dumps(lock_doc, indent=2) + "\n"
    (project.app_root / LOCK_FILE).write_text(text, encoding="utf-8", newline="\n")
    if project.mirror_root is not None:
        (project.mirror_root / LOCK_FILE).write_text(text, encoding="utf-8", newline="\n")
    return res, current
