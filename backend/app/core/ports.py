"""Reserve distinct localhost ports for parallel workers.

Four agents running `npm run dev` all try to bind 3000. The lucky one wins and
the rest either crash or, worse, the user ends up debugging another agent's
server. Handing each worker its own port removes the collision entirely.
"""

from __future__ import annotations

import socket

DEFAULT_START = 3100
MAX_SCAN = 400


def is_port_free(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, port))
        except OSError:
            return False
    return True


def reserve_ports(count: int, start: int = DEFAULT_START) -> list[int]:
    """Return ``count`` distinct free ports, or fewer if the range is exhausted.

    Reservation is advisory: nothing holds the socket open, because the child
    process must be able to bind it. Ports are handed out in order so the same
    worker tends to get the same port across launches.
    """

    if count <= 0:
        return []
    ports: list[int] = []
    candidate = max(1024, start)
    limit = candidate + MAX_SCAN
    while len(ports) < count and candidate < limit:
        if is_port_free(candidate):
            ports.append(candidate)
        candidate += 1
    return ports


def worker_port_env(port: int) -> dict[str, str]:
    """Environment variables the common dev servers read for their port."""

    value = str(port)
    return {
        "PORT": value,
        "VITE_PORT": value,
        "VIBE_SPAM_WORKER_PORT": value,
    }
