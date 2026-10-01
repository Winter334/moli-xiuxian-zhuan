import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / ".local" / "art-python"))
os.environ.setdefault("U2NET_HOME", str(ROOT / ".local" / "art-models"))

import numpy as np
from PIL import Image
from rembg import new_session, remove
from scipy.ndimage import binary_fill_holes, label


def local_path(value):
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError("Art paths must be inside the workspace")
    return path


def publish_scene(identifier, source, report, suffix="v1"):
    target = local_path(f"public/assets/art/scenes/{identifier}-{suffix}.webp")
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image.convert("RGB").save(target, "WEBP", quality=90, method=6)
        report.append({
            "id": identifier, "kind": "scene",
            "source": str(source.relative_to(ROOT)), "output": str(target.relative_to(ROOT)),
            "size": list(image.size),
        })


def grid_edges(background, axis, count):
    scores = background.mean(axis=axis)
    length = len(scores)
    step = length / count
    edges = [0]
    # Generated grids can shift; cut along the nearby white gutters, not through a subject.
    for index in range(1, count):
        expected = round(step * index)
        start, stop = round(expected - step * 0.2), round(expected + step * 0.2)
        window = scores[start:stop]
        if window.max() < 0.97:
            raise ValueError("No clean atlas gutter near the expected grid boundary")
        candidates = np.flatnonzero(window >= window.max() - 0.001)
        runs = np.split(candidates, np.flatnonzero(np.diff(candidates) > 1) + 1)
        best = max(runs, key=lambda run: (len(run), -abs(start + run.mean() - expected)))
        edges.append(start + int(round(float(best.mean()))))
    return edges + [length]


def publish_atlas(job, source, session, report):
    removal = job.get("backgroundRemoval", "rembg")
    if removal not in {"rembg", "white-background", "white-background-open"}:
        raise ValueError("Unknown background removal method")
    with Image.open(source) as atlas:
        atlas = atlas.convert("RGB")
        columns, rows = job["columns"], job["rows"]
        if atlas.width % columns or atlas.height % rows:
            raise ValueError(f"Atlas {job['id']} does not divide into its grid")
        background = np.all(np.array(atlas) > 240, axis=2)
        if all("cellBounds" in item for item in job["items"]):
            x_edges = [index * atlas.width // columns for index in range(columns + 1)]
            y_edges = [index * atlas.height // rows for index in range(rows + 1)]
        else:
            x_edges = grid_edges(background, 0, columns)
            y_edges = grid_edges(background, 1, rows)
        for index, item in enumerate(job["items"]):
            column, row = index % columns, index // columns
            x, y = x_edges[column], y_edges[row]
            right, bottom = x_edges[column + 1], y_edges[row + 1]
            width, height = right - x, bottom - y
            # A row can have different white gutters in each column.
            if "cellBounds" in item:
                bounds = item["cellBounds"]
                if len(bounds) != 4 or any(type(value) is not int for value in bounds):
                    raise ValueError(f"Invalid cell bounds for {item['id']}")
                x, y, width, height = bounds
                right, bottom = x + width, y + height
                if min(x, y) < 0 or min(width, height) <= 0 or right > atlas.width or bottom > atlas.height:
                    raise ValueError(f"Cell bounds outside atlas for {item['id']}")
            cell = atlas.crop((x, y, right, bottom))
            item_removal = item.get("backgroundRemoval", removal)
            if item_removal not in {"rembg", "white-background", "white-background-open"}:
                raise ValueError(f"Unknown background removal method for {item['id']}")
            component_rank = item.get("foregroundComponent")
            if component_rank is not None and (
                item_removal == "rembg" or type(component_rank) is not int or component_rank < 1
            ):
                raise ValueError(f"Invalid foreground component for {item['id']}")
            if item_removal in {"white-background", "white-background-open"}:
                # Pure-white studies can contain cloth that a semantic cutout model drops.
                foreground_mask = np.any(np.array(cell) < 245, axis=2)
                if component_rank is not None:
                    # Overlapping cell bounds can still contain separate connected subjects.
                    components, count = label(foreground_mask)
                    if component_rank > count:
                        raise ValueError(f"Missing foreground component for {item['id']}")
                    sizes = np.bincount(components.ravel())[1:]
                    chosen = int(np.argsort(sizes)[-component_rank]) + 1
                    foreground_mask = components == chosen
                if item_removal == "white-background":
                    foreground_mask = binary_fill_holes(foreground_mask)
                cutout = cell.convert("RGBA")
                cutout.putalpha(Image.fromarray(foreground_mask.astype(np.uint8) * 255))
            else:
                cutout = remove(cell, session=session).convert("RGBA")
            alpha = np.array(cutout.getchannel("A"))
            foreground = alpha > 32
            if foreground.mean() < 0.015 or foreground.mean() > 0.9:
                raise ValueError(f"Unexpected cutout coverage for {item['id']}")
            ys, xs = np.nonzero(foreground)
            bounds = (int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1))
            cutout = cutout.crop(bounds)
            size = 512 if job["target"] == "enemies" else 256
            cutout.thumbnail((round(size * 0.88), round(size * 0.88)), Image.Resampling.LANCZOS)
            result = Image.new("RGBA", (size, size))
            result.alpha_composite(cutout, ((size - cutout.width) // 2, (size - cutout.height) // 2))
            suffix = job.get("assetSuffix", "v1")
            preview_only = bool(item.get("previewOnly"))
            target = (local_path(source.parent / job["target"] / f"{item['id']}-{suffix}.png") if preview_only
                      else local_path(f"public/assets/art/{job['target']}/{item['id']}-{suffix}.png"))
            target.parent.mkdir(parents=True, exist_ok=True)
            result.save(target, "PNG", optimize=True)
            report.append({
                "id": item["id"], "name": item["name"], "kind": job["target"],
                "source": str(source.relative_to(ROOT)), "cell": [x, y, width, height],
                "foregroundBounds": list(bounds), "foregroundFraction": round(float(foreground.mean()), 4),
                "touchesCellEdge": bool(bounds[0] < 4 or bounds[1] < 4
                                        or bounds[2] > width - 4 or bounds[3] > height - 4),
                "output": str(target.relative_to(ROOT)), "size": [size, size],
                "previewOnly": preview_only,
                "foregroundComponent": component_rank,
                "backgroundRemoval": ("local white-background mask, preserving enclosed highlights"
                                      if item_removal == "white-background"
                                      else "local white-background mask, preserving open gaps"
                                      if item_removal == "white-background-open" else "local rembg / u2netp"),
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            })
            print(f"Prepared {item['id']}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--job", action="append")
    args = parser.parse_args()
    plan = json.loads(local_path(args.plan).read_text(encoding="utf-8"))
    source_dir = local_path(f"output/imagegen/{plan['region']}/{plan['version']}")
    report_path = source_dir / "processing.json"
    previous = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    report = previous.get("assets", [])
    selected = set(args.job) if args.job else None
    jobs = [job for job in plan["jobs"] if selected is None or job["id"] in selected]
    existing_scene = plan.get("existingScene")
    existing_ids = {existing_scene["id"]} if existing_scene else set()
    include_existing = existing_scene and (selected is None or existing_scene["id"] in selected)
    if selected and selected - {job["id"] for job in jobs} - existing_ids:
        raise ValueError("Unknown job")
    ids = {item["id"] for job in jobs for item in job.get("items", [])}
    ids.update(job["id"] for job in jobs if job["kind"] == "scene")
    if include_existing:
        ids.add(existing_scene["id"])
    report = [entry for entry in report if entry["id"] not in ids]
    session = new_session("u2netp") if any(
        item.get("backgroundRemoval", job.get("backgroundRemoval", "rembg")) == "rembg"
        for job in jobs if job["kind"] == "atlas" for item in job["items"]) else None
    if include_existing:
        publish_scene(existing_scene["id"], local_path(existing_scene["source"]), report)
    for job in jobs:
        source = source_dir / f"{job['id']}.png"
        if job["kind"] == "scene":
            publish_scene(job["id"], source, report, job.get("assetSuffix", "v1"))
        else:
            publish_atlas(job, source, session, report)
    source_dir.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps({
        "backgroundRemoval": "Local per-asset removal, recorded in assets; no API charge",
        "slicing": "Grid boundaries aligned to nearby pure-white gutters",
        "review": "Technical file checks only; image and UI review delegated to the user",
        "assets": report,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"assets": len(report), "edgeWarnings": [
        entry["id"] for entry in report if entry.get("touchesCellEdge")
    ]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
