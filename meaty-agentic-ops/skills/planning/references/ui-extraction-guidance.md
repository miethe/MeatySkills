# UI Extraction Guidance (Quick Reference)

**TL;DR**: Extract reusable components from `skillmeat/web/` to `@miethe/ui` when they meet stable, genericity, and design system criteria. See full spec at `.claude/specs/ui-package-extraction-spec.md`.

---

## When to Extract

A component is a good extraction candidate when it meets **ALL** of:

1. **Reuse**: Used in 2+ SkillMeat features OR 2+ consumer projects
2. **Generic**: No hard dependencies on SkillMeat services, hooks, or business logic
3. **Stable API**: Props/behavior unchanged for 2+ weeks
4. **Design System**: Uses only @miethe/ui tokens, Radix UI, shadcn primitives
5. **Documented**: Public JSDoc comments; usage examples clear
6. **Tested**: >80% unit test coverage with meaningful scenarios
7. **Accessible**: WCAG 2.1 AA compliant; keyboard navigation verified
8. **Storybook Ready**: Story demonstrating primary use cases

---

## When NOT to Extract

**Skip extraction if**:

- Single-project usage only
- Depends on SkillMeat services (API client, auth, db-backed state)
- Tightly coupled to parent components or route context
- Experimental API (props changed in last 2 weeks)
- Contains SkillMeat-specific business logic (artifact handling, sync workflows)
- Custom styling deviating from design system
- Heavy animation tied to app-specific timing
- Undocumented or internal-only props

---

## Planning Integration

### During PRD/Planning Phase

When identifying potential extraction candidates:

1. **Mark candidates** in task descriptions with `[pkg]` marker:
   ```
   - TASK: Implement DiffViewer component [pkg]
   ```

2. **Flag sub-task** for evaluation if component passes initial criteria:
   ```
   - TASK: Evaluate DiffViewer for @miethe/ui extraction
   ```

### During Phase Execution

- **Early phases (1-3)**: Build component in `skillmeat/web/components/`
- **Mid phases (4-5)**: Monitor stability; note if component meets extraction criteria
- **Later phases (5+)**: Run decision tree (see spec), extract if all criteria met

### Decision Checkpoint

Use this tree to decide:

1. Does it solve a problem across 2+ projects? → No: **KEEP**
2. Is test coverage <80%? → Yes: **IMPROVE FIRST**
3. Depends on SkillMeat services? → Yes: **REFACTOR FIRST**
4. Has stable API for 2+ weeks? → No: **WAIT**
5. Documented + Storybook? → No: **ADD DOCS FIRST**
6. All above pass? → **EXTRACT** (proceed to step 3 below)

---

## Extraction Process (9 Steps)

1. **Fork Component** → Copy to temp branch in @miethe/ui
2. **Refactor Dependencies** → Remove SkillMeat-specific imports
3. **Create Package Entry** → Add export to `@miethe/ui/src/index.ts`
4. **Port Tests** → Copy unit tests; verify in package context
5. **Add Storybook Story** → Port/create story with all variants
6. **Documentation** → README entry in `@miethe/ui/components/[Component]/`
7. **Publish Package** → Version bump, publish to npm (semver)
8. **Update Consumer** → Install new version in skillmeat/web; remove original; update imports
9. **Verify & Cleanup** → Full test suite, no regressions; remove original directory

**Full details**: `.claude/specs/ui-package-extraction-spec.md` § "9-Step Extraction Process"

---

## Quality Gates (Before Extraction)

- Unit Tests: >80% coverage, all critical paths
- Accessibility: axe-core audit passes, keyboard nav verified
- TypeScript: Strict mode compatible
- Documentation: JSDoc on component + all public props
- Storybook: Story with primary use case + variants
- No Breaking Changes: Props finalized; deprecation plan if needed
- Peer Review: Code review from @miethe/ui maintainer

---

## Examples

**✓ Extract**: DiffViewer (used in 2+ scopes, generic diff prop, stable 6+ weeks, >85% tests)

**✓ Extract**: FilterChip (generic filtering, no app logic, used in 3+ features, design-aligned)

**✗ Keep**: ArtifactSyncModal (tight artifact state coupling, sync workflow logic)

**✗ Defer**: ExperimentalChartWidget (unstable API, 45% coverage, no story)

---

## Key Decisions

| Question | Decision |
|----------|----------|
| Is it 1-project only? | Keep in skillmeat/web |
| Does it depend on Auth/API/State? | Keep or refactor first |
| API stable 2+ weeks? | Required for extraction |
| <80% test coverage? | Improve first |
| No Storybook? | Add before extracting |

---

**Full Spec**: `.claude/specs/ui-package-extraction-spec.md`
**Package Repo**: `@miethe/ui` (npm)
**Last Updated**: 2026-03-15
