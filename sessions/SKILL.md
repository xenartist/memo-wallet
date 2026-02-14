# Session Memory Skill

Manages conversation history summarization and loading.

## Triggers

Use this skill when user mentions:

- "save session" / "保存会话"
- "load history" / "加载历史"
- "continue previous" / "继续上次对话"
- When session is about to end

## Functions

### 1. Save Session Summary

When user asks to save current session or session is ending:

1. Read current conversation history (excluding system prompt)
2. Call LLM to generate summary in this format:

```markdown
# Session Summary - {date}

## Core Topics

- Discussion topic/task 1
- Discussion topic/task 2

## Key Decisions

1. Decision item 1
2. Decision item 2

## Pending Tasks

- [ ] Task item 1
- [ ] Task item 2
```

3. Save to `sessions/{YYYY-MM-DD}.md`
4. Update `sessions/MEMORY.md` with relevant info if needed

### 2. Load Historical Sessions

When user asks to load history or start new session:

1. Read `sessions/MEMORY.md`
2. Read today's and yesterday's summaries: `sessions/{yesterday}.md`, `sessions/{today}.md`
3. Inject into system prompt:

```
## Historical Session Summary

{MEMORY.md content}

---

### Recent Sessions

{yesterday summary}

{today summary}
```

### 3. Auto Draft Save

Every 5 turns, auto-save draft to `sessions/draft.md`:

- Content: raw conversation records
- On next startup, check draft.md and ask user to restore

### 4. Interruption Recovery

On startup, check:

- If `sessions/draft.md` exists
- Ask user: "Detected unsaved session draft. Restore?"
  - Yes: load draft content
  - No: delete draft file

## File Structure

```
sessions/
├── MEMORY.md          # Long-term memory
├── 2024-01-15.md      # Session summary
├── 2024-01-16.md      # Session summary
├── draft.md           # Current session draft (temp)
└── .gitkeep           # Keep directory
```

## Configuration

Environment variables:

- `SESSION_DIR`: Session storage directory (default: ./sessions)
- `DRAFT_INTERVAL`: Draft save interval in turns (default: 5)

## Usage Examples

```bash
# Manually save current session
> /save

# List available sessions
> /sessions list

# Load specific session
> /load 2024-01-15
```
