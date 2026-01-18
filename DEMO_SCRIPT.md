# CouchLoop MCP Demo Script

## Demo Setup
- Use ChatGPT Developer Mode with production URL: `https://couchloop-mcp-production.up.railway.app/mcp`
- Or use Claude Desktop with local MCP server

---

## DEMO 1: Basic Session Management
*Shows: Session creation, pause, resume, and state persistence*

### Scene 1: Starting a Session
```
You: "Let's start a new session to talk about my project planning"

Assistant uses: create_session with context "project planning discussion"

You: "I'm working on a mobile app for mental health support. The main features are journaling, mood tracking, and crisis resources."

Assistant uses: save_checkpoint with key "project_overview"

You: "Actually, I need to step away for a meeting. Can we pause this?"

Assistant uses: pause_session
```

### Scene 2: Resuming Later (New Chat)
```
You: "I was discussing my app project earlier. Can we continue?"

Assistant uses: resume_session
Assistant uses: get_checkpoints to recall context

You: "Where did we leave off?"