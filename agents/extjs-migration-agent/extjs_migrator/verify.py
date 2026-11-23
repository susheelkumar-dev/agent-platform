"""Verification loop for a generated project: npm install, tsc --noEmit, vite build, optional browser smoke test.

Each step is recorded with its output tail; build errors are mapped back to the generated module (and so to
the Ext JS source file) where the message names one.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

SMOKE = r"""
import { chromium } from 'playwright-core';
const url = process.argv[2], wait = Number(process.argv[3] || 8000), selector = process.argv[4] || '';
// a browser: CHROMIUM_PATH, then an installed Chrome / Edge, then Playwright's own download
const tries = [process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : null, { channel: 'chrome' }, { channel: 'msedge' }, {}].filter(Boolean);
let b = null;
for (const t of tries) { try { b = await chromium.launch(t); break; } catch (e) { /* next */ } }
if (!b) { console.log(JSON.stringify({ ok: null, errors: ['no browser found: set CHROMIUM_PATH to a Chrome/Chromium executable'] })); process.exit(0); }
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.goto(url);
let ok = true;
if (selector) {
  ok = await p.waitForFunction(s => window.Ext && Ext.ComponentQuery && Ext.ComponentQuery.query(s).length > 0, selector, { timeout: wait }).then(() => true, () => false);
} else { await p.waitForTimeout(wait); }
await p.waitForTimeout(1500);
console.log(JSON.stringify({ ok, errors }));
await b.close();
"""


@dataclass
class Step:
    name: str
    ok: bool
    command: str
    output: str = ""
    skipped: bool = False


@dataclass
class VerifyResult:
    steps: list[Step] = field(default_factory=list)
    errors_by_module: dict[str, list[str]] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return all(s.ok or s.skipped for s in self.steps)


def _run(cmd: list[str], cwd: Path, timeout: int) -> tuple[int, str]:
    exe = shutil.which(cmd[0]) or cmd[0]
    try:
        p = subprocess.run([exe] + cmd[1:], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,  # noqa: S603
                           env=dict(os.environ, CI="1", FORCE_COLOR="0"))
        return p.returncode, (p.stdout + p.stderr)
    except FileNotFoundError:
        return 127, f"{cmd[0]} not found"
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"


def _needs_install(out: Path) -> bool:
    """node_modules is missing, or lacks a dependency (e.g. the @extreact packages after an upgrade)."""
    import json
    try:
        pkg = json.loads((out / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return not (out / "node_modules").is_dir()
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    for name, spec in deps.items():
        installed = out / "node_modules" / name / "package.json"
        if not installed.is_file():
            return True
        if spec.startswith("file:") and spec.endswith(".tgz"):
            # a packed library: reinstall when its version differs from the one installed
            want = re.search(r"-(\d+\.\d+\.\d+[^/]*)\.tgz$", spec)
            try:
                have = json.loads(installed.read_text(encoding="utf-8")).get("version")
            except (OSError, ValueError):
                return True
            if want and want.group(1) != have:
                return True
    return False


def verify(out_dir: str, *, install: bool = True, smoke_url: str | None = None, smoke_selector: str | None = None,
           relax: Callable[[str], bool] | None = None) -> VerifyResult:
    """`relax(tsc_output)` may mark failing modules as unchecked and return True to type-check once more."""
    out = Path(out_dir)
    res = VerifyResult()
    if not shutil.which("npm"):
        res.steps.append(Step("node", False, "npm --version", "Node.js / npm is not installed; install Node 18+ to build the app", skipped=True))
        return res
    if install and _needs_install(out):
        # --prefer-offline: the @extreact packages are local files; everything else comes from the npm cache when it can
        code, text = _run(["npm", "install", "--prefer-offline", "--no-audit", "--no-fund"], out, 900)
        res.steps.append(Step("install", code == 0, "npm install", text[-3000:]))
        if code != 0:
            return res
    code, text = _run(["npx", "tsc", "--noEmit"], out, 600)
    if code != 0 and relax and relax(text):
        code, text = _run(["npx", "tsc", "--noEmit"], out, 600)
    res.steps.append(Step("typecheck", code == 0, "tsc --noEmit", text[-6000:]))
    _map_errors(text, res)
    code, text = _run(["npx", "vite", "build"], out, 900)
    res.steps.append(Step("build", code == 0, "vite build", text[-6000:]))
    _map_errors(text, res)
    if smoke_url:
        script = out / ".migration-smoke.mjs"
        script.write_text(SMOKE, encoding="utf-8")
        if not (out / "node_modules" / "playwright-core").is_dir():
            # match the version to an installed browser with EXTJS_MIGRATE_PLAYWRIGHT (e.g. 1.56.0)
            pw = os.environ.get("EXTJS_MIGRATE_PLAYWRIGHT", "1.47.2")
            _run(["npm", "install", "--no-save", "--no-audit", "--no-fund", f"playwright-core@{pw}"], out, 600)
        code, text = _run(["node", str(script), smoke_url, "15000", smoke_selector or ""], out, 120)
        if '"ok":null' in text:
            res.steps.append(Step("smoke", False, f"browser smoke test {smoke_url}", text[-2000:], skipped=True))
        else:
            ok = code == 0 and '"ok":true' in text and '"errors":[]' in text
            res.steps.append(Step("smoke", ok, f"browser smoke test {smoke_url}", text[-4000:]))
    return res


ERR_RE = re.compile(r"(src/[\w./-]+\.tsx?)[:(](\d+)")


def _map_errors(text: str, res: VerifyResult) -> None:
    for line in text.splitlines():
        m = ERR_RE.search(line)
        if m and ("error" in line.lower()):
            res.errors_by_module.setdefault(m.group(1), []).append(line.strip()[:300])
