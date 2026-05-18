#!/usr/bin/env python3
import sys
from pathlib import Path

from rembg import new_session, remove


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: remove-background-ai.py <input> <output>", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    output_path.parent.mkdir(parents=True, exist_ok=True)
    session = new_session("u2net")
    output = remove(input_path.read_bytes(), session=session)
    output_path.write_bytes(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
