"""Build the self-contained browser install page and bookmarklet."""
from pathlib import Path
import json
import re
import subprocess
from html import escape as html_escape
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "tinkercad-import" / "bookmarklet.template.html"
CONVERTER = ROOT / "tinkercad-import" / "browser-convert.js"
IMPORTER = ROOT / "tinkercad-import" / "browser-ui.js"
OUTPUT = ROOT / "tinkercad-import" / "bookmarklet.html"
MARKER = "/* CONVERTER_SOURCE */"
BOOKMARK_URL_LIMIT = 65536


def bookmark_url(source):
    # JavaScript is an opaque URL: URI delimiters may stay literal, but # and %
    # must be escaped. Match encodeURI(source).replace(/#/g, "%23") in the page.
    url = "javascript:" + quote(source, safe="~!*'()-._;/?:@&=+$,")
    if len(url) > BOOKMARK_URL_LIMIT:
        raise ValueError(f"Bookmark URL is {len(url):,} characters; Firefox allows {BOOKMARK_URL_LIMIT:,}")
    return url


def minify(source):
    result = subprocess.run(
        ["node", str(ROOT / "tools/minify_browser.cjs")], input=source,
        text=True, encoding="utf-8", capture_output=True, cwd=ROOT,
    )
    if result.returncode:
        raise RuntimeError("Bookmark minification failed; run npm ci --ignore-scripts first.\n" + result.stderr)
    return result.stdout


def main():
    version = (ROOT / "VERSION").read_text().strip()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise SystemExit("VERSION must contain a numeric major.minor.patch version")
    template = TEMPLATE.read_text(encoding="utf-8").replace("{{VERSION}}", version)
    converter = (ROOT / "tinkercad-import/browser-assemblies.js").read_text(encoding="utf-8").strip() + "\n" + CONVERTER.read_text(encoding="utf-8").strip()
    loader = (ROOT / "tinkercad-import/browser-loader.js").read_text(encoding="utf-8").strip()
    importer = loader + "\n" + IMPORTER.read_text(encoding="utf-8").replace("{{VERSION}}",version).strip()
    if template.count(MARKER) != 1:
        raise SystemExit("Expected one converter marker in the install template")
    if template.count("/* IMPORTER_SOURCE */") != 1:
        raise SystemExit("Expected one importer marker in the install template")
    # Escape closing script tags before embedding source in HTML.
    escape = lambda source: re.sub(r"</script", lambda match: "<\\/" + match.group()[2:], source, flags=re.IGNORECASE)
    output = template.replace(MARKER, escape(converter)).replace("/* IMPORTER_SOURCE */", escape(importer))
    # The online runtime defines entry points; only the bookmark invokes them.
    exporter = template.split('<script id="exporter">',1)[1].split("</script>",1)[0].strip()
    runtime = converter + "\n" + exporter + "\n" + importer + "\nglobalThis.__layerlingRuntimeLoaded = true;\n"
    online = bookmark_url(loader + "\nvoid layerlingLoadLatest();")
    output = output.replace("{{ONLINE_BOOKMARK}}", html_escape(online, quote=True))
    source = minify(converter + "\n" + exporter + "\n" + importer) + "\nvoid runLayerlingImport();"
    url = bookmark_url(source)
    if output.count("{{BOOKMARK_SOURCE}}") != 1:
        raise ValueError("Expected one compact bookmark source marker")
    output = output.replace("{{BOOKMARK_SOURCE}}", json.dumps(source).replace("<", "\\u003c"))
    (OUTPUT.parent / "importer.js").write_text(runtime,encoding="utf-8",newline="\n")
    OUTPUT.write_text(output, encoding="utf-8", newline="\n")
    length = len(url)
    print(f"Built {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size:,} bytes HTML; {length:,} characters in bookmark URL)")


if __name__ == "__main__":
    main()
