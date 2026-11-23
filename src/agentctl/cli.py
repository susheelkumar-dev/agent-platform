"""agentctl — developer CLI for the AI Agent Platform.

    agentctl create weather-agent --capability weather.forecast.read --keyword weather --keyword forecast
    agentctl validate services/weather-agent/agent.py
    agentctl test --url http://127.0.0.1:8103
    agentctl agents list | disable <id> | enable <id> | deprecate <id> --version 1.0.0
    agentctl capabilities
    agentctl preview "compare inventory with exposure"
    agentctl chat "show inventory valuation"
    agentctl display validate|register|status ...   front-end menus and displays (see agentctl/display.py)
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import inspect
import json
import os
import re
import sys
from pathlib import Path
from string import Template

from agentctl import templates as t

CAP_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$")
ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,62}$")


def _fail(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


# ------------------------------------------------------------------ create
def cmd_create(args: argparse.Namespace) -> None:
    agent_id = args.agent_id if args.agent_id.endswith("-agent") or "-" in args.agent_id else f"{args.agent_id}-agent"
    if not ID_RE.match(agent_id):
        _fail(f"invalid agent id '{agent_id}' (lower-case kebab case)")
    for cap in args.capability:
        if not CAP_RE.match(cap):
            _fail(f"invalid capability '{cap}' (e.g. weather.forecast.read)")
    root = Path(args.output).resolve() / agent_id
    if root.exists() and any(root.iterdir()) and not args.force:
        _fail(f"{root} already exists (use --force to overwrite)")
    (root / "tests").mkdir(parents=True, exist_ok=True)

    class_name = "".join(p.capitalize() for p in agent_id.replace("-agent", "").split("-")) + "Agent"
    display = " ".join(p.capitalize() for p in agent_id.split("-"))
    caps_src = []
    for cap in args.capability:
        segments = [s for s in cap.split(".") if s not in ("read", "write", "get", "list", "run")]
        keywords = args.keyword or sorted(set(segments))
        examples = args.example or [f"Show {' '.join(segments)}"]
        caps_src.append(Template(t.CAPABILITY).substitute(
            name=cap, description=args.description, keywords=json.dumps(keywords), examples=json.dumps(examples)
        ))
    permissions = json.dumps(args.permission or [])
    llm_block = {"basic": "", "llm": t.LLM_BLOCK, "rag": t.RAG_BLOCK}[args.template]
    values = dict(
        agent_id=agent_id, class_name=class_name, display_name=display, description=args.description,
        capabilities="\n".join(caps_src), permissions=permissions, port=args.port, llm_block=llm_block,
        capability_list=", ".join(f"`{c}`" for c in args.capability),
    )
    files = {
        "agent.py": t.AGENT_BASIC,
        "main.py": t.MAIN,
        "requirements.txt": t.REQUIREMENTS,
        ".env.example": t.ENV_EXAMPLE,
        "Dockerfile": t.DOCKERFILE,
        "k8s.yaml": t.K8S,
        "README.md": t.README,
        "tests/test_agent.py": t.TEST,
        "tests/conftest.py": t.CONFTEST,
    }
    for name, template in files.items():
        (root / name).write_text(Template(template).safe_substitute(values), encoding="utf-8")
    print(f"Created agent service '{agent_id}' in {root}")
    for name in files:
        print(f"  {name}")
    print("\nNext:\n"
          f"  cd {root}\n  cp .env.example .env\n  python main.py        # registers with the platform\n"
          f"  pytest                # unit + contract tests\n  agentctl test --url http://127.0.0.1:{args.port}")


# ------------------------------------------------------------------ validate
def _load_agents(path: str):
    from ai_agents.base import BaseAgent

    # "path/agent.py:ClassName" — split on the LAST colon only if what follows is a class name,
    # so Windows drive letters ("C:\...") are not mistaken for the separator.
    file, sep, cls_name = path.rpartition(":")
    if not sep or not cls_name.isidentifier():
        file, cls_name = path, ""
    p = Path(file).resolve()
    if not p.exists():
        _fail(f"{p} not found")
    sys.path.insert(0, str(p.parent))
    spec = importlib.util.spec_from_file_location(p.stem, p)
    module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[p.stem] = module
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    classes = [
        obj for name, obj in inspect.getmembers(module, inspect.isclass)
        if issubclass(obj, BaseAgent) and obj is not BaseAgent and obj.__module__ == module.__name__
        and (not cls_name or name == cls_name)
    ]
    if not classes:
        _fail(f"no BaseAgent subclass found in {p}")
    return classes


def validate_manifest(manifest) -> list[tuple[str, str]]:
    findings: list[tuple[str, str]] = []
    for cap in manifest.capabilities:
        if cap.name.startswith("platform."):
            findings.append(("error", f"capability '{cap.name}' uses the reserved 'platform.' namespace"))
        if not cap.internal and not (cap.keywords or cap.examples):
            findings.append(("warning", f"capability '{cap.name}' has no keywords/examples; it can only be "
                                        "reached via explicit capabilities or an LLM resolver"))
        if not cap.description:
            findings.append(("warning", f"capability '{cap.name}' has no description"))
    if manifest.agent_id.startswith("platform-"):
        findings.append(("error", "agent ids starting with 'platform-' are reserved"))
    if not manifest.permissions and not any(c.permissions for c in manifest.capabilities):
        findings.append(("warning", "no permissions declared: every authenticated user can invoke this agent"))
    if manifest.version.startswith("0."):
        findings.append(("info", f"pre-1.0 version {manifest.version}"))
    return findings


def cmd_validate(args: argparse.Namespace) -> None:
    from pydantic import ValidationError

    errors = 0
    for cls in _load_agents(args.path):
        try:
            manifest = cls().manifest()
        except ValidationError as exc:
            print(f"✗ {cls.__name__}: invalid manifest\n{exc}")
            errors += 1
            continue
        print(f"✓ {cls.__name__}: {manifest.agent_id}@{manifest.version} "
              f"capabilities={manifest.capability_names} permissions={manifest.permissions}")
        for level, msg in validate_manifest(manifest):
            print(f"  [{level}] {msg}")
            errors += level == "error"
        if args.json:
            print(manifest.model_dump_json(indent=2))
    raise SystemExit(1 if errors else 0)


# ------------------------------------------------------------------ test
def cmd_test(args: argparse.Namespace) -> None:
    import httpx

    from ai_agent_sdk.testing import check_agent_service

    async def run():
        async with httpx.AsyncClient(timeout=30) as client:
            return await check_agent_service(
                client, args.url, service_token=args.service_token, signing_secret=args.signing_secret or None,
            )

    report = asyncio.run(run())
    print(report.render())
    raise SystemExit(0 if report.passed else 1)


# ------------------------------------------------------------------ platform API
def _client(args: argparse.Namespace):
    from ai_platform_client import PlatformClient

    return PlatformClient(args.platform_url, args.token)


def cmd_agents(args: argparse.Namespace) -> None:
    client = _client(args)
    if args.action == "list":
        agents = client.list_agents()
        print(f"{'AGENT':28} {'VERSION':10} {'STATUS':11} {'HEALTH':10} {'RUNTIME':12} CAPABILITIES")
        for a in agents:
            print(f"{a['agent_id']:28} {a['version']:10} {a['status']:11} {a['health']:10} {a['runtime_type']:12} "
                  f"{', '.join(a['capabilities'])}")
        return
    if not args.agent_id:
        _fail("agent id required")
    if args.action == "get":
        print(json.dumps(client.get_agent(args.agent_id), indent=2, default=str))
    elif args.action == "delete":
        print(client.delete_agent(args.agent_id, args.version))
    else:
        status = {"enable": "active", "disable": "disabled", "deprecate": "deprecated", "retire": "retired"}[args.action]
        for r in client.set_agent_status(args.agent_id, status, version=args.version, reason=args.reason):
            print(f"{r['agent_id']}@{r['version']} -> {r['status']}")


def cmd_capabilities(args: argparse.Namespace) -> None:
    for c in _client(args).list_capabilities():
        flag = "" if c["routable"] else "  (no healthy agent)"
        print(f"{c['name']:36} {', '.join(c['agents'])}{flag}")
        if c.get("examples"):
            print(f"{'':36} e.g. \"{c['examples'][0]}\"")


def cmd_preview(args: argparse.Namespace) -> None:
    print(json.dumps(_client(args).preview_plan(args.message), indent=2, default=str))


def cmd_chat(args: argparse.Namespace) -> None:
    client = _client(args)
    if args.stream:
        for event in client.chat_stream(args.message):
            payload = event.get("payload", {})
            if event.get("event_type", "").startswith("ExecutionStep"):
                print(f"  · {event['event_type']:28} {payload.get('step_id')} {payload.get('capability', '')}")
            elif "response" in payload and isinstance(payload["response"], dict):
                print("\n" + payload["response"]["response"])
        return
    result = client.chat(args.message)
    print(result["response"])
    print(f"\n[{result['status']}] capabilities={result['capabilities']} execution={result['execution_id']}")


# ------------------------------------------------------------------ parser
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agentctl", description="AI Agent Platform developer CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("create", help="Scaffold an independently deployable agent service")
    p.add_argument("agent_id")
    p.add_argument("--capability", action="append", required=True, help="repeatable, e.g. weather.forecast.read")
    p.add_argument("--keyword", action="append", help="routing keyword (repeatable)")
    p.add_argument("--example", action="append", help="example user request (repeatable)")
    p.add_argument("--permission", action="append", help="permission users need (repeatable)")
    p.add_argument("--description", default="Generated enterprise AI agent")
    p.add_argument("--template", choices=["basic", "llm", "rag"], default="basic")
    p.add_argument("--port", type=int, default=8100)
    p.add_argument("--output", default="agents")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_create)

    p = sub.add_parser("validate", help="Validate an agent's manifest: agentctl validate path/agent.py[:Class]")
    p.add_argument("path")
    p.add_argument("--json", action="store_true", help="print the manifest")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("test", help="Contract-test a running agent service")
    p.add_argument("--url", required=True)
    p.add_argument("--service-token", default=os.getenv("AGENT_SERVICE_TOKEN", "agent-demo-service-token"))
    p.add_argument("--signing-secret",
                   default=os.getenv("AGENT_SIGNING_SECRET", "dev-signing-secret-change-me-0123456789"))
    p.set_defaults(func=cmd_test)

    def platform_args(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--platform-url", default=os.getenv("AGENT_PLATFORM_URL", "http://127.0.0.1:8000"))
        sp.add_argument("--token", default=os.getenv("AGENT_PLATFORM_TOKEN", "demo-admin"))

    p = sub.add_parser("agents", help="Inspect and manage registered agents")
    p.add_argument("action", choices=["list", "get", "enable", "disable", "deprecate", "retire", "delete"])
    p.add_argument("agent_id", nargs="?")
    p.add_argument("--version")
    p.add_argument("--reason")
    platform_args(p)
    p.set_defaults(func=cmd_agents)

    p = sub.add_parser("capabilities", help="List the capability catalog")
    platform_args(p)
    p.set_defaults(func=cmd_capabilities)

    p = sub.add_parser("preview", help="Dry-run: show how a request would be planned")
    p.add_argument("message")
    platform_args(p)
    p.set_defaults(func=cmd_preview)

    p = sub.add_parser("chat", help="Send a request to the platform")
    p.add_argument("message")
    p.add_argument("--stream", action="store_true")
    platform_args(p)
    p.set_defaults(func=cmd_chat)

    from agentctl import display
    display.add_commands(sub)
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
