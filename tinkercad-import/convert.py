#!/usr/bin/env python3
"""Turn a Tinkercad shape tree into a layerling project file (.lyl).

The bookmarklet in bookmarklet.html downloads the tree from an open Tinkercad
design. This program writes a project layerling opens with "Open layerling design".

    python3 convert.py tinkercad-design.json -o design.lyl

Export with the accompanying bookmarklet. Each non-bundle node must have its
own evaluated world-space triangle mesh, keyed by versions_id. Positions use
Tinkercad's Z-up coordinates. Incomplete legacy exports fail rather than invent geometry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "com.layerling.project"
FORMAT_VERSION = 2
MIN_SIZE = 0.05


def to_y_up(v: tuple[float, float, float]) -> tuple[float, float, float]:
    return (v[0], v[2], -v[1])


def hex_color(color: dict | None, fallback: str = "#d41721") -> str:
    if not isinstance(color, dict):
        return fallback
    try:
        red = int(color.get("r", 0))
        green = int(color.get("g", 0))
        blue = int(color.get("b", 0))
    except (TypeError, ValueError):
        return fallback
    return f"#{red:02x}{green:02x}{blue:02x}"


def positive(value: float) -> float:
    return max(MIN_SIZE, abs(value))


def same_convex_surface(first: list[float], second: list[float]) -> bool:
    """Recognize alternate triangulations only when both describe a closed convex hull.

    Equal vertex clouds alone are insufficient: a cube and a folded mesh can
    share vertices. Closedness and supporting face planes prove hull equivalence.
    """
    points = lambda p: [tuple(p[i:i+3]) for i in range(0,len(p),3)]
    a, b = points(first), points(second)
    if len(a) != len(b) or any(math.dist(p,q)>1e-5 for p,q in zip(sorted(a),sorted(b))):
        return False
    def convex_closed(vertices):
        unique = set(vertices)
        center = tuple(sum(v[i] for v in unique)/len(unique) for i in range(3))
        edges = Counter()
        orientation = 0
        for j in range(0,len(vertices),3):
            p,q,r = vertices[j:j+3]
            u = tuple(q[i]-p[i] for i in range(3));v = tuple(r[i]-p[i] for i in range(3))
            n = (u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
            length = math.sqrt(sum(x*x for x in n))
            if length<1e-12:continue
            n = tuple(x/length for x in n)
            side = sum(n[i]*(center[i]-p[i]) for i in range(3))
            winding = -1 if side > 1e-12 else 1 if side < -1e-12 else 0
            if not winding or (orientation and orientation != winding): return 0
            orientation = winding
            if side > 0: n=tuple(-x for x in n)
            if any(sum(n[i]*(x[i]-p[i]) for i in range(3))>1e-4 for x in unique):return False
            for x,y in ((p,q),(q,r),(r,p)):
                edge=tuple(sorted((tuple(round(c,4) for c in x),tuple(round(c,4) for c in y))))
                edges[edge]+=1
        return orientation if edges and all(count==2 for count in edges.values()) else 0
    first_orientation = convex_closed(a)
    return first_orientation != 0 and first_orientation == convex_closed(b)


class Converter:
    def __init__(self, meshes: dict[str, dict]):
        for key, mesh in meshes.items():
            positions = mesh.get("positions") if isinstance(mesh, dict) else None
            if not isinstance(mesh,dict) or mesh.get("space") != "world" or not isinstance(positions, list):
                raise ValueError(f"{key}: expected evaluated world-space triangle positions")
            validate_mesh(positions, mesh.get("normals"))
        self.meshes = meshes
        self.counts = {"shape": 0, "group": 0, "bundle": 0, "skipped": 0}
        self._ids: set[str] = set()
        self._assets: list[dict] = []
        self._asset_blobs: dict[str, bytes] = {}

    def unique_id(self, raw: str) -> str:
        base = "".join(ch if ch.isalnum() else "-" for ch in raw) or "shape"
        candidate = base
        number = 2
        while candidate in self._ids:
            candidate = f"{base}-{number}"
            number += 1
        self._ids.add(candidate)
        return candidate

    def convert(self, nodes: list[dict]) -> tuple[list[dict], list[dict], list[dict], list[dict], list[dict]]:
        identities = set()
        def validate_nodes(items):
            if not isinstance(items,list):
                raise ValueError("Shape children must be a list")
            for item in items:
                if not isinstance(item,dict):
                    raise ValueError("Each source shape must be an object")
                if (item.get("tags") or {}).get("preview"):
                    continue
                identity = item.get("versions_id")
                if not isinstance(identity,str) or not identity or identity in identities:
                    raise ValueError(f"Missing or repeated source shape identity: {identity}")
                identities.add(identity)
                validate_nodes(item.get("children",[]))
        validate_nodes(nodes)
        shapes = []
        for node in nodes:
            shape = self._node(node, None)
            if shape is not None:
                shapes.append(shape)
        if not shapes:
            raise SystemExit("The Tinkercad tree has no shapes to convert.")
        self._hide_identical_surfaces(shapes)
        state_nodes: list[dict] = []
        root_ids: list[str] = []
        for shape in shapes:
            root_ids.append(self._emit(shape, "scene/object", state_nodes))
        state_nodes.sort(key=lambda node: node["nodeId"])
        features, groups, sketches = self._indexes(root_ids, {node["nodeId"]: node for node in state_nodes})
        return shapes, state_nodes, features, groups, sketches

    def _hide_identical_surfaces(self, shapes: list[dict]) -> None:
        """Suppress redundant draw calls within each root, retaining editable nodes.

        Compare complete source triangles and normals at float32 capture precision.
        Never deduplicate operands inside an evaluated boolean or across roots.
        """
        for root in shapes:
            seen = {}
            def visit(shape):
                if shape.get("hidden") or shape.get("hole"):
                    return
                if shape.get("_meshRef"):
                    mesh = self.meshes.get(shape["_sourceId"])
                    if mesh and mesh.get("space") == "world":
                        p = mesh["positions"]
                        normal = mesh.get("normals") or []
                        key = (len(p), bool(shape.get("transparent")))
                        bounds = point_bounds(p)
                        candidates = seen.setdefault(key, [])
                        def canonical(values, normals):
                            triangles = []
                            for i in range(0, len(values), 9):
                                vertices = [tuple(values[j:j+3]) + tuple(normals[j:j+3]) for j in range(i,i+9,3)]
                                triangles.append(min(tuple(vertices[k:] + vertices[:k]) for k in range(3)))
                            return sorted(triangles)
                        for candidate in candidates:
                            previous, previous_normals, previous_bounds, previous_shape = candidate
                            if max(abs(a-b) for a,b in zip(bounds,previous_bounds)) > 1e-5:
                                continue
                            if len(normal) != len(previous_normals):
                                continue
                            same_order = (all(abs(a-b) <= 1e-5 for a,b in zip(p,previous))
                                          and all(abs(a-b) <= 1e-5 for a,b in zip(normal,previous_normals)))
                            same_triangles = same_order or all(
                                abs(a-b) <= 1e-5
                                for triangle1,triangle2 in zip(canonical(p,normal),canonical(previous,previous_normals))
                                for vertex1,vertex2 in zip(triangle1,triangle2)
                                for a,b in zip(vertex1,vertex2))
                            if not same_triangles and not normal:
                                same_triangles = same_convex_surface(p,previous)
                            if same_triangles:
                                # Equal-depth copies are drawn in source tree order.
                                # Keep the last surface/material; retain earlier nodes
                                # hidden so they remain available for editing.
                                previous_shape["hidden"] = True
                                candidate[:] = [p, normal, bounds, shape]
                                self.counts["identical_surfaces_hidden"] = self.counts.get("identical_surfaces_hidden",0)+1
                                return
                        candidates.append([p, normal, bounds, shape])
                    return
                for child in shape.get("_children", []):
                    visit(child)
            visit(root)

    def _emit(self, shape: dict, parent_path: str, nodes: list[dict]) -> str:
        node_id = f"{parent_path}/{shape['id']}"
        child_ids = [self._emit(child, f"{node_id}/group", nodes) for child in shape.get("_children", [])]
        definition = {key: value for key, value in shape.items() if not key.startswith("_")}
        node = {
            "nodeId": node_id,
            "objectId": shape["id"],
            "objectType": shape["_objectType"],
            "workplaneId": "base",
            "definition": definition,
        }
        if child_ids:
            node["groupedShapeNodeIds"] = child_ids
        mesh_ref = shape.get("_meshRef")
        if mesh_ref:
            node["importedMesh"] = mesh_ref
        nodes.append(node)
        return node_id

    def _indexes(self, root_ids: list[str], by_id: dict[str, dict]):
        features: list[dict] = []
        groups: list[dict] = []
        sketches: list[dict] = []
        last: dict[str, str] = {}
        visited: set[str] = set()

        def visit(node_id: str) -> None:
            if node_id in visited:
                return
            visited.add(node_id)
            node = by_id[node_id]
            for child_id in node.get("groupedShapeNodeIds") or []:
                visit(child_id)
            previous = None
            definition = node["definition"]
            child_ids = node.get("groupedShapeNodeIds") or []
            if child_ids:
                children = [by_id[child_id] for child_id in child_ids]
                operation = definition.get("groupOperation")
                if operation == "bundle":
                    feature_type = "group"
                elif any(child["definition"].get("hole") for child in children) and any(not child["definition"].get("hole") for child in children):
                    feature_type = "boolean-subtraction"
                else:
                    feature_type = "group"
                feature_id = f"feature/{node_id}/{feature_type}"
                features.append({
                    "id": feature_id,
                    "type": feature_type,
                    "outputObjectId": node["objectId"],
                    "inputObjectIds": [child["objectId"] for child in children],
                    "dependsOnFeatureIds": [last[child_id] for child_id in child_ids if child_id in last],
                })
                groups.append({
                    "id": f"group/{node['objectId']}",
                    "nodeId": node_id,
                    "objectId": node["objectId"],
                    "memberNodeIds": list(child_ids),
                    "operation": feature_type,
                })
                previous = feature_id
            if previous:
                last[node_id] = previous

        for root_id in root_ids:
            visit(root_id)
        return features, groups, sketches

    def _node(self, node: dict, inherited_color: str | None, inherited_hole: bool = False) -> dict | None:
        if not isinstance(node, dict) or (node.get("tags") or {}).get("preview"):
            return None
        data_type = node.get("dataType")
        tags = node.get("tags") or {}
        own_color = hex_color((tags.get("renderingMaterial") or {}).get("color"), "")
        hole = inherited_hole or (tags.get("volumePolarity") == -1)
        effective_group_color = own_color if (own_color and own_color != "#dde2e4") else inherited_color
        if data_type in ("csg", "cbshape"):
            multicolor = bool(tags.get("isMulticolor"))
            child_color = inherited_color or (None if multicolor else (own_color or None))
            raw_children = [item for item in (node.get("children") or []) if isinstance(item, dict) and not (item.get("tags") or {}).get("preview")]
            all_solid_children = all((item.get("tags") or {}).get("volumePolarity") != -1 for item in raw_children)
            child_hole = hole and all_solid_children
            children = [child for item in raw_children if (child := self._node(item, child_color, child_hole)) is not None]
            if not children:
                self.counts["skipped"] += 1
                return None
            return self._group(node, children, effective_group_color or own_color or "#dde2e4", hole)
        color = inherited_color or own_color or "#d41721"
        version_mesh = self.meshes.get(str(node.get("versions_id") or ""))
        if version_mesh and version_mesh.get("space") == "world":
            name = tags.get("label") or (node.get("params") or {}).get("fileName") or (node.get("params") or {}).get("id") or data_type
            return self._generic_mesh_node(node, name, color, hole, version_mesh)
        raise ValueError(f"{node.get('versions_id')}: missing evaluated world mesh; export again with bookmarklet.html")

    def _group(self, node: dict, children: list[dict], color: str, hole: bool = False) -> dict:
        bundle = (node.get("params") or {}).get("groupType") == 0
        self.counts["bundle" if bundle else "group"] += 1
        tags = node.get("tags") or {}
        name = tags.get("label") or ("Bundle" if bundle else "Group")
        versions_id = str(node.get("versions_id") or "")
        csg_mesh = None if bundle else self.meshes.get(versions_id)
        if not bundle and not csg_mesh:
            raise ValueError(f"{versions_id}: missing evaluated boolean mesh; export again")
        if csg_mesh and csg_mesh.get("space") != "world":
            raise ValueError(f"{versions_id}: boolean mesh must explicitly use world coordinates")
        if csg_mesh and csg_mesh.get("positions"):
            positions = csg_mesh["positions"]
            converted = []
            for index in range(0, len(positions) - 2, 3):
                x, y, z = to_y_up((positions[index], positions[index + 1], positions[index + 2]))
                converted.extend((x, y, z))
            bounds = point_bounds(converted)
            center_x = (bounds[0] + bounds[1]) / 2
            center_z = (bounds[4] + bounds[5]) / 2
            min_y = bounds[2]
            width = positive(bounds[1] - bounds[0])
            height = positive(bounds[3] - bounds[2])
            depth = positive(bounds[5] - bounds[4])
            local = []
            for index in range(0, len(converted) - 2, 3):
                local.extend((converted[index] - center_x, converted[index + 1] - min_y, converted[index + 2] - center_z))
            mesh_ref = self._mesh_asset(name, local, width, depth, height, "json", self._y_up_normals(csg_mesh.get("normals")))
        else:
            bounds = union_bounds(child["_bounds"] for child in children)
            center_x = (bounds[0] + bounds[1]) / 2
            center_z = (bounds[4] + bounds[5]) / 2
            min_y = bounds[2]
            width = positive(bounds[1] - bounds[0])
            height = positive(bounds[3] - bounds[2])
            depth = positive(bounds[5] - bounds[4])
            mesh_ref = None
        for child in children:
            child["x"] = child["x"] - center_x
            child["z"] = child["z"] - center_z
            child["elevation"] = child["elevation"] - min_y
        shape = self._base(
            node,
            name=name,
            kind="mesh",
            color=color,
            width=width,
            depth=depth,
            height=height,
            x=center_x,
            z=center_z,
            elevation=min_y,
            hole=hole,
        )
        shape["groupOperation"] = "bundle" if bundle else "group"
        shape["groupedBaseWidth"] = width
        shape["groupedBaseDepth"] = depth
        shape["groupedBaseHeight"] = height
        shape["multicolor"] = True
        if mesh_ref:
            solid_colors = {child["color"] for child in children if not child.get("hole") and not child.get("hidden")}
            if len(solid_colors) <= 1:
                # One colour: draw the cut mesh in it rather than probing parts (cutter parts inside
                # hole sub-groups would otherwise tint the surface).
                shape["multicolor"] = False
                if solid_colors:
                    shape["color"] = next(iter(solid_colors))
        shape["_children"] = children
        shape["_objectType"] = "group"
        shape["_bounds"] = bounds
        if mesh_ref:
            shape["_meshRef"] = mesh_ref
        # A baked group renders its importedMesh, not its operands. Preserve
        # each operand's source visibility so Ungroup restores editable cutters.
        if tags.get("visible") is False:
            shape["hidden"] = True
        return shape

    def _generic_mesh_node(self, node: dict, name: str, color: str, hole: bool, mesh: dict, kind: str = "shape") -> dict:
        positions = mesh["positions"]
        space = mesh.get("space", "local")
        if space == "world":
            shape = self._baked_world_mesh(node, name, color, positions, hole, mesh.get("normals"))
        else:
            raise ValueError("Expected an evaluated world mesh")
        self.counts.setdefault(kind, 0)
        self.counts[kind] += 1
        return shape

    def _baked_world_mesh(self, node: dict, name: str, color: str, positions: list[float], hole: bool = False, normals: list[float] | None = None) -> dict:
        converted = []
        for index in range(0, len(positions) - 2, 3):
            x, y, z = to_y_up((positions[index], positions[index + 1], positions[index + 2]))
            converted.extend((x, y, z))
        bounds = point_bounds(converted)
        width = positive(bounds[1] - bounds[0])
        height = positive(bounds[3] - bounds[2])
        depth = positive(bounds[5] - bounds[4])
        center_x = (bounds[0] + bounds[1]) / 2
        center_z = (bounds[4] + bounds[5]) / 2
        local = []
        for index in range(0, len(converted) - 2, 3):
            local.extend((converted[index] - center_x, converted[index + 1] - bounds[2], converted[index + 2] - center_z))
        shape = self._base(node, name=name, kind="mesh", color=color, width=width, depth=depth, height=height, x=center_x, z=center_z, elevation=bounds[2], hole=hole)
        shape["_objectType"] = "imported"
        shape["_meshRef"] = self._mesh_asset(name, local, width, depth, height, "json", self._y_up_normals(normals))
        shape["_bounds"] = bounds
        shape["_world_center"] = (center_x, bounds[2] + height / 2, center_z)
        shape["_world_dir"] = (0.0, 1.0, 0.0)
        return shape

    @staticmethod
    def _y_up_normals(normals: list[float] | None) -> list[float] | None:
        if normals is None:
            return None
        return [v for i in range(0, len(normals), 3) for v in to_y_up(tuple(normals[i:i+3]))]

    def _mesh_asset(self, name: str, positions: list[float], width: float, depth: float, height: float, source_format: str = "stl", normals: list[float] | None = None) -> dict:
        blob = encode_mesh(positions, normals)
        digest = hashlib.sha256(blob).hexdigest()
        asset_id = f"mesh-{digest[:16]}"
        if asset_id not in self._asset_blobs:
            path = f"assets/derived-mesh/{asset_id}.bin"
            self._asset_blobs[asset_id] = blob
            self._assets.append({
                "id": asset_id,
                "kind": "derived-mesh",
                "path": path,
                "mediaType": "application/vnd.layerling.mesh",
                "byteLength": len(blob),
                "sha256": digest,
                "fileName": name,
            })
        return {
            "meshAssetId": asset_id,
            "baseWidth": width,
            "baseDepth": depth,
            "baseHeight": height,
            "triangleCount": len(positions) // 9,
            "sourceFormat": source_format,
        }

    def _base(self, node: dict, name: str, kind: str, color: str, width: float, depth: float, height: float, x: float, z: float, elevation: float, hole: bool) -> dict:
        shape = {
            "_sourceId": str(node.get("versions_id") or name),
            "id": self.unique_id(str(node.get("versions_id") or name)),
            "name": str(name)[:80] or "Shape",
            "kind": kind,
            "color": color,
            "x": x,
            "z": z,
            "elevation": elevation,
            "size": max(width, depth),
            "width": width,
            "depth": depth,
            "height": height,
            "rotation": 0,
            "rotationX": 0,
            "rotationZ": 0,
            "_children": [],
            "_objectType": "native",
            "_rotation": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            "_mirrors": (1.0, 1.0, 1.0),
        }
        if hole:
            shape["hole"] = True
        if (node.get("tags") or {}).get("visible") is False:
            shape["hidden"] = True
        return shape


def union_bounds(bounds_list) -> tuple[float, float, float, float, float, float]:
    boxes = list(bounds_list)
    return (
        min(box[0] for box in boxes),
        max(box[1] for box in boxes),
        min(box[2] for box in boxes),
        max(box[3] for box in boxes),
        min(box[4] for box in boxes),
        max(box[5] for box in boxes),
    )


def point_bounds(positions: list[float]) -> tuple[float, float, float, float, float, float]:
    xs = positions[0::3]
    ys = positions[1::3]
    zs = positions[2::3]
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


def validate_mesh(positions: list[float], normals: list[float] | None = None) -> None:
    def valid(values):
        return all(isinstance(v, (int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in values)
    if not positions or len(positions) % 9 or not valid(positions):
        raise ValueError("Mesh positions must contain finite complete triangles")
    if normals is not None and (not isinstance(normals,list) or len(normals) != len(positions) or not valid(normals)):
        raise ValueError("Mesh normals must match positions and be finite")


def encode_mesh(positions: list[float], normals: list[float] | None = None) -> bytes:
    validate_mesh(positions,normals)
    blob = bytearray(b"LYLMSH1\0")
    blob += struct.pack("<II", len(positions), len(normals) if normals is not None else 0)
    blob += struct.pack("<" + "d" * len(positions), *(v if v else 0.0 for v in positions))
    if normals:
        blob += struct.pack("<" + "d" * len(normals), *(v if v else 0.0 for v in normals))
    return bytes(blob)


def scene_bounds(shapes: list[dict]) -> tuple[float, float, float, float]:
    bounds = union_bounds(shape["_bounds"] for shape in shapes)
    return bounds[0], bounds[1], bounds[4], bounds[5]


def convert_notes(notes: list[dict]) -> list[dict]:
    if not isinstance(notes, list) or len(notes) > 200:
        raise ValueError("Layerling supports at most 200 notes per project; export stopped to avoid losing notes.")
    result = []
    for i, note in enumerate(notes):
        text = note.get("content") if isinstance(note, dict) else None
        position = note.get("position") if isinstance(note, dict) else None
        values = [position.get(k) for k in ("x", "y", "z")] if isinstance(position, dict) else []
        if (not isinstance(text, str) or len(text.encode("utf-16-le", errors="surrogatepass")) > 4000
                or len(values) != 3 or any(type(v) not in (int, float) or not math.isfinite(v) for v in values)):
            raise ValueError(f"Note {i+1} has invalid text/position or exceeds Layerling's 2,000-character limit; export stopped to avoid losing notes.")
        x, y, z = values
        result.append({"id":f"tinkercad-note-{i+1}", "text":text, "x":x, "y":z, "z":-y, "collapsed":True})
    return result


def build_document(name: str, state_nodes: list[dict], root_ids: list[str], features: list[dict], groups: list[dict], sketches: list[dict], assets: list[dict], shapes: list[dict], notes: list[dict] | None = None) -> dict:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    min_x, max_x, min_z, max_z = scene_bounds(shapes)
    span = max(200.0, max_x - min_x + 40, max_z - min_z + 40, abs(min_x) * 2 + 40, abs(max_x) * 2 + 40, abs(min_z) * 2 + 40, abs(max_z) * 2 + 40)
    plate = int(math.ceil(span / 10.0) * 10)
    scene_notes = convert_notes([] if notes is None else notes)
    return {
        "schema": SCHEMA,
        "formatVersion": FORMAT_VERSION,
        "minimumReaderVersion": FORMAT_VERSION,
        "createdWithVersion": "tinkercad-import",
        "metadata": {
            "projectName": name,
            "units": "mm",
            "createdAt": now,
            "modifiedAt": now,
        },
        "assets": assets,
        "sceneStateId": "scene",
        "states": [{"id": "scene", "rootNodeIds": root_ids, "nodes": state_nodes, **({"notes":scene_notes} if scene_notes else {})}],
        "history": {"entries": [{"stateId": "scene", "selectedObjectIds": [], "recordedAt": now}], "index": 0},
        "sketches": sketches,
        "features": features,
        "groups": groups,
        "workplanes": [{"id": "workplane-base", "kind": "base", "elevation": 0}],
        "exactCad": [],
        "editor": {
            "workspace": {
                "width": plate,
                "depth": plate,
                "sizePreset": f"{plate} x {plate} mm",
                "units": "Metric (Default)",
                "scale": "1:1 (millimeters)",
                "showGrid": True,
                "showAxes": True,
                # Layerling's automatic mesh-only edges use a 14 degree crease cutoff,
                # outlining every facet of Tinkercad's 24-sided curved presets. Its
                # normal workspace outline mode uses 25 degrees, preserving sharp rims.
                "edgeLines": True,
            },
            "snapGrid": "1.0 mm",
            "selectedWorkplaneId": "workplane-base",
            "placementElevation": 0,
        },
    }


def write_lyl(path: Path, document: dict, blobs: dict[str, bytes], assets: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("project.json", json.dumps(document, separators=(",", ":")))
        by_id = {asset["id"]: asset for asset in assets}
        for asset_id, blob in blobs.items():
            archive.writestr(by_id[asset_id]["path"], blob)


def load_input(path: Path) -> tuple[list[dict], dict, list[dict]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data, {}, []
    if isinstance(data, dict) and isinstance(data.get("shapes"), list):
        notes = data.get("notes", [])
        convert_notes(notes)
        return data["shapes"], data.get("meshes") or {}, notes
    raise SystemExit(f"{path} is not a Tinkercad shape tree.")


def self_test() -> None:
    import unittest
    from test_converter import ConverterTests
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(ConverterTests))
    if not result.wasSuccessful():
        raise SystemExit(1)
    print("self-test ok")


def main() -> None:
    if "--self-test" in sys.argv:
        self_test()
        return
    parser = argparse.ArgumentParser(description="Convert a Tinkercad shape tree into a layerling .lyl project.")
    parser.add_argument("source", type=Path, help="Complete evaluated-world JSON from the accompanying bookmarklet")
    parser.add_argument("-o", "--output", type=Path, required=True, help="Where to write the .lyl file")
    parser.add_argument("--name", help="Project name. Defaults to the output file name.")
    args = parser.parse_args()
    nodes, meshes, notes = load_input(args.source)
    converter = Converter(meshes)
    shapes, state_nodes, features, groups, sketches = converter.convert(nodes)
    root_ids = []
    # The first nodes emitted are not ordered as roots. Recover roots from the tree walk stored on shapes via re-emit ids.
    # convert() already returned state nodes; roots are those not listed as a child.
    child_ids = {child_id for node in state_nodes for child_id in node.get("groupedShapeNodeIds") or []}
    root_ids = [node["nodeId"] for node in state_nodes if node["nodeId"] not in child_ids]
    # Features were built with the convert() root order. Rebuild so they match root_ids.
    features, groups, sketches = converter._indexes(root_ids, {node["nodeId"]: node for node in state_nodes})
    document = build_document(args.name or args.output.stem, state_nodes, root_ids, features, groups, sketches, converter._assets, shapes, notes)
    write_lyl(args.output, document, converter._asset_blobs, converter._assets)
    print(f"Wrote {args.output}")
    print("Shapes:", ", ".join(f"{count} {name}" for name, count in converter.counts.items() if count))



if __name__ == "__main__":
    main()
