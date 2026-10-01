import argparse
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / ".local" / "art-python"))

from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageOps


def local_path(value):
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError("Preview paths must be inside the workspace")
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--item", action="append", required=True, help="LABEL=PATH")
    parser.add_argument("--out", required=True)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--font")
    parser.add_argument("--small-size", type=int, default=40)
    parser.add_argument("--background", default="#eeeeee")
    args = parser.parse_args()
    if not 1 <= len(args.item) <= 12 or not 1 <= args.columns <= 4:
        raise ValueError("Use 1-12 icons and 1-4 columns per compressed preview")
    if not 16 <= args.small_size <= 40:
        raise ValueError("Small preview size must be 16-40 pixels")
    output = local_path(args.out)
    if output.suffix.lower() not in {".jpg", ".jpeg"}:
        raise ValueError("Preview output must be JPEG")
    font = ImageFont.truetype(args.font, 14) if args.font else ImageFont.load_default(size=14)
    columns = min(args.columns, len(args.item))
    cell_width, cell_height = 168, 224
    preview = Image.new("RGB", (columns * cell_width, math.ceil(len(args.item) / columns) * cell_height),
                        args.background)
    draw = ImageDraw.Draw(preview)
    text_fill = "#eeeeee" if sum(ImageColor.getrgb(args.background)) < 384 else "#222222"
    for index, entry in enumerate(args.item):
        label, separator, value = entry.partition("=")
        if not separator or not label or not value:
            raise ValueError("Each item must be LABEL=PATH")
        x, y = index % columns * cell_width, index // columns * cell_height
        with Image.open(local_path(value)) as source:
            icon = source.convert("RGBA")
            large = ImageOps.contain(icon, (128, 128), Image.Resampling.LANCZOS)
            small = ImageOps.contain(icon, (args.small_size, args.small_size), Image.Resampling.LANCZOS)
            preview.paste(large, (x + (cell_width - large.width) // 2, y + 8), large)
            preview.paste(small, (x + (cell_width - small.width) // 2, y + 172), small)
        box = draw.textbbox((0, 0), label, font=font)
        if box[2] - box[0] > cell_width - 12:
            raise ValueError("Shorten the preview label to fit its column")
        draw.text((x + (cell_width - box[2] + box[0]) // 2, y + 144), label,
                  font=font, fill=text_fill)
    output.parent.mkdir(parents=True, exist_ok=True)
    preview.save(output, "JPEG", quality=78, optimize=True)
    print(f"{output.relative_to(ROOT)}: {preview.width}x{preview.height}, {output.stat().st_size} bytes")


if __name__ == "__main__":
    main()
