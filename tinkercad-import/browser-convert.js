/* Browser implementation of the evaluated-world JSON -> Layerling v2 writer.
 * Kept dependency-free so it can be embedded in the install page/bookmarklet. */
(function (root) {
  "use strict";
  const MIN_SIZE = 0.05;
  function convertNotes(notes = []) {
    if (!Array.isArray(notes) || notes.length > 200)
      throw Error("Layerling supports at most 200 notes per project; export stopped to avoid losing notes.");
    return notes.map((note, i) => {
      if (typeof note?.content !== "string" || note.content.length > 2000 ||
          ![note.position?.x,note.position?.y,note.position?.z].every(v => typeof v === "number" && Number.isFinite(v)))
        throw Error(`Note ${i+1} has invalid text/position or exceeds Layerling's 2,000-character limit; export stopped to avoid losing notes.`);
      return {id:`tinkercad-note-${i+1}`,text:note.content,x:note.position.x,
        y:note.position.z,z:-note.position.y,collapsed:true};
    });
  }
  function unionBounds(shapes) {
    const result = [
      Infinity,
      -Infinity,
      Infinity,
      -Infinity,
      Infinity,
      -Infinity,
    ];
    for (const shape of shapes)
      for (let k = 0; k < 6; k++)
        result[k] =
          k % 2
            ? Math.max(result[k], shape._bounds[k])
            : Math.min(result[k], shape._bounds[k]);
    return result;
  }
  const positive = (n) => Math.max(MIN_SIZE, Math.abs(n));
  const bounds = (p) => {
    const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const x = p[i + k];
        b[k * 2] = Math.min(b[k * 2], x);
        b[k * 2 + 1] = Math.max(b[k * 2 + 1], x);
      }
    return b;
  };
  const colorOf = (c) => {
    if (!c || typeof c !== "object") return "";
    return (
      "#" +
      [c.r, c.g, c.b]
        .map((x) =>
          Math.max(0, Math.min(255, Math.trunc(Number(x) || 0)))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  };
  const visibleChildren = (n) =>
    (n.children || []).filter((x) => !x.tags?.preview);
  const compareNumbers = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  const equalNumbers = (a, b) =>
    a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-5);
  function canonicalTriangles(mesh) {
    const triangles = [];
    for (let i = 0; i < mesh.positions.length; i += 9) {
      const vertices = [];
      for (let j = i; j < i + 9; j += 3)
        vertices.push([
          ...mesh.positions.slice(j, j + 3),
          ...(mesh.normals || []).slice(j, j + 3),
        ]);
      // Cyclic rotations preserve a face; reversing its winding does not.
      const rotations = vertices.map((_, k) =>
        [...vertices.slice(k), ...vertices.slice(0, k)].flat(),
      );
      triangles.push(rotations.sort(compareNumbers)[0]);
    }
    return triangles.sort(compareNumbers).flat();
  }
  async function sameConvexSurface(first, second) {
    const points = (p) =>
      Array.from({ length: p.length / 3 }, (_, i) => p.slice(i * 3, i * 3 + 3));
    const a = points(first),
      b = points(second);
    a.sort(compareNumbers);
    b.sort(compareNumbers);
    if (
      a.length !== b.length ||
      a.some((p, i) => Math.hypot(...p.map((v, k) => v - b[i][k])) > 1e-5)
    )
      return false;
    const closedConvex = async (positions) => {
      const vertices = points(positions),
        unique = [
          ...new Map(vertices.map((v) => [JSON.stringify(v), v])).values(),
        ];
      const center = [0, 1, 2].map(
          (k) => unique.reduce((sum, v) => sum + v[k], 0) / unique.length,
        ),
        edges = new Map();
      let orientation = 0;
      for (let i = 0; i < vertices.length; i += 3) {
        if (i && i % 192 === 0)
          await new Promise((resolve) => setTimeout(resolve, 0));
        const [p, q, r] = vertices.slice(i, i + 3),
          u = q.map((v, k) => v - p[k]),
          v = r.map((x, k) => x - p[k]);
        let n = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
          ],
          length = Math.hypot(...n);
        if (length < 1e-12) continue;
        n = n.map((x) => x / length);
        const side = n.reduce((sum, x, k) => sum + x * (center[k] - p[k]), 0),
          winding = side > 1e-12 ? -1 : side < -1e-12 ? 1 : 0;
        if (!winding || (orientation && orientation !== winding)) return 0;
        orientation = winding;
        if (side > 0) n = n.map((x) => -x);
        if (
          unique.some(
            (x) => n.reduce((sum, c, k) => sum + c * (x[k] - p[k]), 0) > 1e-4,
          )
        )
          return 0;
        for (const [x, y] of [
          [p, q],
          [q, r],
          [r, p],
        ]) {
          const endpoints = [x, y]
              .map((point) => point.map((c) => Math.round(c * 1e4) / 1e4))
              .sort(compareNumbers),
            key = JSON.stringify(endpoints);
          edges.set(key, (edges.get(key) || 0) + 1);
        }
      }
      return edges.size > 0 && [...edges.values()].every((n) => n === 2)
        ? orientation
        : 0;
    };
    const firstOrientation = await closedConvex(first);
    return (
      firstOrientation !== 0 &&
      firstOrientation === (await closedConvex(second))
    );
  }
  function validateMesh(m, id) {
    const p = m?.positions,
      n = m?.normals;
    if (
      m?.space !== "world" ||
      !(Array.isArray(p) || p instanceof Float64Array) ||
      !p.length ||
      p.length % 9 ||
      !p.every(Number.isFinite)
    )
      throw Error(id + ": expected finite complete world-space triangles");
    if (
      n != null &&
      (!(Array.isArray(n) || n instanceof Float64Array) || n.length !== p.length || !n.every(Number.isFinite))
    )
      throw Error(id + ": invalid normals");
  }
  async function packZipEntry(data, checkCancelled, signal) {
    const crcTable = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();
    const crc = async (data) => {
      let c = 0xffffffff;
      if (data instanceof Blob) {
        const reader = data.stream().getReader();
        let processed = 0;
        try {
          while (true) {
            checkCancelled();
            const {value,done} = await reader.read();
            if (done) break;
            for (let i=0;i<value.length;i++) c = crcTable[(c ^ value[i]) & 255] ^ (c >>> 8);
            processed += value.length;
            if (processed >= 1048576) {
              processed = 0;
              await new Promise(resolve => setTimeout(resolve,0));
            }
          }
        } finally {await reader.cancel(); reader.releaseLock();}
        return (c ^ 0xffffffff) >>> 0;
      }
      for (let start = 0; start < data.length; start += 1048576) {
        checkCancelled();
        const end = Math.min(start + 1048576, data.length);
        for (let i = start; i < end; i++)
          c = crcTable[(c ^ data[i]) & 255] ^ (c >>> 8);
        if (end < data.length)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    const compress = async (data) => {
      if (typeof root.CompressionStream !== "function") return null;
      let compressor;
      try {
        compressor = new root.CompressionStream("deflate-raw");
      } catch (error) {
        // Older browsers can still write the same project without compression.
        if (error?.name === "TypeError") return null;
        throw error;
      }
      const reader = new Blob([data]).stream()
        .pipeThrough(compressor, { signal }).getReader();
      const parts = [];
      try {
        while (true) {
          checkCancelled();
          const { value, done } = await reader.read();
          if (done) break;
          parts.push(value);
        }
        checkCancelled();
        return new Blob(parts);
      } finally {
        reader.releaseLock();
      }
    };
    checkCancelled();
    const size = data instanceof Blob ? data.size : data.length;
    const sum = await crc(data), compressed = data instanceof Blob ? null : await compress(data);
    checkCancelled();
    const method = compressed && compressed.size < size ? 8 : 0;
    return {payload: method ? compressed : data, sum, size,
      storedSize: method ? compressed.size : size, method};
  }
  async function zipProject(entries, onProgress, checkCancelled, signal, mimeType = "application/vnd.layerling.project+zip") {
    if (entries.length >= 65535)
      throw Error(
        "This project has too many files for the browser ZIP writer.",
      );
    const enc = new TextEncoder(),
      files = [],
      chunks = [];
    let offset = 0;
    const u16 = (v) => [v & 255, (v >>> 8) & 255],
      u32 = (v) => [
        v & 255,
        (v >>> 8) & 255,
        (v >>> 16) & 255,
        (v >>> 24) & 255,
      ];
    for (const [name, value] of entries) {
      checkCancelled();
      const n = enc.encode(name);
      if (n.length > 65535)
        throw Error("This project exceeds the browser ZIP format size limit.");
      onProgress(`Packaging project (${files.length}/${entries.length})…`);
      const packed = value.payload !== undefined ? value : await packZipEntry(
        typeof value === "string" ? enc.encode(value) : value, checkCancelled, signal);
      const {payload, sum, size, storedSize, method} = packed;
      if (size >= 0xffffffff)
        throw Error("This project exceeds the browser ZIP format size limit.");
      if (offset > 0xffffffff - storedSize - 30 - n.length)
        throw Error("This project exceeds the browser ZIP format size limit.");
      const head = new Uint8Array([
        ...u32(0x04034b50),
        ...u16(20),
        ...u16(0x0800),
        ...u16(method),
        ...u16(0),
        ...u16(0x21),
        ...u32(sum),
        ...u32(storedSize),
        ...u32(size),
        ...u16(n.length),
        ...u16(0),
        ...n,
      ]);
      chunks.push(head, payload);
      files.push({ n, sum, size, storedSize, method, offset });
      offset += head.length + storedSize;
      onProgress(`Packaging project (${files.length}/${entries.length})…`);
      if (files.length % 8 === 0)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    checkCancelled();
    const central = [];
    for (const f of files)
      central.push(
        new Uint8Array([
          ...u32(0x02014b50),
          ...u16(20),
          ...u16(20),
          ...u16(0x0800),
          ...u16(f.method),
          ...u16(0),
          ...u16(0x21),
          ...u32(f.sum),
          ...u32(f.storedSize),
          ...u32(f.size),
          ...u16(f.n.length),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u32(0),
          ...u32(f.offset),
          ...f.n,
        ]),
      );
    const centralSize = central.reduce((a, x) => a + x.length, 0),
      end = new Uint8Array([
        ...u32(0x06054b50),
        ...u16(0),
        ...u16(0),
        ...u16(files.length),
        ...u16(files.length),
        ...u32(centralSize),
        ...u32(offset),
        ...u16(0),
      ]);
    if (offset + centralSize + end.length > 0xffffffff)
      throw Error("This project exceeds the browser ZIP format size limit.");
    checkCancelled();
    return new Blob([...chunks, ...central, end], {
      type: mimeType,
    });
  }
  async function convertTinkercadToLayerling(
    input,
    projectName = "Tinkercad design",
    { onProgress = () => {}, signal, onDiagnostic = () => {},
      assemblyLimits, onLargeProject, output = "single", onOutput = () => {} } = {},
  ) {
    const nodes = Array.isArray(input) ? input : input?.shapes,
      meshes = input?.meshes || {};
    if (!Array.isArray(nodes))
      throw Error("The selected file is not a Tinkercad export.");
    const notes = convertNotes(input?.notes);
    if (input.format && input.format !== "tinkercad-evaluated-world-v1")
      throw Error(
        "Unsupported capture format; export again with the current bookmark.",
      );
    if (!root.crypto?.subtle)
      throw Error(
        "This browser requires HTTPS or the downloaded HTML page for local conversion.",
      );
    if (typeof meshes !== "object" || Array.isArray(meshes))
      throw Error("Meshes must be a table keyed by source identity.");
    const meshFor = async (id) => {
      checkCancelled();
      const mesh = typeof input?.readMesh === "function" ? await input.readMesh(id)
        : Object.prototype.hasOwnProperty.call(meshes, id) ? meshes[id] : null;
      checkCancelled();
      if (mesh) validateMesh(mesh, id);
      return mesh;
    };
    const identities = new Set();
    const validateNodes = (items) => {
      if (!Array.isArray(items)) throw Error("Shape children must be a list.");
      for (const node of items) {
        if (!node || typeof node !== "object" || Array.isArray(node))
          throw Error("Each source shape must be an object.");
        if (node.tags?.preview) continue;
        const id = node.versions_id;
        if (typeof id !== "string" || !id || identities.has(id))
          throw Error("Missing or repeated source shape identity: " + id);
        identities.add(id);
        validateNodes(node.children === undefined ? [] : node.children);
      }
    };
    validateNodes(nodes);
    const checkCancelled = () => {
      if (signal?.aborted) {
        const error = new Error("Import cancelled.");
        error.name = "AbortError";
        throw error;
      }
    };
    const report = onProgress;
    onProgress = message => { checkCancelled(); report(message); };
    const pause = async () => {
      checkCancelled();
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkCancelled();
    };
    let completed = 0;
    onProgress("Checking geometry…");
    await pause();
    let validated = 0;
    for (const [id, m] of Object.entries(meshes)) {
      validateMesh(m, id);
      if (++validated % 8 === 0) await pause();
    }
    const seen = new Set(),
      ids = new Set(),
      assets = [],
      binary = new Map();
    let packedOutputBytes = 0;
    const unique = (raw) => {
      let base =
          String(raw || "shape").replace(/[^\p{L}\p{N}]/gu, "-") || "shape",
        id = base,
        i = 2;
      while (ids.has(id)) id = base + "-" + i++;
      ids.add(id);
      return id;
    };
    const addMesh = async (name, p, n, w, d, h, x, elevation, z) => {
      checkCancelled();
      if (16 + (p.length + (n?.length || 0)) * 8 > 0xffffffff)
        throw Error("A mesh exceeds the browser ZIP format size limit.");
      onDiagnostic({phase:"mesh-allocate", plannedBinaryBytes:16 + (p.length + (n?.length || 0)) * 8});
      const bytes = new Uint8Array(16 + (p.length + (n?.length || 0)) * 8),
        view = new DataView(bytes.buffer);
      onDiagnostic({phase:"mesh-bytes", currentBinaryBytes:bytes.byteLength});
      bytes.set([76, 89, 76, 77, 83, 72, 49, 0]);
      view.setUint32(8, p.length, true);
      view.setUint32(12, n?.length || 0, true);
      let at = 16;
      const write = value => {
        view.setFloat64(at, value === 0 ? 0 : value, true);
        at += 8;
      };
      for (let i = 0; i < p.length; i += 3) {
        if (i && i % 98304 === 0) await pause();
        write(p[i] - x);
        write(p[i + 2] - elevation);
        write(-p[i + 1] - z);
      }
      if (n)
        for (let i = 0; i < n.length; i += 3) {
          if (i && i % 98304 === 0) await pause();
          write(n[i]);
          write(n[i + 2]);
          write(-n[i + 1]);
        }
      return crypto.subtle.digest("SHA-256", bytes).then(async (hash) => {
        checkCancelled();
        const hex = [...new Uint8Array(hash)]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join(""),
          id = "mesh-" + hex.slice(0, 16);
        if (!binary.has(id)) {
          const path = `assets/derived-mesh/${id}.bin`;
          onProgress(`Compressing mesh (${assets.length + 1})…`);
          onDiagnostic({phase:"compress", uniqueMeshes:assets.length, packedOutputBytes});
          const packed = await packZipEntry(bytes, checkCancelled, signal);
          binary.set(id, packed);
          packedOutputBytes += packed.storedSize;
          onDiagnostic({phase:"compressed", uniqueMeshes:assets.length + 1, packedOutputBytes});
          assets.push({
            id,
            kind: "derived-mesh",
            path,
            mediaType: "application/vnd.layerling.mesh",
            byteLength: bytes.length,
            sha256: hex,
            fileName: name,
          });
        }
        return {
          meshAssetId: id,
          baseWidth: w,
          baseDepth: d,
          baseHeight: h,
          triangleCount: p.length / 9,
          sourceFormat: "json",
        };
      });
    };
    const mkNode = async (node, parentColor = null, parentHole = false) => {
      if (!node || node.tags?.preview) return null;
      const raw = String(node.versions_id || "");
      if (!raw || seen.has(raw))
        throw Error("Missing or repeated source shape identity: " + raw);
      seen.add(raw);
      const tags = node.tags || {},
        own = colorOf(tags.renderingMaterial?.color),
        hole = parentHole || tags.volumePolarity === -1,
        csg = node.dataType === "csg";
      const kids = [];
      let omittedKid = false;
      let groupMesh = null,
        bundle = false,
        name,
        col;
      if (csg) {
        bundle = node.params?.groupType === 0;
        name = tags.label || (bundle ? "Bundle" : "Group");
        col = own && own !== "#dde2e4" ? own : parentColor || own;
        const rawKids = visibleChildren(node),
          childColor = parentColor || (tags.isMulticolor ? null : own || null);
        const childHole =
          hole && rawKids.every((x) => x.tags?.volumePolarity !== -1);
        for (const child of rawKids) {
          const c = await mkNode(child, childColor, childHole);
          if (c) kids.push(c);
          else omittedKid = true;
        }
        if (!kids.length) return null;
        if (!bundle) {
          // A Boolean result only represents its original operation while all
          // operands remain present. Drop the whole subtree if one failed.
          if (omittedKid) return null;
          groupMesh = await meshFor(raw);
          if (!groupMesh && input?.failures?.some(failure => failure.id === raw)) return null;
          if (!groupMesh)
            throw Error(raw + ": missing evaluated boolean mesh; export again");
        }
      } else {
        name =
          tags.label ||
          node.params?.fileName ||
          node.params?.id ||
          node.dataType;
        col = parentColor || own || "#d41721";
      }
      const m = csg ? (bundle ? null : groupMesh) : await meshFor(raw);
      if (!csg && !m && input?.failures?.some(failure => failure.id === raw)) return null;
      if (!csg && !m)
        throw Error(raw + ": missing evaluated world mesh; export again");
      let b,
        x,
        z,
        elevation,
        w,
        d,
        h,
        ref = null;
      if (m) {
        const sourceBounds = bounds(m.positions);
        b = [sourceBounds[0], sourceBounds[1], sourceBounds[4], sourceBounds[5], -sourceBounds[3], -sourceBounds[2]];
        x = (b[0] + b[1]) / 2;
        z = (b[4] + b[5]) / 2;
        elevation = b[2];
        w = positive(b[1] - b[0]);
        h = positive(b[3] - b[2]);
        d = positive(b[5] - b[4]);
        ref = await addMesh(name, m.positions, m.normals, w, d, h, x, elevation, z);
      } else {
        b = unionBounds(kids);
        x = (b[0] + b[1]) / 2;
        z = (b[4] + b[5]) / 2;
        elevation = b[2];
        w = positive(b[1] - b[0]);
        h = positive(b[3] - b[2]);
        d = positive(b[5] - b[4]);
      }
      if (csg)
        for (const k of kids) {
          k.x -= x;
          k.z -= z;
          k.elevation -= elevation;
        }
      const shape = {
        id: unique(raw),
        name: String(name || "Shape").slice(0, 80) || "Shape",
        kind: "mesh",
        color: col,
        x,
        z,
        elevation,
        size: Math.max(w, d),
        width: w,
        depth: d,
        height: h,
        rotation: 0,
        rotationX: 0,
        rotationZ: 0,
        _children: kids,
        _objectType: csg ? "group" : "imported",
        _bounds: b,
      };
      if (hole) shape.hole = true;
      if (tags.visible === false) shape.hidden = true;
      if (csg) {
        shape.groupOperation = bundle ? "bundle" : "group";
        shape.groupedBaseWidth = w;
        shape.groupedBaseDepth = d;
        shape.groupedBaseHeight = h;
        shape.multicolor = true;
        if (ref) {
          const colors = new Set(
            kids.filter((k) => !k.hole && !k.hidden).map((k) => k.color),
          );
          if (colors.size <= 1) {
            shape.multicolor = false;
            if (colors.size) shape.color = [...colors][0];
          }
        }
      }
      if (ref) shape._meshRef = ref;
      shape._sourceId = raw;
      completed++;
      onDiagnostic({phase:"convert", processedParts:completed});
      onProgress(`Converting parts (${completed}/${identities.size})…`);
      if (completed % 8 === 0) await pause();
      return shape;
    };
    const shapes = [];
    for (const node of nodes) {
      const s = await mkNode(node);
      if (s) shapes.push(s);
    }
    if (!shapes.length) throw Error("No shapes to convert.");
    // Hide only complete, identical triangle surfaces within a root. Keep the
    // earlier copy in the editable tree and let the last source material render.
    onDiagnostic({phase:"surface-comparison"});
    onProgress("Checking overlapping surfaces…");
    onDiagnostic({phase:"surface-comparison"});
    await pause();
    let checkedSurfaces = 0;
    for (const rootShape of shapes) {
      // A baked root has no sibling surface to compare within this root.
      if (rootShape._meshRef) continue;
      const surfaces = new Map();
      const visitShape = async (s) => {
        if (++checkedSurfaces % 8 === 0) {
          onProgress(`Checking surfaces (${checkedSurfaces})…`);
          await pause();
        }
        if (s.hidden || s.hole) return;
        if (s._meshRef) {
          const m = await meshFor(s._sourceId);
          if (!m) return;
          const key = m.positions.length + ":" + Boolean(s.transparent),
            prior = surfaces.get(key) || [];
          const b = bounds(m.positions);
          let sig = null;
          for (const prev of prior) {
            if (
              b.some((v, i) => Math.abs(v - prev.bounds[i]) > 1e-5) ||
              (m.normals?.length || 0) !== prev.normalCount
            )
              continue;
            const previousMesh = await meshFor(prev.sourceId);
            let same =
              equalNumbers(m.positions, previousMesh.positions) &&
              equalNumbers(m.normals || [], previousMesh.normals || []);
            if (!same) {
              if (sig === null) sig = canonicalTriangles(m);
              same = equalNumbers(sig, canonicalTriangles(previousMesh));
            }
            if (!same && !m.normals?.length)
              same = await sameConvexSurface(m.positions, previousMesh.positions);
            if (same) {
              prev.shape.hidden = true;
              prev.shape = s;
              prev.bounds = b;
              prev.sourceId = s._sourceId;
              return;
            }
          }
          prior.push({ shape: s, bounds: b, sourceId: s._sourceId, normalCount: m.normals?.length || 0 });
          surfaces.set(key, prior);
          return;
        }
        for (const child of s._children) await visitShape(child);
      };
      await visitShape(rootShape);
      await pause();
    }
    const stateNodes = [];
    function emit(s, path) {
      const nodeId = path + "/" + s.id,
        childIds = s._children.map((c) => emit(c, nodeId + "/group"));
      const def = {};
      for (const [k, v] of Object.entries(s))
        if (!k.startsWith("_") && k !== "_children") def[k] = v;
      const n = {
        nodeId,
        objectId: s.id,
        objectType: s._objectType,
        workplaneId: "base",
        definition: def,
      };
      if (childIds.length) n.groupedShapeNodeIds = childIds;
      if (s._meshRef) n.importedMesh = s._meshRef;
      stateNodes.push(n);
      return nodeId;
    }
    const rootIds = shapes.map((s) => emit(s, "scene/object"));
    stateNodes.sort((a, b) =>
      a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0,
    );
    const byId = new Map(stateNodes.map((n) => [n.nodeId, n])),
      features = [],
      groups = [],
      last = new Map(),
      visit = (id) => {
        const n = byId.get(id),
          children = n.groupedShapeNodeIds || [];
        children.forEach(visit);
        if (!children.length) return;
        const defs = children.map((c) => byId.get(c).definition),
          operation =
            n.definition.groupOperation === "bundle"
              ? "group"
              : defs.some((d) => d.hole) && defs.some((d) => !d.hole)
                ? "boolean-subtraction"
                : "group",
          fid = `feature/${id}/${operation}`;
        features.push({
          id: fid,
          type: operation,
          outputObjectId: n.objectId,
          inputObjectIds: defs.map((d) => d.id),
          dependsOnFeatureIds: children
            .filter((c) => last.has(c))
            .map((c) => last.get(c)),
        });
        groups.push({
          id: `group/${n.objectId}`,
          nodeId: id,
          objectId: n.objectId,
          memberNodeIds: children,
          operation,
        });
        last.set(id, fid);
      };
    rootIds.forEach(visit);
    const sceneBounds = unionBounds(shapes),
      bb = [sceneBounds[0], sceneBounds[1], sceneBounds[4], sceneBounds[5]];
    const span = Math.max(
        200,
        bb[1] - bb[0] + 40,
        bb[3] - bb[2] + 40,
        Math.abs(bb[0]) * 2 + 40,
        Math.abs(bb[1]) * 2 + 40,
        Math.abs(bb[2]) * 2 + 40,
        Math.abs(bb[3]) * 2 + 40,
      ),
      plate = Math.ceil(span / 10) * 10,
      now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const doc = {
      schema: "com.layerling.project",
      formatVersion: 2,
      minimumReaderVersion: 2,
      createdWithVersion: "tinkercad-import",
      metadata: {
        projectName: projectName,
        units: "mm",
        createdAt: now,
        modifiedAt: now,
      },
      assets,
      sceneStateId: "scene",
      states: [{ id: "scene", rootNodeIds: rootIds, nodes: stateNodes, ...(notes.length ? {notes} : {}) }],
      history: {
        entries: [{ stateId: "scene", selectedObjectIds: [], recordedAt: now }],
        index: 0,
      },
      sketches: [],
      features,
      groups,
      workplanes: [{ id: "workplane-base", kind: "base", elevation: 0 }],
      exactCad: [],
      editor: {
        workspace: {
          width: plate,
          depth: plate,
          sizePreset: `${plate} x ${plate} mm`,
          units: "Metric (Default)",
          scale: "1:1 (millimeters)",
          showGrid: true,
          showAxes: true,
          edgeLines: true,
        },
        snapGrid: "1.0 mm",
        selectedWorkplaneId: "workplane-base",
        placementElevation: 0,
      },
    };
    onProgress("Preparing Layerling download…");
    onDiagnostic({phase:"packaging"});
    await pause();
    if (output !== "single" && output !== "assemblies") throw Error("Unknown export mode.");
    if (typeof root.layerlingAssemblies !== "undefined") {
      const plan = root.layerlingAssemblies.plan(doc, assemblyLimits);
      const large = plan.readerIssues.length > 0 || plan.meshBytes > plan.limits.meshBytes || plan.triangles > plan.limits.triangles || plan.nodeCount > plan.limits.nodes;
      if (output === "single" && large && onLargeProject) output = await onLargeProject(plan);
      checkCancelled();
      if (output !== "single" && output !== "assemblies") throw Error("Unknown export mode.");
      if (output === "assemblies") {
        const files = [], manifest = {format:"layerling-assembly-set-v1", projectName,
          coordinateSystem:"Original Layerling workspace coordinates; no centring or translation applied",
          limits:plan.limits, readerLimits:root.layerlingAssemblies.readerLimits, parts:[]};
        const pending = plan.parts.slice(), roots = new Map(plan.roots.map(p=>[p.rootIds[0],p]));
        const assetMap = new Map(doc.assets.map(a=>[a.id,a]));
        const split = part => {
          const mid = Math.ceil(part.rootIds.length/2);
          return [part.rootIds.slice(0,mid),part.rootIds.slice(mid)].map(ids=>{
            const child = root.layerlingAssemblies.combine(ids.map(id=>roots.get(id)),assetMap);
            child.oversized = child.meshBytes > plan.limits.meshBytes || child.triangles > plan.limits.triangles || child.nodeIds.length > plan.limits.nodes;
            return child;
          });
        };
        for (let i=0;i<pending.length;i++) {
          checkCancelled();
          const part = pending[i], name = `assembly-${String(i+1).padStart(3,"0")}`;
          onProgress(`Preparing assembly ${i+1} of ${pending.length}…`);
          const project = root.layerlingAssemblies.project(doc,part,`${projectName} — ${name}`);
          const json = new TextEncoder().encode(JSON.stringify(project));
          let assessment = root.layerlingAssemblies.assess(project,json.length);
          if (assessment.issues.length && part.rootIds.length > 1) {
            pending.splice(i,1,...split(part)); i--; await pause(); continue;
          }
          const selected = [["project.json",json],
            ...project.assets.map(a => [a.path,binary.get(a.id)])];
          const blob = await zipProject(selected,onProgress,checkCancelled,signal);
          assessment = root.layerlingAssemblies.assess(project,json.length,blob.size);
          if (assessment.issues.length && part.rootIds.length > 1) {
            pending.splice(i,1,...split(part)); i--; await pause(); continue;
          }
          const importable = assessment.issues.length === 0;
          const file = importable ? `${name}.lyl` : `needs-attention/${name}.preserved-project.zip`;
          onDiagnostic({phase:"assembly-packaging",assemblyIndex:i+1,assemblyCount:pending.length});
          onProgress(`Checking assembly ${i+1} of ${pending.length}…`);
          files.push([file,await packZipEntry(blob,checkCancelled,signal)]);
          manifest.parts.push({file, rootNodeIds:part.rootIds,
            nodes:part.nodeIds.length, meshBytes:part.meshBytes, triangles:part.triangles,
            oversized:part.oversized, importable, issues:assessment.issues, downloadBytes:blob.size});
        }
        files.push(["assemblies.json",JSON.stringify(manifest,null,2)], ["README.txt",
          "Extract this transport ZIP first; it may exceed 512 MiB. Only the numbered .lyl files pass the known per-project reader limits. Each construction group and original position is retained.\n"+
          "These are separate projects. To combine them, use Layerling Import / Insert design; this path is source-inspected but not live verified.\n"+
          "Each spatial note is included once, with the nearest original construction-root centre. Its world position is unchanged.\n"+
          "Files in needs-attention are NOT importable under the current Layerling reader limits. They preserve complete construction data, but require a reader limit change or a different assembly structure. Renaming them does not fix the limit. No operands were removed.\n"+
          "Targets are estimates of expanded mesh data, triangle and part counts, not guaranteed file sizes or Layerling memory limits.\n"+
          "Assemblies marked oversized in assemblies.json contain an indivisible construction group that exceeds a target. No operands were removed or flattened.\n"]);
        const blob = await zipProject(files,onProgress,checkCancelled,signal,"application/zip");
        onOutput({extension:".zip",assemblies:manifest.parts.length,
          importable:manifest.parts.filter(p=>p.importable).length,
          blocked:manifest.parts.filter(p=>!p.importable).length,
          oversized:manifest.parts.filter(p=>p.oversized).length});
        return blob;
      }
    } else throw Error("Project compatibility module is unavailable; reinstall the exporter.");
    const checkProject = (jsonBytes,archiveBytes) => {
      const issues = root.layerlingAssemblies.assess(doc,jsonBytes,archiveBytes).issues;
      if (issues.length) throw Error("Layerling cannot open this as one project: "+issues.map(i=>i.message).join("; ")+". Use smaller assemblies; intact groups that cannot fit will be preserved separately.");
    };
    checkProject();
    const json = new TextEncoder().encode(JSON.stringify(doc));
    checkProject(json.length);
    const entries = [
      ["project.json", json],
      ...assets.map((a) => [a.path, binary.get(a.id)]),
    ];
    const blob = await zipProject(entries, onProgress, checkCancelled, signal);
    checkProject(json.length,blob.size);
    onOutput({extension:".lyl"});
    return blob;
  }
  root.convertTinkercadToLayerling = convertTinkercadToLayerling;
})(globalThis);
