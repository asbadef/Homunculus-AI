"""`Ldap3Directory` over ldap3's real socket code, against a local LDAP server
(`tests/ldap_stub.py`) on 127.0.0.1: what a bind actually puts on the wire. Plain LDAP, as
LDAP_ALLOW_INSECURE=1 permits outside production — the TLS side is `test_ldap_tls_wire.py`.
Synthetic credentials only."""
from __future__ import annotations

import pytest

from homunculus.auth.ldap import load_ldap_config
from homunculus.auth.ldap3_directory import Ldap3Directory
from tests.ldap_stub import Bind, LdapStub

SVC_DN = "CN=svc-homunculus,OU=Servis,DC=hastane,DC=test"
SVC_PW = "Servis-Parolasi-7"
USER_DN = "CN=Ayşe Yılmaz,OU=Personel,DC=hastane,DC=test"


@pytest.fixture
def stub():
    servers: list[LdapStub] = []

    def start(passwords: dict[str, str]) -> LdapStub:
        server = LdapStub({dn: pw.encode("utf-8") for dn, pw in passwords.items()})
        servers.append(server)
        return server

    yield start
    for server in servers:
        server.close()


def _directory(port: int, *, bind_password: str = SVC_PW) -> Ldap3Directory:
    return Ldap3Directory(load_ldap_config({
        "LDAP_URL": f"ldap://127.0.0.1:{port}", "LDAP_ALLOW_INSECURE": "1",
        "LDAP_BIND_DN": SVC_DN, "LDAP_BIND_PASSWORD": bind_password,
        "LDAP_BASE_DN": "DC=hastane,DC=test", "LDAP_TIMEOUT_S": "2",
    }))


async def test_a_password_check_opens_the_connection_then_sends_one_bind(stub):
    """The connection as the account is opened before the bind request goes out
    (`_password_ok`), and that request is sent once, on it — right or wrong."""
    server = stub({USER_DN: "Dogru-Parola-1"})
    directory = _directory(server.port)
    assert await directory.check_password(USER_DN, "Dogru-Parola-1") is True
    assert await directory.check_password(USER_DN, "Yanlis-Parola-1") is False
    assert server.binds == [Bind(USER_DN, b"Dogru-Parola-1"), Bind(USER_DN, b"Yanlis-Parola-1")]
