RISK_LABELS = ["Low", "Moderate", "High", "Severe", "No Travel"]


def wind_risk_score(wind_mph: float) -> int:
    if wind_mph >= 55:
        return 4
    if wind_mph >= 45:
        return 3
    if wind_mph >= 35:
        return 2
    if wind_mph >= 25:
        return 1
    return 0


def rain_risk_score(rain_in_hr: float) -> int:
    if rain_in_hr > 1.0:
        return 4
    if rain_in_hr >= 0.5:
        return 3
    if rain_in_hr >= 0.25:
        return 2
    if rain_in_hr >= 0.1:
        return 1
    return 0


def snow_risk_score(snow_in_hr: float) -> int:
    if snow_in_hr > 3.0:
        return 4
    if snow_in_hr >= 2.0:
        return 3
    if snow_in_hr >= 1.0:
        return 2
    if snow_in_hr >= 0.5:
        return 1
    return 0


def apply_load_rules(base_risk: int, wind_mph: float, load_weight_lbs: float) -> int:
    if wind_mph >= 55:
        return 4
    if 45 <= wind_mph < 55 and load_weight_lbs > 30000:
        return 4
    if 35 <= wind_mph < 45 and load_weight_lbs > 40000:
        return max(base_risk, 3)
    return base_risk


def classify_risk(wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_weight_lbs: float) -> int:
    weather_risk = max(
        wind_risk_score(wind_mph),
        rain_risk_score(rain_in_hr),
        snow_risk_score(snow_in_hr),
    )
    return apply_load_rules(weather_risk, wind_mph, load_weight_lbs)


def risk_label(score: int) -> str:
    return RISK_LABELS[max(0, min(4, score))]


def summarize_checkpoint_risks(checkpoints: list, distance_miles: float) -> dict:
    if not checkpoints:
        return {"severeMiles": 0.0, "highMiles": 0.0, "noTravelMiles": 0.0, "avgRiskScore": 0.0}

    segment_miles = distance_miles / (len(checkpoints) - 1) if len(checkpoints) > 1 else 0.0

    severe_miles = 0.0
    high_miles = 0.0
    no_travel_miles = 0.0

    for i in range(len(checkpoints) - 1):
        score = checkpoints[i]["riskScoreAtEta"]
        if score >= 3:
            severe_miles += segment_miles
        if score >= 2:
            high_miles += segment_miles
        if score >= 4:
            no_travel_miles += segment_miles

    avg_risk_score = sum(cp["riskScoreAtEta"] for cp in checkpoints) / max(1, len(checkpoints))

    return {
        "severeMiles": severe_miles,
        "highMiles": high_miles,
        "noTravelMiles": no_travel_miles,
        "avgRiskScore": avg_risk_score,
    }
