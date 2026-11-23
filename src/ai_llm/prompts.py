"""Versioned platform prompts. The name+version is recorded on every LLM call."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Prompt:
    name: str
    version: str
    template: str

    def render(self, **values: str) -> str:
        return self.template.format(**values)


CAPABILITY_ROUTER = Prompt(
    "capability-router",
    "2",
    """You route enterprise requests to registered capabilities.
Pick ONLY from the capability names listed below. Choose every capability needed to
fully answer the request (several if the user asks for several things), or none.

Capabilities:
{catalog}

Recent conversation:
{history}

Request: {message}

Return JSON: {{"capabilities": ["<name>", ...], "reason": "<short reason>"}}""",
)

PLANNER = Prompt(
    "workflow-planner",
    "2",
    """You design execution plans for an agent platform. Use ONLY the capabilities listed.
Steps run in parallel unless they depend on each other. To pass data, use input_mapping
values of the form "$steps.<step_id>.output" or "$steps.<step_id>.output.<field>".

Capabilities:
{catalog}

Request: {message}

Return JSON: {{"steps": [{{"step_id": "s1", "capability": "<name>", "depends_on": [],
"input": {{}}, "input_mapping": {{}}}}]}}""",
)

RAG_ANSWER = Prompt(
    "rag-answer",
    "2",
    """Answer the question using ONLY the numbered sources below. Cite sources inline as [n].
If the sources do not contain the answer, say so plainly.

Sources:
{sources}

Question: {question}""",
)

COMPOSE = Prompt(
    "response-composer",
    "1",
    """Write a concise answer to the user's request from these agent results.
Do not invent numbers; use only the data given.

Request: {message}

Results:
{results}""",
)

GENERAL_CHAT = Prompt(
    "general-chat",
    "1",
    """You are the assistant of an enterprise agent platform. Answer briefly.
If the user asks for data, explain which of these capabilities could help: {capabilities}""",
)
