"""OpenAI-compatible /chat/completions client without unsupported sampling params."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class StructuredOutputError(Exception):
    """Raised when LLM output fails JSON extraction or Pydantic validation."""

    def __init__(self, raw_text: str, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.raw_text = raw_text
        self.errors = errors


def extract_json_object(raw: str) -> Any:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _normalize_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "".join(parts)
    return ""


@dataclass
class OpenAICompatibleClient:
    base_url: str
    model: str
    api_key: str | None = None
    reasoning_effort: str | None = None
    max_tokens: int = 8192
    timeout_s: float = 120.0
    extra_headers: dict[str, str] = field(default_factory=dict)

    _client: httpx.AsyncClient = field(init=False, repr=False)
    llm_calls: int = 0
    has_usage: bool = False
    input_tokens: int = 0
    output_tokens: int = 0

    def __post_init__(self) -> None:
        if not self.base_url.strip():
            raise ValueError("base_url is required")
        self._endpoint = f"{self.base_url.rstrip('/')}/chat/completions"
        self._client = httpx.AsyncClient(timeout=self.timeout_s)

    async def close(self) -> None:
        await self._client.aclose()

    def usage_dict(self) -> dict[str, Any]:
        if not self.has_usage:
            return {"availability": "unknown"}
        return {
            "availability": "available",
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
        }

    def _record_usage(self, usage: Any) -> None:
        if not isinstance(usage, dict):
            return
        pt = usage.get("prompt_tokens", usage.get("input_tokens"))
        ct = usage.get("completion_tokens", usage.get("output_tokens"))
        if isinstance(pt, int) and pt >= 0 and isinstance(ct, int) and ct >= 0:
            self.has_usage = True
            self.input_tokens += pt
            self.output_tokens += ct

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool = False,
    ) -> str:
        # IMPORTANT: Never send temperature/top_p/top_k/presence_penalty because
        # models like openai/gpt-6-luna reject them under OpenRouter require_parameters:true.
        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": self.max_tokens,
            "stream": False,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        if self.reasoning_effort:
            body["reasoning_effort"] = self.reasoning_effort

        headers: dict[str, str] = {"content-type": "application/json", **self.extra_headers}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"

        self.llm_calls += 1
        response = await self._client.post(self._endpoint, headers=headers, json=body)
        if response.status_code >= 400:
            raise RuntimeError(
                f"Chat completions failed ({response.status_code}): {response.text[:300]}"
            )
        payload = response.json()
        self._record_usage(payload.get("usage"))
        choices = payload.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            raise RuntimeError("Model completion returned no choices")
        message = choices[0].get("message") or {}
        text = _normalize_content(message.get("content"))
        if not text.strip():
            raise RuntimeError("Model completion returned empty assistant content")
        return text

    async def complete_json(
        self,
        messages: list[dict[str, str]],
        model_cls: type[T],
    ) -> tuple[T, str]:
        raw = await self.complete(messages, json_mode=True)
        try:
            data = extract_json_object(raw)
        except Exception as exc:
            raise StructuredOutputError(raw, [f"Invalid JSON syntax: {exc}"]) from exc

        try:
            parsed = model_cls.model_validate(data)
        except ValidationError as exc:
            errs = [
                f"{'.'.join(str(p) for p in err.get('loc', ())) or 'root'}: {err.get('msg')}"
                for err in exc.errors()
            ]
            raise StructuredOutputError(raw, errs) from exc
        return parsed, raw
