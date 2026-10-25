# Repository instructions

Maintain the read-only Tinkercad exporter and local Layerling converter. Never modify source designs. Keep private captures and generated projects out of Git. Publish only when requested.

## Source layout

- `tinkercad-import/bookmarklet.template.html`: installer and capture code.
- `tinkercad-import/browser-convert.js`, `browser-ui.js`: browser converter and progress UI.
- `tinkercad-import/convert.py`: standard-library reference converter.
- `tools/build_browser.py`: embeds the sources and VERSION in generated `bookmarklet.html`.
- `tools/package_release.py`: explicit source allowlist, offline ZIP, static site and checksums.
- `tools/release.py`: draft preparation and publication from verified assets.

Run the commands in CONTRIBUTING.md when verification is requested. Change source files, then regenerate HTML. Do not edit generated HTML directly. Keep the Status, Findings and TODO sections current after meaningful work.

## Status

Current published preview is v0.2.6, adding a failing-part locator, group path and separate detailed report. The self-contained bookmark is 65,486 characters, below Firefox's enforced 65,536 limit. All 101 local regression checks and four Windows/Linux CI jobs pass. Public ZIPs and all five hosted files match audited assets. Live Tinkercad locator/report verification and the reporter's Honeycomb retry remain outstanding. Earlier entries below are historical evidence.

Version 0.2.3 is in development for large-design failures. Fixed mixed geometry-evaluation completion contracts, added Cancel and a bounded scrollable panel, stopped at first capture failure, and removed intermediate mesh arrays. User reports successful capture of the supplied Kyogre reproduction. Added lossless native browser ZIP compression with STORE fallback; verified all 145 entries of its 115,366,065-byte download remain identical in a 20,575,980-byte archive written by the new ZIP writer under Node. 37 Node and 14 Python tests pass. Eighteen synthetic assemblies plus the private reference retain exact mesh bytes and zero stored vertex error. Nothing published.

Version 0.2.2 instructions published: one-time setup, bookmarks-bar shortcuts, drag instructions, per-design export, download location and common problems. Windows/Linux CI and release deployment passed. Real Chrome JSON conversion and download retry passed; four meshes match the source with zero measured vertex error. Export code is unchanged.

Version 0.2.1 preview published with HTTPS Pages hosting. Windows/Linux CI, exact release asset checks and hosted delivery checks pass. See docs/browser-release-checks.md for the limited Chrome verification.

## Findings

The Kyogre archive contains 144 mesh assets, 829 scene nodes, 30 groups and 1,590,228 stored triangles. Compression reduces download size without simplifying geometry or removing editable operands; it does not establish faster Layerling editing. The native compression path still needs a real Chrome bookmark run and Layerling open/save verification. Native compression uses DEFLATE ZIP method 8; unsupported constructors/formats fall back to STORE. Compression errors must reject, and cancellation must interrupt pending stream reads.

Tinkercad's legacy evaluators return Promises, CSG evaluators can use callbacks, and generator evaluators may treat their first argument as geometry parameters. Never assume every evaluator accepts or invokes a completion callback. Observe geometry availability and asynchronous failures as well as callback completion.

User-facing setup should explain browser actions without mentioning developer tools or installation dependencies. Keep optional JSON and console paths collapsed.

Tinkercad capture depends on undocumented editor tools. Imported geometry is editable mesh geometry, not recovered sketches. Browser and Python writers must preserve the same evaluated surfaces.

The REST release-by-tag endpoint does not resolve unpublished drafts. Resolve drafts through the CLI, then request asset metadata by release ID.

## TODO

Verify the new compressed download through the Chrome bookmark and Layerling open/Ungroup/save/reopen. The user-reported timeout reproduction now exports successfully; independent source-capture comparison for that design remains unavailable. Cancellation coverage includes a never-resolving initial design-data request, pending geometry, late results, conversion, active compression and packaging including its final progress event. Memory checks remain structural; no measured speedup or peak-memory reduction is claimed.

Record additional browser compatibility results as they are tested.

Complete independent live-editor capture and Layerling open/Ungroup/save/reopen checks before expanding support claims. Layerling's file picker was not exposed by the automation environment.


## Colour display investigation

### Status
User reports the Kyogre export appears monochrome. Archive inspection confirms thirteen colours and multicolor=true remain. No exporter code changed for this diagnosis.

### Findings
Current Layerling WorkplaneViewport.tsx has PART_COLOR_TRIANGLE_LIMIT = 300,000 and skips colour reconstruction for imported group meshes above it. The Kyogre outer group has 408,438 triangles and therefore uses the group colour; every descendant mesh is below the threshold. Import restoration preserves the colour flag and child data. Never falsify triangleCount or silently change boolean groups into bundles to work around this limit.

### TODO
Confirm that ungrouping the outer group once restores the expected appearance. An automatic solution needs either a deliberate alternative representation or an upstream renderer change; preserve geometry and boolean operands by default.


## Pre-push review — 22 October 2026

### Status
Reviewed pending v0.2.3 exporter, converter, cancellation UI, native compression, generated page, regression harness, parity runner and release boundaries. Fixed two reproduced issues: a large individual mesh could finish expansion before the Cancel event ran; arbitrary compressor constructor failures were silently treated as unsupported format. Their regressions failed before the fixes and pass afterward. Added cancellation checks during chunked JSON encoding, yielding during reflection correction, and troubleshooting for the upstream colour limit. No commit, push or publication.

### Findings
There are 37 Node, 14 Python and six release regressions. Nineteen parity assemblies including the private reference match documents and exact mesh bytes; the reference retains 537 verified meshes / 594 nodes / zero maximum stored vertex error. Native compression fallback is restricted to absent APIs or unsupported-format TypeError; other constructor and stream errors reject. The generated bookmark URL is 72,526 characters.

Chrome's browser URL policy rejected acquiring the local file installer tab. The review did not bypass it or attempt an alternate route. Final native-browser checks therefore remain manual; simulated DOM and Node stream checks are not a browser-engine result. The known upstream 300,000-triangle group colour limit remains documented; no geometry or group semantics were changed to bypass it.

### TODO
Final source/browser ZIP allowlists, hashes, integrity and extracted-source checks pass. Before publication, check the final compression-enabled bookmark in Chrome and check a disposable compressed project through Layerling open/Ungroup/save/reopen. Keep source captures and generated projects outside the public package.


## Direct-export memory candidate — 22 October 2026

### Status
User supplied another failing design and confirmed out-of-memory occurs while exporting from Tinkercad. Inspected the open editor read-only; no source object was changed. The share-code URL and any design data are private and are not included in this repository.

Direct export now supplies a lazy mesh reader to conversion instead of retaining every expanded capture. Each mesh is captured into fixed-size Float64 buffers, converted and compressed before the next unique asset. Surface duplicate checking retains IDs/bounds rather than all prior meshes/signatures; it rereads candidates only when needed, and skips a baked root with no sibling surface. Optional diagnostic JSON still serializes standard arrays in chunks. No geometry simplification or operand removal.

40 Node, 14 Python and six release regressions pass. Browser/Python parity checks both eager JSON and lazy typed-buffer paths for 18 synthetic assemblies plus the private reference; exact asset bytes match and reference geometry remains zero-error. The final generated URL is 75,279 characters. Mirrored the candidate to the local development installer; no commit, push or publication.

### Findings
A private synthetic test with 40 meshes / 2,000,000 triangles fails with heap exhaustion under the pre-change exporter at a 96 MiB V8 old-space cap. The candidate completes under the same cap. Independently verified the downloaded synthetic archive: all forty assets have correct hashes and exact expected mesh bytes. This is a synthetic heap-cap test, not a measurement of total browser memory or proof that the new supplied design works.

Tinkercad's loaded scene, individual meshes, duplicate comparison scratch data and retained compressed output still require memory. Missing native compression falls back to STORE and can retain a larger binary output. The final `.lyl` is still assembled as a Blob; this is not disk streaming or a universal memory bound. Existing JSON input conversion still reads the whole input. Wait until export finishes before editing the source design.

### TODO
Final package audit passes: source/browser allowlists, hashes, ZIP integrity and extracted-source portable checks. User retried the supplied design and reports it still fails or crashes. Real success is not established. The existing browser tab is unresponsive to inspection; requested the last progress message or screenshot before another runtime change. Investigate the last stage if it still fails, especially individual geometry evaluation, overlap comparison or final output size. Keep share codes and captured projects out of public source and tests.


## Crash video and diagnostic build — 22 October 2026

### Status
Inspected the user-supplied recording privately. It confirms Chrome's full renderer Out of memory screen around 64–65 seconds into the recording, after successful initial metadata retrieval. Frame-by-frame inspection reaches at least Compressing mesh (136); a conversion frame shows 128/42,737 parts. The crash is not independently attributed to compression alone. The supplied design remains unfixed.

Added a bounded local diagnostic recorder and recovery panel. It persists phase, counts, logical buffer sizes, cumulative observed source geometry buffer bytes and browser heap estimates, with at most sixty samples and 750 ms throttling except status changes. Source buffer tracking uses WeakSet and does not retain geometry buffers. Recovery sanitizes fields and offers a JSON report before any explicit retry. No geometry, model names, object IDs, URLs or share codes are included. No network transmission. Storage failure does not stop conversion.

### Findings
The evidence rules out a crash before the initial design-data response on this attempt. It does not distinguish retained Tinkercad evaluator caches, current-mesh working buffers, compressor resources, cumulative output or other browser pressure. Previously passing synthetic tests are not proof of real-model success. No additional memory fix was selected without the diagnostic evidence.

### TODO
Portable checks pass: 44 Node, 14 Python and six release regressions; eager/lazy parity matches on nineteen assemblies including the private reference with zero stored vertex error. The diagnostic installer is mirrored locally; the generated URL is 84,491 characters. Final source/browser package allowlists, checksums, integrity and extracted-source checks pass. Ask the user to install it, reproduce the crash, reload Tinkercad and click the bookmark to download its recovered report. Browser automation cannot run the JavaScript bookmark or inspect the crashed renderer. No commit, push or publication until explicitly requested.


## Diagnostic report and compact metadata candidate — 2026-10-22

### Status
- User supplied the interrupted-run report and confirms full construction history is essential. No flattened/visible-only mode was implemented. All editable operands and boolean groups remain required.
- Read the local report: 42,737 parts, about 4.34 GB estimated JS heap at the starting checkpoint against a reported 4.40 GB limit. Last checkpoint has 50 processed parts, 3,756,681 packed output bytes, 950,112 current capture bytes and 18,124,440 cumulative observed source buffer bytes. Heap estimates are not total renderer memory and cannot establish an exact allocation cause.
- Replaced the direct export's heavyweight get_design_data call with a compact metadata traversal when the inspected scene-data getter contract is available. Copies only converter-required IDs/type, labels, colours, visibility, hole polarity, group mode and child hierarchy; numeric colours use Tinkercad's own cleanColor helper. No bounds/selection/camera/full parameter serialization. Saved-JSON export and unsupported scene API shapes retain the existing tool path. Unsupported descendants fail explicitly rather than dropping parts.

### Findings
- Premise under test: retained exporter mesh/output arrays are the principal cause. The tiny retained output and current mesh versus the already-high starting heap contradict that premise as a sufficient explanation. Loaded scene and Tinkercad evaluator/cache memory remain possible contributors; no source-owned geometry/cache is cleared or disposed.
- Compact traversal yields for cancellation every 128 nodes. Regression coverage verifies hidden operands, group types, hierarchy, colour normalization, no full tags/params serialization or general design-data tool call, lazy mesh access and cancellation before geometry access.
- 46 Node, 14 Python and six release regressions pass. Eager/lazy parity matches 19 assemblies including the private reference: 537 meshes, 594 nodes, zero stored vertex error. These tests do not establish success for the failing real design. Both local installers rebuilt; bookmark URL is 88,940 characters. No source-design change, commit, push or publication.

### TODO
- [ ] Retry the compact-metadata bookmark in a freshly reloaded Tinkercad tab and inspect its result/report. Confirm compact-metadata phase if it fails; browser automation cannot run the JavaScript bookmark.
- [ ] If initial heap remains near the limit, investigate the loaded source scene and evaluator resources without dropping construction history or mutating Tinkercad-owned objects.
- [ ] Independent real-design successful export and Layerling save/reopen remain outstanding. Do not claim the memory issue fixed from synthetic checks.


## Handled timeout and progress follow-up — 2026-10-22

### Status
- User reports a recoverable Geometry evaluation timed out error after a long run, with no observed out-of-memory crash, and asks for percentage/time progress. This is not proof of lower peak memory or successful export.
- Increased the per-part evaluation deadline from 20 to 120 seconds. Poll the same evaluation rather than restarting it; show elapsed waiting seconds every five seconds and retain cancellation. Added diagnostics for duration, deadline, Promise return/settlement and CSG callback receipt. Handled errors now offer Download failure report immediately, without automatic report or partial-project downloads.
- Added a parts-converted counter, percentage, progress bar and elapsed time. Percentage describes part count, not time or overall completion. Surface checks and packaging use an indeterminate bar; current-stage text remains visible. No unreliable remaining-time prediction. Elapsed timer stops on completion/disposal.

### Findings
- The previous no-report behavior was limited to handled errors: only interrupted-run recovery offered a report. The new handled-error regression exercises the actual JSON download and retry.
- A fixed 20-second deadline cannot distinguish a slow valid evaluation from a stalled evaluator. The two-minute limit is an investigation aid, not a proven repair of the supplied part. Fake-clock regressions show completion beyond 20 seconds without a second evaluation and proper timeout/timer cleanup when it never finishes.
- 49 Node, 14 Python and six release regressions pass. Full construction history remains required and preserved. Real-design verification is outstanding. No source design modification, commit, push or publication.

### TODO
- [ ] Retry the rebuilt bookmark on the supplied design. If it times out again, inspect the now-downloadable report and the affected evaluator rather than assuming increasing the deadline is sufficient.
- [ ] Confirm live progress rendering and timeout behavior in Chrome; bookmark URL is 94,846 characters and must be reinstalled.
- [ ] Preserve complete operands in any future batch/resume design; successful full export and Layerling save/reopen are still pending.

- Final verification: eager/lazy parity matches 19 assemblies including the private reference (537 meshes, 594 nodes, zero stored vertex error). Source/browser package allowlists, hashes, integrity and extracted-source portable checks pass. Generated installers match. Real live retry remains pending.


## Large export succeeds; splitting and updates discussed — 2026-10-22

### Status
- User reports the supplied large design exported successfully after the timeout/progress changes. Independently inspected ZIP metadata only: the downloaded .lyl is 1,412,419,678 bytes with 23,710 entries (23,709 mesh assets); total expanded entries are 8,981,175,193 bytes. The user's spoken 23 GB size is not the downloaded archive's measured size. No full CRC/geometry validation or Layerling open/edit success is established by this metadata read.
- User asks about automatic sensible splitting, version display, update detection and updates without reinstalling the bookmark. Discussion/recommendation only in this turn; no runtime change or publication.

### Findings
- Splitting should consider expanded mesh bytes, triangle/node counts and complete construction subtrees, rather than compressed download size alone. A giant boolean assembly cannot be arbitrarily divided into independent fully editable projects while preserving its parent operation. Relative/world placement can be retained; Layerling multi-project merge placement still requires verification.
- Embedded bookmark code cannot rewrite its saved browser bookmark. A small stable loader could fetch a current hosted exporter without recurring bookmark replacement, but editor CSP/network restrictions must be proven compatible first. A metadata-only version check may also be blocked and needs explicit unavailable/offline behavior; no design data should be sent. An extension is a separate packaging option with browser/store maintenance.

### TODO
- [ ] Inspect the successful project's hierarchy/geometry repetition before choosing split boundaries or promising file-size targets. Keep all private geometry local.
- [ ] Prove Layerling placement/merge behavior for split projects. Preserve full history, or clearly report any indivisible oversized group rather than silently flattening it.
- [ ] Add installed-version UI from VERSION if authorized for implementation; prototype hosted loader/version checking against actual Tinkercad policies before replacing the self-contained default.


## Complete assemblies and update controls — 2026-10-23

### Status
- User authorized all proposed implementation work: sensible assembly exports, installed-version display, update checks and a permanent-loader prototype. Implemented locally in the public maintenance checkout and mirrored the runtime and builder to the original installer. No commit, push, release or deployment performed.
- Added browser-assemblies.js: partitions only complete original scene roots using targets of 100 MiB unique expanded mesh bytes, one million referenced triangles and 1,500 nodes. Spatially orders roots for adjacent grouping. Emits unchanged scene nodes/assets/workspace with local feature/group/history references. Oversized indivisible groups stay intact and are flagged. No flattening, recentering or operand removal.
- Large-design panel offers smaller assemblies or one project after conversion. Smaller projects download together in one ZIP, with a manifest and README. Inner ZIP payloads are stored without recompression in the outer ZIP; Blob CRC reads are chunked, yield to events and support cancellation. Single-project JSON is serialized only if selected. Classic ZIP size limits remain enforced; there is no unbounded disk-streaming guarantee.
- Version is embedded from VERSION into the panel/runtime. A bounded metadata check requests only the fixed public version.json URL without credentials or referrer. A newer published version enables Run latest version after export. Optional experimental online bookmark loads the fixed importer.js URL each run with no referrer; busy exports are protected, duplicate loads suppressed, timeout/error cleanup and self-contained fallback are visible. It cannot rewrite an existing saved bookmark. Offline self-contained path remains supported.
- Static browser distribution now has five allowlisted files: index.html, importer.js, version.json, LICENSE.txt and README.txt. Source/runtime/version matching is checked. Rollback accepts legacy three-file bundles only on rollback and removes stale optional runtime/version files; two release regressions cover that boundary.

### Findings
- Live Layerling source inspection at c629f0a67542ad6bf5e2be644231355cfb34ef99 shows Import / Insert design adds shapes with fresh IDs and no translation. Its clone helper preserves coordinates and nested groups. This is source evidence, not a live multi-project UI round-trip. Normal Open opens another project; Insert is the relevant path. Reassembling all files restores the original geometry burden.
- Anonymous public Tinkercad root responses showed no CSP header. This does not prove the authenticated editor/frame policy permits a remote loader or metadata fetch. Available browser automation cannot execute/install JavaScript bookmarks and cannot claim the local file installer URL; no workaround was used. New hosted files are not public until a later authorized release, so the online prototype cannot yet work against the current v0.2.2 site.
- Generated self-contained bookmark is 117,655 characters; final Chrome installation/capture needs verification. The online bookmark is smaller but unverified in the live editor.
- Automated checks: 56 Node, 14 Python and eight release regressions pass. Synthetic assembly ZIPs retain every scene node, hidden cutter, parent relationship, coordinate and exact mesh bytes. Version checks, loader success/failure, choice cancellation, Blob checksum cancellation, runtime non-execution until invoked, and legacy rollback are exercised.

### TODO
- [ ] Verify the rebuilt self-contained bookmark in Chrome and choose smaller assemblies for a real direct capture.
- [ ] Open/Insert at least two split projects in Layerling, verify alignment, Ungroup, save and reopen. Do not claim live placement verification from source inspection alone.
- [ ] Test permanent loader/update detection on the actual authenticated editor after supporting static files are published with explicit authorization. Keep unavailable/offline behavior and self-contained fallback.
- [x] Finish parity/package checks and source review for this local candidate; publication remains a later action.

- Final assembly/update verification: 56 Node, 14 Python and eight release checks pass (78 total). Eager/lazy parity matches 19 assemblies including the private reference, with 537 meshes / 594 nodes / zero stored vertex error. Source/browser allowlists, checksums, ZIP integrity and extracted-source checks pass. Generated installers and runtime match between checkouts. Final real-bookmark, online-loader and Layerling UI checks remain pending.


## Reader limits and two review/fix cycles — 2026-10-23

### Status
- User reports the 512 MB Layerling file limit and requests a review/fix loop. Verified the current reader source: 512 MiB archive, 1 GiB expanded, 256 MiB per asset, 64 MiB project.json, 4,096 entries, 5,001 states, 100,000 nodes per state, 300,000 features and 30 million numbers per mesh array. Source: henmedia/layerling c629f0a67542ad6bf5e2be644231355cfb34ef99, apps/web/src/lib/lylProject.ts.
- Review/fix pass 1 added final reader-limit assessment, exact UTF-8 JSON and ZIP-byte checks, further subdivision of independent roots, safe rejection of incompatible single output and separate preservation archives for indivisible over-limit constructions. No incompatible output is labelled .lyl. Full construction data remains in the transport ZIP, with blocked reasons in its manifest. Known input-level violations disable Keep one project.
- Review/fix pass 2 corrected transport/project MIME types and completion labels, added the missing assembly choice to the saved-JSON fallback, froze reader limits and removed locale-dependent root ordering. Added regressions for boundaries, further splitting, preservation of hidden operands/parents, no unsafe final output, blocked UI choices/results and saved-JSON ZIP download.
- Mirroring, final parity and package audit are in progress. No Tinkercad source changes, commit, push or publication.

### Findings
- The earlier 44-project artifact was geometry/CRC-verified, not reader-limit-verified. Auditing the actual projects found three above the expanded limit; all were below the compressed limit. Their construction roots cannot be divided under the full-history requirement. They must not be advertised as ready projects.
- The corrected layout distinguishes reader-limit-compatible .lyl files from needs-attention/*.preserved-project.zip. Renaming a preservation file cannot remove a reader limit. The outer transport ZIP may exceed the per-project size limit and must be extracted. Passing file/count checks does not prove live loading, editing performance, alignment on Insert or save/reopen behavior.
- Current checks: 62 Node, 14 Python and eight release regressions pass (84 total). Final generated bookmark is 124,607 characters and still needs live installation verification.

### TODO
- [x] Finish eager/lazy parity, package integrity/extracted-source checks and installer mirroring for this candidate.
- [ ] Open a checked project in Layerling and exercise Insert, Ungroup, save and reopen. Three indivisible oversized constructions require a reader-limit or construction-structure change before they can open intact.
- [ ] Test online loader/update detection on published static files only after explicit publication authorization. No live or cross-browser guarantee yet.

- Reader-limit candidate final verification: 84 checks pass (62 Node, 14 Python, eight release). Eager/lazy parity matches 19 assemblies including the private reference (537 meshes, 594 nodes, zero stored vertex error). Generated HTML/runtime match both local checkouts. Source/browser packages are rebuilt and checked below; live bookmark installation, Layerling UI round trip and online loader remain unverified. No commit or publication.


## v0.2.3 release — 23 October 2026

### Status
User explicitly authorized commit, push, release and deployment. Preparing the reviewed large-design candidate through the existing verified-assets workflow.

### Findings
Previous local verification recorded 84 checks, exact eager/lazy geometry parity and source/browser package integrity. Final native-browser bookmark installation, authenticated-editor online loader and Layerling Open/Insert/Ungroup/save/reopen remain unverified; this release remains a preview.

### TODO
- [x] Complete portable and package checks: 84 checks pass; 18 synthetic assemblies match exact eager/lazy mesh bytes; extracted source/browser bundles pass integrity and allowlist checks.
- [x] Source-only commit 3c4ca79 pushed to origin/main; all four Windows/Linux Python 3.10/3.13 jobs passed (run 39935613414).
- [x] Draft preparation 39935837415 and publication/Pages deployment 39935921949 succeeded. v0.2.3 preview is public; all 35 packaged source files match the tagged commit, both public ZIP hashes pass, and all five HTTPS site files match the exact browser ZIP. HTTPS enforcement is enabled.
- Complete the remaining live browser and Layerling checks separately without broadening support claims.

### Published result
Version 0.2.3 was published and deployed on 23 October 2026 from 3c4ca79b606c5dbc40cd052f9e6afb16b7fc73c7. Public release: https://github.com/taylormadearmy/tinkercad-layerling-importer/releases/tag/v0.2.3 . Installer: https://taylormadearmy.github.io/tinkercad-layerling-importer/ . Installed self-contained bookmarks require replacement. Supporting runtime and version metadata are now public; authenticated-editor loader/update behavior and Layerling editing round-trip checks remain outstanding. No source design was modified.


## Firefox bookmark installation fix — 23 October 2026

### Status
User authorized repairing the oversized bookmark, asking the reporter for a direct diagnostic upload and releasing the correction. v0.2.4 keeps the self-contained default and adds pinned build-only Terser minification. Readable source, console script and online runtime remain available.

### Findings
The old regression fails at 124,607 characters; compact v0.2.4 is 59,713, within Firefox's 65,536-character saved URL limit. Compression rewrites and property renaming are disabled. All 88 local checks and 18 eager/lazy exact parity assemblies pass; parity runs compact bookmark definitions. Browser users need no installation or new API. Development/release builds require npm ci --ignore-scripts.

### TODO
- [x] Source/browser allowlists, hashes, CRC integrity and extracted-source checks pass. Corrected release source 122c316 pushed; all four CI jobs pass (39948378933).
- [x] v0.2.4 draft preparation (39948656494) and publication/Pages deployment (39948766669) succeeded. Public ZIP hashes and all five hosted files match the audited release. Posted the requested direct-upload reply to KimA998.
- Firefox UI access timed out; final native-browser installation/capture and Layerling editing round-trip checks remain unverified.

Build follow-up: Linux freshness CI exposed Windows locale encoding of minifier input. A Unicode round-trip regression failed before setting explicit UTF-8 subprocess encoding and now passes. Generated compact code preserves its original text consistently across platforms.

### v0.2.4 published result
Version 0.2.4 preview is published at https://github.com/taylormadearmy/tinkercad-layerling-importer/releases/tag/v0.2.4 and deployed at https://taylormadearmy.github.io/tinkercad-layerling-importer/ . Source commit 122c316fb4173cace5bcbd6bbfcbc3fa15210238. All 38 source files match tagged Git bytes; both ZIP external hashes/allowlists/CRC and all five hosted-file comparisons pass. The main bookmark remains self-contained and no native-shape conversion was added.

Reporter reply: https://github.com/henmedia/layerling/discussions/683#discussioncomment-19145027 . Await the actual Chrome error and JSON report; no Chrome export diagnosis is established by the missing email attachment. Final live Firefox installation/export and Layerling Open/Insert/Ungroup/save/reopen checks remain outstanding.

## Geometry readiness and spatial notes maintenance candidate — 24 October 2026

### Status
- User authorized a separate maintenance worktree based on published v0.2.4 source 122c316. This branch contains only the geometry-readiness and notes changes; experimental native conversion remains in the original development checkout. Version 0.2.5 is now published; see the release result below.
- Empty position/index placeholders now enter the existing bounded, cancellable evaluator path. Completed empty results fail explicitly without removing parts or operands.
- Direct and saved-JSON capture include spatial note text and world positions. Browser and Python converters emit Layerling scene notes with the same coordinate mapping as geometry. Invalid notes and reader note/text limits fail explicitly. Split exports assign each note once to the nearest original root, including further subdivision.

### Findings
- Focused tests failed before implementation with Invalid triangle positions, missing notes and missing rejection of over-limit notes. Initial fixed suite passed 68 Node and 16 Python regressions; 19 eager/lazy parity assemblies retain exact mesh bytes.
- An independent local test uses the actual Layerling reader and writer from upstream checkout 99e8d211. Single and split project notes retain text, IDs and coordinates through open/save/reopen. This is a Node file round trip, not visual browser verification.
- Captured Tinkercad notes are world-space informational text, not geometric bodies or source-body anchors. New notes open as collapsed pins. Layerling currently normalizes at most 200 notes and 2,000 UTF-16 code units per note; exporter refuses loss instead of relying on truncation. Older JSON captures without notes cannot recover them.

### TODO
- [x] Finish final regressions, parity, package integrity/extracted-source checks and self-review. All 69 Node, 16 Python and eleven release regressions pass. Nineteen eager/lazy parity assemblies preserve exact mesh bytes. Bookmark URL is 62,035 characters, below the enforced 65,536 limit. Source/browser packages pass allowlist, checksum and CRC checks, including portable checks from extracted source.
- [ ] Verify actual Tinkercad Honeycomb recovery with reporter's shared/minimal example and visual note capture/open/save/reopen in a browser. Do not claim the Volvo design fixed from synthetic tests.
- User explicitly requested commit and release, then authorized a discussion reply. Preparing this maintenance candidate for CI and the existing verified-assets publication workflow. Reply only after checking the hosted result; retain the actual-Volvo and visual-browser verification limits.


## v0.2.5 release result — 24 October 2026

### Status
- Source commit a36797e643edc1bd0d4a1d2ceb9df4cec7a00dd3 is published as v0.2.5 preview and deployed to GitHub Pages. All four CI jobs passed (40107507991), draft preparation succeeded (40107636578), and publication/deployment succeeded (40107766742).
- Posted the requested reply as taylormadearmy: https://github.com/henmedia/layerling/discussions/683#discussioncomment-19166225 . GitHub returned the exact expected body, author and permalink.

### Findings
- All 38 draft source files equal exact committed Git bytes; internal/external checksums, allowlists and ZIP CRCs pass. Unauthenticated downloads of both public ZIPs match those assets, and all five hosted files match the browser ZIP. Source, issue and release links respond successfully.
- Windows working-tree VERSION had CRLF while Git and Linux-produced source assets use LF. Asset audit compared exact Git blobs rather than treating checkout line-ending conversion as a release mismatch.

### TODO
- [x] Commit/push the maintenance changes, pass CI, audit draft assets, publish/deploy and check public HTTPS delivery.
- [x] Post the authorized reporter reply after delivery verification.
- [ ] Obtain the reporter's actual Honeycomb retry and complete visual browser note checks before expanding compatibility claims.

## Failure locator and detailed report — 25 October 2026

### Status
- User authorized implementation of a source-part locator, group path and optional detailed debugging. Implemented as local 0.2.6 on the isolated maintenance worktree; native-export development remains separate. No commit, push, release, discussion reply or source Tinkercad design change.
- Capture failures retain a bounded ancestry path. Locate failing part selects a top-level failure or its containing root through Tinkercad's selection tool, only after checking current identity, membership, visibility and SELECT lock state. It refuses moved, removed, hidden, locked, unknown or unsupported targets.
- A separate detailed-report click includes the error, names/IDs/type path, available geometry counts, source world origin and library/busy/error state. Standard reports and persisted checkpoints remain free of these details. Report URLs are released on replacement/close; closed controls cannot act.

### Findings
- Three initial regressions failed for missing group path, locator and detailed-report controls before implementation. All 74 Node, 16 Python and eleven release regressions now pass; nineteen eager/lazy assemblies match exact project documents and mesh bytes.
- Cached Tinkercad selection API handles only top-level shapes. SELECT is flag 128; implementations return boolean or numeric lock results. The locator accepts only false/0, never unlocks, reveals or ungroups, and verifies the resulting selection.
- Names/error text are bounded; paths retain at most 64 entries with an explicit omission marker. libraryAttached does not establish whether a separate library lookup can resolve the generator. Missing counts/coordinates remain absent.
- Generated help text was shortened to fit Firefox's unchanged 65,536-character limit; final bookmark URL is 65,486 characters. Minifier settings and geometry conversion are unchanged. The margin is small, so every further runtime change must rebuild and pass the size guard.

### TODO
- [x] Complete final source/browser package integrity and extracted-source checks. All package allowlists, hashes and ZIP CRCs pass; the extracted source passes all 74 Node regressions, 16 Python regressions and nineteen eager/lazy parity assemblies.
- [ ] Verify locator selection and detailed-report download in a real Tinkercad browser on a disposable hierarchy; simulated tests do not establish live API/browser compatibility.
- [ ] Investigate the supplied Honeycomb example independently. This diagnostic feature is not a fix for the generator timeout. Commit/publish only on a further explicit request.


### v0.2.6 publication authorized — 25 October 2026

- Status: user explicitly requested release and discussion reply. Preparing the tested diagnostic candidate through the existing CI, draft-asset audit and publication workflow.
- Findings: live Tinkercad locator behavior remains unverified; release notes and reply must retain that limit and must not claim the Honeycomb timeout fixed.
- TODO: commit/push, pass exact-commit CI, audit and publish/deploy v0.2.6, verify public delivery, then reply on Discussion #683.


## v0.2.6 release result — 25 October 2026

### Status
- Published v0.2.6 preview from source commit dbd881ddad079b7b0493123e0e9a2efc32c2cb0d and deployed the same browser files to Pages. All four CI jobs passed (40217653185); preparation (40217834276) and publication/deployment (40217917284) succeeded.
- Posted and verified the requested reply as taylormadearmy: https://github.com/henmedia/layerling/discussions/683#discussioncomment-19181700 .

### Findings
- All 38 source files match exact committed Git bytes. Package allowlists, hashes and ZIP CRCs pass. Unauthenticated public ZIP downloads match audited assets; all five hosted files match the browser ZIP. Source, issue and release links respond successfully.
- The reply explains updating the bookmark, locating the containing group, reviewing the optional detailed report and the live-verification limits. No source Tinkercad geometry changed.

### TODO
- [x] Commit/push, pass CI, audit assets, publish/deploy, verify public delivery and post the authorized reply.
- [ ] Verify live locator selection/report download and investigate the supplied Honeycomb example before claiming the timeout fixed.
