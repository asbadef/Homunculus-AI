#!/bin/sh
# Generate a self-signed TLS certificate on first start, if none exists yet.
#
# Why TLS on a LAN-only panel at all: Chrome disables the Web Notification API (and other
# powerful APIs) on plain-HTTP origins, so the clinicians' "enable notifications" button is
# dead without HTTPS. A self-signed certificate is enough to make the context secure — the
# browser shows one warning per machine, accepted once.
#
# The certificate lives on the mounted /etc/nginx/certs volume, so it SURVIVES rebuilds:
# regenerating it on every deploy would re-trigger the browser warning on every ward machine.
set -e

CERT_DIR=/etc/nginx/certs
SAN_IP="${WEB_TLS_IP:-127.0.0.1}"

if [ ! -f "$CERT_DIR/self.key" ] || [ ! -f "$CERT_DIR/self.crt" ]; then
    mkdir -p "$CERT_DIR"
    echo "panel icin kendinden imzali TLS sertifikasi uretiliyor (SAN: IP:$SAN_IP)"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
        -subj "/CN=homunculus-panel" \
        -addext "subjectAltName=IP:$SAN_IP,DNS:homunculus" \
        -keyout "$CERT_DIR/self.key" -out "$CERT_DIR/self.crt"
    chmod 600 "$CERT_DIR/self.key"
fi
