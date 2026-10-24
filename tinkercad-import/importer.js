/* Partition complete scene roots; never cut through a boolean construction. */
(function (root) {
  "use strict";
  // Reader compatibility boundary, verified against upstream LYL_LIMITS.
  const readerLimits = Object.freeze({archiveBytes:512*1024*1024, expandedBytes:1024*1024*1024,
    projectJsonBytes:64*1024*1024, assetBytes:256*1024*1024, entries:4096,
    states:5001, nodes:100000, features:300000, meshNumbers:30000000});
  const labels = {archiveBytes:"compressed file bytes",expandedBytes:"expanded project bytes",
    projectJsonBytes:"project.json bytes",assetBytes:"bytes in one asset",entries:"ZIP entries",
    states:"states",nodes:"nodes in one state",features:"features",meshNumbers:"numbers in one mesh array"};
  function assess(doc, projectJsonBytes, archiveBytes, limits = readerLimits) {
    const metrics = {entries:doc.assets.length+1, states:doc.states.length,
      nodes:Math.max(0,...doc.states.map(s=>s.nodes.length)),features:doc.features.length,
      assetBytes:doc.assets.reduce((n,a)=>Math.max(n,a.byteLength),0),
      meshNumbers:doc.states.reduce((max,s)=>s.nodes.reduce((n,v)=>Math.max(n,(v.importedMesh?.triangleCount || 0)*9),max),0),
      expandedBytes:doc.assets.reduce((n,a)=>n+a.byteLength,0)+(projectJsonBytes || 0)};
    if (projectJsonBytes !== undefined) metrics.projectJsonBytes = projectJsonBytes;
    if (archiveBytes !== undefined) metrics.archiveBytes = archiveBytes;
    const issues = Object.entries(metrics).filter(([key,value])=>value>limits[key])
      .map(([key,actual])=>({limit:key,actual,maximum:limits[key],message:`${labels[key]}: ${actual.toLocaleString()} exceeds ${limits[key].toLocaleString()}`}));
    return {metrics,issues};
  }
  function combine(items, assets) {
    const ids = new Set(items.flatMap(p=>p.assetIds));
    return {rootIds:items.flatMap(p=>p.rootIds),nodeIds:items.flatMap(p=>p.nodeIds),assetIds:[...ids],
      meshBytes:[...ids].reduce((sum,id)=>sum+assets.get(id).byteLength,0),
      triangles:items.reduce((sum,p)=>sum+p.triangles,0)};
  }
  const defaults = {meshBytes:100*1024*1024, triangles:1000000, nodes:1500};
  function plan(doc, limits = defaults) {
    limits = {...defaults, ...limits};
    for (const value of Object.values(limits))
      if (!Number.isFinite(value) || value <= 0) throw Error("Invalid assembly size limit.");
    const state = doc.states.find(s => s.id === doc.sceneStateId);
    if (!state) throw Error("Missing project scene.");
    const nodes = new Map(state.nodes.map(n => [n.nodeId,n]));
    const assets = new Map(doc.assets.map(a => [a.id,a]));
    const owned = new Set();
    const exceeds = p => p.meshBytes > limits.meshBytes || p.triangles > limits.triangles || p.nodeIds.length > limits.nodes;
    const roots = state.rootNodeIds.map(id => {
      const p = {rootIds:[id], nodeIds:[], assetIds:[], meshBytes:0, triangles:0};
      const used = new Set(), todo = [id];
      while (todo.length) {
        const key = todo.pop(), node = nodes.get(key);
        if (!node || owned.has(key)) throw Error("Missing or repeated assembly node.");
        owned.add(key); p.nodeIds.push(key);
        todo.push(...(node.groupedShapeNodeIds || []));
        const mesh = node.importedMesh;
        if (mesh) {
          const asset = assets.get(mesh.meshAssetId);
          if (!asset) throw Error("Missing assembly mesh asset.");
          p.triangles += mesh.triangleCount || 0;
          if (!used.has(asset.id)) {used.add(asset.id); p.meshBytes += asset.byteLength;}
        }
      }
      p.assetIds = [...used];
      p.oversized = exceeds(p);
      return p;
    });
    if (owned.size !== state.nodes.length) throw Error("Project contains unreachable assembly nodes.");
    // Keep neighbouring roots near one another without changing their coordinates.
    roots.sort((a,b) => {
      const x = nodes.get(a.rootIds[0]).definition, y = nodes.get(b.rootIds[0]).definition;
      return (x.x || 0)-(y.x || 0) || (x.z || 0)-(y.z || 0) || (a.rootIds[0] < b.rootIds[0] ? -1 : a.rootIds[0] > b.rootIds[0] ? 1 : 0);
    });
    const totalTriangles = roots.reduce((sum,p) => sum+p.triangles,0);
    const parts = [];
    let current;
    for (const p of roots) {
      const merged = combine(current ? [current,p] : [p],assets);
      if (!current || exceeds(merged)) {current = {...p}; parts.push(current);}
      else {Object.assign(current,merged); current.oversized = exceeds(current);}
    }
    return {limits, parts, roots, readerIssues:assess(doc).issues, rootCount:roots.length, nodeCount:owned.size,
      oversizedCount:parts.filter(p => p.oversized).length,
      meshBytes:doc.assets.reduce((sum,a) => sum+a.byteLength,0),
      triangles:totalTriangles};
  }
  function project(doc, part, name) {
    const ids = new Set(part.nodeIds), assets = new Set(part.assetIds);
    const state = doc.states.find(s => s.id === doc.sceneStateId);
    const nodes = state.nodes.filter(n => ids.has(n.nodeId));
    const objects = new Set(nodes.map(n => n.objectId));
    // Notes have world positions, not source-body anchors. Assign each once to
    // its nearest original root, even when an assembly is subdivided again.
    const byId = new Map(state.nodes.map(n => [n.nodeId,n]));
    const roots = new Set(part.rootIds);
    const notes = (state.notes || []).filter(note => {
      let nearest, distance = Infinity;
      for (const id of state.rootNodeIds) {
        const d = byId.get(id).definition;
        const value = Math.hypot(note.x-d.x,note.y-d.elevation,note.z-d.z);
        if (nearest === undefined || value < distance) {nearest=id;distance=value;}
      }
      return roots.has(nearest);
    });
    return {...doc, metadata:{...doc.metadata,projectName:name},
      assets:doc.assets.filter(a => assets.has(a.id)),
      states:[{...state,rootNodeIds:part.rootIds,nodes,...(state.notes ? {notes} : {})}],
      history:{entries:[{stateId:state.id,selectedObjectIds:[],recordedAt:doc.metadata.createdAt}],index:0},
      features:doc.features.filter(f => objects.has(f.outputObjectId)),
      groups:doc.groups.filter(g => ids.has(g.nodeId))};
  }
  root.layerlingAssemblies = {plan, project, combine, assess, readerLimits, defaults};
})(globalThis);
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
function* tinkercadJsonChunks(value) {
  if (Array.isArray(value) || value instanceof Float64Array) {
    yield "[";
    if (value.every(item => typeof item === "number")) {
      for (let i = 0; i < value.length; i += 8192) {
        if (i) yield ",";
        yield JSON.stringify(Array.from(value.slice(i, i + 8192))).slice(1, -1);
      }
    } else {
      for (let i = 0; i < value.length; i++) {
        if (i) yield ",";
        yield* tinkercadJsonChunks(value[i] === undefined ? null : value[i]);
      }
    }
    yield "]";
  } else if (value !== null && typeof value === "object") {
    yield "{";
    let first = true;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      if (!first) yield ",";
      first = false;
      yield JSON.stringify(key) + ":";
      yield* tinkercadJsonChunks(item);
    }
    yield "}";
  } else {
    yield JSON.stringify(value);
  }
}

async function tinkercadJsonBlob(value, checkCancelled = () => {}) {
  const blobs = [];
  let pending = [], length = 0;
  for (const chunk of tinkercadJsonChunks(value)) {
    checkCancelled();
    pending.push(chunk);
    length += chunk.length;
    if (length >= 65536) {
      blobs.push(new Blob(pending));
      pending = [];
      length = 0;
      if (blobs.length % 16 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  checkCancelled();
  if (pending.length) blobs.push(new Blob(pending));
  return new Blob(blobs, {type:"application/json"});
}

async function exportTinkercadDesign({download = true, onProgress = () => {}, signal, lazy = false, onDiagnostic = () => {}, onGeometryFailure = async () => false} = {}) {
  const cancelled = () => {
    if (signal?.aborted) {
      const error = new Error("Import cancelled.");
      error.name = "AbortError";
      throw error;
    }
  };
  cancelled();
  if (lazy && download) throw new Error("Lazy capture is for direct conversion only.");
  const tools = window.llm?.tools?.get_design_data;
  if (typeof testKit === "undefined" || !tools) {
    if (window.TinkerPower?.enable) {
      TinkerPower.enable("testkit");
      location.reload();
      return;
    }
    throw new Error("Enable Tinkercad testkit before exporting. No design data was changed.");
  }
  let shapes, notes = [];
  const roots = [...testKit.sceneModel.children.values()];
  const compactMetadata = lazy && roots.every(node =>
    node?.data?.hasBeenRemoved || (node?.data?.versions_id &&
      typeof node.data.dataType?.get === "function" &&
      typeof node.data.tags?.get === "function" &&
      typeof node.data.params?.get === "function"));
  if (compactMetadata) {
    onDiagnostic({phase:"compact-metadata"});
    notes = testKit.editorData?.notes?.values?.() || [];
    let visited = 0;
    const read = async scene => {
      cancelled();
      const data = scene?.data;
      if (data?.hasBeenRemoved) return null;
      if (!data?.versions_id || typeof data.dataType?.get !== "function" ||
          typeof data.tags?.get !== "function" || typeof data.params?.get !== "function")
        throw new Error("Unsupported Tinkercad shape metadata; export stopped.");
      if (++visited % 128 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        cancelled();
      }
      // Copy only conversion metadata, never complete source parameter/tag objects.
      const tags = {}, params = {};
      for (const key of ["preview", "visible", "label", "volumePolarity", "isMulticolor"]) {
        const value = data.tags.get(key);
        if (value !== undefined) tags[key] = value;
      }
      if (scene.visible?.get) tags.visible = scene.visible.get();
      const material = data.tags.get("renderingMaterial");
      if (material?.color !== undefined) {
        let color = material.color;
        if (typeof color === "number") {
          if (typeof window.llmUtils?.cleanColor !== "function")
            throw new Error("Tinkercad colour conversion is unavailable.");
          color = window.llmUtils.cleanColor(color);
        }
        tags.renderingMaterial = {color: color && typeof color === "object"
          ? {r:color.r, g:color.g, b:color.b} : color};
      }
      for (const key of ["id", "fileName", "groupType"]) {
        const value = data.params.get(key);
        if (value !== undefined) params[key] = value;
      }
      const node = {versions_id:data.versions_id, dataType:data.dataType.get(), tags, params};
      if (data.children?.size?.()) {
        node.children = [];
        for (const child of scene.children.values()) {
          const captured = await read(child);
          if (captured) node.children.push(captured);
        }
      }
      return node;
    };
    shapes = [];
    for (const root of roots) {
      const node = await read(root);
      if (node) shapes.push(node);
    }
  } else {
    onDiagnostic({phase:"design-data"});
    const result = await new Promise((resolve, reject) => {
      let done = false;
      const finish = (callback, value) => {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", abort);
        callback(value);
      };
      const abort = () => {
        const error = new Error("Import cancelled.");
        error.name = "AbortError";
        finish(reject, error);
      };
      signal?.addEventListener("abort", abort, {once: true});
      Promise.resolve().then(() => {
        cancelled();
        return tools.run({includeScreenshot: false});
      }).then(value => finish(resolve, value), error => finish(reject, error));
      if (signal?.aborted) abort();
    });
    const payload = result?.content?.[0]?.json || result?.json || result;
    shapes = payload?.shapes || (Array.isArray(payload) ? payload : null);
    notes = payload?.notes || [];
  }
  if (!Array.isArray(shapes)) throw new Error("Tinkercad did not return a shape tree.");
  if (!Array.isArray(notes)) throw new Error("Tinkercad did not return a notes list.");
  notes = notes.map(note => ({uuid:note?.uuid, content:note?.content,
    position:note?.position && {x:note.position.x,y:note.position.y,z:note.position.z}}));
  cancelled();
  const sceneNodes = new Map(), seen = new Set();
  function visit(node) {
    if (!node || seen.has(node)) return;
    seen.add(node);
    const id = node.data?.versions_id || node.versions_id;
    if (id) sceneNodes.set(String(id), node);
    const children = node.children;
    for (const child of (children?.values ? [...children.values()] : Array.isArray(children) ? children : [])) visit(child);
  }
  visit(testKit.sceneModel);
  const meshes = Object.create(null), meshParts = [], diagnostics = [], failures = [];
  let ignoreErrors = false;
  let captured = 0, triangles = 0;
  let total = 0;
  const sourceNodes = new Map();
  function count(nodes) {
    for (const node of nodes) {
      if (node.tags?.preview) continue;
      const id = String(node.versions_id || "");
      if (!id || sourceNodes.has(id)) throw new Error("Missing or repeated shape identity: " + id);
      sourceNodes.set(id, node);
      total++;
      count(node.children || []);
    }
  }
  count(shapes);
  onDiagnostic({phase:"metadata-ready", totalParts:total});
  const observedBuffers = new WeakSet();
  let observedGeometryBytes = 0, evaluationsStarted = 0;
  async function geometryFor(sn, node) {
    const hasTriangles = geometry => geometry?.attributes?.position?.count > 0 &&
      (!geometry.index || geometry.index.count > 0);
    const empty = geometry => geometry?.attributes?.position && !hasTriangles(geometry);
    const emptyError = () => new Error("Evaluated geometry is empty (no triangles). Export stopped without removing this part or its operands.");
    const ready = sn.geometry?.get?.();
    if (hasTriangles(ready)) return ready;
    if (typeof sn.evaluate !== "function") throw empty(ready) ? emptyError() : new Error("Missing geometry evaluator");
    onDiagnostic({phase:"evaluate", evaluationsStarted:++evaluationsStarted});
    onProgress(`Waiting for geometry: ${node.tags?.label || node.params?.id || node.versions_id}`);
    return new Promise((resolve, reject) => {
      let done = false, poll, timeout;
      const started = Date.now(), limit = 120000;
      let lastProgress = 0, promiseReturned = 0, promiseSettled = 0, callbackReceived = 0;
      const evaluationDiagnostic = phase => onDiagnostic({phase,
        evaluationElapsedMs:Date.now()-started, evaluationLimitMs:limit,
        evaluationPromiseReturned:promiseReturned, evaluationPromiseSettled:promiseSettled,
        evaluationCallbackReceived:callbackReceived});
      const finish = (error, geometry) => {
        if (done) return;
        done = true;
        clearTimeout(poll);
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(geometry);
      };
      const abort = () => {
        const error = new Error("Import cancelled.");
        error.name = "AbortError";
        finish(error);
      };
      const check = () => {
        if (done) return;
        clearTimeout(poll);
        if (signal?.aborted) return abort();
        try {
          const geometry = sn.geometry?.get?.();
          if (hasTriangles(geometry)) {
            evaluationDiagnostic("evaluation-ready");
            return finish(null, geometry);
          }
          if (empty(geometry) && (promiseSettled || callbackReceived)) return finish(emptyError());
          const elapsed = Date.now() - started;
          if (elapsed - lastProgress >= 5000) {
            lastProgress = elapsed;
            evaluationDiagnostic("evaluation-wait");
            onProgress(`Waiting for geometry: ${node.tags?.label || node.params?.id || node.versions_id} (${Math.floor(elapsed/1000)} seconds; Cancel is available)`);
          }
          poll = setTimeout(check, 50);
        } catch (error) { finish(error); }
      };
      timeout = setTimeout(() => {
        evaluationDiagnostic("evaluation-timeout");
        finish(new Error("Geometry evaluation timed out after 120 seconds; no non-empty triangle geometry became available"));
      }, limit);
      signal?.addEventListener("abort", abort, {once: true});
      if (signal?.aborted) return abort();
      try {
        // CSG groups accept a completion callback. Other evaluators may take
        // geometry parameters as their first argument, so invoke them with no args.
        const pending = node.dataType === "csg"
          ? sn.evaluate(() => {callbackReceived = 1; check();}) : sn.evaluate();
        if (pending?.then) {
          promiseReturned = 1;
          pending.then(() => {if (done) return; promiseSettled = 1; check();}, error => {
            if (done) return;
            promiseSettled = 1;
            evaluationDiagnostic("evaluation-error");
            finish(error);
          });
        }
        check();
      } catch (error) { finish(error); }
    });
  }
  // Encode each mesh while it is captured. Download mode retains Blob data,
  // rather than every expanded numeric array and a second giant JSON string.
  const shapeBlob = download ? await tinkercadJsonBlob(shapes, cancelled) : null;
  async function captureMesh(node) {
    cancelled();
    if (node.tags?.preview) return;
    const id = String(node.versions_id || "");
    const bundle = node.dataType === "csg" && node.params?.groupType === 0;
    if (!bundle) {
      const sn = sceneNodes.get(id);
      let world;
      try {
        if (!sn?.computeWorldMatrix) throw new Error("Missing scene node/world transform");
        const geometry = await geometryFor(sn, node);
        cancelled();
        if (!geometry?.attributes?.position) throw new Error("Missing evaluated geometry");
        for (const attribute of [...Object.values(geometry.attributes), geometry.index]) {
          const array = attribute?.array || attribute?.data?.array;
          if (array?.buffer && !observedBuffers.has(array.buffer)) {
            observedBuffers.add(array.buffer);
            observedGeometryBytes += array.buffer.byteLength;
          }
        }
        const vertices = geometry.index?.count || geometry.attributes.position.count;
        onDiagnostic({phase:"geometry-ready", observedGeometryBytes, currentTriangles:vertices/3,
          plannedCaptureBytes:vertices*3*8*(geometry.attributes.normal ? 2 : 1)});
        // applyMatrix4 transforms normals with the inverse transpose, including nonuniform scale.
        const matrix = sn.computeWorldMatrix();
        world = geometry.clone();
        world.applyMatrix4(matrix);
        const expand = async attribute => {
          const index = world.index;
          const length = index ? index.count : attribute.count;
          const values = new Float64Array(length * 3);
          for (let i=0; i<length; i++) {
            if (i && i % 32768 === 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
              cancelled();
            }
            const vertex = index ? index.getX(i) : i;
            values[i*3] = attribute.getX(vertex);
            values[i*3+1] = attribute.getY(vertex);
            values[i*3+2] = attribute.getZ(vertex);
          }
          return values;
        };
        const positions = await expand(world.attributes.position);
        const normals = world.attributes.normal ? await expand(world.attributes.normal) : undefined;
        onDiagnostic({phase:"captured", currentCaptureBytes:positions.byteLength + (normals?.byteLength || 0)});
        // A reflected transform reverses winding. Keep outward normals and front faces consistent.
        if (matrix.determinant() < 0) {
          for (let i = 0; i < positions.length; i += 9) {
            if (i && i % 294912 === 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
              cancelled();
            }
            for (let axis = 0; axis < 3; axis++) {
              [positions[i+3+axis], positions[i+6+axis]] = [positions[i+6+axis], positions[i+3+axis]];
              if (normals) [normals[i+3+axis], normals[i+6+axis]] = [normals[i+6+axis], normals[i+3+axis]];
            }
          }
        }
        if (!positions.length || positions.length % 9 || !positions.every(Number.isFinite)) throw new Error("Invalid triangle positions");
        if (normals && (normals.length !== positions.length || !normals.every(Number.isFinite))) throw new Error("Invalid normals");
        const mesh = {positions, normals, space:"world", csg:node.dataType === "csg"};
        if (lazy) return mesh;
        if (download) {
          if (meshParts.length) meshParts.push(",");
          meshParts.push(JSON.stringify(id) + ":", await tinkercadJsonBlob(mesh, cancelled));
        } else {
          meshes[id] = mesh;
        }
        diagnostics.push({id, triangles:positions.length / 9});
        triangles += positions.length / 9;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        const failure = {id, label:node.tags?.label || node.params?.id || id, message:String(error?.message || error)};
        if (!ignoreErrors) {
          ignoreErrors = await onGeometryFailure(failure);
          if (!ignoreErrors)
            throw new Error(`Stopped at ${failure.label} (${id}): ${failure.message}. No .lyl project was created.`);
        }
        failures.push(failure);
        onDiagnostic({phase:"geometry-failed"});
        onProgress(`Omitting failed geometry: ${failure.label}`);
        return null;
      }
      finally { world?.dispose(); }
    }
  }
  async function capture(node) {
    cancelled();
    if (node.tags?.preview) return;
    await captureMesh(node);
    for (const child of node.children || []) await capture(child);
    captured++;
    onProgress(`Capturing parts (${captured}/${total}) · ${triangles.toLocaleString()} triangles…`);
    if (captured % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (lazy) {
    return {format:"tinkercad-evaluated-world-v1", shapes, meshes, notes, failures, readMesh: async id => {
      cancelled();
      const node = sourceNodes.get(id);
      if (!node) throw new Error("Missing source shape: " + id);
      const name = node.tags?.label || node.params?.id || id;
      onProgress(`Reading geometry: ${name}…`);
      const mesh = await captureMesh(node);
      if (!mesh) return null;
      onProgress(`Read ${(mesh.positions.length / 9).toLocaleString()} triangles: ${name}`);
      return mesh;
    }};
  }
  for (const node of shapes) await capture(node);
  cancelled();
  const exported = {format:"tinkercad-evaluated-world-v1", shapes, meshes, notes, diagnostics};
  if (download) {
    const blob = new Blob([
      '{"format":"tinkercad-evaluated-world-v1","shapes":', shapeBlob,
      ',"meshes":{', ...meshParts, '},"notes":', await tinkercadJsonBlob(notes, cancelled), ',"diagnostics":', await tinkercadJsonBlob(diagnostics, cancelled), '}'
    ], {type:"application/json"});
    cancelled();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "tinkercad-design.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    alert("Exported " + diagnostics.length + " evaluated shapes and groups. No source geometry changed.");
    return {format:exported.format, shapeCount:shapes.length, meshCount:diagnostics.length, byteLength:blob.size};
  }
  return exported;
}
/* Optional online loader. The self-contained bookmark remains available offline. */
(function (root) {
  "use strict";
  root.layerlingLoadLatest = function () {
    if (!["www.tinkercad.com","tinkercad.com"].includes(location.hostname) ||
        !/^\/things\/[^/]+\/edit(?:\/|$)/.test(location.pathname)) {
      alert("Open your design in the Tinkercad editor, then click this bookmark.");
      return;
    }
    if (root.__layerlingImportSession?.busy) {
      alert("Wait for the current export to finish, or cancel it before updating.");
      return;
    }
    if (root.__layerlingLoaderActive) return;
    root.__layerlingLoaderActive = true;
    root.__layerlingRuntimeLoaded = false;
    const script = document.createElement("script");
    let done = false;
    const finish = success => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script.remove();
      root.__layerlingLoaderActive = false;
      if (success && root.__layerlingRuntimeLoaded && typeof root.runLayerlingImport === "function") void root.runLayerlingImport();
      else alert("Online importer blocked or unavailable. Use the self-contained bookmark from https://taylormadearmy.github.io/tinkercad-layerling-importer/ .");
    };
    const timer = setTimeout(() => finish(false),15000);
    script.referrerPolicy = "no-referrer";
    script.src = "https://taylormadearmy.github.io/tinkercad-layerling-importer/importer.js?t=" + Date.now();
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    try {document.head.append(script);} catch (_) {finish(false);}
  };
})(globalThis);
/* Shared browser download controls and the Tinkercad bookmark entry point. */
(function (root) {
  "use strict";
  const VERSION = "0.2.5";
  const SITE = "https://taylormadearmy.github.io/tinkercad-layerling-importer/";
  root.layerlingImporterVersion = VERSION;
  const sizeLabel = bytes => bytes >= 1024**3 ? `${(bytes/1024**3).toFixed(2)} GiB` : `${(bytes/1024**2).toFixed(1)} MiB`;
  async function checkUpdate(signal) {
    if (typeof root.fetch !== "function") throw Error("Update check unavailable");
    const response = await root.fetch(SITE+"version.json", {signal,credentials:"omit",referrerPolicy:"no-referrer",cache:"no-store"});
    if (!response.ok) throw Error("Update check unavailable");
    const text = await response.text();
    if (text.length > 4096) throw Error("Invalid update response");
    const version = JSON.parse(text).version;
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw Error("Invalid update version");
    const a = version.split(".").map(Number), b = VERSION.split(".").map(Number);
    if (!a.every(Number.isSafeInteger)) throw Error("Invalid update version");
    const diff = a.map((v,i)=>v-b[i]).find(v=>v!==0) || 0;
    return {version,newer:diff>0};
  }
  function projectName(title) {
    return (
      String(title || "")
        .replace(/^3D design\s+/i, "")
        .replace(/\s*[-|]\s*Tinkercad\s*$/i, "")
        .trim() || "Tinkercad design"
    );
  }

  function setDownload(link, blob, name, extension = ".lyl") {
    const url = URL.createObjectURL(blob);
    const filename =
      String(name)
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
        .slice(0, 120)
        .replace(/[. ]+$/, "") || "Tinkercad design";
    link.href = url;
    link.download = filename + extension;
    link.hidden = false;
    link.style.display = "inline-block";
    return () => {
      URL.revokeObjectURL(url);
      link.hidden = true;
      link.style.display = "none";
      link.removeAttribute("href");
    };
  }

  function diagnostics() {
    const key = "tinkercad-layerling:last-run:" + (location.pathname.match(/^\/things\/([^/-]+)/)?.[1] || location.pathname);
    const format = "tinkercad-export-diagnostics-v1";
    const phases = new Set(["starting", "design-data", "compact-metadata", "metadata-ready", "evaluate", "evaluation-wait", "evaluation-ready", "evaluation-timeout", "evaluation-error", "geometry-ready", "geometry-failed", "captured",
      "mesh-allocate", "mesh-bytes", "compress", "compressed", "convert", "surface-comparison", "packaging", "assembly-packaging", "complete"]);
    const fields = new Set(["totalParts", "evaluationsStarted", "observedGeometryBytes", "currentTriangles",
      "currentCaptureBytes", "currentBinaryBytes", "plannedCaptureBytes", "plannedBinaryBytes", "uniqueMeshes", "packedOutputBytes", "processedParts",
      "outputBytes", "elapsedMs", "assemblyIndex", "assemblyCount", "evaluationElapsedMs", "evaluationLimitMs", "evaluationPromiseReturned", "evaluationPromiseSettled", "evaluationCallbackReceived", "jsHeapUsedEstimate", "jsHeapLimitEstimate"]);
    function clean(values) {
      const result = {};
      if (!values || typeof values !== "object") return result;
      for (const [key, value] of Object.entries(values)) {
        if (key === "phase" && phases.has(value)) result.phase = value;
        else if (fields.has(key) && typeof value === "number" && Number.isFinite(value)) result[key] = value;
      }
      return result;
    }
    let previous;
    try {
      const text = root.localStorage?.getItem(key);
      if (text && text.length < 65536) {
        const value = JSON.parse(text);
        if (value.format === format && value.status === "running" && Array.isArray(value.samples))
          previous = {format, status:"running", latest:clean(value.latest), samples:value.samples.slice(-60).map(clean)};
      }
    } catch (_) {}
    const started = Date.now();
    const report = {format, status:"setup", latest:{}, samples:[]};
    let written = -Infinity;
    function record(values = {}, status) {
      if (status) report.status = status;
      Object.assign(report.latest, clean(values));
      const now = Date.now();
      const largeAllocation = (values.plannedCaptureBytes || values.plannedBinaryBytes || 0) >= 32 * 1024 * 1024;
      if (!status && !largeAllocation && now - written < 750) return;
      written = now;
      const sample = {...report.latest, elapsedMs:now-started};
      try {
        const heap = root.performance?.memory;
        if (heap) {
          sample.jsHeapUsedEstimate = heap.usedJSHeapSize;
          sample.jsHeapLimitEstimate = heap.jsHeapSizeLimit;
        }
      } catch (_) {}
      report.samples.push(sample);
      if (report.samples.length > 60) report.samples.shift();
      try { root.localStorage?.setItem(key, JSON.stringify(report)); } catch (_) {}
    }
    return {previous, report, record, clear() {
      try { root.localStorage?.removeItem(key); } catch (_) {}
    }};
  }

  function createPanel() {
    const panel = document.createElement("section");
    panel.setAttribute("aria-label", "Tinkercad to layerling import");
    panel.tabIndex = -1;
    panel.style.cssText =
      "position:fixed;right:20px;top:20px;z-index:2147483647;max-width:min(360px,calc(100vw - 80px));max-height:calc(100vh - 80px);overflow:auto;overflow-wrap:anywhere;padding:18px;background:#fff;color:#222;border:2px solid #1473e6;border-radius:10px;box-shadow:0 4px 24px #0004;font:15px/1.5 system-ui,sans-serif";
    const title = document.createElement("strong");
    title.textContent = "Tinkercad to layerling";
    const version = document.createElement("p");
    version.textContent = `Version ${VERSION}`;
    const updateStatus = document.createElement("span");
    const update = document.createElement("button");
    update.type = "button"; update.textContent = "Check for updates";
    const setup = document.createElement("a");
    setup.href = SITE; setup.target = "_blank"; setup.rel = "noopener noreferrer";
    setup.textContent = "Open setup page";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const meter = document.createElement("progress");
    meter.max = 100;
    meter.style.cssText = "display:block;width:100%;margin:8px 0";
    meter.setAttribute("aria-label", "Parts converted");
    const counts = document.createElement("p");
    counts.textContent = "Counting parts…";
    const elapsed = document.createElement("p");
    elapsed.textContent = "Elapsed: 0:00";
    const link = document.createElement("a");
    link.textContent = "Download .lyl again";
    link.style.cssText =
      "color:#075ac1;text-decoration:underline;margin:10px 12px 10px 0";
    link.hidden = true;
    link.style.display = "none";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.disabled = true;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const failureChoices = document.createElement("div");
    failureChoices.hidden = true;
    const stopOnFailure = document.createElement("button");
    stopOnFailure.type = "button";
    stopOnFailure.textContent = "Stop export";
    const continueOnFailure = document.createElement("button");
    continueOnFailure.type = "button";
    continueOnFailure.textContent = "Continue without failed parts";
    failureChoices.append(stopOnFailure, continueOnFailure);
    panel.append(title, cancel, close, version, updateStatus, update, setup, status, meter, counts, elapsed, link);
    panel.append(failureChoices);
    document.body.append(panel);
    return { panel, status, link, close, cancel, meter, counts, elapsed, update, updateStatus, failureChoices, stopOnFailure, continueOnFailure };
  }

  async function runLayerlingImport() {
    const previous = root.__layerlingImportSession;
    if (previous?.busy) {
      previous.panel.focus();
      return previous.promise;
    }
    if (
      !["www.tinkercad.com", "tinkercad.com"].includes(location.hostname) ||
      !/^\/things\/[^/]+\/edit(?:\/|$)/.test(location.pathname)
    ) {
      alert(
        "Open your design in the Tinkercad editor, then click this bookmark.",
      );
      return;
    }
    previous?.dispose();
    const view = createPanel();
    const controller = new AbortController();
    let releaseDownload = () => {}, elapsedTimer;
    const updateController = new AbortController();
    let updateTimer;
    const session = {
      busy: true,
      disposed: false,
      panel: view.panel,
      promise: null,
      dispose() {
        session.disposed = true;
        controller.abort();
        clearTimeout(elapsedTimer);
        clearTimeout(updateTimer);
        updateController.abort();
        releaseDownload();
        view.panel.remove();
        root.removeEventListener?.("pagehide", session.dispose);
        if (root.__layerlingImportSession === session)
          delete root.__layerlingImportSession;
      },
    };
    root.__layerlingImportSession = session;
    root.addEventListener?.("pagehide", session.dispose);
    view.close.addEventListener("click", session.dispose);
    view.cancel.addEventListener("click", () => {
      controller.abort();
      view.cancel.disabled = true;
      view.status.textContent = "Cancelling import…";
    });
    let latest, checking = false;
    const update = async () => {
      if (checking) return;
      if (latest?.newer) {
        if (session.busy) return;
        root.layerlingLoadLatest();
        return;
      }
      checking = true;
      view.update.disabled = true;
      view.updateStatus.textContent = "Checking for updates… ";
      const request = new AbortController();
      const abort = () => request.abort();
      updateController.signal.addEventListener("abort",abort,{once:true});
      updateTimer = setTimeout(abort,5000);
      try {
        latest = await checkUpdate(request.signal);
        if (session.disposed) return;
        view.updateStatus.textContent = latest.newer ? `Version ${latest.version} available. ` : "No newer published version. ";
        if (latest.newer) view.update.textContent = "Run latest version";
      } catch (_) {
        if (!session.disposed) view.updateStatus.textContent = "Update check unavailable. Use the setup page. ";
      } finally {
        checking = false;
        clearTimeout(updateTimer);
        updateController.signal.removeEventListener("abort",abort);
        if (!session.disposed) view.update.disabled = Boolean(latest?.newer && session.busy);
      }
    };
    view.update.addEventListener("click",()=>{void update();});
    if (typeof root.fetch === "function") void update();
    const chooseOutput = plan => new Promise((resolve,reject) => {
      const choices = document.createElement("div");
      const warning = document.createElement("p");
      warning.textContent = `Large design: ${sizeLabel(plan.meshBytes)} of expanded meshes, ${plan.nodeCount.toLocaleString()} parts. `+
        `Suggested export: ${plan.parts.length} smaller project files in one ZIP. `+
        (plan.oversizedCount ? `${plan.oversizedCount} complete assemblies exceed a size target and cannot be divided without changing construction history. ` : "")+
        "Original positions and complete groups are preserved. Files exceeding Layerling reader limits go into needs-attention as preservation archives, not ready-to-open projects. "+
        (plan.readerIssues?.length ? "One project would exceed Layerling limits: "+plan.readerIssues.map(i=>i.message).join("; ")+". " : "")+
        "The outer ZIP must be extracted first. Layerling insertion is source-inspected, not live verified.";
      view.meter.removeAttribute("value");
      progress("Choose how to download this large design.");
      choices.append(warning);
      const finish = value => {choices.remove();controller.signal.removeEventListener("abort",abort);resolve(value);};
      const abort = () => {choices.remove();controller.signal.removeEventListener("abort",abort);
        const error = Error("Import cancelled.");error.name="AbortError";reject(error);};
      for (const [label,value] of [["Export smaller assemblies","assemblies"],["Keep one project","single"]]) {
        const button = document.createElement("button");button.type="button";button.textContent=label;
        button.disabled = value === "single" && Boolean(plan.readerIssues?.length);
        button.addEventListener("click",()=>finish(value));choices.append(button);
      }
      controller.signal.addEventListener("abort",abort,{once:true});
      view.panel.append(choices);
      if (controller.signal.aborted) abort();
    });
    const trace = diagnostics();
    if (trace.previous) {
      session.busy = false;
      session.promise = Promise.resolve();
      view.cancel.hidden = true;
      view.cancel.style.display = "none";
      view.close.disabled = false;
      view.meter.hidden = true;
      view.counts.hidden = true;
      view.elapsed.hidden = true;
      view.status.textContent = "The previous export did not finish. Download its diagnostic report before trying again. The report contains progress and memory estimates, not design geometry.";
      view.link.textContent = "Download failure report";
      releaseDownload = setDownload(view.link, new Blob([JSON.stringify(trace.previous, null, 2)], {type:"application/json"}), "tinkercad-export-diagnostics", ".json");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Try export again";
      retry.addEventListener("click", () => { trace.clear(); void runLayerlingImport(); });
      view.panel.append(retry);
      return session.promise;
    }
    trace.record({phase:"starting"}, "setup");
    let totalParts = 0, processedParts = 0;
    const started = Date.now();
    const updateElapsed = () => {
      const seconds = Math.floor((Date.now()-started)/1000);
      view.elapsed.textContent = `Elapsed: ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
    };
    const tick = () => {
      if (session.disposed || !session.busy) return;
      updateElapsed();
      elapsedTimer = setTimeout(tick, 1000);
    };
    tick();
    const diagnostic = values => {
      trace.record(values, trace.report.status === "setup" ? "running" : undefined);
      if (Number.isFinite(values.totalParts)) totalParts = values.totalParts;
      if (Number.isFinite(values.processedParts)) processedParts = values.processedParts;
      if (totalParts > 0) {
        const percentage = Math.min(100, Math.floor(processedParts/totalParts*100));
        view.counts.textContent = `Parts converted: ${processedParts.toLocaleString()} / ${totalParts.toLocaleString()} (${percentage}%)`;
        if (values.phase === "metadata-ready" || values.phase === "convert") view.meter.value = percentage;
      }
      if (values.phase === "surface-comparison" || values.phase === "packaging")
        view.meter.removeAttribute("value");
    };
    const progress = (message) => {
      if (session.disposed) throw Error("Import closed.");
      view.status.textContent = message;
    };
    const choosePartialExport = failure => new Promise(resolve => {
      const finish = shouldContinue => {
        view.failureChoices.hidden = true;
        view.stopOnFailure.removeEventListener("click", stop);
        view.continueOnFailure.removeEventListener("click", proceed);
        view.continueOnFailure.removeEventListener("click", confirm);
        controller.signal.removeEventListener("abort", aborted);
        resolve(shouldContinue);
      };
      const stop = () => controller.abort();
      const confirm = () => finish(true);
      const proceed = () => {
        view.stopOnFailure.textContent = "Cancel export";
        view.continueOnFailure.textContent = "Continue anyway";
        progress("Warning: continuing may create an invalid .lyl file that Layerling cannot open. Do you really want to continue without the failed parts?");
        view.stopOnFailure.focus();
        view.continueOnFailure.addEventListener("click", confirm, {once:true});
      };
      const aborted = () => finish(false);
      view.failureChoices.hidden = false;
      view.stopOnFailure.addEventListener("click", stop, {once:true});
      view.continueOnFailure.addEventListener("click", proceed, {once:true});
      controller.signal.addEventListener("abort", aborted, {once:true});
      progress(`Geometry failed for “${failure.label}”: ${failure.message}. No .lyl has been created. Stop is the default; continue only if you accept omitting failed geometry.`);
      view.stopOnFailure.focus();
      if (controller.signal.aborted) aborted();
    });
    session.promise = (async () => {
      try {
        progress("Capturing the open design…");
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (session.disposed) return;
        root.exportTinkercadDesign = exportTinkercadDesign;
        const capture = await exportTinkercadDesign({
          download: false,
          lazy: true,
          onProgress: progress,
          signal: controller.signal,
          onDiagnostic: diagnostic,
          onGeometryFailure: choosePartialExport,
        });
        if (session.disposed) return;
        if (!capture) {
          trace.record({}, "reload-required");
          progress(
            "Editor tools enabled. Click the bookmark again after the design reloads.",
          );
          return;
        }
        const name = projectName(document.title);
        let output = {extension:".lyl"};
        const blob = await convertTinkercadToLayerling(capture, name, {
          onProgress: progress,
          signal: controller.signal,
          onDiagnostic: diagnostic,
          onLargeProject: chooseOutput,
          onOutput: value => {output=value;},
        });
        if (session.disposed || controller.signal.aborted) return;
        releaseDownload = setDownload(view.link, blob, name, output.extension);
        view.link.textContent = output.extension === ".zip" ? "Download assemblies ZIP again" : "Download .lyl again";
        trace.record({phase:"complete", outputBytes:blob.size}, "complete");
        view.meter.value = 100;
        view.meter.setAttribute("aria-label", "Export complete");
        progress(
          output.extension === ".zip"
            ? `Export complete: ${output.importable ?? output.assemblies} projects pass file-size and structure-count checks; ${output.blocked || 0} need attention and are NOT ready to open. Extract the ZIP and read README.txt. Complete construction groups were retained.`
            : capture.failures?.length
              ? `Project ready with ${capture.failures.length} geometry error${capture.failures.length === 1 ? "" : "s"} omitted. Failed parts and affected Boolean groups are missing. Open the downloaded .lyl in layerling; use the link below if needed.`
              : "Project ready. Open the downloaded .lyl in layerling. If the download did not start, use the link below.",
        );
        try {
          view.link.click();
        } catch (_) {
          /* The retained link allows a user gesture to retry. */
        }
      } catch (error) {
        if (session.disposed) return;
        if (controller.signal.aborted) {
          trace.record({}, "cancelled");
          view.status.textContent = "Import cancelled. No file was downloaded. Your Tinkercad design is unchanged.";
          return;
        }
        console.error("Tinkercad import failed:", error);
        trace.record({}, "error");
        view.link.textContent = "Download failure report";
        releaseDownload = setDownload(view.link,
          new Blob([JSON.stringify(trace.report, null, 2)], {type:"application/json"}),
          "tinkercad-export-diagnostics", ".json");
        progress(
          "Import failed: " +
            (error?.message || error) +
            ". Download the failure report below. Close this panel to retry.",
        );
      } finally {
        clearTimeout(elapsedTimer);
        updateElapsed();
        session.busy = false;
        view.update.disabled = checking;
        view.close.disabled = false;
        view.cancel.hidden = true;
        view.cancel.style.display = "none";
      }
    })();
    return session.promise;
  }

  root.layerlingImportUI = { projectName, setDownload, checkUpdate };
  root.runLayerlingImport = runLayerlingImport;
})(globalThis);
globalThis.__layerlingRuntimeLoaded = true;
