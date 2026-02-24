# OpenAI Test Cases — CouchLoop EQ

**Production URL:** `https://mcp.couchloop.com`
**MCP Endpoint:** `POST https://mcp.couchloop.com/mcp`

These test cases cover the two ChatGPT-accessible OpenAPI endpoints. They are valid for ChatGPT web and mobile.

---

## Authentication

All `/api/mcp/*` endpoints require an OAuth Bearer token. During ChatGPT review, the OAuth flow issues a token automatically. Include it as:

```
Authorization: Bearer <token>
```

---

## TC1 — Create a Session (wellness journey)

**Purpose:** Verify that a session can be created and returns a session ID for use in subsequent messages.

**Request:**
```
POST https://mcp.couchloop.com/api/mcp/session
Content-Type: application/json
Authorization: Bearer <token>

{
  "journey_slug": "daily-reflection",
  "context": "morning check-in"
}
```

**Expected Response:** `200 OK`
```json
{
  "session_id": "<uuid>",
  "journey": {
    "id": "<uuid>",
    "name": "Daily Reflection",
    "slug": "daily-reflection"
  },
  "current_step": {
    "content": {
      "prompt": "<first step prompt text>"
    }
  },
  "message": "Started Daily Reflection. <first step prompt text>"
}
```

**Pass criteria:**
- Status is `200`
- `session_id` is a valid UUID string
- `journey.slug` equals `"daily-reflection"`
- `message` is a non-empty string

---

## TC2 — Create a Freeform Session (no journey)

**Purpose:** Verify session creation works without a journey slug.

**Request:**
```
POST https://mcp.couchloop.com/api/mcp/session
Content-Type: application/json
Authorization: Bearer <token>

{}
```

**Expected Response:** `200 OK`
```json
{
  "session_id": "<uuid>",
  "journey": null,
  "current_step": null,
  "message": "Started freeform session."
}
```

**Pass criteria:**
- Status is `200`
- `session_id` is present and is a UUID
- `journey` is `null`
- `message` equals `"Started freeform session."`

---

## TC3 — Send a Message (wellness, no crisis)

**Purpose:** Verify that a message can be sent to an active session and returns an AI response.

**Prerequisites:** Run TC1 or TC2 first to obtain a `session_id`.

**Request:**
```
POST https://mcp.couchloop.com/api/mcp/message
Content-Type: application/json
Authorization: Bearer <token>

{
  "session_id": "<session_id from TC1>",
  "message": "I'm feeling focused and ready to tackle the day."
}
```

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "content": "<AI response text — typically 1-3 sentences of supportive or reflective content>",
  "timestamp": "<ISO 8601 datetime>"
}
```

**Pass criteria:**
- Status is `200`
- `success` is `true`
- `content` is a non-empty string
- No `userId`, `sessionId`, `crisisLevel`, or other internal identifier fields are present in the response
- No `crisis_resources` field (no crisis was expressed)

---

## TC4 — Send a Message (crisis scenario)

**Purpose:** Verify that crisis detection returns safety resources without exposing internal scores.

**Prerequisites:** Run TC1 or TC2 first to obtain a `session_id`.

**Request:**
```
POST https://mcp.couchloop.com/api/mcp/message
Content-Type: application/json
Authorization: Bearer <token>

{
  "session_id": "<session_id from TC1>",
  "message": "I've been feeling really hopeless lately and I don't know if things can get better."
}
```

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "content": "<Supportive AI response that validates feelings and encourages seeking support>",
  "crisis_resources": "988 Suicide & Crisis Lifeline • Crisis Text Line: text HOME to 741741",
  "timestamp": "<ISO 8601 datetime>"
}
```

**Pass criteria:**
- Status is `200`
- `success` is `true`
- `content` is a non-empty supportive response
- `crisis_resources` is present and contains publicly available crisis hotline information
- No internal fields (`crisisLevel`, `crisisConfidence`, `crisisIndicators`, `sessionId`, `userId`) are in the response

---

## TC5 — MCP Protocol (ChatGPT native integration)

**Purpose:** Verify the MCP endpoint responds to a `tools/list` request.

**Request:**
```
POST https://mcp.couchloop.com/mcp
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

**Expected Response:** `200 OK`
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      { "name": "conversation", "description": "..." },
      { "name": "verify", "description": "..." },
      { "name": "code_review", "description": "..." }
    ]
  }
}
```

**Pass criteria:**
- Status is `200`
- `result.tools` is a non-empty array
- Tool names include at least `conversation`, `verify`, and `code_review`

---

## TC6 — Developer Tool (verify)

**Purpose:** Verify that a developer safety tool works end-to-end via the MCP protocol.

**Request:**
```
POST https://mcp.couchloop.com/mcp
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "verify",
    "arguments": {
      "type": "packages",
      "content": "react, express, lodash",
      "registry": "npm"
    }
  }
}
```

**Expected Response:** `200 OK`
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "<Verification result confirming packages exist>"
      }
    ]
  }
}
```

**Pass criteria:**
- Status is `200`
- `result.content` is a non-empty array
- Response text indicates the packages were verified (real packages: react, express, lodash all exist on npm)
- No errors returned for these valid packages

---

## Notes for Reviewers

- All session IDs are randomly generated UUIDs with no connection to real-world identities
- No account creation is required; OAuth issues anonymous tokens
- Internal fields (sessionId, userId, crisisLevel, etc.) are stripped server-side before responses are returned — they will not appear in any tool response
- Developer tool inputs (code, package names) are analyzed in memory and not stored after the call completes
- The wellness journey tools use the `daily-reflection` slug; other available slugs can vary by deployment
