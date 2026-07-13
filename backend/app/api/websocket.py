"""WebSocket endpoints for audio streaming and terminal bridges."""

from __future__ import annotations

import asyncio
import base64
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.app.config import get_runtime_state
from backend.app.core.agent_manager import get_agent_manager
from backend.app.core.audio_processor import AudioProcessor
from backend.app.core.formatter import TextFormatter
from backend.app.core.transcriber import get_transcriber
from backend.app.security import websocket_is_authorized, websocket_token_protocol

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/audio")
async def audio_websocket(websocket: WebSocket) -> None:
    if not websocket_is_authorized(websocket):
        await websocket.close(code=4403, reason="Local API authorization required")
        return
    await websocket.accept(subprotocol=websocket_token_protocol(websocket))
    runtime_state = get_runtime_state()
    processor = AudioProcessor()
    formatter = TextFormatter(runtime_state)
    recording = False
    try:
        while True:
            message = await websocket.receive_json()
            action = message.get("action")

            if action == "start_recording":
                processor = AudioProcessor()
                processor.configure(
                    str(message.get("format") or "webm"),
                    int(message.get("sample_rate") or 0) or None,
                    int(message.get("channels") or 0) or None,
                )
                recording = True
                await websocket.send_json({"type": "recording_started"})

            elif action == "audio_chunk":
                if not recording:
                    raise ValueError("Recording has not been started")
                audio_bytes = base64.b64decode(message["data"], validate=True)
                processor.feed(audio_bytes)

            elif action == "stop_recording":
                if not recording:
                    raise ValueError("Recording has not been started")
                recording = False
                flush_started = time.perf_counter()
                audio = processor.flush()
                decode_s = time.perf_counter() - flush_started
                if not audio:
                    await websocket.send_json(
                        {
                            "type": "transcription",
                            "raw": "",
                            "cleaned": "",
                            "timings": {"decode_s": decode_s, "stt_s": 0.0, "format_s": 0.0},
                        }
                    )
                    continue

                try:
                    stt_started = time.perf_counter()
                    transcriber = get_transcriber(runtime_state)
                    raw_text = await asyncio.to_thread(transcriber.transcribe, audio)
                    stt_s = time.perf_counter() - stt_started
                except Exception as exc:
                    logger.exception("Audio transcription failed")
                    await websocket.send_json(
                        {
                            "type": "transcription_error",
                            "message": str(exc),
                        }
                    )
                    continue

                try:
                    format_started = time.perf_counter()
                    cleaned_text = await formatter.format(raw_text)
                    format_s = time.perf_counter() - format_started
                except Exception as exc:
                    logger.exception("Transcription formatting failed")
                    await websocket.send_json({"type": "transcription_error", "message": str(exc)})
                    continue
                # Nota: con cleaner=none el texto limpio es el mismo que el raw,
                # por lo que un mensaje "transcription_partial" previo sería
                # totalmente redundante (solo añade un viaje WS). Si se activa un
                # cleaner lento (ollama/groq) sí tendría sentido enviar el raw
                # cuanto antes; en ese caso añadir aquí el partial.
                await websocket.send_json(
                    {
                        "type": "transcription",
                        "raw": raw_text,
                        "cleaned": cleaned_text,
                        "timings": {
                            "decode_s": decode_s,
                            "stt_s": stt_s,
                            "format_s": format_s,
                        },
                    }
                )

            elif action == "ping":
                await websocket.send_json({"type": "pong"})

            else:
                raise ValueError(f"Unsupported audio action: {action}")

    except WebSocketDisconnect:
        logger.info("Audio WebSocket disconnected")
    except Exception as exc:
        logger.exception("Audio WebSocket error")
        try:
            await websocket.close(code=1011, reason=str(exc)[:120])
        except Exception:
            pass


@router.websocket("/terminal/{agent_id}")
async def terminal_websocket(websocket: WebSocket, agent_id: str) -> None:
    if not websocket_is_authorized(websocket):
        await websocket.close(code=4403, reason="Local API authorization required")
        return
    await websocket.accept(subprotocol=websocket_token_protocol(websocket))
    manager = get_agent_manager()
    try:
        agent = manager.claim_terminal(agent_id)
    except ValueError as exc:
        await websocket.close(code=4404, reason=str(exc))
        return
    except RuntimeError as exc:
        await websocket.close(code=4409, reason=str(exc)[:120])
        return

    # Ensure the agent process is running.
    try:
        agent.start()
    except Exception as exc:
        reason = str(exc)
        await websocket.send_text(f"\r\n[Failed to start agent: {reason}]\r\n")
        await websocket.close(code=4511, reason=reason[:120])
        manager.release_terminal(agent_id)
        return

    async def forward_output() -> None:
        while True:
            try:
                data = await asyncio.to_thread(agent.read, timeout=0.1)
                if data:
                    await websocket.send_text(data)
                elif agent.refresh_status() != "running":
                    await websocket.send_text("\r\n[Process exited]\r\n")
                    return
            except Exception as exc:
                logger.debug("Terminal output forwarding failed for %s: %s", agent_id, exc)
                await asyncio.sleep(0.05)

    task = asyncio.create_task(forward_output())
    try:
        while True:
            text = await websocket.receive_text()
            agent.write(text)
    except WebSocketDisconnect:
        logger.info("Terminal WebSocket disconnected: %s", agent_id)
    finally:
        manager.release_terminal(agent_id)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
