#!/usr/bin/env python3
import csv
import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


REGION_BOUNDS = {
    "Asia": ((20.0, 70.0), (50.0, 140.0)),
    "US": ((24.3963, -125.0), (49.3843, -66.9346)),
    "UK": ((49.8, -8.0), (60.9, 2.0)),
    "Europe": ((35.0, -10.0), (60.9, 30.0)),
}

REGION_EXCLUDES = {
    "Europe": [REGION_BOUNDS["UK"]],
}


def gpx_id_from_filename(filename):
    name = Path(filename or "").name
    for suffix in (".fit.gz", ".fit", ".gpx"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return Path(name).stem if name else None


def sport_from_type(activity_type):
    value = (activity_type or "").strip().lower()
    if value in {"ride", "virtual ride", "e-bike ride"}:
        return "cycling"
    if value in {"run", "virtual run"}:
        return "running"
    return None


def point_in_bounds(lat, lng, bounds):
    (min_lat, min_lng), (max_lat, max_lng) = bounds
    return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng


def point_in_region(lat, lng, region_name):
    if not point_in_bounds(lat, lng, REGION_BOUNDS[region_name]):
        return False
    return not any(point_in_bounds(lat, lng, bounds) for bounds in REGION_EXCLUDES.get(region_name, []))


def region_for_route(route):
    if not route:
        return None
    candidates = [route[len(route) // 2]]
    candidates.append(
        [
            sum(point[0] for point in route) / len(route),
            sum(point[1] for point in route) / len(route),
        ]
    )
    for lat, lng in candidates:
        for name in REGION_BOUNDS:
            if point_in_region(lat, lng, name):
                return name
    return None


def parse_media(value, existing_files):
    files = []
    for part in (value or "").split("|"):
        part = part.strip()
        if not part:
            continue
        if part.startswith("media/"):
            part = part.split("/", 1)[1]
        if part in existing_files and part not in files:
            files.append(part)
    return files


def parse_gpx_route(path):
    try:
        root = ET.parse(path).getroot()
    except Exception:
        return []
    points = []
    for elem in root.iter():
        if elem.tag.endswith("trkpt") or elem.tag.endswith("rtept"):
            try:
                points.append([float(elem.attrib["lat"]), float(elem.attrib["lon"])])
            except Exception:
                continue
    return points


def fit_base_type_value(data, base_type, endian):
    base = base_type & 0x1F
    if base in {0x01, 0x0D}:  # sint8, byte
        return data[0] if data else None
    if base == 0x02:  # uint8
        return data[0] if data else None
    if base == 0x07 and len(data) >= 4:  # string
        return data.split(b"\x00", 1)[0].decode("utf-8", errors="ignore")
    if len(data) == 1:
        return int.from_bytes(data, "little", signed=False)
    if len(data) == 2:
        signed = base == 0x03
        return int.from_bytes(data, endian, signed=signed)
    if len(data) == 4:
        signed = base == 0x05
        return int.from_bytes(data, endian, signed=signed)
    if len(data) == 8:
        signed = base == 0x0E
        return int.from_bytes(data, endian, signed=signed)
    return None


def parse_fit_route(path):
    try:
        raw = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
    except Exception:
        return []
    if len(raw) < 14:
        return []

    header_size = raw[0]
    data_size = int.from_bytes(raw[4:8], "little")
    data_end = min(len(raw), header_size + data_size)
    pos = header_size
    definitions = {}
    points = []

    while pos < data_end:
        record_header = raw[pos]
        pos += 1
        if record_header & 0x80:
            local_type = (record_header >> 5) & 0x03
            is_definition = False
        else:
            local_type = record_header & 0x0F
            is_definition = bool(record_header & 0x40)
        has_developer_fields = bool(record_header & 0x20) and not (record_header & 0x80)

        if is_definition:
            if pos + 5 > data_end:
                break
            pos += 1  # reserved
            endian = "big" if raw[pos] else "little"
            pos += 1
            global_msg = int.from_bytes(raw[pos:pos + 2], endian)
            pos += 2
            field_count = raw[pos]
            pos += 1
            fields = []
            for _ in range(field_count):
                if pos + 3 > data_end:
                    break
                fields.append({"num": raw[pos], "size": raw[pos + 1], "base": raw[pos + 2]})
                pos += 3
            dev_fields = []
            if has_developer_fields and pos < data_end:
                dev_count = raw[pos]
                pos += 1
                for _ in range(dev_count):
                    if pos + 3 > data_end:
                        break
                    dev_fields.append({"size": raw[pos + 1]})
                    pos += 3
            definitions[local_type] = {
                "global_msg": global_msg,
                "fields": fields,
                "dev_size": sum(field["size"] for field in dev_fields),
                "endian": endian,
            }
            continue

        definition = definitions.get(local_type)
        if not definition:
            break

        values = {}
        for field in definition["fields"]:
            chunk = raw[pos:pos + field["size"]]
            pos += field["size"]
            if definition["global_msg"] == 20 and field["num"] in {0, 1}:
                values[field["num"]] = fit_base_type_value(chunk, field["base"], definition["endian"])
        pos += definition["dev_size"]

        if definition["global_msg"] == 20 and 0 in values and 1 in values:
            lat_raw = values[0]
            lng_raw = values[1]
            if lat_raw is None or lng_raw is None or lat_raw == 0x7FFFFFFF or lng_raw == 0x7FFFFFFF:
                continue
            lat = lat_raw * 180 / (2 ** 31)
            lng = lng_raw * 180 / (2 ** 31)
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                points.append([round(lat, 6), round(lng, 6)])

    return points


def load_gpx_regions(gpx_data_path):
    text = gpx_data_path.read_text(encoding="utf-8")
    route_ids = json.loads(re.search(r"const GPX_ROUTE_IDS = (\[.*?\]);", text, re.S).group(1))
    routes = json.loads(re.search(r"const GPX_ROUTES = (\[.*?\]);\s*const GPX_ROUTE_IDS", text, re.S).group(1))
    return {str(route_id): region_for_route(route) for route_id, route in zip(route_ids, routes)}


def js_const(name, value):
    return f"const {name} = " + json.dumps(value, indent=2, ensure_ascii=False) + ";\n"


def main():
    export_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "export_87958775 (1)")
    output = Path(sys.argv[2] if len(sys.argv) > 2 else "media-mapping.js")
    media_dir = export_dir / "media"
    activities_csv = export_dir / "activities.csv"

    media_files = sorted(path.name for path in media_dir.iterdir() if path.is_file())
    media_file_set = set(media_files)
    gpx_regions = load_gpx_regions(Path("gpx-data.js"))

    media_mapping = {}
    activity_to_gpx = {}
    activity_metadata = {}
    activity_sport = {}
    gpx_activity_kind = {}
    sport_region_mapping = {
        "cycling": {"Asia": [], "US": [], "UK": [], "Europe": []},
        "running": {"Asia": [], "US": [], "UK": [], "Europe": []},
    }
    sport_gpx_routes = {"running": []}
    sport_gpx_route_ids = {"running": []}
    sport_region_seen = {
        sport: {region: set() for region in regions}
        for sport, regions in sport_region_mapping.items()
    }
    mapped_local_media = set()
    ignored_missing = set()

    with activities_csv.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}

        for row in reader:
            aid = row[idx["Activity ID"]].strip()
            activity_type = row[idx["Activity Type"]].strip()
            sport = sport_from_type(activity_type)
            filename = row[idx["Filename"]].strip()
            gpx_id = gpx_id_from_filename(filename)

            if gpx_id:
                activity_to_gpx[aid] = gpx_id
            if sport:
                activity_sport[aid] = sport
                if gpx_id:
                    gpx_activity_kind[gpx_id] = sport
                if sport == "running" and filename.endswith(".gpx"):
                    route = parse_gpx_route(export_dir / filename)
                    if route:
                        sport_gpx_routes["running"].append(route)
                        sport_gpx_route_ids["running"].append(gpx_id)
                if sport == "running" and (filename.endswith(".fit") or filename.endswith(".fit.gz")):
                    route = parse_fit_route(export_dir / filename)
                    if route:
                        sport_gpx_routes["running"].append(route)
                        sport_gpx_route_ids["running"].append(gpx_id)

            raw_media = row[idx["Media"]] if len(row) > idx["Media"] else ""
            media = parse_media(raw_media, media_file_set)
            for part in raw_media.split("|"):
                part = part.strip()
                if part.startswith("media/"):
                    part = part.split("/", 1)[1]
                if part and part not in media_file_set:
                    ignored_missing.add(part)
            if media:
                media_mapping[aid] = media
                mapped_local_media.update(media)
                if sport in sport_region_mapping:
                    region = gpx_regions.get(gpx_id) or ("US" if sport == "running" else "US")
                    for item in media:
                        if item not in sport_region_seen[sport][region]:
                            sport_region_seen[sport][region].add(item)
                            sport_region_mapping[sport][region].append(item)

            def number_for(*names):
                try:
                    for name in names:
                        position = idx.get(name)
                        if position is None or position >= len(row):
                            continue
                        value = row[position].strip()
                        if value:
                            return float(value)
                except Exception:
                    pass
                return None

            meta = {
                "name": row[idx["Activity Name"]].strip(),
                "date": row[idx["Activity Date"]].strip(),
                "type": activity_type,
            }
            distance_m = number_for("Distance")
            elapsed = number_for("Elapsed Time")
            moving = number_for("Moving Time")
            total_elevation = number_for("Total Elevation", "Elevation Gain")
            if distance_m is not None:
                meta["distance_km"] = round(distance_m / 1000, 4)
            if elapsed is not None:
                meta["elapsed_sec"] = elapsed
            if moving is not None:
                meta["moving_sec"] = moving
            if total_elevation is not None:
                meta["total_elevation_m"] = total_elevation
            activity_metadata[aid] = meta

    for item in media_files:
        if item not in mapped_local_media:
            sport = "running" if "run" in item.lower() else "cycling"
            if item not in sport_region_seen[sport]["US"]:
                sport_region_mapping[sport]["US"].append(item)

    content = """// Media mapping - generated from Strava export.
// Run: python3 scripts/generate-media-library.py "export_87958775 (1)"
//
// MEDIA_MAPPING = activity ID -> files.
// SPORT_REGION_MEDIA_MAPPING = sport -> region -> media.
// GPX_ACTIVITY_KIND = GPX filename id -> cycling/running.

"""
    content += js_const("MEDIA_MAPPING", media_mapping) + "\n"
    content += js_const("SPORT_REGION_MEDIA_MAPPING", sport_region_mapping) + "\n"
    content += "const REGION_MEDIA_MAPPING = SPORT_REGION_MEDIA_MAPPING.cycling;\n\n"
    content += js_const("ACTIVITY_ID_TO_GPX_ID", activity_to_gpx) + "\n"
    content += js_const("ACTIVITY_SPORT", activity_sport) + "\n"
    content += js_const("GPX_ACTIVITY_KIND", gpx_activity_kind) + "\n"
    content += js_const("SPORT_GPX_ROUTES", sport_gpx_routes) + "\n"
    content += js_const("SPORT_GPX_ROUTE_IDS", sport_gpx_route_ids) + "\n"
    content += "const ACTIVITY_METADATA_VERSION = 2;\n\n"
    content += js_const("ACTIVITY_METADATA", activity_metadata) + "\n"
    content += """// Backwards-compatible alias for existing UI code.
const ACTIVITY_SUMMARIES = ACTIVITY_METADATA;

const MEDIA_BASE_PATH = 'export_87958775/media/';

function getMediaForActivity(activityId) {
    return MEDIA_MAPPING[activityId] || [];
}

function getMediaUrl(filename) {
    return (window.SITE_BASE || '') + MEDIA_BASE_PATH + filename;
}

"""
    content += js_const("ALL_MEDIA_FILES", media_files)
    output.write_text(content, encoding="utf-8")

    print(f"wrote {output}")
    print(f"media files: {len(media_files)}")
    print(f"mapped activities: {len(media_mapping)}")
    print(f"ignored missing referenced media: {len(ignored_missing)}")
    print(
        "sport region counts:",
        {
            sport: {region: len(files) for region, files in regions.items()}
            for sport, regions in sport_region_mapping.items()
        },
    )
    print("embedded running gpx routes:", len(sport_gpx_routes["running"]))


if __name__ == "__main__":
    main()
