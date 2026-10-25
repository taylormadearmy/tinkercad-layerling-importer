# Compatibility and release checks

## Version 0.2.5 checks, 24 October 2026

Version 0.2.5 preview was published on 24 October 2026. It adds empty-placeholder evaluation and spatial notes, without experimental native-shape conversion. All 69 Node, 16 Python and eleven release regressions pass. Nineteen synthetic assemblies match browser and Python documents and exact mesh bytes in eager and lazy modes. Both packages pass integrity and allowlist checks, and the source package passes its portable checks after extraction. The bookmark URL is 62,035 characters.

A separate local test used Layerling's actual reader and writer at `99e8d21139d07ac4109dc3b74ed6333c04a45e16`. Note text, IDs and world coordinates survive open, save and reopen for one complete project and its split projects. This test runs in Node. Visual browser checks and the reporter's actual Honeycomb Grid retry remain outstanding.

## Support level

Version 0.2.5 is a preview for desktop browsers. A user has reported successful direct conversion. Automated checks run on Windows and Linux; they do not establish Safari, Firefox or mobile compatibility. Browser-engine and Layerling save/reopen checks must be recorded separately below as they are completed.

The bookmark uses modern JavaScript, Web Crypto, Blob downloads and Tinkercad's undocumented editor tools. Browser policies can block bookmark installation, console pasting or automatic downloads. A persistent download link is provided when automatic download does not start. Large designs depend on available memory.

## Automated evidence

- Version 0.2.4 has 14 Python regressions, 63 Node regressions and eleven release-boundary regressions covering evaluated geometry, normals, color inheritance, duplicate surfaces and winding, progress, retry, disposal, capture failure, cancellation and lossless compression with an uncompressed fallback.
- 18 synthetic assemblies compare browser and Python project documents and mesh bytes.
- Source ZIP contents and checksums are verified; portable checks rerun from the extracted source ZIP.
- The offline ZIP and hosted site share identical installer bytes.
- Release checks cover tag validation, external hashes and rejection of unexpected or unsafe archive entries.
- Six release regressions include the draft-release lookup that failed during the initial launch attempt.

Run the commands in CONTRIBUTING.md to reproduce these checks. Simulated page tests do not exercise an actual browser engine. Stored-geometry comparison does not prove the current Layerling renderer displays it correctly.

## Hosted preview checks — 21 October 2026

The v0.2.1 release and Pages deployment completed successfully. All four CI combinations passed: Windows and Linux, each with Python 3.10 and 3.13 and Node.js 22.

Unauthenticated HTTPS requests verified both release ZIP hashes, all three hosted files against the browser ZIP, and the source, issue and compatibility links.

Chrome 155.0.8059.80 on Windows (build 26300) displayed the correct version, executed the complete 62,782-character bookmark link and showed the expected wrong-page guard, showed the missing-file validation message, and downloaded the offline edition.

Bookmark installation and capture from the live Tinkercad editor, JSON file conversion in a real browser, and Layerling open/ungroup/save/reopen remain independently unverified for this release. The successful simulated capture/conversion tests and user-reported imports do not replace these checks. Edge, Firefox, Safari, macOS, Linux desktop browsers and mobile browsers have not been manually verified.

## Manual release checklist

### 22 October 2026 — v0.2.2 instruction update

The instruction update passed all four CI combinations and its release and Pages deployment completed. Public HTTPS checks verified both ZIP hashes and equality of all three site files with the offline ZIP.

Chrome 155 on Windows displayed the revised setup steps. The optional JSON converter accepted a synthetic assembly, completed conversion, downloaded its `.lyl`, and downloaded a second copy through the retry link. Independent verification of the actual browser download checked four stored meshes and five nodes with zero measured vertex error. The exporter and conversion code are unchanged from v0.2.1.

Layerling open, Ungroup, save and reopen remain independently unverified: the browser automation environment did not expose Layerling's file picker. These checks are still required before claiming the full editing round trip. Live Tinkercad bookmark installation/capture and other browser configurations also remain unverified.

### 22 October 2026 — local v0.2.3 candidate

The user reports that the evaluator-fix bookmark captures the supplied previously failing design and its project opens in Layerling. These are user-reported results. The subsequent compression-enabled bookmark and final review fixes have not yet been independently exercised in Chrome. The current generated bookmark URL is over 72,000 characters; installation limits remain a manual check.

The updated ZIP writer was exercised under Node on that actual download. The compressed archive retains identical contents for all 145 entries, including every mesh asset; it reduces this particular file from 115.4 MB to 20.6 MB. This is a file-size result, not an editing-speed or peak-memory measurement. The subsequent memory candidate reads direct-export meshes on demand and compresses each unique binary asset immediately; JSON inputs and compressed output still need memory. This change has not yet been verified on the newly supplied failing design.

Layerling's current viewport renderer skips part-colour reconstruction for grouped meshes above 300,000 triangles. The supplied design's outer group exceeds this limit and the user reports a monochrome appearance despite retained colour metadata. Ungrouping the outer group once may expose smaller groups with their colours; this workaround remains unverified. Do not falsify triangle counts, simplify meshes or replace boolean groups to bypass the limit.

No candidate commit, push or release has been made. Layerling Ungroup/save/reopen and other browser configurations remain unverified.

### Checklist

Record browser/version, OS, date and result for each completed check:

- Install the bookmark from the hosted HTTPS page.
- Capture without changing the source, including the first-use reload.
- Observe progress, download and retry.
- Convert an earlier JSON capture from the install page.
- Open a disposable result in Layerling, ungroup a copy and inspect operands.
- Save to a new file, reopen and compare.

Unrecorded checks remain unverified. Do not extend support claims from a single browser to other platforms.


### 22 October 2026 — crash diagnostic candidate

A supplied video confirms a full Chrome Out of memory renderer crash during a 42,737-part export. It reaches at least mesh 136 before the crash. This does not prove that compression alone is responsible. No saved project was produced, and real-design success is still not established.

Added bounded local diagnostics: at most sixty checkpoints, normally persisted no more than once per 750 milliseconds, with extra checkpoints before planned allocations of at least 32 MiB. Reports contain phase, logical buffer/output sizes, observed source geometry buffer bytes, counts and browser JavaScript heap estimates where available. Observed geometry bytes are cumulative buffers encountered, not a live browser-memory total. Heap estimates are not total renderer/process memory. No geometry, model names, object IDs, URLs or share codes are recorded.

A recovered unfinished run offers Download failure report before retrying; no second export starts automatically. Storage failures do not prevent normal export. Four simulated-browser regressions check recovery, explicit retry, report sanitization, bounded history and unavailable storage. Real-browser crash recovery is pending and storage availability can vary. Nothing from this candidate has been committed, pushed or published.


### Geometry timeout follow-up (local candidate)

The user reports a handled geometry timeout after a long run, with no observed tab crash. This does not establish low peak memory or successful completion. The prior per-part timeout was 20 seconds. The candidate waits up to 120 seconds, polls the existing evaluation without restarting it, shows elapsed time every five seconds and retains Cancel. Diagnostics include wait duration, deadline and callback/Promise completion signals. A longer deadline is an investigation aid; the source evaluator may still stall. Handled errors now offer a report immediately without automatically downloading it or a partial project. Fake-clock regressions check successful completion beyond 20 seconds, final timeout/cleanup, and the report download on a handled error. Real-design verification remains pending.


### Assembly export and update prototype (local candidate)

The local build offers complete-root assembly sets with default targets of 100 MiB expanded unique mesh bytes, one million referenced triangles and 1,500 nodes. Targets are not guarantees; indivisible construction groups remain complete and carry explicit warnings. The single ZIP includes a manifest and independently openable numbered projects with unchanged coordinates, parent relationships, hidden operands and mesh data. Automated tests validate exact node/asset retention and cancellation while choosing or checksumming an assembly. Large individual groups and final ZIP/Blob memory limits remain practical constraints.

The installed version comes from VERSION. Version checks use fixed public metadata without design data, credentials or referrer. The optional online loader uses a fixed hosted script, protects active exports and shows unavailable/blocked behavior. Its live editor compatibility is unverified, and the supporting static files have not been published. The offline bookmark remains self-contained. Generated runtime and version metadata are verified against source; legacy three-file rollback removes newer runtime files.

Layerling's current Insert design source retains placement when adding a saved project, but live multi-project insertion, save/reopen and real-bookmark execution remain pending. No cross-browser support or measured performance improvement is established by simulated tests.


### Reader-limit review/fix cycles (23 October 2026)

The local candidate now enforces the current upstream reader limits in addition to its soft assembly-grouping targets: 512 MiB compressed, 1 GiB expanded, 256 MiB per asset, 64 MiB project JSON, 4,096 archive entries, and state/node/feature/mesh-array count limits. Final metadata bytes and final compressed bytes are measured. Independent roots are subdivided further if needed. An indivisible over-limit construction is retained as a preservation ZIP under needs-attention, with exact failure reasons, not labelled as an importable .lyl. All operands and geometry remain.

The second pass corrected ZIP MIME/labels and the saved-JSON assembly fallback. Exact-boundary, further-subdivision, preservation-geometry, invalid-single rejection, blocked UI summary and saved-JSON download regressions pass alongside cancellation and prior geometry checks. This corrects the earlier assumption that compressed-size and soft grouping targets alone were enough. The transport ZIP is not itself a Layerling project and may exceed 512 MiB; users must extract it. Passing known file/count limits does not establish acceptable renderer performance or a completed live import.


### v0.2.3 release verification — 23 October 2026

All 84 automated checks pass locally. Eighteen synthetic assemblies match Python in eager and lazy modes, including exact mesh bytes and ZIP CRCs. Source/browser allowlists, hashes, ZIP integrity and portable checks from the extracted source pass. The final self-contained bookmark URL is 124,607 characters; its installation and execution remain unverified. Earlier candidate results above are historical and do not establish final-browser compatibility.

The user reports successful export of the previously failing large design. Assembly partitioning preserves complete construction subtrees and placement. Passing reader-limit checks does not establish live Layerling loading/editing, Insert alignment or save/reopen. The optional online loader and update check remain experimental until exercised in the authenticated editor. No other-browser support or measured editing-speed improvement is claimed.


### Firefox bookmark size fix — 23 October 2026, v0.2.4

A reporter could save the earlier bookmark in Firefox but could not drag/save v0.2.3. Its self-contained URL grew from 62,782 characters in v0.2.2 to 124,607 in v0.2.3. Mozilla documents a 65,536-character saved URL limit (https://bugzilla.mozilla.org/show_bug.cgi?id=2000525#c3). This provides a strong explanation for the reported installation regression; no live reproduction on the reporter's build has been made.

The build now uses pinned Terser 5.44.0 to remove comments/whitespace and shorten local variable names, with compression rewrites and property renaming disabled. The self-contained v0.2.4 bookmark is 59,713 characters and needs no new browser API or network loader. Both generated bookmarks are rejected at build time if they exceed 65,536 characters. Exact-boundary/overflow and URL-encoding checks cover the builder. The size regression failed against v0.2.3 before the fix.

Browser regressions run the actual compact bookmark, including conversion/download, progress, errors and cancellation. Eager/lazy parity now also executes its definitions rather than the unminified converter alone. All 88 automated checks pass, with 18 exact synthetic parity assemblies. Firefox UI access timed out during the attempted live check; actual bookmark installation and live-editor capture remain unverified. The optional online loader remains experimental. The new Chrome report cannot be diagnosed until the reporter uploads the missing failure JSON/error directly on GitHub.

Build follow-up: Linux freshness CI exposed Windows locale encoding of minifier input. A Unicode round-trip regression failed before setting explicit UTF-8 subprocess encoding and now passes. Generated compact code preserves its original text consistently across platforms.


### Failure locator and detailed report — 25 October 2026, v0.2.6

All 74 Node, 16 Python and eleven release regressions pass. Nineteen eager/lazy parity assemblies preserve exact project documents and mesh bytes. Source/browser allowlists, hashes, ZIP CRCs and portable checks from extracted source pass. The self-contained bookmark is 65,486 characters, below the enforced 65,536-character limit.

Tests execute the generated compact bookmark and cover bounded ancestry, selection checks, detailed-report download/cleanup and normal-report privacy. Real Tinkercad selection and detailed-report download remain unverified. This diagnostic feature is not a confirmed fix for the Honeycomb generator timeout.
