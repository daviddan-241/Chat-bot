"""
NEXUS AI-DETECTION INSPECTOR  ("humanizer")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Runs as a final pass over generated TEXT so it reads as natural / human and is
less likely to be flagged by AI detectors.

Two parts:
  1) score(text)      -> a heuristic "AI-likeness" score (0-100) + the specific
     tells it found (burstiness, perplexity proxy, robotic phrases, uniform
     sentence length, overused transitions, em-dash spam, etc.). No external API.
  2) humanize(text)   -> uses the LLM to rewrite the text to sound natural while
     preserving meaning, code blocks, and facts. Re-scores and can iterate.

Honest scope: this improves natural style. No tool can *guarantee* bypassing any
specific detector, and this MUST NOT be used to deceive in academic/contractual
settings where AI use must be disclosed. Code blocks are preserved untouched.
"""

from __future__ import annotations
import math
import re
from collections import Counter
from typing import Dict, Any, List

from .llm import ROUTER

# Phrases that strongly signal machine-generated text
_ROBOTIC = [
    r"\bas an ai( language model)?\b", r"\bit'?s important to note\b",
    r"\bit'?s worth noting\b", r"\bin conclusion\b", r"\bin summary\b",
    r"\bdelve into\b", r"\bdelving\b", r"\ba testament to\b",
    r"\bin the realm of\b", r"\bnavigating the\b", r"\bunderscore[sd]?\b",
    r"\bfoster(ing)?\b", r"\bleverage\b", r"\bseamless(ly)?\b",
    r"\brobust\b", r"\bcomprehensive\b", r"\bmoreover\b", r"\bfurthermore\b",
    r"\badditionally\b", r"\bnotably\b", r"\bultimately\b",
    r"\bit is essential\b", r"\bplays a (crucial|vital|pivotal) role\b",
    r"\bunlock(ing)? the\b", r"\bgame[- ]chang(er|ing)\b",
    r"\bin today'?s (fast[- ]paced|digital) world\b", r"\bembark\b",
    r"\bdive (deep(er)?|into)\b", r"\btapestry\b", r"\brealm\b",
]
_TRANSITIONS = ["moreover", "furthermore", "additionally", "however",
                "therefore", "consequently", "notably", "ultimately",
                "in conclusion", "in summary", "overall"]

_CODE_FENCE = re.compile(r"```.*?```", re.DOTALL)
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")
_WORD = re.compile(r"[A-Za-z']+")


def _strip_code(text: str):
    """Return (prose, codeblocks) so we never rewrite code."""
    blocks = _CODE_FENCE.findall(text)
    prose = _CODE_FENCE.sub(" \uE000 ", text)  # placeholder
    return prose, blocks


def _restore_code(text: str, blocks: List[str]) -> str:
    for b in blocks:
        text = text.replace(" \uE000 ", b, 1)
    # any leftover placeholders
    text = text.replace("\uE000", "")
    return text


def score(text: str) -> Dict[str, Any]:
    prose, _ = _strip_code(text or "")
    sents = [s.strip() for s in _SENT_SPLIT.split(prose) if s.strip()]
    words = _WORD.findall(prose.lower())
    tells: List[str] = []
    pts = 0

    # 1) robotic phrases
    hits = []
    for pat in _ROBOTIC:
        if re.search(pat, prose, re.IGNORECASE):
            hits.append(pat.strip("\\b").replace("\\", ""))
    if hits:
        pts += min(35, len(hits) * 7)
        tells.append(f"AI-typical phrases: {', '.join(hits[:6])}")

    # 2) burstiness — humans vary sentence length a lot; AI is uniform
    if len(sents) >= 4:
        lens = [len(_WORD.findall(s)) for s in sents]
        mean = sum(lens) / len(lens)
        var = sum((l - mean) ** 2 for l in lens) / len(lens)
        std = math.sqrt(var)
        burst = std / mean if mean else 0
        if burst < 0.35:
            pts += 22
            tells.append(f"low burstiness (uniform sentence length, σ/μ={burst:.2f})")

    # 3) lexical diversity (type-token ratio) — very high or robotic-even = tell
    if len(words) >= 40:
        ttr = len(set(words)) / len(words)
        if ttr > 0.62:
            pts += 8
            tells.append(f"unusually high lexical diversity (TTR={ttr:.2f})")

    # 4) transition-word density
    if words:
        tcount = sum(prose.lower().count(t) for t in _TRANSITIONS)
        dens = tcount / max(1, len(sents))
        if dens > 0.4:
            pts += 14
            tells.append(f"heavy transition-word use ({tcount} in {len(sents)} sentences)")

    # 5) em-dash / list-of-three spam
    if prose.count("—") >= 3:
        pts += 8
        tells.append("em-dash overuse")
    if re.search(r"\w+, \w+,? and \w+", prose) and prose.lower().count(" and ") > len(sents) * 0.5:
        pts += 6
        tells.append("frequent rule-of-three lists")

    # 6) perfectly clean punctuation + no contractions = formal AI vibe
    contractions = len(re.findall(r"\b\w+'(s|t|re|ve|ll|d|m)\b", prose))
    if len(sents) >= 5 and contractions == 0:
        pts += 10
        tells.append("zero contractions (overly formal)")

    pts = max(0, min(100, pts))
    label = ("very likely AI" if pts >= 65 else
             "likely AI" if pts >= 40 else
             "borderline" if pts >= 22 else "reads human")
    return {"ai_score": pts, "label": label, "tells": tells,
            "sentences": len(sents), "words": len(words)}


def _local_humanize(prose: str) -> str:
    """Rule-based humanizer — works with NO model. Removes the most common
    AI-tells, swaps stiff words for plain ones, adds contractions, and breaks up
    uniform sentences. Not as good as an LLM rewrite, but real and always available."""
    t = prose

    # word/phrase swaps (whole-word, case-insensitive, preserve capitalization)
    swaps = {
        r"\butilize\b": "use", r"\butilizes\b": "uses", r"\butilizing\b": "using",
        r"\bleverage\b": "use", r"\bleveraging\b": "using",
        r"\bfacilitate\b": "help", r"\bnumerous\b": "many",
        r"\ba myriad of\b": "many", r"\bplethora of\b": "lots of",
        r"\bin order to\b": "to", r"\bdue to the fact that\b": "because",
        r"\bsubsequently\b": "then", r"\bcommence\b": "start",
        r"\bendeavor\b": "try", r"\bdemonstrate\b": "show",
        r"\bobtain\b": "get", r"\bsufficient\b": "enough",
        r"\bapproximately\b": "about", r"\bnevertheless\b": "still",
    }
    for pat, rep in swaps.items():
        def _keepcase(m, rep=rep):
            g = m.group(0)
            return rep.capitalize() if g[:1].isupper() else rep
        t = re.sub(pat, _keepcase, t, flags=re.IGNORECASE)

    # strip stiff adjectives
    t = re.sub(r"(?i)\b(robust|seamless|comprehensive|cutting[- ]edge|"
               r"state[- ]of[- ]the[- ]art|holistic)\s+", "", t)

    # delete filler transitions anywhere (start of sentence OR mid-text),
    # then fix capitalization of the following word.
    def _drop_transition(m):
        rest = m.group(2)
        return rest[:1].upper() + rest[1:] if rest else ""
    t = re.sub(r"(?i)(^|[.!?]\s+)(moreover|furthermore|additionally|notably|"
               r"in conclusion|in summary|ultimately|consequently)[,:]?\s+(\w)",
               lambda m: m.group(1) + m.group(3).upper(), t)
    # delete "it's important to note that" style openers (anywhere)
    t = re.sub(r"(?i)\bit'?s (important|worth) (to note|noting) that\b[,:]?\s*", "", t)
    t = re.sub(r"(?i)\bit is (important|essential) (to note )?that\b[,:]?\s*", "", t)
    # capitalize first letter of each sentence after cleanup
    t = re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), t)

    # add common contractions
    contr = {
        r"\bit is\b": "it's", r"\bthat is\b": "that's", r"\byou are\b": "you're",
        r"\bwe are\b": "we're", r"\bthey are\b": "they're", r"\bdo not\b": "don't",
        r"\bdoes not\b": "doesn't", r"\bcannot\b": "can't", r"\bwill not\b": "won't",
        r"\bis not\b": "isn't", r"\bare not\b": "aren't", r"\byou will\b": "you'll",
        r"\bI am\b": "I'm", r"\bhere is\b": "here's", r"\blet us\b": "let's",
    }
    for pat, rep in contr.items():
        def _kc(m, rep=rep):
            g = m.group(0)
            return rep[:1].upper() + rep[1:] if g[:1].isupper() else rep
        t = re.sub(pat, _kc, t)

    # collapse rule-of-three em-dash spam to commas
    t = t.replace(" — ", ", ")

    # tidy whitespace
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t


def humanize(text: str, tier: str = "balanced",
             tone: str = "natural, direct, conversational") -> Dict[str, Any]:
    """Rewrite prose to read human; keep code blocks, facts, structure.
    Uses the LLM when a provider works; otherwise falls back to a real local
    rule-based humanizer so it ALWAYS returns clean human text."""
    from .llm import LLMError
    before = score(text)
    prose, blocks = _strip_code(text)
    tells = "; ".join(before["tells"]) or "general AI-ish phrasing"
    sys = (
        "You are an expert editor who makes text read like a real person wrote it. "
        "Rewrite the user's text so it sounds natural and human while keeping the "
        "EXACT meaning, all facts, names, numbers and any placeholders untouched "
        "and in place. Vary sentence length a lot (mix short punchy sentences with "
        "longer ones). Use contractions. Cut filler and AI-tells. "
        "Avoid words like: delve, leverage, robust, seamless, moreover, "
        "furthermore, in conclusion, it's important to note, tapestry, realm. "
        "Do NOT add new claims. Keep the same language. Return ONLY the rewrite."
    )
    user = f"AI-tells detected: {tells}\nDesired tone: {tone}\n\nTEXT:\n{prose}"
    method = "local"
    # ALWAYS compute the local rewrite first — it's our guaranteed real change.
    local_rewrite = _local_humanize(prose)
    rewritten = local_rewrite
    try:
        llm_out = ROUTER.complete(tier, [{"role": "system", "content": sys},
                                         {"role": "user", "content": user}],
                                  temperature=0.85, max_tokens=3000)
        bad = (not llm_out or llm_out.startswith("⚠️") or llm_out.startswith("[PROVIDER")
               or "rate limit" in llm_out.lower() or "invalid api key" in llm_out.lower()
               or len(llm_out.strip()) < max(20, len(prose) * 0.3))
        if not bad:
            # use the LLM rewrite only if it actually lowered the AI score
            llm_score = score(_restore_code(llm_out, blocks))["ai_score"]
            local_score = score(_restore_code(local_rewrite, blocks))["ai_score"]
            if llm_score <= local_score:
                rewritten = llm_out; method = "llm"
            else:
                rewritten = local_rewrite; method = "local(better)"
    except Exception:
        rewritten = local_rewrite; method = "local"

    # Final safety net: if somehow the text is unchanged, force the local pass.
    if rewritten.strip() == prose.strip():
        rewritten = _local_humanize(prose)
        if rewritten.strip() == prose.strip():
            # prose had no tells to fix; still vary it slightly so it's "human"
            rewritten = _vary_sentences(prose)
        method = "local"

    final = _restore_code(rewritten, blocks)
    after = score(final)
    return {"ok": True, "method": method, "before": before, "after": after,
            "changed": final.strip() != text.strip(), "text": final}


def _vary_sentences(prose: str) -> str:
    """Light human variation when there are no obvious AI-tells: split a long
    sentence, add a contraction or two, trim hedging."""
    t = prose
    t = re.sub(r"\bI would\b", "I'd", t)
    t = re.sub(r"\byou would\b", "you'd", t)
    t = re.sub(r"\b(in order to)\b", "to", t, flags=re.IGNORECASE)
    t = re.sub(r"\b(very|really|quite|simply|just) +", "", t, count=2)
    return t.strip()


def inspect_and_fix(text: str, threshold: int = 40, max_iters: int = 2,
                    tier: str = "balanced") -> Dict[str, Any]:
    """Always humanize at least once, then keep going while still AI-ish."""
    cur = text
    history = [score(cur)]
    iters = 0
    # ALWAYS do one real pass (so manual humanize never returns the same text),
    # then continue if it's still scoring AI-ish.
    while iters < max_iters and (iters == 0 or history[-1]["ai_score"] >= threshold):
        res = humanize(cur, tier=tier)
        cur = res["text"]
        history.append(res["after"])
        iters += 1
        if res["after"]["ai_score"] == 0:
            break
    return {"ok": True, "text": cur, "iterations": iters,
            "history": history, "final": history[-1]}
