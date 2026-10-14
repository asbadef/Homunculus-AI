"""Renew the Infinity research hub's TLS leaf under its existing private CA. Hub only.

The worker and the API trust the CA (`/etc/homunculus-infinity-pilot/ca.pem` on the worker,
`/etc/homunculus/infinity-ca.pem` for the API), never the leaf, so neither changes. The CA key
is read here and never copied anywhere. The current pair is kept beside the new one as
`.bak-<UTC stamp>`; putting it back and restarting the hub is the rollback. This script does
not restart anything. Without `--apply` it only reports.

The CA itself ends one year after activation (21.09.2027 on this site). The leaf is issued to
a day before that, and renewal refuses once the CA is that close: replacing the CA means
giving the worker and the API the new one, which is a separate, announced change.
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import os
from pathlib import Path
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

CONFIG = Path("/etc/homunculus-infinity-pilot")
ADDRESS = "172.100.101.72"
LIFETIME = dt.timedelta(days=365)
MARGIN = dt.timedelta(days=1)


def issue_leaf(ca_pem, ca_key_pem, address, now):
    """A new key and leaf, shaped as activation shaped the first one, signed by the same CA."""
    ca = x509.load_pem_x509_certificate(ca_pem)
    ca_key = serialization.load_pem_private_key(ca_key_pem, password=None)
    if not ca.not_valid_before_utc <= now < ca.not_valid_after_utc - MARGIN:
        raise ValueError("The CA itself is at its end; the CA must be replaced, not the leaf renewed.")
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    leaf = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Infinity research hub")]))
            .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(minutes=5))
            .not_valid_after(min(now + LIFETIME, ca.not_valid_after_utc - MARGIN))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(address))]),
                           critical=False)
            .add_extension(x509.KeyUsage(True, False, True, False, False, False, False, None, None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))
    leaf.verify_directly_issued_by(ca)
    return (leaf.public_bytes(serialization.Encoding.PEM),
            key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                              serialization.NoEncryption()))


def install(config, cert_pem, key_pem, stamp):
    """Back the current pair up, then put the new pair in place with the same owner and mode."""
    pairs = (("server-key.pem", key_pem), ("server.pem", cert_pem))
    if any((config / f"{name}.bak-{stamp}").exists() for name, _ in pairs):
        raise ValueError("A backup with this stamp exists; nothing changed.")
    staged = []
    for name, data in pairs:
        current, new = config / name, config / f"{name}.new"
        info = current.stat()
        (config / f"{name}.bak-{stamp}").write_bytes(current.read_bytes())
        new.write_bytes(data)
        for path in (config / f"{name}.bak-{stamp}", new):
            os.chmod(path, info.st_mode & 0o777)
            if hasattr(os, "chown"):
                os.chown(path, info.st_uid, info.st_gid)
        staged.append((new, current))
    for new, current in staged:          # the key first, then the certificate
        os.replace(new, current)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the new pair (default: report only)")
    args = parser.parse_args()
    current = x509.load_pem_x509_certificate((CONFIG / "server.pem").read_bytes())
    names = current.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    if names.get_values_for_type(x509.IPAddress) != [ipaddress.ip_address(ADDRESS)]:
        raise SystemExit("The current certificate does not name " + ADDRESS + "; nothing changed.")
    now = dt.datetime.now(dt.timezone.utc)
    print("current leaf expires: " + current.not_valid_after_utc.isoformat())
    if not args.apply:
        print("Report only. Run again with --apply to renew; the hub is not restarted by this script.")
        return 0
    if sys.platform != "linux" or os.geteuid() != 0:
        raise SystemExit("Run on the hub with sudo.")
    cert_pem, key_pem = issue_leaf((CONFIG / "ca.pem").read_bytes(), (CONFIG / "ca-key.pem").read_bytes(),
                                   ADDRESS, now)
    install(CONFIG, cert_pem, key_pem, now.strftime("%Y%m%dT%H%M%SZ"))
    renewed = x509.load_pem_x509_certificate(cert_pem)
    print("RENEWED: new leaf expires " + renewed.not_valid_after_utc.isoformat()
          + "; restart homunculus-infinity-pilot-hub to use it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
