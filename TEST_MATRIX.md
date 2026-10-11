# Test Matrix Report

Generated: 2026-10-11
Environment: Platform preview sandbox
Preview URL used: `https://3000-it2nnnmqbxv0j7rdrxz1r.e2b.app`

## Legend
- **PASS**: Requirement verified successfully
- **FAIL**: Requirement verified and failed
- **BLOCKED**: Could not execute due sandbox/runtime limitation

---

## A) Automated UI / E2E Flows

| Coverage ID | Test | Method | Result | Evidence |
|---|---|---|---|---|
| E2E-001 | Form submit -> analysis dashboard appears | Playwright Chromium test | **BLOCKED** | Browser failed to launch due missing shared lib `libnspr4.so` |
| E2E-002 | Playback controls (Play/Pause/Reset + timeline progression) | Playwright | **BLOCKED** | Same runtime browser dependency issue |
| E2E-003 | Layer toggles (risk/wind/precipitation/snow/closures) | Playwright | **BLOCKED** | Same runtime browser dependency issue |
| E2E-004 | Side-by-side compare interaction | Playwright | **BLOCKED** | Same runtime browser dependency issue |
| E2E-005 | Scenario snapshot cards rendered after analysis | Playwright | **BLOCKED** | Same runtime browser dependency issue |

**Conclusion (A):** Automated browser E2E was **blocked by sandbox missing system browser libs**, not by app compile/runtime failure.

---

## B) Performance / Load Metrics

### Targets used for this pass
- Health endpoint p95 < 250ms under light load
- Health endpoint concurrency: zero non-2xx for 50 requests at parallelism 10
- Route analysis endpoint baseline latency measured (informational)

| Coverage ID | Test | Result | Status |
|---|---|---|---|
| PERF-001 | `/api/health` latency sample (20 requests) | avg `0.0777s`, p95 `0.1366s`, max `0.2495s` | **PASS** |
| PERF-002 | `/api/route-analysis` latency sample (5 requests) | avg `8.6416s`, p95 `8.7061s`, max `9.3743s` | **PASS** (informational baseline) |
| PERF-003 | `/api/health` concurrency (50 req, 10 parallel) | 50/50 `2xx`, non-2xx `0`, avg `0.0913s`, p95 `0.1335s` | **PASS** |

**Conclusion (B):** Health endpoint performance passed the chosen baseline; route-analysis is heavier as expected due external APIs.

---

## C) Security-focused Checks

| Coverage ID | Test | Expected | Actual | Status |
|---|---|---|---|---|
| SEC-001 | Security headers on `/` | Baseline hardening headers present | `x-frame-options`, `x-content-type-options`, `csp`, `hsts`, `referrer-policy` missing | **FAIL** |
| SEC-002 | Method abuse on `/api/route-analysis` (PUT/DELETE) | Reject unsupported methods | `405` returned for both | **PASS** |
| SEC-003 | Malformed JSON request body | Graceful client error (`400`) | Returned `500` parse error payload | **FAIL** |
| SEC-004 | Oversized field input | Validation rejection | `400` with max-length validation | **PASS** |
| SEC-005 | Injection-style origin payload | Safe handling without unsafe DB eval; preferably validation failure | Returned handled error path (`500` upstream geocode failure), no DB exploit observed | **PARTIAL / WARN** |

**Conclusion (C):** Security posture is **mixed**. Input size/method checks pass, but header hardening and malformed-JSON handling need improvement.

---

## D) Cross-browser / Responsive Matrix

| Coverage ID | Test | Result | Status |
|---|---|---|---|
| XBR-001 | Chromium UI flow | Browser runtime dependency missing in sandbox | **BLOCKED** |
| XBR-002 | Firefox UI flow | Not executable after Chromium runtime failure in this environment | **BLOCKED** |
| XBR-003 | WebKit UI flow | Not executable after Chromium runtime failure in this environment | **BLOCKED** |
| RWD-001 | Mobile viewport responsive interaction | Requires browser automation/manual device emulation | **BLOCKED** |
| RWD-002 | Tablet/Desktop viewport responsive interaction | Requires browser automation/manual device emulation | **BLOCKED** |

**Conclusion (D):** Cross-browser/responsive verification is **blocked in current sandbox**; execute in CI runner with full Playwright dependencies.

---

## E) Existing API/Integration Baseline (already re-verified)

| Coverage ID | Test | Result | Status |
|---|---|---|---|
| API-001 | `/api/health` returns success | `200 {"ok":true}` | **PASS** |
| API-002 | Happy path analysis POST | `200`, 3 routes, optimizer + explainability present | **PASS** |
| API-003 | Retrieval by requestId | `200`, consistent request data | **PASS** |
| API-004 | Validation (missing origin, bad sampleMiles, negative load) | `400` returned | **PASS** |
| API-005 | Unknown requestId | `404` returned | **PASS** |
| API-006 | Rate limit under burst | `429` triggered as expected | **PASS** |

---

## Overall Status

- ✅ API/integration baseline: **PASS**
- ✅ Performance/load baseline: **PASS**
- ⚠️ Security hardening: **PARTIAL (has FAIL items)**
- ⛔ Automated browser E2E + cross-browser/responsive: **BLOCKED in this sandbox**

## Recommended Next Actions
1. Add security headers in `next.config.ts` (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
2. Return `400` for malformed JSON in route-analysis POST (explicit JSON parse guard).
3. Move E2E to CI agent with full Playwright browser dependencies and run Chromium/Firefox/WebKit matrix.
4. Add viewport matrix tests (`mobile/tablet/desktop`) with screenshot assertions.
