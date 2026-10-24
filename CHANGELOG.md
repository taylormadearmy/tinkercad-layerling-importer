# Changelog

## Unreleased — Explicit partial export

- Keep export all-or-nothing by default when Tinkercad cannot evaluate geometry.
- Offer an explicit choice to continue after the first geometry failure.
- Omit failed parts and any affected Boolean group, and report the error count.

## 0.2.5 — Preview — 24 October 2026

- Evaluate empty geometry placeholders instead of immediately rejecting them as invalid triangles. Persistent empty results still stop export with a clear error; no part or operand is discarded.
- Preserve spatial note text and world positions through direct export, saved JSON and the Python converter. Notes open as collapsed pins, without a body anchor.
- Assign each note once to the split project with the nearest original construction-root centre. Original note positions remain unchanged.
- Stop explicitly for invalid notes or notes exceeding Layerling's 200-note or 2,000-character limits instead of silently losing text. Some Unicode characters count as two toward the text limit.

Synthetic capture regressions cover the empty-placeholder failure. The reporter's actual Volvo design still needs a retry; this is not a confirmed fix for that design.

## 0.2.4 — Preview — 23 October 2026

- Fix Firefox bookmark installation by minifying the self-contained bookmark below its 65,536-character saved-URL limit. Version 0.2.3 exceeded this limit.
- Fail builds when either generated bookmark exceeds the limit, and execute the compact bookmark in browser regressions and geometry parity checks.
- Keep readable sources and the full console troubleshooting script. Minification adds a pinned build-only dependency; browser users need no installation or new runtime feature.
- Remove the outdated message that the experimental online runtime has not been published. Its live editor compatibility remains unverified.

Refresh the setup page and replace the saved bookmark. Export geometry and construction-history behavior are unchanged.

## 0.2.3 — Preview — 23 October 2026

- Observe Promise-based, callback-based and asynchronous geometry evaluation.
- Stop on the first capture failure with the affected part's name and identity.
- Allow cancellation during capture, large-mesh expansion, JSON encoding, conversion and packaging; keep the progress panel scrollable.
- Report captured parts and triangle counts; show parts-converted percentage, a stage-aware progress bar and elapsed time without predicting remaining time.
- Compress project downloads losslessly using browser compression when available, with an uncompressed fallback.
- Read direct-export meshes on demand, use packed Float64 capture buffers, and compress each unique asset before reading the next mesh. Duplicate comparisons retain metadata instead of every raw mesh and signature.
- Explain Layerling's large-group colour-display limit and a possible Ungroup workaround.
- Save bounded local diagnostic checkpoints and offer reports for handled failures as well as interrupted exports. Reports exclude design geometry, names and share links.
- Allow up to two minutes for an individual geometry evaluation, show elapsed waiting time and record evaluator completion signals. Do not repeat evaluation while waiting.
- Read only conversion-required scene metadata for direct exports when the editor getter contract is available, retaining the full part hierarchy.
- Expand indexed geometry without a second Three.js geometry allocation and write converted mesh bytes without intermediate coordinate arrays.

- Offer complete-assembly projects for large designs, with original placement, intact operands, size-target warnings and one ZIP download.
- Enforce Layerling reader file/count limits, split independent roots further when necessary, and preserve indivisible over-limit constructions separately instead of labelling them ready to open.
- Offer assembly output for the saved-JSON converter and distinguish the transport ZIP from individual project files.
- Show the installed version, check public version metadata, and provide an experimental permanent online loader alongside the self-contained bookmark.

User-reported live exports succeeded, including a large design. Final bookmark installation, online-loader compatibility and Layerling Open/Insert/Ungroup/save/reopen remain unverified. Replace the self-contained bookmark to install this version; the experimental online bookmark requires access to the hosted runtime.

## 0.2.2 — Clearer instructions

- Explain how to show the bookmarks bar on Windows, Linux and Mac.
- Separate one-time bookmark setup from exporting each design.
- Explain dragging the button, the first-use reload, download retry and opening the file in layerling.
- Move technical options and compatibility details into expandable sections.

The export code is unchanged. Existing v0.2.1 bookmarks can keep being used.

## 0.2.1 — Preview

- Resolve draft releases by ID during publication, with a regression for the failed lookup.
- First public hosted preview. The 0.2.0 candidate was retained as an unpublished draft.

Replace your saved bookmark to install this version.

## 0.2.0 — Preview

- Capture and convert directly to `.lyl` from a Tinkercad bookmark.
- Convert earlier JSON captures locally from the install page.
- Preserve evaluated meshes, normals, colors, grouping and editable operands.
- Show progress and a retry download link; prevent simultaneous imports in a tab.
- Distribute a self-contained offline edition, source package and checksums.

Replace your saved bookmark to install this version. This preview depends on undocumented Tinkercad editor tools. See the compatibility notes before relying on a particular browser.
