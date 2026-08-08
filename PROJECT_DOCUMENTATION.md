# Oil Flow Detection — Backend Documentation

> NestJS backend for an AI-based pipeline leakage detection and alert system.
> This document covers every file that was created, what role it plays, and how the system hangs together.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Root-Level Files](#root-level-files)
4. [Prisma & Database Layer](#prisma--database-layer)
5. [Config Layer](#config-layer)
6. [Common Layer (Shared Infrastructure)](#common-layer-shared-infrastructure)
7. [Domain Modules](#domain-modules)
   - [Auth](#auth-module)
   - [Users](#users-module)
   - [Pipelines](#pipelines-module)
   - [Segments](#segments-module)
   - [Sensors](#sensors-module)
   - [Readings](#readings-module)
   - [Incidents](#incidents-module)
   - [Health](#health-module)
8. [App Bootstrap](#app-bootstrap)
9. [How Everything Connects](#how-everything-connects)
10. [API Endpoint Reference](#api-endpoint-reference)
11. [Startup Commands](#startup-commands)

---

## Tech Stack

| Concern | Tool / Package |
|---|---|
| Framework | NestJS (TypeScript) |
| Database | PostgreSQL (local Docker / Supabase-hosted) |
| ORM | **Prisma 7** (`prisma-client` provider) |
| DB Adapter | `@prisma/adapter-pg` + `pg` |
| Auth | Passport JWT — access token + refresh token |
| Password Hashing | `bcrypt` |
| Validation | `class-validator` + `class-transformer` |
| Config / Env | `@nestjs/config` + `zod` (fail-fast validation) |
| API Docs | `@nestjs/swagger` (OpenAPI) |
| Dev Database | Docker Compose (local Postgres) |

---

## Project Structure

```
Oil Flow Detection/
│
├── prisma/
│   ├── schema.prisma          # Database schema & model definitions
│   └── migrations/            # Prisma migration files (auto-generated)
│
├── generated/
│   └── prisma/                # Prisma 7 generated client (auto-generated, do not edit)
│
├── src/
│   ├── main.ts                # Application entry point
│   ├── app.module.ts          # Root module — wires everything together
│   │
│   ├── common/                # Shared cross-cutting infrastructure
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   ├── public.decorator.ts
│   │   │   └── roles.decorator.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   └── interceptors/
│   │       └── logging.interceptor.ts
│   │
│   ├── config/
│   │   ├── env.validation.ts  # Zod schema — validates env vars at startup
│   │   └── configuration.ts   # Maps env vars into typed config object
│   │
│   ├── prisma/
│   │   ├── prisma.module.ts   # Global Prisma module
│   │   └── prisma.service.ts  # Prisma Client wrapper with adapter-pg
│   │
│   └── modules/
│       ├── auth/              # Authentication — signup, login, refresh
│       ├── users/             # User administration
│       ├── pipelines/         # Pipeline CRUD
│       ├── segments/          # Segment CRUD
│       ├── sensors/           # Sensor CRUD
│       ├── readings/          # Sensor telemetry ingestion
│       ├── incidents/         # Leak incident read access
│       └── health/            # Health check endpoint
│
├── prisma.config.ts           # Prisma 7 config — database URL & migration path
├── docker-compose.yml         # Local PostgreSQL container
├── Dockerfile                 # Multi-stage build image
├── .env                       # Local environment variables (not committed)
└── .env.example               # Template showing required variables
```

---

## Root-Level Files

### `prisma.config.ts`
**What it does:** Prisma 7 requires the database connection URL to be in a dedicated config file rather than in `schema.prisma`. This file uses `defineConfig` from `prisma/config` to declare the schema path, migrations directory, and database URL. It replaces the old `url = env("DATABASE_URL")` line in the datasource block.

```ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env["DATABASE_URL"] },
});
```

- **`dotenv/config`** loads the `.env` file before Prisma reads the config.
- All Prisma CLI commands (`migrate`, `generate`, `studio`) automatically pick up this file.

---

### `docker-compose.yml`
**What it does:** Spins up a local PostgreSQL 16 container for development. This is independent of the Supabase-hosted instance, allowing offline development.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: pipeline_postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: pipeline_db
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
```

---

### `Dockerfile`
**What it does:** Multi-stage build. Stage 1 (`builder`) installs all dependencies, generates the Prisma client, and compiles TypeScript. Stage 2 (`runner`) copies only the compiled output and production dependencies for a lean runtime image.

---

### `.env` / `.env.example`
**What they do:** `.env` is your local environment file (not committed to git). `.env.example` is the template. Required variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Signing secret for access tokens |
| `JWT_REFRESH_SECRET` | Signing secret for refresh tokens |
| `JWT_ACCESS_EXPIRY` | Access token lifetime (e.g. `15m`) |
| `JWT_REFRESH_EXPIRY` | Refresh token lifetime (e.g. `7d`) |
| `PORT` | HTTP server port (default `3000`) |
| `CORS_ORIGIN` | Allowed frontend origin (e.g. `http://localhost:5173`) |

---

## Prisma & Database Layer

### `prisma/schema.prisma`
**What it does:** Defines the entire database schema. Prisma reads this file to generate the client and create migrations.

**Prisma 7 header format:**
```prisma
generator client {
  provider            = "prisma-client"   # Prisma 7 provider (not prisma-client-js)
  output              = "../generated/prisma"
  moduleFormat        = "cjs"
  importFileExtension = "ts"
}

datasource db {
  provider = "postgresql"
  # No url here — moved to prisma.config.ts
}
```

**Models:**

| Model | Purpose |
|---|---|
| `User` | System users with role-based access |
| `Pipeline` | Physical oil/gas pipelines |
| `Segment` | Sections of a pipeline between two sensors |
| `Sensor` | Individual field sensors (can be unassigned) |
| `SensorReading` | Time-series telemetry from sensors |
| `LeakIncident` | Detected leak events (created internally by detection engine) |
| `AlertLog` | Dispatch log for notifications sent about an incident |

**Enums:**

| Enum | Values |
|---|---|
| `UserRole` | `ADMIN`, `OPERATOR`, `FIELD_ENGINEER` |
| `SegmentStatus` | `NORMAL`, `WARNING`, `LEAK` |
| `IncidentStatus` | `OPEN`, `ACKNOWLEDGED`, `RESOLVED` |
| `AlertChannel` | `EMAIL`, `SMS`, `PUSH` |
| `AlertStatus` | `PENDING`, `SENT`, `FAILED` |

**Key design decisions:**
- All IDs use `cuid()` (compact, collision-resistant, URL-safe).
- `SensorReading` has a composite index on `(sensorId, recordedAt)` for efficient time-series queries.
- `Sensor.segmentId` is nullable — sensors can exist in inventory before assignment.
- `Segment` has `startSensorId` and `endSensorId` foreign keys creating a bi-directional relationship.

---

### `src/prisma/prisma.service.ts`
**What it does:** Wraps `PrismaClient` in a NestJS injectable service. Uses `@prisma/adapter-pg` (Prisma 7 driver adapter) for the actual PostgreSQL connection. Connects on module init and disconnects on module destroy.

```ts
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    super({ adapter });
  }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

> **Why adapter-pg?** Prisma 7 moved away from the binary query engine and now uses driver adapters. `PrismaPg` provides a native Node.js PostgreSQL connection, making it faster and removing the need to download engine binaries.

---

### `src/prisma/prisma.module.ts`
**What it does:** Declares `PrismaService` as a `@Global()` module so every feature module can inject `PrismaService` without explicitly importing `PrismaModule`.

---

## Config Layer

### `src/config/env.validation.ts`
**What it does:** Defines a Zod schema for all required environment variables. Called by `AppModule`'s `ConfigModule` at startup. If any variable is missing or invalid, the app **refuses to start** and logs a clear error — fail-fast pattern.

```ts
export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  // ...
});

export function validateEnv(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error('Config validation error. Check environment variables.');
  }
  return result.data;
}
```

---

### `src/config/configuration.ts`
**What it does:** A NestJS configuration factory that maps raw `process.env` values into a typed, nested object accessible via `ConfigService.get()`.

```ts
export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
});
```

---

## Common Layer (Shared Infrastructure)

These files live in `src/common/` and are used across all feature modules.

### `src/common/decorators/current-user.decorator.ts`
**What it does:** A custom parameter decorator `@CurrentUser()`. After JWT authentication, Passport attaches the validated user to `request.user`. This decorator extracts it cleanly in controller methods.

```ts
@Get('me')
async getMe(@CurrentUser() user: User) {
  return user;  // returns the validated user object from JWT payload
}
```

---

### `src/common/decorators/roles.decorator.ts`
**What it does:** Sets metadata on a route handler using `@Roles(UserRole.ADMIN)`. The `RolesGuard` reads this metadata at runtime to decide if the current user has permission.

```ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

---

### `src/common/decorators/public.decorator.ts`
**What it does:** Marks a route as public with `@Public()`. The `JwtAuthGuard` checks for this metadata and skips JWT validation if present. Without this, the global JWT guard would block all unauthenticated access — including login and signup.

```ts
// Usage:
@Public()
@Post('login')
async login(@Body() dto: LoginDto) { ... }
```

---

### `src/common/guards/jwt-auth.guard.ts`
**What it does:** Extends Passport's `AuthGuard('jwt')`. Applied globally via `APP_GUARD` in `AppModule`. Before delegating to Passport, checks if the route has the `@Public()` metadata — if yes, lets the request through without authentication.

**Flow:**
1. Request arrives
2. Guard checks `isPublic` metadata → if true, allow through
3. Otherwise, extract Bearer token from `Authorization` header
4. Validate token signature and expiry using `JWT_ACCESS_SECRET`
5. Call `JwtStrategy.validate()` to look up the user in the database
6. Attach `user` to `request.user`

---

### `src/common/guards/roles.guard.ts`
**What it does:** Checks that the authenticated user's role matches what `@Roles()` requires. Applied globally via `APP_GUARD` after `JwtAuthGuard`. If no `@Roles()` metadata is set, all authenticated users are allowed.

```ts
// Route only accessible by ADMINs:
@Roles(UserRole.ADMIN)
@Post()
async createPipeline(@Body() dto: CreatePipelineDto) { ... }
```

---

### `src/common/filters/http-exception.filter.ts`
**What it does:** A global exception filter applied via `APP_FILTER`. Catches **all** exceptions and returns a uniform JSON error shape:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2026-08-07T18:00:00.000Z",
  "path": "/auth/signup"
}
```

Also logs errors using NestJS `Logger` so they appear in the console with the route context.

---

### `src/common/interceptors/logging.interceptor.ts`
**What it does:** A global interceptor applied via `APP_INTERCEPTOR`. Logs each HTTP request after it completes, including method, URL, status code, and response time in milliseconds.

```
[HTTP] GET /health 200 - 12ms
[HTTP] POST /auth/login 200 - 84ms
```

---

## Domain Modules

Each module follows the same pattern: `module.ts` (wiring) → `service.ts` (business logic + Prisma queries) → `controller.ts` (HTTP handlers) → `dto/` (input validation shapes).

---

### Auth Module

**Location:** `src/modules/auth/`

#### `auth.service.ts`
The core authentication logic:

| Method | What it does |
|---|---|
| `signup()` | Checks email uniqueness, hashes password with bcrypt, creates User with role `OPERATOR` by default (only ADMINs can create ADMIN/FIELD_ENGINEER accounts) |
| `login()` | Validates credentials, generates access + refresh token pair, stores hashed refresh token in DB |
| `refreshTokens()` | Verifies the refresh token signature, checks hashed value matches DB, issues a new token pair |
| `generateTokens()` | Private helper — signs access token (short-lived) and refresh token (long-lived) with separate secrets |
| `updateRefreshTokenHash()` | Bcrypt-hashes the new refresh token and persists it to the User record |
| `sanitizeUser()` | Strips `passwordHash` and `refreshTokenHash` from the user object before returning to client |

> **Security note:** Refresh tokens are stored **hashed** in the database. If the database is leaked, raw refresh tokens are not exposed.

#### `auth.controller.ts`
Exposes four endpoints:

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /auth/signup` | Public | Create a new account |
| `POST /auth/login` | Public | Get access + refresh tokens |
| `POST /auth/refresh` | Public | Exchange refresh token for new access token |
| `GET /auth/me` | JWT required | Return current user profile |

#### `strategies/jwt.strategy.ts`
**What it does:** Passport strategy for validating access tokens. Extracts Bearer token from `Authorization` header, verifies with `JWT_ACCESS_SECRET`, then looks up the user by `payload.sub` (user ID) in the database. The returned user object is attached to `request.user`.

#### `strategies/jwt-refresh.strategy.ts`
**What it does:** Passport strategy for refresh token validation. Extracts token from request body (`refreshToken` field), verifies signature with `JWT_REFRESH_SECRET`, and passes the raw token through for the service to bcrypt-compare against the stored hash.

#### `dto/signup.dto.ts`
Validates: `email` (valid email format), `password` (min 8 chars), `name` (string), `role` (optional enum).

#### `dto/login.dto.ts`
Validates: `email` and `password`.

#### `dto/refresh-token.dto.ts`
Validates: `refreshToken` (non-empty string).

---

### Users Module

**Location:** `src/modules/users/`

**Purpose:** User administration — list, view, update role, delete users. Write operations are restricted to `ADMIN` role.

#### `users.service.ts`

| Method | Purpose |
|---|---|
| `findAll()` | Returns all users (passwords excluded via Prisma `select`) |
| `findOne(id)` | Returns single user or throws 404 |
| `update(id, dto)` | Updates name and/or role |
| `remove(id)` | Deletes user |

#### `dto/update-user.dto.ts`
Validates: `name` (optional string), `role` (optional enum).

---

### Pipelines Module

**Location:** `src/modules/pipelines/`

**Purpose:** Manage physical pipeline records. A pipeline has many segments.

#### `pipelines.service.ts`

| Method | Purpose |
|---|---|
| `create()` | Create a new pipeline |
| `findAll()` | List pipelines with nested segments and sensors |
| `findOne(id)` | Get pipeline with full segment/sensor/incident data |
| `update(id, dto)` | Update name or description |
| `remove(id)` | Delete pipeline (cascades to segments) |

**Role restrictions:** `create`, `update`, `remove` require `ADMIN` role.

#### DTOs
- `create-pipeline.dto.ts`: `name` (required), `description` (optional)
- `update-pipeline.dto.ts`: Partial of `CreatePipelineDto`

---

### Segments Module

**Location:** `src/modules/segments/`

**Purpose:** Manage pipeline segments — sections of a pipeline between a start and end sensor. A segment has a `status` enum tracking its leak detection state.

#### `segments.service.ts`

| Method | Purpose |
|---|---|
| `create()` | Creates segment; validates parent pipeline exists |
| `findAll()` | Lists segments with pipeline and sensor details |
| `findOne(id)` | Returns full segment including incidents |
| `update(id, dto)` | Update sensor assignments or status |
| `remove(id)` | Delete segment |

**Role restrictions:** `create`, `update`, `remove` require `ADMIN` role.

#### `dto/create-segment.dto.ts`
Validates: `pipelineId` (required), `startSensorId` (optional), `endSensorId` (optional), `status` (optional `SegmentStatus` enum).

---

### Sensors Module

**Location:** `src/modules/sensors/`

**Purpose:** Manage field sensors. Sensors can exist in inventory without being assigned to a segment (`segmentId` is nullable).

#### `sensors.service.ts`

| Method | Purpose |
|---|---|
| `create()` | Creates sensor; checks serial number uniqueness |
| `findAll()` | Lists sensors with their assigned segment |
| `findOne(id)` | Returns sensor with segment and last 20 readings |
| `update(id, dto)` | Update sensor configuration or active state |
| `remove(id)` | Delete sensor |

**Role restrictions:** `create`, `update`, `remove` require `ADMIN` role.

#### `dto/create-sensor.dto.ts`
Validates: `serialNumber` (string), `latitude` (number), `longitude` (number), `segmentId` (optional), `isActive` (optional boolean, defaults `true`).

---

### Readings Module

**Location:** `src/modules/readings/`

**Purpose:** Ingest time-series sensor telemetry. This is the highest-volume endpoint — field devices and simulators POST readings here continuously.

#### `readings.service.ts`

| Method | Purpose |
|---|---|
| `create()` | Validates sensor exists, stores the reading |
| `findBySensor(sensorId?, limit?)` | Returns recent readings, optionally filtered by sensor |

> **Note:** No detection logic here yet. Storage only. The detection engine (future module) will query this data separately.

#### `dto/create-reading.dto.ts`
Validates: `sensorId` (required), `pressure` (number), `flowRate` (optional number), `temperature` (optional number), `recordedAt` (optional ISO date string — defaults to `now()`).

**Endpoints:**

| Endpoint | Purpose |
|---|---|
| `POST /readings` | Ingest a reading from a field sensor or simulator |
| `GET /readings?sensorId=&limit=` | Retrieve recent readings |

---

### Incidents Module

**Location:** `src/modules/incidents/`

**Purpose:** Read-only access to leak incidents. Incidents are **created internally** by the detection engine (future module) — not by client API calls. This module only exposes GET endpoints so the dashboard can display active and historical incidents.

#### `incidents.service.ts`

| Method | Purpose |
|---|---|
| `findAll()` | Lists all incidents, ordered by detection time, with segment/pipeline/alert data |
| `findOne(id)` | Returns full incident details including alert dispatch log |

**Endpoints:**

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /incidents` | JWT required | List all incidents |
| `GET /incidents/:id` | JWT required | Get incident detail |

---

### Health Module

**Location:** `src/modules/health/`

**Purpose:** A simple status endpoint that verifies the server is up and the database connection is alive. No authentication required. Used for Docker health checks, uptime monitoring, and confirming a fresh deployment works.

#### `health.controller.ts`
Runs `SELECT 1` via PrismaService. Returns:

```json
{ "status": "ok", "db": "connected", "timestamp": "2026-08-07T18:00:00.000Z" }
```

On failure:
```json
HTTP 503: { "status": "error", "db": "disconnected" }
```

---

## App Bootstrap

### `src/app.module.ts`
**What it does:** The root NestJS module that wires the entire application together.

Key responsibilities:
1. **Loads `ConfigModule`** globally with the Zod validator — every module can inject `ConfigService`.
2. **Imports `PrismaModule`** globally — every module gets `PrismaService` without explicit imports.
3. **Registers all feature modules** — Auth, Users, Pipelines, Segments, Sensors, Readings, Incidents, Health.
4. **Registers global providers:**
   - `APP_GUARD → JwtAuthGuard` — all routes protected by JWT unless `@Public()`
   - `APP_GUARD → RolesGuard` — routes with `@Roles()` enforce role requirements
   - `APP_FILTER → HttpExceptionFilter` — uniform error responses
   - `APP_INTERCEPTOR → LoggingInterceptor` — HTTP request logging

---

### `src/main.ts`
**What it does:** The entry point. Bootstraps the NestJS application with:

1. **Global `ValidationPipe`** — validates all incoming DTOs:
   - `whitelist: true` — strips unknown properties silently
   - `forbidNonWhitelisted: true` — rejects requests with unknown properties
   - `transform: true` — auto-transforms query params to their declared types (e.g. `"50"` → `50`)
2. **CORS** — enabled for the origin declared in `CORS_ORIGIN` env var.
3. **Swagger** at `/docs` — auto-generates OpenAPI spec from decorators and DTOs.
4. **HTTP listener** on the port from config.

---

## How Everything Connects

```
HTTP Request
     │
     ▼
LoggingInterceptor (records incoming)
     │
     ▼
JwtAuthGuard ─── @Public()? ──── Yes ──► Route Handler
     │ No
     ▼
Passport JWT Strategy
  ├── Validate token signature (JWT_ACCESS_SECRET)
  └── Lookup user in DB (PrismaService)
     │
     ▼
RolesGuard ─── @Roles() set? ──── No ──► Route Handler
     │ Yes
     └── Check user.role matches ──── No ──► 403 Forbidden
                                    │ Yes
                                    ▼
                             Route Handler (Controller)
                                    │
                                    ▼
                            Service (Prisma queries)
                                    │
                                    ▼
                          PostgreSQL (via adapter-pg)
                                    │
                                    ▼
                         Response (sanitized JSON)
                                    │
                                    ▼
                        LoggingInterceptor (records response time)
                                    │
                                    ▼
                         HttpExceptionFilter (catches any errors)
```

---

## API Endpoint Reference

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/auth/signup` | Public | Any | Register new user |
| `POST` | `/auth/login` | Public | Any | Login, get tokens |
| `POST` | `/auth/refresh` | Public | Any | Refresh access token |
| `GET` | `/auth/me` | JWT | Any | Get current user |
| `GET` | `/users` | JWT | ADMIN | List all users |
| `GET` | `/users/:id` | JWT | Any | Get user by ID |
| `PATCH` | `/users/:id` | JWT | ADMIN | Update user |
| `DELETE` | `/users/:id` | JWT | ADMIN | Delete user |
| `POST` | `/pipelines` | JWT | ADMIN | Create pipeline |
| `GET` | `/pipelines` | JWT | Any | List pipelines |
| `GET` | `/pipelines/:id` | JWT | Any | Get pipeline |
| `PATCH` | `/pipelines/:id` | JWT | ADMIN | Update pipeline |
| `DELETE` | `/pipelines/:id` | JWT | ADMIN | Delete pipeline |
| `POST` | `/segments` | JWT | ADMIN | Create segment |
| `GET` | `/segments` | JWT | Any | List segments |
| `GET` | `/segments/:id` | JWT | Any | Get segment |
| `PATCH` | `/segments/:id` | JWT | ADMIN | Update segment |
| `DELETE` | `/segments/:id` | JWT | ADMIN | Delete segment |
| `POST` | `/sensors` | JWT | ADMIN | Register sensor |
| `GET` | `/sensors` | JWT | Any | List sensors |
| `GET` | `/sensors/:id` | JWT | Any | Get sensor |
| `PATCH` | `/sensors/:id` | JWT | ADMIN | Update sensor |
| `DELETE` | `/sensors/:id` | JWT | ADMIN | Delete sensor |
| `POST` | `/readings` | JWT | Any | Ingest sensor reading |
| `GET` | `/readings` | JWT | Any | Get readings (filter by `sensorId`) |
| `GET` | `/incidents` | JWT | Any | List leak incidents |
| `GET` | `/incidents/:id` | JWT | Any | Get incident detail |
| `GET` | `/health` | Public | N/A | Health check |
| — | `/docs` | Public | N/A | Swagger UI |

---

## Startup Commands

### 1. Start local PostgreSQL
```bash
docker-compose up -d
```

### 2. Generate Prisma Client
```bash
npx prisma generate
```

### 3. Run database migrations
```bash
npx prisma migrate dev --name init
```

### 4. Start NestJS in watch mode
```bash
npm run start:dev
```

### 5. Verify it's running
```bash
# Health check
curl http://localhost:3000/health

# Browse API docs
http://localhost:3000/docs
```

---

## What Comes Next

The scaffold covers storage and access control. The following modules are planned for subsequent phases:

1. **Detection Engine** — Reads `SensorReading` streams, computes statistical anomalies (pressure drops, flow deviations), automatically creates `LeakIncident` records.
2. **Alert Dispatcher** — When an incident is created, dispatches notifications via Email, SMS, or Push and logs each attempt in `AlertLog`.
3. **WebSocket / SSE Gateway** — Real-time channel so the React dashboard receives live segment status updates without polling.
4. **Simulator** — Development tool that generates synthetic sensor readings to test the detection engine without physical hardware.
