import argparse
import json
from pathlib import Path

from .pipeline import execute_curation


def main() -> None:
    parser = argparse.ArgumentParser(prog="scry-curation")
    parser.add_argument("input", type=Path)
    arguments = parser.parse_args()
    document = json.loads(arguments.input.read_text(encoding="utf-8"))
    print(json.dumps(execute_curation(document), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
