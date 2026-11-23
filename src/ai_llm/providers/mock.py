"""Deterministic offline provider.

Lets the whole platform run, demo and test without network access or API keys:
* RAG answers are *extractive* (best-matching sentences from retrieved context);
* embeddings use feature hashing, which gives genuinely useful lexical recall.
Configure a real provider with ``LLM_PROVIDER`` for generative behaviour.
"""

from __future__ import annotations

import hashlib
import json
import math
import re

from ai_core.models import EmbeddingResponse, LLMRequest, LLMResponse, LLMUsage

_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = {
    "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "is", "are", "was", "what", "how", "which",
    "with", "by", "be", "this", "that", "it", "as", "at", "from", "do", "does", "i", "my", "me", "we", "our",
    "you", "your", "can", "please", "show", "tell", "about", "according",
}


def tokens(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 1]


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def hashed_embedding(text: str, dims: int) -> list[float]:
    vec = [0.0] * dims
    toks = tokens(text)
    feats = toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:], strict=False)]
    for feat in feats:
        h = int.from_bytes(hashlib.md5(feat.encode()).digest()[:8], "little")
        vec[h % dims] += 1.0 if (h >> 63) & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


class MockProvider:
    name = "mock"
    supports_embeddings = True

    def __init__(self, dimensions: int = 384) -> None:
        self.dimensions = dimensions

    async def generate(self, request: LLMRequest, model: str) -> LLMResponse:
        prompt = "\n".join(m.content for m in request.messages)
        purpose = request.purpose
        if request.response_format == "json":
            content = json.dumps({"capabilities": [], "steps": [], "note": "mock provider"})
        elif purpose == "rag":
            content = self._extractive_answer(
                request.metadata.get("query", prompt), request.metadata.get("contexts", [])
            )
        elif purpose == "compose":
            content = request.metadata.get("fallback", prompt[-1500:])
        else:
            content = (
                "I'm running on the platform's built-in offline model, so I can route requests to registered "
                "agents but I can't hold an open-ended conversation. Configure LLM_PROVIDER for generative answers."
            )
        return LLMResponse(
            content=content,
            provider=self.name,
            model=model,
            usage=LLMUsage(prompt_tokens=_approx_tokens(prompt), completion_tokens=_approx_tokens(content)),
            finish_reason="stop",
        )

    @staticmethod
    def _extractive_answer(query: str, contexts: list[str]) -> str:
        q = set(tokens(query))
        scored: list[tuple[float, int, str]] = []
        for idx, ctx in enumerate(contexts):
            for sentence in re.split(r"(?<=[.!?])\s+|\n+", ctx):
                s = sentence.strip()
                if len(s) < 20:
                    continue
                overlap = len(q & set(tokens(s)))
                if overlap:
                    scored.append((overlap + 0.01 * min(len(s), 200) / 200, idx, s))
        if not scored:
            return "I could not find an answer to that question in the provided documents."
        scored.sort(key=lambda x: -x[0])
        picked, seen = [], set()
        for _, idx, s in scored:
            if s in seen:
                continue
            seen.add(s)
            picked.append(f"{s} [{idx + 1}]")
            if len(picked) == 3:
                break
        return " ".join(picked)

    async def embed(self, texts: list[str], model: str) -> EmbeddingResponse:
        return EmbeddingResponse(
            vectors=[hashed_embedding(t, self.dimensions) for t in texts],
            provider=self.name,
            model=f"hashing-{self.dimensions}",
            usage=LLMUsage(prompt_tokens=sum(_approx_tokens(t) for t in texts)),
        )
