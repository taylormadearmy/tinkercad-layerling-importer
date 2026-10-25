const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const {
  bookmarkSource,
  bookmarkURL,
  bookmarkEnvironment,
} = require("./browser-test-helpers.cjs");
function controls(panel) {
  return {
    status: panel.children.find(e => e.role === "status"),
    link: panel.children.find(e => e.tag === "a" && !e.target),
    close: panel.children.find(e => e.textContent === "Close"),
    cancel: panel.children.find(e => e.textContent === "Cancel"),
  };
}

function diagnosticStorage() {
  const values = new Map();
  return { values, getItem:key=>values.get(key) ?? null,
    setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key) };
}

test("partial export removes Boolean ancestors through bundles and prunes orphan assets", async () => {
  const group=(id,type,children)=>({...leaf(id),dataType:"csg",params:{groupType:type},children});
  const input={shapes:[group("outer",1,[group("bundle",0,[leaf("orphan"),leaf("failed")])]),leaf("keep")],
    meshes:{orphan:{...mesh(0),positions:[0,0,0,7,0,0,0,8,9]},keep:mesh(100)},
    failures:[{id:"failed",label:"Failed part",message:"Unavailable"}]};
  for(const lazy of [false,true]) {
    const c=context(), data={...input};
    if(lazy) {data.meshes={};data.readMesh=async id=>input.meshes[id]||null;}
    let output;
    const blob=await c.convertTinkercadToLayerling(data,"Test",{allowPartial:true,onOutput:v=>{output=v;}});
    const files=readStoredZip(new Uint8Array(await blob.arrayBuffer()));
    const doc=JSON.parse(new TextDecoder().decode(files.get("project.json")));
    assert.deepEqual(doc.states[0].nodes.map(n=>n.definition.name),["custom"]);
    assert.equal(doc.assets.length,1);
    assert.equal(files.size,3,"project, retained mesh and omission report only");
    const report=JSON.parse(new TextDecoder().decode(files.get("partial-export.json")));
    assert.deepEqual(report.failures.map(f=>f.id),["failed"]);
    assert.deepEqual(report.omittedGroups.map(g=>g.id),["outer"]);
    assert.equal(report.omittedSourceNodes,4);
    assert.equal(output.partial,true);
    assert.match(doc.metadata.projectName,/partial/);
  }
});

test("incomplete JSON and unrecorded missing geometry fail closed", async () => {
  const data={shapes:[leaf("keep"),leaf("failed")],meshes:{keep:mesh(0)},
    failures:[{id:"failed",label:"Failed",message:"Unavailable"}]};
  await assert.rejects(context().convertTinkercadToLayerling(data),/partial|incomplete/i);
  await assert.rejects(context().convertTinkercadToLayerling({...data,failures:[]},"Test",{allowPartial:true}),/missing evaluated/);
  await assert.rejects(context().convertTinkercadToLayerling({...data,failures:[...data.failures,...data.failures]},"Test",{allowPartial:true}),/failure|repeated/i);
});

test("partial assembly archives mark every project and carry an omission report", async () => {
  const data={shapes:[leaf("a"),leaf("b"),leaf("failed")],meshes:{a:mesh(0),b:mesh(100)},
    failures:[{id:"failed",label:"Failed",message:"Unavailable"}]};
  let output;
  const blob=await context().convertTinkercadToLayerling(data,"Parts",{allowPartial:true,output:"assemblies",assemblyLimits:{nodes:1},onOutput:v=>{output=v;}});
  const files=readStoredZip(new Uint8Array(await blob.arrayBuffer()));
  const projects=[...files].filter(([name])=>name.endsWith(".lyl"));
  assert.equal(projects.length,2);
  assert.ok(projects.every(([name])=>name.includes("partial")));
  assert.match(new TextDecoder().decode(files.get("README.txt")),/partial|incomplete/i);
  assert.ok(files.has("partial-export.json"));
  for(const [,bytes] of projects) assert.ok(readStoredZip(bytes).has("partial-export.json"));
  assert.equal(output.partial,true);
});

function buttonIn(panel,label) {
  if(panel.textContent === label) return panel;
  return panel.children?.map(e=>buttonIn(e,label)).find(Boolean);
}

async function waitForButton(host,label) {
  for(let i=0;i<100;i++) {
    const button=buttonIn(host.env.__layerlingImportSession.panel,label);
    if(button) return button;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error("Missing button: "+label);
}

test("generated bookmark requires two partial choices, marks its file and keeps diagnostic privacy", async () => {
  for(const cancel of [false,true]) {
    const host=bookmarkEnvironment({partial:null}),storage=diagnosticStorage();
    host.env.document.title="3D design "+"Long name ".repeat(30)+" - Tinkercad";
    host.env.localStorage=storage;
    const broken={versions_id:"private-failed",geometry:{get:()=>null},computeWorldMatrix:()=>({determinant:()=>1})};
    host.env.testKit.sceneModel.children.set("private-failed",broken);
    host.env.llm.tools.get_design_data.run=()=>({shapes:[{...leaf("private-failed"),tags:{label:"Private failed part"}},host.shape]});
    const run=host.invoke();
    (await waitForButton(host,"Continue without failed parts")).click();
    assert.equal(host.downloads.length,0,"first click must not authorize output");
    assert.ok(buttonIn(host.env.__layerlingImportSession.panel,"Stop export").focused);
    if(cancel) controls(host.env.__layerlingImportSession.panel).cancel.click();
    else (await waitForButton(host,"Confirm partial export")).click();
    await run;
    assert.equal(host.downloads.length,cancel?0:1);
    if(!cancel) {
      assert.match(host.downloads[0].filename,/ - partial\.lyl$/);
      const files=readStoredZip(new Uint8Array(await host.downloads[0].blob.arrayBuffer()));
      assert.match(new TextDecoder().decode(files.get("partial-export.json")),/private-failed/);
      assert.match(controls(host.env.__layerlingImportSession.panel).status.textContent,/PARTIAL EXPORT/);
      assert.ok(buttonIn(host.env.__layerlingImportSession.panel,"Locate failing part"));
    }
    assert.doesNotMatch([...storage.values.values()].join(""),/private-failed|Private failed part/);
    host.env.__layerlingImportSession.dispose();
    assert.equal(host.urls.size,0);
  }
});

test("selected bookmark uses its original snapshot and unknown selection still requires a choice", async () => {
  const host=bookmarkEnvironment({scope:null});
  host.env.document.title="3D design "+"Long name ".repeat(30)+" - Tinkercad";
  host.scene.data={versions_id:"single-part"};
  host.env.testKit.getSelectionCount=()=>1;
  host.env.testKit.getSelectedAt=()=>host.scene;
  const run=host.invoke();
  host.env.testKit.getSelectionCount=()=>0;
  host.env.testKit.getSelectedAt=()=>null;
  buttonIn(host.env.__layerlingImportSession.panel,"Export selected parts").click();
  await run;
  assert.match(host.downloads[0].filename,/ - selection\.lyl$/);
  host.env.__layerlingImportSession.dispose();
  const empty=bookmarkEnvironment({scope:null});
  empty.env.testKit.getSelectionCount=()=>{throw Error("Selection unavailable");};empty.env.testKit.getSelectedAt=()=>null;
  const pending=empty.invoke();
  assert.ok(buttonIn(empty.env.__layerlingImportSession.panel,"Export selected parts").disabled);
  controls(empty.env.__layerlingImportSession.panel).cancel.click();
  await pending;
  assert.equal(empty.captureCalls,0);
  assert.equal(empty.downloads.length,0);
  empty.env.__layerlingImportSession.dispose();
});

test("no selected parts exports the whole design without showing a scope choice", async () => {
  const host=bookmarkEnvironment({scope:null});
  host.env.testKit.getSelectionCount=()=>0;
  host.env.testKit.getSelectedAt=()=>{throw Error("No selection to read");};
  await host.invoke();
  assert.equal(host.captureCalls,1);
  assert.equal(host.downloads.length,1);
  assert.equal(host.downloads[0].filename,"Sample - arm.lyl");
  assert.equal(buttonIn(host.env.__layerlingImportSession.panel,"Export whole design"),undefined);
  assert.equal(host.errors.length,0);
  host.env.__layerlingImportSession.dispose();
});

test("multiple selected parts wait for the selected-parts or whole-design choice", async () => {
  const host=bookmarkEnvironment({scope:null});
  host.scene.data={versions_id:"single-part"};
  const second={...host.scene,versions_id:"second",data:{versions_id:"second"}};
  host.env.testKit.sceneModel.children.set("second",second);
  host.env.testKit.getSelectionCount=()=>2;
  host.env.testKit.getSelectedAt=index=>index ? second : host.scene;
  host.env.llm.tools.get_design_data.run=()=>({shapes:[host.shape,{...host.shape,versions_id:"second"}]});
  const pending=host.invoke();
  assert.equal(host.downloads.length,0);
  assert.ok(buttonIn(host.env.__layerlingImportSession.panel,"Export selected parts"));
  buttonIn(host.env.__layerlingImportSession.panel,"Export whole design").click();
  await pending;
  assert.equal(host.downloads.length,1);
  assert.equal(host.downloads[0].filename,"Sample - arm.lyl");
  host.env.__layerlingImportSession.dispose();
});

test("partial export cannot leave a Boolean result after a failure through two Boolean ancestors", async () => {
  const group=(id,type,children)=>({...leaf(id),dataType:"csg",params:{groupType:type},children});
  const data={shapes:[group("outer",1,[group("middle",0,[group("inner",1,[leaf("failed")])])]),leaf("keep")],
    meshes:{keep:mesh(0)},failures:[{id:"failed",label:"Failed",message:"Unavailable"}]};
  const blob=await context().convertTinkercadToLayerling(data,"Nested",{allowPartial:true});
  const files=readStoredZip(new Uint8Array(await blob.arrayBuffer()));
  const report=JSON.parse(new TextDecoder().decode(files.get("partial-export.json")));
  assert.deepEqual(report.omittedGroups.map(g=>g.id),["inner","outer"]);
  assert.equal(report.omittedSourceNodes,4);
  await assert.rejects(context().convertTinkercadToLayerling({...data,shapes:[data.shapes[0]],meshes:{}},"Empty",{allowPartial:true}),/No shapes/);
});

test("report bytes and entry count participate in reader limits", () => {
  const api=context().layerlingAssemblies,doc={assets:[],states:[{nodes:[]}],features:[]};
  const limits={...api.readerLimits,entries:1,expandedBytes:10};
  assert.equal(api.assess(doc,10,0,limits).issues.length,0);
  const report=api.assess(doc,10,0,limits,{entries:1,bytes:1});
  assert.deepEqual(report.issues.map(i=>i.limit),["entries","expandedBytes"]);
});

function failedNestedCapture() {
  const host=bookmarkEnvironment(), child=host.scene;
  child.geometry={get:()=>null};
  child.busy={get:()=>false};child.error={get:()=>"Generator unavailable"};
  const root={versions_id:"private-root",children:new Map([["child",child]]),
    hasLock:flag=>{assert.equal(flag,128);return false;},visible:{get:()=>true}};
  host.env.testKit.sceneModel.children=new Map([["root",root]]);
  host.env.testKit.selectionModel={objects:{values:()=>host.selected||[]}};
  host.env.llm.tools.get_design_data.run=()=>({shapes:[{versions_id:"private-root",dataType:"csg",
    params:{groupType:0},tags:{label:"Truck <private>"},children:[{...host.shape,tags:{label:"Grille <private>"}}]}]});
  host.selections=[];
  host.env.llm.tools.change_selection={run:async input=>{host.selections.push(input);host.selected=[root];}};
  host.root=root;return host;
}

test("a failed nested part shows its path and selects only its containing root on request",async()=>{
  const host=failedNestedCapture();await host.invoke();
  const panel=host.env.__layerlingImportSession.panel;
  assert.ok(panel.children.some(e=>e.textContent?.includes("Truck <private> → Grille <private>")));
  assert.equal(host.selections.length,0);
  const locate=panel.children.find(e=>e.textContent==="Locate failing part");assert.ok(locate);
  await locate.listeners.get("click")();
  assert.deepEqual(JSON.parse(JSON.stringify(host.selections)),[{shapes:[{versions_id:"private-root",selected:true}]}]);
  assert.ok(panel.children.some(e=>/Selected containing group/.test(e.textContent||"")));
  assert.equal(host.downloads.length,0);
});

test("failure location refuses hidden, locked, missing and replaced targets without selecting",async()=>{
  for(const state of ["hidden","locked","unknown-lock","removed","moved-child","removed-child","replaced","unavailable"]) {
    const host=failedNestedCapture();await host.invoke();
    if(state==="hidden")host.root.visible.get=()=>false;
    if(state==="locked")host.root.hasLock=()=>true;
    if(state==="unknown-lock")host.root.hasLock=()=>undefined;
    if(state==="removed")host.env.testKit.sceneModel.children.clear();
    if(state==="moved-child")host.root.children.clear();
    if(state==="removed-child")host.scene.hasBeenRemoved=true;
    if(state==="replaced")host.env.testKit.sceneModel.children.set("root",{...host.root});
    if(state==="unavailable")delete host.env.llm.tools.change_selection;
    const panel=host.env.__layerlingImportSession.panel;
    const locate=panel.children.find(e=>e.textContent==="Locate failing part");assert.ok(locate);
    await locate.listeners.get("click")();
    assert.equal(host.selections.length,0,state);
    assert.ok(panel.children.some(e=>/Cannot locate/.test(e.textContent||"")),state);
  }
});

test("detailed failure reports are explicit downloads and never enter normal reports or storage",async()=>{
  const host=failedNestedCapture(),storage=diagnosticStorage();host.env.localStorage=storage;
  await host.invoke();const panel=host.env.__layerlingImportSession.panel;
  assert.equal(host.downloads.length,0);
  const view=controls(panel);view.link.click();
  assert.doesNotMatch(await host.downloads.at(-1).blob.text(),/private|Grille|Truck|Generator unavailable|single-part/);
  assert.doesNotMatch([...storage.values.values()].join(""),/private|Grille|Truck|Generator unavailable|single-part/);
  const detailed=panel.children.find(e=>e.textContent==="Download detailed report");assert.ok(detailed);
  await detailed.listeners.get("click")();
  const report=JSON.parse(await host.downloads.at(-1).blob.text());
  assert.equal(report.format,"tinkercad-export-details-v1");
  assert.equal(report.failure.path[1].id,"single-part");
  assert.equal(report.failure.sourceError,"Generator unavailable");
  assert.equal(report.failure.busy,false);
  assert.equal(report.failure.libraryAttached,false);
  assert.equal(report.failure.positionCount,undefined);
  assert.match(report.message,/Missing geometry evaluator/);
  assert.equal(report.failure.positions,undefined);
  assert.equal(report.version,host.env.layerlingImporterVersion);
  host.env.__layerlingImportSession.dispose();assert.equal(host.urls.size,0);
});

test("a standalone failure selects itself and reports only finite counts and world origin",async()=>{
  const host=bookmarkEnvironment(), scene=host.scene;
  scene.geometry={get:()=>({attributes:{position:{count:0},normal:{count:Infinity}},index:{count:0}})};
  scene.visible={get:()=>true};scene.hasLock=()=>0;scene.library={};
  scene.computeWorldMatrix=()=>({elements:[1,0,0,0,0,1,0,0,0,0,1,0,12,-3,8,1]});
  let selected=[];
  host.env.testKit.selectionModel={objects:{values:()=>selected}};
  host.env.llm.tools.change_selection={run:async input=>{
    assert.deepEqual(JSON.parse(JSON.stringify(input)),{shapes:[{versions_id:"single-part",selected:true}]});
    selected=[scene];
  }};
  await host.invoke();const panel=host.env.__layerlingImportSession.panel;
  await panel.children.find(e=>e.textContent==="Locate failing part").listeners.get("click")();
  assert.ok(panel.children.some(e=>e.textContent==="Selected failing part."));
  await panel.children.find(e=>e.textContent==="Download detailed report").listeners.get("click")();
  const report=JSON.parse(await host.downloads[0].blob.text());
  assert.equal(report.failure.path.length,1);assert.equal(report.failure.positionCount,0);
  assert.equal(report.failure.indexCount,0);assert.equal(report.failure.normalCount,undefined);
  assert.equal(report.failure.libraryAttached,true);assert.deepEqual(report.failure.worldOrigin,[12,-3,8]);
  host.env.__layerlingImportSession.dispose();
});

test("closed failure controls cannot select or download; deep failure paths are bounded",async()=>{
  const host=failedNestedCapture(),original=host.env.llm.tools.get_design_data.run;
  host.env.llm.tools.get_design_data.run=()=>{
    const doc=original();let leaf=doc.shapes[0].children[0];
    for(let i=0;i<80;i++)leaf={versions_id:"nested-"+i,dataType:"csg",params:{groupType:0},tags:{label:"Group "+i},children:[leaf]};
    doc.shapes[0].children=[leaf];return doc;
  };
  await host.invoke();const panel=host.env.__layerlingImportSession.panel;
  const locate=panel.children.find(e=>e.textContent==="Locate failing part"),report=panel.children.find(e=>e.textContent==="Download detailed report");
  await report.listeners.get("click")();const details=JSON.parse(await host.downloads[0].blob.text()).failure;
  assert.equal(details.path.length,64);assert.equal(details.omittedAncestors,18);
  assert.equal(details.path[0].id,"private-root");assert.equal(details.path.at(-1).id,"single-part");
  const downloads=host.downloads.length;
  host.env.__layerlingImportSession.dispose();
  await locate.listeners.get("click")();await report.listeners.get("click")();
  assert.equal(host.selections.length,0);assert.equal(host.downloads.length,downloads);assert.equal(host.urls.size,0);
});

test("an interrupted export report survives reload and is offered before retrying", async () => {
  const storage = diagnosticStorage(), first = bookmarkEnvironment();
  first.env.localStorage = storage;
  first.env.performance = {memory:{usedJSHeapSize:123456,jsHeapSizeLimit:999999}};
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  first.env.llm.tools.get_design_data.run = () => { started(); return new Promise(()=>{}); };
  const task = first.invoke();
  await waiting;
  first.env.__layerlingImportSession.dispose();
  await task;

  const next = bookmarkEnvironment();
  next.env.localStorage = storage;
  await next.invoke();
  assert.equal(next.captureCalls, 0, "recovery must not automatically restart a crashing export");
  const view = controls(next.env.__layerlingImportSession.panel);
  assert.match(view.status.textContent, /previous export did not finish/);
  assert.equal(view.link.textContent, "Download failure report");
  view.link.click();
  assert.equal(next.downloads[0].filename, "tinkercad-export-diagnostics.json");
  const text = await next.downloads[0].blob.text(), report = JSON.parse(text);
  assert.equal(report.status, "running");
  assert.equal(report.samples.at(-1).jsHeapUsedEstimate, 123456);
  assert.doesNotMatch(text, /Sample|single-part|positions|sharecode|tinkercad\.com/);
  const retry = next.env.__layerlingImportSession.panel.children.find(e=>e.textContent==="Try export again");
  retry.click();
  next.chooseScope();
  await next.env.__layerlingImportSession.promise;
  assert.equal(next.captureCalls, 1);
  assert.equal(next.downloads.at(-1).filename.endsWith(".lyl"), true);
  assert.equal(JSON.parse([...storage.values.values()][0]).status, "complete");
});

test("blocked diagnostic storage cannot prevent a normal export", async () => {
  const host = bookmarkEnvironment();
  host.env.localStorage = {getItem(){throw Error("storage blocked");},setItem(){throw Error("storage blocked");}};
  await host.invoke();
  assert.equal(host.downloads.length, 1);
  assert.equal(host.errors.length, 0);
});

test("recovered reports discard unknown fields and design data", async () => {
  const host = bookmarkEnvironment(), storage = diagnosticStorage();
  host.env.localStorage = storage;
  storage.setItem("tinkercad-layerling:last-run:test", JSON.stringify({
    format:"tinkercad-export-diagnostics-v1",status:"running",positions:[1,2,3],
    latest:{phase:"private-model-name",url:"secret",currentTriangles:25},
    samples:[{phase:"compress",positions:[1],sharecode:"secret",currentBinaryBytes:100}],
  }));
  // The synthetic design URL contains test-design; the key uses its stable ID prefix.
  await host.invoke();
  controls(host.env.__layerlingImportSession.panel).link.click();
  const text = await host.downloads[0].blob.text();
  assert.doesNotMatch(text, /positions|private-model|secret|sharecode/);
  assert.equal(JSON.parse(text).latest.currentTriangles, 25);
});

test("diagnostics retain only a bounded checkpoint history", async () => {
  const host = bookmarkEnvironment(), storage = diagnosticStorage();
  host.env.localStorage = storage;
  let clock = 0;
  host.env.Date = class extends Date { static now(){return clock+=1000;} };
  const shapes = Array.from({length:40},(_,i)=>({...host.shape,versions_id:"part-"+i}));
  host.env.testKit.sceneModel.children = new Map(shapes.map(s=>[s.versions_id,{...host.scene,versions_id:s.versions_id}]));
  host.env.llm.tools.get_design_data.run = async () => ({shapes});
  await host.invoke();
  const report = JSON.parse([...storage.values.values()][0]);
  assert.equal(report.status, "complete");
  assert.equal(report.latest.totalParts, 40);
  assert.equal(report.latest.processedParts, 40);
  assert.equal(report.samples.length, 60);
  assert.doesNotMatch(JSON.stringify(report), /Sample|part-\d|positions|sharecode|tinkercad\.com/);
});

const source = fs.readFileSync(__dirname + "/browser-convert.js", "utf8");
function context(overrides = {}) {
  const sandbox = {
    Blob,
    CompressionStream,
    TextEncoder,
    DataView,
    Uint8Array,
    Uint32Array,
    Float64Array,
    Map,
    Set,
    Math,
    Number,
    String,
    Array,
    Object,
    Error,
    Date,
    crypto: require("node:crypto").webcrypto,
    setTimeout,
    ...overrides,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(__dirname + "/browser-assemblies.js", "utf8"), sandbox);
  vm.runInNewContext(source, sandbox);
  return sandbox;
}
const leaf = (id) => ({
  versions_id: id,
  dataType: "preset",
  params: { id: "custom" },
  tags: {},
});
const mesh = (x) => ({
  space: "world",
  positions: [x, 0, 0, x + 2, 0, 0, x, 3, 4],
  normals: [0, -0.8, 0.6, 0, -0.8, 0.6, 0, -0.8, 0.6],
});

test("spatial notes preserve Unicode and world positions in single and split projects", async () => {
  const c=context(), input={shapes:[leaf("a"),leaf("b")],meshes:{a:mesh(0),b:mesh(100)},notes:[
    {uuid:"a",content:"Fit 🟢\nDo not trim ",position:{x:1,y:2,z:3}},
    {uuid:"b",content:"Far note",position:{x:101,y:2,z:3}}]};
  const unpack=bytes=>JSON.parse(new TextDecoder().decode(readStoredZip(bytes).get("project.json")));
  const doc=unpack(new Uint8Array(await (await c.convertTinkercadToLayerling(input)).arrayBuffer()));
  assert.deepEqual(doc.states[0].notes.map(n=>[n.text,n.x,n.y,n.z]),[[input.notes[0].content,1,3,-2],["Far note",101,3,-2]]);
  const bundle=await c.convertTinkercadToLayerling(input,"Notes",{output:"assemblies",assemblyLimits:{nodes:1}});
  const files=readStoredZip(new Uint8Array(await bundle.arrayBuffer()));
  const parts=[...files].filter(([name])=>name.endsWith(".lyl")).map(([,bytes])=>unpack(bytes));
  assert.equal(parts.length,2);
  assert.deepEqual(parts.flatMap(p=>p.states[0].notes||[]).sort((a,b)=>a.x-b.x),doc.states[0].notes);
  assert.ok(parts.every(p=>p.states[0].notes.length===1));
});

test("unsupported notes fail before geometry instead of silently losing text", async () => {
  const valid={content:"Text",position:{x:0,y:0,z:0}};
  for(const notes of [[{...valid,content:"x".repeat(2001)}],Array(201).fill(valid),[{...valid,position:{x:NaN,y:0,z:0}}],{}]) {
    let reads=0;
    await assert.rejects(context().convertTinkercadToLayerling({shapes:[leaf("a")],notes,readMesh:async()=>{reads++;return mesh(0);}}),/note/i);
    assert.equal(reads,0);
  }
});

test("lazy conversion reads one mesh at a time and compresses before requesting the next", async () => {
  let active = false, compressed = 0;
  const reads = [];
  const c = context();
  const input = { shapes: [leaf("a"), leaf("b")], meshes: {}, readMesh: async id => {
    assert.equal(active, false);
    assert.equal(compressed, reads.length);
    reads.push(id);
    active = true;
    const m = mesh(id === "a" ? 0 : 4);
    if (id === "b") m.positions[3] += 1;
    active = false;
    return {...m, positions: new Float64Array(m.positions), normals: new Float64Array(m.normals)};
  }};
  const blob = await c.convertTinkercadToLayerling(input, "Lazy", {onProgress(message) {
    if (message.startsWith("Compressing mesh")) compressed++;
  }});
  assert.deepEqual(reads, ["a", "b"]);
  assert.equal(readStoredZip(new Uint8Array(await blob.arrayBuffer())).size, 3);
  assert.deepEqual(input.meshes, {});
});

test("a failed lazy mesh read never returns a partial project", async () => {
  const c = context();
  await assert.rejects(c.convertTinkercadToLayerling({shapes:[leaf("a"),leaf("b")],meshes:{},readMesh:async id => {
    if (id === "b") throw Error("source capture failed");
    return mesh(0);
  }}), /source capture failed/);
});
function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder(),
    entries = new Map();
  let at = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data) => {
    let c = 0xffffffff;
    for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  while (view.getUint32(at, true) === 0x04034b50) {
    const check = view.getUint32(at + 14, true),
      size = view.getUint32(at + 18, true),
      nameLen = view.getUint16(at + 26, true),
      extraLen = view.getUint16(at + 28, true),
      name = decoder.decode(bytes.slice(at + 30, at + 30 + nameLen)),
      start = at + 30 + nameLen + extraLen,
      payload = bytes.slice(start, start + size),
      method = view.getUint16(at + 8, true);
    assert.ok(method === 0 || method === 8, `ZIP method ${method}`);
    const data = method === 8
      ? new Uint8Array(require("node:zlib").inflateRawSync(payload)) : payload;
    assert.equal(data.length, view.getUint32(at + 22, true), `size ${name}`);
    assert.equal(crc(data), check, `CRC ${name}`);
    entries.set(name, data);
    at = start + size;
  }
  assert.equal(
    view.getUint32(at, true),
    0x02014b50,
    "central directory follows local entries",
  );
  return entries;
}

test("compressed and fallback projects preserve identical contents", async () => {
  const input = { shapes: [leaf("part")], meshes: { part: mesh(11.125) } };
  const make = async c => new Uint8Array(await (await c.convertTinkercadToLayerling(input)).arrayBuffer());
  const packed = await make(context()), plain = await make(context({ CompressionStream: undefined }));
  assert.equal(new DataView(packed.buffer).getUint16(8, true), 8);
  assert.equal(new DataView(plain.buffer).getUint16(8, true), 0);
  assert.ok(packed.length < plain.length);
  const a = readStoredZip(packed), b = readStoredZip(plain);
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const name of a.keys()) {
    if (name !== "project.json") assert.deepEqual(a.get(name), b.get(name));
    else {
      const normalize = bytes => {
        const doc = JSON.parse(new TextDecoder().decode(bytes));
        delete doc.metadata.createdAt;
        delete doc.metadata.modifiedAt;
        delete doc.history.entries[0].recordedAt;
        return doc;
      };
      assert.deepEqual(normalize(a.get(name)), normalize(b.get(name)));
    }
  }
});

test("unsupported raw compression falls back to a readable project", async () => {
  const c = context({ CompressionStream: class {
    constructor() { throw new TypeError("unsupported format"); }
  } });
  const blob = await c.convertTinkercadToLayerling({ shapes: [leaf("part")], meshes: { part: mesh(0) } });
  assert.equal(readStoredZip(new Uint8Array(await blob.arrayBuffer())).size, 2);
});

test("an entry that grows under compression is stored without compression", async () => {
  const c = context({ CompressionStream: class {
    constructor() {
      const chunks = [];
      return new TransformStream({
        transform(value) { chunks.push(value); },
        flush(controller) {
          controller.enqueue(require("node:zlib").deflateRawSync(Buffer.concat(chunks), { level: 0 }));
        },
      });
    }
  } });
  const blob = await c.convertTinkercadToLayerling({ shapes: [leaf("part")], meshes: { part: mesh(0) } });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint16(8, true), 0);
  assert.equal(readStoredZip(bytes).size, 2);
});

test("cancellation while compression is active rejects without a project", async () => {
  const controller = new AbortController();
  const c = context({ CompressionStream: class {
    constructor() {
      return new TransformStream({ transform() { controller.abort(); } });
    }
  } });
  await assert.rejects(c.convertTinkercadToLayerling({ shapes: [leaf("part")], meshes: { part: mesh(0) } },
    "Cancelled", { signal: controller.signal }), error => error.name === "AbortError");
});

test("compression failures are reported rather than downloading partial data", async () => {
  const c = context({ CompressionStream: class {
    constructor() {
      return new TransformStream({ transform() { throw Error("compression failed"); } });
    }
  } });
  await assert.rejects(c.convertTinkercadToLayerling({ shapes: [leaf("part")], meshes: { part: mesh(0) } }),
    /compression failed/);
});

test("a compression initialization failure is not treated as an unsupported browser", async () => {
  const c = context({ CompressionStream: class {
    constructor() { throw Error("compressor initialization failed"); }
  } });
  await assert.rejects(c.convertTinkercadToLayerling({ shapes: [leaf("part")], meshes: { part: mesh(0) } }),
    /compressor initialization failed/);
});

test("browser conversion creates a readable Layerling ZIP with binary mesh and coordinate conversion", async () => {
  const c = context(),
    blob = await c.convertTinkercadToLayerling(
      { shapes: [leaf("part")], meshes: { part: mesh(11.125) } },
      "Test",
    );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const decoder = new TextDecoder(),
    entries = readStoredZip(bytes);
  const project = JSON.parse(decoder.decode(entries.get("project.json"))),
    object = project.states[0].nodes[0];
  assert.equal(project.schema, "com.layerling.project");
  assert.equal(object.definition.x, 12.125);
  assert.equal(object.definition.elevation, 0);
  const asset = project.assets[0],
    meshBytes = entries.get(asset.path);
  assert.ok(meshBytes);
  assert.equal(meshBytes.length, asset.byteLength);
  assert.equal(decoder.decode(meshBytes.slice(0, 8)), "LYLMSH1\0");
  assert.ok(blob.size > 300);
});

test("browser conversion rejects missing evaluated geometry before producing a project", async () => {
  const c = context();
  await assert.rejects(
    c.convertTinkercadToLayerling(
      { shapes: [leaf("missing")], meshes: {} },
      "Bad",
    ),
    /missing evaluated world mesh/,
  );
});

test("boolean groups retain evaluated output and editable children", async () => {
  const c = context(),
    tree = {
      shapes: [
        {
          versions_id: "group",
          dataType: "csg",
          params: { groupType: 1 },
          tags: {},
          children: [
            leaf("body"),
            { ...leaf("cutter"), tags: { volumePolarity: -1 } },
          ],
        },
      ],
      meshes: { group: mesh(0), body: mesh(0), cutter: mesh(1) },
    };
  const blob = await c.convertTinkercadToLayerling(tree, "Grouped");
  const entries = readStoredZip(new Uint8Array(await blob.arrayBuffer())),
    project = JSON.parse(new TextDecoder().decode(entries.get("project.json"))),
    nodes = project.states[0].nodes;
  const group = nodes.find((n) => n.objectId === "group"),
    cutter = nodes.find((n) => n.objectId === "cutter");
  assert.ok(group.importedMesh);
  assert.equal(group.groupedShapeNodeIds.length, 2);
  assert.equal(group.definition.groupOperation, "group");
  assert.equal(cutter.definition.hole, true);
});

test("the installed bookmark fits Firefox's saved URL limit", () => {
  const url = bookmarkURL();
  assert.ok(url.length <= 65536, `Bookmark URL is ${url.length} characters; Firefox allows 65536`);
  assert.equal(decodeURIComponent(new URL(url).href.slice(11)),bookmarkSource());
  assert.equal(new URL(url).hash,"");
});

test("generated install page embeds a syntactically valid, self-contained bookmarklet", () => {
  const bookmark = bookmarkSource();
  assert.match(bookmark, /convertTinkercadToLayerling/);
  assert.match(bookmark, /void runLayerlingImport\(\)/);
  new Function(bookmark);
});

test("the direct bookmarklet captures, converts, and downloads one Layerling file", async () => {
  const host = bookmarkEnvironment();
  await host.invoke();
  assert.equal(host.downloads.length, 1);
  assert.equal(host.downloads[0].filename, "Sample - arm.lyl");
  const entries = readStoredZip(
    new Uint8Array(await host.downloads[0].blob.arrayBuffer()),
  );
  assert.ok(entries.has("project.json"));
  assert.equal(
    JSON.parse(new TextDecoder().decode(entries.get("project.json"))).states[0]
      .nodes.length,
    1,
  );
});

test("two clicks share a capture; retained download retries without recapturing and close releases it", async () => {
  const host = bookmarkEnvironment(),
    task = host.invoke();
  assert.equal(
    controls(host.env.__layerlingImportSession.panel).link.hidden,
    true,
  );
  host.invoke();
  await task;
  assert.equal(host.captureCalls, 1);
  assert.equal(host.env.document.body.children.length, 1);
  const session = host.env.__layerlingImportSession,
    { status, link, close } = controls(session.panel);
  assert.match(status.textContent, /Project ready/);
  assert.equal(close.disabled, false);
  assert.equal(host.urls.size, 1);
  link.click();
  assert.equal(host.downloads.length, 2);
  assert.equal(host.captureCalls, 1);
  close.click();
  assert.equal(host.urls.size, 0);
  assert.equal(host.env.document.body.children.length, 0);
});

test("Cancel interrupts pending geometry and leaves a closeable panel with no download", async () => {
  const host = bookmarkEnvironment();
  let started;
  const pending = new Promise(resolve => {started=resolve;});
  host.scene.geometry.get = () => null;
  host.scene.evaluate = () => {started(); return new Promise(() => {});};
  const task = host.invoke();
  await pending;
  const view = controls(host.env.__layerlingImportSession.panel);
  assert.equal(view.cancel.disabled, undefined);
  view.cancel.click();
  await task;
  assert.match(view.status.textContent, /Import cancelled/);
  assert.equal(view.close.disabled, false);
  assert.equal(host.downloads.length, 0);
  assert.equal(host.env.__layerlingImportSession.busy, false);
  view.close.click();
  assert.equal(host.env.document.body.children.length, 0);
});

test("a cancelled converter refuses to produce a project", async () => {
  await assert.rejects(context().convertTinkercadToLayerling({
    shapes:[leaf("part")],meshes:{part:mesh(0)},
  },"Cancelled",{signal:{aborted:true}}), error=>error.name==="AbortError");
});

test("cancelling during packaging does not return a downloadable project", async () => {
  for (const cancelAtEnd of [false,true]) {
    const controller = new AbortController();
    await assert.rejects(context().convertTinkercadToLayerling({shapes:[leaf("part")],meshes:{part:mesh(0)}},"Cancelled",{
      signal:controller.signal,onProgress(message){
        const progress=message.match(/Packaging project \((\d+)\/(\d+)\)/);
        if(progress && (!cancelAtEnd || progress[1]===progress[2])) controller.abort();
      },
    }), error=>error.name==="AbortError");
  }
});

test("Cancel during the initial request finishes immediately and ignores a late result", async () => {
  const host = bookmarkEnvironment();
  let finish, began;
  const started = new Promise(resolve => {began = resolve;});
  host.env.llm.tools.get_design_data.run = () => new Promise(resolve => {finish = resolve; began();});
  const task = host.invoke();
  await started;
  const view = controls(host.env.__layerlingImportSession.panel);
  view.cancel.click();
  await task;
  assert.match(view.status.textContent,/Import cancelled/);
  assert.equal(view.close.disabled,false);
  finish({shapes:[host.shape]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(host.downloads.length,0);
});

test("leaving the page during capture suppresses the pending download", async () => {
  const early = bookmarkEnvironment(),
    earlyTask = early.invoke();
  early.env.__layerlingImportSession.dispose();
  await earlyTask;
  assert.equal(early.captureCalls, 0);
  assert.equal(early.downloads.length, 0);
  const host = bookmarkEnvironment();
  let finish;
  host.env.llm.tools.get_design_data.run = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const task = host.invoke();
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 1));
  host.env.__layerlingImportSession.dispose();
  finish({ shapes: [host.shape] });
  await task;
  assert.equal(host.downloads.length, 0);
  assert.equal(host.urls.size, 0);
  assert.equal(host.env.document.body.children.length, 0);
});

test("the bookmark refuses non-editor pages without enabling tools or reading designs", async () => {
  const host = bookmarkEnvironment();
  host.env.location.pathname = "/dashboard";
  await host.invoke();
  assert.equal(host.captureCalls, 0);
  assert.equal(host.env.__layerlingImportSession, undefined);
  assert.equal(host.downloads.length, 0);
});

test("failed captures offer a diagnostic download without automatically downloading a partial project", async () => {
  const host = bookmarkEnvironment();
  host.env.testKit.sceneModel.children.clear();
  await host.invoke();
  const session = host.env.__layerlingImportSession;
  assert.equal(host.downloads.length, 0);
  assert.equal(host.urls.size, 1);
  assert.equal(session.busy, false);
  const link=controls(session.panel).link;
  assert.match(controls(session.panel).status.textContent, /Import failed/);
  assert.match(link.textContent,/Download failure report/);
  assert.equal(link.hidden,false);
  link.click();
  assert.equal(host.downloads.length,1);
  assert.equal(host.downloads[0].filename,"tinkercad-export-diagnostics.json");
  const report=JSON.parse(await host.downloads[0].blob.text());
  assert.equal(report.status,"error");
  host.downloads.length=0;
  host.env.testKit.sceneModel.children.set("single-part", host.scene);
  await host.invoke();
  assert.equal(host.downloads.length, 1);
});

test("a blocked automatic download leaves a working link for a manual retry", async () => {
  const host = bookmarkEnvironment(),
    create = host.env.document.createElement;
  let blocked = true;
  host.env.document.createElement = (tag) => {
    const element = create(tag),
      click = element.click.bind(element);
    if (tag === "a")
      element.click = () => {
        if (blocked) {
          blocked = false;
          throw Error("Automatic download blocked");
        }
        click();
      };
    return element;
  };
  await host.invoke();
  assert.equal(host.downloads.length, 0);
  const link = controls(host.env.__layerlingImportSession.panel).link;
  assert.equal(link.hidden, false);
  link.click();
  assert.equal(host.downloads.length, 1);
  assert.equal(host.captureCalls, 1);
});

test("capture identity strings cannot change the mesh table prototype", async () => {
  const host = bookmarkEnvironment();
  host.shape.versions_id = "__proto__";
  host.scene.versions_id = "__proto__";
  host.env.testKit.sceneModel.children.clear();
  host.env.testKit.sceneModel.children.set("__proto__", host.scene);
  await host.invoke();
  assert.equal(host.downloads.length, 1);
  const project = JSON.parse(
    new TextDecoder().decode(
      readStoredZip(
        new Uint8Array(await host.downloads[0].blob.arrayBuffer()),
      ).get("project.json"),
    ),
  );
  assert.equal(project.states[0].nodes[0].objectId, "--proto--");
});

test("two equal surfaces keep the last source material and retain earlier editable nodes", async () => {
  const a = leaf("a"),
    b = leaf("b");
  a.tags.renderingMaterial = { color: { r: 255, g: 0, b: 0 } };
  b.tags.renderingMaterial = { color: { r: 0, g: 255, b: 0 } };
  const tree = {
    shapes: [
      {
        versions_id: "bundle",
        dataType: "csg",
        params: { groupType: 0 },
        tags: { isMulticolor: true },
        children: [a, b],
      },
    ],
    meshes: { a: mesh(0), b: mesh(0) },
  };
  const before = JSON.stringify(tree),
    blob = await context().convertTinkercadToLayerling(tree);
  const project = JSON.parse(
    new TextDecoder().decode(
      readStoredZip(new Uint8Array(await blob.arrayBuffer())).get(
        "project.json",
      ),
    ),
  );
  const nodes = project.states[0].nodes;
  assert.equal(nodes.find((n) => n.objectId === "a").definition.hidden, true);
  assert.equal(
    nodes.find((n) => n.objectId === "b").definition.hidden,
    undefined,
  );
  assert.equal(
    nodes.find((n) => n.objectId === "b").definition.color,
    "#00ff00",
  );
  assert.equal(JSON.stringify(tree), before);
});

test("ambiguous or malformed trees fail rather than omit source parts", async () => {
  for (const shapes of [
    [leaf("a"), null],
    [leaf("a"), leaf("a")],
    [{ ...leaf("a"), children: {} }],
    [{ ...leaf("a"), versions_id: 12 }],
  ]) {
    await assert.rejects(
      context().convertTinkercadToLayerling({ shapes, meshes: { a: mesh(0) } }),
    );
  }
});

test("coincident faces with reversed winding remain separate editable surfaces", async () => {
  for (const normals of [true, false]) {
    const a = mesh(0),
      b = mesh(0);
    b.positions = [
      ...b.positions.slice(0, 3),
      ...b.positions.slice(6, 9),
      ...b.positions.slice(3, 6),
    ];
    if (!normals) {
      delete a.normals;
      delete b.normals;
    }
    const input = {
      shapes: [
        {
          versions_id: "bundle",
          dataType: "csg",
          params: { groupType: 0 },
          children: [leaf("a"), leaf("b")],
        },
      ],
      meshes: { a, b },
    };
    const blob = await context().convertTinkercadToLayerling(input),
      project = JSON.parse(
        new TextDecoder().decode(
          readStoredZip(new Uint8Array(await blob.arrayBuffer())).get(
            "project.json",
          ),
        ),
      );
    assert.equal(
      project.states[0].nodes.some((n) => n.definition.hidden),
      false,
    );
  }
});


test("part progress shows an honest count and percentage while geometry waits, then completes", async () => {
  const host=bookmarkEnvironment();let ready,finish;
  const geometry=host.scene.geometry.get();
  host.scene.geometry.get=()=>ready;
  host.scene.evaluate=()=>new Promise(resolve=>{finish=()=>{ready=geometry;resolve();};});
  const run=host.invoke();
  await new Promise(resolve=>setTimeout(resolve,15));
  const panel=host.env.__layerlingImportSession.panel;
  const meter=panel.children.find(e=>e.tag==="progress");
  const counts=panel.children.find(e=>e.textContent?.startsWith("Parts converted:"));
  assert.match(counts.textContent,/0 \/ 1 \(0%\)/);
  assert.equal(meter.value,0);
  assert.match(controls(panel).status.textContent,/Waiting for geometry/);
  finish();await run;
  assert.match(counts.textContent,/1 \/ 1 \(100%\)/);
  assert.equal(meter.value,100);
  assert.equal(meter["aria-label"],"Export complete");
  assert.ok(panel.children.some(e=>e.textContent?.startsWith("Elapsed:")));
  assert.ok(!panel.children.some(e=>/time remaining/i.test(e.textContent||"")));
});


test("assembly exports preserve every construction node, position and exact asset bytes", async () => {
  const c=context(), group={versions_id:"g",dataType:"csg",params:{groupType:1},tags:{isMulticolor:true},children:[leaf("a"),leaf("b")]};
  group.children[1].tags={visible:false,volumePolarity:-1};
  const input={shapes:[group,leaf("c")],meshes:{g:mesh(0),a:mesh(0),b:mesh(10),c:mesh(25)}};
  const original=readStoredZip(new Uint8Array(await (await c.convertTinkercadToLayerling(input,"Whole")).arrayBuffer()));
  const doc=JSON.parse(new TextDecoder().decode(original.get("project.json")));
  let output;
  const bundle=await c.convertTinkercadToLayerling(input,"Whole",{output:"assemblies",assemblyLimits:{nodes:2},onOutput:v=>{output=v;}});
  assert.equal(bundle.type,"application/zip");
  assert.equal(output.extension,".zip");assert.equal(output.assemblies,2);assert.equal(output.oversized,1);
  const files=readStoredZip(new Uint8Array(await bundle.arrayBuffer())),seen=new Set();
  const manifest=JSON.parse(new TextDecoder().decode(files.get("assemblies.json")));
  for(const part of manifest.parts) {
    const entries=readStoredZip(files.get(part.file));
    const project=JSON.parse(new TextDecoder().decode(entries.get("project.json")));
    for(const n of project.states[0].nodes) {
      assert.ok(!seen.has(n.nodeId));seen.add(n.nodeId);
      assert.deepEqual(n,doc.states[0].nodes.find(x=>x.nodeId===n.nodeId));
    }
    assert.deepEqual(project.editor,doc.editor);
    for(const asset of project.assets) assert.deepEqual(entries.get(asset.path),original.get(asset.path));
    const ids=new Set(project.states[0].nodes.map(n=>n.objectId));
    for(const f of project.features) for(const id of f.inputObjectIds) assert.ok(ids.has(id));
  }
  assert.equal(seen.size,doc.states[0].nodes.length);
  assert.match(new TextDecoder().decode(files.get("README.txt")),/not live verified/);
});

test("large-project choice can keep a single project and cancellation cannot return a bundle", async () => {
  const c=context(),input={shapes:[leaf("a"),leaf("b")],meshes:{a:mesh(0),b:mesh(8)}};
  let prompts=0;
  const blob=await c.convertTinkercadToLayerling(input,"Single",{assemblyLimits:{nodes:1},onLargeProject:async plan=>{
    prompts++;assert.equal(plan.parts.length,2);return "single";
  }});
  assert.equal(prompts,1);assert.ok(readStoredZip(new Uint8Array(await blob.arrayBuffer())).has("project.json"));
  const controller=new AbortController();
  await assert.rejects(c.convertTinkercadToLayerling(input,"Cancelled",{assemblyLimits:{nodes:1},signal:controller.signal,
    onLargeProject:async()=>{controller.abort();return "assemblies";}}),{name:"AbortError"});
});

test("version checks compare numeric versions and request only fixed public metadata", async () => {
  const host=bookmarkEnvironment();await host.invoke();
  assert.ok(host.env.__layerlingImportSession.panel.children.some(e=>e.textContent===`Version ${host.env.layerlingImporterVersion}`));
  const seen=[];
  host.env.fetch=async(url,options)=>{seen.push({url,options});return {ok:true,text:async()=>'{"version":"0.10.0"}'};};
  const result=await host.env.layerlingImportUI.checkUpdate();
  assert.equal(result.newer,true);assert.equal(seen[0].options.credentials,"omit");
  assert.equal(seen[0].options.referrerPolicy,"no-referrer");assert.match(seen[0].url,/\/version.json$/);
  host.env.fetch=async()=>({ok:true,text:async()=>'{"version":"https://untrusted.example/x.js"}'});
  await assert.rejects(host.env.layerlingImportUI.checkUpdate(),/Invalid update version/);
  host.env.fetch=async()=>{throw Error("CSP blocked");};
  await assert.rejects(host.env.layerlingImportUI.checkUpdate(),/CSP blocked/);
});

test("online loader uses a fixed script URL, refuses busy exports, and reports blocked scripts", () => {
  const host=bookmarkEnvironment();
  vm.runInContext(fs.readFileSync(__dirname+"/browser-loader.js","utf8"),host.env);
  const pending=[],timers=new Map();let next=0;
  host.env.setTimeout=(fn)=>{timers.set(++next,fn);return next;};host.env.clearTimeout=id=>timers.delete(id);
  host.env.document.head={append:script=>pending.push(script)};
  host.env.__layerlingImportSession={busy:true};host.env.layerlingLoadLatest();assert.equal(pending.length,0);
  delete host.env.__layerlingImportSession;
  host.env.layerlingLoadLatest();assert.equal(pending.length,1);
  assert.match(pending[0].src,/^https:\/\/taylormadearmy\.github\.io\/tinkercad-layerling-importer\/importer.js\?t=\d+$/);
  assert.equal(pending[0].referrerPolicy,"no-referrer");
  pending[0].onerror();assert.equal(timers.size,0);assert.equal(host.env.__layerlingLoaderActive,false);
  assert.ok(host.errors.some(e=>String(e).includes("blocked or unavailable")));
});


test("large-design choice downloads the selected ZIP and can be cancelled before packaging", async () => {
  for (const cancel of [false,true]) {
    const host=bookmarkEnvironment();
    vm.runInContext(bookmarkSource().replace(/void runLayerlingImport\(\);\s*$/,""),host.env);
    host.env.convertTinkercadToLayerling=async(input,name,options)=>{
      const decision=await options.onLargeProject({meshBytes:200000000,nodeCount:2000,parts:[{},{}],oversizedCount:1});
      assert.equal(decision,"assemblies");
      options.onOutput({extension:".zip",assemblies:2,oversized:1});return new Blob(["test bundle"]);
    };
    const run=host.start();
    await new Promise(resolve=>setTimeout(resolve,10));
    const panel=host.env.__layerlingImportSession.panel;
    const choices=panel.children.find(e=>e.tag==="div");assert.ok(choices);
    assert.match(choices.children[0].textContent,/cannot be divided/);
    assert.equal(host.downloads.length,0);
    if(cancel) controls(panel).cancel.click();
    else choices.children.find(e=>e.textContent==="Export smaller assemblies").click();
    await run;
    assert.equal(host.downloads.length,cancel?0:1);
    assert.ok(!panel.children.includes(choices));
    if(!cancel) assert.match(host.downloads[0].filename,/\.zip$/);
    else assert.match(controls(panel).status.textContent,/Import cancelled/);
  }
});

test("online runtime loads without starting capture and the loader can start it after a successful load", () => {
  const host=bookmarkEnvironment(),pending=[];
  host.env.document.head={append:script=>pending.push(script)};
  const runtime=fs.readFileSync(__dirname+"/importer.js","utf8");
  vm.runInContext(runtime,host.env);
  assert.equal(host.captureCalls,0);assert.equal(host.env.__layerlingRuntimeLoaded,true);
  let starts=0;host.env.runLayerlingImport=()=>{starts++;};
  host.env.layerlingLoadLatest();assert.equal(pending.length,1);
  assert.equal(host.env.__layerlingRuntimeLoaded,false);
  host.env.__layerlingRuntimeLoaded=true;pending[0].onload();
  assert.equal(starts,1);assert.equal(host.env.__layerlingLoaderActive,false);
  pending[0].onload();assert.equal(starts,1);
});


test("Cancel interrupts checking a large assembly Blob before any bundle is returned", async () => {
  const c=context({CompressionStream:undefined}),controller=new AbortController();let checking=false;
  await assert.rejects(c.convertTinkercadToLayerling({shapes:[leaf("large")],meshes:{large:{space:"world",positions:new Float64Array(9*18000)}}},
    "Cancel",{output:"assemblies",signal:controller.signal,onDiagnostic(value){
      if(value.phase==="assembly-packaging"){checking=true;setTimeout(()=>controller.abort(),0);}
    }}),{name:"AbortError"});
  assert.equal(checking,true);
});


test("reader limits use exact byte boundaries and include expanded size, JSON, asset and entry limits", () => {
  const c=context(),api=c.layerlingAssemblies,limits=api.readerLimits;
  assert.equal(limits.archiveBytes,512*1024*1024);assert.equal(limits.expandedBytes,1024*1024*1024);
  const doc={assets:[],states:[{nodes:[]}],features:[]};
  const keys=result=>Array.from(result.issues,i=>i.limit);
  assert.deepEqual(keys(api.assess(doc,limits.projectJsonBytes,limits.archiveBytes)),[]);
  assert.ok(keys(api.assess(doc,0,limits.archiveBytes+1)).includes("archiveBytes"));
  assert.ok(keys(api.assess(doc,limits.projectJsonBytes+1)).includes("projectJsonBytes"));
  doc.assets=[{byteLength:limits.assetBytes}];
  assert.deepEqual(keys(api.assess(doc,0)),[]);
  doc.assets[0].byteLength++;assert.ok(keys(api.assess(doc,0)).includes("assetBytes"));
  doc.assets=Array.from({length:4},()=>({byteLength:limits.assetBytes}));
  assert.deepEqual(keys(api.assess(doc,0)),[]);
  assert.ok(keys(api.assess(doc,1)).includes("expandedBytes"));
  doc.assets=Array.from({length:limits.entries-1},()=>({byteLength:0}));
  assert.deepEqual(keys(api.assess(doc,0)),[]);
  doc.assets.push({byteLength:0});assert.ok(keys(api.assess(doc,0)).includes("entries"));
  doc.assets=[];doc.states[0].nodes=[{importedMesh:{triangleCount:3333334}}];
  assert.ok(keys(api.assess(doc,0)).includes("meshNumbers"));
});

test("assemblies split further when actual reader limits are tighter than grouping targets", async () => {
  const c=context(),assess=c.layerlingAssemblies.assess;
  c.layerlingAssemblies.assess=(doc,json,size)=>assess(doc,json,size,{...c.layerlingAssemblies.readerLimits,entries:2});
  const a=mesh(0),b=mesh(10);b.positions[3]+=1;
  let output;
  const blob=await c.convertTinkercadToLayerling({shapes:[leaf("a"),leaf("b")],meshes:{a,b},
    notes:[{content:"Once",position:{x:10,y:0,z:0}}]},"Extra split",{
    output:"assemblies",onOutput:v=>{output=v;}});
  assert.equal(output.assemblies,2);assert.equal(output.importable,2);assert.equal(output.blocked,0);
  const files=readStoredZip(new Uint8Array(await blob.arrayBuffer()));
  const manifest=JSON.parse(new TextDecoder().decode(files.get("assemblies.json")));
  const notes=[];
  for(const p of manifest.parts) {
    assert.equal(p.importable,true);assert.deepEqual(p.issues,[]);
    assert.equal(readStoredZip(files.get(p.file)).size,2);
    const doc=JSON.parse(new TextDecoder().decode(readStoredZip(files.get(p.file)).get("project.json")));
    notes.push(...doc.states[0].notes || []);
  }
  assert.equal(notes.length,1);assert.equal(notes[0].text,"Once");
});

test("an indivisible over-limit construction is preserved separately without posing as an importable project", async () => {
  const c=context(),assess=c.layerlingAssemblies.assess;
  c.layerlingAssemblies.assess=(doc,json,size)=>assess(doc,json,size,{...c.layerlingAssemblies.readerLimits,entries:2});
  const hole=leaf("b");hole.tags={volumePolarity:-1,visible:false};
  const group={versions_id:"g",dataType:"csg",params:{groupType:1},tags:{},children:[leaf("a"),hole]};
  const b=mesh(10);b.positions[3]+=1;let output;
  const blob=await c.convertTinkercadToLayerling({shapes:[group,leaf("c")],meshes:{g:mesh(0),a:mesh(0),b,c:mesh(30)}},"Preserve",{
    output:"assemblies",onOutput:v=>{output=v;}});
  assert.equal(output.importable,1);assert.equal(output.blocked,1);
  const files=readStoredZip(new Uint8Array(await blob.arrayBuffer()));
  const manifest=JSON.parse(new TextDecoder().decode(files.get("assemblies.json")));
  const blocked=manifest.parts.find(p=>!p.importable),ready=manifest.parts.find(p=>p.importable);
  assert.match(blocked.file,/^needs-attention\/.*\.preserved-project\.zip$/);
  assert.ok(blocked.issues.some(i=>i.limit==="entries"));assert.match(ready.file,/\.lyl$/);
  const entries=readStoredZip(files.get(blocked.file)),project=JSON.parse(new TextDecoder().decode(entries.get("project.json")));
  assert.equal(project.states[0].nodes.length,3);
  assert.ok(project.states[0].nodes.some(n=>n.definition.hole && n.definition.hidden));
  assert.ok(project.states[0].nodes.some(n=>n.groupedShapeNodeIds?.length===2));
  assert.match(new TextDecoder().decode(files.get("README.txt")),/NOT importable/);
});

test("a single file cannot bypass the final compressed archive limit", async () => {
  const c=context(),assess=c.layerlingAssemblies.assess;let outputs=0;
  c.layerlingAssemblies.assess=(doc,json,size)=>assess(doc,json,size,{...c.layerlingAssemblies.readerLimits,archiveBytes:100});
  await assert.rejects(c.convertTinkercadToLayerling({shapes:[leaf("a")],meshes:{a:mesh(0)}},"Too large",{
    onOutput:()=>{outputs++;}}),/Layerling cannot open.*compressed file bytes/);
  assert.equal(outputs,0);
});


test("a known reader-limit violation disables Keep one project and completion identifies blocked constructions", async () => {
  const host=bookmarkEnvironment();
  vm.runInContext(bookmarkSource().replace(/void runLayerlingImport\(\);\s*$/,""),host.env);
  host.env.convertTinkercadToLayerling=async(input,name,options)=>{
    const decision=await options.onLargeProject({meshBytes:2000000000,nodeCount:2000,parts:[{}],oversizedCount:1,
      readerIssues:[{message:"expanded project exceeds reader limit"}]});
    assert.equal(decision,"assemblies");
    options.onOutput({extension:".zip",assemblies:1,importable:0,blocked:1,oversized:1});
    return new Blob(["preserved data"],{type:"application/zip"});
  };
  const run=host.start();await new Promise(resolve=>setTimeout(resolve,10));
  const panel=host.env.__layerlingImportSession.panel,choices=panel.children.find(e=>e.tag==="div");
  const single=choices.children.find(e=>e.textContent==="Keep one project");
  assert.equal(single.disabled,true);single.click();assert.equal(host.downloads.length,0);
  choices.children.find(e=>e.textContent==="Export smaller assemblies").click();await run;
  assert.match(controls(panel).status.textContent,/0 projects pass/);
  assert.match(controls(panel).status.textContent,/1 need attention and are NOT ready/);
});


test("saved-JSON fallback offers assembly output and names its download as a ZIP", async () => {
  const host=bookmarkEnvironment();
  vm.runInContext(bookmarkSource().replace(/void runLayerlingImport\(\);\s*$/,""),host.env);
  const create=host.env.document.createElement,objects={};
  for(const id of ["convert","status","source-file","project-name","download","export-mode"]) objects[id]=create(id==="download"?"a":"button");
  objects["project-name"].value="Saved JSON";objects["export-mode"].value="assemblies";
  objects["source-file"].files=[{text:async()=>JSON.stringify({shapes:[leaf("a")],meshes:{a:mesh(0)}})}];
  host.env.document.getElementById=id=>objects[id];
  const html=fs.readFileSync(__dirname+"/bookmarklet.html","utf8");
  const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('document.getElementById("convert").addEventListener'));
  vm.runInContext(script,host.env);
  await objects.convert.listeners.get("click")();
  assert.equal(host.downloads.length,1);assert.equal(host.downloads[0].filename,"Saved JSON.zip");
  assert.equal(host.downloads[0].blob.type,"application/zip");
  assert.match(objects.status.textContent,/1 projects pass reader-limit checks; 0 need attention/);
});
