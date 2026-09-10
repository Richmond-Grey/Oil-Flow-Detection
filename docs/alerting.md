# Alerting Module — Architecture & Operational Guide

The **Alerting Module** (`src/modules/alerts/`) handles automated notification delivery across email and web push channels when pipeline leak anomalies or thermal hazards are detected, escalated, or resolved by the system.

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
                │ - 'temperature.anomaly.created'
                ▼
┌────────────────────────────────┐
│         Alerts Module          │
│ (@OnEvent event listener loop) │
└───────┬────────────────┬───────┘
        │                │
        │                ├──────────────────────────────────────────┐
        ▼                ▼                                          ▼
┌────────────────┐ ┌────────────────────────────────┐ ┌────────────────────────────────┐
│   Web Push     │ │     Resend API (HTTP POST)     │ │    PostgreSQL (AlertLog)       │
│  Browser Push  │ │  Dispatches email to all users │ │ Persists status, retryCount,   │
│ (Web-Push RFC) │ │  with per-recipient resilience │ │ and errorMessage for audit     │
└────────────────┘ └────────────────────────────────┘ └────────────────────────────────┘
```

1. **Event Emission:** The Detection Engine emits events (`incident.created`, `incident.upgraded`, `incident.resolved`, and `temperature.anomaly.created`) via NestJS `EventEmitter2`.
2. **Event Consumption:** `AlertsService` listens for these events using `@OnEvent()`.
3. **Dynamic User Recipient Discovery:** Rather than relying on a static, fixed recipient list, the system queries **all registered `User` records** in the database. Every user with an account is notified regardless of role, ensuring complete safety awareness.
4. **Resilient One-at-a-Time Email Dispatch:**
   - The service iterates through every user recipient individually within a `try/catch` block.
   - For incident alerts, a `PENDING` `AlertLog` row is created per user.
   - If sending to one email fails (e.g. invalid syntax, bounce, network drop), it is logged, the `AlertLog` record is marked `FAILED` with the corresponding error message, and execution moves to the next recipient immediately.
   - **One invalid or unresponsive recipient email never blocks or fails notifications to other users.**
5. **Web Push Notification Delivery:**
   - Push notifications are delivered to every registered browser device in the `PushSubscription` table.
   - Each subscription is processed individually in a fail-safe manner.
   - If a push service returns **HTTP 410 Gone** or **HTTP 404 Not Found** (indicating that the user cleared browser storage or revoked push permission), that `PushSubscription` row is **automatically deleted** from the database to prevent futile future attempts.

---

## 2. Event Payload & Notifications

### Incident Created (`incident.created`)
- **Email Subject:** `[ALERT] New Incident Detected on <Pipeline Name>`
- **Web Push:** Title: `Leak Incident: <Pipeline Name>` | Body: `Leak detected on <Pipeline Name> (Segment <Segment ID>) with <Confidence>% confidence`
- **Content:** Segment ID, pipeline name, confidence percentage, detection timestamp, pressure drop percentage, and flow rate mismatch percentage.

### Incident Upgraded (`incident.upgraded`)
- **Email Subject:** `[ESCALATION] Incident Upgraded to LEAK on <Pipeline Name>`
- **Web Push:** Title: `Escalation: <Pipeline Name>` | Body: `Incident on <Pipeline Name> (Segment <Segment ID>) upgraded to confirmed LEAK`
- **Content:** Explicitly states that an existing low-confidence warning has been **escalated** to a confirmed `LEAK` because both telemetry signals now agree.

### Incident Resolved (`incident.resolved`)
- **Email Subject:** `[RESOLVED] Incident Resolved on <Pipeline Name>`
- **Web Push:** Title: `Resolved: <Pipeline Name>` | Body: `Incident on <Pipeline Name> (Segment <Segment ID>) has been resolved`
- **Content:** Notifies users that telemetry parameters have returned below normal thresholds and segment status has returned to `NORMAL`.

### Temperature Anomaly Created (`temperature.anomaly.created`)
- **Email Subject:** `[HEAT HAZARD] High Temperature Anomaly Detected on <Pipeline Name>`
- **Web Push:** Title: `Heat Hazard: <Pipeline Name>` | Body: `High temperature anomaly (<Temperature>°C) on segment <Segment ID>`
- **Content:** Sustained thermal anomaly details, sensor serial number, measured temperature, and API 521 threshold ceiling.

---

## 3. Web Push Architecture & Endpoints

Web push allows real-time desktop and mobile browser notifications even when the app tab is in the background:

### Endpoints
1. **`GET /push/vapid-public-key` (Public, no auth needed)**
   - Returns `{ publicKey: "<VAPID_PUBLIC_KEY>" }`.
   - Used by the frontend client to initialize browser push subscription credentials via `PushManager.subscribe()`.
2. **`POST /push/subscribe` (Authenticated, any role)**
   - Body: `{ endpoint: string, keys: { p256dh: string, auth: string } }`
   - Stores or updates the browser's subscription credentials in the `PushSubscription` table linked to the authenticated user.
   - Prevents duplicate rows if the same endpoint is submitted multiple times.
3. **`DELETE /push/subscribe` (Authenticated, any role)**
   - Removes subscriptions associated with the current user upon logout or notification opt-out.

### End-to-End Push Lifecycle
```
1. Frontend requests VAPID Public Key: GET /push/vapid-public-key
2. Browser ServiceWorker registers with browser push service (PushManager.subscribe)
3. Frontend sends Subscription Object: POST /push/subscribe (persisted in DB)
4. Detection Engine detects leak/anomaly -> AlertsService broadcasts web push
5. If browser uninstalled / subscription expired (HTTP 410): Subscription auto-deleted from DB
```

---

## 4. Querying Alert Logs (`GET /alerts`)

Operators and admins can query alert history and audit delivery failures:

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
ALERT_EMAIL_FROM=alerts@pipeline-detection.local

# Web Push VAPID Keys
# Generate keys with: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=BG...
VAPID_PRIVATE_KEY=eK...
VAPID_SUBJECT=mailto:admin@pipeline-detection.local
```

---

## 6. Schema Changes Confirmation

> **Explicit Confirmation:**
> The **`PushSubscription`** model and its opposite relation field `pushSubscriptions PushSubscription[]` on `User` were added to `prisma/schema.prisma`:
> ```prisma
> model User {
>   // ... existing fields ...
>   pushSubscriptions PushSubscription[]
> }
> 
> model PushSubscription {
>   id        String   @id @default(cuid())
>   userId    String
>   user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
>   endpoint  String   @unique
>   p256dh    String
>   auth      String
>   createdAt DateTime @default(now())
> }
> ```
> No other models (`Pipeline`, `Segment`, `Sensor`, `SensorReading`, `LeakIncident`, `AlertLog`), enums, or fields in `schema.prisma` were modified.


