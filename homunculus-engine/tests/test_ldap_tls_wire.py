"""LDAPS refused on a real connection: ldap3's own socket and TLS code against a local server
(`tests/ldap_stub.py`) with certificates made here, at test time — never a real domain
controller. A certificate for another name, one signed by a CA the configuration does not trust,
and a connection made by IP address each fail as `tls`, and the service account's password never
leaves Homunculus; the right name and CA let the bind through. Loopback only, a 2 s timeout."""
from __future__ import annotations

import socket
import ssl
from datetime import datetime, timedelta, timezone

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from homunculus.auth.ldap import LdapUnavailable, load_ldap_config
from homunculus.auth.ldap3_directory import Ldap3Directory
from tests.ldap_stub import Bind, LdapStub

SVC_DN = "CN=svc-homunculus,OU=Servis,DC=hastane,DC=test"
SVC_PW = "Servis-Parolasi-7"
DC_NAME, OTHER_NAME = "dc1.hastane.test", "dc2.hastane.test"   # .test: never a real host


def _name(common_name: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])


def _key_usage(*, ca: bool) -> x509.KeyUsage:
    return x509.KeyUsage(digital_signature=True, content_commitment=False,
                         key_encipherment=False, data_encipherment=False, key_agreement=False,
                         key_cert_sign=ca, crl_sign=ca, encipher_only=False,
                         decipher_only=False)


def _ca(common_name: str):
    """A CA as Python 3.13+'s strict verification wants one (basicConstraints critical, key
    identifiers present)."""
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(_name(common_name)).issuer_name(_name(common_name))
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=1))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .add_extension(_key_usage(ca=True), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()),
                           critical=False)
            .sign(key, hashes.SHA256()))
    return key, cert


def _server_cert(ca_key, ca_cert, dns_name: str):
    """A server certificate naming `dns_name` only (a DNS subjectAltName, no IP address)."""
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(_name(dns_name)).issuer_name(ca_cert.subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=1))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(dns_name)]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(_key_usage(ca=False), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
                           critical=False)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()),
                           critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(
                ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))
    return key, cert


def _pem(cert) -> bytes:
    return cert.public_bytes(serialization.Encoding.PEM)


@pytest.fixture(scope="module")
def pki(tmp_path_factory):
    """The CA the configuration trusts, a CA it does not, and a server certificate for
    DC_NAME from each — written to files, as LDAP_CA_CERT and the server need them."""
    root = tmp_path_factory.mktemp("pki")
    trusted_key, trusted = _ca("Hastane Test CA")
    rogue_key, rogue = _ca("Baska Bir CA")
    files = {"ca": root / "ca.pem"}
    files["ca"].write_bytes(_pem(trusted))
    for label, (ca_key, ca_cert) in {"good": (trusted_key, trusted),
                                     "rogue": (rogue_key, rogue)}.items():
        key, cert = _server_cert(ca_key, ca_cert, DC_NAME)
        (root / f"{label}.pem").write_bytes(_pem(cert) + _pem(ca_cert))
        (root / f"{label}.key").write_bytes(key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()))
        files[label] = root / f"{label}.pem"
        files[f"{label}_key"] = root / f"{label}.key"
    return files


@pytest.fixture
def resolve_test_names(monkeypatch):
    """DC_NAME and OTHER_NAME resolve to 127.0.0.1 only — no hosts file, and no `localhost`,
    which can resolve to ::1 first (a refused IPv6 connect costs seconds on Windows)."""
    real = socket.getaddrinfo

    def getaddrinfo(host, port, *args, **kwargs):
        if host in (DC_NAME, OTHER_NAME):
            host = "127.0.0.1"
        return real(host, port, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)


def _stub(pki, label: str) -> LdapStub:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(pki[label], pki[f"{label}_key"])
    return LdapStub({SVC_DN: SVC_PW.encode("utf-8")}, context=context)


def _directory(pki, host: str, port: int) -> Ldap3Directory:
    return Ldap3Directory(load_ldap_config({
        "LDAP_URL": f"ldaps://{host}:{port}", "LDAP_CA_CERT": str(pki["ca"]),
        "LDAP_BIND_DN": SVC_DN, "LDAP_BIND_PASSWORD": SVC_PW,
        "LDAP_BASE_DN": "DC=hastane,DC=test", "LDAP_TIMEOUT_S": "2",
    }))


async def test_the_right_name_and_ca_let_the_service_bind_through(pki, resolve_test_names):
    stub = _stub(pki, "good")
    try:
        await _directory(pki, DC_NAME, stub.port).test_connection()
    finally:
        stub.close()
    assert stub.binds == [Bind(SVC_DN, SVC_PW.encode("utf-8"))]


@pytest.mark.parametrize("case", ["another name", "untrusted CA", "by IP address"])
async def test_a_certificate_that_does_not_check_out_is_tls_and_no_password_is_sent(
        pki, resolve_test_names, case):
    """The name in LDAP_URL is not the certificate's (OTHER_NAME), the certificate comes from a
    CA LDAP_CA_CERT does not hold, or LDAP_URL names the DC by its IP address (the certificate
    names it by DNS name, as AD's do): refused during TLS, before any LDAP message — the
    service account's password never crosses."""
    label, host = {"another name": ("good", OTHER_NAME),
                   "untrusted CA": ("rogue", DC_NAME),
                   "by IP address": ("good", "127.0.0.1")}[case]
    stub = _stub(pki, label)
    try:
        with pytest.raises(LdapUnavailable) as err:
            await _directory(pki, host, stub.port).test_connection()
    finally:
        stub.close()
    assert err.value.reason == "tls"
    assert stub.binds == []
