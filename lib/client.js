window.__ModuleLoader__.load({id:"dsh-doyourweb",factory:(require)=>{
var module={exports:{}};var exports=module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client-entry.js
var client_entry_exports = {};
__export(client_entry_exports, {
  apply: () => apply2,
  inject: () => inject
});
module.exports = __toCommonJS(client_entry_exports);
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/output.js
function clip(value, limit) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  if (limit < 3) return ".".repeat(Math.max(0, limit));
  return `${text.slice(0, limit - 3)}...`;
}

// src/protocol.js
var PACKAGE = "dsh-doyourweb";
function formatMention(tab) {
  const title = clip(String(tab.title || "Browser tab").replace(/[\[\]\\\r\n]/g, " "), 128);
  return `@[${title}](${tab.ref})`;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var FIELD_KINDS = {
  string: { test: (value) => typeof value === "string", describe: "a string" },
  boolean: { test: (value) => typeof value === "boolean", describe: "a boolean" },
  array: { test: (value) => Array.isArray(value), describe: "an array" },
  object: { test: isPlainObject, describe: "a plain object" },
  number: { test: (value) => Number.isSafeInteger(value) && value >= 0, describe: "a nonnegative integer" }
};
function parseFields(value, fields, subject) {
  if (!isPlainObject(value)) throw new TypeError(`${subject} must be a plain object`);
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(fields, key)) throw new TypeError(`${subject} has an unexpected field ${JSON.stringify(key)}`);
  }
  const parsed = {};
  for (const [key, kind] of Object.entries(fields)) {
    const item = value[key];
    if (item === void 0) continue;
    if (!FIELD_KINDS[kind].test(item)) throw new TypeError(`${subject} field ${JSON.stringify(key)} must be ${FIELD_KINDS[kind].describe}`);
    parsed[key] = item;
  }
  return parsed;
}
function strictCodec(name, parse) {
  let schema;
  return {
    mode: "strict",
    typeSymbol: `${PACKAGE}#${name}`,
    create: () => schema ??= { parse }
  };
}
function request(name, fields) {
  return [{
    name: "request",
    wire: "request",
    source: "json",
    acceptsUndefined: true,
    codec: strictCodec(`${name}:request`, (value) => parseFields(value, fields, `${name} request`))
  }];
}
function result(name, fields) {
  return strictCodec(`${name}:result`, (value) => parseFields(value, fields, `${name} result`));
}
var invocations = [
  {
    method: "list",
    parameters: request("browserTabs/list", { query: "string" }),
    result: result("browserTabs/list", { tabs: "array", connected: "boolean" })
  },
  {
    method: "setup",
    parameters: request("browserTabs/setup", {}),
    result: result("browserTabs/setup", { url: "string", extensionPath: "string" })
  },
  {
    method: "focus",
    parameters: request("browserTabs/focus", { ref: "string" }),
    result: result("browserTabs/focus", { ok: "boolean" })
  },
  {
    method: "apps",
    parameters: request("browserTabs/apps", { query: "string" }),
    result: result("browserTabs/apps", { apps: "array", error: "string" })
  },
  {
    method: "annotationSession",
    parameters: request("browserTabs/annotationSession", { client: "string", revision: "number", sessionId: "string", title: "string", active: "boolean", acknowledgements: "array" }),
    result: result("browserTabs/annotationSession", { ok: "boolean", drafts: "array" })
  },
  {
    method: "manage",
    parameters: request("browserTabs/manage", {}),
    result: result("browserTabs/manage", { url: "string" })
  }
];
var descriptors = invocations.map(({ method, parameters, result: codec }) => ({
  id: `${PACKAGE}#browserTabs/${method}`,
  service: "browserTabs",
  namespace: "browserTabs",
  method,
  invocation: { kind: "direct" },
  parameters,
  cancellation: { parameter: "signal" },
  result: codec
}));
var remoteContribution = { package: PACKAGE, descriptors };

// src/reference-folders.js
var groups = { folder: { prefix: "\u6587\u4EF6\u5939:", label: "\u6587\u4EF6\u5939", icon: "folder", aliases: ["\u6587\u4EF6\u5939", "folder", "folders"] }, file: { prefix: "\u6587\u4EF6:", label: "\u6587\u4EF6", icon: "file", aliases: ["\u6587\u4EF6", "file", "files"] }, session: { prefix: "\u5BF9\u8BDD:", label: "\u5BF9\u8BDD", icon: "session", aliases: ["\u5BF9\u8BDD", "session", "sessions"] } };
var toggleKind = "doyourweb-reference-group";
function referenceQuery(query = "") {
  const normalized = query.toLowerCase();
  for (const [kind, group] of Object.entries(groups)) for (const alias of group.aliases) {
    if (normalized === alias) return { kind, query: "", ...group };
    if (normalized.startsWith(`${alias}:`) || normalized.startsWith(`${alias}\uFF1A`)) return { kind, query: query.slice(alias.length + 1), ...group };
  }
}
function valueOf(candidate) {
  try {
    return JSON.parse(candidate.value);
  } catch {
    return {};
  }
}
function kindOf(candidate) {
  const value = valueOf(candidate);
  return value.kind === "file" && value.fileKind === "directory" ? "folder" : value.kind;
}
function toggle(kind, expanded, section, count) {
  const group = groups[kind];
  return {
    name: expanded ? `\u6536\u8D77${group.label}` : count ? `\u5C55\u5F00${group.label}\uFF08${count}\uFF09` : `\u641C\u7D22${group.label}`,
    section,
    icon: group.icon,
    ...!expanded && !count ? { description: "\u6682\u65E0\u6587\u4EF6\u5019\u9009\uFF0C\u8F93\u5165\u540D\u79F0\u641C\u7D22\u6216\u8FDB\u5165\u6587\u4EF6\u5939" } : {},
    ...!expanded ? { drill: true } : {},
    value: JSON.stringify({ kind: toggleKind, text: expanded ? "@" : `@${group.prefix}` })
  };
}
function compactReferences(service, { preview = 3 } = {}) {
  if (!Array.isArray(service?.live?.sources)) return () => {
  };
  const originals = /* @__PURE__ */ new Map();
  function decorate(source) {
    if (source.trigger !== "@" || source.name !== "reference" || originals.has(source)) return;
    const original = { candidates: source.candidates, onPick: source.onPick, header: source.header, order: source.order };
    if (typeof original.candidates !== "function" || typeof original.onPick !== "function") return;
    const wrapped = {
      order: Math.min(source.order ?? 0, -100),
      async candidates(session, request2) {
        const category = !request2.quoted && referenceQuery(request2.query);
        const items = await original.candidates.call(source, session, category ? { ...request2, query: category.query } : request2);
        if (category) {
          const matches = items.filter((item) => kindOf(item) === category.kind);
          return [toggle(category.kind, true, groups[category.kind].label, matches.length), ...matches];
        }
        if (request2.query || request2.quoted || request2.drilled) return items;
        const sections = /* @__PURE__ */ new Map();
        for (const item of items) {
          const kind = kindOf(item), section = ["file", "folder"].includes(kind) ? groups[kind].label : item.section;
          const key = `${kind}:${section || ""}`;
          if (!sections.has(key)) sections.set(key, { kind, section, items: [] });
          sections.get(key).items.push(["file", "folder"].includes(kind) ? { ...item, section, ...kind === "folder" ? { drill: true } : {} } : item);
        }
        if (![...sections.values()].some((section) => section.kind === "file")) sections.set("file:\u6587\u4EF6", { kind: "file", section: "\u6587\u4EF6", items: [] });
        const order = { file: 0, folder: 1, session: 2 };
        return [...sections.values()].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3)).flatMap(({ kind, section, items: items2 }) => !groups[kind] ? items2 : [...items2.slice(0, preview), ...items2.length > preview || !items2.length ? [toggle(kind, false, section, items2.length)] : []]);
      },
      onPick(request2) {
        const value = valueOf(request2.candidate);
        return value.kind === toggleKind ? { text: value.text, continue: true } : original.onPick.call(source, request2);
      },
      header(session, request2) {
        const category = !request2.quoted && referenceQuery(request2.query);
        if (!category) return original.header?.call(source, session, request2);
        return [{ label: category.label, current: true, value: "" }];
      }
    };
    Object.assign(source, wrapped);
    originals.set(source, { original, wrapped });
  }
  service.live.sources.forEach(decorate);
  const descriptor = Object.getOwnPropertyDescriptor(service, "registerSource");
  const register = service.registerSource;
  const wrappedRegister = function(source) {
    decorate(source);
    return register.call(this, source);
  };
  Object.defineProperty(service, "registerSource", { configurable: true, writable: true, value: wrappedRegister });
  return () => {
    for (const [source, { original, wrapped }] of originals) for (const key of Object.keys(wrapped)) {
      if (source[key] !== wrapped[key]) continue;
      if (original[key] === void 0) delete source[key];
      else source[key] = original[key];
    }
    if (Object.getOwnPropertyDescriptor(service, "registerSource")?.value === wrappedRegister) {
      if (descriptor) Object.defineProperty(service, "registerSource", descriptor);
      else delete service.registerSource;
    }
    originals.clear();
  };
}

// src/client.js
var inject = ["inputTriggers", "remote"];
function apply(ctx, { browserIcon, tabIcon, appIcon = browserIcon, applicationIcon = () => appIcon }) {
  ctx.effect(() => ctx.remote.$mount(remoteContribution));
  ctx.effect(() => compactReferences(ctx.inputTriggers));
  function setupCandidate(description) {
    return {
      name: "browser",
      label: "\u6D4F\u89C8\u5668",
      description,
      value: "setup",
      icon: browserIcon,
      section: "\u6D4F\u89C8\u5668"
    };
  }
  function namespace() {
    const service = ctx.get ? ctx.get("remote.browserTabs") : ctx.remote?.browserTabs;
    if (!service) throw new Error("browser service is not registered by the DSH host");
    return service;
  }
  async function candidates({ query = "", signal }, slash = false) {
    const browserQuery = query && ["browser", "\u6D4F\u89C8\u5668"].includes(query.toLowerCase());
    const matchesSetup = !query || "browser \u6D4F\u89C8\u5668".includes(query.toLowerCase());
    let result2;
    try {
      result2 = await namespace().list({ query: browserQuery ? "" : query }, signal);
      if (!result2.ok) throw new Error(result2.error?.message || "Browser service is unavailable");
    } catch (error) {
      if (signal?.aborted) return [];
      return [setupCandidate(`\u670D\u52A1\u4E0D\u53EF\u7528: ${error.message}`)];
    }
    if (result2.value.connected === false) return [setupCandidate("\u672A\u8FDE\u63A5")];
    const tabs = result2.value.tabs.map((tab) => ({
      name: tab.title || tab.url,
      description: `${new URL(tab.url).protocol === "file:" ? "\u672C\u5730 HTML" : new URL(tab.url).hostname} - ${tab.browser}`,
      icon: tabIcon(tab),
      section: "\u6807\u7B7E\u9875",
      value: JSON.stringify({ ref: formatMention(tab), label: tab.title || tab.url })
    }));
    if (slash && matchesSetup) tabs.unshift(setupCandidate("\u8FDE\u63A5\u8BBE\u7F6E"));
    else if (!query && !tabs.length) tabs.push(setupCandidate("\u65E0\u53EF\u7528 HTTP/HTTPS \u6216\u672C\u5730 HTML \u6807\u7B7E\u9875"));
    return tabs;
  }
  function onPick({ candidate }) {
    if (["setup", "manage"].includes(candidate.value)) {
      let service;
      try {
        service = namespace();
      } catch (error) {
        console.error("dsh-doyourweb", error);
        return { text: "" };
      }
      void service[candidate.value]({}).then((result2) => {
        if (!result2.ok) throw new Error(result2.error?.message || "Browser setup is unavailable");
        window.open(result2.value.url, "_blank", "noopener");
      }).catch((error) => console.error("dsh-doyourweb", error));
      return { text: "" };
    }
    const value = JSON.parse(candidate.value);
    return { insert: {
      source: value.source || "browser-tabs",
      ref: value.ref,
      label: value.label,
      appearance: "file",
      clipboardText: value.ref
    } };
  }
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: "@",
    name: "browser-tabs",
    showGroupTitle: false,
    async candidates(_session, request2) {
      const { quoted, drilled } = request2;
      if (quoted || drilled || referenceQuery(request2.query)) return [];
      return candidates(request2);
    },
    onPick,
    openReference(_session, { ref }) {
      const match = ref.match(/dsh-browser:\/\/[a-z0-9-]+\/\d+/i);
      let service;
      if (!match) return false;
      try {
        service = namespace();
      } catch {
        return false;
      }
      void service.focus({ ref: match[0] }).catch((error) => console.error("dsh-doyourweb", error));
      return true;
    },
    codec: { clipboardText: (ref) => ref, serialize: async (ref) => ref }
  }));
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: "/",
    name: "browser-setup",
    showGroupTitle: false,
    candidates: (_session, request2) => candidates(request2, true),
    onPick
  }));
  for (const [method, source, section] of [["apps", "desktop-apps", "\u5E94\u7528\u7A0B\u5E8F"]]) {
    ctx.effect(() => ctx.inputTriggers.registerSource({
      trigger: "@",
      name: source,
      showGroupTitle: false,
      async candidates(_session, request2) {
        if (request2.quoted || request2.drilled || referenceQuery(request2.query)) return [];
        const query = request2.query || "";
        try {
          const result2 = await namespace()[method]({ query: ["\u5E94\u7528", "\u7A0B\u5E8F", "apps"].includes(query.toLowerCase()) ? "" : query }, request2.signal);
          if (!result2.ok || result2.value.error) return [];
          return result2.value[method].map((item) => {
            const appName = item.displayName || item.product || item.name;
            const label = item.comment || [appName, item.title].filter(Boolean).join(" \xB7 ");
            const ref = `@[${label.replace(/[\[\]\\\r\n]/g, " ").slice(0, 128)}](${item.ref})`;
            return {
              name: item.comment || appName,
              description: item.installed && !item.windowId ? `${item.title} \xB7 \u6309\u9700\u542F\u52A8` : item.title,
              section,
              icon: applicationIcon(item),
              value: JSON.stringify({ ref, label, source })
            };
          });
        } catch {
          return [];
        }
      },
      onPick,
      openReference() {
        void namespace().manage({}).then((result2) => {
          if (result2.ok) window.open(result2.value.url, "_blank", "noopener");
        }).catch(console.error);
        return true;
      },
      codec: { clipboardText: (ref) => ref, serialize: async (ref) => ref }
    }));
  }
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: "/",
    name: "doyourweb-manage",
    showGroupTitle: false,
    // DSH chains .then() directly; even local candidate lists must be async.
    candidates: async (_session, { query = "" }) => !query || "apps \u5E94\u7528 doyourweb".includes(query.toLowerCase()) ? [{ name: "apps", label: "\u5E94\u7528\u7BA1\u7406", description: "\u8FDE\u63A5\u5668\u4E0E\u5B89\u88C5\u786E\u8BA4", value: "manage", section: "DoYourWeb", icon: appIcon }] : [],
    onPick
  }));
}

// src/annotation-drafts.js
function appendAnnotationDraft(conversation, request2) {
  const shell = conversation?.input?.shell?.(request2.sessionId);
  if (!shell?.actions?.insertText) throw new Error("\u5F53\u524D DSH \u7248\u672C\u6CA1\u6709\u53EF\u7528\u7684\u804A\u5929\u8349\u7A3F\u63A5\u53E3");
  const state = shell.state.getSnapshot();
  if (["submitting", "adjudicating"].includes(state.phase)) return false;
  const text = request2.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  const files = request2.content.filter((item) => item.type === "image").map((item) => new File([
    Uint8Array.from(atob(item.data), (char) => char.charCodeAt(0))
  ], item.name || "\u9875\u9762\u6279\u6CE8.png", { type: item.mediaType }));
  const attachments = files.length ? conversation.createDrafts(request2.sessionId, files) : [];
  const ids = attachments.map((item) => item.id);
  try {
    if (ids.length && !shell.actions.addAttachments(ids)) return false;
    const end = shell.projection.detectText.length;
    if (!shell.actions.insertText(`${end ? "\n\n" : ""}${text}
`, { start: end, end, draftRev: state.draftRev })) {
      for (const id of ids) shell.actions.removeAttachment(id);
      return false;
    }
    shell.actions.persistDraft();
    return true;
  } finally {
    const retained = shell.state.getSnapshot().attachmentIds;
    for (const id of ids) if (!retained.includes(id)) conversation.releaseDraftAttachment(id);
  }
}

// src/client-entry.js
function TabIcon({ favicon, size = 14 }) {
  const [failed, setFailed] = (0, import_react.useState)(false);
  if (!favicon || failed) return (0, import_react.createElement)(import_dsh_client_ui_primitives.IconGlobeOutlineRegular, { size });
  return (0, import_react.createElement)("img", {
    src: favicon,
    width: size,
    height: size,
    alt: "",
    style: { display: "block", objectFit: "contain" },
    onError: () => setFailed(true)
  });
}
function AppIcon({ icon, size = 14 }) {
  const [failed, setFailed] = (0, import_react.useState)(false);
  if (icon && !failed) return (0, import_react.createElement)("img", {
    src: icon,
    width: size,
    height: size,
    alt: "",
    style: { display: "block", objectFit: "contain" },
    onError: () => setFailed(true)
  });
  return (0, import_react.createElement)(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true },
    (0, import_react.createElement)("rect", { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
    (0, import_react.createElement)("path", { d: "M8 21h8m-4-4v4" })
  );
}
function AnnotationSession({ sessionId, publish }) {
  (0, import_react.useEffect)(() => {
    const update = () => publish(sessionId, true);
    update();
    const timer = setInterval(update, 1e3);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      publish(sessionId, false);
    };
  }, [sessionId, publish]);
  return null;
}
function apply2(ctx) {
  apply(ctx, {
    browserIcon: import_dsh_client_ui_primitives.IconGlobeOutlineRegular,
    tabIcon: (tab) => (props) => (0, import_react.createElement)(TabIcon, { ...props, favicon: tab.favicon }),
    appIcon: AppIcon,
    applicationIcon: (app) => (props) => (0, import_react.createElement)(AppIcon, { ...props, icon: app.icon })
  });
  const client = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) { const r = Math.random() * 16 | 0; const v = ch === "x" ? r : (r & 3 | 8); return v.toString(16); });
  let revision = 0;
  const delivered = /* @__PURE__ */ new Map(), acknowledgements = /* @__PURE__ */ new Map(), busy = /* @__PURE__ */ new Set();
  ctx.inject?.(["slots", "sessions"], (scope) => {
    const publish = async (sessionId, active) => {
      if (active && busy.has(sessionId)) return;
      const summary = scope.sessions.list.getSnapshot().byId[sessionId];
      const service = ctx.get("remote.browserTabs");
      if (!service?.annotationSession) return;
      if (active) busy.add(sessionId);
      const ack = acknowledgements.get(sessionId) || [];
      try {
        const response = await service.annotationSession({
          client,
          revision: ++revision,
          sessionId,
          active,
          title: summary?.displayTitle || summary?.title || "\u5F53\u524D\u4F1A\u8BDD",
          acknowledgements: ack
        });
        if (!response.ok) throw new Error(response.error?.message || "\u6279\u6CE8\u540C\u6B65\u5931\u8D25");
        acknowledgements.set(sessionId, []);
        for (const draft of response.value.drafts || []) {
          const id = draft.requestId;
          if (!delivered.has(id)) {
            if (!appendAnnotationDraft(ctx.get("conversation"), draft)) continue;
            delivered.set(id, true);
            if (delivered.size > 500) delivered.delete(delivered.keys().next().value);
          }
          acknowledgements.get(sessionId).push({ id });
        }
      } catch (error) {
        console.warn("dsh-doyourweb annotation draft", error);
      } finally {
        if (active) busy.delete(sessionId);
      }
    };
    scope.slots.inject("conversation.input.overlay", () => scope.slots.register({
      name: "conversation.input.overlay",
      id: "doyourweb-annotation-session",
      inject: (sessionId) => ({ sessionId, publish })
    }, AnnotationSession));
  });
}

return module.exports;}});
