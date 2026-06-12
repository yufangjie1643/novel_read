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

## Android Real-Device Testing

The toolchain lives at `D:\code\novel_read\.android-tools\` (gitignored). Layout:

```
.android-tools/
├── java/temurin-17/                    Temurin OpenJDK 17.0.19
├── sdk/                                Android SDK (cmdline-tools, build-tools 35, platforms 35+36, NDK r25b, platform-tools)
├── llvm-18/                            LLVM 18 (host clang + libclang.dll)
└── adb-scrcpy/                         adb.exe + scrcpy.exe + .dlls
```

### One-time env setup (PowerShell, current user scope)

```powershell
$root = "D:\code\novel_read\.android-tools"
[Environment]::SetEnvironmentVariable("JAVA_HOME", "$root\java\temurin-17", "User")
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$root\sdk", "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "$root\sdk", "User")
[Environment]::SetEnvironmentVariable("ANDROID_NDK_HOME", "$root\sdk\ndk\android-ndk-r25b", "User")
[Environment]::SetEnvironmentVariable("LIBCLANG_PATH", "$root\llvm-18\bin", "User")
[Environment]::SetEnvironmentVariable("CC_aarch64_linux_android", "$root\sdk\ndk\android-ndk-r25b\toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe", "User")
[Environment]::SetEnvironmentVariable("BINDGEN_EXTRA_CLANG_ARGS", "--target=aarch64-linux-android24 --sysroot=$root/sdk/ndk/android-ndk-r25b/toolchains/llvm/prebuilt/windows-x86_64/sysroot", "User")
```

Add to PATH (front of `$env:Path` for current shell):
`$root\java\temurin-17\bin;$root\sdk\platform-tools;$root\sdk\cmdline-tools\latest\bin;$root\sdk\build-tools\35.0.0;$root\llvm-18\bin`.

### Build a debug APK for arm64

```powershell
# 1. Cargo cross-compile (produces liblegado_desktop_lib.so)
cd D:\code\novel_read
cargo tauri android build --debug
# The symlink step will FAIL on Windows ("Creation symbolic link is not allowed for this system").
# That's expected — do step 2.

# 2. Copy the .so manually (Windows can't symlink; -x flag bypasses the symlink step)
Copy-Item `
  "src-tauri\target\aarch64-linux-android\debug\liblegado_desktop_lib.so" `
  "src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\liblegado_desktop_lib.so" `
  -Force

# 3. Gradle — skip every rustBuild* task (they call tauri-cli which panics
#    on "failed to build WebSocket client" when not driven by `cargo tauri
#    android build`). The prebuilt .so is already in place.
cd src-tauri\gen\android
.\gradlew.bat assembleDebug `
  -x app:rustBuildArm64Debug `
  -x app:rustBuildArmDebug `
  -x app:rustBuildX86_64Debug `
  -x app:rustBuildX86Debug `
  -x app:rustBuildUniversalDebug

# 4. Output: src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
```

### Install + launch on device

1. Connect device via USB, accept the "Allow USB debugging" dialog.
2. On the device, open **Settings → Additional settings → Developer options → USB debugging (security settings)** and enable **Install via USB** (tap "I know the risk" on the warning). This is a Xiaomi/MIUI requirement; without it, `adb install` returns `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user` regardless of the APK signature.
3. Install and launch:

```powershell
$adb = "D:\code\novel_read\.android-tools\sdk\platform-tools\adb.exe"
& $adb -s <device-serial> install -r "src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk"
& $adb -s <device-serial> shell monkey -p io.legado.desktop -c android.intent.category.LAUNCHER 1
& $adb -s <device-serial> exec-out screencap -p > device-shot.png
```

### Verify the P0/P1/P2 invariants on the live DB

The debug APK is debuggable, so `run-as` can read the SQLite DB. `sqlite3` is NOT on Windows by default; use the one shipped in NDK (`toolchains\llvm\prebuilt\windows-x86_64\python3`) only for Python — for SQL queries, download `sqlite-tools-win-x64-*.zip` from sqlite.org and put `sqlite3.exe` on PATH.

```powershell
$adb = "D:\code\novel_read\.android-tools\sdk\platform-tools\adb.exe"
& $adb -s <device-serial> exec-out "run-as io.legado.desktop cat ./legado.db" > device-legado.db
& $adb -s <device-serial> exec-out "run-as io.legado.desktop cat ./legado.db-wal" > device-legado.db-wal
& $adb -s <device-serial> exec-out "run-as io.legado.desktop cat ./legado.db-shm" > device-legado.db-shm

sqlite3 device-legado.db "PRAGMA journal_mode"            # P0: must be "wal"
sqlite3 device-legado.db ".tables"                          # P1: 21 tables
sqlite3 device-legado.db "SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"  # P0: ~12 indices
sqlite3 device-legado.db "SELECT COUNT(*) FROM rss_sources; SELECT COUNT(*) FROM rule_subs"  # P0: seed
```

The app stores the DB at `/data/data/io.legado.desktop/legado.db` (= `Context.getFilesDir()`); `-wal` and `-shm` are siblings.

### Known gotchas (worked around in the workflow above)

- **`use tauri::Manager` is gated `cfg(not(android))` in `src-tauri/src/lib.rs`.** `app.manage(app_state)` then fails to compile for Android with "no method named `manage` found for &mut tauri::App". Always import `Manager` outside the cfg-gated block. The P2 spec missed this; only the cross-compile surfaces it.
- **Windows symlinks** fail with "Creation symbolic link is not allowed for this system." Tauri expects to symlink `liblegado_desktop_lib.so` into `jniLibs`. Workaround: copy the file manually, then skip the rustBuild* Gradle tasks (they'd otherwise symlink/copy again).
- **tauri-cli 2.11.2 `android-studio-script` panics** with "failed to build WebSocket client" when invoked outside `cargo tauri android build` (e.g. via Gradle directly). The CLI expects a parent process to be running an options-server and write `{identifier}-server-addr` into `$TEMP`. Don't run `gradlew assembleDebug` without first going through `cargo tauri android build`, or skip all rustBuild* tasks as documented.
- **`rquickjs-sys` Android build** uses bindgen and needs the NDK sysroot for `<stdio.h>`. The `BINDGEN_EXTRA_CLANG_ARGS` env var pointing at `$NDK_HOME/.../sysroot` is mandatory.
- **Xiaomi "Install via USB"** is separate from regular USB debugging. Without it, every ADB install returns `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user` even with `pm install`, fresh keystore signing, or any `appops` workaround.

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
