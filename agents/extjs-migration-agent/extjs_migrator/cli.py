"""extjs-migrate: command line for the Ext JS -> React migration agent.

    extjs-migrate analyze <path>                      inventory and runtime coverage (no files written)
    extjs-migrate migrate <path> -o <out> [--verify]  generate the React + TypeScript + Vite project
        [--llm none|ollama] [--smoke-url URL --smoke-selector XTYPE]
        [--shell compat|framework] [--app-files DIR]

<path> is the Ext JS application folder (with app.json), its class folder, or any folder of Ext.define files.
"""

from __future__ import annotations

import argparse
import json
import sys

from .pipeline import Options, analysis_summary, migrate, run_analysis


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="extjs-migrate", description="Migrate an Ext JS application to React + TypeScript.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze", help="inventory an Ext JS app and check it against the runtime")
    a.add_argument("path")
    a.add_argument("--json", action="store_true", help="print the full analysis as JSON")
    m = sub.add_parser("migrate", help="generate the React project")
    m.add_argument("path")
    m.add_argument("-o", "--out", required=True, help="output folder for the React project")
    m.add_argument("--llm", default=None, choices=["none", "ollama"], help="LLM fallback for flagged code (default: $EXTJS_MIGRATE_LLM or none)")
    m.add_argument("--verify", action="store_true", help="npm install, tsc --noEmit and vite build the result")
    m.add_argument("--no-install", action="store_true", help="with --verify: do not run npm install")
    m.add_argument("--smoke-url", help="with --verify: open this URL in a headless browser and fail on console errors")
    m.add_argument("--smoke-selector", help="component query that must exist after loading (e.g. the main view xtype)")
    m.add_argument("--shell", default="compat", choices=["compat", "framework"],
                   help="compat: the Ext viewport as before (default); framework: hosted by @extreact/framework with sign-in and server-driven menus")
    m.add_argument("--eager-screens", action="store_true", help="with --shell framework: load every view at startup (default: each screen loads when first shown)")
    m.add_argument("--packages", help="folder with the prebuilt @extreact packages (default: the agent's packages/)")
    m.add_argument("--app-files", help="with --shell framework: folder of application-owned files (bridge, displays, modules, registration) to copy in")
    args = ap.parse_args(argv)

    if args.cmd == "analyze":
        an, cov = run_analysis(args.path)
        s = analysis_summary(an, cov)
        if args.json:
            print(json.dumps(s, indent=2, default=str))
            return 0
        print(f"{s['app']} ({s['toolkit']}, theme {s['theme']}): {s['classes']} classes in {s['files']} files")
        print("  categories: " + ", ".join(f"{k} {v}" for k, v in sorted(s["categories"].items())))
        for k, v in cov.items():
            miss = v["missing"]
            print(f"  {k}: {v['used']} used, " + (f"{len(miss)} missing: {', '.join(miss)}" if miss else "all supported by the runtime"))
        errs = [f for f in s["findings"] if f["level"] == "error"]
        print(f"  findings: {len(s['findings'])} ({len(errs)} errors)")
        return 0

    res = migrate(Options(source=args.path, out=args.out, llm=args.llm or "none", verify=args.verify, install=not args.no_install,
                          smoke_url=args.smoke_url, smoke_selector=args.smoke_selector, shell=args.shell, app_files=args.app_files,
                          packages_dir=args.packages, eager_screens=args.eager_screens, progress=lambda t: print("•", t, flush=True)))
    rep = res["report"]
    s = rep["summary"]
    print(f"Done: {s['classes']} classes -> {s['modules']} modules in {res['generated'].out_dir}")
    if rep.get("verify"):
        print("Verification: " + ("passed" if rep["verify"]["ok"] else "FAILED") + " - " +
              ", ".join(f"{st['name']} {'skipped' if st['skipped'] else 'ok' if st['ok'] else 'failed'}" for st in rep["verify"]["steps"]))
    print("Report:", res["reportFiles"]["markdown"])
    return 0 if not rep.get("verify") or rep["verify"]["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
