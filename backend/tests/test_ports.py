"""Port reservation for parallel workers."""

from __future__ import annotations

import socket

from backend.app.core.ports import is_port_free, reserve_ports, worker_port_env


def test_reserves_distinct_ports() -> None:
    ports = reserve_ports(4)

    assert len(ports) == 4
    assert len(set(ports)) == 4
    assert all(port >= 1024 for port in ports)


def test_skips_a_port_that_is_already_bound() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen(1)
        busy = taken.getsockname()[1]

        assert is_port_free(busy) is False
        assert busy not in reserve_ports(6, start=busy)


def test_zero_workers_reserve_nothing() -> None:
    assert reserve_ports(0) == []


def test_env_exposes_the_common_dev_server_variables() -> None:
    assert worker_port_env(3123) == {
        "PORT": "3123",
        "VITE_PORT": "3123",
        "VIBE_SPAM_WORKER_PORT": "3123",
    }
