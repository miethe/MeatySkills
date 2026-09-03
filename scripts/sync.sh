#!/usr/bin/env bash
#
# sync.sh — manage the origin (public) <-> ibm (private) fork mirror.
#
# ⚠️ RETIRED 2026-09-03 — THE SPLIT MODEL THIS SCRIPT IMPLEMENTS IS ABANDONED.
#
#   Nick's decision: `origin/main` is now the SINGLE canonical line. `ibm-main` and the
#   `ibm` remote are deliberately FROZEN — left stale, not synced, not deleted. Anything
#   IBM-specific goes to the private repo `ibm-agentic-tools` instead of a branch of this
#   public one. See CLAUDE.md § "The split model is retired".
#
#   `to-ibm` and `to-personal` therefore REFUSE. They are kept as refusals rather than
#   deleted because `to-ibm` ends in a live `git push --force-with-lease ibm ibm-main:main`
#   (it was line 158): a deleted script is a script someone restores from git history and
#   runs, while a refusal states the decision at the moment of the attempt. `status` still
#   works — it is read-only, and measuring the frozen divergence stays useful.
#
# ⚠️ `[ibm-only]` WAS NEVER A PRIVACY BOUNDARY. `ibm-main` is pushed to `origin` too, and
#   `origin` is PUBLIC: `skills/ica-delegate/SKILL.md` is served from
#   github.com/miethe/MeatySkills?ref=ibm-main, and PR #12 was merged into that branch on
#   the public remote. This stays true after the retirement — freezing the branch does not
#   unpublish it. Never read the prefix as "cannot be read by the public".
#
# ⚠️ This file's own former claim — "lives on ibm-main ONLY, never cherry-pick it up to
#   main" — was already FALSE before this retirement: 539def0 (PR #37) swept it onto
#   `main`, where it has been ever since. The rule outlived nothing; it was simply not
#   enforced by anything. Same for CLAUDE.md.

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
  die "RETIRED: the public/IBM split model was abandoned 2026-09-03. \`origin/main\` is the
    single canonical line; \`ibm-main\` and the \`ibm\` remote are frozen on purpose, and
    IBM-specific work belongs in the private \`ibm-agentic-tools\` repo. This verb used to
    rebase ibm-main onto origin/main and FORCE-PUSH to ibm/main — doing that now would resurrect the retired
    model. Read CLAUDE.md § 'The split model is retired' before overriding; if you
    genuinely need it, run the git commands by hand and say why in the commit."
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
  die "RETIRED: the public/IBM split model was abandoned 2026-09-03. \`origin/main\` is the
    single canonical line; \`ibm-main\` and the \`ibm\` remote are frozen on purpose, and
    IBM-specific work belongs in the private \`ibm-agentic-tools\` repo. This verb used to
    cherry-pick commits from ibm-main onto main and push to origin — doing that now would resurrect the retired
    model. Read CLAUDE.md § 'The split model is retired' before overriding; if you
    genuinely need it, run the git commands by hand and say why in the commit."
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
sync.sh — RETIRED. The origin(public) <-> ibm(private) split model was abandoned 2026-09-03.

USAGE
  scripts/sync.sh status                 (still works, read-only) Measure the now-FROZEN
                                         divergence between main and ibm-main
  scripts/sync.sh to-ibm                 REFUSES — would force-push to the frozen ibm remote
  scripts/sync.sh to-personal <commit>.. REFUSES — reconcile onto main directly instead

WHAT REPLACED IT
  \`origin/main\` is the single canonical line. \`ibm-main\` and the \`ibm\` remote are
  deliberately frozen — stale by decision, not by neglect. IBM-specific content goes to the
  private \`ibm-agentic-tools\` repo, not to a branch of this public one.

  ⚠️ Freezing did NOT unpublish anything: \`ibm-main\` is on the PUBLIC origin and stays
     readable. \`[ibm-only]\` never was a privacy boundary.

See CLAUDE.md § "The split model is retired".
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
