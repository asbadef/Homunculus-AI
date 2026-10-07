"""D2 — yerel geliştirme Postgres'i yalnızca 127.0.0.1'e bağlanır, ağa açılmaz."""
from __future__ import annotations

import pathlib

import yaml

COMPOSE = pathlib.Path(__file__).resolve().parents[1] / "docker-compose.yml"


def test_postgres_port_is_bound_to_loopback_only():
    ports = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]["postgres"]["ports"]
    assert ports, "port tanımı beklenir"
    for p in ports:
        assert str(p).startswith("127.0.0.1:"), f"ağa açık port: {p}"
