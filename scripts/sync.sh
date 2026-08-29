#!/usr/bin/env bash
#
# sync.sh — manage the origin (public) <-> ibm (private) fork mirror.
#
# Model (see CLAUDE.md "Mirror & sync model" for the full picture):
#   main      -> origin (github.com/miethe/MeatySkills, PUBLIC)   = canonical source
#   ibm-main  -> ibm    (github.ibm.com/boxboat-presales/...,     = the DEPLOYED branch
#                         agent-artifacts)                           (also on origin, PUBLIC)
#
#   Down  (personal -> IBM): FULL & routine   -> `to-ibm`      (rebase + force-push)
#   Up    (IBM -> personal): SELECTIVE & manual -> `to-personal <commit>...` (cherry-pick)
#
# ⚠️ THE INVARIANT THIS SCRIPT WAS WRITTEN AGAINST IS FALSE. Measured 2026-08-10:
#   "ibm-main == origin/main + a small stack of IBM-private commits" does not hold.
#   `git merge-base --is-ancestor origin/main origin/ibm-main` -> FALSE; the branches
#   have diverged 59/4, which is 510 files and +155k lines, and `meaty-agentic-ops/`
#   (the engine, router, executors, and the declared upstream for other repos'
#   deployed workflow copies) exists ONLY on ibm-main. `cmd_status` reports the
#   divergence honestly as of this commit — see the two headings it prints.
#
# ⚠️ `[ibm-only]` IS NOT A PRIVACY BOUNDARY. `ibm-main` is pushed to `origin` too, and
#   `origin` is PUBLIC: `skills/ica-delegate/SKILL.md` is served from
#   github.com/miethe/MeatySkills?ref=ibm-main, and PR #12 was merged into that branch
#   on the public remote. Treat the prefix as "belongs on the deploy branch", never as
#   "cannot be read by the public" — and do not add a secret to an `[ibm-only]` commit
#   expecting the branch to contain it. Tracked: node_01KZP5880QKRFEDKWDWNP07ZV5.
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

  # The superset invariant, checked rather than assumed. This heading used to read
  # "IBM-private commits" over the WHOLE `origin/main..ibm-main` range, so 54 generic
  # commits were displayed as though they belonged on the private branch — which is
  # how they came to sit there unshared for weeks. The range is now split by the
  # `[ibm-only]` marker that `to-personal` actually enforces, so the two categories
  # can never be read as one again.
  if git merge-base --is-ancestor "$ORIGIN_REMOTE/$MAIN_BRANCH" "$IBM_BRANCH" 2>/dev/null; then
    printf '\n  Invariant OK: %s/%s is an ancestor of %s (true superset).\n' \
      "$ORIGIN_REMOTE" "$MAIN_BRANCH" "$IBM_BRANCH"
  else
    printf '\n  \033[1;31m⚠ INVARIANT BROKEN\033[0m: %s/%s is NOT an ancestor of %s — the branches have\n' \
      "$ORIGIN_REMOTE" "$MAIN_BRANCH" "$IBM_BRANCH"
    printf '    diverged in BOTH directions, so `to-ibm` cannot fast-forward and generic work\n'
    printf '    landing on %s does not reach the branch that is deployed from.\n' "$MAIN_BRANCH"
    printf '    behind (%s/%s not on %s): %s commit(s)\n' \
      "$ORIGIN_REMOTE" "$MAIN_BRANCH" "$IBM_BRANCH" \
      "$(git rev-list --count "$IBM_BRANCH..$ORIGIN_REMOTE/$MAIN_BRANCH" 2>/dev/null || echo '?')"
  fi

  local range="$ORIGIN_REMOTE/$MAIN_BRANCH..$IBM_BRANCH"
  local ibm_only generic
  ibm_only="$(git log --oneline --format='%h %s' "$range" | grep -i '\[ibm-only\]' || true)"
  generic="$(git log --oneline --format='%h %s' "$range" | grep -iv '\[ibm-only\]' || true)"

  printf '\n  \033[1mIBM-private\033[0m — marked `[ibm-only]`, refused by `to-personal` (on %s, not on %s/%s):\n\n' \
    "$IBM_BRANCH" "$ORIGIN_REMOTE" "$MAIN_BRANCH"
  if [ -n "$ibm_only" ]; then
    printf '%s\n' "$ibm_only" | sed 's/^/    /'
  else
    printf '    (none)\n'
  fi

  printf '\n  \033[1mGENERIC and STRANDED\033[0m — %s commit(s) that belong upstream; `to-personal` candidates:\n\n' \
    "$(printf '%s' "$generic" | grep -c . || true)"
  if [ -n "$generic" ]; then
    printf '%s\n' "$generic" | sed 's/^/    /'
  else
    printf '    (none — nothing generic is stranded)\n'
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

  Rebase hit a conflict. DO NOT assume it is "origin edited the same lines as an
  IBM-private commit" — that hint used to be printed here and it produced a wrong
  resolution once (2026-08-10). Because the branches have diverged in both
  directions, the conflict is usually git replaying ibm-main's OWN history against
  a base that lacks the file entirely, so the "theirs" side is an earlier ibm-main
  commit, not anything from origin.

  Before resolving, establish which branch each side actually came from:

      git cat-file -e origin/main:<path>   # does the file even exist on main?
      git log --format='%h %ad %s' --date=short origin/main -- <path>
      git log --format='%h %ad %s' --date=short ibm-main    -- <path>

  Resolving from conflict markers alone, without that check, is how a live routing
  decision got reverted to a two-week-stale reading. Then:

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
  scripts/sync.sh status                 Check the superset invariant, then list the
                                         divergence split into [ibm-only] vs generic-stranded
  scripts/sync.sh to-ibm                 Sync ALL of origin/main down into ibm-main
                                         (rebase IBM-private commits on top + force-push)
  scripts/sync.sh to-personal <commit>... Cherry-pick generic commit(s) up to main/origin

FLOW
  origin (PUBLIC)  = canonical source of truth   (branch: main)
  ibm              = the branch deployed from     (branch: ibm-main)

  Down  personal -> IBM : full & routine    (to-ibm)
  Up    IBM -> personal : selective & manual (to-personal)

  ⚠️ `ibm-main` is ALSO pushed to `origin`, which is PUBLIC — so `[ibm-only]` means
     "belongs on the deploy branch", NOT "private". See the header comment.
  ⚠️ The superset invariant is currently BROKEN; `status` says so explicitly rather
     than printing the whole divergence as though it were all IBM-private.

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
