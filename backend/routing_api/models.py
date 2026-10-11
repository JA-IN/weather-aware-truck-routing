from django.db import models


class TripRequest(models.Model):
    origin = models.CharField(max_length=255)
    destination = models.CharField(max_length=255)
    departure_time = models.DateTimeField()
    load_weight_lbs = models.IntegerField()
    sample_miles = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "django_trip_requests"

    def __str__(self) -> str:
        return f"{self.origin} -> {self.destination} ({self.id})"


class RouteAnalysis(models.Model):
    trip_request = models.ForeignKey(TripRequest, related_name="routes", on_delete=models.CASCADE)
    route_rank = models.IntegerField()
    route_label = models.CharField(max_length=120)
    distance_miles = models.FloatField()
    duration_minutes = models.FloatField()
    avg_risk_score = models.FloatField()
    severe_miles = models.FloatField()
    high_miles = models.FloatField()
    no_travel_miles = models.FloatField()
    geometry = models.JSONField()
    checkpoints = models.JSONField()
    summary = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "django_route_analyses"
        ordering = ["route_rank"]

    def __str__(self) -> str:
        return f"{self.route_label} (rank {self.route_rank}) for trip {self.trip_request_id}"
