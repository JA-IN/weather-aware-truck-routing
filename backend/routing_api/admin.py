from django.contrib import admin

from .models import RouteAnalysis, TripRequest


@admin.register(TripRequest)
class TripRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "origin", "destination", "departure_time", "load_weight_lbs", "sample_miles", "created_at")


@admin.register(RouteAnalysis)
class RouteAnalysisAdmin(admin.ModelAdmin):
    list_display = ("id", "trip_request", "route_rank", "route_label", "distance_miles", "avg_risk_score")
