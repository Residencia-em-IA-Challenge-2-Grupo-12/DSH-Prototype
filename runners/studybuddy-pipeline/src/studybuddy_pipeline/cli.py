"""Loopback CLI entrypoint for the StudyBuddy A1/A2 FastAPI HTTP runner."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import sys
from typing import Literal

import uvicorn

from .app import RunnerConfig, create_app

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="StudyBuddy A1/A2 http-runner-v1 server")
    parser.add_argument("--pipeline", choices=("a1", "a2"), required=True)
    parser.add_argument("--base-url", required=True, help="OpenAI-compatible /v1 base URL")
    parser.add_argument("--model", required=True, help="Model ID")
    parser.add_argument("--host", default="127.0.0.1", help="Loopback bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind (0 for ephemeral)")
    parser.add_argument("--mode", choices=("live", "scripted"), default="live")
    parser.add_argument("--reasoning-effort", default=None)
    parser.add_argument("--engine-name", default=None)
    return parser.parse_args(argv)


async def _serve(args: argparse.Namespace) -> None:
    if args.host.lower() not in LOOPBACK_HOSTS:
        raise ValueError("StudyBuddy pipeline runner must bind to loopback only (127.0.0.1, localhost, or ::1)")

    api_key = os.environ.get("STUDY_RUNNER_API_KEY") or None
    study_role = os.environ.get("STUDY_RUNNER_ROLE")
    extra_headers = {"x-study-role": study_role} if study_role else {}

    pipeline: Literal["a1", "a2"] = args.pipeline
    mode: Literal["live", "scripted"] = args.mode
    config = RunnerConfig(
        pipeline=pipeline,
        base_url=args.base_url,
        model=args.model,
        api_key=api_key,
        mode=mode,
        reasoning_effort=args.reasoning_effort,
        engine_name=args.engine_name,
        extra_headers=extra_headers,
    )
    app = create_app(config)

    family = socket.AF_INET6 if ":" in args.host else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((args.host, args.port))
    sock.listen(128)
    sock.setblocking(False)

    actual_port = sock.getsockname()[1]
    host_display = f"[{args.host}]" if ":" in args.host else args.host
    url = f"http://{host_display}:{actual_port}"

    uvi_config = uvicorn.Config(app, host=args.host, port=actual_port, log_level="warning")
    server = uvicorn.Server(uvi_config)

    async def announce_when_ready() -> None:
        while not server.started:
            await asyncio.sleep(0.01)
        ready = {
            "ready": True,
            "url": url,
            "port": actual_port,
            "pipeline": pipeline,
            "model": args.model,
            "mode": mode,
        }
        print(json.dumps(ready), flush=True)

    announcer = asyncio.create_task(announce_when_ready())
    try:
        await server.serve(sockets=[sock])
    finally:
        announcer.cancel()
        try:
            sock.close()
        except OSError:
            pass


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    try:
        asyncio.run(_serve(args))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
