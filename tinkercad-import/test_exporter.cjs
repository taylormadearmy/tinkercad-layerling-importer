const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const html = fs.readFileSync(__dirname + "/bookmarklet.html", "utf8");
const source = html.match(/<script id="exporter">([\s\S]*?)<\/script>/)[1];
const STRING_LIMIT = 262144;

function environment({timers = false} = {}) {
  let blob,
    downloads = 0,
    largestString = 0,
    clearedTimers = 0;
  const limitedJSON = {
    parse: JSON.parse,
    stringify(value) {
      const result = JSON.stringify(value);
      largestString = Math.max(largestString, result?.length || 0);
      if (result?.length > STRING_LIMIT)
        throw new RangeError("Invalid string length");
      return result;
    },
  };
  const context = vm.createContext({
    Blob,
    AbortController,
    JSON: limitedJSON,
    console,
    setTimeout(fn, delay) {
      if (timers) return setTimeout(fn, delay === 120000 ? 100 : delay);
      if (delay === 0) return setImmediate(fn);
      return 99;
    },
    clearTimeout(timer) {
      if (timers) clearTimeout(timer);
      clearedTimers++;
    },
    URL: {
      createObjectURL(value) {
        blob = value;
        return "blob:test";
      },
      revokeObjectURL() {},
    },
    document: {
      createElement() {
        return {
          click() {
            downloads++;
          },
        };
      },
    },
    alert() {},
  });
  context.window = context;
  vm.runInContext(source, context);
  return {
    context,
    limitedJSON,
    get blob() {
      return blob;
    },
    get downloads() {
      return downloads;
    },
    get largestString() {
      return largestString;
    },
    get clearedTimers() {
      return clearedTimers;
    },
  };
}

test("chunked JSON preserves nested data, optional fields, and Unicode", async () => {
  const env = environment();
  env.context.value = {
    name: 'Hinge "pin" 🟢',
    optional: undefined,
    nested: [null, true, {}, [], ["a", 12]],
    positions: Array.from({ length: 90000 }, (_, i) => i / 37),
  };
  assert.throws(() => env.limitedJSON.stringify(env.context.value), RangeError);
  const blob = await vm.runInContext("tinkercadJsonBlob(value)", env.context);
  assert.deepEqual(
    JSON.parse(await blob.text()),
    JSON.parse(JSON.stringify(env.context.value)),
  );
});

function installScene(env, scene, type = "preset", extra = []) {
  scene.versions_id = "part";
  env.context.testKit = {sceneModel: {children: new Map([["part", scene]])}};
  env.context.llm = {tools: {get_design_data: {run: () => ({shapes: [
    {versions_id: "part", dataType: type, params: {groupType: 1}, children: [], tags: {}}, ...extra,
  ]})}}};
}

function triangleGeometry(index = null) {
  const points = [[0,0,0],[2,0,0],[0,3,4],[2,3,4]];
  return {
    index,
    attributes: {position: {count: index ? points.length : 3,
      getX: i => points[i][0], getY: i => points[i][1], getZ: i => points[i][2]}},
    clone() {return {...this, applyMatrix4() {}, dispose() {},
      toNonIndexed() {throw Error("Unnecessary expanded geometry allocation");}};},
  };
}

test("selection capture keeps full subtrees, snapshots IDs and refuses stale identities", async () => {
  for (const compact of [false,true]) {
    const env=environment();
    const leaf=id=>({versions_id:id,dataType:"preset",params:{id:"triangle"},tags:{}});
    const a=leaf("a"),b=leaf("b"),g={...leaf("g"),dataType:"csg",params:{groupType:1},children:[a,b]};
    const scene=meta=>({data:{versions_id:meta.versions_id,dataType:{get:()=>meta.dataType},
      tags:{get:k=>meta.tags[k]},params:{get:k=>meta.params[k]},children:{size:()=>meta.children?.length || 0}},
      geometry:{get:()=>triangleGeometry()},computeWorldMatrix:()=>({determinant:()=>1}),
      children:new Map((meta.children||[]).map(k=>[k.versions_id,scene(k)]))});
    const sg=scene(g),outside=scene(leaf("outside"));
    env.context.testKit={sceneModel:{children:new Map([["g",sg],["outside",outside]])},getSelectionCount:()=>2,getSelectedAt:i=>i?sg.children.get("a"):sg};
    env.context.llm={tools:{get_design_data:{run:()=>({shapes:[g,leaf("outside")],notes:[{content:"Excluded",position:{x:0,y:0,z:0}}]})}}};
    const snapshot=vm.runInContext("tinkercadSelectedIds()",env.context);
    env.context.testKit.getSelectedAt=()=>outside;
    const captured=await env.context.exportTinkercadDesign({download:false,lazy:compact,scope:"selection",selectionIds:snapshot});
    assert.deepEqual(JSON.parse(JSON.stringify(captured.shapes)).map(n=>n.versions_id),["g"]);
    assert.equal(captured.shapes[0].children.length,2);
    assert.equal(captured.notes.length,0);
    if(compact) assert.equal((await captured.readMesh("a")).positions.length,9);
    await assert.rejects(env.context.exportTinkercadDesign({download:false,scope:"selection",selectionIds:["missing"]}),/Selection changed/);
    await assert.rejects(env.context.exportTinkercadDesign({download:false,scope:"selection",selectionIds:[]}),/Select parts/);
    assert.equal(env.downloads,0);
  }
});

test("consented eager and lazy failures share records and failed lazy reads never reevaluate", async () => {
  for(const lazy of [false,true]) {
    const env=environment();let decisions=0;
    installScene(env,{geometry:{get:()=>null},computeWorldMatrix:()=>({determinant:()=>1})});
    const data=await env.context.exportTinkercadDesign({download:false,lazy,onGeometryFailure:error=>{
      decisions++;assert.ok(error.sourceFailure);return true;
    }});
    if(lazy) {assert.equal(await data.readMesh("part"),null);assert.equal(await data.readMesh("part"),null);}
    assert.equal(decisions,1);
    assert.equal(data.failures.length,1);
    assert.equal(data.failures[0].id,"part");
    assert.equal(Object.keys(data.meshes).length,0);
  }
});

test("partial consent cannot hide structural, transform or invalid triangle errors", async () => {
  for(const kind of ["missing-transform","bad-transform","positions","normals"]) {
    const env=environment(),geometry=triangleGeometry();let decisions=0;
    if(kind === "positions") geometry.attributes.position.getX=()=>NaN;
    if(kind === "normals") geometry.attributes.normal={count:3,getX:()=>NaN,getY:()=>0,getZ:()=>0};
    const scene={geometry:{get:()=>geometry},computeWorldMatrix:()=>({determinant:()=>1})};
    if(kind === "missing-transform") delete scene.computeWorldMatrix;
    if(kind === "bad-transform") scene.computeWorldMatrix=()=>{throw Error("Invalid transform");};
    installScene(env,scene);
    await assert.rejects(env.context.exportTinkercadDesign({download:false,onGeometryFailure:()=>{decisions++;return true;}}),/transform|positions|normals/);
    assert.equal(decisions,0);
    assert.equal(env.downloads,0);
  }
});

test("empty generator placeholders are evaluated before capture", async () => {
  for (const indexed of [false, true]) {
    const env = environment({timers:true});
    let ready = triangleGeometry(indexed ? {count:0} : null), calls = 0;
    if (!indexed) ready.attributes.position.count = 0;
    installScene(env, {geometry:{get:()=>ready}, computeWorldMatrix:()=>({determinant:()=>1}),
      async evaluate() {calls++; ready=triangleGeometry();}}, "legacy-shapegenerator");
    const captured=await vm.runInContext("exportTinkercadDesign({download:false})",env.context);
    assert.equal(calls,1);
    assert.equal(captured.meshes.part.positions.length,9);
  }
});

test("empty callback-based geometry waits for completed triangles", async () => {
  const env=environment({timers:true}); let ready=triangleGeometry(),calls=0;
  ready.attributes.position.count=0;
  installScene(env,{geometry:{get:()=>ready},computeWorldMatrix:()=>({determinant:()=>1}),
    evaluate(callback){calls++;setTimeout(()=>{ready=triangleGeometry();callback();},5);}},"csg");
  const captured=await vm.runInContext("exportTinkercadDesign({download:false})",env.context);
  assert.equal(calls,1);assert.equal(captured.meshes.part.positions.length,9);
});

test("persistent empty geometry fails explicitly and pending empty capture can be cancelled", async () => {
  for (const cancel of [false,true]) {
    const env=environment({timers:true}), ready=triangleGeometry();
    ready.attributes.position.count=0;
    const controller=new AbortController(); env.context.signal=controller.signal;
    installScene(env,{geometry:{get:()=>ready},computeWorldMatrix:()=>({determinant:()=>1}),
      evaluate(){return cancel ? new Promise(()=>{}) : Promise.resolve();}});
    const task=vm.runInContext("exportTinkercadDesign({signal})",env.context);
    if(cancel) controller.abort();
    await assert.rejects(task,cancel ? /cancelled/ : /empty|no triangles/i);
    assert.equal(env.downloads,0);
  }
});

test("capture keeps spatial notes from compact metadata and the design-data tool", async () => {
  const notes=[{uuid:"n",content:"Fit 🟢\nKeep this",position:{x:12,y:-3,z:8},privateExtra:"omit"}];
  for(const compact of [false,true]) {
    const env=environment();
    if(compact) {
      const scene=compactScene({versions_id:"part",dataType:"preset"});
      env.context.testKit={sceneModel:{children:new Map([["part",scene]])},editorData:{notes:{values:()=>notes}}};
      env.context.llm={tools:{get_design_data:{run(){throw Error("Heavy metadata call");}}}};
    } else {
      installScene(env,{geometry:{get:()=>triangleGeometry()},computeWorldMatrix:()=>({determinant:()=>1})});
      const original=env.context.llm.tools.get_design_data.run;
      env.context.llm.tools.get_design_data.run=()=>({...original(),notes});
    }
    const captured=await vm.runInContext(`exportTinkercadDesign({download:false,lazy:${compact}})`,env.context);
    assert.deepEqual(JSON.parse(JSON.stringify(captured.notes)),[{uuid:"n",content:notes[0].content,position:notes[0].position}]);
    if(!compact) {
      await vm.runInContext("exportTinkercadDesign()",env.context);
      assert.deepEqual(JSON.parse(await env.blob.text()).notes,captured.notes && JSON.parse(JSON.stringify(captured.notes)));
    }
  }
});

test("Promise-returning evaluators need no callback or parameter substitution", async () => {
  const env = environment({timers: true});
  let ready;
  const scene = {geometry: {get: () => ready},
    async evaluate(...args) {assert.equal(args.length, 0); await Promise.resolve(); ready = triangleGeometry();},
    computeWorldMatrix: () => ({determinant: () => 1})};
  installScene(env, scene);
  const result = await vm.runInContext("exportTinkercadDesign({download:false})", env.context);
  assert.equal(result.meshes.part.positions.length, 9);
  assert.equal(env.downloads, 0);
});

test("lazy capture returns metadata without retaining expanded meshes", async () => {
  const env = environment();
  let clones = 0;
  const geometry = triangleGeometry();
  const clone = geometry.clone;
  geometry.clone = () => { clones++; return clone.call(geometry); };
  installScene(env, {geometry:{get:()=>geometry},computeWorldMatrix:()=>({determinant:()=>1})});
  const capture = await vm.runInContext("exportTinkercadDesign({download:false,lazy:true})", env.context);
  assert.equal(clones, 0);
  const m = await capture.readMesh("part");
  assert.equal(Object.prototype.toString.call(m.positions), "[object Float64Array]");
  assert.equal(m.positions.byteLength, 72);
  assert.equal(clones, 1);
  assert.equal(Object.keys(capture.meshes).length, 0);
  assert.equal(env.downloads, 0);
});

test("CSG callbacks and callback-free asynchronous geometry are both observed", async () => {
  for (const type of ["csg", "preset"]) {
    const env = environment({timers: true});
    let ready;
    const scene = {geometry: {get: () => ready},
      evaluate(callback) {setTimeout(() => {ready = triangleGeometry(); callback?.();}, 5);},
      computeWorldMatrix: () => ({determinant: () => 1})};
    installScene(env, scene, type);
    const result = await vm.runInContext("exportTinkercadDesign({download:false})", env.context);
    assert.equal(result.meshes.part.positions.length, 9);
  }
});

test("capture stops at the first evaluation failure instead of visiting later parts", async () => {
  const env = environment({timers: true});
  let laterReads = 0;
  const scene = {geometry: {get: () => null}, evaluate: () => Promise.reject(Error("Evaluation failed")),
    computeWorldMatrix: () => ({determinant: () => 1})};
  installScene(env, scene, "preset", [{versions_id:"later",dataType:"preset"}]);
  env.context.testKit.sceneModel.children.set("later", {versions_id:"later",geometry:{get(){laterReads++; return triangleGeometry();}}});
  await assert.rejects(vm.runInContext("exportTinkercadDesign()", env.context), /Stopped at part.*Evaluation failed/);
  assert.equal(laterReads, 0);
  assert.equal(env.downloads, 0);
});

test("cancelling a pending evaluation stops without waiting for the timeout", async () => {
  const env = environment({timers: true});
  let started;
  const waiting = new Promise(resolve => {started = resolve;});
  const scene = {geometry: {get: () => null}, evaluate() {started(); return new Promise(() => {});},
    computeWorldMatrix: () => ({determinant: () => 1})};
  installScene(env, scene);
  const controller = new AbortController();
  env.context.signal = controller.signal;
  const result = vm.runInContext("exportTinkercadDesign({signal})", env.context);
  await waiting;
  controller.abort();
  await assert.rejects(result, error => error.name === "AbortError");
  assert.equal(env.downloads, 0);
});

test("cancellation interrupts the initial design-data request even if it never resolves", async () => {
  const env = environment({timers:true});
  let began;
  const started = new Promise(resolve => {began=resolve;});
  env.context.testKit = {sceneModel:{children:new Map()}};
  env.context.llm = {tools:{get_design_data:{run(){began();return new Promise(()=>{});}}}};
  const controller = new AbortController();
  env.context.signal = controller.signal;
  const task = vm.runInContext("exportTinkercadDesign({signal})", env.context);
  await started;
  controller.abort();
  await assert.rejects(task, error=>error.name==="AbortError");
  assert.equal(env.downloads,0);
});

test("indexed geometry expands directly from the cloned index without a second geometry", async () => {
  const env = environment();
  const indices = [0,1,2,2,3,0];
  const geometry = triangleGeometry({count:6,getX:i=>indices[i]});
  geometry.attributes.normal = {count:4,getX:i=>i,getY:i=>i+1,getZ:i=>i+2};
  const scene = {geometry:{get:()=>geometry},computeWorldMatrix:()=>({determinant:()=>1})};
  installScene(env, scene);
  const result = await vm.runInContext("exportTinkercadDesign({download:false})", env.context);
  assert.deepEqual(Array.from(result.meshes.part.positions), [0,0,0,2,0,0,0,3,4,0,3,4,2,3,4,0,0,0]);
  assert.equal(geometry.index.count, 6);
  assert.equal(geometry.attributes.position.count, 4);
  assert.deepEqual(Array.from(result.meshes.part.normals), indices.flatMap(i=>[i,i+1,i+2]));
  assert.equal(geometry.attributes.normal.count, 4);
});

test("Cancel can interrupt one large mesh while its triangles are expanded", async () => {
  const env = environment();
  const controller = new AbortController();
  let reads = 0, disposed = 0;
  const geometry = triangleGeometry({ count: 150000, getX: i => i % 3 });
  geometry.attributes.position.getX = () => {
    reads++;
    return 0;
  };
  geometry.clone = () => ({ ...geometry, applyMatrix4() {}, dispose() { disposed++; } });
  installScene(env, { geometry: { get: () => geometry }, computeWorldMatrix: () => ({ determinant: () => 1 }) });
  env.context.setTimeout = fn => setImmediate(() => { controller.abort(); fn(); });
  env.context.signal = controller.signal;
  await assert.rejects(vm.runInContext("exportTinkercadDesign({download:false,signal})", env.context),
    error => error.name === "AbortError");
  assert.ok(reads < geometry.index.count, "the whole mesh must not be expanded after Cancel");
  assert.equal(disposed, 1);
  assert.equal(env.downloads, 0);
});

test("Cancel during chunked JSON encoding prevents a diagnostics download", async () => {
  const env = environment();
  const controller = new AbortController();
  const shape = { versions_id: "part", dataType: "preset", params: { values: new Array(600000).fill(0) } };
  env.context.llm = { tools: { get_design_data: { run: () => ({ shapes: [shape] }) } } };
  env.context.testKit = { sceneModel: { children: new Map() } };
  env.context.signal = controller.signal;
  env.context.setTimeout = fn => setImmediate(() => { controller.abort(); fn(); });
  await assert.rejects(vm.runInContext("exportTinkercadDesign({signal})", env.context),
    error => error.name === "AbortError");
  assert.equal(env.downloads, 0);
});

test("the actual download exports large meshes without a whole-capture or whole-mesh string", async () => {
  const env = environment();
  const shapes = [],
    meshes = {},
    sceneNodes = new Map();
  for (let n = 0; n < 3; n++) {
    const id = "shape-" + n;
    shapes.push({
      versions_id: id,
      dataType: "preset",
      params: { id: "custom-" + n },
      tags: { label: "Pin 🟢" },
    });
    const position = {
      count: 30000,
      getX: (i) => i / 37 + n,
      getY: (i) => i / 19,
      getZ: (i) => -i / 23,
    };
    const normal =
      n === 0
        ? { count: 30000, getX: () => 0, getY: () => 1, getZ: () => 0 }
        : undefined;
    const attributes = { position, normal };
    const geometry = {
      attributes,
      clone() {
        return {
          attributes,
          applyMatrix4() {
            return this;
          },
          dispose() {},
        };
      },
    };
    sceneNodes.set(id, {
      versions_id: id,
      geometry: { get: () => geometry },
      computeWorldMatrix: () => ({ determinant: () => 1 }),
    });
    const expand = (attr) =>
      Array.from({ length: attr.count }, (_, i) => [
        attr.getX(i),
        attr.getY(i),
        attr.getZ(i),
      ]).flat();
    meshes[id] = {
      positions: expand(position),
      ...(normal ? { normals: expand(normal) } : {}),
      space: "world",
      csg: false,
    };
  }
  env.context.llm = { tools: { get_design_data: { run: () => ({ shapes }) } } };
  env.context.testKit = { sceneModel: { children: sceneNodes } };
  const expected = {
    format: "tinkercad-evaluated-world-v1",
    shapes,
    meshes,
    notes: [],
    diagnostics: shapes.map((s) => ({ id: s.versions_id, triangles: 10000 })),
    failures: [],
  };
  // Reproduce the old failure at the same JSON.stringify call boundary.
  assert.throws(() => env.limitedJSON.stringify(expected), RangeError);
  const result = await vm.runInContext("exportTinkercadDesign()", env.context);
  assert.equal(env.downloads, 1);
  assert.equal(result.meshCount, 3);
  assert.equal(result.byteLength, env.blob.size);
  assert.deepEqual(
    JSON.parse(await env.blob.text()),
    JSON.parse(JSON.stringify(expected)),
  );
});

test("missing geometry never downloads a partial capture", async () => {
  const env = environment();
  env.context.llm = {
    tools: {
      get_design_data: {
        run: () => ({
          shapes: [{ versions_id: "missing", dataType: "preset" }],
        }),
      },
    },
  };
  env.context.testKit = { sceneModel: { children: new Map() } };
  await assert.rejects(
    vm.runInContext("exportTinkercadDesign()", env.context),
    /Stopped at missing/,
  );
  assert.equal(env.downloads, 0);
});

test("reflected captures swap triangle winding and corresponding normals without changing source geometry", async () => {
  const env = environment(),
    points = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 3, 4],
    ],
    normals = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  const attribute = (data) => ({
    count: 3,
    getX: (i) => data[i][0],
    getY: (i) => data[i][1],
    getZ: (i) => data[i][2],
  });
  const attributes = {
    position: attribute(points),
    normal: attribute(normals),
  };
  let disposed = 0;
  const geometry = {
    clone: () => ({
      attributes,
      applyMatrix4() {
        return this;
      },
      dispose() {
        disposed++;
      },
    }),
  };
  env.context.llm = {
    tools: {
      get_design_data: {
        run: () => ({
          shapes: [{ versions_id: "reflected", dataType: "preset" }],
        }),
      },
    },
  };
  env.context.testKit = {
    sceneModel: {
      children: new Map([
        [
          "reflected",
          {
            versions_id: "reflected",
            geometry: { get: () => geometry },
            computeWorldMatrix: () => ({ determinant: () => -1 }),
          },
        ],
      ]),
    },
  };
  // The capture reads position availability before cloning.
  geometry.attributes = attributes;
  const result = await vm.runInContext(
    "exportTinkercadDesign({download:false})",
    env.context,
  );
  assert.deepEqual(Array.from(result.meshes.reflected.positions), [
    ...points[0],
    ...points[2],
    ...points[1],
  ]);
  assert.deepEqual(Array.from(result.meshes.reflected.normals), [
    ...normals[0],
    ...normals[2],
    ...normals[1],
  ]);
  assert.deepEqual(points, [
    [0, 0, 0],
    [2, 0, 0],
    [0, 3, 4],
  ]);
  assert.equal(disposed, 1);
});

test("evaluated geometry clears its timeout and disposes cloned geometry even when extraction fails", async () => {
  const env = environment();
  let available = false,
    disposed = 0;
  const geometry = {
    attributes: {
      position: {
        count: 3,
        getX() {
          throw Error("Unreadable position");
        },
      },
    },
    clone() {
      return {
        attributes: this.attributes,
        applyMatrix4() {
          return this;
        },
        dispose() {
          disposed++;
        },
      };
    },
  };
  const scene = {
    versions_id: "bad",
    geometry: { get: () => (available ? geometry : null) },
    evaluate() {
      available = true;
    },
    computeWorldMatrix: () => ({ determinant: () => 1 }),
  };
  env.context.llm = {
    tools: {
      get_design_data: {
        run: () => ({ shapes: [{ versions_id: "bad", dataType: "preset" }] }),
      },
    },
  };
  env.context.testKit = { sceneModel: { children: new Map([["bad", scene]]) } };
  await assert.rejects(
    vm.runInContext("exportTinkercadDesign()", env.context),
    /Unreadable position/,
  );
  assert.ok(env.clearedTimers >= 1);
  assert.equal(disposed, 1);
  assert.equal(env.downloads, 0);
});

function compactScene(shape, children = []) {
  const unused = () => {throw Error("Heavy metadata serialization must not run");};
  return {
    data: {versions_id:shape.versions_id, dataType:{get:()=>shape.dataType},
      tags:{get:key=>shape.tags?.[key],toJSON:unused},
      params:{get:key=>shape.params?.[key],toJSON:unused},
      children:{size:()=>children.length}},
    children:new Map(children.map(child=>[child.data.versions_id,child])),
    visible:{get:()=>shape.tags?.visible !== false},
    geometry:{get:()=>triangleGeometry()},computeWorldMatrix:()=>({determinant:()=>1})
  };
}

test("direct metadata preserves construction operands without copying full tags or parameters", async () => {
  const env = environment();
  const child = compactScene({versions_id:"hole",dataType:"preset",
    params:{id:"Box",fileName:"hole.stl"},tags:{visible:false,volumePolarity:-1,
      label:"Hidden cutter",renderingMaterial:{color:{r:1,g:2,b:3}},unused:"large source data"}});
  const group = compactScene({versions_id:"group",dataType:"csg",params:{groupType:1},
    tags:{label:"Boolean",isMulticolor:true,renderingMaterial:{color:123}}},[child]);
  env.context.testKit = {sceneModel:{children:new Map([["group",group],["removed",{data:{hasBeenRemoved:true}}]])}};
  env.context.llm = {tools:{get_design_data:{run(){throw Error("Heavy design-data tool must not run");}}}};
  env.context.llmUtils = {cleanColor(value){assert.equal(value,123);return {r:10,g:20,b:30};}};
  const phases=[];env.context.onDiagnostic=x=>phases.push(x.phase);
  const capture=await vm.runInContext("exportTinkercadDesign({download:false,lazy:true,onDiagnostic})",env.context);
  assert.deepEqual(JSON.parse(JSON.stringify(capture.shapes)),[
    {versions_id:"group",dataType:"csg",tags:{label:"Boolean",isMulticolor:true,
    visible:true,renderingMaterial:{color:{r:10,g:20,b:30}}},params:{groupType:1},children:[{
      versions_id:"hole",dataType:"preset",tags:{visible:false,label:"Hidden cutter",volumePolarity:-1,
        renderingMaterial:{color:{r:1,g:2,b:3}}},params:{id:"Box",fileName:"hole.stl"}}]}]);
  assert.ok(phases.includes("compact-metadata"));
  assert.equal((await capture.readMesh("hole")).positions.length,9);
  assert.equal((await capture.readMesh("group")).positions.length,9);
});

test("compact metadata traversal yields to cancellation before reading geometry", async () => {
  const env=environment();const controller=new AbortController();
  const nodes=Array.from({length:260},(_,i)=>compactScene({versions_id:"p"+i,dataType:"preset"}));
  for(const node of nodes) node.geometry.get=()=>{throw Error("Geometry must not be read");};
  env.context.testKit={sceneModel:{children:new Map(nodes.map(n=>[n.data.versions_id,n]))}};
  env.context.llm={tools:{get_design_data:{run(){throw Error("Heavy metadata must not run");}}}};
  env.context.signal=controller.signal;
  const run=vm.runInContext("exportTinkercadDesign({download:false,lazy:true,signal})",env.context);
  setImmediate(()=>controller.abort());
  await assert.rejects(run,{name:"AbortError"});
});

function evaluationClock(env) {
  let now=0, next=0;
  const timers=new Map();
  env.context.Date={now:()=>now};
  env.context.setTimeout=(fn,delay)=>{const id=++next;timers.set(id,{fn,at:now+delay,delay});return id;};
  env.context.clearTimeout=id=>timers.delete(id);
  return {timers, tick(value) {now=value;const due=[...timers].filter(([,t])=>t.at<=now);
    for(const [id,t] of due) {if(timers.delete(id))t.fn();}}};
}

test("a slow geometry evaluation can complete after the former 20-second deadline without restarting", async () => {
  const env=environment(), clock=evaluationClock(env);let ready, calls=0, complete;
  const events=[];env.context.onDiagnostic=e=>events.push(e);
  installScene(env,{geometry:{get:()=>ready},evaluate(){calls++;return new Promise(r=>{complete=r;});},
    computeWorldMatrix:()=>({determinant:()=>1})});
  const run=vm.runInContext("exportTinkercadDesign({download:false,onDiagnostic})",env.context);
  for(let i=0;i<12;i++) await Promise.resolve();
  assert.equal(calls,1);
  assert.ok([...clock.timers.values()].some(t=>t.delay===120000));
  clock.tick(25000);
  assert.ok(events.some(e=>e.phase==="evaluation-wait" && e.evaluationElapsedMs===25000));
  ready=triangleGeometry();complete();
  const capture=await run;
  assert.equal(capture.meshes.part.positions.length,9);
  assert.equal(calls,1);
  assert.equal(clock.timers.size,0);
  assert.ok(events.some(e=>e.phase==="evaluation-ready" && e.evaluationPromiseSettled===1));
});

test("a stalled evaluator records its deadline and stops without a partial project", async () => {
  const env=environment(), clock=evaluationClock(env),events=[];
  env.context.onDiagnostic=e=>events.push(e);
  installScene(env,{geometry:{get:()=>null},evaluate(){return new Promise(()=>{});},
    computeWorldMatrix:()=>({determinant:()=>1})});
  const run=vm.runInContext("exportTinkercadDesign({download:false,onDiagnostic})",env.context);
  const rejected=assert.rejects(run,/Geometry evaluation timed out after 120 seconds/);
  for(let i=0;i<12;i++)await Promise.resolve();
  clock.tick(120000);await rejected;
  const last=events.find(e=>e.phase==="evaluation-timeout");
  assert.equal(last.evaluationElapsedMs,120000);
  assert.equal(last.evaluationPromiseReturned,1);
  assert.equal(last.evaluationPromiseSettled,0);
  assert.equal(clock.timers.size,0);
  assert.equal(env.downloads,0);
});
