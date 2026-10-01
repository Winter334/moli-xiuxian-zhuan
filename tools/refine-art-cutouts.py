import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / ".local" / "art-python"))

import numpy as np
from PIL import Image, ImageOps


def local_path(value):
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError("Repair paths must be inside the workspace")
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def repair(job):
    source = local_path(job["input"])
    atlas_path = local_path(job["atlas"])
    output = local_path(job["output"])
    if output == source or output == atlas_path:
        raise ValueError("Repairs must use an independent output")
    if digest(source) != job["inputSha256"]:
        raise ValueError(f"Input changed for {job['id']}; review before repairing")
    with Image.open(source) as image:
        original = np.array(image.convert("RGBA"))
    x, y, width, height = job["cell"]
    left, top, right, bottom = job["foregroundBounds"]
    with Image.open(atlas_path) as atlas:
        crop = atlas.convert("RGB").crop((x + left, y + top, x + right, y + bottom))
    rgb = np.array(crop).astype(np.float32)
    minimum = rgb.min(axis=2)
    neutral = rgb.max(axis=2) - minimum <= job["maximumChroma"]
    opacity = np.where(
        neutral,
        np.clip((job["whiteLevel"] - minimum) / job["edgeRange"], 0, 1),
        1,
    )
    matte = Image.fromarray(np.round(opacity * 255).astype(np.uint8))
    # Match the original crop, scaling and position without resampling the artwork.
    size = original.shape[0]
    if original.shape[:2] != (size, size):
        raise ValueError("Expected a square cutout")
    fitted = ImageOps.contain(crop, (round(size * 0.88), round(size * 0.88)))
    matte = matte.resize(fitted.size, Image.Resampling.LANCZOS)
    canvas = Image.new("L", (size, size), 255)
    canvas.paste(matte, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    matte_alpha = np.array(canvas)
    region = np.zeros((size, size), dtype=bool)
    for left, top, right, bottom in job["regions"]:
        if not 0 <= left < right <= size or not 0 <= top < bottom <= size:
            raise ValueError("Repair region outside the cutout")
        region[top:bottom, left:right] = True
    result = original.copy()
    result[:, :, 3] = np.where(
        region, np.minimum(original[:, :, 3], matte_alpha), original[:, :, 3],
    )
    if not np.array_equal(result[:, :, :3], original[:, :, :3]):
        raise ValueError("Repair changed artwork colors")
    if not np.array_equal(result[~region], original[~region]):
        raise ValueError("Repair changed pixels outside its scope")
    if not np.any(result[:, :, 3] > 32):
        raise ValueError("Repair removed the subject")
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(result).save(output, "PNG", optimize=True)
    return {
        "id": job["id"],
        "input": job["input"],
        "inputSha256": digest(source),
        "atlas": job["atlas"],
        "atlasSha256": digest(atlas_path),
        "output": job["output"],
        "sha256": digest(output),
        "size": [size, size],
        "method": "Local source-white matte; alpha-only edit in selected regions",
        "regions": job["regions"],
        "changedAlphaPixels": int(np.count_nonzero(result[:, :, 3] != original[:, :, 3])),
        "artworkRgbUnchanged": True,
        "outsideRegionsUnchanged": True,
        "apiCost": 0,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    args = parser.parse_args()
    plan = json.loads(local_path(args.plan).read_text(encoding="utf-8"))
    report = {"assets": [repair(job) for job in plan["jobs"]]}
    output = local_path(plan["report"])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
