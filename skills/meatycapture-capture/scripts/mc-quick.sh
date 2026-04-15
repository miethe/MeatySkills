#!/usr/bin/env bash
set -e

# Temp file cleanup trap
TEMP_JSON=""
cleanup() {
  if [[ -n "$TEMP_JSON" && -f "$TEMP_JSON" ]]; then
    rm -f "$TEMP_JSON"
  fi
}
trap cleanup EXIT INT TERM

# Environment variable defaults
MC_PROJECT="${MC_PROJECT:-skillmeat}"
MC_PRIORITY="${MC_PRIORITY:-medium}"
MC_STATUS="${MC_STATUS:-triage}"

# Valid types
VALID_TYPES=("enhancement" "bug" "idea" "task" "question")

# Usage function
show_usage() {
  cat << USAGE_EOF
Usage: mc-quick.sh TYPE DOMAIN SUBDOMAIN "Title" "Problem" "Goal" [additional notes...]

Positional Arguments:
  TYPE        One of: enhancement, bug, idea, task, question
  DOMAIN      Primary domain (comma-separated for multiple)
  SUBDOMAIN   Subdomain/component (comma-separated for multiple)
  TITLE       Short title for the capture
  PROBLEM     Description of the problem
  GOAL        Description of the desired outcome

Optional Arguments:
  [notes...]  Additional notes (each arg becomes a separate note)

Environment Variables:
  MC_PROJECT  Project name (default: skillmeat)
  MC_PRIORITY Priority level (default: medium)
  MC_STATUS   Status (default: triage)

Document Creation Behavior:
  - bug type: Aggregated into daily "Bug Log - YYYY-MM-DD" document
  - other types: Each request creates its own document with TITLE as doc title

Examples:
  mc-quick.sh enhancement web "deployments,modal" \\
    "Implement Remove button" \\
    "Button shows not implemented" \\
    "Full removal with filesystem toggle"

  MC_PRIORITY=high mc-quick.sh bug api validation \\
    "Fix auth timeout" \\
    "Sessions expire too quickly" \\
    "Extend session TTL to 24 hours"

USAGE_EOF
  exit 1
}

# Check for help flag
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_usage
fi

# Validate minimum argument count
if [[ $# -lt 6 ]]; then
  echo "Error: Minimum 6 arguments required" >&2
  echo "" >&2
  show_usage
fi

# Parse positional arguments
TYPE="$1"
DOMAIN="$2"
SUBDOMAIN="$3"
TITLE="$4"
PROBLEM="$5"
GOAL="$6"
shift 6

# Validate TYPE
type_valid=false
for valid_type in "${VALID_TYPES[@]}"; do
  if [[ "$TYPE" == "$valid_type" ]]; then
    type_valid=true
    break
  fi
done

if [[ "$type_valid" == false ]]; then
  echo "Error: TYPE must be one of: ${VALID_TYPES[*]}" >&2
  exit 1
fi

# Smart auto-tagging: split comma-separated values and merge
build_tags() {
  local tags=()

  # Split DOMAIN on commas
  IFS=',' read -ra domain_parts <<< "$DOMAIN"
  for part in "${domain_parts[@]}"; do
    # Trim whitespace
    part=$(echo "$part" | xargs)
    if [[ -n "$part" ]]; then
      tags+=("\"$part\"")
    fi
  done

  # Split SUBDOMAIN on commas
  IFS=',' read -ra subdomain_parts <<< "$SUBDOMAIN"
  for part in "${subdomain_parts[@]}"; do
    # Trim whitespace
    part=$(echo "$part" | xargs)
    if [[ -n "$part" ]]; then
      tags+=("\"$part\"")
    fi
  done

  # Join with commas
  local IFS=','
  echo "${tags[*]}"
}

TAGS=$(build_tags)

# Build notes array
build_notes() {
  local notes=()

  # Add Problem and Goal
  notes+=("\"Problem: $PROBLEM\"")
  notes+=("\"Goal: $GOAL\"")

  # Add any additional notes
  for note in "$@"; do
    notes+=("\"$note\"")
  done

  # Join with commas
  local IFS=','
  echo "${notes[*]}"
}

NOTES=$(build_notes "$@")

# Build domain array from comma-separated string
build_domain_array() {
  local input="$1"
  local parts=()
  IFS=',' read -ra split_parts <<< "$input"
  for part in "${split_parts[@]}"; do
    part=$(echo "$part" | xargs)
    if [[ -n "$part" ]]; then
      parts+=("\"$part\"")
    fi
  done
  local IFS=','
  echo "${parts[*]}"
}

DOMAIN_ARRAY=$(build_domain_array "$DOMAIN")
SUBDOMAIN_ARRAY=$(build_domain_array "$SUBDOMAIN")

# Build the item JSON (used for both create and append)
build_item_json() {
  cat << ITEM_EOF
{
  "title": "$TITLE",
  "type": "$TYPE",
  "domain": [$DOMAIN_ARRAY],
  "subdomain": [$SUBDOMAIN_ARRAY],
  "priority": "$MC_PRIORITY",
  "status": "$MC_STATUS",
  "tags": [$TAGS],
  "notes": [$NOTES]
}
ITEM_EOF
}

# Find existing daily bug doc for today
find_daily_bug_doc() {
  local today_date
  today_date=$(date +%Y-%m-%d)
  local bug_log_title="Bug Log - $today_date"
  
  # Query meatycapture for docs and find matching title
  local doc_path
  doc_path=$(meatycapture log list "$MC_PROJECT" --json 2>/dev/null | \
    jq -r --arg title "$bug_log_title" '.[] | select(.title == $title) | .path' 2>/dev/null | head -1)
  
  echo "$doc_path"
}

# Handle bug type: daily aggregation
handle_bug_capture() {
  local existing_doc
  existing_doc=$(find_daily_bug_doc)
  
  if [[ -n "$existing_doc" && -f "$existing_doc" ]]; then
    # Append to existing daily bug doc
    echo "Appending to existing bug log: $existing_doc" >&2
    
    # Build items array for append (just the item, no project wrapper)
    local items_json
    items_json=$(cat << APPEND_EOF
{
  "items": [$(build_item_json)]
}
APPEND_EOF
)
    
    TEMP_JSON=$(mktemp)
    echo "$items_json" > "$TEMP_JSON"
    
    if meatycapture log append "$existing_doc" "$TEMP_JSON" --quiet; then
      echo "Capture appended successfully" >&2
      exit 0
    else
      echo "Append failed" >&2
      exit 1
    fi
  else
    # Create new daily bug doc
    local today_date
    today_date=$(date +%Y-%m-%d)
    local doc_title="Bug Log - $today_date"
    
    echo "Creating new daily bug log: $doc_title" >&2
    
    local create_json
    create_json=$(cat << CREATE_EOF
{
  "project": "$MC_PROJECT",
  "title": "$doc_title",
  "items": [$(build_item_json)]
}
CREATE_EOF
)
    
    TEMP_JSON=$(mktemp)
    echo "$create_json" > "$TEMP_JSON"
    
    if meatycapture log create "$TEMP_JSON" --json; then
      echo "Capture successful" >&2
      exit 0
    else
      echo "Capture failed" >&2
      exit 1
    fi
  fi
}

# Handle non-bug types: one doc per request
handle_standard_capture() {
  echo "Creating document: $TITLE" >&2
  
  local create_json
  create_json=$(cat << CREATE_EOF
{
  "project": "$MC_PROJECT",
  "title": "$TITLE",
  "items": [$(build_item_json)]
}
CREATE_EOF
)
  
  TEMP_JSON=$(mktemp)
  echo "$create_json" > "$TEMP_JSON"
  
  if meatycapture log create "$TEMP_JSON" --json; then
    echo "Capture successful" >&2
    exit 0
  else
    echo "Capture failed" >&2
    exit 1
  fi
}

# Main logic: route based on type
if [[ "$TYPE" == "bug" ]]; then
  handle_bug_capture
else
  handle_standard_capture
fi
