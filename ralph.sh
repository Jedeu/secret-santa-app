#!/bin/bash
#
# Ralph Wiggum Autonomous Implementation Loop
#
# This script runs an AI agent in a loop to implement tasks from plans/todo.md.
# Each iteration:
#   1. Runs the agent with the system prompt
#   2. Checks for completion signals
#   3. Runs safety checks (lint, git status)
#   4. Commits progress (optional)
#   5. Handles back-pressure (fixes required before proceeding)
#

set -e

# ============================================================================
# CONFIGURATION
# ============================================================================

# AI CLI command - adjust for your setup
# Options: "claude", "aide", "aider", etc.
AI_CMD="${AI_CMD:-claude}"

# Paths
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TODO_FILE="$PROJECT_DIR/plans/todo.md"
PROGRESS_FILE="$PROJECT_DIR/plans/progress.md"
PROMPT_FILE="$PROJECT_DIR/plans/prompt.md"
PLAN_FILE="$PROJECT_DIR/PLAN.md"

# Loop control
MAX_ITERATIONS=50  # Safety limit
ITERATION=0
BACKPRESSURE_RETRIES=3  # Max retries for lint/build failures

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Initialize progress.md if it doesn't exist
init_progress_file() {
    if [ ! -f "$PROGRESS_FILE" ]; then
        cat > "$PROGRESS_FILE" << 'EOF'
# PWA Migration Progress Log

This file tracks the implementation progress of the PWA migration.

---

EOF
        log_info "Created $PROGRESS_FILE"
    fi
}

# Count pending tasks from todo.md
count_pending_tasks() {
    grep -c '"status": "pending"' "$TODO_FILE" 2>/dev/null || echo "0"
}

# Count completed tasks from todo.md
count_completed_tasks() {
    grep -c '"status": "completed"' "$TODO_FILE" 2>/dev/null || echo "0"
}

# Check if all tasks are done
all_tasks_done() {
    local pending=$(count_pending_tasks)
    [ "$pending" -eq 0 ]
}

# Run safety checks (lint, git status)
run_safety_checks() {
    log_info "Running safety checks..."

    # Check git status for unexpected changes
    local git_status=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    if [ "$git_status" -gt 20 ]; then
        log_warn "Large number of uncommitted changes detected ($git_status files)"
        log_warn "Consider committing or reviewing changes"
    fi

    # Run lint check
    log_info "Running npm run lint..."
    if ! npm run lint --silent 2>/dev/null; then
        log_error "Lint check failed!"
        return 1
    fi
    log_success "Lint check passed"

    return 0
}

# Commit current progress
commit_progress() {
    local iteration=$1
    local pending=$(count_pending_tasks)
    local completed=$(count_completed_tasks)

    # Stage changes
    git add -A

    # Check if there are changes to commit
    if git diff --cached --quiet; then
        log_info "No changes to commit"
        return 0
    fi

    # Commit with iteration info
    git commit -m "Ralph iteration $iteration: $completed/$((completed + pending)) tasks complete

Progress: $completed completed, $pending pending
Automated by Ralph Wiggum workflow"

    log_success "Committed iteration $iteration progress"
}

# Run the AI agent
run_agent() {
    log_info "Running AI agent (iteration $ITERATION)..."

    # Build the prompt
    local full_prompt="$(cat "$PROMPT_FILE")

---

## Current Session

Read the following files to understand current state:
- plans/todo.md (task list with statuses)
- plans/progress.md (what's been done)
- PLAN.md (detailed implementation specs)

Execute the next pending task using the Micro-RPI method, verify it, update state files, and output RALPH_TASK_COMPLETE when done."

    # Define the context files the agent MUST see and be able to edit
    local context_files="$TODO_FILE $PROGRESS_FILE $PLAN_FILE \
        $PROJECT_DIR/.claude/agents/phase3-implementer.md \
        $PROJECT_DIR/.claude/skills/test-runner/SKILL.md \
        $PROJECT_DIR/.claude/skills/ops-runner/SKILL.md"

    # Run the agent
    case "$AI_CMD" in
        "claude")
            # Claude Code CLI needs files as arguments to read/edit them
            # We use --print to ensure output is captured by stdout
            $AI_CMD --print -p "$full_prompt" $context_files
            ;;
        "aide"|"aider")
            # Aider
            $AI_CMD --message "$full_prompt" $context_files
            ;;
        *)
            # Generic
            echo "$full_prompt" | $AI_CMD $context_files
            ;;
    esac
}

# Check agent output for completion signals
check_completion_signal() {
    local output="$1"

    if echo "$output" | grep -q "RALPH_ALL_DONE"; then
        return 0  # All done
    elif echo "$output" | grep -q "RALPH_TASK_COMPLETE"; then
        return 1  # Task complete, continue loop
    else
        return 2  # No signal found
    fi
}

# Handle back-pressure (lint/build failures)
handle_backpressure() {
    local retries=0

    while [ $retries -lt $BACKPRESSURE_RETRIES ]; do
        log_warn "Back-pressure detected. Asking agent to fix issues (attempt $((retries + 1))/$BACKPRESSURE_RETRIES)..."

        local fix_prompt="The previous task caused lint or build errors. Please:
1. Run 'npm run lint' to see current errors
2. Fix ALL lint errors
3. Run 'npm run lint' again to verify
4. Output RALPH_TASK_COMPLETE when fixed

Do not proceed to the next task until lint passes."

        case "$AI_CMD" in
            "claude")
                echo "$fix_prompt" | $AI_CMD --print
                ;;
            *)
                echo "$fix_prompt" | $AI_CMD
                ;;
        esac

        if run_safety_checks; then
            log_success "Back-pressure resolved"
            return 0
        fi

        retries=$((retries + 1))
    done

    log_error "Could not resolve back-pressure after $BACKPRESSURE_RETRIES attempts"
    return 1
}

# Print current status
print_status() {
    local pending=$(count_pending_tasks)
    local completed=$(count_completed_tasks)
    local total=$((pending + completed))

    echo ""
    echo "=========================================="
    echo " Ralph Wiggum Status"
    echo "=========================================="
    echo " Iteration: $ITERATION / $MAX_ITERATIONS"
    echo " Progress:  $completed / $total tasks complete"
    echo " Pending:   $pending tasks remaining"
    echo "=========================================="
    echo ""
}

# ============================================================================
# MAIN LOOP
# ============================================================================

main() {
    cd "$PROJECT_DIR"

    log_info "Starting Ralph Wiggum workflow..."
    log_info "Project: $PROJECT_DIR"
    log_info "AI Command: $AI_CMD"

    # Verify required files exist
    if [ ! -f "$TODO_FILE" ]; then
        log_error "Missing $TODO_FILE"
        exit 1
    fi

    if [ ! -f "$PROMPT_FILE" ]; then
        log_error "Missing $PROMPT_FILE"
        exit 1
    fi

    if [ ! -f "$PLAN_FILE" ]; then
        log_error "Missing $PLAN_FILE"
        exit 1
    fi

    # Initialize progress file
    init_progress_file

    # Check if already complete
    if all_tasks_done; then
        log_success "All tasks already complete!"
        exit 0
    fi

    print_status

    # Main loop
    while [ $ITERATION -lt $MAX_ITERATIONS ]; do
        ITERATION=$((ITERATION + 1))

        log_info "========== ITERATION $ITERATION =========="

        # Run the agent
        agent_output=$(run_agent 2>&1) || true
        echo "$agent_output"

        # Check for completion signals
        if echo "$agent_output" | grep -q "RALPH_ALL_DONE"; then
            log_success "All tasks complete!"
            commit_progress $ITERATION
            print_status
            exit 0
        fi

        # Run safety checks
        if ! run_safety_checks; then
            if ! handle_backpressure; then
                log_error "Aborting due to unresolved back-pressure"
                exit 1
            fi
        fi

        # Commit progress after each successful iteration
        commit_progress $ITERATION

        # Check if all tasks are now done
        if all_tasks_done; then
            log_success "All tasks complete!"
            print_status
            exit 0
        fi

        print_status

        # Small delay to prevent hammering
        sleep 2
    done

    log_error "Reached maximum iterations ($MAX_ITERATIONS)"
    exit 1
}

# ============================================================================
# COMMAND LINE INTERFACE
# ============================================================================

show_help() {
    cat << EOF
Ralph Wiggum - Autonomous Implementation Loop

Usage: ./ralph.sh [command] [options]

Commands:
    start       Start the implementation loop (default)
    status      Show current progress
    reset       Reset all tasks to pending (DANGEROUS)
    help        Show this help message

Options:
    AI_CMD=<cmd>    Set the AI CLI command (default: claude)
                    Examples: AI_CMD=aide ./ralph.sh

Examples:
    ./ralph.sh start              # Start with default AI (claude)
    AI_CMD=aide ./ralph.sh start  # Start with aider
    ./ralph.sh status             # Check current progress
EOF
}

show_status() {
    cd "$PROJECT_DIR"
    print_status

    echo "Recent progress:"
    if [ -f "$PROGRESS_FILE" ]; then
        tail -20 "$PROGRESS_FILE"
    else
        echo "(No progress yet)"
    fi
}

reset_tasks() {
    log_warn "This will reset ALL tasks to pending!"
    read -p "Are you sure? (y/N) " confirm

    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        # Reset all completed/blocked to pending
        sed -i '' 's/"status": "completed"/"status": "pending"/g' "$TODO_FILE"
        sed -i '' 's/"status": "blocked"/"status": "pending"/g' "$TODO_FILE"
        log_success "All tasks reset to pending"
    else
        log_info "Aborted"
    fi
}

# Parse command
case "${1:-start}" in
    start)
        main
        ;;
    status)
        show_status
        ;;
    reset)
        reset_tasks
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
