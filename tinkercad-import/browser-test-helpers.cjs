const fs = require("node:fs");
const vm = require("node:vm");

function bookmarkURL() {
  const html = fs.readFileSync(__dirname + "/bookmarklet.html", "utf8");
  const objects = { mark: {}, copy: { addEventListener() {} } };
  for (const id of ["converter", "exporter", "importer"]) {
    objects[id] = {
      textContent: html.match(
        new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`),
      )[1],
    };
  }
  objects["bookmark-source"] = {
    textContent: html.match(/<script id="bookmark-source" type="application\/json">([\s\S]*?)<\/script>/)?.[1],
  };
  const scripts = [
    ...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
  ];
  vm.runInNewContext(scripts.at(-1)[1], {
    document: { getElementById: (id) => objects[id] },
    navigator: { clipboard: { writeText: async () => {} } },
    encodeURIComponent,
  });
  return objects.mark.href;
}

function bookmarkSource() {
  return decodeURIComponent(bookmarkURL().slice("javascript:".length));
}

function bookmarkEnvironment({scope = "all", partial = "stop"} = {}) {
  const urls = new Map(),
    downloads = [],
    listeners = new Map(),
    errors = [];
  let captureCalls = 0,
    nextURL = 0;
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.listeners = new Map();
      this.style = {};
      this.hidden = false;
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    removeAttribute(name) {
      delete this[name];
    }
    append(...items) {
      for (const item of items) {
        item.parent = this;
        this.children.push(item);
      }
      // Existing error-path tests act as a user choosing the default Stop.
      if (partial === "stop") {
        const stop = items.find(e=>e.textContent === "Stop export");
        if (stop) queueMicrotask(()=>stop.click());
      }
    }
    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter((x) => x !== this);
    }
    addEventListener(name, fn) {
      this.listeners.set(name, fn);
    }
    removeEventListener(name, fn) {
      if (this.listeners.get(name) === fn) this.listeners.delete(name);
    }
    focus() {
      this.focused = true;
    }
    click() {
      if (this.disabled) return;
      if (this.tag === "a" && this.href)
        downloads.push({
          filename: this.download,
          blob: urls.get(this.href),
          url: this.href,
        });
      this.listeners.get("click")?.();
    }
  }
  const shape = {
    versions_id: "single-part",
    dataType: "preset",
    params: { id: "triangle" },
    tags: { label: "Sample" },
  };
  const position = {
    count: 3,
    getX: (i) => [0, 2, 0][i],
    getY: (i) => [0, 0, 3][i],
    getZ: (i) => [0, 0, 4][i],
  };
  const geometry = {
    attributes: { position },
    clone() {
      return {
        attributes: this.attributes,
        applyMatrix4() {
          return this;
        },
        dispose() {},
      };
    },
  };
  const scene = {
    versions_id: "single-part",
    geometry: { get: () => geometry },
    computeWorldMatrix: () => ({ determinant: () => 1 }),
  };
  const env = {
    Blob,
    CompressionStream,
    AbortController,
    TextEncoder,
    DataView,
    Uint8Array,
    Uint32Array,
    crypto: require("node:crypto").webcrypto,
    setTimeout,
    clearTimeout,
    console: { error: (...args) => errors.push(args) },
    alert: (message) => errors.push(message),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    llm: {
      tools: {
        get_design_data: {
          run: async () => {
            captureCalls++;
            return { shapes: [shape] };
          },
        },
      },
    },
    testKit: { sceneModel: { children: new Map([["single-part", scene]]) } },
    document: {
      title: "3D design Sample - arm - Tinkercad",
      body: new Element("body"),
      createElement: (tag) => new Element(tag),
    },
    URL: {
      createObjectURL(blob) {
        const id = "blob:test-" + ++nextURL;
        urls.set(id, blob);
        return id;
      },
      revokeObjectURL: (id) => urls.delete(id),
    },
    location: {
      hostname: "www.tinkercad.com",
      pathname: "/things/test-design/edit",
      reload() {},
    },
  };
  env.window = env;
  const context = vm.createContext(env),
    source = bookmarkSource();
  return {
    env,
    urls,
    downloads,
    errors,
    scene,
    shape,
    get captureCalls() {
      return captureCalls;
    },
    chooseScope(value = scope) {
      if (value === null) return;
      const label = value === "selection" ? "Export selected parts" : "Export whole design";
      const find = element => element.textContent === label ? element : element.children?.map(find).find(Boolean);
      find(env.__layerlingImportSession?.panel || {})?.click();
    },
    start() {
      const pending = env.runLayerlingImport();
      this.chooseScope();
      return pending;
    },
    invoke() {
      vm.runInContext(source, context);
      this.chooseScope();
      return env.__layerlingImportSession?.promise;
    },
  };
}

module.exports = { bookmarkSource, bookmarkURL, bookmarkEnvironment };
