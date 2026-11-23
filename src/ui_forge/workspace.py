"""Schema documents on disk: src/modules/<module>/ui-forge/<name>.entity.json and <name>.display.json.

They live in the application's repository, next to the code they produce, so they are reviewed and versioned with
it (and mirrored into the app-files folder like the rest of src/modules). Writes are canonical JSON (sorted object
keys are NOT used: field and section order is meaningful), two-space indented, with a trailing newline.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .naming import entity_file, kebab
from .project import Project
from .schema import DisplaySchema, EntityDef, migrate, parse_display, parse_entity


@dataclass
class Issue:
    level: str          # error | warning
    where: str          # e.g. display:assets.generation-assets / entity:GenerationAsset
    path: str           # JSON path inside the document, '' for the whole document
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"level": self.level, "where": self.where, "path": self.path, "message": self.message}


@dataclass
class Workspace:
    entities: dict[str, EntityDef] = field(default_factory=dict)
    displays: dict[str, DisplaySchema] = field(default_factory=dict)
    files: dict[str, str] = field(default_factory=dict)        # 'entity:Name' / 'display:id' -> path relative to the app
    issues: list[Issue] = field(default_factory=list)          # documents that could not be read

    def docs(self) -> dict[str, Any]:
        return {
            "entities": [e.model_dump(mode="json", exclude_none=True) for e in sorted(self.entities.values(), key=lambda x: x.name)],
            "displays": [d.model_dump(mode="json", exclude_none=True) for d in sorted(self.displays.values(), key=lambda x: x.id)],
            "files": self.files,
            "issues": [i.as_dict() for i in self.issues],
        }


def pydantic_issues(where: str, err: ValidationError) -> list[Issue]:
    out = []
    for e in err.errors():
        loc = ".".join(str(x) for x in e["loc"] if not str(x).startswith("function-"))
        msg = e["msg"].removeprefix("Value error, ")
        out.append(Issue("error", where, loc, msg))
    return out


def entity_path(e: EntityDef) -> str:
    return f"src/modules/{e.module}/ui-forge/{entity_file(e.name)}.entity.json"


def display_path(d: DisplaySchema) -> str:
    return f"src/modules/{d.module}/ui-forge/{kebab(d.name)}.display.json"


def canonical_json(doc: dict[str, Any]) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def dump_entity(e: EntityDef) -> str:
    return canonical_json(e.model_dump(mode="json", exclude_none=True, exclude_defaults=False))


def dump_display(d: DisplaySchema) -> str:
    return canonical_json(d.model_dump(mode="json", exclude_none=True, exclude_defaults=False))


def load_workspace(project: Project) -> Workspace:
    ws = Workspace()
    base = project.app_root / "src" / "modules"
    for p in sorted(base.glob("*/ui-forge/*.json")):
        rel = p.relative_to(project.app_root).as_posix()
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            ws.issues.append(Issue("error", rel, "", f"not valid JSON: {e}"))
            continue
        kind = raw.get("kind")
        try:
            if kind == "entity":
                e = parse_entity(raw)
                if e.name in ws.entities:
                    ws.issues.append(Issue("error", rel, "name", f"entity {e.name} is also defined in {ws.files['entity:' + e.name]}"))
                    continue
                ws.entities[e.name] = e
                ws.files["entity:" + e.name] = rel
            elif kind == "display":
                d = parse_display(raw)
                if d.id in ws.displays:
                    ws.issues.append(Issue("error", rel, "id", f"display {d.id} is also defined in {ws.files['display:' + d.id]}"))
                    continue
                ws.displays[d.id] = d
                ws.files["display:" + d.id] = rel
            else:
                ws.issues.append(Issue("error", rel, "kind", "kind must be 'entity' or 'display'"))
        except ValidationError as err:
            ws.issues.extend(pydantic_issues(rel, err))
        except ValueError as err:
            ws.issues.append(Issue("error", rel, "schemaVersion", str(err)))
    return ws


def overlay(ws: Workspace, entities: list[dict[str, Any]] | None = None, displays: list[dict[str, Any]] | None = None,
            replace: dict[str, str] | None = None) -> tuple[Workspace, list[Issue]]:
    """The saved workspace with unsaved documents on top (the builder's drafts). Returns shape errors separately.

    `replace` maps a draft's new key to the key it renames (a display whose id changed, an entity renamed), so the
    old document does not stay in the overlay.
    """
    out = Workspace(entities=dict(ws.entities), displays=dict(ws.displays), files=dict(ws.files))
    issues: list[Issue] = []
    for raw in entities or []:
        where = f"entity:{raw.get('name', '?')}"
        try:
            e = parse_entity(raw)
        except ValidationError as err:
            issues.extend(pydantic_issues(where, err))
            continue
        except ValueError as err:
            issues.append(Issue("error", where, "schemaVersion", str(err)))
            continue
        old = (replace or {}).get("entity:" + e.name)
        if old and old.startswith("entity:"):
            out.entities.pop(old[7:], None)
        out.entities[e.name] = e
    for raw in displays or []:
        where = f"display:{raw.get('id', '?')}"
        try:
            d = parse_display(raw)
        except ValidationError as err:
            issues.extend(pydantic_issues(where, err))
            continue
        except ValueError as err:
            issues.append(Issue("error", where, "schemaVersion", str(err)))
            continue
        old = (replace or {}).get("display:" + d.id)
        if old and old.startswith("display:"):
            out.displays.pop(old[8:], None)
        out.displays[d.id] = d
    return out, issues


def save_documents(project: Project, ws: Workspace, entities: list[EntityDef], displays: list[DisplaySchema],
                   removed: list[str] | None = None) -> list[str]:
    """Writes documents (and removes documents that moved, e.g. a display renamed). Returns written paths."""
    written = []
    for e in entities:
        rel = entity_path(e)
        old = ws.files.get("entity:" + e.name)
        _write(project.app_root / rel, dump_entity(e))
        if old and old != rel:
            (project.app_root / old).unlink(missing_ok=True)
        written.append(rel)
    for d in displays:
        rel = display_path(d)
        old = ws.files.get("display:" + d.id)
        _write(project.app_root / rel, dump_display(d))
        if old and old != rel:
            (project.app_root / old).unlink(missing_ok=True)
        written.append(rel)
    for key in removed or []:
        rel = ws.files.get(key)
        if rel:
            (project.app_root / rel).unlink(missing_ok=True)
    return written


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(path)


def read_raw(project: Project, rel: str) -> dict[str, Any]:
    return migrate(json.loads((project.app_root / rel).read_text(encoding="utf-8")))
