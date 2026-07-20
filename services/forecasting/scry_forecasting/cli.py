import argparse
import json
import sys
from pathlib import Path

from .pipeline import execute_forecast


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="scry-forecast")
    parser.add_argument("input", nargs="?", help="Forecast JSON file. Reads stdin when omitted.")
    return parser


def main() -> int:
    arguments = build_parser().parse_args()
    try:
        if arguments.input:
            document = json.loads(Path(arguments.input).read_text(encoding="utf-8"))
        else:
            document = json.load(sys.stdin)
        print(json.dumps(execute_forecast(document), indent=2, sort_keys=True))
        return 0
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
