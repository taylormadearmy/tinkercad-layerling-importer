/* Shared browser download controls and the Tinkercad bookmark entry point. */
(function (root) {
  "use strict";
  const VERSION = "{{VERSION}}";
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
