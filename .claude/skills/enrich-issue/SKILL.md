---
name: enrich-issue
description: >
  Enrich a feature with detailed implementation guidance by cross-referencing
  the codebase, and existing details. Use this skill when a developer is about to pick up an issue and needs concrete
  implementation details — file paths, migration SQL, endpoint contracts, edge cases,
  test scenarios — derived from the current state of the code. Trigger whenever the
  user mentions enriching, detailing, or fleshing out an issue and want implementation guidance.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Enrich Issue Skill

You are an implementation analyst. Your job is to take a product-level issue/feature
and produce a detailed, developer-ready implementation specification by
cross-referencing the current codebase, sibling issues/features


## Workflow

### Step 1: Understand the issue

Parse the issue/feature. Identify:

- The feature or change being requested
- Any referenced issues/features, tables, or domain concepts
- The stated acceptance criteria
- **Whether this issue involves UI or UX changes.** Classify the issue as one of:
  - **UI/UX** — the issue adds, modifies, or removes user-facing screens,
    components, layouts, navigation, or visual behaviour
  - **Backend-only** — the issue is purely logic, data, infrastructure, API, or
    backend functionality with no user-facing visual changes

  This classification determines whether the design is consulted and
  whether frontend sections appear in the output. When in doubt (e.g. the issue
  mentions a "mobile UI" or "screen" or "page" or "component"), classify as UI/UX.


- Which issues handle **prerequisite groundwork** that this issue depends on
  (e.g. creating a shared table, setting up a service layer, defining an API
  contract). Note whether those issues are open, closed, or in progress.
- Which issues handle **follow-on work** that will extend or modify what this
  issue builds (e.g. a later issue adds more columns to a table this issue
  creates, or replaces a simple implementation with a more complex one).
- Whether any functionality that initially appears "missing" from the codebase
  is actually scoped to a different sibling issue rather than being an oversight.

This prevents the enriched spec from flagging work as missing dependencies when
it is simply allocated to a different issue in the same group.

### Step 2: Gather project context (run these in parallel where possible)

**Scan the codebase** for relevant context:
   - Use `Glob` to map the project structure
   - Use `Grep` to find related models, routes, controllers, services, and tests
   - Use `Read` to examine existing patterns (e.g. how other similar features
     are structured, what ORM/query patterns are used, how migrations are written)
   - Note the tech stack, directory conventions, and any shared utilities

### Step 3: Produce the enriched specification

Write a detailed implementation specification in markdown using the structure below.
Be specific and concrete — reference actual file paths, existing function names, and
real patterns from the codebase. Do not invent conventions; follow what already exists.

### Step 5: Save the spec and transition the issue

After the specification is complete:
**Post the spec in the issue** This is mandatory — the spec must live on the issue so the implement-issue skill can read it later. Do not paste the spec into chat only.



## Output Format

```markdown
# Implementation Spec: [Issue Title]

**Generated**: [date]
**Codebase snapshot**: [current branch and short commit hash]
**Change type**: [UI/UX | Backend-only]

---

## Codebase Analysis

[Describe what already exists that this feature touches or extends — existing models,
services, routes, utilities. Reference actual file paths.]

## Related Issues 


### Assumptions from siblings
[List any functionality that is NOT in the codebase yet but IS covered by a sibling
issue, so the developer knows not to build it themselves.

[If no sibling issues affect this work, state "No sibling issues have a direct
dependency relationship with this issue."]

## Implementation Plan

### Database Changes

- Migration file: `[path following existing convention]`
- Table/model definition with exact column names, types, constraints, and indices
- Any seed data or default values required
- Relationship to existing tables

### API / Backend Changes

- Endpoint(s): method, path, request/response shape
- Service layer: function signatures with parameter and return types
- Validation rules and error responses
- How this integrates with existing middleware, auth, or shared logic

### Frontend Changes

> **Include this section ONLY for UI/UX issues. Omit entirely for backend-only issues.**

> **IMPORTANT: When implementing the frontend changes described below, the
> `frontend-design` skill MUST be used.** This is mandatory for all UI/UX work to
> ensure consistency with the project's design standards. Reference it explicitly
> in the spec so the implementing developer knows to invoke it.

- Component(s) to create or modify, with file paths
- State management approach (following existing patterns)
- Navigation/routing changes
- Key UI interactions and their handlers
- Note: **Use the `frontend-design` skill when implementing these changes**

### Edge Cases and Boundary Conditions

- [List specific scenarios the developer should handle and test]

### Test Plan

- Unit tests: what to test, which files, following existing test patterns
- Integration tests: API endpoint tests with expected inputs/outputs
- Edge case tests: derived from the boundary conditions above

### Suggested Implementation Order

1. [Numbered steps in the order a developer should tackle them]

### Open Questions

- [Anything ambiguous in the issue that the developer should clarify before starting]
```

## Guidelines

- **Classify before you gather.** Determine whether the issue is UI/UX or
  backend-only in Step 1 and let that classification drive the rest of the
  workflow.
- **Mandate the frontend-design skill for UI/UX work.** Every enriched spec that
  includes a "Frontend Changes" section MUST include an explicit instruction that
  the `frontend-design` skill is required during implementation. This is
  non-negotiable.
- **Be concrete, not generic.** "Create a migration at `drizzle/0001_great_scot.sql`"
  is useful. "Create a migration file" is not.
- **Follow existing patterns.** If the codebase uses a specific ORM, router, or test
  framework, reference those exact tools and their idioms.
- **Flag drift risks.** If the issue references something that does not yet exist in
  the codebase (e.g. a table or service mentioned in the PRD but not yet built),
  check the sibling issues first. If a sibling covers that work, note the dependency
  rather than flagging it as missing. Only flag it as a genuine gap if no sibling
  issue accounts for it.
- **Keep it actionable.** A developer should be able to read this spec and start
  coding without needing to do their own codebase archaeology.
- **Use British English** for all written content.