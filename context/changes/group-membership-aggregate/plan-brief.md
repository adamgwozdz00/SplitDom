# Group as the Membership Aggregate — Plan Brief

> Full plan: `context/changes/group-membership-aggregate/plan.md`

## What & Why

`Group` becomes the aggregate root of a household's membership: it creates invites and lets a user join with one, in one write of one aggregate. Today the membership write lives in SQL (`redeem_group_invite`) outside the `Group` repository, which is a documented exception to the project's DDD rules. This is roadmap item F-03; users see no change.

## Starting Point

`Invite` is a separate aggregate with its own module, service and repository. Joining claims the invite and inserts the member inside one SQL function. `Group` has members and a host but no version and no invites, and carries a `memberLabel` presentation method.

## Desired End State

`Group.invite` and `Group.join` hold the rules; `Invite` is an entity inside `Group` (only active invites loaded). `groups.version` guards concurrent writes. `src/lib/invites/` is gone, the CLAUDE.md exception is removed, and the invite flow behaves exactly as before.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Concurrent joins | `groups.version` optimistic lock, reload and retry once | Same pattern as `billing_periods` in F-02 and covers future membership rules | Plan |
| Member redeems own link | Invite is used up, `joined = false`, no duplicate member | No user-visible change from production | Plan |
| Token lookup | Group loaded by token hash without member emails; invite preview is a separate narrow read model | A token holder who is not a member never sees emails | Plan |
| Module layout | Invite, token and cookies move into `src/lib/groups/`; `src/lib/invites/` deleted | One module per aggregate boundary | Plan |
| Token hashing | Service hashes the token in TypeScript, aggregate stays pure and synchronous | Web Crypto is async | Plan |
| Old RPCs | Left in place, dropped by a later contract migration | Previous Worker still calls them | Research |

## Scope

**In scope:** version column and new persistence functions, `Group.invite`/`join`, `GroupService` methods with retry, rewiring of endpoints and pages, `memberLabel` to presentation, docs and smoke.

**Out of scope:** dropping old RPCs, leaving or removing members, new invite features, any `BillingPeriod` change.

## Architecture / Approach

Four phases, each leaving tests, type check and lint green: additive persistence, test-first aggregate, test-first service on a fake repository, then the switch-over that deletes the old path. The repository sends only pending changes to `save_group`, which bumps the version conditionally and returns `false` on a conflict.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Persistence (expand) | `groups.version`, load/save/preview functions, repository port | `save_group` backstops must allow a non-member's join only with a claimed invite |
| 2. Group aggregate | `invite`, `join`, `Invite` entity, `InviteTokenHash` | Keeping `joined = false` behaviour exact |
| 3. GroupService | `invite`, `join`, `previewInvite` with retry | Concurrent-join race gives `invite_invalid` for the loser |
| 4. Switch-over | Endpoints and pages rewired, module folded, docs and smoke | Regressing the working invite flow |

**Prerequisites:** S-03 done, F-02 merged (both are).
**Estimated effort:** ~3-4 sessions across 4 phases.

## Open Risks & Assumptions

- Hashing moves from SQL to TypeScript; the new functions use the hash, the old ones keep using plaintext until the contract migration.
- A join and an old-path redeem could race on one invite during the deploy window; the conditional `used_at is null` claim on both paths keeps it single-use.

## Success Criteria (Summary)

- `npm test`, lint, `astro check`, build, type regeneration and `npm run smoke` all pass.
- A second user joins through a link exactly as before; a used or expired link is refused.
- No `@/lib/invites` import and no `redeem_group_invite` call remain in the app.
