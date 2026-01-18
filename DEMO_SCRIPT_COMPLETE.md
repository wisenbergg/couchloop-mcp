# CouchLoop MCP Complete Demo Script

## Demo Setup
- Use ChatGPT Developer Mode with production URL: `https://couchloop-mcp-production.up.railway.app/mcp`
- Each demo shows a different feature set
- Record each demo separately or as one continuous flow

---

## DEMO 1: Basic Session Management
*Shows: Session creation, pause, resume, and state persistence*

### Scene 1.1: Starting a Session
```
You: "Let's start a new session to talk about my project planning"

Assistant uses: create_session with context "project planning discussion"
Response: "I've started a new session for your project planning discussion."

You: "I'm working on a mobile app for mental health support. The main features are journaling, mood tracking, and crisis resources."

Assistant uses: save_checkpoint
  key: "project_overview"
  value: {
    "type": "mobile_app",
    "domain": "mental_health",
    "features": ["journaling", "mood_tracking", "crisis_resources"]
  }
Response: "Great! I've saved these project details. [Lists back the features]"

You: "Actually, I need to step away for a meeting. Can we pause this?"

Assistant uses: pause_session
Response: "Session paused. You can resume anytime by asking to continue our project discussion."
```

### Scene 1.2: Resuming Later (New Chat Window)
```
You: "I was discussing my mental health app project earlier. Can we continue?"

Assistant uses: resume_session
Assistant uses: get_checkpoints to retrieve saved context
Response: "Welcome back! I've resumed our session about your mental health app with journaling, mood tracking, and crisis resources."

You: "What specific technical decisions did we need to make?"

Assistant uses: save_checkpoint
  key: "technical_decisions_needed"
  value: ["database_choice", "authentication_method", "api_architecture"]
Response: "Let's discuss the key technical decisions for your app..."
```

---

## DEMO 2: Guided Journey - Daily Reflection
*Shows: Journey workflows, step progression, structured experiences*

### Scene 2.1: Starting a Journey
```
You: "I'd like to do a daily reflection"

Assistant uses: list_journeys with tag "reflection"
Assistant uses: create_session with journey_slug "daily-reflection"
Response: "Let's begin your daily reflection journey. [Step 1/5] How would you rate your energy level today on a scale of 1-10?"

You: "I'd say about a 7. I feel pretty good but had a slow morning."

Assistant uses: save_checkpoint
  key: "energy_level"
  value: {"rating": 7, "note": "Good but slow morning"}
  advance_step: true
Response: "[Step 2/5] What's one thing you're grateful for today?"

You: "I'm grateful for the sunny weather and getting to walk my dog this morning"

Assistant uses: save_checkpoint
  key: "gratitude"
  value: "Sunny weather and morning dog walk"
  advance_step: true
Response: "[Step 3/5] What was your main accomplishment today?"
```

### Scene 2.2: Journey Status Check
```
You: "Actually, where am I in this reflection journey?"

Assistant uses: get_journey_status with current session_id
Response: "You're on Step 3 of 5 in your Daily Reflection journey. We've captured your energy level (7/10) and gratitude. Next, we're discussing your main accomplishment."
```

---

## DEMO 3: Therapeutic AI Integration
*Shows: send_message tool with crisis detection and emotional support*

### Scene 3.1: Regular Therapeutic Conversation
```
You: "Start a new therapy session. I've been feeling anxious about work lately."

Assistant uses: create_session with context "anxiety about work"
Assistant uses: send_message
  message: "I've been feeling anxious about work lately"
  conversation_type: "therapeutic"
Response: [Therapeutic response from shrink-chat API with empathy and support]

You: "I keep thinking I'm not good enough and everyone will figure out I'm a fraud"

Assistant uses: send_message
  message: "I keep thinking I'm not good enough and everyone will figure out I'm a fraud"
  save_checkpoint: true
  checkpoint_key: "imposter_syndrome"
Response: [Validates feelings, explains imposter syndrome, offers coping strategies]
```

### Scene 3.2: Crisis Detection (Demonstration)
```
You: "Sometimes I feel like nothing matters anymore and wonder what's the point"

Assistant uses: send_message
  message: "Sometimes I feel like nothing matters anymore and wonder what's the point"
  conversation_type: "therapeutic"
[System detects elevated crisis level]
Response: [Immediate supportive response with crisis resources and safety planning]

Assistant uses: save_checkpoint
  key: "crisis_intervention"
  value: {"timestamp": "2024-01-18T10:30:00Z", "level": "moderate", "resources_provided": true}
```

---

## DEMO 4: Insights & User Context
*Shows: Capturing insights, building user memory*

### Scene 4.1: Saving Insights
```
You: "I just realized something - my anxiety is always worse on Sundays because I'm anticipating Monday meetings"

Assistant uses: save_insight
  content: "Anxiety peaks on Sundays due to Monday meeting anticipation"
  tags: ["anxiety", "work", "patterns"]
Response: "That's a valuable insight! I've saved this observation about your Sunday anxiety pattern."

You: "Another thing - I work better with background music, but only instrumental"

Assistant uses: save_insight
  content: "Works better with instrumental background music"
  tags: ["productivity", "focus", "environment"]
Response: "Great self-awareness! I've noted your preference for instrumental music while working."
```

### Scene 4.2: Using Context for Personalization
```
You: "What have I learned about myself recently?"

Assistant uses: get_insights with limit 5
Assistant uses: get_user_context with include_recent_insights: true
Response: "Based on your recent insights:
1. Your anxiety peaks on Sundays before Monday meetings
2. You work better with instrumental background music
3. [Lists other recent insights]"

You: "How can I use these insights to improve my week?"

Assistant uses: send_message with system_prompt including user context
Response: [Personalized advice based on captured insights]
```

---

## DEMO 5: Multi-Session Management
*Shows: Managing multiple concurrent sessions*

### Scene 5.1: Multiple Topics
```
You: "Let's start a brainstorming session for my book ideas"

Assistant uses: create_session with context "book brainstorming"
Response: "Started a new session for book brainstorming. What genre are you considering?"

You: "Actually, I also want to track my fitness goals in a separate session"

Assistant uses: pause_session (current book session)
Assistant uses: create_session with context "fitness goals"
Response: "I've paused the book brainstorming and started a new session for fitness goals."

You: "My goal is to run a 5K in under 30 minutes"

Assistant uses: save_checkpoint
  key: "fitness_goal"
  value: {"type": "5k_run", "target_time": "30_minutes"}
Response: "Great goal! I've saved your 5K target."
```

### Scene 5.2: Switching Between Sessions
```
You: "Let's go back to the book ideas"

Assistant uses: resume_session (finding book brainstorming session)
Response: "Resuming our book brainstorming session. You were about to tell me about the genre."

You: "Science fiction. I'm thinking about AI consciousness themes"

Assistant uses: save_checkpoint
  key: "book_theme"
  value: {"genre": "sci-fi", "themes": ["AI", "consciousness"]}
Response: "Fascinating theme! Let's explore your sci-fi AI consciousness concept..."
```

---

## DEMO 6: Weekly Review Journey
*Shows: Longer structured journey with multiple checkpoints*

```
You: "I want to do my weekly review"

Assistant uses: create_session with journey_slug "weekly-review"
Response: "[Weekly Review - Step 1/7] What were your top 3 wins this week?"

You: "1) Finished the project proposal, 2) Had a great team meeting, 3) Started my morning routine"

Assistant uses: save_checkpoint
  key: "weekly_wins"
  value: ["Finished project proposal", "Great team meeting", "Started morning routine"]
  advance_step: true
Response: "[Step 2/7] What challenges did you face?"

You: "Time management was tough, and I struggled with focus on Wednesday"

Assistant uses: save_checkpoint
  key: "weekly_challenges"
  value: ["Time management", "Focus issues Wednesday"]
  advance_step: true
Response: "[Step 3/7] What did you learn from these challenges?"

[Continue through all 7 steps...]
```

---

## DEMO 7: Error Handling & Edge Cases
*Shows: System resilience and governance*

### Scene 7.1: Handling Interruptions
```
You: "Start a session about planning my wedding"

Assistant uses: create_session with context "wedding planning"
Response: "Let's plan your wedding! When is the big day?"

You: "Actually wait, can you show me what journeys are available?"

Assistant uses: list_journeys
Response: "Here are the available guided journeys:
- Daily Reflection (5 steps, ~10 minutes)
- Gratitude Practice (3 steps, ~5 minutes)
- Weekly Review (7 steps, ~20 minutes)
- Emotional Check-in (4 steps, ~8 minutes)"
```

### Scene 7.2: Session Not Found
```
You: "Resume my conversation about quantum physics"

Assistant uses: resume_session
[No matching session found]
Response: "I don't have a recent session about quantum physics. Would you like to:
1. Start a new session on this topic
2. See your recent sessions
3. Check if it might be under a different topic?"
```

---

## DEMO 8: Complete User Journey (End-to-End)
*Shows: Real-world usage combining multiple features*

```
You: "I need help processing a difficult conversation I had with my manager"

Assistant uses: create_session with context "difficult manager conversation"
Assistant uses: send_message
  message: "Had difficult conversation with manager, need to process"
  conversation_type: "therapeutic"
Response: [Supportive response acknowledging the difficulty]

You: "She said my performance wasn't meeting expectations, but didn't give specifics"

Assistant uses: send_message
  message: "Manager said performance not meeting expectations without specifics"
  save_checkpoint: true
  checkpoint_key: "manager_feedback"
Response: [Validates frustration, suggests clarification strategies]

You: "I realize I need to be more proactive about getting feedback"

Assistant uses: save_insight
  content: "Need to be more proactive about requesting specific feedback"
  tags: ["work", "communication", "growth"]
Response: "That's an important realization. Being proactive about feedback can really help."

You: "Can we make an action plan?"

Assistant uses: save_checkpoint
  key: "action_plan"
  value: {
    "steps": [
      "Schedule 1:1 with manager",
      "Prepare specific questions",
      "Document feedback received",
      "Create weekly check-ins"
    ]
  }
Response: "Here's your action plan: [Lists steps]. Shall we set up reminders?"

You: "I need to pause this for now but will come back later"

Assistant uses: pause_session
Response: "Session paused. We've covered your manager conversation, your insight about feedback, and created an action plan. Resume anytime to continue."
```

---

## Key Features to Highlight in Demo

1. **Stateful Persistence**: Sessions maintain context across interruptions
2. **Journey Structure**: Guided workflows with step-by-step progression
3. **Therapeutic Integration**: Crisis detection and emotional support via shrink-chat
4. **Insight Capture**: Building user memory and personalization
5. **Checkpoint System**: Saving important moments and decisions
6. **Multi-Session**: Managing multiple concurrent conversations
7. **Behavioral Governance**: Monitoring for safety and consistency (implicit in responses)
8. **User Context**: Personalized responses based on history

## Demo Recording Tips

- Show the MCP tools being called (if your UI supports it)
- Emphasize the continuity when resuming sessions
- Demonstrate the difference between regular chat and CouchLoop-enhanced chat
- Show real timestamps when pausing/resuming
- Use different browser windows/tabs to show true session resumption
- Keep each demo segment 2-3 minutes for easy editing

## Post-Demo Summary Points

"CouchLoop provides:
- **Safety**: Behavioral governance prevents harmful AI responses
- **Continuity**: Never lose context, even across sessions
- **Structure**: Guided journeys for therapeutic and coaching experiences
- **Memory**: Builds understanding of users over time
- **Integration**: Works seamlessly with ChatGPT and Claude"