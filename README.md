# Tinkercad to Layerling

Bring your Tinkercad design into Layerling so you can keep editing it. Use the saved export bookmark whenever you want to transfer a design.

**[Open the setup page](https://taylormadearmy.github.io/tinkercad-layerling-importer/)** · **[Download the offline edition](https://github.com/taylormadearmy/tinkercad-layerling-importer/releases/download/v0.2.2/tinkercad-layerling-browser.zip)**

## Set up once

1. Open the setup page on your computer.
2. Show the bookmarks bar, the strip of saved links below the address bar. In Chrome, Edge or Firefox, press **Ctrl + Shift + B** on Windows/Linux or **⌘ + Shift + B** on Mac. In Safari, choose **View → Show Favorites Bar**. Skip this if the bar is already visible.
3. Click and hold the blue **Export to layerling** button on the page, drag it onto that bar, then let go. A bookmark with the same name should appear.

These bar instructions follow the browser help for [Chrome](https://support.google.com/chrome/answer/157179), [Edge](https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge), [Firefox](https://support.mozilla.org/en-US/kb/keyboard-shortcuts-perform-firefox-tasks-quickly) and [Safari](https://support.apple.com/guide/safari/ibrwde09262e/mac). See the compatibility notes for which browsers have actually been checked with this importer.

## Export a design

1. Open your design in Tinkercad's editor and wait for it to load. If you see its preview page, click **Edit** first.
2. Click the saved **Export to layerling** bookmark. With nothing selected, the whole design exports immediately. If you select parts or groups first (use **Shift-click** for multiple selections), choose **Export whole design** or **Export selected parts**. If Tinkercad reloads, wait for the design to reappear, reselect any parts and click the bookmark again.
3. Wait for **Project ready**. The `.lyl` file usually goes into your **Downloads** folder. If nothing downloads, click **Download .lyl again** in the export panel.
4. On [Layerling's start page](https://layerling.com/), click **Open a design or import geometry** and select that file. You can also drag it into the Layerling window.

Your original Tinkercad design stays unchanged. Repeat only **Export a design** for your next design.

If geometry fails, **Stop export** is the default. You may choose **Continue without failed parts**, then **Confirm partial export**. This applies to later geometry failures in the same run. Failed parts and every affected Boolean group are omitted, including groups containing the failure through nested bundles. Unaffected parts retain their positions and editable construction.

Incomplete downloads, project names and assembly filenames contain `- partial`. Each project and the outer assembly ZIP include `partial-export.json` with failed part names/IDs, additionally omitted Boolean groups and the total number of omitted source nodes. Treat it as part of your design data. The panel repeats the warning and retains the latest failure locator and optional detailed report. Normal crash reports and saved checkpoints keep their existing privacy limits. A saved JSON capture declaring failures requires fresh confirmation; the optional Python converter does not offer partial export.

Keep the original partial export and its report. Layerling preserves the partial project name when saving, but its writer does not retain the extra importer report.

Selection is captured when the bookmark opens. Close and reopen the panel after changing it. Selected groups retain their complete contents and Boolean operands at their original world positions; overlapping selections are exported once. A confirmed empty selection starts whole-design export. If selection cannot be read, the panel asks you to choose whole-design export; it does not assume nothing is selected. Stale selections still stop selected-only export. Selected-only filenames include `- selection`. See the [selection API and limitations](docs/tinkercad-selection.md).

For offline installation, extract the browser ZIP and open `index.html`. To convert an earlier JSON capture, use **Convert an earlier JSON export** on the installer page.

To update, replace the saved bookmark from the new installer. Existing bookmarks keep their installed code.

## What transfers

Evaluated triangle geometry, colors, grouping, visibility, and Boolean operands are retained for exported constructions. Parts are editable meshes; original parametric sketches are not recovered. Missing evaluated geometry stops conversion unless you explicitly confirm a partial export. Large designs require available browser memory.

Whole-design exports retain spatial note text and positions within the [documented note limits](tinkercad-import/README.md#verification-and-limits). Selected-only exports omit design-level notes because they have no supported part association. Older JSON captures that omitted notes need to be captured again.

Capture reads the open design without modifying it. Conversion stays in your browser; the importer does not upload designs. GitHub hosts the installer and has its own hosting logs. This unofficial preview uses Tinkercad's undocumented editor tools, which can change. It is not affiliated with Autodesk or Layerling.

See [compatibility and checks](docs/browser-release-checks.md). Report problems through [GitHub Issues](https://github.com/taylormadearmy/tinkercad-layerling-importer/issues/new?template=bug.yml); include the version, browser, operating system and error. Do not attach a private design.

## Developers

Python 3.10+ and Node.js 22 are used for checks. Runtime conversion has no dependencies. See [CONTRIBUTING.md](CONTRIBUTING.md) for build and check commands, [the CLI guide](tinkercad-import/README.md) for optional Python conversion, and [publishing](docs/publishing.md) for releases.

The project is licensed under [MIT](LICENSE).
