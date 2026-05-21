#!/usr/bin/env python3
"""
OpenClaude gRPC CLI client (Python).

Connects to the headless gRPC server, sends a message, and streams
responses interactively — text chunks, tool calls, permission prompts.

Usage:
  python python/grpc_client/client.py [--host HOST] [--port PORT] [--message MSG]
"""

from __future__ import annotations

import argparse
import os
import sys
import asyncio
from pathlib import Path

# Ensure the protobuf stubs can be found when run from the repo root
_GRPC_DIR = Path(__file__).resolve().parent
if str(_GRPC_DIR) not in sys.path:
    sys.path.insert(0, str(_GRPC_DIR))

import grpc
import openclaude_pb2 as pb2
import openclaude_pb2_grpc as pb2_grpc


# ── Helpers ─────────────────────────────────────────────────────────────────


def _shorten(s: str, maxlen: int = 500) -> str:
    return s if len(s) <= maxlen else s[:maxlen] + f"\n(…truncated {len(s)} chars)"


# ── Event handler ──────────────────────────────────────────────────────────


async def handle_stream(call: grpc.aio.StreamStreamCall):
    """Read server messages from the bidirectional stream and handle them."""
    text_streamed = False

    async for msg in call:
        field = msg.WhichOneof("event")

        try:

            if field == "text_chunk":
                sys.stdout.write(msg.text_chunk.text)
                sys.stdout.flush()
                text_streamed = True

            elif field == "tool_start":
                tool = msg.tool_start
                print(f"\n\033[36m[Tool Call]\033[0m \033[1m{tool.tool_name}\033[0m")
                print(f"\033[90m{tool.arguments_json}\033[0m\n")

            elif field == "tool_result":
                result = msg.tool_result
                print(f"\n\033[32m[Tool Result]\033[0m \033[1m{result.tool_name}\033[0m")
                print(f"\033[90m{_shorten(result.output)}\033[0m\n")

            elif field == "action_required":
                action = msg.action_required
                if action.type == pb2.ActionRequired.CONFIRM_COMMAND:
                    print(f"\n\033[33m[Permission Required]\033[0m {action.question}")
                    ans = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: input("Proceed? (y/N): ")
                    )
                    reply = "y" if ans.strip().lower().startswith("y") else "n"
                else:
                    print(f"\n\033[33m[Input Required]\033[0m {action.question}")
                    reply = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: input("> ")
                    )
                await call.write(
                    pb2.ClientMessage(input=pb2.UserInput(reply=reply, prompt_id=action.prompt_id))
                )

            elif field == "done":
                final = msg.done
                if text_streamed:
                    print()
                print(
                    f"\n\033[90m[ tokens: {final.prompt_tokens} in / "
                    f"{final.completion_tokens} out ]\033[0m"
                )

            elif field == "error":
                err = msg.error
                print(f"\n\033[31m[Error] {err.code}: {err.message}\033[0m", file=sys.stderr)

        except asyncio.InvalidStateError:
            # Stream was closed by the server while we were processing — stop
            break


# ── Main ───────────────────────────────────────────────────────────────────


async def main():
    parser = argparse.ArgumentParser(description="OpenClaude gRPC CLI client")
    parser.add_argument("--host", default=os.environ.get("GRPC_HOST", "localhost"))
    parser.add_argument("--port", default=os.environ.get("GRPC_PORT", "50051"))
    parser.add_argument("--message", default=None, help="Initial message to send")
    parser.add_argument(
        "--working-dir",
        default=os.environ.get("GRPC_WORKING_DIR", os.getcwd()),
        help="Working directory for the agent",
    )
    parser.add_argument("--model", default=None, help="Model override")
    parser.add_argument("--session-id", default="", help="Session ID for persistence")
    args = parser.parse_args()

    target = f"{args.host}:{args.port}"
    print(f"\033[32mOpenClaude gRPC CLI\033[0m")
    print(f"\033[90mConnecting to {target} …\033[0m")

    async with grpc.aio.insecure_channel(target) as channel:
        # Wait up to 5 s for the server to be reachable
        try:
            await grpc.aio.channel_ready_future(channel)
        except asyncio.TimeoutError:
            print(
                f"\033[31mCould not reach gRPC server at {target} — "
                f"is it running?\033[0m",
                file=sys.stderr,
            )
            return

        stub = pb2_grpc.AgentServiceStub(channel)
        call = stub.Chat()

        # ── Get initial message ──────────────────────────────────────
        message = args.message
        if not message:
            message = await asyncio.get_event_loop().run_in_executor(
                None, lambda: input("\033[35m> \033[0m")
            )
        if message.strip().lower() in ("/exit", "/quit"):
            print("Bye!")
            return

        # ── Send ChatRequest ──────────────────────────────────────────
        req = pb2.ChatRequest(
            message=message,
            working_directory=str(Path(args.working_dir).resolve()),
            session_id=args.session_id,
        )
        if args.model:
            req.model = args.model

        try:
            await call.write(pb2.ClientMessage(request=req))
        except (grpc.aio.AioRpcError, asyncio.InvalidStateError) as exc:
            reason = str(exc) if isinstance(exc, asyncio.InvalidStateError) else f"{exc.code()} — {exc.details()}"
            print(f"\033[31mFailed to send request: {reason}\033[0m", file=sys.stderr)
            return

        # ── Handle the stream ─────────────────────────────────────────
        try:
            await handle_stream(call)
        except grpc.aio.AioRpcError as exc:
            print(f"\n\033[31mgRPC error: {exc.code()} — {exc.details()}\033[0m", file=sys.stderr)
        except asyncio.InvalidStateError:
            pass  # stream ended gracefully
        finally:
            try:
                await call.done_writing()
            except (grpc.aio.AioRpcError, asyncio.InvalidStateError):
                pass


def entry():
    asyncio.run(main())


if __name__ == "__main__":
    entry()
