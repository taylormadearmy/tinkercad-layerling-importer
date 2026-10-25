"""Build a source-only ZIP without Git history or private development fixtures."""

import hashlib
import zipfile
from pathlib import Path
from build_browser import main as build_browser


ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "VERSION",
    "CHANGELOG.md",
    ".github/ISSUE_TEMPLATE/bug.yml",
    ".github/workflows/release.yml",
    "tools/release.py",
    "tools/test_release.py",
    ".gitattributes",
    ".gitignore",
    ".github/workflows/tests.yml",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "docs/publishing.md",
    "docs/browser-release-checks.md",
    "docs/tinkercad-selection.md",
    "docs/plans/tinkercad-import-integration.md",
    "tinkercad-import/README.md",
    "tinkercad-import/bookmarklet.html",
    "tinkercad-import/bookmarklet.template.html",
    "tinkercad-import/browser-convert.js",
    "tinkercad-import/browser-assemblies.js",
    "tinkercad-import/browser-loader.js",
    "tinkercad-import/importer.js",
    "tinkercad-import/browser-ui.js",
    "tinkercad-import/browser-test-helpers.cjs",
    "tinkercad-import/convert.py",
    "tinkercad-import/test_browser_converter.cjs",
    "tinkercad-import/test_converter.py",
    "tinkercad-import/test_exporter.cjs",
    "tinkercad-import/verify_geometry.py",
    "tools/package_release.py",
    "tools/build_browser.py",
    "tools/minify_browser.cjs",
    "package.json",
    "package-lock.json",
    "tools/check_browser_parity.py",
    "tools/convert_browser_fixtures.cjs",
    "tools/check_release.py",
)


def main():
    build_browser()
    paths = list(FILES)
    # Read all inputs before replacing a previous package.
    sources = {name: (ROOT / name).read_bytes() for name in paths}
    checksums = "".join(
        f"{hashlib.sha256(data).hexdigest()}  {name}\n"
        for name, data in sources.items()
    )
    output = ROOT / "dist" / "tinkercad-layerling-importer.zip"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sources.items():
            archive.writestr(name, data)
        archive.writestr("SHA256SUMS", checksums)
    print(f"Wrote {output} ({len(sources)} source files plus checksums)")
    browser_files = {
        "index.html": sources["tinkercad-import/bookmarklet.html"],
        "importer.js": sources["tinkercad-import/importer.js"],
        "version.json": ('{"version":"' + (ROOT / "VERSION").read_text().strip() + '"}\n').encode(),
        "LICENSE.txt": sources["LICENSE"],
        "README.txt": (
            "Tinkercad to layerling - offline edition\n\n"
            "1. Extract this ZIP and open index.html in your browser.\n"
            "2. Show the bookmarks bar, below your browser's address bar.\n"
            "   Chrome, Edge or Firefox: Ctrl+Shift+B on Windows/Linux;\n"
            "   Command+Shift+B on Mac. Safari: View > Show Favorites Bar.\n"
            "   Skip this if the bar is already visible.\n"
            "   Click and hold Export to layerling, drag it onto that bar, and let go.\n"
            "3. Open a design in the Tinkercad editor and click the bookmark.\n"
            "   Nothing selected: the whole design exports immediately.\n"
            "   Parts/groups selected: choose whole design or selected parts.\n"
            "   If the editor reloads, click the bookmark again when it is ready.\n"
            "4. Wait for Project ready, then open the downloaded .lyl in layerling.\n"
            "   Use Download .lyl again if the download did not start.\n"
            "   Large designs can download as an assemblies ZIP. Extract it first.\n"
            "   Open numbered .lyl files; files under needs-attention are preserved\n"
            "   construction data that exceed reader limits and are not ready to open.\n\n"
            "Geometry errors stop by default. Partial export needs two confirmations.\n"
            "Partial files/groups are labelled and contain partial-export.json, listing\n"
            "failed parts and omitted Boolean groups with their names and IDs.\n\n"
            "The file is usually in Downloads. On layerling's start page choose\n"
            "Open a design or import geometry and select that .lyl file.\n\n"
            "Conversion stays in your browser. Your Tinkercad design stays unchanged.\n"
            "To update, open the new index.html and replace the saved bookmark.\n"
            "This is an unofficial tool using Tinkercad's undocumented editor tools.\n"
        ).encode("utf-8"),
    }
    site = output.parent / "site"
    site.mkdir(exist_ok=True)
    for name, data in browser_files.items():
        (site / name).write_bytes(data)
    browser_output = output.parent / "tinkercad-layerling-browser.zip"
    with zipfile.ZipFile(browser_output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in browser_files.items():
            archive.writestr(name, data)
    sums = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
                   for path in (output, browser_output))
    (output.parent / "SHA256SUMS").write_text(sums, encoding="utf-8", newline="\n")
    print(f"Wrote {browser_output}, SHA256SUMS and static site at {site}")


if __name__ == "__main__":
    main()
