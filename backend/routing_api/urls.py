from django.urls import path

from .views import HealthView, RouteAnalysisView

urlpatterns = [
    path("route-analysis", RouteAnalysisView.as_view()),
    path("health", HealthView.as_view()),
]
