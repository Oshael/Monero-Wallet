# Working Standards and Code Hygiene

These instructions apply throughout the repository. The goal is to keep code cohesive, understandable, verifiable, and aligned with the project's privacy-first scope.

## Project Identity and Operational Boundaries

- Use only the project's approved public name and origin. Do not invent branding or treat historical directory names as approved product names.
- Do not rename storage keys, cookies, cryptographic formats/AAD, database names, advisory locks, environment variables or Git identities as part of branding; such changes require their own migration review.
- Keep infrastructure access, inventories, device/network details, deployment baselines and operational evidence in an ignored local directory such as `.local/`, outside Git. Never store credentials or private connection details in versioned files or Git remote configuration. Confirm ignore rules before writing sensitive material.
- Preserve other projects on shared infrastructure. Do not change their files, services, databases, certificates, firewall rules or dependencies. Shared service restarts, system package changes and infrastructure changes require explicit authorization for their actual scope.
- Prepare rollback limited to this project's changes, compare relevant configuration fingerprints and service health before/after, and bound operational traffic. Do not promise zero impact on a shared host.
- Follow this project's approved resource, storage and privacy policies. Do not import another project's resource limits, exceptions, storage allocations or operational approvals.
- Preserve the repository's configured Git identity; do not change global credentials or link unrelated identities.
- Source synchronization and Git pushes do not authorize deployment, migrations or service activation. Use this project's documented and approved deployment workflow when it exists; do not invent parallel deployment scripts.
- Deploy only reviewed releases with the required passing checks, preservation checks and scoped rollback. Restart only explicitly authorized project services. Dependency/runtime upgrades, database migrations and shared infrastructure changes require review and authorization for that scope.
- This file does not grant standing permission to push, deploy, purchase services or change a VPS. Reuse explicit authorization already granted for this project; do not ask again for actions it clearly covers.

## Context and Decisions

- Consult the relevant parts of this project's current decision records and implementation plan before implementing a feature. Distinguish approved decisions, proposals, and open questions; do not turn examples into requirements.
- Do not infer implementation or deployment status from a plan. Do not treat frameworks, scripts, or tools mentioned in the plan as installed until the repository shows them. Inspect the actual state before running commands.
- Preserve existing changes and keep each change focused on the requested objective. Focus means the smallest cohesive change, not the fewest files or edited lines. Include a narrow prerequisite extraction when needed to keep the requested behavior in its responsible module; leave unrelated cleanup and broad restructuring to separate tasks (see Files and Modules).
- Record new decisions in the corresponding document and resolve contradictions introduced by the change. Do not change privacy, retention, cost, or product rules to simplify implementation.
- Critically validate requests and assumptions against the repository before implementing. Compare proposals with the existing code, identify conflicts, risks, and false assumptions, and prefer code evidence over user assumptions.
- Investigate missing context first. Ask only when an unresolved ambiguity would materially change behavior, scope, architecture, data, or an irreversible action. Otherwise, state the reasonable assumption and proceed.
- For requests to answer, review, explain, diagnose, or plan, inspect the relevant materials and report the result without implementing changes unless requested. For requests to change, build, or fix, make the requested in-scope local changes and run relevant non-destructive validation without asking first.
- Require confirmation for destructive actions, external writes, purchases, or material scope expansion unless the current request or existing explicit authorization already covers the action.
- Before editing, check `git status` and preserve unrelated user changes. If preexisting changes overlap the target and cannot be safely separated, stop and ask how to proceed.

Always include a statement labeled exactly "Ponto importante" for significant changes, feature updates, and other work that may materially affect the app's behavior. This helps ensure that relevant details and consequences of the applied changes are not overlooked.

## Parallel Sessions and Agents

- Two sessions or agents must never edit the same working tree at the same time. Each concurrent task gets its own Git worktree and branch (for example `codex/<task>` or `claude/<task>`), created from the current integration branch. Each worktree needs its own dependency installation using the repository's lockfile and approved package manager; `.local/` is not copied and stays in the main checkout.
- Split concurrent work by area before starting, and state in each task which files or modules it owns. When two tasks must touch the same hotspot file (see Files and Modules), run them one after the other, or first split the hotspot in a dedicated task.
- Commit only the files of your own task, staged by explicit path. Never commit, revert, reformat or stash another session's uncommitted changes. When unavoidable work in a shared tree is in progress, stage partial files hunk by hunk and say so in the report.
- Integrate through merge into the integration branch, then rerun the checks affected by the combined result. A merge conflict is resolved deliberately by reading both sides; never resolve it by taking one side wholesale without checking what the other side changed.
- Deploy only from the integrated, pushed commit with passing CI, using the approved deployment workflow. Never deploy from a task branch that is missing another task's merged work.

## Mandatory Pause for Material Conflicts

- **When evidence reveals a material conflict with an approved requirement or decision, immediately pause implementation of the affected feature.** If the impact cannot yet be isolated, pause implementation until it is understood. Read-only investigation is allowed to establish the facts and prepare an explanation.
- This rule covers incompatible dependency/distribution licenses; new fees, commercial limits or paid services; external relays and changes to privacy or retention; unsupported wallets, networks, browsers or devices; and alternatives that materially change authentication, account identity, recovery, product experience or V1 scope.
- Explain the situation to the owner in plain Portuguese before proposing implementation. State what was expected, what the evidence actually supports, why it matters, and what already works. Clearly distinguish a confirmed limitation from an unverified assumption.
- Present concrete options with their effects on user steps, privacy, licensing, cost, security, implementation effort and required validation. Identify which requirements each option satisfies and which remain unresolved. Include a recommendation without presenting it as an approved decision.
- **Do not implement a workaround or replacement until the owner explicitly chooses or approves the affected approach.** Do not silently substitute a manual login flow for direct connection, replace cryptographic dependencies, change networks or account rules, reduce V1 to an MVP, or accept new commercial terms to bypass the conflict. Silence, a deadline or approval of the original approach does not approve a materially different replacement.
- Record the owner's decision and resolve contradictions in this project's decision records and the relevant implementation document before implementing the chosen approach. Preserve valid prior work and rerun only checks affected by the change. Approval does not itself establish license compatibility or technical support; verify those prerequisites.
- Do not trigger this pause for routine implementation choices that preserve approved requirements, or reopen an already resolved conflict without new material evidence. An explicit instruction from the owner takes precedence; do not ask again for a decision already made.

## Mandatory Pause After Context Compaction

- **Whenever context is compacted while a coding task or implementation is in progress, immediately pause implementation.** This covers the task that was in progress at the moment of compaction. A new request the user sends after the compaction is itself permission for that new task; the pause still applies to resuming any earlier unfinished work.
- Before making any further code changes, review the available task history, current repository state, and relevant diff to reconstruct the objective, work completed, and remaining steps. Read-only inspection is allowed for this review.
- Summarize what was in progress and explicitly ask the user for permission to resume implementation, explaining that this rule requires the pause.
- **Do not resume code changes or implementation commands until the user grants explicit permission after that compaction.** Prior authorization to perform the task does not satisfy this requirement. Silence or elapsed time is not permission.
- Apply this requirement after every context compaction during an ongoing coding task, even if permission was granted after an earlier compaction.

## Files and Modules

- **Do not impose a line limit per file.** Size, function counts, dependency counts and change frequency are review signals, not sufficient reasons to split code or reject a change. Small files and short functions can still mix responsibilities.
- **Decide responsibility placement before editing behavior.** Inspect the target module and its direct collaborators. For changes that add a responsibility, state, side effect or dependency across modules, briefly state in the task plan or progress update: the owning module and its contract; who owns the affected state/resources and their lifecycle; and which callers or dependency boundaries change. Explain why the behavior belongs there using a concrete reason to change, not a broad label such as "app", "screen" or "manager". Routine edits within an unchanged responsibility do not need a separate architecture document or approval.
- **Prevent the first unrelated responsibility, not only growth of existing hotspots.** Extend an existing module when the behavior belongs to its established contract and invariants. Otherwise, place the independent responsibility in a cohesive module and connect it through an explicit interface, even if the original file is small. Sharing a screen, route or task is not sufficient reason to share implementation ownership. Closely related steps of one operation may stay together; do not create a module for every callback or side effect.
- Give mutable state and resources a clear authoritative owner, including initialization, updates, cancellation and disposal where applicable. Other modules use that owner's operations rather than writing its internals. Do not pass an entire application context, mutable state bag or growing collection of callbacks merely to let extracted files keep manipulating the original controller's internals. Pass only the data and capabilities required by the contract.
- Keep coordinators focused on composing operations and managing the workflow they own. They may legitimately depend on several modules, but must not absorb those modules' domain rules, persistence details or feature-specific rendering. A function enclosing many inner functions that share mutable state (for example a `startX()` closure holding a whole screen) is a module in disguise: review its responsibilities and captured state together, regardless of each inner function's lint score.
- **Recognize hotspots by coupling and competing reasons to change.** Review a file, closure or tightly coupled group of files when unrelated features repeatedly require edits there, independent workflows share mutable state, or domain rules and unrelated side effects accumulate behind one interface. Do not wait for a size or commit-count threshold. Frequent changes alone do not make a cohesive module a hotspot, and moving code to helpers does not resolve one if ownership and coupling remain unchanged.
- **Do not add independent responsibilities to an existing hotspot.** Keep the new behavior in its owning module and limit hotspot edits to the necessary integration or an existing responsibility's correction. If that integration requires separating existing code, include the smallest behavior-preserving extraction that establishes a real boundary and validate the affected contract. Do not use "avoid refactoring", "keep the diff small" or "split it later" to justify deepening the hotspot. Broader cleanup remains a separate task; if a safe boundary requires material scope expansion, explain the specific dependency and ask before that expansion rather than implementing the feature in the hotspot.
- Stylesheets follow the same ownership rule. Keep theme tokens and app-wide layout in the designated shared stylesheet; each feature owns its styles next to its implementation. Literal colors stay in the theme token definitions. Override broader rules in the owning feature stylesheet with the needed specificity; do not append unrelated feature sections to the shared stylesheet.
- Do not compress code, remove useful explanations, or scatter a single responsibility across forwarding files just to satisfy metrics. A successful extraction gives a coherent contract and ownership to the extracted behavior; it does not merely move lines while requiring callers to coordinate its internal steps.
- Start with the smallest modular structure that supports the feature. Do not create microservices, generic interfaces, layers, or packages without a concrete need.
- Avoid concentrating unrelated rules in `utils`, `helpers`, `common`, or a central service that knows the entire system. Shared utilities should have a specific purpose and few dependencies.
- Each module should expose a clear public interface with explicit allowed dependencies. Other modules must not import its internals or access its tables directly. Exporting through `index.ts` does not make unrelated responsibilities cohesive or turn internal details into an appropriate contract. Coordinated operations must preserve atomicity, authorization and idempotency; do not replace one atomic operation with separately committed calls just to split files.
- Do not introduce dependency cycles. Avoid re-export files that hide cycles or indiscriminately expose internals.

## Execution and token efficiency

- Consolidate edits before lint, build, or tests. Do not validate every intermediate change.
- Do not repeat a passing command unless a later edit could affect its result. If only one layer changed, rerun only that layer.
- Prefer the smallest targeted test over a complete suite.
- After a failure, diagnose before retrying. Retry once after the fix unless there is concrete evidence of flakiness or the user authorizes more.
- Keep long-command output to summaries and relevant error excerpts. Poll running commands no more than once every 30 seconds.
- If validation is interrupted, reuse still-valid results and report what passed, what stopped, and the residual risk. If the user asks to stop validation, stop immediately and start no new commands.
- Final reports should lead with the outcome and include affected files, validation, material risks, commit hashes when applicable, and pending work. Omit transcripts, repeated rationale, and unchanged details.

## Functions and Control Flow

- A function should represent a coherent operation with understandable inputs, output, and side effects. Names should express intent.
- Prefer early returns and simple control flow. Extract functions around identifiable responsibilities, not line counts.
- Investigate functions with many branches, nesting levels, parameters, or mutable states. Do not hide complexity in callbacks or helpers without meaningful names.
- For authored TypeScript/JavaScript, adopt cyclomatic complexity of 10, nesting depth of 3 and up to 4 parameters as blocking ESLint errors when setting up the quality checks. Inspect the actual configuration before claiming these checks are already enforced. Fix violations by extracting functions with a real responsibility, never by raising the limits or suppressing them. These limits apply to each function separately; they do not measure closures or files (see Files and Modules).
- Review cohesion when a function coordinates independent workflows, owns unrelated state or needs collaborators from different domains, regardless of length. Length remains a secondary signal; declarative configuration, JSX and tests need evaluation appropriate to their role.
- Use parameter objects when they represent related data and make calls clearer, not merely to bypass argument counts.
- Do not overuse boolean parameters or modes to combine different operations in the same function.
- Keep each shared business rule in its owning domain module and reuse its contract. Do not duplicate authorization, quota or retention checks, or combine unrelated rules into a central service simply because they are reused.

## Boundaries and Security

- HTTP/WebSocket handlers should adapt transport, validate inputs, and call operations in the responsible module. Do not concentrate business rules, SQL, and RPC integration in them.
- The frontend must not import server-only code, database drivers, or credentials. Shared code must be safe for the environments where it runs.
- User secrets designated as client-only and their decrypted sensitive content stay on the client. Do not send them to the backend, logs, telemetry, or external analysis tools.
- Use maintained cryptographic libraries/protocols according to the validation required by the plan. Do not implement custom cryptography to avoid dependencies or simplify tests.
- Static types do not validate external inputs. Validate data at trust boundaries and enforce server-side authorization for each relevant operation.
- Handle errors explicitly: do not swallow exceptions, simulate success, or use fallbacks that weaken authorization, privacy, or durability. Error messages and logs must not expose private data.
- Do not leave promises unhandled or asynchronous tasks without a defined lifecycle. External operations need time and concurrency limits; retries must be bounded and safe against duplication.

## Persistence and Resources

- Use parameterized queries, versioned migrations, and short transactions. Do not hold SQL transactions open during RPC calls, uploads, or waits for interaction.
- Preserve atomicity and idempotency for the project's state changes and externally consequential operations. Module boundaries must not break these guarantees.
- Avoid writes that change nothing, unbounded reads, repeated queries per item, and mass deletions in a single transaction. Pagination and batches must have explicit limits.
- Queues, caches, buffers, temporary data, and logs need resource budgets and cleanup policies consistent with product guarantees. Do not discard accepted durable data outside the approved retention and deletion rules.
- Follow the plan's database maintenance and observability policies, including autovacuum where PostgreSQL is used. Do not disable durability or maintenance to hide performance problems.

## Tools and Exceptions

- For the TypeScript project, use ESLint with type information, TypeScript strict mode, dependency-cruiser for boundaries and Prettier as the single formatter. Inspect the repository before assuming these tools are installed or configured; preserve the established toolchain once adopted. Do not install tools merely to duplicate existing checks.
- When a task establishes or changes an explicit dependency restriction, check whether existing dependency-cruiser rules enforce it. Where supported, encode uncovered restrictions in that configuration and cover them in the existing quality-gate tests; reuse existing rules instead of adding duplicate rules for every new module. Import checks do not prove cohesion, state ownership or correct runtime behavior. Those still require review, not a new arbitrary size or dependency-count gate.
- **Do not enable `max-lines` as a quality gate.** Prioritize complexity, dependencies, correctness, and responsibility reviews. A per-function length gate (`max-lines-per-function`) may be proposed only after calibrating it against the current code and listing the functions it would flag; enabling it is a tooling change that needs the owner's approval.
- Document the thresholds actually adopted. Blocking rules must cause automated checks to fail; do not routinely accumulate ignored warnings.
- Do not fix failures by adding `any`, `@ts-ignore`, broad lint suppressions, exclusions for authored code directories, or globally increased limits. If a legitimate technical exception exists, make it specific and explain it alongside the code/configuration.
- Generated code and external dependencies may have their own exclusions; do not move authored logic into those areas to evade rules. Tests and migrations may have specific profiles, without blanket exclusions.
- Avoid new dependencies without evaluating their necessity, maintenance, license, compatibility, and effect on the bundle/runtime. Preserve the lockfile and do not mix package managers unnecessarily.

## Verification and Delivery

- Inspect existing scripts. Once implemented, the verification command should combine linting, type checking, boundary validation, and formatting checks; also run tests relevant to the change.
- Local hooks are a convenience. When CI is available, it must repeat the checks required for integration. Do not run these analyses continuously on the production VPS.
- Test behavior and invariants: authorization, resource limits, consequential operations, recovery, revocation where applicable, and relevant failures. Do not create tests that merely mirror the implementation or chase a coverage percentage.
- Documentation changes do not require application tests; check consistency, local links, and the diff. For code changes, do not claim checks were performed if they were not run.
- Before finishing, review the diff for responsibilities, dependencies, duplication, error handling, dead code, secrets, and resource impact. Remove remnants of replaced implementations within the task's scope.
- **Structural review is a completion requirement.** Compare the final diff with the responsibility placement decided before implementation: what does each changed module now know, own or control that it did not before? Check new dependencies, captured/shared state, lifecycle cleanup and whether an extraction actually moved ownership. Passing lint, types and tests is necessary for code changes, but does not excuse a structural violation. Correct responsibility mixing introduced or worsened by the task before declaring completion; a note promising a later refactor is not a substitute.
- Keep this review proportional and report its concrete outcome briefly. For a touched hotspot with remaining structural debt, distinguish preexisting debt from the task's changes and give a focused follow-up proposal: target modules, extraction order, risks and affected tests. Do not require fixing unrelated existing hotspots, invent an automated architecture approval that did not run, or accumulate bulky reports and snapshots in the repository.
- Report what changed, what was verified, and any material limitations. If a check could not run, explain why; do not report it as passed.

## Testing and validation

Validation must be proportional to risk and protect observable behavior:

- Identify the concrete regression or contract at risk, check existing coverage, and use the cheapest layer that can detect it. Extend an existing test when it owns the same contract.
- Use unit tests by default for business rules, boundaries, calculations, normalization, deduplication, and state machines.
- Use integration tests for module contracts, persistence, schema, critical routes, auth, billing, authorization, and transactional effects. Cover the primary flow and critical failures without duplicating unit variations.
- Use smoke/E2E only for visible or external flows that require the assembled system.
- Add tests for significant rules or boundaries, plausible regressions, public contracts, security, money, persistence, idempotency, or consequential external failures. Do not test trivial mappings, implementation details, non-contractual call order, or the same scenario at every layer.
- When fixing a bug, add the smallest regression test that fails before the fix and passes afterward. Do not add tests merely because code changed.
- Keep tests isolated. Reuse fixtures and builders, prefer table-driven cases for variations, and do not create mocks that reimplement the subject under test.

# Doc Language

- Communicate with the owner in Portuguese. Branch names, code, comments, test names, documentation, commit messages and other Git-tracked project content must be in English. User-visible application content may be translated into the languages supported by the product.
