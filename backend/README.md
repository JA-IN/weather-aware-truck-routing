# Django Backend — Weather-Aware Truck Routing

This is the Django + Django REST Framework implementation of the route/weather/risk analysis engine,
matching the assessment's "React + Django" architecture. It is a functional port of the TypeScript logic in
`../src/lib/` and exposes the same API contract consumed by the React frontend.

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # edit DATABASE_URL / DJANGO_SECRET_KEY / CORS_ALLOWED_ORIGINS as needed
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

By default (no `DATABASE_URL`), this uses a local SQLite file (`backend/db.sqlite3`). To use PostgreSQL,
set `DATABASE_URL` in `backend/.env`, e.g.:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
```

Django manages its own tables (`django_trip_requests`, `django_route_analyses`), so it is safe to point it
at the same Postgres database the Next.js/Drizzle app uses without any table collisions.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/route-analysis` | Runs geocoding, routing, weather sampling, risk scoring, ranking, departure optimization, and explainability; persists the result. |
| `GET` | `/api/route-analysis?requestId=<id>` | Retrieves a previously stored analysis. |
| `GET` | `/api/health` | Health check (verifies DB connectivity). |

### Example request

```bash
curl -X POST http://localhost:8000/api/route-analysis \
  -H 'Content-Type: application/json' \
  -d '{
    "origin": "Dallas, TX",
    "destination": "Denver, CO",
    "departureIso": "2026-10-11T18:00:00Z",
    "loadWeightLbs": 36000,
    "sampleMiles": 25
  }'
```

## Connecting the React frontend

Set `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` (or your deployed Django URL) in the Next.js app's
environment before building/running it. The frontend will call this backend directly in the browser instead
of its own built-in API routes. See the top-level `README.md` for full details.

## Notes

- `USE_TZ = False` is intentional: it keeps all timestamps as naive UTC datetimes, matching Open-Meteo's
  UTC hourly series and the equivalent TypeScript implementation exactly.
- CORS is wide open by default for local development convenience (`CORS_ALLOW_ALL_ORIGINS`). Set
  `CORS_ALLOWED_ORIGINS` in `.env` to restrict it in production.
- A lightweight in-memory rate limiter (20 requests/min/IP) protects `POST /api/route-analysis`. Swap in
  Redis-backed throttling (e.g., DRF's `ScopedRateThrottle` with a cache backend) for multi-process/production
  deployments.
