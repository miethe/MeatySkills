#!/usr/bin/env bash
#
# sync.sh — manage the origin (public) <-> ibm (private) fork mirror.
#
# Model (see CLAUDE.md "Mirror & sync model" for the full picture):
#   main      -> origin (github.com/miethe/MeatySkills, PUBLIC)   = canonical source
#   ibm-main  -> ibm    (github.ibm.com/boxboat-presales/...,     = origin/main +
#                         agent-artifacts, PRIVATE)                  IBM-private commits
#
#   Invariant: ibm-main == origin/main + a small stack of IBM-private commits.
#   Down  (personal -> IBM): FULL & routine   -> `to-ibm`      (rebase + force-push)
#   Up    (IBM -> personal): SELECTIVE & manual -> `to-personal <commit>...` (cherry-pick)
#
# This file lives on ibm-main ONLY. Never cherry-pick it up to main/origin.

set -euo pipefail

MAIN_BRANCH="main"
IBM_BRANCH="ibm-main"
ORIGIN_REMOTE="origin"
IBM_REMOTE="ibm"

# --- helpers ---------------------------------------------------------------

die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }

current_branch() { git rev-parse --abbrev-ref HEAD; }

require_clean_tree() {
  [ -z "$(git status --porcelain)" ] || \
    die "working tree not clean — commit or stash changes first"
}

require_branch() {
  git show-ref --verify --quiet "refs/heads/$1" || \
    die "local branch '$1' not found (expected from the fork setup)"
}

# Restore the branch we started on, even on failure.
START_BRANCH=""
restore_branch() {
  if [ -n "$START_BRANCH" ] && [ "$(current_branch)" != "$START_BRANCH" ]; then
    git checkout -q "$START_BRANCH" 2>/dev/null || true
  fi
}
trap restore_branch EXIT

# --- commands --------------------------------------------------------------

cmd_status() {
  info "Fetching $ORIGIN_REMOTE and $IBM_REMOTE ..."
  git fetch --quiet --multiple "$ORIGIN_REMOTE" "$IBM_REMOTE"

  printf '\n  %-10s  %s\n' "main"     "vs $ORIGIN_REMOTE/$MAIN_BRANCH (ahead behind):"
  printf '  %-10s  %s\n'   ""         "$(git rev-list --left-right --count "$MAIN_BRANCH...$ORIGIN_REMOTE/$MAIN_BRANCH" 2>/dev/null || echo 'n/a')"
  printf '  %-10s  %s\n'   "ibm-main" "vs $IBM_REMOTE/$MAIN_BRANCH (ahead behind):"
  printf '  %-10s  %s\n'   ""         "$(git rev-list --left-right --count "$IBM_BRANCH...$IBM_REMOTE/$MAIN_BRANCH" 2>/dev/null || echo 'n/a')"

  printf '\n  IBM-private commits (on %s, not on %s/%s) — cherry-pick candidates for `to-personal`:\n\n' \
    "$IBM_BRANCH" "$ORIGIN_REMOTE" "$MAIN_BRANCH"
  local ibm_only
  ibm_only="$(git log --oneline "$ORIGIN_REMOTE/$MAIN_BRANCH..$IBM_BRANCH")"
  if [ -n "$ibm_only" ]; then
    printf '%s\n' "$ibm_only" | sed 's/^/    /'
  else
    printf '    (none — branches are in sync)\n'
  fi
  printf '\n'
}

# Down: bring everything from origin/main into ibm-main, keeping IBM-private
# commits stacked on top, then publish to the IBM remote.
cmd_to_ibm() {
  require_clean_tree
  require_branch "$MAIN_BRANCH"
  require_branch "$IBM_BRANCH"
  START_BRANCH="$(current_branch)"

  info "Fetching remotes ..."
  git fetch --quiet --multiple "$ORIGIN_REMOTE" "$IBM_REMOTE"

  info "Rebasing $IBM_BRANCH onto $ORIGIN_REMOTE/$MAIN_BRANCH ..."
  git checkout -q "$IBM_BRANCH"
  if ! git rebase "$ORIGIN_REMOTE/$MAIN_BRANCH"; then
    cat >&2 <<'EOF'

  Rebase hit a conflict (origin probably edited the same lines as an
  IBM-private commit, e.g. README.md). Resolve it, then run:

      git rebase --continue
      git push --force-with-lease ibm ibm-main:main

EOF
    exit 1
  fi
  ok "Rebase clean."

  info "Force-pushing $IBM_BRANCH -> $IBM_REMOTE/$MAIN_BRANCH (with lease) ..."
  git push --force-with-lease "$IBM_REMOTE" "$IBM_BRANCH:$MAIN_BRANCH"
  ok "IBM mirror updated."
}

# Up: selectively cherry-pick generic commit(s) from ibm-main onto main and
# publish to the public origin. Never use this for [ibm-only] commits.
cmd_to_personal() {
  [ "$#" -ge 1 ] || die "usage: sync.sh to-personal <commit>... (e.g. a SHA from \`sync.sh status\`)"
  require_clean_tree
  require_branch "$MAIN_BRANCH"
  START_BRANCH="$(current_branch)"

  for c in "$@"; do
    if git log -1 --format='%s' "$c" 2>/dev/null | grep -qi '\[ibm-only\]'; then
      die "commit $c is marked [ibm-only] and must not go to the public repo"
    fi
  done

  info "Fetching $ORIGIN_REMOTE ..."
  git fetch --quiet "$ORIGIN_REMOTE"

  info "Updating $MAIN_BRANCH (fast-forward) ..."
  git checkout -q "$MAIN_BRANCH"
  git pull --ff-only "$ORIGIN_REMOTE" "$MAIN_BRANCH"

  info "Cherry-picking onto $MAIN_BRANCH: $*"
  if ! git cherry-pick "$@"; then
    die "cherry-pick conflict — resolve, \`git cherry-pick --continue\`, then \`git push origin main\`"
  fi
  ok "Cherry-pick clean."

  info "Pushing $MAIN_BRANCH -> $ORIGIN_REMOTE ..."
  git push "$ORIGIN_REMOTE" "$MAIN_BRANCH"
  ok "Public repo updated. Run \`sync.sh to-ibm\` to drop the duplicate from ibm-main."
}

usage() {
  cat <<EOF
sync.sh — manage the origin (public) <-> ibm (private) mirror

USAGE
  scripts/sync.sh status                 Show divergence + list IBM-private commits
  scripts/sync.sh to-ibm                 Sync ALL of origin/main down into ibm-main
                                         (rebase IBM-private commits on top + force-push)
  scripts/sync.sh to-personal <commit>... Cherry-pick generic commit(s) up to main/origin

FLOW
  origin (PUBLIC)  = canonical source of truth   (branch: main)
  ibm    (PRIVATE) = origin/main + IBM-private    (branch: ibm-main)

  Down  personal -> IBM : full & routine    (to-ibm)
  Up    IBM -> personal : selective & manual (to-personal)

See CLAUDE.md for conventions ([ibm-only] commit prefix, conflict handling).
EOF
}

# --- dispatch --------------------------------------------------------------

cd "$(git rev-parse --show-toplevel)"

case "${1:-}" in
  status)      shift; cmd_status "$@" ;;
  to-ibm)      shift; cmd_to_ibm "$@" ;;
  to-personal) shift; cmd_to_personal "$@" ;;
  ""|-h|--help|help) usage ;;
  *) usage; die "unknown command: $1" ;;
esac
