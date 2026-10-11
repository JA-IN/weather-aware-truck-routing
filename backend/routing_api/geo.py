import math

EARTH_RADIUS_M = 6371000
METERS_PER_MILE = 1609.344


def haversine_meters(a: dict, b: dict) -> float:
    d_lat = math.radians(b["lat"] - a["lat"])
    d_lon = math.radians(b["lon"] - a["lon"])
    lat1 = math.radians(a["lat"])
    lat2 = math.radians(b["lat"])

    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1, math.sqrt(h)))


def meters_to_miles(m: float) -> float:
    return m / METERS_PER_MILE


def interpolate_coordinate(a: dict, b: dict, t: float) -> dict:
    return {
        "lat": a["lat"] + (b["lat"] - a["lat"]) * t,
        "lon": a["lon"] + (b["lon"] - a["lon"]) * t,
    }


def polyline_distance_meters(points: list) -> float:
    if len(points) < 2:
        return 0.0
    total = 0.0
    for i in range(1, len(points)):
        total += haversine_meters(points[i - 1], points[i])
    return total


def sample_checkpoints_by_miles(points: list, interval_miles: float) -> list:
    if not points:
        return []
    if len(points) == 1:
        return list(points)

    interval_m = interval_miles * METERS_PER_MILE
    checkpoints = [points[0]]

    next_target = interval_m
    travelled = 0.0

    for i in range(1, len(points)):
        prev = points[i - 1]
        curr = points[i]
        segment = haversine_meters(prev, curr)

        while travelled + segment >= next_target:
            remaining = next_target - travelled
            t = min(1.0, max(0.0, remaining / segment)) if segment > 0 else 0.0
            checkpoints.append(interpolate_coordinate(prev, curr, t))
            next_target += interval_m

        travelled += segment

    last = points[-1]
    tail = checkpoints[-1]
    if tail["lat"] != last["lat"] or tail["lon"] != last["lon"]:
        checkpoints.append(last)

    return checkpoints


def thin_checkpoints(points: list, max_points: int = 45) -> list:
    if len(points) <= max_points:
        return points

    step = math.ceil(len(points) / max_points)
    thinned = [p for idx, p in enumerate(points) if idx % step == 0]

    last = points[-1]
    if not thinned or thinned[-1]["lat"] != last["lat"] or thinned[-1]["lon"] != last["lon"]:
        thinned.append(last)

    return thinned
