#!/usr/bin/env python3
import csv
import importlib.util
import json
import math
import sys
from pathlib import Path

library_path = Path(__file__).with_name("generate-media-library.py")
spec = importlib.util.spec_from_file_location("generate_media_library", library_path)
library = importlib.util.module_from_spec(spec)
spec.loader.exec_module(library)

gpx_id_from_filename = library.gpx_id_from_filename
parse_fit_route = library.parse_fit_route
parse_gpx_route = library.parse_gpx_route
sport_from_type = library.sport_from_type


def parse_route(path):
    name = path.name.lower()
    if name.endswith(".gpx"):
        return parse_gpx_route(path)
    if name.endswith(".fit") or name.endswith(".fit.gz"):
        return parse_fit_route(path)
    return []


def downsample_route(route, max_points=1200):
    if len(route) <= max_points:
        return route
    step = math.ceil((len(route) - 1) / (max_points - 1))
    sampled = route[::step]
    if sampled[-1] != route[-1]:
        sampled.append(route[-1])
    return sampled


def main():
    export_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "export_87958775")
    output = Path(sys.argv[2] if len(sys.argv) > 2 else "gpx-data.js")
    routes = []
    route_ids = []
    seen_route_ids = set()

    with (export_dir / "activities.csv").open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if sport_from_type(row.get("Activity Type")) != "cycling":
                continue
            filename = row.get("Filename", "").strip()
            if not filename:
                continue
            route_id = gpx_id_from_filename(filename)
            if route_id in seen_route_ids:
                continue
            route = parse_route(export_dir / filename)
            if not route:
                continue
            routes.append(downsample_route(route))
            route_ids.append(route_id)
            seen_route_ids.add(route_id)

    points = [point for route in routes for point in route]
    bounds = {
        "north": max(point[0] for point in points),
        "south": min(point[0] for point in points),
        "east": max(point[1] for point in points),
        "west": min(point[1] for point in points),
    }
    bounds["center"] = [
        (bounds["north"] + bounds["south"]) / 2,
        (bounds["east"] + bounds["west"]) / 2,
    ]

    content = (
        "// Preprocessed cycling route data - generated from Strava export.\n"
        "// Run: python3 scripts/generate-gpx-data.py export_87958775\n\n"
        f"const GPX_ROUTES = {json.dumps(routes, separators=(',', ':'))};\n"
        f"const GPX_ROUTE_IDS = {json.dumps(route_ids, separators=(',', ':'))};\n"
        f"const GPX_BOUNDS = {json.dumps(bounds, separators=(',', ':'))};\n"
        f"const GPX_POINT_COUNT = {len(points)};\n"
    )
    output.write_text(content, encoding="utf-8")
    print(f"wrote {output}")
    print(f"cycling routes: {len(routes)}")
    print(f"points: {len(points)}")


if __name__ == "__main__":
    main()
