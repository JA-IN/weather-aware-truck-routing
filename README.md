# Weather-Aware Truck Routing

A fullstack route analysis app that compares route options by weather risk, load weight, and travel time.

This repository ships **two backend implementations of the exact same logic**, so you can run it either way:

1. **Managed preview mode (this platform)** — Next.js App Router does both frontend (React) and backend
   (API routes) + PostgreSQL via Drizzle ORM. This is what the platform's `build_and_start` / health checks
   validate, and what runs in the hosted preview.
2. **React + Django mode (per assessment spec)** — The same React UI (served by Next.js) calls a separate
   **Django + Django REST Framework** backend in `backend/`, which re-implements identical geocoding,
   routing, weather, risk-rule, and recommendation logic in Python, backed by Django ORM models.

Switching between the two requires no frontend code changes — only one environment variable
(`NEXT_PUBLIC_API_BASE_URL`), see [React + Django mode](#react--django-mode) below.

## Tech Stack
- **Frontend (both modes)**: Next.js App Router, React, Tailwind, Leaflet (react-leaflet)
- **Backend (Mode 1 — this hosted preview)**: Next.js Route Handlers + PostgreSQL + Drizzle ORM
- **Backend (Mode 2 — assessment spec)**: Django + Django REST Framework (`backend/`), Django ORM
  (PostgreSQL or SQLite)
- **APIs** (used identically by both backends):
  - Geocoding: Nominatim
  - Routing: OSRM
  - Weather: Open-Meteo

## Setup (Mode 1 — Next.js full stack, used by this hosted preview)
1. Ensure PostgreSQL is available.
2. Configure `.env`:
   - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db`
3. Install dependencies:
   - `npm install`
4. Push schema:
   - `npx drizzle-kit push`
5. Run app:
   - `npm run dev`
6. Open `/` for the welcome page and `/planner` for the route analysis command center.

## React + Django mode

The React frontend (same Next.js app) can be pointed at an independent Django REST API instead of the
built-in Next.js API routes. This matches the original "React + Django" architecture from the assessment
document.

### 1. Run the Django backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate   # or use your preferred env manager
pip install -r requirements.txt
cp .env.example .env                                  # edit DATABASE_URL / CORS as needed
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```
- Defaults to SQLite if `DATABASE_URL` is not set; or point it at Postgres (same instance as Next.js is fine —
  Django uses its own tables: `django_trip_requests`, `django_route_analyses`, so there is no collision with
  the Drizzle-managed tables).
- Exposes:
  - `POST /api/route-analysis`
  - `GET /api/route-analysis?requestId=<id>`
  - `GET /api/health`
- CORS is enabled (configure `CORS_ALLOWED_ORIGINS` in `backend/.env` for production).

### 2. Point the React frontend at Django
Set an environment variable for the Next.js app:
```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```
Then run the frontend as usual (`npm run dev` or build/deploy it). All `fetch` calls in
`src/components/route-planner.tsx` go through `src/lib/api-config.ts`'s `apiUrl()` helper, so when this
variable is set, the browser calls the Django backend directly instead of the Next.js API routes — no other
code changes required.

Leaving `NEXT_PUBLIC_API_BASE_URL` unset keeps the app on Mode 1 (Next.js API routes), which is what this
platform's managed preview and `build_and_start` healthcheck exercise.

### Backend code layout (`backend/`)
```
backend/
  manage.py
  requirements.txt
  config/            # Django project (settings, urls, wsgi/asgi)
  routing_api/
    models.py        # TripRequest, RouteAnalysis (Django ORM)
    serializers.py    # DRF request validation
    geo.py            # haversine / checkpoint sampling (ported from src/lib/geo.ts)
    risk.py           # wind/rain/snow + load-weight risk rules (ported from src/lib/risk.ts)
    services.py        # geocode, OSRM routing, Open-Meteo weather, ranking,
                        # departure optimization, explainability, persistence
                        # (ported from src/lib/weather-routing.ts)
    views.py          # RouteAnalysisView (POST/GET), HealthView
    urls.py
```
The Python logic is a line-for-line functional port of the TypeScript implementation in `src/lib/`, so both
backends produce the same route ranking, risk classification, and explainability output for the same input.

## Assessment Requirement Coverage

### Inputs
- Origin + destination ✅
- Departure date/time ✅
- Load weight ✅

### Routing
- Generates 3 route options ✅
- Uses external routing API ✅

### Weather Sampling
- Checkpoints sampled every 10 / 25 / 50 miles ✅
- Uses ETA at each checkpoint ✅

### Risk Logic
- Wind/rain/snow thresholds applied ✅
- Load rules applied ✅

### Recommendation Logic
Prioritization order implemented exactly:
1. Fewest severe miles ✅
2. Fewest high miles ✅
3. Lowest average risk ✅
4. Shortest travel time ✅

### Visualization
- Interactive map with routes + checkpoint markers ✅
- ETA/risk/weather checkpoint table ✅
- Corridor weather heatmap with 0–48h slider ✅

## API
- `POST /api/route-analysis`:
  - Validates payload with Zod
  - Rate limited (in-memory)
  - Executes route + weather analysis
  - Persists request/result in PostgreSQL
- `GET /api/route-analysis?requestId=<id>`:
  - Returns stored analysis

## Data Model
- `trip_requests`: request metadata
- `route_analyses`: per-route scored outputs including geometry/checkpoints/summary JSON

## Production Notes
- Added retry + timeout wrapping for upstream API calls.
- Added strict input validation and basic rate limiting.
- For internet-scale production, replace in-memory rate limiter with Redis and add observability (logs/metrics/traces).
