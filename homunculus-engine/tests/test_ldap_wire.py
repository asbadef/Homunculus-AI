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


# Each right password below failed against AD while ldap3 was given a `str`: ldap3 runs it
# through SASLprep (RFC 4013) — maps a no-break space to a space, drops soft hyphens and
# zero-width characters, NFKC-normalises (a decomposed `ş` composed, full-width and ligature
# forms folded), refuses control characters — while AD compares the UTF-8 bytes typed.
PASSWORDS = [
    pytest.param("Parola\u00a0Boşluk-1", id="no-break space"),
    pytest.param("Kis\u0327i-Parola-1", id="s with a combining cedilla"),
    pytest.param("Yu\u00admuşak-Tire-1", id="soft hyphen"),
    pytest.param("Sıfır\u200bGenişlik-1", id="zero-width space"),
    pytest.param("\uff34am-Genişlik-\uff11", id="full-width letters"),
    pytest.param("\ufb01kir-Parola-1", id="ligature"),
    pytest.param("Zil\u0007Sesi-1", id="control character"),
    pytest.param("ğıİşçöüəƏ-Parola-1", id="Turkish and Azerbaijani letters"),
]


@pytest.mark.parametrize("password", PASSWORDS)
async def test_the_password_reaches_the_directory_as_its_exact_utf8_bytes(stub, password):
    """The bytes the clinician typed, unchanged: the right password binds, and nothing
    refuses it on the way (a refusal came after the bind was marked as sent — a 503 that
    counted toward the throttle though nothing had reached the domain controller)."""
    server = stub({USER_DN: password})
    directory = _directory(server.port)
    assert await directory.check_password(USER_DN, password) is True
    assert server.binds == [Bind(USER_DN, password.encode("utf-8"))]


async def test_the_service_password_reaches_the_directory_as_its_exact_utf8_bytes(stub):
    password = "Servis\u00a0Parolası-s\u0327-7"
    server = stub({SVC_DN: password})
    await _directory(server.port, bind_password=password).test_connection()
    assert server.binds == [Bind(SVC_DN, password.encode("utf-8"))]
