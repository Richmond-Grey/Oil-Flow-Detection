# Alerting Module — Architecture & Operational Guide

The **Alerting Module** (`src/modules/alerts/`) handles automated notification delivery when pipeline leak anomalies are detected, escalated, or resolved by the system.

---

## 1. System Integration Flow

```
┌────────────────────────────────┐
│        Detection Engine        │
│   (Background timer cycle)     │
└───────────────┬────────────────┘
                │
                │ Emits EventEmitter2 events:
                │ - 'incident.created'
                │ - 'incident.upgraded'
                │ - 'incident.resolved'
                ▼
┌────────────────────────────────┐
│         Alerts Module          │
│ (@OnEvent event listener loop) │
└───────────────┬────────────────┘
                │
                ├──────────────────────────────────────────┐
                ▼                                          ▼
┌────────────────────────────────┐       ┌────────────────────────────────┐
│     Resend API (HTTP POST)     │       │    PostgreSQL (AlertLog)       │
│  Dispatches email notifications│       │ Persists status, retryCount,   │
│  with exponential backoff      │       │ and errorMessage for audit     │
└────────────────────────────────┘       └────────────────────────────────┘
```

1. **Event Emission:** The Detection Engine emits decoupling events (`incident.created`, `incident.upgraded`, `incident.resolved`) via NestJS `EventEmitter2`.
2. **Event Consumption:** `AlertsService` listens for these events using `@OnEvent()`.
3. **Audit Log Creation:** For each email address specified in `ALERT_RECIPIENTS`, `AlertsService` immediately creates a `PENDING` record in the `AlertLog` database table (`retryCount: 0`).
4. **Email Dispatch:** Sends a formatted, human-readable plain-text email using Resend (`POST https://api.resend.com/emails`).
5. **Retry & Backoff:** If delivery fails, the service retries up to **3 total attempts** with delays of **5s, 15s, and 30s**.
6. **Final Persistence:**
   - **Success:** Status becomes `SENT` with a timestamp recorded in `sentAt`.
   - **Exhausted Failures:** Status becomes `FAILED`, recording the last exception in `errorMessage`.

---

## 2. Event Payload & Email Content

### Incident Created (`incident.created`)
- **Subject:** `[ALERT] New Incident Detected on <Pipeline Name>`
- **Content:** Contains Segment ID, pipeline name, confidence percentage, detection timestamp, pressure drop percentage, and flow rate mismatch percentage.

### Incident Upgraded (`incident.upgraded`)
- **Subject:** `[ESCALATION] Incident Upgraded to LEAK on <Pipeline Name>`
- **Content:** Explicitly states that an existing low-confidence warning has been **escalated** to a confirmed `LEAK` because both telemetry signals now agree.

### Incident Resolved (`incident.resolved`)
- **Subject:** `[RESOLVED] Incident Resolved on <Pipeline Name>`
- **Content:** Notifies operators that telemetry parameters have returned below 50% of threshold limits and segment status has been set back to `NORMAL`.

---

## 3. Resend & Retry Behavior

All email dispatches are wrapped in non-blocking `try/catch` blocks:
- **Resend API Integration:** Native `fetch` HTTP request to `https://api.resend.com/emails` using `RESEND_API_KEY` and `ALERT_EMAIL_FROM`.
- **Fail-Safe Operation:** A failed alert, missing API key, or network issue will **never crash** the NestJS application or interrupt the background Detection Engine.
- **Retry Schedule:**
  - Attempt 1: Immediate
  - Attempt 2: After 5 seconds
  - Attempt 3: After 15 seconds
  - Final State: After 30 seconds backoff, sets status to `FAILED` with `errorMessage`.

---

## 4. Querying Alert Logs (`GET /alerts`)

Operators and admins can query alert history and inspect delivery failures:

- **Endpoint:** `GET /alerts`
- **Access Control:** `ADMIN` and `OPERATOR` roles (`FIELD_ENGINEER` gets `403 Forbidden`).
- **Query Parameters:**
  - `incidentId` (optional): Filter logs by specific `LeakIncident` CUID.
  - `page` (default: 1): Page number for pagination.
  - `limit` (default: 20): Number of items per page.

---

## 5. Environment Configuration

```env
# Resend API Key for dispatching email alerts
RESEND_API_KEY=re_123456789...

# Sender address configured in Resend domain settings
ALERT_EMAIL_FROM=alerts@your-pipeline-domain.com

# Comma-separated list of alert notification recipients
ALERT_RECIPIENTS=operator1@pipeline.com, engineer2@pipeline.com
```

---

## 6. Schema Changes Confirmation

> **Explicit Confirmation:**
> Only the following two fields were added to `AlertLog` in `prisma/schema.prisma`:
> 1. `errorMessage String?` (optional string storing dispatch error details)
> 2. `retryCount Int @default(0)` (integer counting delivery attempts)
>
> No other models, enums, fields, or relationships in `schema.prisma` were modified.
