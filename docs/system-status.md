# System Status — Pipeline Leak Detection Backend

> **Audience:** Engineers, QA, and project stakeholders who are not yet familiar with this codebase.
> **Purpose:** A single, authoritative plain-language reference for what the system currently does, how the modules connect, and what is deliberately not yet built.
>
> Last updated: 2026-08-15

---

## 1. What This System Is

This is a **NestJS REST API backend** for an oil-pipeline leak detection system. Its job is to:

1. Store a model of the physical pipeline network (pipelines → segments → sensors).
2. Ingest real-time telemetry readings from field sensors (pressure, flow rate, temperature).
3. Automatically analyse those readings every few seconds and flag anomalies as **Leak Incidents**.
4. Surface incidents and pipeline status through a REST API so operator dashboards or integration partners can query them.

The backend runs against a **PostgreSQL** database managed via Prisma ORM, and uses JWT-based authentication to protect its endpoints.

---

## 2. Module Inventory

The backend is divided into **nine NestJS modules**. Each lives in `src/modules/<name>/`.

---

### 2.1 Auth Module (`src/modules/auth/`)

**What it does:** Handles user registration, login, and JWT-based session management.

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/auth/signup` | `POST` | Registers a new user account. Default role is `OPERATOR`. |
| `/auth/login` | `POST` | Authenticates credentials, returns access + refresh tokens. |
| `/auth/refresh` | `POST` | Issues a new access token given a valid refresh token. |

**How it works:**
- Passwords are hashed with **bcrypt** (10 salt rounds) before storage. The raw password is never persisted.
- On successful login or signup, the service generates two JWTs: a **short-lived access token** (default: 15 minutes) and a **long-lived refresh token** (default: 7 days).
- The hashed refresh token is stored on the `User` record (`refreshTokenHash`). On a `/auth/refresh` call, the submitted token is compared against this hash before new tokens are issued — this lets the system invalidate all sessions by clearing the hash.
- **Role system:** Three roles exist: `ADMIN`, `OPERATOR`, and `FIELD_ENGINEER`. By default, signup creates an `OPERATOR`. A caller with an `ADMIN` JWT can pass an explicit `role` in the signup body to provision any role.
- **Signup `role` field:** The field is intentionally left open in the DTO (optional, unenforced at the schema level) to allow bootstrapping the first `ADMIN` account directly. Once the first admin exists, the service logic rejects non-operator role assignments from unauthenticated callers.

**Protected routes:** All non-auth endpoints are guarded by a `JwtAuthGuard` that validates the `Authorization: Bearer <token>` header against `JWT_ACCESS_SECRET`.

---

### 2.2 Users Module (`src/modules/users/`)

**What it does:** Provides admin-level management of user accounts.

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/users` | `GET` | Lists all users (admin-only). |
| `/users/:id` | `GET` | Gets a single user by ID. |
| `/users/:id` | `PATCH` | Updates a user's name, email, or role. |
| `/users/:id` | `DELETE` | Removes a user account. |

User passwords and refresh token hashes are stripped from all API responses by the service layer before returning.

---

### 2.3 Pipelines Module (`src/modules/pipelines/`)

**What it does:** Manages the top-level pipeline entities. A **Pipeline** is a named physical pipeline (e.g., "North–South Trunk Line").

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/pipelines` | `POST` | Creates a pipeline record. |
| `/pipelines` | `GET` | Lists all pipelines with their segments and sensors. |
| `/pipelines/:id` | `GET` | Gets a single pipeline with full segment + incident detail. |
| `/pipelines/:id` | `PATCH` | Updates pipeline name or description. |
| `/pipelines/:id` | `DELETE` | Deletes a pipeline (cascades to its segments). |

---

### 2.4 Segments Module (`src/modules/segments/`)

**What it does:** Manages **Segments** — the monitored sub-spans of a pipeline between two sensor positions.

A segment is the fundamental unit of leak detection. The Detection Engine evaluates segments, not whole pipelines.

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/segments` | `POST` | Creates a segment within a pipeline. |
| `/segments` | `GET` | Lists all segments with pipeline, sensor, and incident data. |
| `/segments/:id` | `GET` | Gets a single segment with full detail. |
| `/segments/:id` | `PATCH` | Updates a segment (e.g., assigns `startSensorId` / `endSensorId`). |
| `/segments/:id` | `DELETE` | Deletes a segment. |

**Status field:** Each segment carries a `status` field (`NORMAL`, `WARNING`, `LEAK`) that is written **exclusively by the Detection Engine** — never by the Segments module directly. This is the live health state that dashboards should display.

---

### 2.5 Sensors Module (`src/modules/sensors/`)

**What it does:** Manages physical **Sensor** devices registered in the system.

Sensors are assigned to a segment and hold metadata (serial number, GPS coordinates, installation date, active/inactive flag). Each sensor is linked to a segment via the `segmentId` field, and a segment designates its entry and exit sensors via `startSensorId` / `endSensorId` on the `Segment` record.

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/sensors` | `POST` | Registers a new sensor device. |
| `/sensors` | `GET` | Lists all sensors. |
| `/sensors/:id` | `GET` | Gets a single sensor. |
| `/sensors/:id` | `PATCH` | Updates sensor metadata (e.g., deactivates it). |
| `/sensors/:id` | `DELETE` | Removes a sensor. |

---

### 2.6 Readings Module (`src/modules/readings/`)

**What it does:** Ingests and queries raw telemetry readings from field sensors.

This is the data entry point for the entire system. Field devices (or a simulator) push readings here; the Detection Engine pulls from here.

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/readings` | `POST` | Ingests a new reading for a given sensor (pressure, flowRate, temperature). |
| `/readings` | `GET` | Queries stored readings (with optional `sensorId` filter and `limit`). |

Readings are stored as `SensorReading` records and indexed by `(sensorId, recordedAt)` for efficient time-series retrieval by the Detection Engine.

---

### 2.7 Detection Module (`src/modules/detection/`)

**What it does:** The automated, scheduled heart of the system. Runs continuously in the background on a timer and evaluates every active segment for signs of a pipeline leak.

This module has **no REST endpoints** — it is entirely background-driven.

**How it works (detailed):** See [`docs/detection-engine.md`](./detection-engine.md) for the full operational guide. In summary:

1. **Every `DETECTION_INTERVAL_MS` milliseconds** (default: 10 s), the `DetectionService` fetches all segments that have both a start and end sensor assigned.
2. For each segment, it fetches the most recent `DETECTION_SAMPLE_SIZE` readings (default: 5) from both sensors.
3. It evaluates two independent physical signals:
   - **Pressure Signal:** Has pressure at the start sensor dropped more than `DETECTION_PRESSURE_DROP_THRESHOLD_PCT`% below baseline for `minSustainedTicks` consecutive ticks?
   - **Flow Signal:** Is there a flow rate difference of more than `DETECTION_FLOW_MISMATCH_TOLERANCE_PCT`% between entry and exit for `flowMinSustainedTicks` consecutive ticks?
4. Based on the combination of signals, it decides one of **6 outcomes** (see Section 4 below and [`docs/detection-engine.md`](./detection-engine.md) for the full table).
5. All decisions are written to the database and emitted as internal `EventEmitter2` events for downstream consumption.

---

### 2.8 Incidents Module (`src/modules/incidents/`)

**What it does:** Exposes a **read-only** REST API for querying `LeakIncident` records created by the Detection Engine. Operators use this to review active and historical incidents.

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/incidents` | `GET` | Lists all incidents ordered by detection time, with segment and pipeline context. |
| `/incidents/:id` | `GET` | Gets a single incident with full sensor and alert log detail. |

**Important:** This module does not create, update, or delete incidents. All writes to `LeakIncident` are performed exclusively by the Detection Engine to preserve a single authoritative source of truth.

---

### 2.9 Health Module (`src/modules/health/`)

**What it does:** Provides a simple liveness endpoint.

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Returns `{ status: "ok" }`. Used by load balancers and deployment health checks. |

---

## 3. How the Modules Connect

Here is the full data and event flow from authentication through to incident creation:

```
 ┌─────────────┐    auth tokens     ┌───────────────────┐
 │  Auth Module │ ────────────────► │ JWT Guard (global) │
 └─────────────┘                    └─────────┬─────────┘
                                              │ protects all routes
                                              ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                     Domain Entity Modules (REST)                     │
 │  Pipelines ──► Segments ──► Sensors                                  │
 │  (admin setup: create the pipeline graph and register sensor devices)│
 └──────────────────────────┬──────────────────────────────────────────┘
                            │ startSensorId / endSensorId assigned
                            ▼
 ┌──────────────────────────────────────────┐
 │            Readings Module               │
 │  POST /readings ──► SensorReading table  │
 │  (field devices push telemetry here)     │
 └──────────────────────────┬───────────────┘
                            │ polled every DETECTION_INTERVAL_MS
                            ▼
 ┌──────────────────────────────────────────┐
 │          Detection Engine (background)   │
 │  Two-signal evaluation per segment       │
 │  Writes to: LeakIncident, Segment.status │
 │  Emits: incident.created                 │
 │         incident.upgraded                │
 └──────────────────────────┬───────────────┘
                            │ EventEmitter2 events
                            ▼
                ┌────────────────────────┐
                │  [Alerting Module]     │
                │  Not yet implemented.  │
                │  Will subscribe to     │
                │  incident.created and  │
                │  incident.upgraded to  │
                │  dispatch SMS/Email.   │
                └────────────────────────┘

 ┌──────────────────────────────────────────┐
 │         Incidents Module (REST)          │
 │  GET /incidents — read-only query layer  │
 │  for operators and dashboards            │
 └──────────────────────────────────────────┘
```

---

## 4. Detection Engine — Full Decision Table

The engine runs per-segment and produces exactly one of the following outcomes each cycle:

| # | Outcome | Condition | Segment Status | Incident Confidence | What Happens |
| :-- | :--- | :--- | :--- | :--- | :--- |
| 1 | **High-Confidence Leak** | Both pressure (≥15% drop, ≥3 ticks) AND flow (≥10% mismatch, ≥3 ticks) agree | → `LEAK` | 0.95 | New `LeakIncident` created. `incident.created` emitted. |
| 2 | **Low-Confidence Warning (Pressure-only)** | Pressure drop only, sustained ≥ `minTicks + 2` (default: 5 ticks) | → `WARNING` | 0.65 | New `LeakIncident` created. `incident.created` emitted. |
| 3 | **Low-Confidence Warning (Flow-only)** | Flow mismatch only, sustained ≥ `flowMinSustainedTicks` (default: 3 ticks) | → `WARNING` | 0.65 | New `LeakIncident` created. `incident.created` emitted. |
| 4 | **Incident Upgraded** | Existing OPEN incident at 0.65 (WARNING), and now both signals agree | WARNING → `LEAK` | 0.65 → **0.95** | Existing incident `confidence` updated to 0.95. No new record. `incident.upgraded` emitted. |
| 5 | **Duplicate Skipped** | Anomaly detected, but open incident already matches or exceeds current confidence level | Unchanged | Unchanged | No DB writes. Logged with reason (HIGH CONFIDENCE or SAME TIER). |
| 6 | **Auto-Resolved** | Open incident exists, but both readings have dropped below 50% of thresholds | → `NORMAL` | N/A | Incident set to `RESOLVED` with timestamp. Segment reset to `NORMAL`. |

If none of the above conditions are met, the engine logs `[NO ACTION]` and moves on.

---

## 5. What Does Not Exist Yet

This section is intentionally explicit so that anyone onboarding understands the current capability boundaries.

| Missing Capability | Status | Notes |
| :--- | :--- | :--- |
| **Alerting Module** | ❌ Not implemented | The `incident.created` and `incident.upgraded` events are emitted, but nothing is listening to them. No SMS, email, or push notification is sent when a leak is detected. The `AlertLog` table exists in the schema but is never written to. |
| **Real-time transport to frontend** | ❌ Not implemented | There are no WebSockets, Server-Sent Events, or polling endpoints that push live incident updates to a dashboard. The frontend (if one exists) must poll `GET /incidents` manually. |
| **Role-based endpoint guards** | ⚠️ Partial | `JwtAuthGuard` is applied globally (all routes require a valid token). However, granular role checks (e.g., "only ADMIN can delete a pipeline") are not yet enforced at the route level — any authenticated user can call any endpoint. |
| **Signup `role` field enforcement** | ⚠️ Intentionally open | The `role` field in the signup DTO is optional and unenforced at the schema level. This is by design to allow bootstrapping the first admin account. Once the first ADMIN exists, the `AuthService` logic restricts non-operator role assignment to ADMIN callers only. |
| **Pagination on list endpoints** | ❌ Not implemented | All `GET` list endpoints return unbounded results. For small datasets this is fine; in production with many readings or incidents, these queries need `skip`/`take` pagination. |
| **Sensor deduplication / conflict checks** | ❌ Not implemented | If a sensor is assigned as the `startSensor` of two different segments simultaneously, the system will not raise an error. |
| **Manual incident management** | ❌ Not implemented | Operators cannot manually acknowledge, comment on, or close incidents via the API — only the Detection Engine can change incident status. A future `PATCH /incidents/:id` route would expose this. |

---

## 6. Key Database Models (Quick Reference)

| Model | Purpose |
| :--- | :--- |
| `User` | Authenticated operator or admin account. |
| `Pipeline` | A named physical pipeline. Parent of Segments. |
| `Segment` | A monitored span of pipe between two sensor positions. Carries live `status`. |
| `Sensor` | A physical field device. Linked to a Segment; designated as start or end sensor. |
| `SensorReading` | A single telemetry record (pressure, flowRate, temperature) for one sensor at one timestamp. |
| `LeakIncident` | An anomaly event raised by the Detection Engine. Has `confidence`, `status` (OPEN/RESOLVED), and timestamps. |
| `AlertLog` | Intended log of alert dispatch attempts (SMS, email, push). Not yet written to. |

All IDs are CUID strings. All timestamps are stored as UTC `DateTime`. The schema is managed via Prisma and lives at `prisma/schema.prisma`.

---

## 7. Running the System Locally

```bash
# 1. Copy environment variables
cp .env.example .env
# Edit .env with your local DATABASE_URL and JWT secrets

# 2. Start the database
docker-compose up -d

# 3. Apply schema migrations
npx prisma migrate dev

# 4. (Optional) Seed test data
npx ts-node prisma/seed.ts

# 5. Start the API server
npm run start:dev
# Server starts at http://localhost:3000
# Swagger docs available at http://localhost:3000/api
```

The Detection Engine starts automatically when the server boots — no manual trigger is needed.
