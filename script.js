const LANG_MAP = {
  html: "html", htm: "html",
  css: "css", scss: "scss", less: "less",
  js: "javascript", jsx: "javascript", mjs: "javascript",
  ts: "typescript", tsx: "typescript",
  json: "json",
  py: "python",
  php: "php",
  java: "java",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", hpp: "cpp",
  cs: "csharp",
  go: "go",
  rb: "ruby",
  rs: "rust",
  md: "markdown",
  xml: "xml",
  sh: "shell",
  sql: "sql",
  yml: "yaml", yaml: "yaml",
};

const PRETTIER_PARSER_MAP = {
  html: "html",
  css: "css", scss: "scss", less: "less",
  javascript: "babel",
  typescript: "typescript",
  json: "json-stringify",
  markdown: "markdown",
};

const DEFAULT_SETTINGS = {
  fontSize: 14,
  fontFamily: "JetBrains Mono, Fira Code, ui-monospace, monospace",
  customFont: "",
  wordWrap: true,
  minimap: window.innerWidth > 900,
  autosave: true,
  autosaveDelay: 800,
  tabSize: 2,
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("urd-editor-settings") || "{}") };
  } catch (e) { return { ...DEFAULT_SETTINGS }; }
}
function saveSettingsToDisk(s) { localStorage.setItem("urd-editor-settings", JSON.stringify(s)); }

let settings = loadSettings();

const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlugin);
const SafPlugin = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SafStorage) || null;

/* ---- Real-folder storage via Storage Access Framework (native only) ---- */
const SafStorageAdapter = {
  ready: false,
  folderName: "",

  async init() {
    const plugin = SafPlugin();
    if (!plugin) return false;
    try {
      const res = await plugin.getSavedFolder();
      if (res && res.uri) { this.ready = true; this.folderName = res.name || ""; return true; }
    } catch (e) { /* no folder yet */ }
    return false;
  },
  async pickFolder() {
    const plugin = SafPlugin();
    if (!plugin) throw new Error("SAF plugin unavailable");
    const res = await plugin.pickFolder();
    this.ready = true;
    this.folderName = res.name || "";
    return res;
  },
  async list() {
    const res = await SafPlugin().listFiles();
    return res.files || [];
  },
  async read(path) {
    const res = await SafPlugin().readFile({ path });
    return res.data;
  },
  async write(path, content) {
    await SafPlugin().writeFile({ path, data: content });
  },
  async delete(path) {
    await SafPlugin().deleteFile({ path });
  },
  async fileUri() { return null; }, // SAF uris aren't directly browser-openable
};

/* ---- Fallback storage for plain browser testing (no device folder access) ---- */
const BrowserStorage = {
  key: "urd-editor-files",
  _all() { return JSON.parse(localStorage.getItem(this.key) || "{}"); },
  _save(obj) { localStorage.setItem(this.key, JSON.stringify(obj)); },
  async list() { return Object.keys(this._all()); },
  async read(name) { return this._all()[name] ?? ""; },
  async write(name, content) { const a = this._all(); a[name] = content; this._save(a); },
  async delete(name) { const a = this._all(); delete a[name]; this._save(a); },
  async fileUri() { return null; },
};

/* ---- Small internal scratch space, only used to render "Open in Browser" ---- */
const ScratchStorage = {
  dir: "URDEditorScratch",
  async ensureDir() {
    const { Filesystem, Directory } = window.Capacitor.Plugins;
    try { await Filesystem.mkdir({ path: this.dir, directory: Directory.Documents, recursive: true }); } catch (e) {}
  },
  async write(name, content) {
    const { Filesystem, Directory, Encoding } = window.Capacitor.Plugins;
    await this.ensureDir();
    await Filesystem.writeFile({ path: `${this.dir}/${name}`, directory: Directory.Documents, data: content, encoding: Encoding.UTF8 });
  },
  async fileUri(name) {
    const { Filesystem, Directory } = window.Capacitor.Plugins;
    const res = await Filesystem.getUri({ path: `${this.dir}/${name}`, directory: Directory.Documents });
    return res.uri;
  },
};

let Storage = BrowserStorage; // resolved properly in boot()

let editor = null;
let currentFile = null;
let dirtyTimer = null;

const $ = (id) => document.getElementById(id);

function langFromName(name) {
  const ext = name.split(".").pop().toLowerCase();
  return LANG_MAP[ext] || "plaintext";
}

function setStatus(msg) {
  $("status-msg").textContent = msg;
  if (msg) setTimeout(() => { if ($("status-msg").textContent === msg) $("status-msg").textContent = ""; }, 2500);
}

function effectiveFontFamily() {
  if (settings.fontFamily === "custom" && settings.customFont.trim()) {
    return `${settings.customFont.trim()}, ui-monospace, monospace`;
  }
  return settings.fontFamily;
}

require(["vs/editor/editor.main"], function () {
  editor = monaco.editor.create($("monaco-container"), {
    value: "",
    language: "plaintext",
    theme: "vs-dark",
    automaticLayout: true,
    fontFamily: effectiveFontFamily(),
    fontSize: settings.fontSize,
    minimap: { enabled: settings.minimap },
    wordWrap: settings.wordWrap ? "on" : "off",
    tabSize: settings.tabSize,
    scrollBeyondLastLine: false,
  });

  editor.onDidChangeModelContent(() => {
    if (!currentFile || !settings.autosave) return;
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => saveCurrentFile(true), settings.autosaveDelay);
  });

  initSettingsUI();
  boot();
});

async function boot() {
  if (isNative() && SafPlugin()) {
    const hasFolder = await SafStorageAdapter.init();
    Storage = SafStorageAdapter;
    if (hasFolder) { updateFolderLabel(); refreshFileList(); }
    else { showNoFolderState(); }
  } else {
    Storage = BrowserStorage;
    refreshFileList();
  }
}

function updateFolderLabel() {
  const label = SafStorageAdapter.folderName ? `📁 ${SafStorageAdapter.folderName}` : "FILES";
  document.querySelector(".sidebar-header span").textContent = label;
}

function showNoFolderState() {
  const list = $("file-list");
  list.innerHTML = "";
  const li = document.createElement("li");
  li.className = "folder-heading";
  li.style.cursor = "pointer";
  li.style.color = "var(--accent)";
  li.textContent = "📂 Tap here to select a folder";
  li.onclick = doPickFolder;
  list.appendChild(li);
  $("empty-state").querySelector("p").textContent = "Select a folder from device storage to start editing.";
}

async function doPickFolder() {
  try {
    await SafStorageAdapter.pickFolder();
    updateFolderLabel();
    await refreshFileList();
    setStatus("Folder connected");
  } catch (e) {
    setStatus("No folder selected");
  }
}

/* ---------------- File list / open / new / delete ---------------- */

async function refreshFileList() {
  const files = await Storage.list();
  const list = $("file-list");
  list.innerHTML = "";

  const groups = {};
  files.sort().forEach((path) => {
    const parts = path.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    (groups[folder] ||= []).push(path);
  });

  Object.keys(groups).sort().forEach((folder) => {
    if (folder) {
      const h = document.createElement("li");
      h.className = "folder-heading";
      h.textContent = "📁 " + folder;
      list.appendChild(h);
    }
    groups[folder].forEach((path) => {
      const li = document.createElement("li");
      li.className = path === currentFile ? "active" : "";
      const label = document.createElement("span");
      label.textContent = path.split("/").pop();
      li.appendChild(label);
      const del = document.createElement("span");
      del.className = "file-delete";
      del.textContent = "🗑";
      del.onclick = (e) => { e.stopPropagation(); deleteFile(path); };
      li.appendChild(del);
      li.onclick = () => openFile(path);
      list.appendChild(li);
    });
  });
}

async function openFile(path) {
  const content = await Storage.read(path);
  currentFile = path;
  $("empty-state").style.display = "none";
  $("active-filename").textContent = path;
  const lang = langFromName(path);
  $("status-lang").textContent = lang;
  const model = monaco.editor.createModel(content, lang);
  editor.setModel(model);
  refreshFileList();
}

async function newFile() {
  if (isNative() && SafPlugin() && !SafStorageAdapter.ready) { setStatus("Select a folder first"); return; }
  const name = prompt("File name (e.g. index.html, app.js, style.css):");
  if (!name) return;
  const files = await Storage.list();
  if (files.includes(name)) { setStatus(`"${name}" already exists`); return; }
  await Storage.write(name, "");
  await refreshFileList();
  openFile(name);
}

async function deleteFile(path) {
  if (!confirm(`Delete "${path}"? This can't be undone.`)) return;
  await Storage.delete(path);
  if (currentFile === path) {
    currentFile = null;
    $("active-filename").textContent = "no file open";
    $("empty-state").style.display = "flex";
    editor.setModel(monaco.editor.createModel("", "plaintext"));
  }
  refreshFileList();
  setStatus(`Deleted ${path}`);
}

async function saveCurrentFile(silent) {
  if (!currentFile || !editor) return;
  await Storage.write(currentFile, editor.getValue());
  if (!silent) setStatus(`Saved ${currentFile}`);
}

/* ---- Import: single files (browser fallback path) ---- */
$("btn-pick-files").addEventListener("click", () => $("hidden-file-input").click());
$("hidden-file-input").addEventListener("change", async (e) => {
  for (const file of e.target.files) {
    const text = await file.text();
    await Storage.write(file.name, text);
  }
  await refreshFileList();
  setStatus("Files imported");
  e.target.value = "";
});

/* ---- 📂 button: real folder access on native, folder-copy import in browser ---- */
$("btn-pick-folder").addEventListener("click", async () => {
  if (isNative() && SafPlugin()) {
    await doPickFolder();
  } else {
    $("hidden-folder-input").click();
  }
});
$("hidden-folder-input").addEventListener("change", async (e) => {
  let count = 0;
  for (const file of e.target.files) {
    const rel = file.webkitRelativePath || file.name;
    const parts = rel.split("/");
    const path = parts.length > 1 ? parts.slice(1).join("/") || parts[0] : parts[0];
    try {
      const text = await file.text();
      await Storage.write(path, text);
      count++;
    } catch (err) { /* skip unreadable/binary files */ }
  }
  await refreshFileList();
  setStatus(`Imported ${count} files from folder`);
  e.target.value = "";
});

/* ---------------- Prettier formatting ---------------- */

async function formatCurrentFile() {
  if (!editor || !currentFile) return;
  const lang = langFromName(currentFile);
  const parser = PRETTIER_PARSER_MAP[lang];
  if (!parser) { setStatus(`No formatter for .${currentFile.split(".").pop()}`); return; }
  try {
    const plugins = [
      window.prettierPlugins.html,
      window.prettierPlugins.postcss,
      window.prettierPlugins.babel,
      window.prettierPlugins.estree,
      window.prettierPlugins.typescript,
    ].filter(Boolean);
    const formatted = await prettier.format(editor.getValue(), { parser, plugins, tabWidth: settings.tabSize });
    editor.setValue(formatted);
    setStatus("Formatted");
  } catch (err) {
    setStatus("Format failed — check for syntax errors");
    console.error(err);
  }
}

/* ---------------- Live preview ---------------- */

async function buildPreviewHtml() {
  const files = await Storage.list();
  const contents = {};
  for (const name of files) contents[name] = await Storage.read(name);

  const htmlFile = currentFile && currentFile.endsWith(".html") ? currentFile
    : files.find((f) => f.endsWith(".html"));

  if (!htmlFile) {
    return `<pre style="font-family:monospace;padding:16px;white-space:pre-wrap;">${
      (contents[currentFile] || "").replace(/</g, "&lt;")
    }</pre>`;
  }

  let html = contents[htmlFile];
  html = html.replace(/<link[^>]+href=["']([^"':/]+\.css)["'][^>]*>/g, (m, href) => {
    return contents[href] ? `<style>${contents[href]}</style>` : m;
  });
  html = html.replace(/<script[^>]+src=["']([^"':/]+\.js)["'][^>]*><\/script>/g, (m, src) => {
    return contents[src] ? `<script>${contents[src]}<\/script>` : m;
  });
  return html;
}

async function showPreview() {
  await saveCurrentFile(true);
  const html = await buildPreviewHtml();
  $("preview-frame").srcdoc = html;
  $("preview-overlay").classList.remove("hidden");
  history.pushState({ urdPreview: true }, "");
}
function closePreview(fromPopstate) {
  $("preview-overlay").classList.add("hidden");
  if (!fromPopstate && history.state && history.state.urdPreview) history.back();
}
window.addEventListener("popstate", () => {
  if (!$("preview-overlay").classList.contains("hidden")) closePreview(true);
});
$("btn-close-preview").addEventListener("click", () => closePreview(false));

if (isNative() && window.Capacitor.Plugins.App) {
  window.Capacitor.Plugins.App.addListener("backButton", () => {
    if (!$("preview-overlay").classList.contains("hidden")) { closePreview(true); return; }
    if (!$("settings-overlay").classList.contains("hidden")) { $("settings-overlay").classList.add("hidden"); return; }
    window.Capacitor.Plugins.App.exitApp();
  });
}

async function openInSystemBrowser() {
  await saveCurrentFile(true);
  const html = await buildPreviewHtml();

  if (isNative() && window.Capacitor.Plugins.Browser && window.Capacitor.Plugins.Filesystem) {
    await ScratchStorage.write("__preview__.html", html);
    const uri = await ScratchStorage.fileUri("__preview__.html");
    await window.Capacitor.Plugins.Browser.open({ url: uri });
  } else {
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  }
}

/* ---------------- Settings panel ---------------- */

function initSettingsUI() {
  const knownFamilies = [
    "JetBrains Mono, Fira Code, ui-monospace, monospace",
    "Fira Code, ui-monospace, monospace",
    "Consolas, ui-monospace, monospace",
    "'Courier New', monospace",
  ];
  $("setting-font-size").value = settings.fontSize;
  $("setting-font-family").value = knownFamilies.includes(settings.fontFamily) ? settings.fontFamily : "custom";
  $("setting-custom-font").value = settings.customFont;
  $("custom-font-row").style.display = $("setting-font-family").value === "custom" ? "flex" : "none";
  $("setting-word-wrap").checked = settings.wordWrap;
  $("setting-minimap").checked = settings.minimap;
  $("setting-autosave").checked = settings.autosave;
  $("setting-autosave-delay").value = settings.autosaveDelay;
  $("autosave-delay-row").style.display = settings.autosave ? "flex" : "none";
  $("setting-tab-size").value = settings.tabSize;

  $("setting-font-family").addEventListener("change", (e) => {
    $("custom-font-row").style.display = e.target.value === "custom" ? "flex" : "none";
    applySettings();
  });
  $("setting-autosave").addEventListener("change", (e) => {
    $("autosave-delay-row").style.display = e.target.checked ? "flex" : "none";
    applySettings();
  });
  ["setting-font-size", "setting-custom-font", "setting-word-wrap", "setting-minimap", "setting-autosave-delay", "setting-tab-size"]
    .forEach((id) => $(id).addEventListener("input", applySettings));
}

function applySettings() {
  settings.fontSize = parseInt($("setting-font-size").value, 10) || DEFAULT_SETTINGS.fontSize;
  settings.fontFamily = $("setting-font-family").value;
  settings.customFont = $("setting-custom-font").value;
  settings.wordWrap = $("setting-word-wrap").checked;
  settings.minimap = $("setting-minimap").checked;
  settings.autosave = $("setting-autosave").checked;
  settings.autosaveDelay = parseInt($("setting-autosave-delay").value, 10) || DEFAULT_SETTINGS.autosaveDelay;
  settings.tabSize = parseInt($("setting-tab-size").value, 10) || DEFAULT_SETTINGS.tabSize;
  saveSettingsToDisk(settings);

  if (editor) {
    editor.updateOptions({
      fontSize: settings.fontSize,
      fontFamily: effectiveFontFamily(),
      wordWrap: settings.wordWrap ? "on" : "off",
      minimap: { enabled: settings.minimap },
      tabSize: settings.tabSize,
    });
  }
}

$("btn-settings").addEventListener("click", () => $("settings-overlay").classList.remove("hidden"));
$("btn-close-settings").addEventListener("click", () => $("settings-overlay").classList.add("hidden"));
$("settings-overlay").addEventListener("click", (e) => { if (e.target.id === "settings-overlay") $("settings-overlay").classList.add("hidden"); });

/* ---------------- Toolbar wiring ---------------- */

$("toggle-sidebar").addEventListener("click", () => $("sidebar").classList.toggle("collapsed"));
$("btn-new-file").addEventListener("click", newFile);
$("btn-format").addEventListener("click", formatCurrentFile);
$("btn-save").addEventListener("click", () => saveCurrentFile(false));
$("btn-preview").addEventListener("click", showPreview);
$("btn-open-browser").addEventListener("click", openInSystemBrowser);

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveCurrentFile(false); }
  if (e.key === "Escape") { closePreview(false); $("settings-overlay").classList.add("hidden"); }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}