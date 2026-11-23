"""Capability Resolver (Arch §7, LLD §7.1).

Resolution pipeline — every output is a capability that exists in the
Registry; the LLM can only *choose among* registered capabilities:

1. explicit ``ChatRequest.capabilities`` (for applications that know what they want);
2. attachments → document question answering;
3. deterministic matching against routing hints declared in agent manifests
   (keywords, examples, capability name segments). No domain words live here;
4. optional LLM classification bounded by the catalog (``RESOLVER_MODE``);
5. fallback to ``platform.chat.general``.
"""

from __future__ import annotations

import logging
import re

from ai_agents.registry import AgentRegistry
from ai_core.config import Settings
from ai_core.errors import LLMError, RoutingError
from ai_core.models import CapabilityInfo, CapabilityMatch, CapabilityResolution, ChatRequest, UserContext
from ai_llm.gateway import LLMGateway
from ai_llm.prompts import CAPABILITY_ROUTER

logger = logging.getLogger("ai_orchestration.resolver")

DOCUMENT_ANSWER = "platform.document.answer"
GENERAL_CHAT = "platform.chat.general"
CHART = "platform.chart.generate"
AGGREGATE = "platform.result.aggregate"

GENERIC_SEGMENTS = {
    "read", "write", "get", "list", "create", "update", "delete", "generate", "answer", "query", "search",
    "platform", "general", "data", "info", "run", "execute", "v1", "v2",
}
_WORD = re.compile(r"[a-z0-9]+")


def _stem(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def normalize(text: str) -> list[str]:
    return [_stem(w) for w in _WORD.findall(text.lower())]


class KeywordScorer:
    def score(self, message: str, cap: CapabilityInfo) -> tuple[float, str]:
        words = normalize(message)
        text = " " + " ".join(words) + " "
        wordset = set(words)
        score, hits = 0.0, []
        for kw in cap.keywords:
            phrase = " ".join(normalize(kw))
            if phrase and f" {phrase} " in text:
                weight = 1.5 if " " in phrase else 1.0
                score += weight
                hits.append(kw)
        for seg in cap.name.split("."):
            seg = _stem(seg)
            if seg not in GENERIC_SEGMENTS and seg in wordset and seg not in hits:
                score += 0.5
                hits.append(seg)
        best_example = 0.0
        for example in cap.examples:
            ex = set(normalize(example)) - GENERIC_SEGMENTS
            if ex:
                best_example = max(best_example, len(ex & wordset) / len(ex))
        if best_example >= 0.6:
            score += best_example
            hits.append(f"example~{best_example:.2f}")
        return score, ", ".join(hits)


class CapabilityResolver:
    def __init__(self, registry: AgentRegistry, llm: LLMGateway, settings: Settings) -> None:
        self.registry = registry
        self.llm = llm
        self.settings = settings
        self.scorer = KeywordScorer()

    async def resolve(
        self, request: ChatRequest, user: UserContext, history: list[dict] | None = None
    ) -> CapabilityResolution:
        catalog = await self.registry.catalog(user.tenant_id)
        by_name = {c.name: c for c in catalog}

        # 1. explicit
        if request.capabilities:
            unknown = [c for c in request.capabilities if c not in by_name]
            if unknown:
                raise RoutingError(
                    f"Unknown capabilities requested: {', '.join(unknown)}", code="UNKNOWN_CAPABILITY",
                    details={"unknown": unknown},
                )
            return CapabilityResolution(
                matches=[CapabilityMatch(capability=c, score=1.0, method="explicit") for c in request.capabilities],
                method="explicit",
                confidence=1.0,
            )

        matches: list[CapabilityMatch] = []
        # 2. attachments
        if request.attachments and DOCUMENT_ANSWER in by_name:
            matches.append(CapabilityMatch(capability=DOCUMENT_ANSWER, score=10.0, method="attachment",
                                           reason="request has attachments"))

        routable = [c for c in catalog if not c.internal and c.routable]
        # Non-routable (down/disabled) capabilities are still matched so the user gets an explicit
        # "temporarily unavailable" answer instead of a misleading "I don't understand".
        matchable = [c for c in catalog if not c.internal]

        # 3. deterministic
        keyword_matches = []
        if self.settings.resolver_mode in ("keyword", "hybrid"):
            for cap in matchable:
                score, reason = self.scorer.score(request.message, cap)
                if score >= 1.0:
                    if not cap.routable:
                        reason += " (no healthy agent)"
                    keyword_matches.append(CapabilityMatch(capability=cap.name, score=score, method="keyword",
                                                           reason=reason))
            if keyword_matches:
                top = max(m.score for m in keyword_matches)
                keyword_matches = [m for m in keyword_matches if m.score >= 0.4 * top]
        for m in sorted(keyword_matches, key=lambda m: -m.score):
            if m.capability not in {x.capability for x in matches}:
                matches.append(m)

        # 4. LLM (bounded by registry)
        use_llm = self.settings.resolver_mode == "llm" or (
            self.settings.resolver_mode == "hybrid" and not matches and not self.llm.is_mock
        )
        method = "keyword"
        if use_llm and routable:
            llm_matches = await self._llm_resolve(request, user, routable, history or [])
            if llm_matches:
                method = "llm"
                for m in llm_matches:
                    if m.capability not in {x.capability for x in matches}:
                        matches.append(m)

        # 5. fallback
        if not matches:
            if GENERAL_CHAT in by_name:
                matches.append(CapabilityMatch(capability=GENERAL_CHAT, score=0.0, method="fallback",
                                               reason="no capability matched"))
            method = "fallback"
        elif matches[0].method == "attachment":
            method = "attachment"

        confidence = 1.0 if method in ("explicit", "attachment") else min(1.0, (matches[0].score / 2) if matches else 0)
        if method == "llm":
            confidence = 0.7
        resolution = CapabilityResolution(matches=matches, method=method, confidence=round(confidence, 2))
        logger.info("capability_resolution method=%s capabilities=%s", method, resolution.capabilities)
        return resolution

    async def _llm_resolve(
        self, request: ChatRequest, user: UserContext, routable: list[CapabilityInfo], history: list[dict]
    ) -> list[CapabilityMatch]:
        catalog_text = "\n".join(
            f"- {c.name}: {c.description} (e.g. {'; '.join(c.examples[:2])})" for c in routable
        )
        hist = "\n".join(f"{m['role']}: {m['content'][:200]}" for m in history[-6:]) or "(none)"
        try:
            response = await self.llm.chat(
                CAPABILITY_ROUTER.render(catalog=catalog_text, history=hist, message=request.message),
                purpose="router",
                response_format="json",
                tenant_id=user.tenant_id,
                user_id=user.user_id,
                request_id=request.request_id,
            )
        except LLMError:
            logger.warning("LLM capability resolution failed; continuing without it", exc_info=True)
            return []
        names = {c.name for c in routable}
        picked = (response.parsed or {}).get("capabilities", []) if isinstance(response.parsed, dict) else []
        rejected = [p for p in picked if p not in names]
        if rejected:
            logger.warning("LLM proposed unregistered capabilities (ignored): %s", rejected)
        return [
            CapabilityMatch(capability=p, score=1.0, method="llm", reason=(response.parsed or {}).get("reason", ""))
            for p in picked
            if p in names
        ]
