import logging
import time

from django.db import connection
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

from .serializers import RouteAnalysisRequestSerializer
from .services import AnalysisError, get_stored_analysis, run_route_analysis

RATE_LIMIT_PER_WINDOW = 20
RATE_LIMIT_WINDOW_SECONDS = 60
_rate_log: dict[str, list[float]] = {}


def _client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "unknown")


def _is_rate_limited(ip: str) -> bool:
    now = time.time()
    hits = [t for t in _rate_log.get(ip, []) if now - t < RATE_LIMIT_WINDOW_SECONDS]

    if len(hits) >= RATE_LIMIT_PER_WINDOW:
        _rate_log[ip] = hits
        return True

    hits.append(now)
    _rate_log[ip] = hits
    return False


class RouteAnalysisView(APIView):
    def post(self, request):
        ip = _client_ip(request)
        if _is_rate_limited(ip):
            return Response(
                {"error": "Too many requests. Please wait and retry."},
                status=429,
                headers={"Retry-After": "60"},
            )

        serializer = RouteAnalysisRequestSerializer(data=request.data)
        if not serializer.is_valid():
            first_error = next(iter(serializer.errors.values()))[0]
            return Response({"error": str(first_error)}, status=400)

        try:
            result = run_route_analysis(serializer.validated_data)
        except AnalysisError as exc:
            logger.warning("AnalysisError in RouteAnalysisView: %s", exc)
            return Response({"error": str(exc)}, status=502)
        except Exception as exc:  # noqa: BLE001 - surfaced to client intentionally
            logger.exception("Unexpected exception in RouteAnalysisView: %s", exc)
            return Response({"error": str(exc)}, status=500)

        return Response(result, status=200)

    def get(self, request):
        raw_id = request.query_params.get("requestId")
        if not raw_id or not raw_id.isdigit():
            return Response({"error": "A valid requestId query parameter is required."}, status=400)

        data = get_stored_analysis(int(raw_id))
        if not data:
            return Response({"error": "Analysis not found"}, status=404)

        return Response(data, status=200)


class HealthView(APIView):
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            return Response({"ok": True})
        except Exception:  # noqa: BLE001
            return Response({"ok": False}, status=500)
