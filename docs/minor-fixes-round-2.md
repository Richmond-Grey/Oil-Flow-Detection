# Minor Fixes Round 2 — Summary Documentation

This document summarizes the two independent application-level fixes applied to the pipeline leak detection backend.

> **Explicit Confirmation:** No changes were made to `prisma/schema.prisma`.

---

## 1. Sensor Double-Assignment Check

### Overview
Added application-level validation in `SegmentsService` (`src/modules/segments/segments.service.ts`) during segment creation (`POST /segments`) and update (`PATCH /segments/:id`).

### Behavior
- Before persisting a segment, the service checks whether the provided `startSensorId` or `endSensorId` is already referenced as a `startSensorId` or `endSensorId` on another active segment.
- On updates (`PATCH`), the check excludes the segment being updated itself (`NOT: { id: excludeSegmentId }`).
- If a sensor is already bound to another segment, the request is rejected with **HTTP 409 Conflict**:
  ```json
  {
    "statusCode": 409,
    "message": "Sensor cj... is already assigned as a start or end sensor on Segment cj...",
    "error": "Conflict",
    "timestamp": "2026-08-15T10:48:00.000Z",
    "path": "/segments"
  }
  ```

---

## 2. Manual Incident Acknowledgement Endpoint

### Endpoint Signature
- **Path:** `PATCH /incidents/:id`
- **Roles Allowed:** `ADMIN`, `OPERATOR` (rejection with **HTTP 403 Forbidden** for `FIELD_ENGINEER`).
- **DTO Validation:** `UpdateIncidentDto` (`src/modules/incidents/dto/update-incident.dto.ts`).

### Request Body Shape
```json
{
  "status": "ACKNOWLEDGED",
  "note": "Field technician dispatched to site for physical inspection."
}
```
*Note:* The `@IsEnum([IncidentStatus.ACKNOWLEDGED])` validation constraint ensures that clients cannot attempt to set the status to `RESOLVED`, `OPEN`, or any other value via this endpoint.

### Response Shape (HTTP 200 OK)
```json
{
  "id": "cm71234567890abcdef123456",
  "segmentId": "cm7segment1234567890abcd",
  "confidence": 0.95,
  "status": "ACKNOWLEDGED",
  "detectedAt": "2026-08-15T10:00:00.000Z",
  "resolvedAt": null,
  "createdAt": "2026-08-15T10:00:00.000Z",
  "updatedAt": "2026-08-15T10:48:00.000Z",
  "segment": {
    "id": "cm7segment1234567890abcd",
    "pipelineId": "cm7pipeline1234567890abc",
    "status": "LEAK",
    "pipeline": {
      "id": "cm7pipeline1234567890abc",
      "name": "Trans-Delta Trunk Line"
    }
  },
  "alerts": []
}
```

### Business Logic & Edge Cases
1. **Resolution Sovereignty:** Only the background Detection Engine can resolve incidents (when physical telemetry normalizes). If an operator attempts to acknowledge an incident that is already `RESOLVED`, the endpoint returns **HTTP 400 Bad Request** (`Cannot acknowledge incident <id> because it is already RESOLVED`).
2. **Not Found:** If the incident ID does not exist, returns **HTTP 404 Not Found**.
