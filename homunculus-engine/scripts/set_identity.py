"""Enter one patient's identity by hand, until Comed's ADT feed is wired.

    python scripts/set_identity.py --patient-id 20239121 --family YILMAZ --given AYSE \
        --birth-date 1980-01-15 --sex female --bed "YB^304^2" \
        --cloud-url http://api:8000 --token <tenant-token>

    python scripts/set_identity.py --patient-id 20239121 --discharge \
        --cloud-url http://api:8000 --token <tenant-token>

It posts exactly what the bridge posts for an ADT message, marked `source: "manuel"` so the board
can say where the name came from. PHI: the name is on this command line — clear the shell history
on a shared machine, and prefer the HIS feed as soon as it exists.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from homunculus.edge.adt import PatientIdentity, identity_to_fhir
from homunculus.edge.uplink import post_json


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Enter a patient identity by hand")
    parser.add_argument("--patient-id", required=True, help="the protocol number (Comed)")
    parser.add_argument("--family", default="", help="surname")
    parser.add_argument("--given", default="", help="first name")
    parser.add_argument("--birth-date", default="", help="ISO date, e.g. 1980-01-15")
    parser.add_argument("--sex", default="unknown",
                        choices=["male", "female", "other", "unknown"])
    parser.add_argument("--bed", default="", help='unit^room^bed, e.g. "YB^304^2"')
    parser.add_argument("--discharge", action="store_true", help="mark the patient discharged")
    parser.add_argument("--cloud-url", required=True, help="e.g. http://api:8000")
    parser.add_argument("--token", required=True, help="tenant bearer token")
    return parser


def resources(args: argparse.Namespace) -> tuple[dict, dict]:
    unit, room, bed = (args.bed.split("^") + ["", "", ""])[:3]
    identity = PatientIdentity(
        patient_id=args.patient_id, family=args.family, given=args.given,
        birth_date=args.birth_date, sex=args.sex, unit=unit, room=room, bed=bed,
        state="discharged" if args.discharge else "admitted",
        at=datetime.now(tz=timezone.utc),
    )
    return identity_to_fhir(identity, source="manuel")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    url = args.cloud_url.rstrip("/") + "/ingest"
    for resource in resources(args):
        reply = post_json(url, args.token, resource) or {}
        outcome = reply.get("identity", "?")
        print(f"{resource['resourceType']}: {outcome}")
        if outcome == "stale":
            # The API holds a NEWER record for this protocol number, so this entry changed
            # nothing. Almost always a clock: the HIS stamp vs this machine's, or an offset.
            print("REDDEDİLDİ: API'deki kayıt daha yeni, bu giriş uygulanmadı — saatleri "
                  "(HIS damgası / bu makine / saat dilimi) kontrol edin", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
