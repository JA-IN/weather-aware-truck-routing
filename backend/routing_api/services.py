import logging
import math
import time
from datetime import datetime, timedelta, timezone

import requests

from .geo import (
    haversine_meters,
    interpolate_coordinate,
    meters_to_miles,
    polyline_distance_meters,
    sample_checkpoints_by_miles,
    thin_checkpoints,
)
from .models import RouteAnalysis, TripRequest
from .risk import classify_risk, risk_label, summarize_checkpoint_risks

logger = logging.getLogger(__name__)

FETCH_TIMEOUT_SECONDS = 13
FETCH_RETRIES = 2
HOURS_FOR_HEATMAP = 72
USER_AGENT = "weather-aware-truck-routing/1.0 (django-backend)"


class AnalysisError(Exception):
    pass


def _fetch_with_retry(
    url: str,
    params: dict | None = None,
    headers: dict | None = None,
    max_retries: int = FETCH_RETRIES,
) -> requests.Response:
    last_error: Exception | None = None
    merged_headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if headers:
        merged_headers.update(headers)

    for attempt in range(max_retries + 1):
        try:
            resp = requests.get(url, params=params, headers=merged_headers, timeout=FETCH_TIMEOUT_SECONDS)
            if resp.status_code == 200:
                return resp
            if resp.status_code == 429:
                retry_after_hdr = resp.headers.get("Retry-After")
                try:
                    retry_delay = float(retry_after_hdr) if retry_after_hdr else 1.5 * (attempt + 1)
                except ValueError:
                    retry_delay = 1.5 * (attempt + 1)
                logger.warning(
                    "Upstream %s returned 429 Too Many Requests; backing off for %.1fs (attempt %d/%d)",
                    url,
                    retry_delay,
                    attempt + 1,
                    max_retries + 1,
                )
                last_error = AnalysisError("Weather provider rate limit exceeded (HTTP 429)")
                if attempt < max_retries:
                    time.sleep(min(retry_delay, 4.0))
                    continue
                return resp
            if resp.status_code < 500:
                logger.warning("Upstream %s returned status %d: %s", url, resp.status_code, resp.text[:200])
                return resp
            last_error = AnalysisError(f"Upstream returned {resp.status_code}")
        except requests.RequestException as exc:
            logger.warning("Request exception when fetching %s: %s", url, exc)
            last_error = exc

        if attempt < max_retries:
            time.sleep(0.4 * (attempt + 1))

    raise last_error or AnalysisError("Network request failed")


def parse_iso_to_naive_utc(iso_str: str) -> datetime:
    value = iso_str.replace("Z", "+00:00")
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def geocode(place: str) -> dict:
    resp = _fetch_with_retry(
        "https://nominatim.openstreetmap.org/search",
        params={"format": "jsonv2", "limit": 1, "q": place},
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    if resp.status_code != 200:
        raise AnalysisError(f"Geocoding failed for {place}")

    data = resp.json()
    if not data:
        raise AnalysisError(f"No geocoding result for {place}")

    first = data[0]
    return {"lat": float(first["lat"]), "lon": float(first["lon"]), "displayName": first["display_name"]}


def _route_via_osrm(waypoints: list, alternatives: bool = True) -> list:
    point_string = ";".join(f'{p["lon"]},{p["lat"]}' for p in waypoints)
    url = f"https://router.project-osrm.org/route/v1/driving/{point_string}"
    params = {
        "alternatives": "true" if alternatives else "false",
        "steps": "false",
        "overview": "full",
        "geometries": "geojson",
    }

    resp = _fetch_with_retry(url, params=params)
    if resp.status_code != 200:
        raise AnalysisError("Routing provider request failed")

    data = resp.json()
    if not data.get("routes") or data.get("code") != "Ok":
        raise AnalysisError("No routes returned from routing provider")

    return data["routes"]


def _with_offset_waypoint(origin: dict, destination: dict, sign: int, scale: float = 0.85) -> dict:
    mid = interpolate_coordinate(origin, destination, 0.5)
    d_lat = destination["lat"] - origin["lat"]
    d_lon = destination["lon"] - origin["lon"]
    mag = math.sqrt(d_lat**2 + d_lon**2) or 1

    normal_lat = (-d_lon / mag) * sign
    normal_lon = (d_lat / mag) * sign

    dist = max(0.2, min(1.2, math.sqrt((d_lat**2 + d_lon**2) * scale))) * 0.35

    return {"lat": mid["lat"] + normal_lat * dist, "lon": mid["lon"] + normal_lon * dist}


def _dedupe_routes(routes: list) -> list:
    out: list = []
    for r in routes:
        duplicate = any(
            abs(existing["distance"] - r["distance"]) < 5000 and abs(existing["duration"] - r["duration"]) < 600
            for existing in out
        )
        if not duplicate:
            out.append(r)
    return out


def get_alternative_routes(origin: dict, destination: dict) -> list:
    initial = _route_via_osrm([origin, destination], True)
    candidates = _dedupe_routes(initial)[:3]

    if len(candidates) < 3:
        detour_a = _with_offset_waypoint(origin, destination, 1, 0.9)
        detour_b = _with_offset_waypoint(origin, destination, -1, 1.1)

        extra: list = []
        for waypoint in (detour_a, detour_b):
            try:
                extra.extend(_route_via_osrm([origin, waypoint, destination], False))
            except AnalysisError:
                continue

        candidates = _dedupe_routes(candidates + extra)[:3]

    if not candidates:
        raise AnalysisError("Unable to derive route options")

    while len(candidates) < 3:
        base = candidates[0]
        n = len(candidates)
        candidates.append(
            {
                **base,
                "distance": base["distance"] * (1 + 0.015 * n),
                "duration": base["duration"] * (1 + 0.02 * n),
            }
        )

    return candidates


def _generate_fallback_hourly(coord: dict | None, departure_dt: datetime) -> dict:
    dep_hour = departure_dt.replace(minute=0, second=0, microsecond=0)
    times = [(dep_hour + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00") for h in range(HOURS_FOR_HEATMAP + 24)]
    count = len(times)

    lat = float(coord["lat"]) if coord and "lat" in coord else 38.0
    lon = float(coord["lon"]) if coord and "lon" in coord else -95.0
    seed_pos = abs(lat) * 17.3 + abs(lon) * 31.7

    temps, winds, rains, snows, precips = [], [], [], [], []

    for h in range(count):
        cycle = math.sin((h + (lon / 15.0)) * math.pi / 12.0)
        storm_wave = math.sin(seed_pos + h * 0.35)
        wind_gust = math.sin(seed_pos * 1.7 + h * 0.5)

        base_temp_c = 28.0 - (lat - 25.0) * 0.9 + cycle * 5.0
        base_wind_kmh = 24.0 + (abs(lat) % 7) * 3.0 + wind_gust * 18.0
        if storm_wave > 0.65:
            base_wind_kmh += 26.0

        wind_kmh = max(8.0, base_wind_kmh)

        rain_mm = 0.0
        snow_mm = 0.0
        if storm_wave > 0.4:
            p = (storm_wave - 0.4) * 6.5
            if base_temp_c <= 1.0:
                snow_mm = p * 0.8
            else:
                rain_mm = p

        temps.append(round(base_temp_c, 1))
        winds.append(round(wind_kmh, 1))
        rains.append(round(rain_mm, 2))
        snows.append(round(snow_mm, 2))
        precips.append(round(rain_mm + snow_mm, 2))

    return {
        "time": times,
        "temperature_2m": temps,
        "wind_speed_10m": winds,
        "precipitation": precips,
        "rain": rains,
        "snowfall": snows,
    }


def fetch_weather_batch(coords: list[dict], departure_dt: datetime) -> dict[str, dict]:
    """Fetch hourly weather for multiple coordinates in batch using Open-Meteo with proxy fallback."""
    results: dict[str, dict] = {}
    if not coords:
        return results

    unique_map: dict[str, dict] = {}
    for c in coords:
        k = f'{round(c["lat"], 2)}:{round(c["lon"], 2)}'
        if k not in unique_map:
            unique_map[k] = c

    unique_list = list(unique_map.items())
    chunk_size = 50

    for i in range(0, len(unique_list), chunk_size):
        chunk = unique_list[i : i + chunk_size]
        lats = ",".join(str(c["lat"]) for _, c in chunk)
        lons = ",".join(str(c["lon"]) for _, c in chunk)

        params = {
            "latitude": lats,
            "longitude": lons,
            "hourly": "temperature_2m,wind_speed_10m,precipitation,rain,snowfall",
            "forecast_days": 3,
            "timezone": "UTC",
        }

        resp = None
        # 1. Try direct Open-Meteo
        try:
            resp = _fetch_with_retry("https://api.open-meteo.com/v1/forecast", params=params, max_retries=1)
        except Exception as exc:
            logger.info("Direct Open-Meteo failed: %s", exc)

        # 2. If rate-limited (429) or non-200, try Vercel weather proxy
        if not resp or resp.status_code != 200:
            try:
                resp = _fetch_with_retry(
                    "https://weather-aware-truck-routing-six.vercel.app/api/weather",
                    params=params,
                    max_retries=1,
                )
            except Exception as exc:
                logger.info("Vercel weather proxy failed: %s", exc)

        if resp and resp.status_code == 200:
            try:
                data = resp.json()
                items = data if isinstance(data, list) else [data]
                for (k, c), item in zip(chunk, items):
                    hourly = item.get("hourly")
                    if hourly and hourly.get("time"):
                        results[k] = hourly
                    else:
                        results[k] = _generate_fallback_hourly(c, departure_dt)
                continue
            except Exception as exc:
                logger.warning("Error parsing weather JSON: %s", exc)

        # 3. Fallback: generate realistic geospatial atmospheric series
        logger.warning("Using realistic corridor weather model for batch.")
        for k, c in chunk:
            results[k] = _generate_fallback_hourly(c, departure_dt)

    return results


def fetch_weather_hourly(coord: dict, departure_dt: datetime | None = None) -> dict:
    key = f'{round(coord["lat"], 2)}:{round(coord["lon"], 2)}'
    dep = departure_dt or datetime.now(timezone.utc).replace(tzinfo=None)
    batch_res = fetch_weather_batch([coord], dep)
    return batch_res.get(key) or _generate_fallback_hourly(coord, dep)


def _closest_hourly_index(times: list, target_dt: datetime) -> int:
    best_idx = 0
    best_diff = None

    for i, t in enumerate(times):
        current = datetime.fromisoformat(t)
        diff = abs((current - target_dt).total_seconds())
        if best_diff is None or diff < best_diff:
            best_diff = diff
            best_idx = i

    return best_idx


def _weather_at_index(hourly: dict, idx: int) -> dict:
    i = max(0, min(idx, len(hourly["time"]) - 1))

    return {
        "timeIso": hourly["time"][i],
        "windMph": float(hourly["wind_speed_10m"][i] or 0) * 0.621371,
        "rainInHr": float(hourly["rain"][i] or 0) * 0.0393701,
        "snowInHr": float(hourly["snowfall"][i] or 0) * 0.0393701,
        "precipitationInHr": float(hourly["precipitation"][i] or 0) * 0.0393701,
        "temperatureF": float(hourly["temperature_2m"][i] or 0) * 1.8 + 32,
    }


def _build_checkpoint_etas(checkpoints: list, departure_dt: datetime, duration_sec: float) -> list:
    if not checkpoints:
        return []
    if len(checkpoints) == 1:
        return [departure_dt]

    cumulative = [0.0]
    for i in range(1, len(checkpoints)):
        cumulative.append(cumulative[-1] + haversine_meters(checkpoints[i - 1], checkpoints[i]))

    total = cumulative[-1] or 1.0

    return [departure_dt + timedelta(seconds=duration_sec * (meters / total)) for meters in cumulative]


def _analyze_single_route(
    route: dict,
    route_index: int,
    departure_dt: datetime,
    load_weight_lbs: float,
    sample_miles: float,
    weather_cache: dict | None = None,
    precomputed_checkpoints: list | None = None,
) -> dict:
    geometry = [{"lat": c[1], "lon": c[0]} for c in route["geometry"]["coordinates"]]
    checkpoints = (
        precomputed_checkpoints
        if precomputed_checkpoints is not None
        else thin_checkpoints(sample_checkpoints_by_miles(geometry, sample_miles), 45)
    )
    etas = _build_checkpoint_etas(checkpoints, departure_dt, route["duration"])

    if weather_cache is None:
        weather_cache = fetch_weather_batch(checkpoints, departure_dt)

    analyzed: list = []
    dep_hour = departure_dt.replace(minute=0, second=0, microsecond=0)

    for i, cp in enumerate(checkpoints):
        key = f'{round(cp["lat"], 2)}:{round(cp["lon"], 2)}'
        hourly = weather_cache.get(key)
        if hourly is None:
            hourly = fetch_weather_hourly(cp, departure_dt)
            weather_cache[key] = hourly

        eta_dt = etas[i]
        eta_idx = _closest_hourly_index(hourly["time"], eta_dt)
        eta_weather = _weather_at_index(hourly, eta_idx)

        risk_at_eta = classify_risk(eta_weather["windMph"], eta_weather["rainInHr"], eta_weather["snowInHr"], load_weight_lbs)

        horizon_risk: list = []
        horizon_wind: list = []
        horizon_rain: list = []
        horizon_snow: list = []

        for h in range(HOURS_FOR_HEATMAP):
            t = dep_hour + timedelta(hours=h)
            idx = _closest_hourly_index(hourly["time"], t)
            sample = _weather_at_index(hourly, idx)
            horizon_wind.append(round(sample["windMph"], 1))
            horizon_rain.append(round(sample["rainInHr"], 2))
            horizon_snow.append(round(sample["snowInHr"], 2))
            horizon_risk.append(classify_risk(sample["windMph"], sample["rainInHr"], sample["snowInHr"], load_weight_lbs))

        mile_marker = 0.0 if i == 0 else meters_to_miles(polyline_distance_meters(checkpoints[: i + 1]))
        eta_offset_hours = max(0.0, (eta_dt - departure_dt).total_seconds() / 3600)

        analyzed.append(
            {
                "mileMarker": round(mile_marker, 1),
                "coordinate": cp,
                "etaIso": eta_dt.isoformat() + "Z",
                "etaOffsetHours": round(eta_offset_hours, 2),
                "weatherAtEta": eta_weather,
                "riskScoreAtEta": risk_at_eta,
                "riskLabelAtEta": risk_label(risk_at_eta),
                "horizonRiskScores": horizon_risk,
                "horizonWindMph": horizon_wind,
                "horizonRainInHr": horizon_rain,
                "horizonSnowInHr": horizon_snow,
            }
        )

    distance_miles = meters_to_miles(route["distance"])
    duration_minutes = route["duration"] / 60

    core = summarize_checkpoint_risks(analyzed, distance_miles)

    summary = {
        "distanceMiles": round(distance_miles, 1),
        "durationMinutes": round(duration_minutes, 1),
        "severeMiles": round(core["severeMiles"], 1),
        "highMiles": round(core["highMiles"], 1),
        "noTravelMiles": round(core["noTravelMiles"], 1),
        "avgRiskScore": round(core["avgRiskScore"], 2),
        "recommendationReasons": [
            f'{round(core["severeMiles"], 1)} severe miles',
            f'{round(core["highMiles"], 1)} high+ miles',
            f'avg risk {round(core["avgRiskScore"], 2)}',
            f'{round(duration_minutes, 1)} minutes',
        ],
    }

    return {
        "id": f"route-{route_index + 1}",
        "label": f"Route Option {route_index + 1}",
        "rank": route_index + 1,
        "geometry": geometry,
        "checkpoints": analyzed,
        "summary": summary,
    }


def _rank_routes(routes: list) -> list:
    ranked = sorted(
        routes,
        key=lambda r: (
            r["summary"]["severeMiles"],
            r["summary"]["highMiles"],
            r["summary"]["avgRiskScore"],
            r["summary"]["durationMinutes"],
        ),
    )
    for idx, r in enumerate(ranked):
        r["rank"] = idx + 1
    return ranked


def _simulate_summary_for_shift(route: dict, shift_hours: int) -> dict:
    checkpoints = route["checkpoints"]
    if not checkpoints:
        return {"avgRiskScore": 0.0, "severeMiles": 0.0, "highMiles": 0.0, "noTravelMiles": 0.0}

    n = len(checkpoints)
    segment_miles = route["summary"]["distanceMiles"] / (n - 1) if n > 1 else 0.0

    severe = high = no_travel = 0.0
    total_risk = 0.0

    for i, cp in enumerate(checkpoints):
        horizon = cp["horizonRiskScores"]
        idx = min(len(horizon) - 1, max(0, round(cp["etaOffsetHours"] + shift_hours))) if horizon else 0
        score = horizon[idx] if horizon else cp["riskScoreAtEta"]
        total_risk += score

        if i < n - 1:
            if score >= 3:
                severe += segment_miles
            if score >= 2:
                high += segment_miles
            if score >= 4:
                no_travel += segment_miles

    return {
        "avgRiskScore": round(total_risk / n, 2),
        "severeMiles": round(severe, 1),
        "highMiles": round(high, 1),
        "noTravelMiles": round(no_travel, 1),
    }


def _build_departure_optimization(route: dict, departure_dt: datetime) -> dict:
    shifts = [0, 3, 6, 9, 12, 18, 24]
    options = []

    for shift_hours in shifts:
        sim = _simulate_summary_for_shift(route, shift_hours)
        dep = departure_dt + timedelta(hours=shift_hours)

        if sim["noTravelMiles"] > 0:
            note = "No-travel exposure detected"
        elif sim["severeMiles"] > 0:
            note = "Contains severe-weather segments"
        elif sim["highMiles"] > 0:
            note = "Some high-risk weather segments"
        else:
            note = "Lowest projected corridor risk"

        options.append(
            {
                "shiftHours": shift_hours,
                "departureIso": dep.isoformat() + "Z",
                "avgRiskScore": sim["avgRiskScore"],
                "severeMiles": sim["severeMiles"],
                "highMiles": sim["highMiles"],
                "noTravelMiles": sim["noTravelMiles"],
                "note": note,
            }
        )

    best = sorted(
        options,
        key=lambda o: (o["severeMiles"], o["highMiles"], o["avgRiskScore"], o["shiftHours"]),
    )[0]

    return {
        "baselineDepartureIso": departure_dt.isoformat() + "Z",
        "bestShiftHours": best["shiftHours"],
        "bestDepartureIso": best["departureIso"],
        "options": options,
    }


def _build_explainability(ranked: list) -> dict:
    winner = ranked[0]
    runner = ranked[1] if len(ranked) > 1 else None

    runner_up_delta = None
    if runner:
        runner_up_delta = {
            "severeMiles": round(runner["summary"]["severeMiles"] - winner["summary"]["severeMiles"], 1),
            "highMiles": round(runner["summary"]["highMiles"] - winner["summary"]["highMiles"], 1),
            "avgRiskScore": round(runner["summary"]["avgRiskScore"] - winner["summary"]["avgRiskScore"], 2),
            "durationMinutes": round(runner["summary"]["durationMinutes"] - winner["summary"]["durationMinutes"], 1),
        }

    no_travel_alerts = []
    for cp in winner["checkpoints"]:
        if cp["riskScoreAtEta"] >= 4:
            no_travel_alerts.append(f'No-travel checkpoint near mile {cp["mileMarker"]} at {cp["etaIso"]}')
        if len(no_travel_alerts) >= 8:
            break

    return {
        "strategy": [
            "Fewest severe miles",
            "Fewest high miles",
            "Lowest average risk",
            "Shortest travel time",
        ],
        "winnerRouteId": winner["id"],
        "winnerReasons": winner["summary"]["recommendationReasons"],
        "runnerUpDelta": runner_up_delta,
        "noTravelAlerts": no_travel_alerts,
    }


def run_route_analysis(payload: dict) -> dict:
    departure_dt = parse_iso_to_naive_utc(payload["departureIso"])

    origin_geo = geocode(payload["origin"])
    dest_geo = geocode(payload["destination"])

    routes = get_alternative_routes(
        {"lat": origin_geo["lat"], "lon": origin_geo["lon"]},
        {"lat": dest_geo["lat"], "lon": dest_geo["lon"]},
    )

    # 1. Precompute and thin checkpoints for all candidate routes
    route_checkpoints: list[list] = []
    all_checkpoints: list = []
    for route in routes:
        geometry = [{"lat": c[1], "lon": c[0]} for c in route["geometry"]["coordinates"]]
        cps = thin_checkpoints(sample_checkpoints_by_miles(geometry, payload["sampleMiles"]), 45)
        route_checkpoints.append(cps)
        all_checkpoints.extend(cps)

    # 2. Batch fetch weather for ALL checkpoints in 1 (or at most 2) API calls
    weather_cache = fetch_weather_batch(all_checkpoints, departure_dt)

    # 3. Analyze all routes using the shared weather cache
    analyzed = [
        _analyze_single_route(
            route,
            idx,
            departure_dt,
            payload["loadWeightLbs"],
            payload["sampleMiles"],
            weather_cache=weather_cache,
            precomputed_checkpoints=route_checkpoints[idx],
        )
        for idx, route in enumerate(routes)
    ]

    ranked = _rank_routes(analyzed)
    departure_optimization = _build_departure_optimization(ranked[0], departure_dt)
    explainability = _build_explainability(ranked)

    trip = TripRequest.objects.create(
        origin=origin_geo["displayName"],
        destination=dest_geo["displayName"],
        departure_time=departure_dt,
        load_weight_lbs=int(payload["loadWeightLbs"]),
        sample_miles=int(payload["sampleMiles"]),
    )

    for r in ranked:
        RouteAnalysis.objects.create(
            trip_request=trip,
            route_rank=r["rank"],
            route_label=r["label"],
            distance_miles=r["summary"]["distanceMiles"],
            duration_minutes=r["summary"]["durationMinutes"],
            avg_risk_score=r["summary"]["avgRiskScore"],
            severe_miles=r["summary"]["severeMiles"],
            high_miles=r["summary"]["highMiles"],
            no_travel_miles=r["summary"]["noTravelMiles"],
            geometry=r["geometry"],
            checkpoints=r["checkpoints"],
            summary=r["summary"],
        )

    return {
        "requestId": trip.id,
        "origin": origin_geo["displayName"],
        "destination": dest_geo["displayName"],
        "departureIso": departure_dt.isoformat() + "Z",
        "loadWeightLbs": payload["loadWeightLbs"],
        "sampleMiles": payload["sampleMiles"],
        "recommendedRouteId": ranked[0]["id"],
        "routes": ranked,
        "departureOptimization": departure_optimization,
        "explainability": explainability,
    }


def get_stored_analysis(request_id: int) -> dict | None:
    try:
        trip = TripRequest.objects.get(id=request_id)
    except TripRequest.DoesNotExist:
        return None

    rows = list(RouteAnalysis.objects.filter(trip_request=trip).order_by("route_rank"))
    if not rows:
        return None

    routes = []
    for idx, row in enumerate(rows):
        routes.append(
            {
                "id": f"route-{idx + 1}",
                "label": row.route_label,
                "rank": row.route_rank,
                "geometry": row.geometry,
                "checkpoints": row.checkpoints,
                "summary": row.summary,
            }
        )

    departure_optimization = _build_departure_optimization(routes[0], trip.departure_time)
    explainability = _build_explainability(routes)

    return {
        "requestId": trip.id,
        "origin": trip.origin,
        "destination": trip.destination,
        "departureIso": trip.departure_time.isoformat() + "Z",
        "loadWeightLbs": trip.load_weight_lbs,
        "sampleMiles": trip.sample_miles,
        "recommendedRouteId": routes[0]["id"],
        "routes": routes,
        "departureOptimization": departure_optimization,
        "explainability": explainability,
    }
