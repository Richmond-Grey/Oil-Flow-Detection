# Oil Flow Detection — API Testing Guide

This document covers the complete flow for testing all REST endpoints in the pipeline leak detection backend, from first signup through to ingesting sensor data and reviewing incidents.

**Base URL:** `http://localhost:3000`
**Swagger UI:** `http://localhost:3000/docs`

All endpoints except `POST /auth/signup` and `POST /auth/login` require a valid JWT in the `Authorization` header.

---

## Architecture Overview

```
        ┌────────────────────────┐
        │   REST Client / Curl   │
        └───────────┬────────────┘
                    │  HTTP (Bearer Token)
                    ▼
        ┌────────────────────────┐
        │    NestJS Controllers  │  (JwtAuthGuard + RolesGuard globally)
        └───────────┬────────────┘
                    │
          ┌─────────┼──────────────┐
          ▼         ▼              ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  Auth    │ │  Domain  │ │  Users   │
    │ Service  │ │ Services │ │ Service  │
    └─────┬────┘ └────┬─────┘ └────┬─────┘
          └───────────┴────────────┘
                       │
                ┌──────▼──────┐
                │  PrismaDB   │
                │ (PostgreSQL)│
                └─────────────┘
```

### Auth Strategy
- JWT-based (HS256 via `@nestjs/jwt`)
- Stateless — no Redis/session store
- **Access token** is short-lived (`15m`)
- **Refresh token** is long-lived (`7d`), hashed and stored in DB
- Global `JwtAuthGuard` blocks all routes unless decorated with `@Public()`
- `RolesGuard` restricts write/admin routes to specific `UserRole` values

---

## User Roles

| Role | Description |
|---|---|
| `ADMIN` | Full access — create/update/delete everything |
| `OPERATOR` | Read/ingest — can read all data and submit sensor readings |
| `FIELD_ENGINEER` | Read-only field technician access |

> **Note:** Only `ADMIN` users can create other `ADMIN` users. A normal signup always defaults to `OPERATOR`.

---

## Step 1 — Register a New User

**Public endpoint — no token required.**

```
POST http://localhost:3000/auth/signup
Content-Type: application/json
```

```json
{
  "email": "operator@pipeline.com",
  "password": "SecurePassword123!",
  "name": "Jane Doe"
}
```

**Optional — create an admin (only works if no `currentUser` or if caller is already an admin):**

```json
{
  "email": "admin@pipeline.com",
  "password": "AdminSecret456!",
  "name": "System Admin",
  "role": "ADMIN"
}
```

**Expected Response (201 Created):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "cm...",
    "email": "operator@pipeline.com",
    "name": "Jane Doe",
    "role": "OPERATOR",
    "createdAt": "2026-08-08T..."
  }
}
```

**Error cases:**
- `400` — Validation failure (e.g. password under 8 chars, bad email format)
- `409` — Email already registered

---

## Step 2 — Log In

**Public endpoint — no token required.**

```
POST http://localhost:3000/auth/login
Content-Type: application/json
```

```json
{
  "email": "operator@pipeline.com",
  "password": "SecurePassword123!"
}
```

**Expected Response (200 OK):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "cm...",
    "email": "operator@pipeline.com",
    "name": "Jane Doe",
    "role": "OPERATOR"
  }
}
```

**Error cases:**
- `401` — Wrong email or password

> Save both tokens. You'll use `accessToken` in the `Authorization` header for all subsequent requests, and `refreshToken` to rotate credentials when the access token expires.

---

## Step 3 — Using Protected Endpoints

For every request below, attach the access token:

```
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

---

## Step 4 — Get Your Own Profile

```
GET http://localhost:3000/auth/me
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

**Expected Response (200 OK):**
```json
{
  "id": "cm...",
  "email": "operator@pipeline.com",
  "name": "Jane Doe",
  "role": "OPERATOR",
  "createdAt": "2026-08-08T..."
}
```

---

## Step 5 — Refresh Access Token

Call this when the `accessToken` expires (after 15 minutes). The refresh token stays valid for 7 days.

```
POST http://localhost:3000/auth/refresh
Content-Type: application/json
```

```json
{
  "refreshToken": "YOUR_REFRESH_TOKEN_HERE"
}
```

**Expected Response (200 OK):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { ... }
}
```

**Error cases:**
- `401` — Refresh token is invalid, expired, or already rotated

---

## Step 6 — Users (Admin Only for Write Operations)

### List All Users
```
GET http://localhost:3000/users
Authorization: Bearer ADMIN_ACCESS_TOKEN
```

> Requires `ADMIN` role. Returns `403 Forbidden` for `OPERATOR` or `FIELD_ENGINEER`.

### Get User by ID
```
GET http://localhost:3000/users/:id
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

### Update User
```
PATCH http://localhost:3000/users/:id
Authorization: Bearer ADMIN_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "name": "Updated Name",
  "role": "FIELD_ENGINEER"
}
```

### Delete User
```
DELETE http://localhost:3000/users/:id
Authorization: Bearer ADMIN_ACCESS_TOKEN
```

---

## Step 7 — Pipelines

### Create a Pipeline (Admin only)
```
POST http://localhost:3000/pipelines
Authorization: Bearer ADMIN_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "name": "Trans-Delta Pipeline Alpha",
  "description": "Main crude transfer pipeline between Station A and Station B"
}
```

**Expected Response (201 Created):**
```json
{
  "id": "cm...",
  "name": "Trans-Delta Pipeline Alpha",
  "description": "Main crude transfer pipeline between Station A and Station B",
  "createdAt": "2026-08-08T...",
  "updatedAt": "2026-08-08T..."
}
```

> **Save the `id`** — you'll need it to create segments.

### List All Pipelines
```
GET http://localhost:3000/pipelines
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

### Get Pipeline by ID
```
GET http://localhost:3000/pipelines/:id
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

### Update Pipeline (Admin only)
```
PATCH http://localhost:3000/pipelines/:id
Authorization: Bearer ADMIN_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "description": "Updated description"
}
```

### Delete Pipeline (Admin only)
```
DELETE http://localhost:3000/pipelines/:id
Authorization: Bearer ADMIN_ACCESS_TOKEN
```

---

## Step 8 — Sensors

### Register a Sensor (Admin only)

Field sensors must be registered before they can report readings.

```
POST http://localhost:3000/sensors
Authorization: Bearer ADMIN_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "serialNumber": "SNS-DELTA-101",
  "latitude": 4.8156,
  "longitude": 7.0498,
  "isActive": true
}
```

**With optional segment assignment:**
```json
{
  "serialNumber": "SNS-DELTA-102",
  "latitude": 4.8200,
  "longitude": 7.0550,
  "segmentId": "cm...",
  "isActive": true
}
```

**Expected Response (201 Created):**
```json
{
  "id": "cm...",
  "serialNumber": "SNS-DELTA-101",
  "latitude": 4.8156,
  "longitude": 7.0498,
  "segmentId": null,
  "isActive": true,
  "installedAt": "2026-08-08T...",
  "createdAt": "2026-08-08T..."
}
```

**Error cases:**
- `409` — Serial number already exists

> **Save the sensor `id`** — you'll need it to submit readings.

### List All Sensors
```
GET http://localhost:3000/sensors
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

### Get Sensor by ID
```
GET http://localhost:3000/sensors/:id
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

### Update Sensor (Admin only)
```
PATCH http://localhost:3000/sensors/:id
Authorization: Bearer ADMIN_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "isActive": false,
  "segmentId": "cm..."
}
```

### Delete Sensor (Admin only)
```
DELETE http://localhost:3000/sensors/:id
Authorization: Bearer ADMIN_ACCESS_TOKEN
```

---

## Step 9 — Segments

Segments are sections of a pipeline bounded by two sensors. They track leak status.

### Create a Segment (Admin only)
```
POST http://localhost:3000/segments
Authorization: Bearer ADMIN_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "pipelineId": "cm...",
  "startSensorId": "cm...",
  "endSensorId": "cm...",
  "status": "NORMAL"
}
```

**Minimal (sensor IDs optional):**
```json
{
  "pipelineId": "cm..."
}
```

**Status values:** `NORMAL` | `WARNING` | `LEAK`

**Expected Response (201 Created):**
```json
{
  "id": "cm...",
  "pipelineId": "cm...",
  "startSensorId": "cm...",
  "endSensorId": "cm...",
  "status": "NORMAL",
  "createdAt": "2026-08-08T..."
}
```

### List All Segments
```
GET http://localhost:3000/segments
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

### Get Segment by ID
```
GET http://localhost:3000/segments/:id
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

### Update Segment (Admin only)
```
PATCH http://localhost:3000/segments/:id
Authorization: Bearer ADMIN_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "status": "WARNING"
}
```

### Delete Segment (Admin only)
```
DELETE http://localhost:3000/segments/:id
Authorization: Bearer ADMIN_ACCESS_TOKEN
```

---

## Step 10 — Ingest Sensor Readings

This is the core data-ingestion endpoint. Field sensors (or simulated ones) POST here to record pressure, flow rate, and temperature.

```
POST http://localhost:3000/readings
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
Content-Type: application/json
```

```json
{
  "sensorId": "cm...",
  "pressure": 45.2,
  "flowRate": 120.5,
  "temperature": 28.4
}
```

**With explicit timestamp:**
```json
{
  "sensorId": "cm...",
  "pressure": 38.1,
  "flowRate": 95.0,
  "temperature": 30.2,
  "recordedAt": "2026-08-08T06:00:00.000Z"
}
```

**Minimal (only pressure is required):**
```json
{
  "sensorId": "cm...",
  "pressure": 42.0
}
```

**Expected Response (201 Created):**
```json
{
  "id": "cm...",
  "sensorId": "cm...",
  "pressure": 45.2,
  "flowRate": 120.5,
  "temperature": 28.4,
  "recordedAt": "2026-08-08T...",
  "createdAt": "2026-08-08T..."
}
```

**Error cases:**
- `404` — Sensor ID does not exist

### Query Recent Readings
```
GET http://localhost:3000/readings
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

**Filter by sensor (last 50 by default):**
```
GET http://localhost:3000/readings?sensorId=cm...
```

**Custom limit:**
```
GET http://localhost:3000/readings?sensorId=cm...&limit=10
```

---

## Step 11 — Leak Incidents

Incidents are created by the system when the anomaly detection engine flags a segment. These endpoints let you read and manage them.

### List All Incidents
```
GET http://localhost:3000/incidents
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

**Expected Response (200 OK):**
```json
[
  {
    "id": "cm...",
    "segmentId": "cm...",
    "confidence": 0.92,
    "status": "OPEN",
    "detectedAt": "2026-08-08T...",
    "resolvedAt": null,
    "alerts": []
  }
]
```

**Incident status values:** `OPEN` | `ACKNOWLEDGED` | `RESOLVED`

### Get Incident by ID
```
GET http://localhost:3000/incidents/:id
Authorization: Bearer YOUR_ACCESS_TOKEN_HERE
```

---

## Step 12 — Health Check

Verify the API is running.

```
GET http://localhost:3000/health
```

> No auth required — useful for Docker health checks and uptime monitoring.

**Expected Response (200 OK):**
```json
{
  "status": "ok",
  "timestamp": "2026-08-08T..."
}
```

---

## Full Test Flow (Copy-Paste Order)

```
1.  POST   /auth/signup          → get accessToken + refreshToken
2.  POST   /auth/login           → re-login if needed
3.  GET    /auth/me              → confirm identity
4.  POST   /pipelines            → create pipeline → save pipeline.id
5.  POST   /sensors              → create sensor A → save sensor.id
6.  POST   /sensors              → create sensor B → save sensor.id
7.  POST   /segments             → create segment (pipelineId + sensorIds) → save segment.id
8.  POST   /readings             → ingest reading from sensor A
9.  POST   /readings             → ingest reading from sensor B
10. GET    /readings?sensorId=…  → confirm readings stored
11. GET    /pipelines/:id        → confirm pipeline with segments
12. GET    /incidents            → check for any detected anomalies
13. POST   /auth/refresh         → rotate tokens when access token expires
```

---

## Error Reference

| Code | Meaning |
|------|---------|
| `400` | Validation error — check request body fields |
| `401` | Missing, expired, or invalid JWT |
| `403` | Valid JWT but insufficient role (`ADMIN` required) |
| `404` | Resource not found |
| `409` | Conflict — duplicate email or serial number |

---

## Tips

- **Swagger** at `http://localhost:3000/docs` lets you test all endpoints interactively with auto-generated forms. Click **Authorize** (top right) and paste your `accessToken` to unlock protected routes.
- Readings are indexed by `(sensorId, recordedAt)` — always provide realistic `recordedAt` values when simulating historical data.
- Deleting a pipeline **cascades** — segments and their incidents are removed automatically.
- Deleting a sensor sets `segmentId` to `null` on related segments (SetNull cascade).
