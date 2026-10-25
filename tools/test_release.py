"""Offline release-boundary regressions; no account or network needed."""
import hashlib
import json
import subprocess
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

import release
import build_browser


class ReleaseTests(unittest.TestCase):
    def test_bookmark_encoding_matches_installer_and_preserves_javascript(self):
        source = 'globalThis.text="a#b %20 ?&copy; +/:= café 🟢";\n'
        expected = "javascript:" + subprocess.check_output(
            ["node", "-e", "const s=JSON.parse(process.argv[1]);process.stdout.write(encodeURI(s).replace(/#/g,'%23'));", json.dumps(source)],
            encoding="utf-8",
        )
        self.assertEqual(build_browser.bookmark_url(source), expected)
        self.assertNotIn("#", expected)

    def test_minifier_preserves_unicode_source_text(self):
        source = "globalThis.message = 'Counting parts… café';"
        compact = build_browser.minify(source)
        result = subprocess.check_output(
            ["node", "-e", compact + ";process.stdout.write(globalThis.message)"],
            encoding="utf-8",
        )
        self.assertEqual(result, "Counting parts… café")

    def test_bookmark_url_accepts_exact_firefox_limit_and_rejects_overflow(self):
        source = "x" * (65536 - len("javascript:"))
        self.assertEqual(len(build_browser.bookmark_url(source)), 65536)
        with self.assertRaisesRegex(ValueError, "Firefox allows"):
            build_browser.bookmark_url(source + "x")

    def test_bookmark_limit_counts_url_encoding_not_raw_source(self):
        self.assertEqual(build_browser.bookmark_url("é"), "javascript:%C3%A9")
        with self.assertRaisesRegex(ValueError, "Firefox allows"):
            build_browser.bookmark_url("é" * 11000)

    def test_draft_lookup_uses_release_id_not_published_tag_endpoint(self):
        with patch.object(release, "gh", return_value='{"databaseId":123}') as cli:
            with patch.object(release, "api", return_value={"draft": True}) as api:
                self.assertTrue(release.release_for("v0.2.1")["draft"])
                api.assert_called_once_with("releases/123")
                cli.assert_called_once_with("release", "view", "v0.2.1", "--repo",
                                            release.REPOSITORY, "--json", "databaseId")

    def test_tag_validation(self):
        self.assertEqual(release.version_for("v0.2.0"), "0.2.0")
        for value in ("main", "v0.2.0/../../x", "v0.2.0\n", "v1.2.3;whoami"):
            with self.assertRaises(ValueError):
                release.version_for(value)

    def test_version_must_match(self):
        with self.assertRaises(ValueError):
            release.validate_version("v999.0.0")

    def test_zip_rejects_unsafe_extra_and_duplicate_entries(self):
        for extra in ("../bad", "secret.txt", "index.html"):
            with tempfile.TemporaryDirectory(dir=release.ROOT / "tinkercad-import") as directory:
                path = Path(directory) / "browser.zip"
                with zipfile.ZipFile(path, "w") as archive:
                    for name in release.BROWSER_FILES:
                        archive.writestr(name, name)
                    archive.writestr(extra, "bad")
                with self.assertRaises(ValueError):
                    release.read_browser_zip(path)

    def test_legacy_browser_archive_is_allowed_only_for_rollback(self):
        with tempfile.TemporaryDirectory(dir=release.ROOT / "tinkercad-import") as directory:
            path = Path(directory) / "legacy.zip"
            with zipfile.ZipFile(path, "w") as archive:
                for name in release.LEGACY_BROWSER_FILES:
                    archive.writestr(name, name)
            with self.assertRaises(ValueError):
                release.read_browser_zip(path)
            self.assertEqual(set(release.read_browser_zip(path, allow_legacy=True)), set(release.LEGACY_BROWSER_FILES))

    def test_legacy_rollback_removes_new_runtime_and_version_files(self):
        with tempfile.TemporaryDirectory(dir=release.ROOT / "tinkercad-import") as directory:
            folder = Path(directory)
            (folder / release.ASSETS[0]).write_bytes(b"legacy source")
            with zipfile.ZipFile(folder / release.ASSETS[1], "w") as archive:
                for name in release.LEGACY_BROWSER_FILES:
                    archive.writestr(name, "Version 0.2.2" if name == "index.html" else name)
            (folder / "SHA256SUMS").write_text("\n".join(
                hashlib.sha256((folder/name).read_bytes()).hexdigest()+"  "+name for name in release.ASSETS))
            site = folder / "dist/site"
            site.mkdir(parents=True)
            for name in release.BROWSER_FILES:
                (site/name).write_bytes(b"newer content")
            info = {"draft":False,"assets":[{"name":name} for name in (*release.ASSETS,"SHA256SUMS")]}
            with patch.object(release,"ROOT",folder), patch.object(release,"tag_commit",return_value="old"), \
                 patch.object(release,"release_for",return_value=info), patch.object(release,"download",return_value=folder):
                release.stage("v0.2.2",rollback=True)
            self.assertEqual({p.name for p in site.iterdir()},set(release.LEGACY_BROWSER_FILES))

    def test_checksum_coverage_and_corruption(self):
        with tempfile.TemporaryDirectory(dir=release.ROOT / "tinkercad-import") as directory:
            folder = Path(directory)
            for name in release.ASSETS:
                (folder / name).write_bytes(b"content")
            rows = [hashlib.sha256(b"content").hexdigest() + "  " + name for name in release.ASSETS]
            (folder / "SHA256SUMS").write_text("\n".join(rows))
            release.verify_checksums(folder)
            for invalid in (rows[:1], rows + rows[:1], rows + ["0" * 64 + "  ../bad.zip"]):
                (folder / "SHA256SUMS").write_text("\n".join(invalid))
                with self.assertRaises(ValueError):
                    release.verify_checksums(folder)
            (folder / "SHA256SUMS").write_text("\n".join(rows))
            (folder / release.ASSETS[0]).write_bytes(b"corrupted")
            with self.assertRaises(ValueError):
                release.verify_checksums(folder)

    def test_requires_passing_push_for_exact_commit(self):
        for runs in ([], [{"head_sha": "other", "event": "push", "conclusion": "success"}],
                     [{"head_sha": "a", "event": "push", "conclusion": "failure"}],
                     [{"head_sha": "a", "event": "pull_request", "conclusion": "success"}]):
            with patch.object(release, "api", return_value={"workflow_runs": runs}):
                with self.assertRaises(ValueError):
                    release.require_tests("a")
        with patch.object(release, "api", return_value={"workflow_runs": [
                {"head_sha": "a", "event": "push", "conclusion": "success"}]}):
            release.require_tests("a")


if __name__ == "__main__":
    unittest.main()
