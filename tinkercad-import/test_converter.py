import copy
import json
import math
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

from convert import Converter, build_document, convert_notes, encode_mesh, load_input, to_y_up, write_lyl


def leaf(id, **tags):
    return {"versions_id": id, "dataType": "preset", "params": {"id": "custom"}, "tags": tags}


def mesh(x=0):
    return {"space": "world", "positions": [x, 0, 0, x+2, 0, 0, x, 3, 4],
            "normals": [0, -.8, .6] * 3}


class ConverterTests(unittest.TestCase):
    def test_spatial_notes_preserve_text_and_world_coordinates(self):
        source = [{"uuid":"n", "content":"Fit 🟢\nKeep spaces ", "position":{"x":1,"y":2,"z":3}}]
        c = Converter({"part": mesh()})
        shapes, nodes, features, groups, sketches = c.convert([leaf("part")])
        doc = build_document("Notes", nodes, [nodes[0]["nodeId"]], features, groups, sketches, c._assets, shapes, source)
        self.assertEqual(doc["states"][0]["notes"], [{"id":"tinkercad-note-1", "text":source[0]["content"], "x":1,"y":3,"z":-2,"collapsed":True}])
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            path = Path(folder) / "capture.json"
            path.write_text(json.dumps({"shapes":[leaf("part")],"meshes":{"part":mesh()},"notes":source}), encoding="utf-8")
            self.assertEqual(load_input(path)[2], source)

    def test_notes_reject_loss_instead_of_truncating(self):
        note = {"content":"Keep", "position":{"x":0,"y":0,"z":0}}
        for notes in ([{**note,"content":"🟢"*1001}], [note]*201, [{**note,"position":{"x":True,"y":0,"z":0}}], {}):
            with self.assertRaisesRegex(ValueError, "[Nn]ote"):
                convert_notes(notes)

    def test_reversed_winding_surfaces_are_not_duplicates(self):
        for normals in (True, False):
            a, b = mesh(), mesh()
            b["positions"] = b["positions"][:3] + b["positions"][6:9] + b["positions"][3:6]
            if not normals:
                a.pop("normals"); b.pop("normals")
            tree = [{"versions_id":"bundle", "dataType":"csg", "params":{"groupType":0}, "children":[leaf("a"),leaf("b")]}]
            shapes, *_ = Converter({"a":a, "b":b}).convert(tree)
            self.assertFalse(any(s.get("hidden") for s in shapes[0]["_children"]))

    def test_world_geometry_and_normals_round_trip(self):
        source = mesh(11.125)
        c = Converter({"part": source})
        shapes, nodes, features, groups, sketches = c.convert([leaf("part")])
        n = nodes[0]; d = n["definition"]
        blob = c._asset_blobs[n["importedMesh"]["meshAssetId"]]
        count, normals = struct.unpack_from("<II", blob, 8)
        values = struct.unpack_from("<" + "d" * (count+normals), blob, 16)
        restored = []
        for i in range(0, count, 3):
            restored.extend((values[i]+d["x"], values[i+1]+d["elevation"], values[i+2]+d["z"]))
        expected = [v for i in range(0, count, 3) for v in to_y_up(tuple(source["positions"][i:i+3]))]
        self.assertEqual(restored, expected)
        self.assertEqual(list(values[count:]), [0, .6, .8] * 3)
        self.assertEqual((features, sketches), ([], []))

    def test_nearby_distinct_parts_are_never_hidden_or_moved(self):
        tree = [leaf("a"), leaf("b")]
        before = copy.deepcopy(tree)
        c = Converter({"a":mesh(), "b":mesh(.001)})
        shapes, *_ = c.convert(tree)
        self.assertEqual(tree, before)
        self.assertFalse(any(s.get("hidden") for s in shapes))
        self.assertAlmostEqual(shapes[1]["x"]-shapes[0]["x"], .001)

    def test_identical_surfaces_keep_last_source_material(self):
        red={"renderingMaterial":{"color":{"r":255,"g":0,"b":0}}}
        green={"renderingMaterial":{"color":{"r":0,"g":255,"b":0}}}
        tree=[{"versions_id":"g","dataType":"csg","params":{"groupType":0},
               "tags":{"isMulticolor":True},"children":[leaf("a",**red),leaf("b",**green)]}]
        c=Converter({"a":mesh(),"b":mesh()})
        shapes,*_=c.convert(tree)
        a,b=shapes[0]["_children"]
        self.assertTrue(a["hidden"])
        self.assertFalse(b.get("hidden"))
        self.assertEqual(b["color"],"#00ff00")

    def test_equal_bounds_do_not_make_different_meshes_duplicates(self):
        a=mesh();b=copy.deepcopy(a)
        b["positions"][3:6]=[2,3,0]
        tree=[{"versions_id":"g","dataType":"csg","params":{"groupType":0},"children":[leaf("a"),leaf("b")]}]
        shapes,*_=Converter({"a":a,"b":b}).convert(tree)
        self.assertFalse(any(x.get("hidden") for x in shapes[0]["_children"]))

    def test_different_roots_and_boolean_operands_are_retained(self):
        shapes,*_=Converter({"a":mesh(),"b":mesh()}).convert([leaf("a"),leaf("b")])
        self.assertFalse(any(x.get("hidden") for x in shapes))
        group={"versions_id":"g","dataType":"csg","params":{"groupType":1},"children":[leaf("a"),leaf("b")]}
        shapes,*_=Converter({"a":mesh(),"b":mesh(),"g":mesh()}).convert([group])
        self.assertFalse(any(x.get("hidden") for x in shapes[0]["_children"]))

    def test_boolean_cutters_remain_visible_when_ungrouped(self):
        group={"versions_id":"g","dataType":"csg","params":{"groupType":1},
               "children":[leaf("body"),leaf("cutter",volumePolarity=-1)]}
        shapes,nodes,*_=Converter({"body":mesh(),"cutter":mesh(.5),"g":mesh()}).convert([group])
        cutter=next(n for n in nodes if n['objectId']=='cutter')
        self.assertTrue(cutter['definition']['hole'])
        # Layerling's restoreGroupedChildren preserves this exact hidden flag.
        self.assertFalse(cutter['definition'].get('hidden',False))
        self.assertIn('importedMesh',next(n for n in nodes if n['objectId']=='g'))

    def test_bundle_preserves_source_cutter_visibility(self):
        group={"versions_id":"g","dataType":"csg","params":{"groupType":1},
               "children":[leaf("body"),leaf("cutter",volumePolarity=-1),
                           leaf("hidden-cutter",volumePolarity=-1,visible=False)]}
        bundle={"versions_id":"bundle","dataType":"csg","params":{"groupType":0},
                "children":[group,leaf("loose-cutter",volumePolarity=-1)]}
        _,nodes,*_=Converter({id:mesh(i) for i,id in enumerate(['g','body','cutter','hidden-cutter','loose-cutter'])}).convert([bundle])
        definitions={n['objectId']:n['definition'] for n in nodes}
        self.assertFalse(definitions['cutter'].get('hidden',False))
        self.assertFalse(definitions['loose-cutter'].get('hidden',False))
        self.assertTrue(definitions['hidden-cutter']['hidden'])

    def test_same_preset_different_geometry(self):
        c = Converter({"a":mesh(), "b":mesh(100)})
        shapes, *_ = c.convert([leaf("a"), leaf("b")])
        self.assertEqual(shapes[1]["x"]-shapes[0]["x"], 100)

    def test_missing_mesh_fails_instead_of_box_or_omission(self):
        with self.assertRaisesRegex(ValueError, "missing evaluated world mesh"):
            Converter({}).convert([leaf("missing")])
        group = {"versions_id":"g", "dataType":"csg", "params":{"groupType":1}, "children":[leaf("a")]}
        with self.assertRaisesRegex(ValueError, "missing evaluated boolean mesh"):
            Converter({"a":mesh()}).convert([group])

    def test_invalid_or_ambiguous_shape_tree_fails(self):
        for tree in ([leaf("a"),None],[leaf("a"),leaf("a")],[{"dataType":"preset"}]):
            with self.assertRaises(ValueError):Converter({"a":mesh()}).convert(tree)

    def test_bad_mesh_fails(self):
        for values in ([1, 2], [math.nan]*9, [math.inf]*9):
            with self.assertRaises(ValueError): encode_mesh(values)
            with self.assertRaises(ValueError): Converter({"a":{"space":"world","positions":values}})
        with self.assertRaises(ValueError): encode_mesh([0]*9, [1]*3)

    def test_group_children_restore_world_coordinates(self):
        tree = [{"versions_id":"g", "dataType":"csg", "params":{"groupType":0}, "children":[leaf("a"),leaf("b")]}]
        c = Converter({"a":mesh(13), "b":mesh(27)})
        shapes, nodes, *_ = c.convert(tree)
        group = shapes[0]
        for child, x in zip(group["_children"], [13,27]):
            self.assertAlmostEqual(group["x"]+child["x"], x+1)

    def test_cbshape_groups_and_bundles(self):
        inner = {"versions_id":"inner","dataType":"csg","params":{"groupType":1},
                 "children":[leaf("body"),leaf("cutter",volumePolarity=-1)]}
        cb_bundle = {"versions_id":"cb","dataType":"cbshape","params":{"groupType":0},
                     "tags":{"label":"Rounded Box"},"children":[inner,leaf("pin")]}
        c = Converter({"inner":mesh(10),"body":mesh(10),"cutter":mesh(12),"pin":mesh(30)})
        shapes, nodes, *_ = c.convert([cb_bundle])
        by_id = {n["objectId"]: n for n in nodes}
        self.assertEqual(by_id["cb"]["objectType"], "group")
        self.assertEqual(by_id["cb"]["definition"]["groupOperation"], "bundle")
        self.assertNotIn("importedMesh", by_id["cb"])
        self.assertAlmostEqual(shapes[0]["x"] + shapes[0]["_children"][1]["x"], 31)
        self.assertTrue(by_id["cutter"]["definition"]["hole"])

        # cbshape bundle nested inside a csg union
        outer = {"versions_id":"outer","dataType":"csg","params":{"groupType":1},
                 "children":[{"versions_id":"cb","dataType":"cbshape","params":{"groupType":0},
                              "children":[leaf("a"),leaf("b")]}]}
        _, nested_nodes, *_ = Converter({"outer":mesh(0),"a":mesh(0),"b":mesh(14)}).convert([outer])
        nested = {n["objectId"]: n for n in nested_nodes}
        self.assertIn("importedMesh", nested["outer"])
        self.assertEqual(nested["cb"]["definition"]["groupOperation"], "bundle")
        self.assertNotIn("importedMesh", nested["cb"])

        # cbshape with non-zero groupType behaves as a boolean group
        cb_union = {"versions_id":"cbu","dataType":"cbshape","params":{"groupType":1},"children":[leaf("a")]}
        _, union_nodes, *_ = Converter({"cbu":mesh(5),"a":mesh(5)}).convert([cb_union])
        union_by_id = {n["objectId"]: n for n in union_nodes}
        self.assertEqual(union_by_id["cbu"]["definition"]["groupOperation"], "group")
        self.assertIn("importedMesh", union_by_id["cbu"])
        with self.assertRaisesRegex(ValueError, "missing evaluated boolean mesh"):
            Converter({"a":mesh(5)}).convert([cb_union])

    def test_archive_integrity(self):
        c=Converter({"a":mesh()})
        shapes,nodes,features,groups,sketches=c.convert([leaf("a")])
        doc=build_document("Test",nodes,[nodes[0]["nodeId"]],features,groups,sketches,c._assets,shapes)
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            path=Path(tmp)/"out.lyl"
            write_lyl(path,doc,c._asset_blobs,c._assets)
            with zipfile.ZipFile(path) as z:
                self.assertIsNone(z.testzip())
                self.assertEqual(json.loads(z.read("project.json")),doc)
                for asset in c._assets: self.assertEqual(len(z.read(asset["path"])),asset["byteLength"])


if __name__ == "__main__": unittest.main()
