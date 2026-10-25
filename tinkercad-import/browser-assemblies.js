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
  function assess(doc, projectJsonBytes, archiveBytes, limits = readerLimits, extras = {entries:0,bytes:0}) {
    const metrics = {entries:doc.assets.length+1+extras.entries, states:doc.states.length,
      nodes:Math.max(0,...doc.states.map(s=>s.nodes.length)),features:doc.features.length,
      assetBytes:Math.max(extras.bytes,doc.assets.reduce((n,a)=>Math.max(n,a.byteLength),0)),
      meshNumbers:doc.states.reduce((max,s)=>s.nodes.reduce((n,v)=>Math.max(n,(v.importedMesh?.triangleCount || 0)*9),max),0),
      expandedBytes:doc.assets.reduce((n,a)=>n+a.byteLength,0)+(projectJsonBytes || 0)+extras.bytes};
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
