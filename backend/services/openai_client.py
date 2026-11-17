"""OpenAI API client wrapper for SSD_Scoring."""

from __future__ import annotations

import base64
import json
import os
import random
import re
import threading
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import APIConnectionError, APITimeoutError, OpenAI, RateLimitError

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
DEFAULT_VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4o")
DEFAULT_MAX_TOKENS = int(os.getenv("OPENAI_MAX_TOKENS", "4096"))
# Without a timeout one stuck request can stall the whole document job.
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "120"))
MAX_RETRIES = 5

_client_lock = threading.Lock()
_client_cache: OpenAI | None = None
_client_cache_key: str | None = None


class OpenAIConfigError(ValueError):
    """Raised when required OpenAI configuration is missing."""


def get_client() -> OpenAI:
    """Return a shared OpenAI client (thread-safe, reused across calls)."""
    global _client_cache, _client_cache_key

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise OpenAIConfigError(
            "OPENAI_API_KEY is not set. Copy .env.example to .env and add your API key."
        )

    with _client_lock:
        if _client_cache is None or _client_cache_key != api_key:
            # max_retries=0: retry policy lives in _create_with_retries only,
            # so SDK-level retries do not multiply the worst-case latency.
            _client_cache = OpenAI(
                api_key=api_key,
                timeout=DEFAULT_TIMEOUT_SECONDS,
                max_retries=0,
            )
            _client_cache_key = api_key
        return _client_cache


def _rate_limit_wait_seconds(exc: Exception, attempt: int) -> float:
    """Wait long enough for a per-minute (TPM/RPM) rate limit to clear.

    The 429 message's "Please try again in 2.442s" hint assumes a single
    caller; with several concurrent workers the freed budget is instantly
    consumed by another worker, so waiting only the hinted time keeps
    losing the race. Wait at least an exponentially growing floor (the
    per-minute budget fully refreshes within 60s) plus jitter so workers
    do not retry in lockstep.
    """
    floor = min(3.0 * (2**attempt), 90.0)
    hint = 0.0
    match = re.search(r"try again in ([0-9.]+)s", str(exc))
    if match:
        hint = float(match.group(1)) + 0.5
    return max(hint, floor) + random.uniform(0.0, 2.0)


def _create_with_retries(client: OpenAI, kwargs: dict[str, Any]) -> str:
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            response = client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content
            if not content:
                raise RuntimeError("OpenAI returned an empty response.")
            return content
        except RateLimitError as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(_rate_limit_wait_seconds(exc, attempt))
        except (APITimeoutError, APIConnectionError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(2**attempt)
            else:
                raise

    raise RuntimeError("OpenAI API call failed after retries.") from last_error


def _parse_json_response(raw: str) -> dict[str, Any]:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM response is not valid JSON: {raw}") from exc


def call_llm(
    system_prompt: str,
    user_content: str,
    *,
    model: str | None = None,
    temperature: float = 0.0,
    max_tokens: int | None = None,
    json_mode: bool = False,
) -> str:
    """
    Call the OpenAI chat completion API.

    Prompts are passed in from outside so prompt authors (task 3/4) can change
    them without editing this module.
    """
    client = get_client()
    model = model or DEFAULT_MODEL
    max_tokens = max_tokens or DEFAULT_MAX_TOKENS

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    return _create_with_retries(client, kwargs)


def call_llm_json(
    system_prompt: str,
    user_content: str,
    **kwargs: Any,
) -> dict[str, Any]:
    """Call LLM with JSON mode and parse the response.

    The model occasionally emits malformed JSON even in JSON mode; one
    fresh call usually recovers, so retry once before giving up.
    """
    raw = call_llm(system_prompt, user_content, json_mode=True, **kwargs)
    try:
        return _parse_json_response(raw)
    except ValueError:
        raw = call_llm(system_prompt, user_content, json_mode=True, **kwargs)
        return _parse_json_response(raw)


def call_vision_json(
    system_prompt: str,
    user_text: str,
    image_bytes: bytes,
    *,
    image_mime: str = "image/png",
    model: str | None = None,
    temperature: float = 0.0,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """
    Call a vision-capable chat model with one page image and parse JSON.

    Used for magazine-layout love-article pages where writer/target labels are
    spatially separated from article bodies.
    """
    client = get_client()
    model = model or DEFAULT_VISION_MODEL
    max_tokens = max_tokens or DEFAULT_MAX_TOKENS
    b64 = base64.b64encode(image_bytes).decode("ascii")

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{image_mime};base64,{b64}",
                            "detail": "high",
                        },
                    },
                ],
            },
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }

    raw = _create_with_retries(client, kwargs)
    try:
        return _parse_json_response(raw)
    except ValueError:
        raw = _create_with_retries(client, kwargs)
        return _parse_json_response(raw)


if __name__ == "__main__":
    # Smoke test: run after setting OPENAI_API_KEY in .env
    reply = call_llm(
        system_prompt="You are a helpful assistant. Reply in Korean.",
        user_content="Say 'API 연동 OK' only.",
    )
    print(reply)
