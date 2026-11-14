"""Readable request and pipeline log, for a terminal or Render's Logs tab.

Every request gets one line (method, path, who sent it) plus its JSON body and the response; every step
of the fact-check flow gets one line tagged with its claim or review id, so one check reads top to bottom:

    19:20:01  POST /recheck  as p-ada
              body                 {"factId":"f-compx-price"}
              → response           202 {"accepted":true,"facts":1}
              [c-1a2b3c]           context.dev     scrape https://www.notion.com/pricing
              [c-1a2b3c]           gemini.verdict  outdated: $8 → $10 · card "Fact outdated", criticality high
              [c-1a2b3c]           sse.publish     #42 claim.verdict

INLOOK_LOG_LEVEL (default INFO) sets the level of every `inlook.*` logger; WARNING hides the flow and keeps
problems. Request and response bodies are cut at 300 characters; headers are never logged.
"""
import json
import logging
import os
import sys
import time
from contextvars import ContextVar

logger = logging.getLogger("inlook.flow")
PAD = " " * 10
_configured = False
# The claim, check or review the current step belongs to. Each background task gets its own copy.
TAG: ContextVar[str] = ContextVar("flow_tag", default="-")


def setup() -> None:
    """Send `inlook.*` logs to stdout (Render reads stdout), once. uvicorn configures only its own loggers."""
    global _configured
    if _configured:
        return
    _configured = True
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(message)s"))
    root = logging.getLogger("inlook")
    root.addHandler(handler)
    root.setLevel(os.getenv("INLOOK_LOG_LEVEL", "INFO").upper())
    root.propagate = False


def short(value, limit: int = 300) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text if len(text) <= limit else text[: limit - 1] + "…"


def step(service: str, text: str) -> None:
    """One step of the flow, tagged with the current claim / check / review id."""
    logger.info("%s%s %s %s", PAD, f"[{TAG.get()}]".ljust(20), service.ljust(15), text)


def line(text: str) -> None:
    """A line of its own, with the time."""
    logger.info("%s  %s", time.strftime("%H:%M:%S"), text)


# Requests that would only add noise: Render's health check polls /health every few seconds.
QUIET = {("GET", "/health")}


class RequestLog:
    """ASGI middleware: logs each HTTP request with its JSON body and the response status and JSON body.
    Streaming responses (GET /stream) are not read; the stream endpoint logs its own connects."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or (scope["method"], scope["path"]) in QUIET or scope["path"] == "/stream":
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope.get("headers", [])}
        user = headers.get("x-inlook-user")
        line(f"{scope['method']} {scope['path']}" + (f"  as {user}" if user else ""))
        started = time.monotonic()
        chunks: list[bytes] = []

        async def receive_logged():
            message = await receive()
            if message["type"] == "http.request":
                chunks.append(message.get("body", b""))
                if not message.get("more_body"):
                    body = b"".join(chunks)
                    if body:
                        try:
                            text = short(json.loads(body))
                        except ValueError:
                            text = f"<{len(body)} bytes>"
                        step_body(text)
            return message

        status = {"code": 0, "json": False}
        out: list[bytes] = []

        async def send_logged(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                kinds = [v for k, v in message.get("headers", []) if k.lower() == b"content-type"]
                status["json"] = bool(kinds) and b"json" in kinds[0]
            elif message["type"] == "http.response.body":
                if status["json"]:
                    out.append(message.get("body", b""))
                if not message.get("more_body"):
                    body = b"".join(out)
                    ms = round((time.monotonic() - started) * 1000)
                    shown = short(body.decode("utf-8", "replace")) if body else ""
                    logger.info("%s%s %s %s %s", PAD, "→ response".ljust(20), status["code"], shown, f"({ms} ms)")
            await send(message)

        await self.app(scope, receive_logged, send_logged)


def step_body(text: str) -> None:
    logger.info("%s%s %s", PAD, "body".ljust(20), text)
