"""Extract explicitly UNVERIFIED byte-layout hypotheses from existing local captures."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from homunculus.edge.infinity_research import ResearchError, analyze_capture, write_report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--read", required=True, type=Path)
    parser.add_argument("--profile", required=True, type=Path, help="hash-scoped JSON hypotheses")
    parser.add_argument("--device", required=True, action="append", help="explicit IPv4 source")
    parser.add_argument("--output", required=True, type=Path, help="new JSON file outside repositories")
    parser.add_argument("--include-series", action="store_true", help="save raw candidate integers locally")
    parser.add_argument("--tshark")
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args(argv)
    try:
        if args.profile.stat().st_size > 65536:
            raise ResearchError("Profile exceeds size bound.")
        profile = json.loads(args.profile.read_text(encoding="utf-8-sig"))
        report = analyze_capture(args.read, tuple(args.device), profile, include_series=args.include_series,
                                 tshark=args.tshark, timeout=args.timeout)
        write_report(args.output, report)
    except ResearchError as exc:
        print(json.dumps({"status": "research_error", "reason": str(exc), "clinical_ingest_enabled": False}))
        return 2
    except (OSError, ValueError, TypeError):
        print(json.dumps({"status": "research_error", "reason": "Check local inputs and new external output path.",
                          "clinical_ingest_enabled": False}))
        return 2
    except KeyboardInterrupt:
        print(json.dumps({"status": "interrupted", "clinical_ingest_enabled": False}))
        return 130
    # No patient measurements, packet contents, profile or paths on stdout.
    print(json.dumps({"status": "report_written", "clinical_ingest_enabled": False,
                      "clinical_mapping_verified": False, "counters": report["counters"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
