# Repository Guidelines

## Project Structure & Module Organization

This repository is a desktop rewrite of Legado using React, TypeScript, Tauri, and Rust. Frontend code lives in `src/`: route-level views are in `src/pages/`, shared UI is in `src/components/`, translations are in `src/i18n/`, and common app types are in `src/types.ts`. Backend and desktop integration code lives in `src-tauri/src/`, with book-source parsing in `book_source/`, SQLite access in `db/`, local import logic in `local_book/`, IPC handlers in `commands.rs`, and the embedded server in `server.rs`. The `app/` directory is the legacy Android compatibility reference.

## Build, Test, and Development Commands

- `pnpm install`: install Node dependencies from `pnpm-lock.yaml`.
- `pnpm dev`: run the Vite frontend dev server.
- `cargo tauri dev`: run the full desktop app in development.
- `pnpm build`: type-check TypeScript and build the frontend bundle.
- `cargo tauri build`: create release bundles under `src-tauri/target/release/bundle/`.
- `pnpm lint` / `pnpm lint:fix`: run or auto-fix ESLint issues in `src/`.
- `pnpm format`: format TypeScript and React files with Prettier.
- `cd src-tauri && cargo test`: run Rust tests when present.

## Coding Style & Naming Conventions

Use TypeScript `strict` mode and the `@/*` path alias for frontend imports. React components and page files use PascalCase, such as `Bookshelf.tsx`; hooks, helpers, and variables use camelCase. Prettier enforces 2-space indentation, semicolons, single quotes, trailing commas where valid in ES5, LF endings, and a 100-column print width. Rust code should follow standard `rustfmt` formatting and snake_case module names.

## Testing Guidelines

No JavaScript test runner or test script is currently configured. For frontend changes, run `pnpm build` and `pnpm lint` at minimum. For Rust changes, add focused unit tests beside the module being changed and run `cd src-tauri && cargo test`. Prefer test names that describe behavior, for example `parses_txt_chapters_with_chinese_headings`.

## Commit & Pull Request Guidelines

Recent history uses concise prefixes such as `docs:` and `feat(desktop):`, plus issue-linked maintenance commits. Prefer `type(scope): summary` for new commits, and include issue numbers when relevant. Pull requests should describe the user-visible change, list verification commands, link related issues, and include screenshots or short recordings for UI changes.

## Security & Configuration Tips

Do not commit local databases, generated bundles, or `src-tauri/target/`. Treat Android assets and schemas in `app/` as compatibility references unless a task explicitly updates them. For structural code questions, prefer CodeGraph if initialized; use `rg` for literal text searches.

## Agent Skills Routing

This project ships 24 production-engineering skills under `.agents/skills/` (gitignored; installed locally from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)). When a task matches one, you MUST invoke it via the `skill` tool and follow its workflow exactly. Do not implement directly when a skill applies.

### Intent → Skill mapping

- New feature / new functionality → `spec-driven-development`, then `planning-and-task-breakdown`, then `incremental-implementation` + `test-driven-development`
- Vague requirement / "let's brainstorm" → `interview-me` or `idea-refine`
- Bug / failed test / unexpected behavior → `debugging-and-error-recovery`
- Refactoring / "make this cleaner" → `code-simplification`
- Code review / PR review → `code-review-and-quality`
- API or module boundary design → `api-and-interface-design`
- UI / component work → `frontend-ui-engineering`
- Performance concerns → `performance-optimization`
- Security review / auth / secrets → `security-and-hardening`
- Git / commit / branch strategy → `git-workflow-and-versioning`
- Release / deploy / rollout → `shipping-and-launch`
- Removing old code / migration → `deprecation-and-migration`
- Telemetry / logging / metrics → `observability-and-instrumentation`
- Pipeline / CI changes → `ci-cd-and-automation`
- Architecture decision / docs → `documentation-and-adrs`

### Lifecycle (implicit, no slash commands)

DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP. Always finish the earlier phase's required artifact (spec, plan, tests) before moving on. Never skip steps with "I'll add tests later" or "this is too small for a spec".

For the full ruleset and rationale see `.agents/SKILLS_AGENTS.md` (upstream's OpenCode-tuned AGENTS.md). Specialist personas live in `.agents/agents/`, shared checklists in `.agents/references/`.
