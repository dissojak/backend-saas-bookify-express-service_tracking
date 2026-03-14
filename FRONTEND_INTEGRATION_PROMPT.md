# Frontend Tracking SDK — Migration Prompt for Frontend Agent

> **Give this entire file to your frontend agent as the task prompt.**

---

## Context

The backend tracking service has been fully redesigned with server-side request fingerprinting.
All device detection, IP extraction, and User-Agent parsing now happens **on the server automatically**.

The frontend SDK must be updated to remove client-side device logic and align with the new API contracts.

---

## What Changed (Breaking Changes)

### 1. Session Start — `POST /api/session/start`

**OLD payload (remove these fields):**
```json
{
  "sessionId": "uuid",
  "userId": "123",
  "browser": "Chrome",
  "os": "macOS",
  "deviceType": "desktop",
  "ipAddress": "203.0.113.1",
  "referrer": "https://google.com",
  "userAgent": "Mozilla/5.0..."
}
```

**NEW payload:**
```json
{
  "sessionId": "uuid",
  "userId": "123",
  "anonymousId": "anon-uuid",
  "entryPage": "/search"
}
```

- Remove: `browser`, `os`, `deviceType`, `ipAddress`, `referrer`, `userAgent`
- Add: `entryPage` (first page the user landed on)
- Server extracts device info, IP, referrer, language from HTTP headers automatically

---

### 2. Event Tracking — `POST /api/track`

**OLD payload (remove these fields):**
```json
{
  "userId": "123",
  "sessionId": "uuid",
  "eventType": "page_view",
  "page": "/search",
  "userAgent": "Mozilla/5.0...",
  "ipAddress": "203.0.113.1",
  "properties": {}
}
```

**NEW payload:**
```json
{
  "userId": "123",
  "anonymousId": "anon-uuid",
  "sessionId": "uuid",
  "eventType": "page_view",
  "page": "/search",
  "properties": {}
}
```

- Remove: `userAgent`, `ipAddress`
- `userId` can be `null` for anonymous users
- `anonymousId` can be `null` for authenticated users

---

### 3. Batch Tracking — `POST /api/track/batch`

**OLD payload:**
```json
{
  "userAgent": "Mozilla/5.0...",
  "ipAddress": "203.0.113.1",
  "events": [...]
}
```

**NEW payload:**
```json
{
  "events": [
    {
      "userId": "123",
      "anonymousId": null,
      "sessionId": "uuid",
      "eventType": "page_view",
      "page": "/search",
      "properties": {}
    }
  ]
}
```

- Remove top-level `userAgent` and `ipAddress` entirely
- Each event still needs: `userId` (or null), `anonymousId` (or null), `sessionId`, `eventType`, `page`, `properties`

---

### 4. NEW Endpoint — Session Heartbeat

```
PATCH /api/session/:sessionId/activity
Headers: x-api-key: <your-api-key>
Body: (empty)
```

Call this every **30–45 seconds** to keep the session alive and update `lastActivityAt`.
This prevents premature session expiry on long browsing sessions.

Response:
```json
{ "success": true, "message": "Activity updated" }
```

---

### 5. Auth Logs — `POST /api/auth-logs`

**OLD payload (remove these fields):**
```json
{
  "action": "login_failed",
  "success": false,
  "email": "user@example.com",
  "browser": "Chrome",
  "os": "macOS",
  "deviceType": "desktop",
  "userAgent": "Mozilla/5.0..."
}
```

**NEW payload:**
```json
{
  "action": "login_failed",
  "success": false,
  "failReason": "invalid_credentials",
  "failStage": "api",
  "email": "user@example.com",
  "userId": null,
  "sessionId": "uuid",
  "metadata": {}
}
```

- Remove: `browser`, `os`, `deviceType`, `userAgent` — server fills these from `req.context`
- The `ipAddress` query param for `GET /api/auth-logs` is now `ipAddress` (was `ip`)

---

## What the Server Now Provides Automatically

You get these fields on **every document** without sending anything:

| Field | Example |
|-------|---------|
| `ipAddress` | `203.0.113.5` (proxy-aware, Cloudflare-aware) |
| `browser` | `Chrome` |
| `browserVersion` | `120.0.0.0` |
| `os` | `macOS` |
| `osVersion` | `13.5` |
| `deviceType` | `mobile` / `desktop` / `tablet` / `bot` |
| `deviceVendor` | `Apple` |
| `deviceModel` | `iPhone` |
| `language` | `en-US` |
| `referrer` | `https://google.com` (from HTTP Referer header) |
| `country` | `US` (GeoIP stub — wire up later) |
| `city` | `New York` (GeoIP stub — wire up later) |

---

## Required Code Changes

### Step 1 — Generate and persist anonymous ID

```javascript
// utils/anonymousId.js
export function getOrCreateAnonymousId() {
  const key = 'bookify_anon_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
```

---

### Step 2 — Updated startSession()

```javascript
async function startSession({ sessionId, userId, entryPage }) {
  const anonymousId = getOrCreateAnonymousId();

  const res = await fetch('/api/session/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.NEXT_PUBLIC_TRACKING_API_KEY,
    },
    body: JSON.stringify({
      sessionId: sessionId ?? undefined,
      userId: userId ?? null,
      anonymousId,
      entryPage: entryPage ?? window.location.pathname,
      // DO NOT send: browser, os, deviceType, ipAddress, referrer, userAgent
    }),
  });

  const data = await res.json();
  return data.data; // { sessionId, ... }
}
```

---

### Step 3 — Updated trackEvent()

```javascript
async function trackEvent({ sessionId, userId, eventType, page, properties = {} }) {
  const anonymousId = getOrCreateAnonymousId();

  await fetch('/api/track', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.NEXT_PUBLIC_TRACKING_API_KEY,
    },
    body: JSON.stringify({
      userId: userId ?? null,
      anonymousId,
      sessionId,
      eventType,
      page: page ?? window.location.pathname,
      properties,
      // DO NOT send: userAgent, ipAddress
    }),
  });
}
```

---

### Step 4 — Updated trackBatch()

```javascript
async function trackBatch({ sessionId, userId, events }) {
  const anonymousId = getOrCreateAnonymousId();

  await fetch('/api/track/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.NEXT_PUBLIC_TRACKING_API_KEY,
    },
    body: JSON.stringify({
      // DO NOT send top-level userAgent or ipAddress
      events: events.map((e) => ({
        userId: userId ?? null,
        anonymousId,
        sessionId,
        eventType: e.eventType,
        page: e.page ?? window.location.pathname,
        properties: e.properties ?? {},
      })),
    }),
  });
}
```

---

### Step 5 — Add heartbeat

```javascript
let heartbeatTimer = null;

function startHeartbeat(sessionId) {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    try {
      await fetch(`/api/session/${sessionId}/activity`, {
        method: 'PATCH',
        headers: { 'x-api-key': process.env.NEXT_PUBLIC_TRACKING_API_KEY },
      });
    } catch {
      // non-fatal
    }
  }, 45_000); // every 45 seconds
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
```

---

### Step 6 — Updated endSession() via sendBeacon

```javascript
function endSession(sessionId) {
  stopHeartbeat();

  // sendBeacon for reliable unload delivery
  const blob = new Blob(
    [JSON.stringify({ apiKey: process.env.NEXT_PUBLIC_TRACKING_API_KEY })],
    { type: 'application/json' }
  );
  navigator.sendBeacon(`/api/session/${sessionId}/end`, blob);
}

// Wire it up
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    endSession(currentSessionId);
  }
});
```

---

### Step 7 — Updated logAuthEvent()

```javascript
async function logAuthEvent({ action, success, failReason, failStage, email, userId, sessionId }) {
  try {
    await fetch('/api/auth-logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.NEXT_PUBLIC_TRACKING_API_KEY,
      },
      body: JSON.stringify({
        action,
        success,
        failReason: failReason ?? null,
        failStage: failStage ?? null,
        email: email ?? null,
        userId: userId ?? null,
        sessionId: sessionId ?? null,
        metadata: {},
        // DO NOT send: browser, os, deviceType, userAgent, ipAddress
      }),
    });
  } catch {
    // auth logging must never throw
  }
}
```

---

## Cleanup Checklist

Remove these from your frontend SDK or tracking utilities:

- [ ] Any `ua-parser-js`, `bowser`, `platform.js`, or similar UA parser
- [ ] `navigator.userAgent` reads for device classification
- [ ] Manual IP detection or proxy handling
- [ ] Device type detection (`/Mobile/i.test(navigator.userAgent)` etc.)
- [ ] `document.referrer` forwarding in body payloads
- [ ] `navigator.language` forwarding in body payloads
- [ ] Any `browser`, `os`, `deviceType` fields in request bodies

---

## Testing Checklist

- [ ] Session starts with only `userId`/`anonymousId`/`entryPage` — no 400 errors
- [ ] Event tracking works without `userAgent` or `ipAddress` in body
- [ ] Batch tracking works without device fields
- [ ] Heartbeat PATCH endpoint responds with `{ success: true }`
- [ ] Auth logs work without `browser`/`os`/`deviceType` in body
- [ ] MongoDB documents have `browser`, `os`, `deviceType` filled (server-injected)
- [ ] `GET /api/auth-logs?ipAddress=x.x.x.x` works (param was renamed from `ip`)
