"""Compare shipped browser output with the Python reference using synthetic designs."""
import copy
import argparse
import hashlib
import itertools
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tinkercad-import"))
from convert import Converter, build_document
from verify_geometry import verify


def leaf(identity, **tags):
    return {"versions_id": identity, "dataType": "preset", "params": {"id": "custom"}, "tags": tags}


def mesh(x=0, normals=True):
    result = {"space": "world", "positions": [x, 0, 0, x + 2, 0, 0, x, 3, 4]}
    if normals:
        result["normals"] = [0, -.8, .6] * 3
    return result


def group(identity, children, bundle=False, data_type="csg", **tags):
    return {"versions_id": identity, "dataType": data_type, "params": {"groupType": 0 if bundle else 1},
            "tags": tags, "children": children}


def cube_triangulations():
    vertices = [(0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 0),
                (0, 0, 2), (2, 0, 2), (2, 2, 2), (0, 2, 2)]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    seen = {}
    for diagonals in itertools.product((0, 1), repeat=6):
        triangles = []
        for (a, b, c, d), diagonal in zip(faces, diagonals):
            triangles.extend((a, b, d, b, c, d) if diagonal else (a, b, c, a, c, d))
        multiplicities = tuple(triangles.count(i) for i in range(8))
        positions = [coordinate for i in triangles for coordinate in vertices[i]]
        if multiplicities in seen:
            return [{"space": "world", "positions": seen[multiplicities]}, {"space": "world", "positions": positions}]
        seen[multiplicities] = positions
    raise AssertionError("No equivalent cube triangulations found")


def fixtures():
    red = {"color": {"r": 255, "g": 0, "b": 0}}
    green = {"color": {"r": 0, "g": 255, "b": 0}}
    cases = []
    def add(name, shapes, meshes):
        cases.append({"name": name, "input": {"format": "tinkercad-evaluated-world-v1", "shapes": shapes, "meshes": meshes}})
    add("world-normals", [leaf("part", label="Pin 🟢")], {"part": mesh(11.125)})
    zero_normals = mesh(); zero_normals["normals"] = [0, 0, 1] * 3
    add("zero-normals", [leaf("part")], {"part": zero_normals})
    null_normals = mesh(); null_normals["normals"] = None
    add("null-normals", [leaf("part")], {"part": null_normals})
    add("nested-cutters", [group("root", [group("cut", [leaf("body"), leaf("cutter", volumePolarity=-1),
         leaf("hidden", visible=False, volumePolarity=-1)], renderingMaterial=red), leaf("loose", volumePolarity=-1)], bundle=True)],
        {key: mesh(i * 3) for i, key in enumerate(["cut", "body", "cutter", "hidden", "loose"])})
    add("hole-inheritance", [group("hole", [leaf("a"), leaf("b")], volumePolarity=-1)],
        {"hole": mesh(), "a": mesh(), "b": mesh(2)})
    add("last-material", [group("bundle", [leaf("a", renderingMaterial=red), leaf("b", renderingMaterial=green)],
        bundle=True, isMulticolor=True)], {"a": mesh(), "b": mesh()})
    reversed_mesh = mesh(); reversed_mesh["positions"] = reversed_mesh["positions"][3:9] + reversed_mesh["positions"][:3]
    add("reordered-triangles", [group("bundle", [leaf("a"), leaf("b")], bundle=True)], {"a": mesh(), "b": reversed_mesh})
    add("near-distinct", [group("bundle", [leaf("a"), leaf("b")], bundle=True)], {"a": mesh(), "b": mesh(.001)})
    changed = mesh(); changed["positions"][3:6] = [2, 3, 0]
    add("same-bounds-distinct", [group("bundle", [leaf("a"), leaf("b")], bundle=True)], {"a": mesh(), "b": changed})
    add("separate-roots", [leaf("b"), leaf("a")], {"a": mesh(), "b": mesh()})
    add("boolean-operands", [group("cut", [leaf("a"), leaf("b")])], {"cut": mesh(), "a": mesh(), "b": mesh()})
    add("sanitized-identity", [group("tête", [leaf("a_b"), leaf("a-b")], bundle=True)], {"a_b": mesh(), "a-b": mesh()})
    cubes = cube_triangulations()
    add("convex-alternate-triangulation", [group("bundle", [leaf("a"), leaf("b")], bundle=True)], dict(zip(("a", "b"), cubes)))
    folded = copy.deepcopy(cubes[0])
    folded["positions"][:3], folded["positions"][18:21] = folded["positions"][18:21], folded["positions"][:3]
    add("folded-not-duplicate", [group("bundle", [leaf("a"), leaf("b")], bundle=True)], {"a": cubes[0], "b": folded})
    opposite = mesh(); opposite["normals"] = [0, .8, -.6] * 3
    add("different-normals", [group("bundle", [leaf("a"), leaf("b")], bundle=True)], {"a": mesh(), "b": opposite})
    backwards = mesh(); backwards["positions"] = backwards["positions"][:3] + backwards["positions"][6:9] + backwards["positions"][3:6]
    add("reversed-winding", [group("bundle", [leaf("a"), leaf("b")], bundle=True)], {"a": mesh(), "b": backwards})
    add("source-hidden", [group("bundle", [leaf("a", visible=False), leaf("b")], bundle=True, visible=False)], {"a": mesh(), "b": mesh()})
    add("preview", [leaf("preview", preview=True), leaf("part")], {"part": mesh()})
    add("cbshape-bundle", [group("cb-root", [group("cut", [leaf("body"), leaf("cutter", volumePolarity=-1)],
        renderingMaterial=red), leaf("pin")], bundle=True, data_type="cbshape", label="Rounded Box")],
        {"cut": mesh(0), "body": mesh(0), "cutter": mesh(3), "pin": mesh(12)})
    add("cbshape-in-union", [group("outer", [group("cb", [leaf("a"), leaf("b", volumePolarity=-1)],
        bundle=True, data_type="cbshape", label="Codeblocks")], label="Union")],
        {"outer": mesh(0), "a": mesh(0), "b": mesh(4)})
    add("cbshape-union", [group("cb-union", [leaf("a"), leaf("b", volumePolarity=-1)],
        bundle=False, data_type="cbshape", label="Combined Codeblocks")],
        {"cb-union": mesh(2), "a": mesh(2), "b": mesh(5)})
    add("spatial-notes", [leaf("part")], {"part":mesh()})
    cases[-1]["input"]["notes"] = [{"uuid":"n", "content":"Fit 🟢\nKeep spaces ", "position":{"x":12.25,"y":-3.5,"z":8}}]
    return cases


def normalize(document):
    result = copy.deepcopy(document)
    result["metadata"].pop("createdAt")
    result["metadata"].pop("modifiedAt")
    for entry in result["history"]["entries"]:
        entry.pop("recordedAt")
    return result


def first_difference(actual, expected, path="project"):
    if isinstance(actual, dict) and isinstance(expected, dict):
        if actual.keys() != expected.keys():
            return f"{path}: different keys {actual.keys() ^ expected.keys()}"
        for key in actual:
            if actual[key] != expected[key]:
                return first_difference(actual[key], expected[key], path + "." + key)
    if isinstance(actual, list) and isinstance(expected, list):
        if len(actual) != len(expected):
            return f"{path}: different lengths {len(actual)} != {len(expected)}"
        for index, (a, b) in enumerate(zip(actual, expected)):
            if a != b:
                return first_difference(a, b, f"{path}[{index}]")
    return f"{path}: {actual!r} != {expected!r}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, help="Also compare a local capture; it is never included in the distribution")
    args = parser.parse_args()
    cases = fixtures()
    if args.capture:
        cases.append({"name": "local-capture", "input": json.loads(args.capture.read_text(encoding="utf-8"))})
    with tempfile.TemporaryDirectory(prefix=".parity-", dir=ROOT / "tinkercad-import") as directory:
        folder = Path(directory)
        assert folder.resolve().is_relative_to(ROOT)
        source = folder / "cases.json"
        source.write_text(json.dumps(cases), encoding="utf-8")
        subprocess.run(["node", str(ROOT / "tools/convert_browser_fixtures.cjs"), str(source), str(folder)], check=True)
        for case in cases:
            converter = Converter(case["input"]["meshes"])
            shapes, nodes, features, groups, sketches = converter.convert(case["input"]["shapes"])
            roots = ["scene/object/" + shape["id"] for shape in shapes]
            expected = build_document(case["name"], nodes, roots, features, groups, sketches, converter._assets, shapes, case["input"].get("notes", []))
            for suffix in ("", "-lazy"):
                with zipfile.ZipFile(folder / (case["name"] + suffix + ".lyl")) as archive:
                    assert archive.testzip() is None, case["name"] + ": invalid ZIP CRC"
                    actual = json.loads(archive.read("project.json"))
                    a, b = normalize(actual), normalize(expected)
                    assert a == b, case["name"] + ": " + first_difference(a, b)
                    definitions = {node["objectId"]: node["definition"] for node in actual["states"][0]["nodes"]}
                    if case["name"] == "convex-alternate-triangulation":
                        assert definitions["a"].get("hidden") and not definitions["b"].get("hidden")
                    if case["name"] in ("folded-not-duplicate", "different-normals", "reversed-winding"):
                        assert not definitions["a"].get("hidden") and not definitions["b"].get("hidden")
                    for asset in converter._assets:
                        data = archive.read(asset["path"])
                        assert data == converter._asset_blobs[asset["id"]], case["name"] + ": binary mesh differs"
                        assert hashlib.sha256(data).hexdigest() == asset["sha256"]
            if case["name"] == "local-capture":
                print("Local capture geometry: " + json.dumps(verify(args.capture, folder / "local-capture.lyl")))
    print(f"Browser/Python parity: {len(cases)} assemblies match in eager and lazy modes, including exact mesh bytes and ZIP CRCs")


if __name__ == "__main__":
    main()
