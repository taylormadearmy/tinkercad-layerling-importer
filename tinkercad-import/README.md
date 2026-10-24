# Conversion details

Start with the [setup and usage instructions](../README.md).

## Optional Python CLI

Python 3.10+ is required only for this path. Use a capture exported through the bookmarklet's advanced troubleshooting option:

```sh
python tinkercad-import/convert.py path/to/tinkercad-design.json -o MyDesign.lyl --name MyDesign
```

Use `py` on Windows or `python3` on macOS/Linux if needed. Replace the example paths with your own files.

## Geometry and editing

Every leaf and evaluated boolean group needs a mesh keyed by its unique `versions_id`. Positions use Tinkercad world coordinates; normals are included when available. The exporter applies each node's actual world transform, including nested placement, scaling, and reflections. The converter changes axes from `(x,y,z)` to `(x,z,-y)` for Layerling.

Boolean groups carry both their evaluated result and their editable operands. The group displays the result mesh. Ungroup restores the solid and hole cutters with their source visibility. A visible hole cutter is translucent; an explicitly hidden source object stays hidden.

Imported parts can be selected, moved, resized, recolored, and ungrouped. Tinkercad generator parameters do not become native Layerling sketch constraints or parametric features. Geometry is the source tessellation rather than an analytic CAD boundary representation.

Coincident solid surfaces within one bundle root are suppressed only after comparing complete geometry and normals at capture precision. The last matching source surface and material remain visible; suppressed copies remain as hidden editable nodes. Triangle ordering and cyclic vertex rotations can differ, but reversed winding stays distinct. Both converters also recognize alternate triangulations of a closed convex surface with matching orientation. Nearby parts and equal bounding boxes are insufficient to suppress a surface. Boolean operands and objects in different roots remain separate.

Missing or malformed geometry stops conversion. The converter does not infer a replacement box, cone, or primitive from a preset name. Tree-only exports and old preset-name mesh caches need a fresh capture.

## Export format

The bookmarklet captures a JSON object internally and converts it to a Layerling project. The optional JSON capture script is available from the console instructions. A saved JSON export can be converted from the install page. The capture contains:

- `format`: `tinkercad-evaluated-world-v1`.
- `shapes`: the source shape tree.
- `meshes`: per-node evaluated meshes keyed by `versions_id`, each with `space: "world"`, flat triangle `positions`, and optional `normals`.
- `diagnostics`: capture metadata for troubleshooting.
- `failures`: skipped node IDs and messages when a user explicitly continues after geometry errors.

Each triangle uses nine position values. The exporter handles indexed geometry before capture. The browser converter writes a Layerling version 2 project ZIP containing `project.json` and hashed mesh assets. It compresses mesh assets losslessly with the browser's native DEFLATE support, falling back to uncompressed ZIP entries when that support is unavailable. The Python converter remains available as a command-line alternative.

## Troubleshooting

**`RangeError: Invalid string length` while exporting JSON:** replace the saved bookmark with the current version. Diagnostic JSON exports serialize numeric arrays in bounded chunks. Direct `.lyl` export reads meshes on demand into packed Float64 buffers and compresses each unique asset before moving on. It does not collect all expanded meshes first. Surface comparisons may reread candidate meshes. Tinkercad's scene, the current meshes and the compressed output still need memory; a very large individual mesh or output can still exceed available memory. JSON file conversion still loads its input in full. Wait until export finishes before editing the source design.

**Nothing downloaded:** keep the progress panel open and click **Download .lyl again** when the project is ready. Closing the panel releases its download. Clicking the bookmark after completion starts a fresh capture; clicking while it is busy keeps the current capture.

**A path containing `$env:USERPROFILE` fails:** that syntax belongs to PowerShell. Windows Command Prompt uses `%USERPROFILE%`. Provide an absolute path if your shell does not expand the example.

**Missing geometry:** export stops without a project by default. Wait for the design to finish loading and retry, or explicitly choose **Continue without failed parts**. Failed nodes are omitted, and a Boolean group is omitted if one of its operands failed. A repeated failure may indicate a Tinkercad API change or unsupported scene state.

**Faceted outlines on curved parts:** generated projects enable Layerling's standard outline mode. In the tested reader, automatic mesh outlines used a 14-degree crease cutoff while standard outlines used 25 degrees. Changing workspace display settings can make source tessellation more visible.

## Verification and limits

Spatial notes retain their text and world positions. They open as collapsed pins without a body anchor. In smaller-assembly exports, each note appears once, in the project containing the nearest original top-level construction-root centre. Its position does not move. Older JSON captures that omitted notes cannot recover them; capture the source design again.

The converter stops if a note has invalid text or coordinates, if the design has more than 200 notes, or if a note exceeds Layerling's 2,000-character text limit. Some Unicode characters count as two toward that limit. No note is silently truncated or discarded.

`convert.py --self-test` runs the Python converter regression suite. `node --test test_exporter.cjs` checks bounded serialization and incomplete-capture refusal. `node --test test_browser_converter.cjs` checks browser archive generation and strict geometry rejection. These use synthetic fixtures.

`verify_geometry.py capture.json design.lyl` checks ZIP integrity, asset hashes, mesh counts, and every stored world vertex against the capture. Optional `--rendered file.json` compares a separately collected renderer capture in both directions, allowing vertex reordering. This repository does not include a portable renderer-capture tool.

`python tools/check_browser_parity.py` compares the shipped browser converter with Python on synthetic assemblies, checking project structure, exact mesh bytes, hashes, and ZIP CRCs. Add `--capture path/to/capture.json` for a local assembly. See the [review record and manual compatibility checklist](../docs/browser-release-checks.md).

Manual checks should include grouped appearance, Ungroup, hole visibility, and save/reopen in Layerling. The local development archive contains prior design-specific evidence; it is excluded from distribution. No universal compatibility promise is made for future Tinkercad APIs, Layerling readers, materials, or file sizes.


## Large designs and updates (local preview)

The export panel shows its version, a part-count percentage, the current stage and elapsed time. Large projects offer **Export smaller assemblies** or **Keep one project**. Smaller assemblies arrive in one ZIP; extract it and open a numbered `.lyl`. Each original top-level construction group stays intact, including hidden operands. Original workspace coordinates and mesh bytes are preserved. The default targets are 100 MiB of expanded unique meshes, one million referenced triangles and 1,500 nodes per project. These are grouping targets, not guarantees of file size, renderer memory or editing performance. Individual complete groups can exceed them; the panel and `assemblies.json` flag such cases.

Layerling's current source includes **Insert design** in its Import panel. This adds a saved project's bodies to the open project with fresh identities and preserves their positions. Open one assembly, then use Import → Insert design for another; opening another project instead replaces the open project. This path has been inspected in source but not independently verified in the live UI. Adding every assembly recreates the original geometry load.

The panel requests a small public version file without design data, credentials or a referrer. When a newer version is available, **Run latest version** loads it for that run after the current export finishes. It does not change a saved self-contained bookmark. The optional experimental **online** bookmark loads the hosted exporter on every run, avoiding future bookmark replacement after a one-time installation. Both requests can be blocked by editor policies or fail offline; the self-contained bookmark remains available. Online runtime files must be published before this local preview can work against the public site.


### Layerling reader limits and preservation files

The reader currently checks 512 MiB of compressed project data, 1 GiB expanded, 256 MiB per asset, 64 MiB for project.json, 4,096 archive entries, 100,000 nodes per state, 5,001 states, 300,000 features and 30 million numbers per mesh array. These limits were checked against [Layerling's reader source](https://github.com/henmedia/layerling/blob/c629f0a67542ad6bf5e2be644231355cfb34ef99/apps/web/src/lib/lylProject.ts) on 23 October 2026.

The converter checks final project metadata and archive bytes, not just the grouping targets. It subdivides groups of independent roots further if needed. A construction root that cannot fit is retained under `needs-attention/` as a `.preserved-project.zip`, with the exact failing limits recorded in `assemblies.json`. It is **not ready to open in Layerling**; renaming it does not change its size or expansion limit. A reader limit change or a change to construction structure is required. No operands are discarded or flattened. The transport ZIP may exceed the per-project limit: extract it and open individual `.lyl` files.

Passing these checks establishes compliance with the known file/count limits, not acceptable editing performance or a completed live import. The optional saved-JSON converter also has a File layout choice for assembly exports.
