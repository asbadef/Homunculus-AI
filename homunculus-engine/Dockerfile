# Homunculus edge bridge — the on-prem HL7 listener.
#
# Deliberately minimal: the bridge's import chain is the Python standard library plus ONE wheel,
# `cryptography`, which the identity mirror needs to keep patient names encrypted at rest
# (homunculus.crypto, Fernet). Nothing else — no SQLAlchemy, no FastAPI. That is worth preserving:
# a hospital device VLAN frequently has no internet, and an image that needs a package mirror is an
# image that cannot be rebuilt on site. tests/test_bridge_import_chain.py guards the chain.
#
# Build:  docker build -t homunculus-bridge -f homunculus-engine/Dockerfile homunculus-engine
# Run:    see deploy/bridge/docker-compose.yml

FROM python:3.12-slim

RUN pip install --no-cache-dir "cryptography>=42.0"

# PYTHONUNBUFFERED: without it Python buffers stdout when it is not a terminal, and `docker logs -f`
# shows nothing for minutes — which reads as a dead bridge during exactly the moment someone is
# watching to see whether the device connected.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/src

WORKDIR /app

COPY src/ /app/src/
COPY scripts/ /app/scripts/

# The buffer holds real observations in transit, so it lives on a mounted volume rather than in the
# container layer: a restart must not discard data the cloud has not acknowledged yet.
RUN useradd --system --uid 10001 --home /data homunculus \
    && mkdir -p /data \
    && chown -R homunculus:homunculus /data /app
VOLUME ["/data"]

USER homunculus

# 2575 is the IANA registration for HL7 over MLLP.
EXPOSE 2575

# ENTRYPOINT is the interpreter so the same image can run the discovery probe:
#   docker run ... homunculus-bridge scripts/listen_probe.py --scan 10.10.96.203
ENTRYPOINT ["python"]
CMD ["scripts/run_bridge.py", "--db", "/data/bridge.db"]
