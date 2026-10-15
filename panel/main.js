"use strict";
(() => {
  // node_modules/@openchamber/sdk/dist/api-version.js
  var OPENCHAMBER_SDK_CHANNEL = "openchamber.sdk";
  var OPENCHAMBER_SDK_API_VERSION = 1;

  // node_modules/@openchamber/sdk/dist/scrollbar-style.js
  var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
  var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
  function installGuestScrollbarActivity(doc) {
    const root2 = doc.documentElement;
    if (root2.hasAttribute("data-oc-scrollbar-activity"))
      return;
    root2.setAttribute("data-oc-scrollbar-activity", "");
    const timers = /* @__PURE__ */ new WeakMap();
    doc.addEventListener("scroll", (event) => {
      const target = event.target === doc ? root2 : event.target;
      if (!(target instanceof Element))
        return;
      if (!target.hasAttribute("data-oc-scrolling"))
        target.setAttribute("data-oc-scrolling", "");
      const pending = timers.get(target);
      if (pending !== void 0)
        clearTimeout(pending);
      timers.set(target, setTimeout(() => {
        timers.delete(target);
        target.removeAttribute("data-oc-scrolling");
      }, 1e3));
    }, { capture: true, passive: true });
  }
  var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;

  // node_modules/@openchamber/sdk/dist/workspace.js
  var GUEST_STORAGE_KEY_MAX = 128;
  var GUEST_STORAGE_VALUE_BYTES = 65536;

  // node_modules/@openchamber/sdk/dist/shells.js
  var GUEST_SHELL_ID_MAX = 128;
  var GUEST_SHELL_OUTPUT_TAIL_MAX = 65536;

  // node_modules/@openchamber/sdk/dist/status-controls.js
  var GUEST_STATUS_CONTROLS_MAX = 4;
  var GUEST_STATUS_CONTROL_ID = /^[a-z][a-z0-9-]{0,39}$/;
  var GUEST_STATUS_CONTROL_LABEL_MAX = 60;
  var GUEST_STATUS_CONTROL_OPTIONS_MAX = 16;
  var GUEST_STATUS_CONTROL_VALUE_MAX = 80;
  var isControlObject = (value) => Object(value) === value && !Array.isArray(value);
  var hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
  var isLabel = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_LABEL_MAX;
  var isValue = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_VALUE_MAX;
  var isGuestStatusControls = (controls) => {
    if (!Array.isArray(controls) || controls.length > GUEST_STATUS_CONTROLS_MAX)
      return false;
    const ids = /* @__PURE__ */ new Set();
    for (const control of controls) {
      if (!isControlObject(control) || !GUEST_STATUS_CONTROL_ID.test(control.id) || !isLabel(control.label))
        return false;
      if (control.disabled !== void 0 && control.disabled !== true && control.disabled !== false)
        return false;
      if (ids.has(control.id))
        return false;
      ids.add(control.id);
      if (control.kind === "button") {
        if (!hasOnlyKeys(control, ["kind", "id", "label", "disabled"]))
          return false;
        continue;
      }
      if (control.kind !== "select" || !hasOnlyKeys(control, ["kind", "id", "label", "value", "options", "disabled"]))
        return false;
      if (!isValue(control.value) || !Array.isArray(control.options) || control.options.length < 1 || control.options.length > GUEST_STATUS_CONTROL_OPTIONS_MAX)
        return false;
      const values = /* @__PURE__ */ new Set();
      for (const option of control.options) {
        if (!isControlObject(option) || !hasOnlyKeys(option, ["value", "label"]) || !isValue(option.value) || !isLabel(option.label) || values.has(option.value))
          return false;
        values.add(option.value);
      }
      if (!values.has(control.value))
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/file-editor.js
  var GUEST_FILE_EDITOR_CONTENT_MAX = 2e7;
  var GUEST_FILE_EDITOR_VERSION_MAX = 256;
  var fileEditorPayloadSize = (value) => "bytes" in value ? value.bytes.byteLength : value.content.length;
  var sameFileEditorDocument = (left, right) => {
    if (left.path !== right.path || left.readOnly !== right.readOnly)
      return false;
    if (left.encoding === "text" || right.encoding === "text") {
      return left.encoding === "text" && right.encoding === "text" && left.content === right.content;
    }
    if (left.bytes.byteLength !== right.bytes.byteLength)
      return false;
    for (let index = 0; index < left.bytes.byteLength; index += 1) {
      if (left.bytes[index] !== right.bytes[index])
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/popover.js
  var GUEST_POPOVER_ID = /^[A-Za-z0-9_-]{1,80}$/;
  var GUEST_POPOVER_COORDINATE_MAX = 1e5;
  var GUEST_POPOVER_WIDTH_MIN = 160;
  var GUEST_POPOVER_WIDTH_MAX = 640;
  var GUEST_POPOVER_HEIGHT_MIN = 48;
  var GUEST_POPOVER_HEIGHT_MAX = 480;
  var GUEST_POPOVER_DATA_MAX = 16e3;
  var GUEST_POPOVER_DATA_DEPTH_MAX = 32;
  var GUEST_POPOVER_SIDES = ["left", "right", "top", "bottom"];
  var hasBoundedJsonTree = (value, depth = 0, budget = { remaining: GUEST_POPOVER_DATA_MAX }) => {
    if (--budget.remaining < 0 || depth >= GUEST_POPOVER_DATA_DEPTH_MAX)
      return false;
    if (value === null)
      return true;
    const children = Array.isArray(value) ? value : Object(value) === value ? Object.values(value) : [];
    for (const item of children) {
      if (!hasBoundedJsonTree(item, depth + 1, budget))
        return false;
    }
    return true;
  };
  var isFiniteJson = (value) => {
    if (value === null || value === true || value === false)
      return true;
    if (Array.isArray(value))
      return Object.keys(value).every((key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length) && value.every(isFiniteJson);
    if (Object(value) === value) {
      const prototype = Object.getPrototypeOf(value);
      return (prototype === null || prototype === Object.prototype) && Object.values(value).every(isFiniteJson);
    }
    return String(value) === value || Number.isFinite(value);
  };
  var isGuestPopoverRequest = (request) => {
    try {
      if (String(request.id) !== request.id || !GUEST_POPOVER_ID.test(request.id) || !Number.isFinite(request.anchor.x) || Math.abs(request.anchor.x) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.y) || Math.abs(request.anchor.y) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.width) || !Number.isFinite(request.anchor.height) || request.anchor.width <= 0 || request.anchor.height <= 0 || request.anchor.width > GUEST_POPOVER_COORDINATE_MAX || request.anchor.height > GUEST_POPOVER_COORDINATE_MAX || !Number.isInteger(request.width) || request.width < GUEST_POPOVER_WIDTH_MIN || request.width > GUEST_POPOVER_WIDTH_MAX || !Number.isInteger(request.height) || request.height < GUEST_POPOVER_HEIGHT_MIN || request.height > GUEST_POPOVER_HEIGHT_MAX || request.side !== void 0 && !GUEST_POPOVER_SIDES.includes(request.side) || request.focus !== void 0 && request.focus !== true && request.focus !== false || !hasBoundedJsonTree(request.data) || !isFiniteJson(request.data))
        return false;
      return JSON.stringify(request.data).length <= GUEST_POPOVER_DATA_MAX;
    } catch {
      return false;
    }
  };

  // node_modules/@openchamber/sdk/dist/contract.js
  var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
  var isStartSessionResult = (value) => Boolean(value && "sessionId" in value);
  var isPromptResult = (value) => Boolean(value && "sent" in value && !("sessionId" in value));
  var GUEST_COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
  var isGuestCommitSha = (value) => GUEST_COMMIT_SHA.test(value);
  var GUEST_TOAST_MAX = 500;
  var GUEST_CLIPBOARD_TEXT_MAX = 32e3;
  var GUEST_COMPOSE_TEXT_MAX = 16e3;
  var GUEST_ATTACH_ID_MAX = 128;
  var GUEST_ATTACH_TITLE_MAX = 200;
  var GUEST_ATTACH_URL_MAX = 2e3;
  var GUEST_ATTACH_TEXT_MAX = 16e3;
  var GUEST_ATTACH_AUTHOR_MAX = 80;
  var GUEST_ATTACH_BRANCH_MAX = 200;
  var GUEST_ATTACH_DATA_MAX = 16e3;
  var GUEST_REQUEST_PATH_MAX = 2e3;
  var GUEST_REQUEST_TIMEOUT_MS = 2e4;
  var GUEST_FILE_PATH_MAX = 1024;
  var GUEST_FILE_CONTENT_MAX = 2e6;
  var GUEST_GENERATE_PROMPT_MAX = 64e3;
  var GUEST_GENERATE_SYSTEM_MAX = 8e3;
  var GUEST_GENERATE_OUTPUT_TOKENS_MAX = 4e3;
  var GUEST_GENERATE_TIMEOUT_MS = 9e4;
  var GUEST_BADGE_MAX = 999;
  var GUEST_FRAME_HEIGHT_MAX = 1e4;
  var GUEST_RESOLVE_ERROR_MAX = 500;
  var HOST_REQUEST_ERROR_CODES = [
    "HOST_UNAVAILABLE",
    "HOST_TIMEOUT",
    "HOST_REJECTED",
    "DISCONNECTED",
    "DISABLED",
    "BAD_PATH",
    "NO_INTEGRATION",
    "NO_SERVICE",
    "SERVICE_FAILED",
    "REQUEST_FAILED",
    "RESPONSE_TOO_LARGE",
    "NO_SESSION",
    "SESSION_BUSY",
    "NOT_GRANTED",
    "NO_DIRECTORY",
    "NOT_FOUND",
    "FILE_TOO_LARGE",
    "DENIED",
    "NO_MODEL",
    "MODEL_FAILED",
    "UNSUPPORTED"
  ];
  var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
  var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
  var isHostRequestErrorCode = (value) => hostRequestErrorCodeSet.has(value);
  var resolveHostRequestErrorCode = (value) => value && isHostRequestErrorCode(value) ? value : "HOST_REJECTED";
  var isJsonValue = (value) => {
    if (value === void 0)
      return false;
    if (value === null || value === true || value === false)
      return true;
    if (String(value) === value)
      return true;
    if (Number(value) === value)
      return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every(isJsonValue);
    if (Object(value) === value)
      return Object.values(value).every(isJsonValue);
    return false;
  };
  var isAttachData = (value) => isJsonValue(value) && JSON.stringify(value).length <= GUEST_ATTACH_DATA_MAX;
  var clampBranch = (value) => value?.trim().slice(0, GUEST_ATTACH_BRANCH_MAX) ?? "";
  var clampAttachRequest = (request) => {
    const id = request.id.trim().slice(0, GUEST_ATTACH_ID_MAX);
    const title = request.title.trim().slice(0, GUEST_ATTACH_TITLE_MAX);
    const url = request.url.trim().slice(0, GUEST_ATTACH_URL_MAX);
    const text2 = request.text?.trim().slice(0, GUEST_ATTACH_TEXT_MAX);
    const author = request.author?.trim().slice(0, GUEST_ATTACH_AUTHOR_MAX);
    const kind = request.kind === "pull" ? "pull" : "issue";
    const next = {
      providerId: request.providerId.trim(),
      id,
      title: title || id,
      url,
      kind
    };
    if (text2) {
      next.text = text2;
    }
    if (author) {
      next.author = author;
    }
    if (kind === "pull") {
      const head = clampBranch(request.branches?.head);
      const base = clampBranch(request.branches?.base);
      if (head && base) {
        next.branches = { head, base };
      }
    }
    if (isAttachData(request.data)) {
      next.data = request.data;
    }
    return next;
  };
  var clampStartSessionRequest = (request) => {
    const next = clampAttachRequest(request);
    if (request.projectId)
      next.projectId = request.projectId;
    if (request.navigation)
      next.navigation = request.navigation;
    if (request.worktree) {
      next.worktree = request.worktree;
    }
    return next;
  };
  var clampPromptRequest = (request) => {
    const next = {
      text: request.text.trim().slice(0, GUEST_COMPOSE_TEXT_MAX)
    };
    if (request.send) {
      next.send = true;
    }
    return next;
  };
  var clampBadgeCount = (count) => {
    if (count === null || !Number.isFinite(count))
      return null;
    return Math.min(GUEST_BADGE_MAX, Math.max(0, Math.round(count)));
  };
  var clampFrameHeight = (height) => {
    if (!Number.isFinite(height))
      return 0;
    return Math.min(GUEST_FRAME_HEIGHT_MAX, Math.max(0, Math.ceil(height)));
  };
  var isGuestFilePath = (value) => value.length > 0 && value.length <= GUEST_FILE_PATH_MAX && !value.includes("\0") && !value.includes("\\");
  var isGuestRequestPath = (value) => {
    if (!value.startsWith("/") || value.includes("\0") || value.includes("\\") || value.includes("://")) {
      return false;
    }
    if (value.length > GUEST_REQUEST_PATH_MAX) {
      return false;
    }
    const segments = value.split("/");
    return !segments.some((segment) => segment === "." || segment === "..");
  };
  var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
  var isServiceStatusResult = (value) => Boolean(value && "status" in value && serviceStatusSet.has(String(value.status)) && !("body" in value));
  var isGuestRequestResult = (value) => Boolean(value && "status" in value && "body" in value && Number.isInteger(value.status));
  var isFileReadResult = (value) => Boolean(value && "content" in value && String(value.content) === value.content);
  var isFileWriteResult = (value) => Boolean(value && "written" in value && value.written === true);
  var isFileListResult = (value) => Boolean(value && "entries" in value && Array.isArray(value.entries));
  var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
  var isFileStatResult = (value) => Boolean(value && "kind" in value && "size" in value && fileStatKindSet.has(String(value.kind)) && Number.isFinite(value.size));
  var isGenerateResult = (value) => Boolean(value && "text" in value && String(value.text) === value.text && !("status" in value));
  var HOST_PUSH_TYPES = /* @__PURE__ */ new Set([
    "workspace",
    "shells",
    "ready",
    "directory",
    "session",
    "connection",
    "settings",
    "session-lifecycle",
    "item",
    "resolve",
    "action",
    "status-control-event",
    "popover-closed",
    "file-open",
    "file-snapshot",
    "file-saved"
  ]);
  var asWireRecord = (data) => Object(data) === data ? data : null;
  var isNonEmptyString = (value) => String(value) === value && value.length > 0;
  var readResultMessage = (wire) => {
    if (!isNonEmptyString(wire.id))
      return null;
    if (wire.ok === true) {
      const message = {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: true
      };
      if (Object(wire.payload) === wire.payload) {
        message.payload = wire.payload;
      }
      return message;
    }
    if (wire.ok === false && isNonEmptyString(wire.error)) {
      return {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: false,
        error: wire.error,
        code: resolveHostRequestErrorCode(isNonEmptyString(wire.code) ? wire.code : void 0)
      };
    }
    return null;
  };
  var readHostMessage = (data) => {
    const wire = asWireRecord(data);
    if (!wire || wire.channel !== OPENCHAMBER_SDK_CHANNEL || wire.v !== OPENCHAMBER_SDK_API_VERSION)
      return null;
    if (wire.type === "result")
      return readResultMessage(wire);
    if (!HOST_PUSH_TYPES.has(String(wire.type)) || Object(wire.payload) !== wire.payload)
      return null;
    return wire;
  };

  // node_modules/@openchamber/sdk/dist/host.js
  var isKeyEvent = (event) => "key" in event && "metaKey" in event && "ctrlKey" in event;
  var isSaveShortcut = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
  var HostRequestError = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "HostRequestError";
      this.code = code;
    }
  };
  var rejectBadPath = () => Promise.reject(new HostRequestError("BAD_PATH", 'Request path must start with "/" and stay on the declared origin.'));
  var rejectBadFilePath = () => Promise.reject(new HostRequestError("BAD_PATH", `File path must be 1 to ${GUEST_FILE_PATH_MAX} characters without NUL or backslash.`));
  var deviceStorageScope = (options) => {
    if (options === void 0)
      return void 0;
    if (Object(options) !== options || Array.isArray(options) || options.scope !== void 0 && options.scope !== "instance" && options.scope !== "device") {
      throw new HostRequestError("HOST_REJECTED", 'Storage scope must be "instance" or "device".');
    }
    return options.scope === "device" ? "device" : void 0;
  };
  var nextId = (n2) => {
    n2.value += 1;
    return `oc-${n2.value}`;
  };
  var connectHost = (options = {}) => {
    const target = options.target ?? ("window" in globalThis ? window : null);
    if (!target) {
      throw new HostRequestError("HOST_UNAVAILABLE", "No window. connectHost runs in a browser frame.");
    }
    const acceptSource = options.acceptSource ?? ((source) => source === target.parent);
    const requestTimeoutMs = options.requestTimeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
    const readyListeners = /* @__PURE__ */ new Set();
    const directoryListeners = /* @__PURE__ */ new Set();
    const sessionListeners = /* @__PURE__ */ new Set();
    const lifecycleListeners = /* @__PURE__ */ new Set();
    const connectionListeners = /* @__PURE__ */ new Set();
    const settingsListeners = /* @__PURE__ */ new Set();
    const itemListeners = /* @__PURE__ */ new Set();
    const statusControlListeners = /* @__PURE__ */ new Set();
    const popoverClosedListeners = /* @__PURE__ */ new Set();
    let resolveHandler = null;
    let actionHandler = null;
    const fileOpenListeners = /* @__PURE__ */ new Set();
    const fileSavedListeners = /* @__PURE__ */ new Set();
    let fileSnapshotHandler = null;
    let lastFile = null;
    let saveShortcutInstalled = false;
    const pending = /* @__PURE__ */ new Map();
    const workspaceListeners = /* @__PURE__ */ new Map();
    const shellsListeners = /* @__PURE__ */ new Map();
    let disposed = false;
    const ids = { value: 0 };
    let lastReady = null;
    let lastLifecycle = null;
    let popoverPointerActive = false;
    let popoverFocusActive = false;
    let popoverActivityReported = null;
    const lifecycleFromSession = (session) => {
      if (!session)
        return null;
      return {
        sessionId: session.id,
        phase: session.busy ? "started" : "completed"
      };
    };
    const post = (message) => {
      target.parent.postMessage(message, "*");
    };
    const emit = (listeners, value) => {
      for (const listener of listeners) {
        try {
          listener(value);
        } catch (error) {
          console.error(error);
        }
      }
    };
    const onMessage = (event) => {
      if (!(event instanceof MessageEvent))
        return;
      if (!acceptSource(event.source))
        return;
      const message = readHostMessage(event.data);
      if (!message)
        return;
      if (message.type === "workspace") {
        const listener = workspaceListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "shells") {
        const listener = shellsListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "ready") {
        lastReady = message.payload;
        lastLifecycle = lifecycleFromSession(message.payload.session);
        emit(readyListeners, message.payload);
        emit(directoryListeners, message.payload.directory);
        emit(sessionListeners, message.payload.session);
        if (lastLifecycle) {
          emit(lifecycleListeners, lastLifecycle);
        }
        emit(connectionListeners, message.payload.connection);
        emit(settingsListeners, message.payload.settings);
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "directory") {
        if (lastReady) {
          lastReady = { ...lastReady, directory: message.payload.directory };
        }
        emit(directoryListeners, message.payload.directory);
        return;
      }
      if (message.type === "session") {
        if (lastReady) {
          lastReady = { ...lastReady, session: message.payload.session };
        }
        if (!message.payload.session) {
          lastLifecycle = null;
        } else if (lastLifecycle?.sessionId !== message.payload.session.id) {
          lastLifecycle = lifecycleFromSession(message.payload.session);
        }
        emit(sessionListeners, message.payload.session);
        return;
      }
      if (message.type === "session-lifecycle") {
        lastLifecycle = message.payload;
        emit(lifecycleListeners, message.payload);
        return;
      }
      if (message.type === "connection") {
        if (lastReady) {
          lastReady = { ...lastReady, connection: message.payload.connection };
        }
        emit(connectionListeners, message.payload.connection);
        return;
      }
      if (message.type === "settings") {
        if (lastReady) {
          lastReady = { ...lastReady, settings: message.payload.settings };
        }
        emit(settingsListeners, message.payload.settings);
        return;
      }
      if (message.type === "item") {
        if (lastReady) {
          lastReady = { ...lastReady, item: message.payload.item };
        }
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "status-control-event") {
        emit(statusControlListeners, message.payload);
        return;
      }
      if (message.type === "popover-closed") {
        emit(popoverClosedListeners, message.payload);
        return;
      }
      if (message.type === "action") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "action-result",
              id: message.id,
              payload
            });
        };
        const handler = actionHandler;
        if (!handler) {
          answer({ ok: false, error: "This extension does not handle background actions." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then(() => answer({ ok: true }), (error) => {
          const text2 = (error instanceof Error ? error.message : String(error)).trim();
          answer({ ok: false, error: (text2 || "Action failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      if (message.type === "file-open") {
        const next = message.payload;
        if (lastFile && sameFileEditorDocument(lastFile, next))
          return;
        lastFile = next;
        emit(fileOpenListeners, message.payload);
        return;
      }
      if (message.type === "file-saved") {
        emit(fileSavedListeners, message.payload.version);
        return;
      }
      if (message.type === "file-snapshot") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "file-snapshot-result",
              id: message.id,
              payload
            });
        };
        const fail = (text2) => answer({ error: (text2.trim() || "Could not read the edited file.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        const handler = fileSnapshotHandler;
        if (!handler) {
          fail("This extension does not edit files.");
          return;
        }
        Promise.resolve().then(() => handler(message.payload.purpose)).then((snapshot) => {
          if (fileEditorPayloadSize(snapshot) > GUEST_FILE_EDITOR_CONTENT_MAX) {
            fail(`The file is over ${GUEST_FILE_EDITOR_CONTENT_MAX} ${"bytes" in snapshot ? "bytes" : "characters"}.`);
            return;
          }
          if (snapshot.version.length > GUEST_FILE_EDITOR_VERSION_MAX) {
            fail(`The snapshot version is over ${GUEST_FILE_EDITOR_VERSION_MAX} characters.`);
            return;
          }
          answer({ snapshot: "bytes" in snapshot ? { bytes: snapshot.bytes, version: snapshot.version } : { content: snapshot.content, version: snapshot.version } });
        }, (error) => fail(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (message.type === "resolve") {
        const answer = (payload) => {
          post({
            channel: OPENCHAMBER_SDK_CHANNEL,
            v: OPENCHAMBER_SDK_API_VERSION,
            type: "resolve-result",
            id: message.id,
            payload
          });
        };
        const handler = resolveHandler;
        if (!handler) {
          answer({ error: "This extension does not resolve commands." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then((item) => answer({ item: item ? clampAttachRequest(item) : null }), (error) => {
          const text2 = (error instanceof Error ? error.message : String(error)).trim();
          answer({ error: (text2 || "Command failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter)
        return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.payload);
        return;
      }
      waiter.reject(new HostRequestError(message.code, message.error));
    };
    target.addEventListener("message", onMessage);
    post({
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: "hello"
    });
    const send = (message, timeoutMs = requestTimeoutMs) => {
      if (disposed || target.parent === target) {
        return Promise.reject(new HostRequestError("HOST_UNAVAILABLE", "No host frame. This page is not in an iframe."));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new HostRequestError("HOST_TIMEOUT", "Host did not answer in time."));
        }, timeoutMs);
        pending.set(message.id, { resolve, reject, timer });
        post(message);
      });
    };
    const request = (message) => send(message).then(() => void 0);
    const envelope = { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION };
    const notify = (message) => {
      if (!disposed && target.parent !== target)
        post(message);
    };
    const requestFileSave = () => notify({ ...envelope, type: "file-save" });
    const onSaveShortcut = (event) => {
      if (!isKeyEvent(event) || !isSaveShortcut(event))
        return;
      event.preventDefault();
      requestFileSave();
    };
    const onPopoverEscape = (event) => {
      if (!isKeyEvent(event) || event.key !== "Escape" || lastReady?.surface !== "popover" || !lastReady.popover)
        return;
      event.preventDefault();
      void closePopover(lastReady.popover.id, "escape").catch(() => void 0);
    };
    const reportPopoverActivity = () => {
      const popover = lastReady?.surface === "popover" ? lastReady.popover : void 0;
      if (!popover)
        return;
      const active2 = popoverPointerActive || popoverFocusActive;
      if (popoverActivityReported === active2)
        return;
      popoverActivityReported = active2;
      void setPopoverAnchorActive(popover.id, active2).catch(() => void 0);
    };
    const onPopoverPointerOver = () => {
      if (lastReady?.surface !== "popover" || popoverPointerActive)
        return;
      popoverPointerActive = true;
      reportPopoverActivity();
    };
    const onPopoverPointerOut = (event) => {
      if (lastReady?.surface !== "popover" || event.relatedTarget !== null || !popoverPointerActive)
        return;
      popoverPointerActive = false;
      reportPopoverActivity();
    };
    const onPopoverFocus = () => {
      if (lastReady?.surface !== "popover" || popoverFocusActive)
        return;
      popoverFocusActive = true;
      reportPopoverActivity();
    };
    const onPopoverBlur = () => {
      if (lastReady?.surface !== "popover" || !popoverFocusActive)
        return;
      popoverFocusActive = false;
      reportPopoverActivity();
    };
    const requireIdentity = (value, maximum = 1024) => {
      if (!value.trim() || value.length > maximum)
        throw new HostRequestError("HOST_REJECTED", `Identity must contain 1 to ${maximum} characters.`);
    };
    const readWorkspace = async (query) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const result = await send({ ...envelope, type: "workspace-read", id: nextId(ids), payload: query });
      if (!result || !("kind" in result) || !("state" in result) || result.kind !== query.kind) {
        throw new HostRequestError("HOST_REJECTED", "Host did not return workspace data.");
      }
      return result;
    };
    const subscribeWorkspace = async (query, listener) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const subscriptionId = nextId(ids);
      workspaceListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "workspace-subscribe", id: nextId(ids), payload: { subscriptionId, query } });
      } catch (error) {
        workspaceListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!workspaceListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const subscribeShells = async (scope, listener) => {
      if (scope.kind === "session")
        requireIdentity(scope.sessionId);
      if (scope.kind === "project")
        requireIdentity(scope.projectId);
      const subscriptionId = nextId(ids);
      shellsListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "shells-subscribe", id: nextId(ids), payload: { subscriptionId, scope } });
      } catch (error) {
        shellsListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!shellsListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const storage = async (payload) => {
      if ("key" in payload && (payload.key.length === 0 || payload.key.length > GUEST_STORAGE_KEY_MAX)) {
        throw new HostRequestError("HOST_REJECTED", "Storage key must contain 1 to 128 characters.");
      }
      if (payload.op === "set" && !isJsonValue(payload.value)) {
        throw new HostRequestError("HOST_REJECTED", "Storage values must be JSON.");
      }
      if (payload.op === "set" && new TextEncoder().encode(JSON.stringify(payload.value)).length > GUEST_STORAGE_VALUE_BYTES) {
        throw new HostRequestError("HOST_REJECTED", "Storage value exceeds 64 KiB.");
      }
      if (payload.scope === "device" && lastReady?.features?.deviceStorage !== true) {
        throw new HostRequestError("UNSUPPORTED", "This host does not support device storage.");
      }
      const result = await send({ ...envelope, type: "storage", id: nextId(ids), payload });
      if (!result || !("storage" in result) || result.op !== payload.op)
        throw new HostRequestError("HOST_REJECTED", "Host did not return storage data.");
      return result;
    };
    const closePopover = (id, reason) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-close", id: nextId(ids), payload: reason ? { id, reason } : { id } });
    const setPopoverAnchorActive = (id, active2) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-anchor", id: nextId(ids), payload: { id, active: active2 } });
    target.addEventListener("keydown", onPopoverEscape, true);
    target.addEventListener("pointerover", onPopoverPointerOver);
    target.addEventListener("pointermove", onPopoverPointerOver);
    target.addEventListener("pointerout", onPopoverPointerOut);
    target.addEventListener("focus", onPopoverFocus);
    target.addEventListener("blur", onPopoverBlur);
    return {
      onAction: (handler) => {
        actionHandler = handler;
        return () => {
          if (actionHandler === handler)
            actionHandler = null;
        };
      },
      listProjects: async () => {
        const result = await readWorkspace({ kind: "projects" });
        if (result.kind !== "projects")
          throw new HostRequestError("HOST_REJECTED", "Expected projects.");
        return result;
      },
      listWorktrees: async (projectId) => {
        const result = await readWorkspace({ kind: "worktrees", projectId });
        if (result.kind !== "worktrees")
          throw new HostRequestError("HOST_REJECTED", "Expected worktrees.");
        return result;
      },
      listSessions: async (projectId) => {
        const result = await readWorkspace({ kind: "sessions", projectId });
        if (result.kind !== "sessions")
          throw new HostRequestError("HOST_REJECTED", "Expected sessions.");
        return result;
      },
      onProjects: (listener) => subscribeWorkspace({ kind: "projects" }, (snapshot) => {
        if (snapshot.kind === "projects")
          listener(snapshot);
      }),
      onWorktrees: (projectId, listener) => subscribeWorkspace({ kind: "worktrees", projectId }, (snapshot) => {
        if (snapshot.kind === "worktrees")
          listener(snapshot);
      }),
      onSessions: (projectId, listener) => subscribeWorkspace({ kind: "sessions", projectId }, (snapshot) => {
        if (snapshot.kind === "sessions")
          listener(snapshot);
      }),
      onRunningShells: (scope, listener) => subscribeShells(scope, listener),
      readShellOutput: async (shellId, options2) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const cursor = options2?.cursor;
        if (cursor !== void 0 && (!Number.isInteger(cursor) || cursor < 0)) {
          throw new HostRequestError("HOST_REJECTED", "Shell output cursor must be a non-negative integer.");
        }
        const tailBytes = options2?.tailBytes;
        if (tailBytes !== void 0 && (!Number.isInteger(tailBytes) || tailBytes < 1 || tailBytes > GUEST_SHELL_OUTPUT_TAIL_MAX)) {
          throw new HostRequestError("HOST_REJECTED", `Shell output tailBytes must be an integer between 1 and ${GUEST_SHELL_OUTPUT_TAIL_MAX}.`);
        }
        const result = await send({ ...envelope, type: "shell-output", id: nextId(ids), payload: { shellId, cursor, tailBytes } });
        const output = result;
        if (!output || typeof output.output !== "string" || !Number.isFinite(output.cursor)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return shell output.");
        }
        return output;
      },
      stopShell: async (shellId) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const result = await send({ ...envelope, type: "shell-stop", id: nextId(ids), payload: { shellId } });
        if (result?.stopped !== true)
          throw new HostRequestError("HOST_REJECTED", "Host did not stop the shell.");
        return { stopped: true };
      },
      openSession: async (sessionId) => {
        requireIdentity(sessionId);
        await request({ ...envelope, type: "open-session", id: nextId(ids), payload: { sessionId } });
      },
      storage: {
        get: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "get", key };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          return result.op === "get" && result.found ? result.value : void 0;
        },
        set: async (key, value, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "set", key, value };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        delete: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "delete", key };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        keys: async (options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "keys" };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          if (result.op !== "keys")
            throw new HostRequestError("HOST_REJECTED", "Expected storage keys.");
          return result.keys;
        }
      },
      onReady: (listener) => {
        readyListeners.add(listener);
        if (lastReady)
          listener(lastReady);
        return () => {
          readyListeners.delete(listener);
        };
      },
      onDirectory: (listener) => {
        directoryListeners.add(listener);
        if (lastReady)
          listener(lastReady.directory);
        return () => {
          directoryListeners.delete(listener);
        };
      },
      onSession: (listener) => {
        sessionListeners.add(listener);
        if (lastReady)
          listener(lastReady.session);
        return () => {
          sessionListeners.delete(listener);
        };
      },
      onSessionLifecycle: (listener) => {
        lifecycleListeners.add(listener);
        if (lastLifecycle)
          listener(lastLifecycle);
        return () => {
          lifecycleListeners.delete(listener);
        };
      },
      onConnection: (listener) => {
        connectionListeners.add(listener);
        if (lastReady)
          listener(lastReady.connection);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      onSettings: (listener) => {
        settingsListeners.add(listener);
        if (lastReady)
          listener(lastReady.settings);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      onItem: (listener) => {
        itemListeners.add(listener);
        if (lastReady)
          listener(lastReady.item);
        return () => {
          itemListeners.delete(listener);
        };
      },
      onStatusControl: (listener) => {
        statusControlListeners.add(listener);
        return () => {
          statusControlListeners.delete(listener);
        };
      },
      onPopoverClosed: (listener) => {
        popoverClosedListeners.add(listener);
        return () => {
          popoverClosedListeners.delete(listener);
        };
      },
      setStatusControls: (controls) => {
        if (lastReady?.features?.statusControls !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support status controls."));
        }
        if (!isGuestStatusControls(controls)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Status controls must have unique bounded ids and valid selected options."));
        }
        return request({ ...envelope, type: "status-controls", id: nextId(ids), payload: { controls } });
      },
      openPopover: (payload) => {
        if (lastReady?.features?.popovers !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers."));
        }
        if (!isGuestPopoverRequest(payload)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Popover requests need bounded geometry and JSON data."));
        }
        return request({ ...envelope, type: "popover-open", id: nextId(ids), payload });
      },
      closePopover,
      setPopoverAnchorActive,
      onResolve: (handler) => {
        resolveHandler = handler;
        return () => {
          if (resolveHandler === handler)
            resolveHandler = null;
        };
      },
      toast: (payload) => {
        const message = payload.message.trim();
        if (!message || message.length > GUEST_TOAST_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast message must contain 1 to ${GUEST_TOAST_MAX} characters.`));
        }
        if (payload.copy && payload.copy !== true && (!payload.copy.text.length || payload.copy.text.length > GUEST_CLIPBOARD_TEXT_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast copy text must contain 1 to ${GUEST_CLIPBOARD_TEXT_MAX} characters.`));
        }
        return request({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "toast",
          id: nextId(ids),
          payload: { ...payload, message }
        });
      },
      openUrl: (url) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-url",
        id: nextId(ids),
        payload: { url }
      }),
      openCommit: (sha) => isGuestCommitSha(sha) ? request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-commit",
        id: nextId(ids),
        payload: { sha }
      }) : Promise.reject(new HostRequestError("HOST_REJECTED", "Commit id must be 7 to 64 hex characters.")),
      openSurface: (surfaceId) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-surface",
        id: nextId(ids),
        payload: { surfaceId }
      }),
      writeClipboard: (text2) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "clipboard-write",
        id: nextId(ids),
        payload: { text: text2 }
      }),
      compose: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "compose",
        id: nextId(ids),
        payload
      }),
      attach: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "attach",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      startSession: async (payload) => {
        if (payload.projectId !== void 0)
          requireIdentity(payload.projectId);
        const worktree = payload.worktree;
        if (worktree && worktree !== true) {
          if (worktree.kind === "existing")
            requireIdentity(worktree.directory);
          else {
            if (worktree.name !== void 0)
              requireIdentity(worktree.name, 200);
            if (worktree.baseBranch !== void 0)
              requireIdentity(worktree.baseBranch, 200);
          }
        }
        const result = await send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "start-session",
          id: nextId(ids),
          payload: clampStartSessionRequest(payload)
        }, options.requestTimeoutMs ?? 18e4);
        if (!isStartSessionResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a session.");
        }
        return result;
      },
      prompt: (payload) => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "prompt",
        id: nextId(ids),
        payload: clampPromptRequest(payload)
      }).then((result) => {
        if (!isPromptResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a prompt result.");
        }
        return result;
      }),
      sessionLink: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "session-link",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      close: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "close",
        id: nextId(ids)
      }),
      oauthStart: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-start",
        id: nextId(ids)
      }),
      oauthDisconnect: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-disconnect",
        id: nextId(ids)
      }),
      request: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host request result was empty.");
        }
        return result;
      }),
      serviceRequest: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host service request result was empty.");
        }
        return result;
      }),
      serviceStatus: () => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-status",
        id: nextId(ids)
      }).then((result) => {
        if (!isServiceStatusResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return service status.");
        }
        return result;
      }),
      readFile: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-read",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileReadResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file content.");
        }
        return result;
      }),
      writeFile: (path, content) => {
        if (!isGuestFilePath(path)) {
          return rejectBadFilePath();
        }
        if (content.length > GUEST_FILE_CONTENT_MAX) {
          return Promise.reject(new HostRequestError("FILE_TOO_LARGE", `Content is over ${GUEST_FILE_CONTENT_MAX} characters.`));
        }
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "file-write",
          id: nextId(ids),
          payload: { path, content }
        }).then((result) => {
          if (!isFileWriteResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not confirm the write.");
          }
          return result;
        });
      },
      listDir: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-list",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileListResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return directory entries.");
        }
        return result;
      }),
      stat: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-stat",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileStatResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file status.");
        }
        return result;
      }),
      generate: (input) => {
        const prompt = input.prompt.trim();
        const system = input.system?.trim();
        if (prompt.length === 0 || prompt.length > GUEST_GENERATE_PROMPT_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Prompt must be 1 to ${GUEST_GENERATE_PROMPT_MAX} characters.`));
        }
        if (system !== void 0 && (system.length === 0 || system.length > GUEST_GENERATE_SYSTEM_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `System prompt must be 1 to ${GUEST_GENERATE_SYSTEM_MAX} characters.`));
        }
        const maxOutputTokens = input.maxOutputTokens === void 0 ? void 0 : Math.min(GUEST_GENERATE_OUTPUT_TOKENS_MAX, Math.max(1, Math.floor(input.maxOutputTokens)));
        if (maxOutputTokens !== void 0 && !Number.isFinite(maxOutputTokens)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "maxOutputTokens must be a number."));
        }
        const payload = { prompt };
        if (system !== void 0)
          payload.system = system;
        if (maxOutputTokens !== void 0)
          payload.maxOutputTokens = maxOutputTokens;
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "generate",
          id: nextId(ids),
          payload
        }, options.requestTimeoutMs ?? GUEST_GENERATE_TIMEOUT_MS).then((result) => {
          if (!isGenerateResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not return generated text.");
          }
          return result;
        });
      },
      setBadge: (count) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "badge",
        id: nextId(ids),
        payload: { count: clampBadgeCount(count) }
      }),
      setHeight: (height) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "resize",
        id: nextId(ids),
        payload: { height: clampFrameHeight(height) }
      }),
      onFileOpen: (listener) => {
        fileOpenListeners.add(listener);
        if (!saveShortcutInstalled) {
          saveShortcutInstalled = true;
          target.addEventListener("keydown", onSaveShortcut, true);
        }
        if (lastFile)
          listener(lastFile);
        return () => {
          fileOpenListeners.delete(listener);
        };
      },
      onFileSnapshot: (handler) => {
        fileSnapshotHandler = handler;
        return () => {
          if (fileSnapshotHandler === handler)
            fileSnapshotHandler = null;
        };
      },
      onFileSaved: (listener) => {
        fileSavedListeners.add(listener);
        return () => {
          fileSavedListeners.delete(listener);
        };
      },
      reportFileChange: (change) => notify({ ...envelope, type: "file-change", payload: { dirty: change.dirty, edited: change.edited } }),
      requestFileSave,
      reportFileUnsupported: () => notify({ ...envelope, type: "file-unsupported" }),
      dispose: () => {
        for (const subscriptionId of workspaceListeners.keys()) {
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        workspaceListeners.clear();
        for (const subscriptionId of shellsListeners.keys()) {
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        shellsListeners.clear();
        disposed = true;
        resolveHandler = null;
        actionHandler = null;
        fileSnapshotHandler = null;
        fileOpenListeners.clear();
        fileSavedListeners.clear();
        if (saveShortcutInstalled)
          target.removeEventListener("keydown", onSaveShortcut, true);
        target.removeEventListener("message", onMessage);
        target.removeEventListener("keydown", onPopoverEscape, true);
        target.removeEventListener("pointerover", onPopoverPointerOver);
        target.removeEventListener("pointermove", onPopoverPointerOver);
        target.removeEventListener("pointerout", onPopoverPointerOut);
        target.removeEventListener("focus", onPopoverFocus);
        target.removeEventListener("blur", onPopoverBlur);
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new HostRequestError("HOST_UNAVAILABLE", "Host client was disposed."));
        }
        pending.clear();
        readyListeners.clear();
        directoryListeners.clear();
        sessionListeners.clear();
        lifecycleListeners.clear();
        connectionListeners.clear();
        settingsListeners.clear();
        itemListeners.clear();
        statusControlListeners.clear();
        popoverClosedListeners.clear();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/service-providers.js
  var BROWSER_CONTROL_ACTIONS = [
    "browser.open",
    "browser.snapshot",
    "browser.click",
    "browser.type",
    "browser.scroll",
    "browser.back",
    "browser.forward",
    "browser.inspect",
    "browser.capture",
    "browser.resize"
  ];
  var BROWSER_PROVIDER_IDLE_MS = 10 * 6e4;
  var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);

  // node_modules/@openchamber/sdk/dist/service-surface.js
  var SURFACE_CONTROLLERS = ["none", "agent", "user"];
  var CONTROLLERS = new Set(SURFACE_CONTROLLERS);

  // node_modules/@openchamber/sdk/dist/ui/theme.js
  var TOKEN_VARS = [
    ["--oc-bg", "background"],
    ["--oc-elevated", "elevated"],
    ["--oc-fg", "foreground"],
    ["--oc-muted", "muted"],
    ["--oc-subtle", "subtle"],
    ["--oc-border", "border"],
    ["--oc-hover", "hover"],
    ["--oc-selection", "selection"],
    ["--oc-focus", "focus"],
    ["--oc-primary", "primary"],
    ["--oc-muted-surface", "mutedSurface"],
    ["--oc-elevated-fg", "elevatedForeground"],
    ["--oc-active", "active"],
    ["--oc-selection-fg", "selectionForeground"],
    ["--oc-primary-fg", "primaryForeground"],
    ["--oc-primary-text", "primaryText"],
    ["--oc-success-text", "successText"],
    ["--oc-warning-text", "warningText"],
    ["--oc-error-text", "errorText"],
    ["--oc-info-text", "infoText"],
    ["--oc-success", "success"],
    ["--oc-warning", "warning"],
    ["--oc-error", "error"],
    ["--oc-info", "info"],
    ["--oc-font", "font"],
    ["--oc-mono", "mono"],
    ["--oc-radius", "radius"],
    ["--surface-background", "background"],
    ["--surface-elevated", "elevated"],
    ["--surface-foreground", "foreground"],
    ["--surface-muted-foreground", "muted"],
    ["--surface-subtle", "subtle"],
    ["--interactive-border", "border"],
    ["--interactive-hover", "hover"],
    ["--interactive-selection", "selection"],
    ["--interactive-focus-ring", "focus"],
    ["--primary", "primary"],
    ["--surface-muted", "mutedSurface"],
    ["--surface-elevated-foreground", "elevatedForeground"],
    ["--interactive-active", "active"],
    ["--interactive-selection-foreground", "selectionForeground"],
    ["--primary-foreground", "primaryForeground"],
    ["--primary-text", "primaryText"],
    ["--success-text", "successText"],
    ["--warning-text", "warningText"],
    ["--error-text", "errorText"],
    ["--info-text", "infoText"],
    ["--status-success", "success"],
    ["--status-warning", "warning"],
    ["--status-error", "error"],
    ["--status-info", "info"],
    ["--font-sans", "font"],
    ["--font-mono", "mono"],
    ["--radius", "radius"]
  ];
  var SYNTAX_TOKEN_VARS = [
    ["--oc-syntax-keyword", "--syntax-keyword", "syntaxKeyword"],
    ["--oc-syntax-string", "--syntax-string", "syntaxString"],
    ["--oc-syntax-number", "--syntax-number", "syntaxNumber"],
    ["--oc-syntax-function", "--syntax-function", "syntaxFunction"],
    ["--oc-syntax-type", "--syntax-type", "syntaxType"],
    ["--oc-syntax-comment", "--syntax-comment", "syntaxComment"],
    ["--oc-syntax-variable", "--syntax-variable", "syntaxVariable"],
    ["--oc-syntax-operator", "--syntax-operator", "syntaxOperator"]
  ];
  var applyHostTheme = (theme, root2) => {
    root2.style.colorScheme = theme.mode;
    for (const [name, key] of TOKEN_VARS) {
      root2.style.setProperty(name, theme.tokens[key]);
    }
    for (const [alias, hostName, key] of SYNTAX_TOKEN_VARS) {
      const value = theme.tokens[key] ?? "";
      root2.style.setProperty(alias, value);
      root2.style.setProperty(hostName, value);
    }
    root2.style.setProperty("font-family", theme.tokens.font);
    root2.style.setProperty("font-size", "0.875rem");
    root2.style.setProperty("line-height", "1.45");
    root2.style.setProperty("color", theme.tokens.foreground);
  };
  var applyHostReady = (ctx, root2) => {
    applyHostTheme(ctx.theme, root2);
    if (root2.dataset) {
      root2.dataset.ocSurface = ctx.surface;
      root2.dataset.ocTheme = ctx.theme.mode;
    }
  };

  // node_modules/@openchamber/sdk/dist/ui/style.js
  var OC_ALIAS = {
    "surface-background": "bg",
    "surface-elevated": "elevated",
    "surface-elevated-foreground": "elevated-fg",
    "surface-foreground": "fg",
    "surface-muted-foreground": "muted",
    "surface-muted": "muted-surface",
    "surface-subtle": "subtle",
    "interactive-border": "border",
    "interactive-hover": "hover",
    "interactive-active": "active",
    "interactive-selection": "selection",
    "interactive-selection-foreground": "selection-fg",
    "interactive-focus-ring": "focus",
    "primary": "primary",
    "primary-foreground": "primary-fg",
    "primary-text": "primary-text",
    "success-text": "success-text",
    "warning-text": "warning-text",
    "error-text": "error-text",
    "info-text": "info-text",
    "status-success": "success",
    "status-warning": "warning",
    "status-error": "error",
    "status-info": "info",
    "font-sans": "font",
    "font-mono": "mono",
    "radius": "radius"
  };
  var v = (name, fallback) => `var(--${name}, var(--oc-${OC_ALIAS[name]}, ${fallback}))`;
  var bg = v("surface-background", "transparent");
  var elevated = v("surface-elevated", "transparent");
  var elevatedFg = v("surface-elevated-foreground", "inherit");
  var fg = v("surface-foreground", "inherit");
  var muted = v("surface-muted-foreground", "gray");
  var secondary = v("surface-muted", "transparent");
  var border = v("interactive-border", "currentColor");
  var hover = v("interactive-hover", "transparent");
  var active = v("interactive-active", "transparent");
  var selection = v("interactive-selection", "transparent");
  var selectionFg = v("interactive-selection-foreground", "inherit");
  var focus = v("interactive-focus-ring", "currentColor");
  var primary = v("primary", "currentColor");
  var primaryText = v("primary-text", "inherit");
  var errorText = v("error-text", "inherit");
  var font = v("font-sans", "inherit");
  var mono = v("font-mono", "monospace");
  var radius = v("radius", "9px");
  var controlRadius = `calc(${radius} - 2px)`;
  var smallRadius = `calc(${radius} - 4px)`;
  var mix = (color, pct, base = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${base})`;
  var focusRing = `box-shadow: 0 0 0 2px ${focus};`;
  var tone = (name) => {
    const color = v(`status-${name}`, "currentColor");
    return `
.oc-sdk[data-tone="${name}"], .oc-sdk [data-tone="${name}"] { --oc-sdk-tone: ${color}; --oc-sdk-tone-text: ${v(`${name}-text`, "inherit")}; }`;
  };
  var UI_SIZE_CSS = `
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 32px; padding: 0 12px; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: 6px; height: 28px; padding: 0 10px; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: 4px; height: 24px; padding: 0 8px; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: 14px; height: 14px; }

.oc-sdk-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: 32px; padding: 0 10px; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: 8px 10px; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: 34px; padding-right: 34px; }
.oc-sdk-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: 24px; height: 24px; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: 6px; width: 100%; min-width: 0; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: 2px; min-width: 160px; max-width: calc(100vw - 16px); max-height: min(320px, calc(100vh - 16px)); overflow: auto; padding: 4px; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: 2px 2px 4px; }
.oc-sdk-popup-search .oc-sdk-input { height: 28px; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: 14px; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: 8px; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-top: 3px; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: 36px; height: 20px; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: 2px; padding: 2px; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: 1px 6px; font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: 16px 8px; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px 16px; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: 12px; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: 16px; height: 16px; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: 12px; height: 12px; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: 8px; width: 100%; margin: 8px 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: 4px 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: 6px; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: 8px 0; }
`;
  var GUEST_UI_LOOK_CSS = `
.oc-sdk { color: ${fg}; font-family: ${font}; }
.oc-sdk :focus-visible { outline: none; ${focusRing} }
.oc-sdk-mono { font-family: ${mono}; }
.oc-sdk-muted { color: ${muted}; }
${tone("success")}${tone("warning")}${tone("error")}${tone("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${primary}; --oc-sdk-tone-text: ${primaryText}; }

.oc-sdk-btn { border-radius: ${controlRadius}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${smallRadius}; }
.oc-sdk-btn[data-variant="default"] { color: ${primaryText}; background: ${mix(primary, 10, bg)}; border-color: ${mix(primary, 12)}; }
.oc-sdk-btn[data-variant="default"]:hover { background: ${mix(primary, 16, bg)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${mix(primary, 22, bg)}; }
.oc-sdk-btn[data-variant="secondary"] { background: ${secondary}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="outline"] { background: ${elevated}; color: ${elevatedFg}; border-color: ${border}; }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${hover}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${active}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${v("status-error", "red")}; color: ${errorText}; background: ${mix("var(--oc-sdk-tone)", 7, bg)}; border-color: ${mix("var(--oc-sdk-tone)", 12)}; }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${mix("var(--oc-sdk-tone)", 9, bg)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${mix("var(--oc-sdk-tone)", 11, bg)}; }

.oc-sdk-field-note { color: ${muted}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${errorText}; }
.oc-sdk-input { border-radius: ${controlRadius}; background: ${elevated}; color: ${elevatedFg}; box-shadow: inset 0 0 0 1px ${mix(border, 60)}; transition: background 150ms ease-out, box-shadow 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${muted}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { box-shadow: inset 0 0 0 2px ${focus}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input { box-shadow: inset 0 0 0 1px ${v("status-error", "red")}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { box-shadow: inset 0 0 0 2px ${v("status-error", "red")}; }
.oc-sdk-input[data-mono="true"] { font-family: ${mono}; }

.oc-sdk-search-icon { color: ${muted}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${primary}; }
.oc-sdk-search-clear { border-radius: ${smallRadius}; color: ${muted}; }
.oc-sdk-search-clear:hover { background: ${hover}; color: ${fg}; }

.oc-sdk-trigger { border-color: ${border}; border-radius: ${controlRadius}; background: ${elevated}; color: ${elevatedFg}; transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${muted}; }
.oc-sdk-trigger-chevron { color: ${muted}; }
.oc-sdk-popup { --surface-foreground: ${elevatedFg}; border-color: ${mix(border, 60)}; border-radius: 12px; background: ${elevated}; color: ${elevatedFg}; box-shadow: 0 8px 24px ${mix(fg, 12)}; }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${hover}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-option-check { color: ${fg}; }
.oc-sdk-option[data-destructive="true"] { color: ${errorText}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${mix(v("status-error", "red"), 10)}; }
.oc-sdk-option-hint { color: ${muted}; }
.oc-sdk-popup-empty { color: ${muted}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${border}; border-radius: 4px; color: ${fg}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${mix(fg, 60, border)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${border}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${bg}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${primary}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(16px); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${focusRing} }
.oc-sdk-check-desc { color: ${muted}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${mix(fg, 4)}; }
.oc-sdk-tab { border-radius: 8px; color: ${muted}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${fg}; }
.oc-sdk-tab[aria-selected="true"] { color: ${selectionFg}; background: ${selection}; border-color: ${border}; }
.oc-sdk-tab-count { color: ${muted}; }

.oc-sdk-badge { border-radius: 9999px; background: ${hover}; color: ${muted}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${mix("var(--oc-sdk-tone)", 15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${hover}; }
.oc-sdk-row[aria-selected="true"] { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-row-lead { font-family: ${mono}; color: ${muted}; }
.oc-sdk-row-sub { color: ${muted}; }
.oc-sdk-row-meta { color: ${muted}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${muted}; }

.oc-sdk-empty-body { color: ${muted}; }

.oc-sdk-spinner { color: ${muted}; }
.oc-sdk-spinner-ring { border-color: ${border}; border-top-color: ${primary}; border-radius: 9999px; }

.oc-sdk-banner { border-color: ${mix("var(--oc-sdk-tone)", 40)}; border-radius: 8px; background: ${mix("var(--oc-sdk-tone)", 10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${muted}; }

.oc-sdk-separator { color: ${muted}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${mix(border, 40)}; }

.oc-sdk-progress-label { color: ${muted}; }
.oc-sdk-progress-track { border-radius: 9999px; background: ${border}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${primary}); }

.oc-sdk-text a { color: ${primaryText}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${mix(border, 60)}; }
`;
  var UI_CSS = `
${GUEST_SCROLLBAR_CSS}
${UI_SIZE_CSS}
${GUEST_UI_LOOK_CSS}`;

  // src/panel/client.ts
  var BeadsRequestError = class extends Error {
    constructor(code, message, status, detail, workspace, saved) {
      super(message);
      this.code = code;
      this.status = status;
      this.detail = detail;
      this.workspace = workspace;
      this.saved = saved;
      this.name = "BeadsRequestError";
      if (detail === "") this.detail = void 0;
    }
    code;
    status;
    detail;
    workspace;
    saved;
  };
  var UNEXPECTED = "Something went wrong.";
  var HOST_TEXT = {
    DISCONNECTED: "OpenChamber isn't connected.",
    HOST_UNAVAILABLE: "OpenChamber isn't available right now.",
    HOST_REJECTED: "OpenChamber refused the request.",
    NO_SERVICE: "Abacus's helper isn't available.",
    DISABLED: "The Beads extension is turned off.",
    SERVICE_FAILED: "Abacus's helper stopped unexpectedly.",
    REQUEST_FAILED: "The request didn't go through.",
    RESPONSE_TOO_LARGE: "The answer was too large to show.",
    HOST_TIMEOUT: "Beads took too long to answer."
  };
  var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  function fromEnvelope(status, body) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return new BeadsRequestError("INTERNAL", UNEXPECTED, status, body);
    }
    const error = isObject(parsed) && isObject(parsed.error) ? parsed.error : null;
    if (!error || typeof error.code !== "string" || typeof error.message !== "string") return new BeadsRequestError("INTERNAL", UNEXPECTED, status, body);
    return new BeadsRequestError(error.code, error.message, status, error.detail, error.workspace, error.saved);
  }
  function fromThrown(error) {
    if (error instanceof BeadsRequestError) return error;
    if (error instanceof HostRequestError) return new BeadsRequestError(error.code, HOST_TEXT[error.code] ?? UNEXPECTED, null, error.message);
    return new BeadsRequestError("INTERNAL", UNEXPECTED, null, error instanceof Error ? error.message : String(error));
  }
  var ANSWER_LOST = /* @__PURE__ */ new Set(["HOST_TIMEOUT", "SERVICE_FAILED", "REQUEST_FAILED", "RESPONSE_TOO_LARGE"]);
  var TOAST_MAX = 500;
  var COPY_MAX = 32e3;
  var asRequestError = fromThrown;
  function createClient(host2) {
    const call = (name) => async (request) => {
      let answer;
      try {
        answer = await host2.serviceRequest({ method: "POST", path: `/api/${name}`, body: JSON.stringify(request) });
      } catch (error) {
        throw fromThrown(error);
      }
      if (answer.status < 200 || answer.status >= 300) throw fromEnvelope(answer.status, answer.body);
      try {
        return JSON.parse(answer.body);
      } catch {
        throw new BeadsRequestError("INTERNAL", UNEXPECTED, answer.status, answer.body);
      }
    };
    return {
      workspace: call("workspace"),
      snapshot: call("snapshot"),
      bead: call("bead"),
      update: call("update"),
      create: call("create"),
      comment: call("comment"),
      dependency: call("dependency"),
      gateCreate: call("gateCreate"),
      gateResolve: call("gateResolve"),
      humanRespond: call("humanRespond"),
      humanDismiss: call("humanDismiss"),
      history: call("history"),
      memories: call("memories"),
      memoryRemember: call("memoryRemember"),
      memoryForget: call("memoryForget"),
      deferBead: call("deferBead"),
      undeferBead: call("undeferBead"),
      supersede: call("supersede"),
      duplicate: call("duplicate"),
      explain: call("explain"),
      eventsStatus: call("eventsStatus"),
      enableEvents: call("enableEvents"),
      migrateSchema: call("migrateSchema"),
      seen: call("seen"),
      context: call("context"),
      syncPreview: call("sync-preview"),
      syncPull: call("sync-pull"),
      syncPublish: call("sync-publish"),
      conflictContext: call("conflict-context")
    };
  }

  // src/panel/resolve.ts
  var PROVIDER_ID = "beads";
  function attachPayload(context, directory2, sync = false) {
    const data = sync ? { v: 1, directory: directory2, sync: true } : { v: 1, directory: directory2 };
    return {
      providerId: PROVIDER_ID,
      id: context.id.slice(0, GUEST_ATTACH_ID_MAX),
      title: context.title.slice(0, GUEST_ATTACH_TITLE_MAX),
      url: context.url,
      text: context.text.slice(0, GUEST_ATTACH_TEXT_MAX),
      kind: "issue",
      data
    };
  }
  var SLUG_MAX = 40;
  function branchSlug(title) {
    const words = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let slug = "";
    for (const word of words) {
      const next = slug ? `${slug}-${word}` : word;
      if (next.length > SLUG_MAX) return slug || word.slice(0, SLUG_MAX);
      slug = next;
    }
    return slug;
  }
  function worktreeName(id, title) {
    const slug = branchSlug(title);
    return slug ? `issue-${id}-${slug}` : `issue-${id}`;
  }
  var validBranchName = (name) => name.length > 0 && name.length <= 200 && /^[A-Za-z0-9._/-]+$/.test(name) && !/^[-/.]|\.\.|\/\/|[/.]$|\.lock$/.test(name);
  function matchBead(ids, query) {
    const q4 = query.trim().toLowerCase();
    if (!q4) return { kind: "none" };
    const exact = ids.find((id) => id.toLowerCase() === q4);
    if (exact) return { kind: "one", id: exact };
    const ends = ids.filter((id) => {
      const lower = id.toLowerCase();
      if (!lower.endsWith(q4) || lower.length === q4.length) return false;
      const before = lower[lower.length - q4.length - 1];
      return before === "-" || before === ".";
    });
    if (ends.length === 1) return { kind: "one", id: ends[0] };
    return ends.length === 0 ? { kind: "none" } : { kind: "many", ids: ends };
  }
  async function resolveCommand(request, { client: client2, directory: directory2, known }) {
    if (request.command !== "bd") return null;
    const query = request.args.trim();
    if (!query) throw new Error("Type a bead id after /bd, for example /bd k3f2.");
    if (directory2 === null) throw new Error("Open a project first.");
    const read = async () => {
      const answer = await client2.snapshot({ directory: directory2 });
      if (answer.unchanged) throw new Error("Couldn't read this project's beads.");
      return answer.beads.map((b2) => b2.id);
    };
    const held = known && known.directory === directory2 ? known.ids : null;
    let match = matchBead(held ?? await read(), query);
    if (held && match.kind !== "one") match = matchBead(await read(), query);
    if (match.kind === "none") throw new Error(`No bead ${query} in this project.`);
    if (match.kind === "many") {
      const shown = match.ids.slice(0, 3).join(", ");
      const more = match.ids.length > 3 ? ` and ${match.ids.length - 3} more` : "";
      throw new Error(`${query} matches more than one bead: ${shown}${more}. Type more of the id.`);
    }
    return attachPayload(await client2.context({ directory: directory2, id: match.id }), directory2);
  }

  // node_modules/preact/dist/preact.module.js
  var n;
  var l;
  var u;
  var t;
  var i;
  var r;
  var o;
  var e;
  var f;
  var c;
  var a;
  var s;
  var h;
  var p;
  var v2;
  var y;
  var d = {};
  var w = [];
  var _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
  var g = Array.isArray;
  function m(n2, l3) {
    for (var u4 in l3) n2[u4] = l3[u4];
    return n2;
  }
  function b(n2) {
    n2 && n2.parentNode && n2.parentNode.removeChild(n2);
  }
  function k(l3, u4, t3) {
    var i3, r3, o3, e3 = {};
    for (o3 in u4) "key" == o3 ? i3 = u4[o3] : "ref" == o3 ? r3 = u4[o3] : e3[o3] = u4[o3];
    if (arguments.length > 2 && (e3.children = arguments.length > 3 ? n.call(arguments, 2) : t3), "function" == typeof l3 && null != l3.defaultProps) for (o3 in l3.defaultProps) void 0 === e3[o3] && (e3[o3] = l3.defaultProps[o3]);
    return x(l3, e3, i3, r3, null);
  }
  function x(n2, t3, i3, r3, o3) {
    var e3 = { type: n2, props: t3, key: i3, ref: r3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: null == o3 ? ++u : o3, __i: -1, __u: 0 };
    return null == o3 && null != l.vnode && l.vnode(e3), e3;
  }
  function S(n2) {
    return n2.children;
  }
  function C(n2, l3) {
    this.props = n2, this.context = l3;
  }
  function $(n2, l3) {
    if (null == l3) return n2.__ ? $(n2.__, n2.__i + 1) : null;
    for (var u4; l3 < n2.__k.length; l3++) if (null != (u4 = n2.__k[l3]) && null != u4.__e) return u4.__e;
    return "function" == typeof n2.type ? $(n2) : null;
  }
  function I(n2) {
    if (n2.__P && n2.__d) {
      var u4 = n2.__v, t3 = u4.__e, i3 = [], r3 = [], o3 = m({}, u4);
      o3.__v = u4.__v + 1, l.vnode && l.vnode(o3), q(n2.__P, o3, u4, n2.__n, n2.__P.namespaceURI, 32 & u4.__u ? [t3] : null, i3, null == t3 ? $(u4) : t3, !!(32 & u4.__u), r3), o3.__v = u4.__v, o3.__.__k[o3.__i] = o3, D(i3, o3, r3), u4.__e = u4.__ = null, o3.__e != t3 && P(o3);
    }
  }
  function P(n2) {
    if (null != (n2 = n2.__) && null != n2.__c) return n2.__e = n2.__c.base = null, n2.__k.some(function(l3) {
      if (null != l3 && null != l3.__e) return n2.__e = n2.__c.base = l3.__e;
    }), P(n2);
  }
  function A(n2) {
    (!n2.__d && (n2.__d = true) && i.push(n2) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
  }
  function H() {
    try {
      for (var n2, l3 = 1; i.length; ) i.length > l3 && i.sort(e), n2 = i.shift(), l3 = i.length, I(n2);
    } finally {
      i.length = H.__r = 0;
    }
  }
  function L(n2, l3, u4, t3, i3, r3, o3, e3, f5, c3, a5) {
    var s3, h4, p3, v5, y4, _4, g3 = t3 && t3.__k || w, m3 = l3.length;
    for (f5 = T(u4, l3, g3, f5, m3), s3 = 0; s3 < m3; s3++) null != (p3 = u4.__k[s3]) && (h4 = -1 != p3.__i && g3[p3.__i] || d, p3.__i = s3, _4 = q(n2, p3, h4, i3, r3, o3, e3, f5, c3, a5), v5 = p3.__e, p3.ref && h4.ref != p3.ref && (h4.ref && J(h4.ref, null, p3), a5.push(p3.ref, p3.__c || v5, p3)), null == y4 && null != v5 && (y4 = v5), 4 & p3.__u ? (f5 = j(p3, f5, n2), h4.__e && (h4.__e = null)) : "function" == typeof p3.type && void 0 !== _4 ? f5 = _4 : v5 && (f5 = v5.nextSibling), p3.__u &= -7);
    return u4.__e = y4, f5;
  }
  function T(n2, l3, u4, t3, i3) {
    var r3, o3, e3, f5, c3, a5 = u4.length, s3 = a5, h4 = 0;
    for (n2.__k = new Array(i3), r3 = 0; r3 < i3; r3++) null != (o3 = l3[r3]) && "boolean" != typeof o3 && "function" != typeof o3 ? ("string" == typeof o3 || "number" == typeof o3 || "bigint" == typeof o3 || o3.constructor == String ? o3 = n2.__k[r3] = x(null, o3, null, null, null) : g(o3) ? o3 = n2.__k[r3] = x(S, { children: o3 }, null, null, null) : void 0 === o3.constructor && o3.__b > 0 ? o3 = n2.__k[r3] = x(o3.type, o3.props, o3.key, o3.ref ? o3.ref : null, o3.__v) : n2.__k[r3] = o3, f5 = r3 + h4, o3.__ = n2, o3.__b = n2.__b + 1, e3 = null, -1 != (c3 = o3.__i = O(o3, u4, f5, s3)) && (s3--, (e3 = u4[c3]) && (e3.__u |= 2)), null == e3 || null == e3.__v ? (-1 == c3 && (i3 > a5 ? h4-- : i3 < a5 && h4++), "function" != typeof o3.type && (o3.__u |= 4)) : c3 != f5 && (c3 == f5 - 1 ? h4-- : c3 == f5 + 1 ? h4++ : (c3 > f5 ? h4-- : h4++, o3.__u |= 4))) : n2.__k[r3] = null;
    if (s3) for (r3 = 0; r3 < a5; r3++) null != (e3 = u4[r3]) && 0 == (2 & e3.__u) && (e3.__e == t3 && (t3 = $(e3)), K(e3, e3));
    return t3;
  }
  function j(n2, l3, u4) {
    var t3, i3;
    if ("function" == typeof n2.type) {
      for (t3 = n2.__k, i3 = 0; t3 && i3 < t3.length; i3++) t3[i3] && (t3[i3].__ = n2, l3 = j(t3[i3], l3, u4));
      return l3;
    }
    n2.__e != l3 && (l3 && n2.type && !l3.parentNode && (l3 = $(n2)), l3 = u4.insertBefore(n2.__e, l3 || null));
    do {
      l3 = l3 && l3.nextSibling;
    } while (null != l3 && 8 == l3.nodeType);
    return l3;
  }
  function O(n2, l3, u4, t3) {
    var i3, r3, o3, e3 = n2.key, f5 = n2.type, c3 = l3[u4], a5 = null != c3 && 0 == (2 & c3.__u);
    if (null === c3 && null == e3 || a5 && e3 == c3.key && f5 == c3.type) return u4;
    if (t3 > (a5 ? 1 : 0)) {
      for (i3 = u4 - 1, r3 = u4 + 1; i3 >= 0 || r3 < l3.length; ) if (null != (c3 = l3[o3 = i3 >= 0 ? i3-- : r3++]) && 0 == (2 & c3.__u) && e3 == c3.key && f5 == c3.type) return o3;
    }
    return -1;
  }
  function z(n2, l3, u4) {
    "-" == l3[0] ? n2.setProperty(l3, null == u4 ? "" : u4) : n2[l3] = null == u4 ? "" : "number" != typeof u4 || _.test(l3) ? u4 : u4 + "px";
  }
  function N(n2, l3, u4, t3, i3) {
    var r3, o3;
    n: if ("style" == l3) if ("string" == typeof u4) n2.style.cssText = u4;
    else {
      if ("string" == typeof t3 && (n2.style.cssText = t3 = ""), t3) for (l3 in t3) u4 && l3 in u4 || z(n2.style, l3, "");
      if (u4) for (l3 in u4) t3 && u4[l3] == t3[l3] || z(n2.style, l3, u4[l3]);
    }
    else if ("o" == l3[0] && "n" == l3[1]) r3 = l3 != (l3 = l3.replace(s, "$1")), o3 = l3.toLowerCase(), l3 = o3 in n2 || "onFocusOut" == l3 || "onFocusIn" == l3 ? o3.slice(2) : l3.slice(2), n2.l || (n2.l = {}), n2.l[l3 + r3] = u4, u4 ? t3 ? u4[a] = t3[a] : (u4[a] = h, n2.addEventListener(l3, r3 ? v2 : p, r3)) : n2.removeEventListener(l3, r3 ? v2 : p, r3);
    else {
      if ("http://www.w3.org/2000/svg" == i3) l3 = l3.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
      else if ("width" != l3 && "height" != l3 && "href" != l3 && "list" != l3 && "form" != l3 && "tabIndex" != l3 && "download" != l3 && "rowSpan" != l3 && "colSpan" != l3 && "role" != l3 && "popover" != l3 && l3 in n2) try {
        n2[l3] = null == u4 ? "" : u4;
        break n;
      } catch (n3) {
      }
      "function" == typeof u4 || (null == u4 || false === u4 && "-" != l3[4] ? n2.removeAttribute(l3) : n2.setAttribute(l3, "popover" == l3 && 1 == u4 ? "" : u4));
    }
  }
  function V(n2) {
    return function(u4) {
      if (this.l) {
        var t3 = this.l[u4.type + n2];
        if (null == u4[c]) u4[c] = h++;
        else if (u4[c] < t3[a]) return;
        return t3(l.event ? l.event(u4) : u4);
      }
    };
  }
  function q(n2, u4, t3, i3, r3, o3, e3, f5, c3, a5) {
    var s3, h4, p3, v5, y4, d3, _4, k3, x4, M2, I3, P2, A4, H2, T4, j4, F2 = u4.type;
    if (void 0 !== u4.constructor) return null;
    128 & t3.__u && (c3 = !!(32 & t3.__u), o3 = [f5 = u4.__e = t3.__e]), (s3 = l.__b) && s3(u4);
    n: if ("function" == typeof F2) {
      h4 = e3.length;
      try {
        if (x4 = u4.props, M2 = F2.prototype && F2.prototype.render, I3 = (s3 = F2.contextType) && i3[s3.__c], P2 = s3 ? I3 ? I3.props.value : s3.__ : i3, t3.__c ? k3 = (p3 = u4.__c = t3.__c).__ = p3.__E : (M2 ? u4.__c = p3 = new F2(x4, P2) : (u4.__c = p3 = new C(x4, P2), p3.constructor = F2, p3.render = Q), I3 && I3.sub(p3), p3.state || (p3.state = {}), p3.__n = i3, v5 = p3.__d = true, p3.__h = [], p3._sb = []), M2 && null == p3.__s && (p3.__s = p3.state), M2 && null != F2.getDerivedStateFromProps && (p3.__s == p3.state && (p3.__s = m({}, p3.__s)), m(p3.__s, F2.getDerivedStateFromProps(x4, p3.__s))), y4 = p3.props, d3 = p3.state, p3.__v = u4, v5) M2 && null == F2.getDerivedStateFromProps && null != p3.componentWillMount && p3.componentWillMount(), M2 && null != p3.componentDidMount && p3.__h.push(p3.componentDidMount);
        else {
          if (M2 && null == F2.getDerivedStateFromProps && x4 !== y4 && null != p3.componentWillReceiveProps && p3.componentWillReceiveProps(x4, P2), u4.__v == t3.__v || !p3.__e && null != p3.shouldComponentUpdate && false === p3.shouldComponentUpdate(x4, p3.__s, P2)) {
            u4.__v != t3.__v && (p3.props = x4, p3.state = p3.__s, p3.__d = false), u4.__e = t3.__e, u4.__k = t3.__k, u4.__k.some(function(n3) {
              n3 && (n3.__ = u4);
            }), w.push.apply(p3.__h, p3._sb), p3._sb = [], p3.__h.length && e3.push(p3), f5 = $(t3);
            break n;
          }
          null != p3.componentWillUpdate && p3.componentWillUpdate(x4, p3.__s, P2), M2 && null != p3.componentDidUpdate && p3.__h.push(function() {
            p3.componentDidUpdate(y4, d3, _4);
          });
        }
        if (p3.context = P2, p3.props = x4, p3.__P = n2, p3.__e = false, A4 = l.__r, H2 = 0, M2) p3.state = p3.__s, p3.__d = false, A4 && A4(u4), s3 = p3.render(p3.props, p3.state, p3.context), w.push.apply(p3.__h, p3._sb), p3._sb = [];
        else do {
          p3.__d = false, A4 && A4(u4), s3 = p3.render(p3.props, p3.state, p3.context), p3.state = p3.__s;
        } while (p3.__d && ++H2 < 25);
        p3.state = p3.__s, null != p3.getChildContext && (i3 = m(m({}, i3), p3.getChildContext())), M2 && !v5 && null != p3.getSnapshotBeforeUpdate && (_4 = p3.getSnapshotBeforeUpdate(y4, d3)), T4 = null != s3 && s3.type === S && null == s3.key ? E(s3.props.children) : s3, f5 = L(n2, g(T4) ? T4 : [T4], u4, t3, i3, r3, o3, e3, f5, c3, a5), p3.base = u4.__e, u4.__u &= -161, p3.__h.length && e3.push(p3), k3 && (p3.__E = p3.__ = null);
      } catch (n3) {
        if (e3.length = h4, u4.__v = null, c3 || null != o3) {
          if (n3.then) {
            for (u4.__u |= c3 ? 160 : 128; f5 && 8 == f5.nodeType && f5.nextSibling; ) f5 = f5.nextSibling;
            null != o3 && (o3[o3.indexOf(f5)] = null), u4.__e = f5;
          } else if (null != o3) for (j4 = o3.length; j4--; ) b(o3[j4]);
        } else u4.__e = t3.__e;
        null == u4.__k && (u4.__k = t3.__k || []), n3.then || B(u4), l.__e(n3, u4, t3);
      }
    } else null == o3 && u4.__v == t3.__v ? (u4.__k = t3.__k, u4.__e = t3.__e) : f5 = u4.__e = G(t3.__e, u4, t3, i3, r3, o3, e3, c3, a5);
    return (s3 = l.diffed) && s3(u4), 128 & u4.__u ? void 0 : f5;
  }
  function B(n2) {
    n2 && (n2.__c && (n2.__c.__e = true), n2.__k && n2.__k.some(B));
  }
  function D(n2, u4, t3) {
    for (var i3 = 0; i3 < t3.length; i3++) J(t3[i3], t3[++i3], t3[++i3]);
    l.__c && l.__c(u4, n2), n2.some(function(u5) {
      try {
        n2 = u5.__h, u5.__h = [], n2.some(function(n3) {
          n3.call(u5);
        });
      } catch (n3) {
        l.__e(n3, u5.__v);
      }
    });
  }
  function E(n2) {
    return "object" != typeof n2 || null == n2 || n2.__b > 0 ? n2 : g(n2) ? n2.map(E) : void 0 !== n2.constructor ? null : m({}, n2);
  }
  function G(u4, t3, i3, r3, o3, e3, f5, c3, a5) {
    var s3, h4, p3, v5, y4, w4, _4, m3 = i3.props || d, k3 = t3.props, x4 = t3.type;
    if ("svg" == x4 ? o3 = "http://www.w3.org/2000/svg" : "math" == x4 ? o3 = "http://www.w3.org/1998/Math/MathML" : o3 || (o3 = "http://www.w3.org/1999/xhtml"), null != e3) {
      for (s3 = 0; s3 < e3.length; s3++) if ((y4 = e3[s3]) && "setAttribute" in y4 == !!x4 && (x4 ? y4.localName == x4 : 3 == y4.nodeType)) {
        u4 = y4, e3[s3] = null;
        break;
      }
    }
    if (null == u4) {
      if (null == x4) return document.createTextNode(k3);
      u4 = document.createElementNS(o3, x4, k3.is && k3), c3 && (l.__m && l.__m(t3, e3), c3 = false), e3 = null;
    }
    if (null == x4) m3 === k3 || c3 && u4.data == k3 || (u4.data = k3);
    else {
      if (e3 = "textarea" == x4 && null != k3.defaultValue ? null : e3 && n.call(u4.childNodes), !c3 && null != e3) for (m3 = {}, s3 = 0; s3 < u4.attributes.length; s3++) m3[(y4 = u4.attributes[s3]).name] = y4.value;
      for (s3 in m3) y4 = m3[s3], "dangerouslySetInnerHTML" == s3 ? p3 = y4 : "children" == s3 || s3 in k3 || "value" == s3 && "defaultValue" in k3 || "checked" == s3 && "defaultChecked" in k3 || N(u4, s3, null, y4, o3);
      for (s3 in k3) y4 = k3[s3], "children" == s3 ? v5 = y4 : "dangerouslySetInnerHTML" == s3 ? h4 = y4 : "value" == s3 ? w4 = y4 : "checked" == s3 ? _4 = y4 : c3 && "function" != typeof y4 || m3[s3] === y4 || N(u4, s3, y4, m3[s3], o3);
      if (h4) c3 || p3 && (h4.__html == p3.__html || h4.__html == u4.innerHTML) || (u4.innerHTML = h4.__html), t3.__k = [];
      else if (p3 && (u4.innerHTML = ""), L("template" == t3.type ? u4.content : u4, g(v5) ? v5 : [v5], t3, i3, r3, "foreignObject" == x4 ? "http://www.w3.org/1999/xhtml" : o3, e3, f5, e3 ? e3[0] : i3.__k && $(i3, 0), c3, a5), null != e3) for (s3 = e3.length; s3--; ) b(e3[s3]);
      c3 && "textarea" != x4 || (s3 = "value", "progress" == x4 && null == w4 ? u4.removeAttribute("value") : null != w4 && (w4 !== u4[s3] || "progress" == x4 && !w4 || "option" == x4 && w4 != m3[s3]) && N(u4, s3, w4, m3[s3], o3), s3 = "checked", null != _4 && _4 != u4[s3] && N(u4, s3, _4, m3[s3], o3));
    }
    return u4;
  }
  function J(n2, u4, t3) {
    try {
      if ("function" == typeof n2) {
        var i3 = "function" == typeof n2.__u;
        i3 && n2.__u(), i3 && null == u4 || (n2.__u = n2(u4));
      } else n2.current = u4;
    } catch (n3) {
      l.__e(n3, t3);
    }
  }
  function K(n2, u4, t3) {
    var i3, r3;
    if (l.unmount && l.unmount(n2), (i3 = n2.ref) && (i3.current && i3.current != n2.__e || J(i3, null, u4)), null != (i3 = n2.__c)) {
      if (i3.componentWillUnmount) try {
        i3.componentWillUnmount();
      } catch (n3) {
        l.__e(n3, u4);
      }
      i3.base = i3.__P = i3.__n = null;
    }
    if (i3 = n2.__k) for (r3 = 0; r3 < i3.length; r3++) i3[r3] && K(i3[r3], u4, t3 || "function" != typeof n2.type);
    t3 || b(n2.__e), n2.__c = n2.__ = n2.__e = void 0;
  }
  function Q(n2, l3, u4) {
    return this.constructor(n2, u4);
  }
  function R(u4, t3, i3) {
    var r3, o3, e3, f5;
    t3 == document && (t3 = document.documentElement), l.__ && l.__(u4, t3), o3 = (r3 = "function" == typeof i3) ? null : i3 && i3.__k || t3.__k, e3 = [], f5 = [], q(t3, u4 = (!r3 && i3 || t3).__k = k(S, null, [u4]), o3 || d, d, t3.namespaceURI, !r3 && i3 ? [i3] : o3 ? null : t3.firstChild ? n.call(t3.childNodes) : null, e3, !r3 && i3 ? i3 : o3 ? o3.__e : t3.firstChild, r3, f5), D(e3, u4, f5), u4.props.children = null;
  }
  function X(n2) {
    function l3(n3) {
      var u4, t3;
      return this.getChildContext || (u4 = /* @__PURE__ */ new Set(), (t3 = {})[l3.__c] = this, this.getChildContext = function() {
        return t3;
      }, this.componentWillUnmount = function() {
        u4 = null;
      }, this.shouldComponentUpdate = function(n4) {
        this.props.value != n4.value && u4.forEach(function(n5) {
          n5.__e = true, A(n5);
        });
      }, this.sub = function(n4) {
        u4.add(n4);
        var l4 = n4.componentWillUnmount;
        n4.componentWillUnmount = function() {
          u4 && u4.delete(n4), l4 && l4.call(n4);
        };
      }), n3.children;
    }
    return l3.__c = "__cC" + y++, l3.__ = n2, l3.Provider = l3.__l = (l3.Consumer = function(n3, l4) {
      return n3.children(l4);
    }).contextType = l3, l3;
  }
  n = w.slice, l = { __e: function(n2, l3, u4, t3) {
    for (var i3, r3, o3; l3 = l3.__; ) if ((i3 = l3.__c) && !i3.__) try {
      if ((r3 = i3.constructor) && null != r3.getDerivedStateFromError && (i3.setState(r3.getDerivedStateFromError(n2)), o3 = i3.__d), null != i3.componentDidCatch && (i3.componentDidCatch(n2, t3 || {}), o3 = i3.__d), o3) return i3.__E = i3;
    } catch (l4) {
      n2 = l4;
    }
    throw n2;
  } }, u = 0, t = function(n2) {
    return null != n2 && void 0 === n2.constructor;
  }, C.prototype.setState = function(n2, l3) {
    var u4;
    u4 = null != this.__s && this.__s != this.state ? this.__s : this.__s = m({}, this.state), "function" == typeof n2 && (n2 = n2(m({}, u4), this.props)), n2 && m(u4, n2), null != n2 && this.__v && (l3 && this._sb.push(l3), A(this));
  }, C.prototype.forceUpdate = function(n2) {
    this.__v && (this.__e = true, n2 && this.__h.push(n2), A(this));
  }, C.prototype.render = S, i = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l3) {
    return n2.__v.__b - l3.__v.__b;
  }, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, a = "__a" + f, s = /(PointerCapture)$|Capture$/i, h = 0, p = V(false), v2 = V(true), y = 0;

  // node_modules/preact/hooks/dist/hooks.module.js
  var t2;
  var r2;
  var u2;
  var i2;
  var o2 = 0;
  var f2 = [];
  var c2 = l;
  var e2 = c2.__b;
  var a2 = c2.__r;
  var v3 = c2.diffed;
  var l2 = c2.__c;
  var m2 = c2.unmount;
  var p2 = c2.__;
  function s2(n2, t3) {
    c2.__h && c2.__h(r2, n2, o2 || t3), o2 = 0;
    var u4 = r2.__H || (r2.__H = { __: [], __h: [] });
    return n2 >= u4.__.length && u4.__.push({}), u4.__[n2];
  }
  function d2(n2) {
    return o2 = 1, y2(D2, n2);
  }
  function y2(n2, u4, i3) {
    var o3 = s2(t2++, 2);
    if (o3.t = n2, !o3.__c && (o3.__ = [i3 ? i3(u4) : D2(void 0, u4), function(n3) {
      var t3 = o3.__N ? o3.__N[0] : o3.__[0], r3 = o3.t(t3, n3);
      t3 !== r3 && (o3.__N = [r3, o3.__[1]], o3.__c.setState({}));
    }], o3.__c = r2, !r2.__f)) {
      var f5 = function(n3, t3, r3) {
        if (!o3.__c.__H) return true;
        var u5 = false, i4 = o3.__c.props !== n3;
        if (o3.__c.__H.__.some(function(n4) {
          if (n4.__N) {
            u5 = true;
            var t4 = n4.__[0];
            n4.__ = n4.__N, n4.__N = void 0, t4 !== n4.__[0] && (i4 = true);
          }
        }), c3) {
          var f6 = c3.call(this, n3, t3, r3);
          return u5 ? f6 || i4 : f6;
        }
        return !u5 || i4;
      };
      r2.__f = true;
      var c3 = r2.shouldComponentUpdate, e3 = r2.componentWillUpdate;
      r2.componentWillUpdate = function(n3, t3, r3) {
        if (this.__e) {
          var u5 = c3;
          c3 = void 0, f5(n3, t3, r3), c3 = u5;
        }
        e3 && e3.call(this, n3, t3, r3);
      }, r2.shouldComponentUpdate = f5;
    }
    return o3.__N || o3.__;
  }
  function h2(n2, u4) {
    var i3 = s2(t2++, 3);
    !c2.__s && C2(i3.__H, u4) && (i3.__ = n2, i3.u = u4, r2.__H.__h.push(i3));
  }
  function _2(n2, u4) {
    var i3 = s2(t2++, 4);
    !c2.__s && C2(i3.__H, u4) && (i3.__ = n2, i3.u = u4, r2.__h.push(i3));
  }
  function A2(n2) {
    return o2 = 5, T2(function() {
      return { current: n2 };
    }, []);
  }
  function T2(n2, r3) {
    var u4 = s2(t2++, 7);
    return C2(u4.__H, r3) && (u4.__ = n2(), u4.__H = r3, u4.__h = n2), u4.__;
  }
  function q2(n2, t3) {
    return o2 = 8, T2(function() {
      return n2;
    }, t3);
  }
  function x2(n2) {
    var u4 = r2.context[n2.__c], i3 = s2(t2++, 9);
    return i3.c = n2, u4 ? (null == i3.__ && (i3.__ = true, u4.sub(r2)), u4.props.value) : n2.__;
  }
  function g2() {
    var n2 = s2(t2++, 11);
    if (!n2.__) {
      for (var u4 = r2.__v; null !== u4 && !u4.__m && null !== u4.__; ) u4 = u4.__;
      var i3 = u4.__m || (u4.__m = [0, 0]);
      n2.__ = "P" + i3[0] + "-" + i3[1]++;
    }
    return n2.__;
  }
  function j2() {
    for (var n2; n2 = f2.shift(); ) {
      var t3 = n2.__H;
      if (n2.__P && t3) try {
        t3.__h.some(z2), t3.__h.some(B2), t3.__h = [];
      } catch (r3) {
        t3.__h = [], c2.__e(r3, n2.__v);
      }
    }
  }
  c2.__b = function(n2) {
    r2 = null, e2 && e2(n2);
  }, c2.__ = function(n2, t3) {
    n2 && t3.__k && t3.__k.__m && (n2.__m = t3.__k.__m), p2 && p2(n2, t3);
  }, c2.__r = function(n2) {
    a2 && a2(n2), t2 = 0;
    var i3 = (r2 = n2.__c).__H;
    i3 && (u2 === r2 ? (i3.__h = [], r2.__h = [], i3.__.some(function(n3) {
      n3.__N && (n3.__ = n3.__N), n3.u = n3.__N = void 0;
    })) : (i3.__h.some(z2), i3.__h.some(B2), i3.__h = [], t2 = 0)), u2 = r2;
  }, c2.diffed = function(n2) {
    v3 && v3(n2);
    var t3 = n2.__c;
    t3 && t3.__H && (t3.__H.__h.length && (1 !== f2.push(t3) && i2 === c2.requestAnimationFrame || ((i2 = c2.requestAnimationFrame) || w2)(j2)), t3.__H.__.some(function(n3) {
      n3.u && (n3.__H = n3.u, n3.u = void 0);
    })), u2 = r2 = null;
  }, c2.__c = function(n2, t3) {
    t3.some(function(n3) {
      try {
        n3.__h.some(z2), n3.__h = n3.__h.filter(function(n4) {
          return !n4.__ || B2(n4);
        });
      } catch (r3) {
        t3.some(function(n4) {
          n4.__h && (n4.__h = []);
        }), t3 = [], c2.__e(r3, n3.__v);
      }
    }), l2 && l2(n2, t3);
  }, c2.unmount = function(n2) {
    m2 && m2(n2);
    var t3, r3 = n2.__c;
    r3 && r3.__H && (r3.__H.__.some(function(n3) {
      try {
        z2(n3);
      } catch (n4) {
        t3 = n4;
      }
    }), r3.__H = void 0, t3 && c2.__e(t3, r3.__v));
  };
  var k2 = "function" == typeof requestAnimationFrame;
  function w2(n2) {
    var t3, r3 = function() {
      clearTimeout(u4), k2 && cancelAnimationFrame(t3), setTimeout(n2);
    }, u4 = setTimeout(r3, 35);
    k2 && (t3 = requestAnimationFrame(r3));
  }
  function z2(n2) {
    var t3 = r2, u4 = n2.__c;
    "function" == typeof u4 && (n2.__c = void 0, u4()), r2 = t3;
  }
  function B2(n2) {
    var t3 = r2;
    n2.__c = n2.__(), r2 = t3;
  }
  function C2(n2, t3) {
    return !n2 || n2.length !== t3.length || t3.some(function(t4, r3) {
      return t4 !== n2[r3];
    });
  }
  function D2(n2, t3) {
    return "function" == typeof t3 ? t3(n2) : t3;
  }

  // src/panel/format.ts
  function ago(ms) {
    const s3 = Math.floor(Math.max(0, ms) / 1e3);
    if (s3 < 5) return "just now";
    if (s3 < 60) return `${s3}s ago`;
    const m3 = Math.floor(s3 / 60);
    if (m3 < 60) return `${m3}m ago`;
    const h4 = Math.floor(m3 / 60);
    if (h4 < 24) return `${h4}h ago`;
    const d3 = Math.floor(h4 / 24);
    if (d3 < 7) return `${d3}d ago`;
    return `${Math.floor(d3 / 7)}w ago`;
  }
  function shortAgo(ms) {
    const m3 = Math.floor(Math.max(0, ms) / 6e4);
    if (m3 < 1) return "now";
    if (m3 < 60) return `${m3}m`;
    const h4 = Math.floor(m3 / 60);
    if (h4 < 24) return `${h4}h`;
    const d3 = Math.floor(h4 / 24);
    if (d3 < 7) return `${d3}d`;
    return `${Math.floor(d3 / 7)}w`;
  }
  var DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
  var isDateOnly = (text2) => DATE_ONLY.test(text2);
  function recordedDate(text2) {
    const m3 = DATE_ONLY.exec(text2);
    if (m3) return new Date(Number(m3[1]), Number(m3[2]) - 1, Number(m3[3]));
    const t3 = Date.parse(text2);
    return Number.isFinite(t3) ? new Date(t3) : null;
  }
  var utc = (options) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
  var MONTH_DAY = utc({ month: "short", day: "numeric" });
  var MONTH_DAY_YEAR = utc({ month: "short", day: "numeric", year: "numeric" });
  var TIME = utc({ hour: "numeric", minute: "2-digit" });
  var FULL = utc({ month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  var wallClock = (d3) => Date.UTC(d3.getFullYear(), d3.getMonth(), d3.getDate(), d3.getHours(), d3.getMinutes());
  var dayText = (date, now) => (date.getFullYear() === new Date(now).getFullYear() ? MONTH_DAY : MONTH_DAY_YEAR).format(wallClock(date));
  var timeText = (date) => TIME.format(wallClock(date));
  var fullText = (date) => FULL.format(wallClock(date));
  function personName(name, panel2) {
    if (!name) return "unknown";
    return panel2 !== null && name === panel2 ? "you (panel)" : name;
  }
  var folderName = (directory2) => directory2.split(/[\\/]/).filter(Boolean).pop() ?? directory2;
  function initials(name) {
    const words = name.replace(/\(.*?\)/g, " ").trim().split(/[\s._@-]+/).filter(Boolean);
    return words.slice(0, 2).map((w4) => w4[0].toUpperCase()).join("");
  }

  // src/panel/list.ts
  var BUILT_IN = /* @__PURE__ */ new Map([
    ["open", "open"],
    ["in_progress", "progress"],
    ["blocked", "blocked"],
    ["deferred", "deferred"],
    ["closed", "done"]
  ]);
  var BY_CATEGORY = /* @__PURE__ */ new Map([
    ["active", "open"],
    ["wip", "progress"],
    ["frozen", "deferred"],
    ["done", "done"]
  ]);
  var isBuiltIn = (status) => BUILT_IN.has(status);
  var BEADS_EXTRA = /* @__PURE__ */ new Set(["pinned", "hooked"]);
  var markerOf = (status) => isBuiltIn(status) ? "builtin" : BEADS_EXTRA.has(status) ? "beads" : "custom";
  function looker(statuses) {
    const categories = new Map(statuses.map((s3) => [s3.name, s3.category]));
    return (status) => BUILT_IN.get(status) ?? BY_CATEGORY.get(categories.get(status) ?? "") ?? "other";
  }
  var STATUS_WORDS = /* @__PURE__ */ new Map([
    ["open", "Open"],
    ["in_progress", "In progress"],
    ["blocked", "Blocked"],
    ["deferred", "Deferred"],
    ["closed", "Closed"],
    ["pinned", "Pinned"],
    ["hooked", "Hooked"]
  ]);
  var ACRONYMS = /* @__PURE__ */ new Set(["qa", "ui", "ux", "pr", "api", "ci", "cd", "sla", "mvp", "uat"]);
  function humanize(name) {
    const words = name.split(/[_-]+/).filter(Boolean);
    if (words.length === 0) return name;
    return words.map((w4, i3) => ACRONYMS.has(w4.toLowerCase()) ? w4.toUpperCase() : i3 === 0 ? w4[0].toUpperCase() + w4.slice(1) : w4).join(" ");
  }
  function statusLabel(status, statuses) {
    const word = STATUS_WORDS.get(status);
    if (word) return word;
    return statuses.some((s3) => s3.name === status) ? humanize(status) : status;
  }
  function shortId(id) {
    const dot = id.indexOf(".");
    const base = dot < 0 ? id : id.slice(0, dot);
    const dash = base.lastIndexOf("-");
    return dash > 0 && dash < base.length - 1 ? id.slice(dash + 1) : id;
  }
  var childId = (id, rootId) => id.startsWith(`${rootId}.`) ? id.slice(rootId.length) : shortId(id);
  function compareIds(a5, b2) {
    const pa = a5.split(".");
    const pb = b2.split(".");
    for (let i3 = 0; i3 < Math.min(pa.length, pb.length); i3++) {
      if (pa[i3] === pb[i3]) continue;
      const na = Number(pa[i3]);
      const nb = Number(pb[i3]);
      if (pa[i3] !== "" && pb[i3] !== "" && Number.isInteger(na) && Number.isInteger(nb)) return na - nb;
      return pa[i3] < pb[i3] ? -1 : 1;
    }
    return pa.length - pb.length;
  }
  var rank = (b2) => b2.priority ?? 5;
  var byPriority = (a5, b2) => rank(a5) - rank(b2) || compareIds(a5.id, b2.id);
  var WEEK_MS = 7 * 864e5;
  function recent(b2, now) {
    const at2 = Date.parse(b2.closedAt ?? b2.updatedAt);
    return Number.isFinite(at2) && now - at2 <= WEEK_MS;
  }
  var closedAt = (b2) => Date.parse(b2.closedAt ?? b2.updatedAt) || 0;
  var byNewestClose = (a5, b2) => closedAt(b2) - closedAt(a5) || compareIds(a5.id, b2.id);
  function deferredUntilLater(b2, now) {
    const until = b2.extra.defer_until;
    if (typeof until !== "string") return false;
    const at2 = Date.parse(until);
    return Number.isFinite(at2) && at2 > now;
  }
  var OWN_SECTION = /* @__PURE__ */ new Set(["in_progress", "blocked", "deferred", "closed"]);
  function classifier({ statuses, readyIds, now }) {
    const look = looker(statuses);
    const ready = new Set(readyIds);
    return (b2) => {
      if (b2.status === "open") {
        if (deferredUntilLater(b2, now)) return { bucket: "deferred", look: "deferred", label: "Deferred until later", marker: "builtin", filterAs: "deferred" };
        if (!ready.has(b2.id)) return { bucket: "blocked", look: "blocked", label: "Waiting on another bead", marker: "builtin", filterAs: "blocked" };
        return { bucket: "ready", look: "open", label: "Open", marker: "builtin", filterAs: "open" };
      }
      const bucket = OWN_SECTION.has(b2.status) ? b2.status : `other:${b2.status}`;
      return { bucket, look: look(b2.status), label: statusLabel(b2.status, statuses), marker: markerOf(b2.status), filterAs: b2.status };
    };
  }
  function dueMatches(b2, filter, done, now) {
    const due = typeof b2.extra.due_at === "string" ? Date.parse(b2.extra.due_at) : NaN;
    if (done || !Number.isFinite(due)) return false;
    return filter === "overdue" ? due < now : due >= now && due <= now + WEEK_MS;
  }
  function prepare(input) {
    const classify = classifier(input);
    const ready = new Set(input.readyIds);
    const q4 = input.query.trim().toLowerCase();
    const { status, assignee, priorities } = input.filters;
    const passes = (b2) => {
      if (status === "open" ? classify(b2).look === "done" && !recent(b2, input.now) : status !== "all" && !status.only.includes(classify(b2).filterAs)) return false;
      if (assignee === "unassigned" ? !!b2.assignee : assignee !== "any" && b2.assignee !== assignee.name) return false;
      if (priorities.length > 0 && (b2.priority === null || !priorities.includes(b2.priority))) return false;
      if (input.filters.ready && !ready.has(b2.id)) return false;
      if (input.filters.due !== "any" && !dueMatches(b2, input.filters.due, classify(b2).look === "done", input.now)) return false;
      return q4 === "" || b2.id.toLowerCase().includes(q4) || b2.title.toLowerCase().includes(q4);
    };
    const byId = new Map(input.beads.map((b2) => [b2.id, b2]));
    const kids = /* @__PURE__ */ new Map();
    for (const b2 of input.beads) {
      if (!b2.parentId || b2.parentId === b2.id || !byId.has(b2.parentId)) continue;
      const list = kids.get(b2.parentId);
      if (list) list.push(b2);
      else kids.set(b2.parentId, [b2]);
    }
    for (const list of kids.values()) list.sort((a5, b2) => compareIds(a5.id, b2.id));
    return { input, classify, passes, unseen: new Set(input.unseenIds), searching: q4 !== "", byId, kids };
  }
  function nearestEpic(b2, byId) {
    let parent = b2.parentId ? byId.get(b2.parentId) : void 0;
    for (let hops = 0; parent && hops < 64; hops++) {
      if (parent.type === "epic") return parent;
      parent = parent.parentId ? byId.get(parent.parentId) : void 0;
    }
    return null;
  }
  function row(p3, bead, id, depth, context) {
    const c3 = p3.classify(bead);
    const children = p3.kids.get(bead.id) ?? [];
    return {
      bead,
      id,
      depth,
      look: c3.look,
      label: c3.label,
      marker: c3.marker,
      unseen: p3.unseen.has(bead.id),
      context,
      epic: null,
      sub: children.length ? { done: children.filter((k3) => p3.classify(k3).look === "done").length, total: children.length } : null
    };
  }
  function epicView(input) {
    const p3 = prepare(input);
    const { kids } = p3;
    const roots = input.beads.filter((b2) => !b2.parentId || b2.parentId === b2.id || !p3.byId.has(b2.parentId));
    const below = (id, seen = /* @__PURE__ */ new Set([id])) => {
      const out = [];
      for (const child of kids.get(id) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        out.push(child, ...below(child.id, seen));
      }
      return out;
    };
    const reached = /* @__PURE__ */ new Set();
    for (const r3 of roots) {
      reached.add(r3.id);
      for (const d3 of below(r3.id)) reached.add(d3.id);
    }
    for (const b2 of input.beads) {
      if (reached.has(b2.id)) continue;
      roots.push(b2);
      reached.add(b2.id);
      for (const d3 of below(b2.id)) reached.add(d3.id);
    }
    const subtree = (parent, depth, rootId, seen) => {
      const out = [];
      for (const child of kids.get(parent.id) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        const rows = subtree(child, depth + 1, rootId, seen);
        const ok = p3.passes(child);
        if (ok || rows.length) out.push(row(p3, child, childId(child.id, rootId), depth, !ok), ...rows);
      }
      return out;
    };
    const isCollapsed = (key) => !p3.searching && input.collapsed.includes(key);
    const done = (b2) => p3.classify(b2).look === "done";
    const doneLast = (a5, b2) => Number(done(a5)) - Number(done(b2)) || byPriority(a5, b2);
    const groups = [];
    for (const epic of roots.filter((b2) => b2.type === "epic").sort(doneLast)) {
      const rows = subtree(epic, 1, epic.id, /* @__PURE__ */ new Set([epic.id]));
      const ok = p3.passes(epic);
      if (!ok && rows.length === 0) continue;
      const all = below(epic.id);
      const progress = { total: all.length, done: 0, inProgress: 0, blocked: 0 };
      for (const b2 of all) {
        const look = p3.classify(b2).look;
        if (look === "done") progress.done++;
        else if (look === "progress") progress.inProgress++;
        else if (look === "blocked") progress.blocked++;
      }
      const key = `epic:${epic.id}`;
      const collapsed = isCollapsed(key);
      groups.push({
        key,
        epic,
        look: p3.classify(epic).look,
        context: !ok,
        unseen: p3.unseen.has(epic.id),
        progress,
        changed: all.filter((b2) => p3.unseen.has(b2.id)).length,
        count: rows.filter((r3) => !r3.context).length,
        collapsed,
        rows: collapsed ? [] : rows
      });
    }
    const orphanRows = [];
    for (const root2 of roots.filter((b2) => b2.type !== "epic").sort(doneLast)) {
      const rows = subtree(root2, 1, root2.id, /* @__PURE__ */ new Set([root2.id]));
      const ok = p3.passes(root2);
      if (ok || rows.length) orphanRows.push(row(p3, root2, shortId(root2.id), 0, !ok), ...rows);
    }
    if (orphanRows.length > 0) {
      const collapsed = isCollapsed("epic:none");
      groups.push({
        key: "epic:none",
        epic: null,
        look: "open",
        context: false,
        unseen: false,
        progress: null,
        changed: orphanRows.filter((r3) => r3.unseen).length,
        count: orphanRows.filter((r3) => !r3.context).length,
        collapsed,
        rows: collapsed ? [] : orphanRows
      });
    }
    return groups;
  }
  var CAP = 8;
  var SHOW = 6;
  var BUCKETS = [
    { id: "in_progress", title: "In progress", look: "progress" },
    { id: "blocked", title: "Blocked", look: "blocked" },
    { id: "ready", title: "Ready", look: "open" },
    { id: "deferred", title: "Deferred", look: "deferred" },
    { id: "closed", title: "Closed", look: "done" }
  ];
  var CATEGORY_ORDER = ["wip", "active", "frozen", "done"];
  function statusView(input) {
    const p3 = prepare(input);
    const limited = input.filters.status === "open";
    const members = /* @__PURE__ */ new Map();
    for (const b2 of input.beads) {
      if (!p3.passes(b2)) continue;
      const id = p3.classify(b2).bucket;
      const list = members.get(id);
      if (list) list.push(b2);
      else members.set(id, [b2]);
    }
    const order = new Map(input.statuses.map((s3, i3) => [s3.name, i3]));
    const categories = new Map(input.statuses.map((s3) => [s3.name, s3.category]));
    const categoryRank = (name) => {
      const i3 = CATEGORY_ORDER.indexOf(categories.get(name) ?? "");
      return i3 < 0 ? CATEGORY_ORDER.length : i3;
    };
    const custom = [...members.keys()].filter((id) => id.startsWith("other:")).map((id) => id.slice("other:".length)).sort((a5, b2) => categoryRank(a5) - categoryRank(b2) || (order.get(a5) ?? Infinity) - (order.get(b2) ?? Infinity) || (a5 < b2 ? -1 : 1));
    const look = looker(input.statuses);
    const defs = [
      ...BUCKETS.map((b2) => ({ ...b2, title: b2.id === "closed" && limited ? "Closed (last 7 days)" : b2.title, status: null, marker: "builtin" })),
      ...custom.map((name) => {
        const l3 = look(name);
        const label = statusLabel(name, input.statuses);
        return { id: `other:${name}`, title: l3 === "done" && limited ? `${label} (last 7 days)` : label, look: l3, status: name, marker: markerOf(name) };
      })
    ];
    const sections = [];
    for (const def of defs) {
      const beads = members.get(def.id);
      if (!beads) continue;
      beads.sort(def.look === "done" ? byNewestClose : byPriority);
      const key = `status:${def.id}`;
      const collapsed = !p3.searching && input.collapsed.includes(key);
      const capped = !p3.searching && beads.length > CAP && !(input.expanded ?? []).includes(key);
      const shown = collapsed ? [] : capped ? beads.slice(0, SHOW) : beads;
      sections.push({
        key,
        title: def.title,
        status: def.status,
        look: def.look,
        marker: def.marker,
        count: beads.length,
        changed: beads.filter((b2) => p3.unseen.has(b2.id)).length,
        collapsed,
        rows: shown.map((b2) => ({ ...row(p3, b2, shortId(b2.id), 0, false), epic: nearestEpic(b2, p3.byId) })),
        more: collapsed || !capped ? 0 : beads.length - SHOW
      });
    }
    return sections;
  }
  var rowOrder = (groups) => groups.flatMap((g3) => [...g3.epic ? [g3.epic.id] : [], ...g3.rows.map((r3) => r3.bead.id)]);
  function totals(input) {
    const classify = classifier(input);
    const t3 = { open: 0, inProgress: 0, blocked: 0, closedThisWeek: 0 };
    for (const b2 of input.beads) {
      const c3 = classify(b2);
      if (c3.look === "done") {
        if (recent(b2, input.now)) t3.closedThisWeek++;
        continue;
      }
      t3.open++;
      if (c3.bucket === "in_progress") t3.inProgress++;
      if (c3.bucket === "blocked") t3.blocked++;
    }
    return t3;
  }
  function matchesWithAll(input) {
    const p3 = prepare({ ...input, filters: { ...input.filters, status: "all" } });
    return input.beads.some(p3.passes);
  }

  // src/panel/agent.ts
  var SYNC_ITEM = ":sync";
  var HOST_SAID_SO = "Could not start that session.";
  function failedStart(result, wanted) {
    const name = result.worktree.name || folderName(result.worktree.directory);
    if (!wanted) return "The session couldn't be started.";
    if (result.failure === "bootstrap-failed") {
      return `The worktree ${name} was made, but its setup didn't finish, so no session started. Open the worktree from the sidebar instead of starting again.`;
    }
    return `The worktree ${name} was made, but the session couldn't be created. Open the worktree from the sidebar instead of starting again.`;
  }
  function createAgent({ client: client2, host: host2, store }) {
    let state = { session: null, busy: null, sheet: null };
    const listeners = /* @__PURE__ */ new Set();
    const set = (patch) => {
      state = { ...state, ...patch };
      listeners.forEach((l3) => l3());
    };
    let generation = store.get().generation;
    store.subscribe(() => {
      const next = store.get().generation;
      if (next === generation) return;
      generation = next;
      if (state.sheet) set({ sheet: null });
    });
    const toast = (kind, message, copy) => host2.toast({ kind, message: message.slice(0, TOAST_MAX), ...copy ? { copy: { text: copy.slice(0, COPY_MAX) } } : {} }).catch(() => {
    });
    const beadSource = (id) => ({ read: (directory2) => client2.context({ directory: directory2, id }), name: shortId(id), noun: "the bead" });
    const syncSource = { read: (directory2) => client2.conflictContext({ directory: directory2 }), name: "the sync details", noun: "the sync details", sync: true };
    async function chip(source) {
      const { directory: directory2, generation: generation2 } = store.get();
      if (directory2 === null) return null;
      try {
        const context = await source.read(directory2);
        if (store.get().generation !== generation2) return null;
        return attachPayload(context, directory2, source.sync === true);
      } catch (thrown) {
        if (store.get().generation !== generation2) return null;
        const error = asRequestError(thrown);
        toast("error", `Couldn't read ${source.name}. ${error.message}`, error.detail);
        return null;
      }
    }
    async function run(busy, work) {
      if (state.busy) return;
      set({ busy });
      try {
        await work();
      } finally {
        set({ busy: null });
      }
    }
    async function start(id, source, kind, worktree) {
      await run({ id, kind }, async () => {
        const payload = await chip(source);
        if (!payload) return;
        const { text: text2, ...linked } = payload;
        let result;
        try {
          result = await host2.startSession({ ...linked, ...worktree ? { worktree } : {}, navigation: "open" });
        } catch (thrown) {
          const error = asRequestError(thrown);
          if (error.code === "HOST_REJECTED" && error.detail === HOST_SAID_SO) return;
          if (error.code === "HOST_TIMEOUT") {
            const after = worktree ? "A worktree may already exist: check the sidebar before trying again." : "It may still appear in the sidebar.";
            toast("error", `The session didn't start in time. ${after}`, error.detail);
            return;
          }
          const lead = `The session couldn't be started. ${error.message}`;
          toast("error", worktree ? `${lead} A worktree may already exist: check the sidebar before trying again.` : lead, error.detail);
          return;
        }
        if (result.sessionId === null) {
          toast("error", failedStart(result, worktree !== void 0), result.worktree.directory);
          return;
        }
        if (result.linked === false) toast("info", `Session started, but the link to ${source.noun} wasn't saved.`);
        if (worktree) return;
        await host2.attach({ ...linked, ...text2 ? { text: text2 } : {} }).catch(() => toast("error", `The session started, but ${source.noun} couldn't be added to its chat.`));
      });
    }
    function attach(id, source, added) {
      return run({ id, kind: "attach" }, async () => {
        const payload = await chip(source);
        if (!payload) return;
        try {
          await host2.attach(payload);
          toast("success", `Added ${added} to the chat.`);
        } catch (thrown) {
          const error = asRequestError(thrown);
          toast("error", `Couldn't add ${added} to the chat. ${error.message}`, error.detail);
        }
      });
    }
    return {
      get: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setSession(session) {
        set({ session });
      },
      attach(id) {
        return attach(id, beadSource(id), shortId(id));
      },
      startSession(id) {
        return start(id, beadSource(id), "session");
      },
      attachSync() {
        return attach(SYNC_ITEM, syncSource, "the sync details");
      },
      startSyncSession() {
        return start(SYNC_ITEM, syncSource, "session");
      },
      askWorktree(id) {
        if (state.busy) return;
        const bead = store.get().snapshot?.beads.find((b2) => b2.id === id);
        const title = bead?.title ?? id;
        set({ sheet: { id, title, name: worktreeName(id, title) } });
      },
      cancelWorktree() {
        if (state.sheet && state.busy?.kind !== "worktree") set({ sheet: null });
      },
      async startInWorktree(name, baseBranch) {
        const sheet = state.sheet;
        if (!sheet) return;
        const base = baseBranch?.trim();
        await start(sheet.id, beadSource(sheet.id), "worktree", { kind: "new", name, ...base ? { baseBranch: base } : {} });
        set({ sheet: null });
      }
    };
  }
  var AgentContext = X(null);
  var IDLE = { session: null, busy: null, sheet: null };
  var useAgent = () => x2(AgentContext);
  function useAgentState() {
    const agent = useAgent();
    const [, setVersion] = d2(0);
    h2(() => {
      if (!agent) return;
      const bump = () => setVersion((v5) => v5 + 1);
      const stop = agent.subscribe(bump);
      bump();
      return stop;
    }, [agent]);
    return agent?.get() ?? IDLE;
  }

  // src/shared/related.ts
  function relatedFor(bead, all) {
    const byId = new Map(all.map((other) => [other.id, other]));
    const parent = bead.parentId === null ? null : byId.get(bead.parentId) ?? null;
    const children = all.filter((other) => other.parentId === bead.id && other.id !== bead.id);
    const deps = [];
    for (const dep of bead.dependencies) {
      if (dep.kind !== "parent-child") deps.push({ dep, other: byId.get(dep.to) ?? null, direction: "out" });
    }
    for (const other of all) {
      if (other.id === bead.id) continue;
      for (const dep of other.dependencies) {
        if (dep.to === bead.id && dep.kind !== "parent-child") deps.push({ dep, other, direction: "in" });
      }
    }
    return { parent, children, deps };
  }

  // src/shared/gates.ts
  var PLAN_APPROVAL_REASON = "Approve the plan before work starts";
  var REVIEW_REASON = "Review before closing";

  // src/panel/dates.ts
  var localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  var formatters = /* @__PURE__ */ new Map();
  function parts(zone) {
    let f5 = formatters.get(zone);
    if (!f5) {
      f5 = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
      formatters.set(zone, f5);
    }
    return f5;
  }
  function wallAt(ms, zone) {
    const get = {};
    for (const p3 of parts(zone).formatToParts(new Date(ms))) get[p3.type] = p3.value;
    return {
      year: Number(get.year),
      month: Number(get.month),
      day: Number(get.day),
      hour: Number(get.hour) % 24,
      minute: Number(get.minute),
      second: Number(get.second),
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get.weekday ?? "")
    };
  }
  function offsetAt(ms, zone) {
    const w4 = wallAt(ms, zone);
    return Date.UTC(w4.year, w4.month - 1, w4.day, w4.hour, w4.minute, w4.second) - Math.floor(ms / 1e3) * 1e3;
  }
  function instantOf(y4, mo, d3, h4, mi, s3, zone) {
    const asUtc = Date.UTC(y4, mo - 1, d3, h4, mi, s3);
    return asUtc - offsetAt(asUtc - offsetAt(asUtc, zone), zone);
  }
  var DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z?)$/;
  var RELATIVE_RE = /^\+(\d{1,4})([dwh])$/;
  var NEXT_RE = /^next ([a-z]+)$/;
  function realDay(y4, m3, d3) {
    const t3 = new Date(Date.UTC(y4, m3 - 1, d3));
    return t3.getUTCFullYear() === y4 && t3.getUTCMonth() === m3 - 1 && t3.getUTCDate() === d3;
  }
  function labelFor(ms, now, zone, dayOnly) {
    const base = { timeZone: zone, weekday: "short", month: "short", day: "numeric" };
    const sameYear = wallAt(ms, zone).year === wallAt(now, zone).year;
    const options = { ...base, ...sameYear ? {} : { year: "numeric" }, ...dayOnly ? {} : { hour: "numeric", minute: "2-digit" } };
    return new Intl.DateTimeFormat("en-US", options).format(new Date(ms));
  }
  function dateLabel(ms, now, zone = localZone()) {
    try {
      const w4 = wallAt(ms, zone);
      return labelFor(ms, now, zone, w4.hour === 0 && w4.minute === 0 && w4.second === 0);
    } catch {
      return new Date(ms).toISOString();
    }
  }
  function daysFromNow(now, days, zone) {
    const w4 = wallAt(now, zone);
    const moved = new Date(Date.UTC(w4.year, w4.month - 1, w4.day + days, w4.hour, w4.minute, w4.second));
    return instantOf(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate(), w4.hour, w4.minute, w4.second, zone);
  }
  function parseDateInput(text2, now, zone) {
    const raw = text2.trim();
    if (raw === "") return { kind: "unknown" };
    try {
      const ok = (at2, dayOnly = false) => ({ kind: "ok", at: new Date(at2), label: labelFor(at2, now, zone, dayOnly) });
      const clock = Math.floor(now / 1e3) * 1e3;
      const lower = raw.toLowerCase();
      if (lower === "tomorrow") return ok(daysFromNow(clock, 1, zone));
      const next = NEXT_RE.exec(lower);
      if (next) {
        const target = WEEKDAYS.indexOf(next[1]);
        if (target < 0) return { kind: "unknown" };
        const ahead = (target - wallAt(clock, zone).weekday + 7) % 7 || 7;
        return ok(daysFromNow(clock, ahead, zone));
      }
      const relative = RELATIVE_RE.exec(raw);
      if (relative) {
        const n2 = Number(relative[1]);
        if (relative[2] === "h") return ok(clock + n2 * 36e5);
        return ok(daysFromNow(clock, relative[2] === "w" ? n2 * 7 : n2, zone));
      }
      const day = DAY_RE.exec(raw);
      if (day) {
        const [y4, m3, d3] = [Number(day[1]), Number(day[2]), Number(day[3])];
        return realDay(y4, m3, d3) ? ok(instantOf(y4, m3, d3, 0, 0, 0, zone), true) : { kind: "unknown" };
      }
      const time = DATETIME_RE.exec(raw);
      if (time) {
        const [y4, m3, d3, h4, mi, s3] = time.slice(1, 7).map(Number);
        if (!realDay(y4, m3, d3) || h4 > 23 || mi > 59 || s3 > 59) return { kind: "unknown" };
        return ok(time[7] === "Z" ? Date.UTC(y4, m3 - 1, d3, h4, mi, s3) : instantOf(y4, m3, d3, h4, mi, s3, zone));
      }
    } catch {
    }
    return { kind: "unknown" };
  }

  // src/panel/gates.ts
  function gateWord(gate, count = 1) {
    const [one, many] = WORDS[gate.kind === "human" && gate.planApproval ? "plan" : gate.kind] ?? WORDS.other;
    return count > 1 ? `${count} ${many}` : one;
  }
  var WORDS = {
    human: ["a review", "reviews"],
    // Counted like the rest: two plan-approval gates are two approvals someone has to give.
    plan: ["plan approval", "plan approvals"],
    timer: ["a timer", "timers"],
    "gh:run": ["a GitHub check", "GitHub checks"],
    "gh:pr": ["a GitHub PR", "GitHub PRs"],
    bead: ["another bead", "other beads"],
    other: ["an outside check", "outside checks"]
  };
  function gateLabel(gate) {
    switch (gate.kind) {
      case "human":
        return gate.planApproval ? "Plan approval" : "Review";
      case "timer":
        return "Timer";
      case "gh:run":
        return "GitHub run";
      case "gh:pr":
        return "GitHub pull request";
      case "bead":
        return "Bead";
      default:
        return "Check";
    }
  }
  function familyOf(kind, reason) {
    if (kind === "human") return reason?.startsWith(PLAN_APPROVAL_REASON) ? "plan" : "review";
    if (kind === "timer") return "timer";
    if (kind === "gh:run" || kind === "gh:pr") return "github";
    return "other";
  }
  var GATE_EVENTS = {
    review: { requested: "Review requested", resolved: "Review resolved", deleted: "Review deleted", unlinked: "Review removed from this bead" },
    plan: { requested: "Plan approval requested", resolved: "Plan approved", deleted: "Plan approval deleted", unlinked: "Plan approval removed from this bead" },
    timer: { requested: "Timer set", resolved: "Timer ended", deleted: "Timer deleted", unlinked: "Timer removed from this bead" },
    github: { requested: "GitHub check added", resolved: "GitHub check cleared", deleted: "GitHub check deleted", unlinked: "GitHub check removed from this bead" },
    other: { requested: "Check added", resolved: "Check cleared", deleted: "Check deleted", unlinked: "Check removed from this bead" }
  };
  function gateEventWords(e3) {
    const family = familyOf(e3.gateKind, e3.reason);
    const head = GATE_EVENTS[family][e3.what];
    if (e3.what !== "resolved" || e3.byPanel) return { head, by: null };
    const people = family === "review" || family === "plan";
    return { head, by: e3.actor ?? (people ? "someone else" : null) };
  }
  var gateEventOf = (e3) => ({
    what: e3.kind === "gate_opened" ? "requested" : e3.ended ?? "resolved",
    gateKind: e3.gateKind,
    reason: e3.reason,
    byPanel: e3.byPanel,
    actor: e3.actor
  });
  var gatesOn = (bead, gates) => gates.filter((g3) => g3.blocks.includes(bead.id));
  var LISTED = 3;
  var SHOWN = 2;
  function waitItems(waits) {
    const counts = /* @__PURE__ */ new Map();
    for (const gate of waits.gates) {
      const key = gateWord(gate);
      const seen = counts.get(key);
      if (seen) seen.n++;
      else counts.set(key, { gate, n: 1 });
    }
    const all = [...[...counts.values()].map(({ gate, n: n2 }) => ({ kind: "gate", word: gateWord(gate, n2) })), ...waits.beads.map((b2) => ({ kind: "bead", id: b2.id, title: b2.title }))];
    const shown = all.length > LISTED ? all.slice(0, SHOWN) : all;
    const rest = all.length - shown.length;
    const last = shown.length - 1;
    return {
      items: shown.map((item, i3) => ({ sep: i3 === 0 ? "" : i3 === last && rest === 0 ? " and " : ", ", item })),
      more: rest > 0 ? ` and ${rest} more` : ""
    };
  }
  var beadName = (b2) => `${shortId(b2.id)} ${b2.title}`.trim();
  function waitsText(waits) {
    const { items, more } = waitItems(waits);
    if (items.length === 0) return "waiting on something that is not done";
    return `waiting on ${items.map(({ sep, item }) => sep + (item.kind === "gate" ? item.word : beadName(item))).join("")}${more}`;
  }
  var blockedText = (bead, gates, blockers = []) => waitsText({ gates: gatesOn(bead, gates), beads: blockers });
  function waitsOf(bead, explain, gates, gateIds = [], links = []) {
    const isGate = (id) => gateIds.includes(id) || gates.some((g3) => g3.id === id);
    const own = gatesOn(bead, gates);
    const beads = explain?.state === "blocked" ? explain.blockers.filter((b2) => !isGate(b2.id) && b2.status !== "closed") : links.filter((b2) => !isGate(b2.id));
    return own.length > 0 || beads.length > 0 ? { gates: own, beads } : null;
  }
  function dayIn(ms, zone) {
    const parts2 = new Map(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map((p3) => [p3.type, p3.value]));
    return `${parts2.get("year")}-${parts2.get("month")}-${parts2.get("day")}`;
  }
  function whyLine(bead, explain, gates, now = Date.now(), zone = localZone(), gateIds = []) {
    if (explain?.state === "blocked") {
      const waits = waitsOf(bead, explain, gates, gateIds);
      if (waits) return sentence(waitsText(waits));
      return explain.blockers.length === 0 ? "Waiting on something that is not done" : null;
    }
    if (explain === null && gatesOn(bead, gates).length > 0) return sentence(blockedText(bead, gates));
    if (explain?.state === "ready") return "Ready to start";
    if (typeof bead.extra.defer_until === "string") {
      const until = Date.parse(bead.extra.defer_until);
      if (Number.isFinite(until) && until > now) return `Snoozed until ${dayIn(until, zone)}`;
    }
    if (bead.status === "deferred") return "Snoozed with no date";
    return null;
  }
  var sentence = (text2) => text2.charAt(0).toUpperCase() + text2.slice(1);
  var COMMENT_ADDED = "Your comment was added, but the bead could not be closed. ";
  var PART_SAVED = " Part of your change was saved.";
  var WAITS = /still blocked by|still waiting on|is waiting on a review/;
  function blockedMessage(message, bead, gates, blockers = []) {
    const own = gatesOn(bead, gates);
    if (own.length === 0 || !WAITS.test(message)) return message;
    const prefix = message.startsWith(COMMENT_ADDED) ? COMMENT_ADDED : "";
    const suffix = message.endsWith(PART_SAVED) ? PART_SAVED : "";
    const what = message.slice(prefix.length).startsWith("This request") ? "request" : "bead";
    const people = own.every((g3) => g3.kind === "human");
    const advice = blockers.length > 0 || !people ? "" : own.every((g3) => g3.planApproval) ? " Approve the plan first." : own.length > 1 ? " Resolve them first." : " Resolve the review first.";
    return `${prefix}This ${what} can't be closed yet. It is ${blockedText(bead, gates, blockers)}.${advice}${suffix}`;
  }
  function gateState(gate, now, panel2) {
    const at2 = Date.parse(gate.createdAt);
    const since = Number.isFinite(at2) ? `${shortAgo(now - at2)} ago` : "";
    const who = gate.createdBy ? personName(gate.createdBy, panel2) : null;
    const opened = (verb) => [who ? `${verb} by ${who}` : verb, since].filter(Boolean).join(who ? ", " : " ");
    if (gate.kind === "human") return opened("Asked");
    if (gate.kind === "timer" && gate.timeoutMs !== null && Number.isFinite(at2)) {
      const left = at2 + gate.timeoutMs - now;
      if (left <= 0) return "Time is up. Beads clears it on its next check";
      return `Ends in ${shortAgo(left)}. ${opened("Set")}`;
    }
    if (gate.kind === "gh:run" || gate.kind === "gh:pr") return `Beads checks GitHub for it. ${opened("Set")}`;
    return opened("Set");
  }

  // src/panel/detail.ts
  var DAY_MS = 864e5;
  var SKEW_MS = 12e4;
  function when(text2, now) {
    const at2 = Date.parse(text2);
    if (!Number.isFinite(at2)) return text2;
    if (at2 - now < SKEW_MS && now - at2 < DAY_MS) return ago(now - at2);
    const date = new Date(at2);
    return `${dayText(date, now)}, ${timeText(date)}`;
  }
  function recordedDay(text2, now) {
    const date = recordedDate(text2);
    return date ? dayText(date, now) : text2;
  }
  function depTime(text2) {
    if (!text2) return null;
    return text2.replace("T", " ").replace(/(\.\d+)?Z$/, "");
  }
  var changeActor = (e3) => e3.byPanel ? "you (panel)" : e3.actor ?? "unknown";
  function latestUnseenChange(id, activity) {
    return activity.find((e3) => e3.beadId === id && e3.unseen) ?? null;
  }
  function statusWord(status, statuses) {
    const label = statusLabel(status, statuses);
    return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
  }
  var priorityText = (value) => typeof value === "number" ? `P${value}` : "none";
  var nameText = (value) => typeof value === "string" && value ? value : "nobody";
  var KINDS = {
    blocks: { out: "Blocked by", in: "Blocks", tone: "blocked" },
    related: { out: "Related", in: "Related" },
    "relates-to": { out: "Related", in: "Related" },
    "discovered-from": { out: "Discovered from", in: "Led to" },
    tracks: { out: "Tracks", in: "Tracked by" },
    "caused-by": { out: "Caused by", in: "Caused" },
    validates: { out: "Validates", in: "Validated by" },
    supersedes: { out: "Supersedes", in: "Superseded by" }
  };
  var isKnownLinkKind = (kind) => Object.hasOwn(KINDS, kind);
  function kindLabel(kind, direction) {
    const known = KINDS[kind];
    if (known) return known[direction];
    const name = humanize(kind || "link");
    return direction === "out" ? name : `${name} (incoming)`;
  }
  function changeLine(e3, statuses, now) {
    const at2 = e3.changedAt ?? e3.observedAt;
    const time = e3.historical ? `on ${recordedDay(at2, now)}` : when(at2, now);
    const by = `${time} by ${changeActor(e3)}`;
    switch (e3.kind) {
      case "created":
        return { lead: `Created ${by}`, what: null };
      case "closed":
        return { lead: `Closed ${by}`, what: e3.reason ?? null };
      case "reopened":
        return { lead: `Reopened ${by}`, what: null, ...typeof e3.to === "string" ? { from: statusWord(String(e3.from ?? ""), statuses), to: statusWord(e3.to, statuses), toLook: looker(statuses)(e3.to) } : {} };
      case "comment":
        return { lead: `New comment ${by}`, what: null };
      case "deleted":
        return { lead: `Deleted ${by}`, what: null };
      case "dep_added":
        return { lead: `Link added ${by}`, what: `${kindLabel(e3.field ?? "", "out").toLowerCase()} ${String(e3.to ?? "")}`.trim() };
      case "dep_removed":
        return { lead: `Link removed ${by}`, what: `${kindLabel(e3.field ?? "", "out").toLowerCase()} ${String(e3.from ?? "")}`.trim() };
      case "gate_opened":
      case "gate_resolved": {
        const { head, by: named } = gateEventWords(gateEventOf(e3));
        const ended = e3.kind === "gate_resolved" && e3.ended === "deleted";
        const who = named ?? (ended || !e3.actor && !e3.byPanel ? null : changeActor(e3));
        const reason = e3.reason?.trim().split("\n")[0]?.trim();
        return { lead: who ? `${head} ${time} by ${who}` : `${head} ${time}`, what: reason || null };
      }
      case "field":
        break;
    }
    const lead = `Changed ${by}`;
    switch (e3.field) {
      case "status": {
        const to = String(e3.to ?? "");
        return { lead, what: null, from: statusWord(String(e3.from ?? ""), statuses), to: statusWord(to, statuses), toLook: looker(statuses)(to) };
      }
      case "priority":
        return { lead, what: `priority ${priorityText(e3.from)} \u2192 ${priorityText(e3.to)}` };
      case "assignee":
        return { lead, what: `assignee ${nameText(e3.from)} \u2192 ${nameText(e3.to)}` };
      case "closeReason":
        return { lead, what: "close reason edited" };
      default:
        return { lead, what: e3.field ? `${humanize(e3.field).toLowerCase()} edited` : null };
    }
  }
  function changeText(line) {
    if (line.to !== void 0) return `${line.lead}: ${line.from} \u2192 ${line.to}`;
    return line.what ? `${line.lead}: ${line.what}` : line.lead;
  }
  var lastClose = (id, activity) => activity.find((e3) => e3.beadId === id && e3.kind === "closed");
  function closeReason(bead, activity, statuses) {
    if (looker(statuses)(bead.status) !== "done") return null;
    return bead.closeReason ?? lastClose(bead.id, activity)?.reason ?? null;
  }
  function closedAt2(bead, activity, statuses) {
    if (looker(statuses)(bead.status) !== "done") return null;
    if (bead.closedAt) return { at: bead.closedAt, historical: false };
    const e3 = lastClose(bead.id, activity);
    return e3 ? { at: e3.changedAt ?? e3.observedAt, historical: e3.historical === true } : null;
  }
  var GROUP_ORDER = ["blocks-out", "blocks-in", "related", "discovered-from-out", "discovered-from-in", "tracks-out", "tracks-in"];
  function relationGroups(related, parentId = null) {
    const groups = [];
    if (related.parent) groups.push({ key: "parent", label: "Parent", items: [{ id: related.parent.id, bead: related.parent, dep: null }] });
    else if (parentId) groups.push({ key: "parent", label: "Parent", items: [{ id: parentId, bead: null, dep: null }] });
    if (related.children.length) {
      const children = [...related.children].sort((a5, b2) => compareIds(a5.id, b2.id));
      groups.push({ key: "children", label: "Children", items: children.map((b2) => ({ id: b2.id, bead: b2, dep: null })) });
    }
    const byKey = /* @__PURE__ */ new Map();
    for (const { dep, other, direction } of related.deps) {
      const known = KINDS[dep.kind];
      const label = kindLabel(dep.kind, direction);
      const key = label === "Related" ? "related" : `${dep.kind}-${direction}`;
      let group = byKey.get(key);
      if (!group) {
        group = { key, label, ...known?.tone && direction === "out" ? { tone: known.tone } : {}, items: [] };
        byKey.set(key, group);
      }
      const id = direction === "out" ? dep.to : dep.from;
      if (key === "related" && group.items.some((i3) => i3.id === id)) continue;
      group.items.push({ id, bead: other, dep });
    }
    const rank2 = (key) => {
      const i3 = GROUP_ORDER.indexOf(key);
      return i3 < 0 ? GROUP_ORDER.length : i3;
    };
    const deps = [...byKey.values()].sort((a5, b2) => rank2(a5.key) - rank2(b2.key) || (a5.label < b2.label ? -1 : a5.label > b2.label ? 1 : 0));
    return [...groups, ...deps];
  }
  function newerBead(read, listed) {
    if (!read || !listed) return read ?? listed;
    return Date.parse(listed.updatedAt) > Date.parse(read.updatedAt) ? listed : read;
  }
  function beadSignature(b2) {
    const fields = JSON.stringify([b2.title, b2.status, b2.priority, b2.assignee, b2.labels, b2.parentId, b2.description, b2.design, b2.acceptance, b2.notes, b2.closeReason, b2.extra]);
    return `${b2.updatedAt}|${fields}|${b2.comments.map((c3) => c3.id).join(",")}|${b2.dependencies.map((d3) => `${d3.kind}>${d3.to}`).sort().join(",")}`;
  }
  var FIELD_LABELS = {
    estimated_minutes: "Estimate",
    external_ref: "External ref",
    due_at: "Due",
    started_at: "Started",
    defer_until: "Defer until"
  };
  var ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  function minutesText(n2) {
    const h4 = Math.floor(n2 / 60);
    const m3 = n2 % 60;
    return h4 === 0 ? `${m3}m` : m3 === 0 ? `${h4}h` : `${h4}h ${m3}m`;
  }
  var isScalar = (v5) => typeof v5 === "string" || typeof v5 === "number" || typeof v5 === "boolean";
  var scalarText = (v5) => v5 === true ? "Yes" : v5 === false ? "No" : String(v5);
  function valueField(key, label, value, now) {
    if (typeof value === "string" && ISO_TIME.test(value)) return { key, label, value: when(value, now), title: value };
    if (value !== null && isScalar(value)) return { key, label, value: scalarText(value) };
    if (Array.isArray(value) && value.every((v5) => v5 !== null && isScalar(v5))) return { key, label, value: value.map((v5) => scalarText(v5)).join(", ") };
    return { key, label, value: JSON.stringify(value), code: true };
  }
  function moreFields(extra, now = Date.now()) {
    return Object.entries(extra).flatMap(([key, value]) => {
      const label = FIELD_LABELS[key] ?? humanize(key);
      if (key === "estimated_minutes" && typeof value === "number" && Number.isInteger(value) && value >= 0) return [{ key, label, value: minutesText(value), title: `${value} minutes` }];
      if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
        return [{ key, label, value: "", group: true }, ...Object.entries(value).map(([k3, v5]) => ({ ...valueField(`${key}.${k3}`, k3, v5, now), sub: true }))];
      }
      return [valueField(key, label, value, now)];
    });
  }
  var ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
  function acceptanceItems(text2) {
    const lines = text2.split("\n").filter((l3) => l3.trim() !== "");
    if (lines.length === 0) return null;
    const items = [];
    for (const line of lines) {
      const m3 = ITEM.exec(line);
      if (!m3) return null;
      items.push({ text: m3[2].trim(), done: m3[1] === "x" || m3[1] === "X" });
    }
    return items;
  }
  var BOX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\](?:\s|$))/;
  var BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
  var FENCE = /^\s*(```|~~~)/;
  var RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
  function acceptanceLines(text2) {
    let fence = null;
    return text2.split("\n").map((raw, index) => {
      const line = raw.replace(/\r$/, "");
      const mark = FENCE.exec(line)?.[1];
      if (mark && (fence === null || fence === mark)) {
        fence = fence === null ? mark : null;
        return { index, kind: "text", done: false, text: line, depth: 0 };
      }
      const bullet = fence !== null || RULE.test(line) ? null : BULLET.exec(line);
      if (!bullet) return { index, kind: "text", done: false, text: line, depth: 0 };
      const depth = bullet[1].replace(/\t/g, "  ").length >= 2 ? 1 : 0;
      const box = BOX.exec(line);
      if (box) return { index, kind: "box", done: box[2] !== " ", text: line.slice(box[0].length).trim(), depth };
      return { index, kind: "bullet", done: false, text: bullet[2].trim(), depth };
    });
  }
  function acceptanceBlocks(text2) {
    const blocks = [];
    for (const line of acceptanceLines(text2)) {
      const last = blocks[blocks.length - 1];
      if (line.kind !== "text") {
        if (last?.kind === "list") last.lines.push(line);
        else blocks.push({ kind: "list", lines: [line] });
      } else if (last?.kind === "text") last.text += `
${line.text}`;
      else if (line.text.trim() !== "") blocks.push({ kind: "text", text: line.text });
    }
    return blocks;
  }
  function toggleLine(text2, index) {
    const lines = text2.split("\n");
    const line = lines[index];
    if (line === void 0 || acceptanceLines(text2)[index]?.kind !== "box") return null;
    lines[index] = line.replace(BOX, (_all, head, mark, tail) => `${head}${mark === " " ? "x" : " "}${tail}`);
    return lines.join("\n");
  }

  // src/panel/edit.ts
  function writesPaused(snapshot) {
    if (!snapshot) return null;
    if (snapshot.freshness.schemaUpdate) return "Editing is paused until the project is updated.";
    if (snapshot.writesBlocked) return "Editing is paused until the sync problem is resolved.";
    if (snapshot.sync.kind === "running") return `Editing is paused while ${snapshot.sync.op === "publish" ? "Publish" : "Sync"} runs.`;
    return null;
  }
  function labelProblem(label, existing) {
    if (label.trim() === "") return "A label cannot be empty.";
    if (/[\r\n]/.test(label)) return "A label cannot contain a line break.";
    if (label.includes(",") || label.includes('"')) return "A label cannot contain a comma or a double quote.";
    if (existing.includes(label.trim())) return "That label is already on this bead.";
    return null;
  }
  var PRIORITY_WORDS = ["Critical", "High", "Medium", "Low", "Backlog"];
  var personOf = (panelActor) => panelActor.replace(/\s*\(panel\)$/, "").trim();
  function assigneeOptions(beads, panelActor) {
    const me2 = personOf(panelActor);
    const names = /* @__PURE__ */ new Set();
    for (const b2 of beads) if (b2.assignee && b2.assignee !== me2) names.add(b2.assignee);
    const others = [...names].sort((a5, b2) => a5.localeCompare(b2, "en", { sensitivity: "base" }));
    return me2 ? [me2, ...others] : others;
  }
  var LINK_KINDS = [
    { value: "blocked-by", label: "Blocked by", kind: "blocks" },
    { value: "blocks", label: "Blocks", kind: "blocks", reverse: true },
    { value: "related", label: "Related", kind: "related" },
    { value: "discovered-from", label: "Discovered from", kind: "discovered-from" },
    { value: "tracks", label: "Tracks", kind: "tracks" },
    { value: "caused-by", label: "Caused by", kind: "caused-by" },
    { value: "validates", label: "Validates", kind: "validates" },
    { value: "supersedes", label: "Supersedes", kind: "supersedes" }
  ];
  function linkRequest(value, selfId, otherId) {
    const choice = LINK_KINDS.find((k3) => k3.value === value) ?? LINK_KINDS[0];
    return choice.reverse ? { from: otherId, to: selfId, kind: choice.kind } : { from: selfId, to: otherId, kind: choice.kind };
  }
  function linkTargets(query, beads, selfId, statuses, limit = 6) {
    const q4 = query.trim().toLowerCase();
    if (q4 === "") return [];
    const look = looker(statuses);
    const scored = [];
    for (const b2 of beads) {
      if (b2.id === selfId) continue;
      const id = b2.id.toLowerCase();
      const short = shortId(b2.id).toLowerCase();
      const rank2 = id === q4 || short === q4 ? 0 : id.includes(q4) ? 1 : b2.title.toLowerCase().includes(q4) ? 2 : -1;
      if (rank2 >= 0) scored.push({ bead: b2, rank: rank2 });
    }
    const done = (b2) => Number(look(b2.status) === "done");
    scored.sort((a5, b2) => a5.rank - b2.rank || done(a5.bead) - done(b2.bead) || compareIds(a5.bead.id, b2.bead.id));
    return scored.slice(0, limit).map((s3) => s3.bead);
  }
  function defaultParent(beads, shownId) {
    if (shownId === null) return null;
    const byId = new Map(beads.map((b2) => [b2.id, b2]));
    const shown = byId.get(shownId);
    if (!shown) return null;
    if (shown.type === "epic") return shown.id;
    return nearestEpic(shown, byId)?.id ?? null;
  }
  function parentOptions(beads, statuses, keep) {
    const look = looker(statuses);
    return beads.filter((b2) => b2.type === "epic" && (look(b2.status) !== "done" || b2.id === keep)).sort((a5, b2) => compareIds(a5.id, b2.id));
  }
  var closes = (status, statuses) => looker(statuses)(status) === "done";

  // src/shared/close.ts
  var CLOSED = "closed";
  var PINNED = "pinned";
  var notClosedChildren = (rows, id) => rows.filter((b2) => b2.parentId === id && b2.status !== CLOSED).map((b2) => b2.id);
  function closeBlockers(rows, id) {
    const byId = new Map(rows.map((b2) => [b2.id, b2]));
    const live = (s3) => s3 !== void 0 && s3 !== CLOSED && s3 !== PINNED;
    const holdsLiveChild = (target) => rows.some((b2) => b2.parentId === target && live(b2.status));
    const directTargets = (bead) => (bead?.dependencies ?? []).filter((d3) => d3.kind === "blocks" || d3.kind === "conditional-blocks" || d3.kind === "waits-for").map((d3) => d3.to);
    const blockedState = (bead, seen) => {
      if (bead === void 0 || !live(bead.status) || seen.has(bead.id)) return false;
      seen.add(bead.id);
      const links = bead.dependencies;
      return links.some((d3) => (d3.kind === "blocks" || d3.kind === "conditional-blocks") && live(byId.get(d3.to)?.status)) || links.some((d3) => d3.kind === "waits-for" && byId.has(d3.to) && holdsLiveChild(d3.to)) || bead.parentId !== null && blockedState(byId.get(bead.parentId), seen);
    };
    const request = byId.get(id);
    const waitingOn = blockedState(request, /* @__PURE__ */ new Set()) ? directTargets(request).filter((to) => live(byId.get(to)?.status)) : [];
    const blockers = [...waitingOn, ...notClosedChildren(rows, id)];
    return blockers.filter((blocker, index) => blockers.indexOf(blocker) === index);
  }

  // src/panel/needs.ts
  var KEEP_MS = WEEK_MS;
  var DAY_MS2 = 864e5;
  var DEFAULT_STALE_DAYS = 3;
  var needsOf = (state, now) => needsSections({ snapshot: state.snapshot, staleDays: state.settings.staleDays, keep: state.keep }, now);
  var EMPTY_NEEDS = { waiting: [], asked: [], stuck: [], changed: [], count: 0 };
  var WAITING_FALLBACK = "Waiting for your review";
  var timeOf = (iso) => {
    const at2 = Date.parse(iso);
    return Number.isFinite(at2) ? at2 : NaN;
  };
  function span(ms) {
    const days = Math.floor(ms / DAY_MS2);
    if (days >= 1) return days === 1 ? "1 day" : `${days} days`;
    const hours = Math.floor(ms / 36e5);
    if (hours >= 1) return hours === 1 ? "1 hour" : `${hours} hours`;
    const minutes = Math.floor(ms / 6e4);
    return minutes >= 1 ? minutes === 1 ? "1 minute" : `${minutes} minutes` : "a moment";
  }
  var askedText = (bead) => bead.description.trim() ? bead.description.trim() : bead.title;
  function waiting(beads, gates, done) {
    const byId = new Map(beads.map((b2) => [b2.id, b2]));
    const held = /* @__PURE__ */ new Map();
    for (const gate of gates) {
      if (gate.kind !== "human") continue;
      for (const id of gate.blocks) held.set(id, [...held.get(id) ?? [], gate]);
    }
    const rows = [];
    for (const [id, own] of held) {
      const bead = byId.get(id);
      if (!bead || done(bead)) continue;
      rows.push({ bead, gates: own, reason: own.find((g3) => g3.reason)?.reason ?? WAITING_FALLBACK });
    }
    return rows.sort((a5, b2) => compareIds(a5.bead.id, b2.bead.id));
  }
  function stuck(beads, leases, keep, staleDays, now, look) {
    const expired = /* @__PURE__ */ new Map();
    for (const lease of leases) {
      const until = timeOf(lease.expiresAt);
      if (until <= now) expired.set(lease.beadId, lease);
    }
    const rows = [];
    for (const bead of beads) {
      if (look(bead.status) === "done") continue;
      if ((keep[bead.id] ?? 0) > now) continue;
      const touched = timeOf(bead.updatedAt);
      const quiet = bead.status === "in_progress" && Number.isFinite(touched) && now - touched > staleDays * DAY_MS2;
      const lease = bead.status === "in_progress" ? expired.get(bead.id) : void 0;
      if (!quiet && !lease) continue;
      const parts2 = [];
      if (quiet) parts2.push(`No update in ${span(now - touched)}`);
      if (lease) parts2.push(`${lease.holder}'s claim ran out ${span(now - timeOf(lease.expiresAt))} ago`);
      rows.push({ bead, why: parts2.join(". "), kind: quiet ? "quiet" : "lease", at: Number.isFinite(touched) ? touched : 0 });
    }
    return rows.sort((a5, b2) => a5.at - b2.at || compareIds(a5.bead.id, b2.bead.id)).map(({ at: _at, ...row2 }) => row2);
  }
  var gateRow = (g3) => ({
    id: g3.id,
    title: g3.reason ?? "Gate",
    status: "open",
    priority: 2,
    type: "gate",
    assignee: null,
    labels: [],
    parentId: null,
    description: "",
    design: "",
    acceptance: "",
    notes: "",
    createdAt: g3.createdAt,
    createdBy: g3.createdBy,
    updatedAt: g3.createdAt,
    closedAt: null,
    closeReason: null,
    dependencies: [],
    comments: [],
    extra: {}
  });
  function changed(snapshot, now) {
    const byId = new Map(snapshot.beads.map((b2) => [b2.id, b2]));
    const rows = [];
    for (const id of snapshot.unseenIds) {
      const bead = byId.get(id);
      if (!bead) continue;
      const event = latestUnseenChange(id, snapshot.activity);
      const order = event ? snapshot.activity.indexOf(event) : Number.MAX_SAFE_INTEGER;
      rows.push({ bead, event, summary: event ? changeText(changeLine(event, snapshot.statuses, now)) : "Changed since you last looked", order });
    }
    return rows.sort((a5, b2) => a5.order - b2.order).map(({ order: _order, ...row2 }) => row2);
  }
  function needsSections(input, now) {
    const { snapshot } = input;
    if (!snapshot) return EMPTY_NEEDS;
    const look = looker(snapshot.statuses);
    const done = (b2) => look(b2.status) === "done";
    const waitingRows = waiting(snapshot.beads, snapshot.gates, done);
    const waitingIds = new Set(waitingRows.map((r3) => r3.bead.id));
    const withGates = [...snapshot.beads, ...snapshot.gates.map(gateRow)];
    const asked = snapshot.beads.filter((b2) => b2.labels.includes("human") && !done(b2) && !waitingIds.has(b2.id)).map((bead) => ({ bead, text: askedText(bead), blockers: closeBlockers(withGates, bead.id) }));
    const stuckRows = stuck(snapshot.beads, snapshot.leases, input.keep, input.staleDays, now, look);
    const changedRows = changed(snapshot, now);
    return { waiting: waitingRows, asked, stuck: stuckRows, changed: changedRows, count: waitingRows.length + asked.length + stuckRows.length + changedRows.length };
  }
  function eligibleEpics(beads, statuses, gates = []) {
    const look = looker(statuses);
    const held = new Set(gates.flatMap((g3) => g3.blocks));
    const children = /* @__PURE__ */ new Map();
    for (const b2 of beads) if (b2.parentId !== null) children.set(b2.parentId, [...children.get(b2.parentId) ?? [], b2]);
    return beads.filter((b2) => {
      if (b2.type !== "epic" || look(b2.status) === "done" || held.has(b2.id)) return false;
      const own = children.get(b2.id) ?? [];
      return own.length > 0 && own.every((c3) => look(c3.status) === "done");
    });
  }

  // src/panel/store.ts
  var VIEWS = ["needs", "epic", "status", "activity"];
  var DEFAULT_FILTERS = { status: "open", assignee: "any", priorities: [], ready: false, due: "any" };
  var DEFAULT_COLLAPSED = ["status:deferred", "status:closed"];
  var filtersActive = (f5) => f5.status !== "open" || f5.assignee !== "any" || f5.priorities.length > 0 || f5.ready || f5.due !== "any";
  var POLL_MS = 2e3;
  var LIVE_POLL_MS = 500;
  var MAX_BACKOFF_MS = 3e4;
  var HIDDEN_POLL_MS = 6e4;
  function fnv(text2, seed) {
    let h4 = seed >>> 0;
    for (let i3 = 0; i3 < text2.length; i3++) {
      h4 ^= text2.charCodeAt(i3);
      h4 = Math.imul(h4, 16777619) >>> 0;
    }
    return h4.toString(16).padStart(8, "0");
  }
  var uiKey = (directory2) => `ui:${fnv(directory2, 2166136261)}${fnv(directory2, 16777619)}`;
  var projectKey = (directory2) => `project:${fnv(directory2, 2166136261)}${fnv(directory2, 16777619)}`;
  var DEFAULT_SETTINGS = { staleDays: DEFAULT_STALE_DAYS };
  var NO_CAPABILITIES = { eventsJournal: false, leases: false };
  var MAX_STALE_DAYS = 30;
  function readProject(value, now) {
    const v5 = isObject2(value) ? value : {};
    const days = v5.staleDays;
    const keep = {};
    if (isObject2(v5.keep)) {
      for (const [id, until] of Object.entries(v5.keep)) if (typeof until === "number" && Number.isFinite(until) && until > now) keep[id] = until;
    }
    return { settings: { staleDays: typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= MAX_STALE_DAYS ? days : DEFAULT_SETTINGS.staleDays }, keep };
  }
  var isObject2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  var isStrings = (value) => Array.isArray(value) && value.every((v5) => typeof v5 === "string");
  function readFilters(value) {
    if (!isObject2(value)) return DEFAULT_FILTERS;
    const { status, assignee, priorities, ready, due } = value;
    return {
      status: status === "open" || status === "all" ? status : isObject2(status) && isStrings(status.only) ? { only: status.only } : "open",
      assignee: assignee === "any" || assignee === "unassigned" ? assignee : isObject2(assignee) && typeof assignee.name === "string" ? { name: assignee.name } : "any",
      priorities: Array.isArray(priorities) ? priorities.filter((p3) => Number.isInteger(p3) && p3 >= 0 && p3 <= 4) : [],
      ready: ready === true,
      due: due === "overdue" || due === "week" ? due : "any"
    };
  }
  function readUi(value) {
    const v5 = isObject2(value) ? value : {};
    return {
      view: VIEWS.includes(v5.view) ? v5.view : "epic",
      filters: readFilters(v5.filters),
      collapsed: isStrings(v5.collapsed) ? v5.collapsed : [...DEFAULT_COLLAPSED]
    };
  }
  function pageVisibility(win) {
    let intersecting = true;
    return {
      isVisible: () => win.document.visibilityState !== "hidden" && win.innerWidth > 0 && win.innerHeight > 0 && intersecting,
      isDocumentHidden: () => win.document.visibilityState === "hidden",
      onChange(listener) {
        win.document.addEventListener("visibilitychange", listener);
        win.addEventListener("resize", listener);
        let observer = null;
        if (win.IntersectionObserver) {
          observer = new win.IntersectionObserver((entries2) => {
            const last = entries2[entries2.length - 1];
            if (!last) return;
            intersecting = last.isIntersecting;
            listener();
          });
          observer.observe(win.document.documentElement);
        }
        return () => {
          win.document.removeEventListener("visibilitychange", listener);
          win.removeEventListener("resize", listener);
          observer?.disconnect();
        };
      }
    };
  }
  var alwaysVisible = { isVisible: () => true, onChange: () => () => {
  } };
  var defaultVisibility = () => typeof window === "undefined" ? alwaysVisible : pageVisibility(window);
  function toPanelError(error) {
    const e3 = asRequestError(error);
    return e3.detail ? { code: e3.code, message: e3.message, detail: e3.detail } : { code: e3.code, message: e3.message };
  }
  function createStore({ client: client2, host: host2, visibility = defaultVisibility(), now = Date.now }) {
    let state = {
      directory: null,
      generation: 0,
      workspace: null,
      snapshot: null,
      capabilities: NO_CAPABILITIES,
      gates: [],
      leases: [],
      unsupported: /* @__PURE__ */ new Set(),
      sharedUpdates: {},
      settings: DEFAULT_SETTINGS,
      keep: {},
      view: "epic",
      page: "list",
      filters: DEFAULT_FILTERS,
      collapsed: [...DEFAULT_COLLAPSED],
      query: "",
      selectedId: null,
      detail: null,
      error: null,
      watchedSince: now(),
      confirming: false,
      confirmError: null,
      create: null,
      overlays: []
    };
    const listeners = /* @__PURE__ */ new Set();
    let timer = null;
    let latest = 0;
    let failures = 0;
    let following = false;
    let touched = false;
    let projectTouched = false;
    let storedLoaded = false;
    let viewDecided = false;
    let chosenView = null;
    let disposed = false;
    let inFlight = false;
    let wasVisible = visibility.isVisible();
    let badge;
    let detailSeq = 0;
    let detailSig = null;
    let leaveGuard = null;
    let listCursor = null;
    const bannered = /* @__PURE__ */ new Set();
    const drafts = /* @__PURE__ */ new Map();
    const draftKey = (id, field) => `${state.directory ?? ""}
${id}
${field}`;
    const sendBadge = (force = false) => {
      const count = Math.min(state.snapshot?.unseenIds.length ?? 0, GUEST_BADGE_MAX);
      const next = count > 0 ? count : null;
      if (!force && next === badge) return;
      badge = next;
      host2.setBadge(next).catch(() => {
      });
    };
    const set = (patch) => {
      state = { ...state, ...patch };
      if ("snapshot" in patch) sendBadge();
      listeners.forEach((l3) => l3());
    };
    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const usable = () => state.workspace === null || state.workspace.kind === "ok";
    const schedule = (ms) => {
      clearTimer();
      if (disposed || !usable()) return;
      if (visibility.isVisible()) timer = setTimeout(() => void poll(), ms);
      else if (!visibility.isDocumentHidden?.()) timer = setTimeout(() => void poll(), Math.max(ms, HIDDEN_POLL_MS));
    };
    function rememberShared(directory2, freshness) {
      const job = freshness.schemaUpdateJob;
      if (job?.kind === "failed" && job.code === "update-blocked-shared") {
        const kept = state.sharedUpdates[directory2];
        if (kept?.message === job.message && kept.detail === job.detail) return;
        set({ sharedUpdates: { ...state.sharedUpdates, [directory2]: { message: job.message, ...job.detail ? { detail: job.detail } : {} } } });
      } else if (!freshness.schemaUpdate && directory2 in state.sharedUpdates) {
        const { [directory2]: _gone, ...rest } = state.sharedUpdates;
        set({ sharedUpdates: rest });
      }
    }
    async function poll(refreshWorkspace = false) {
      clearTimer();
      const { directory: directory2, generation } = state;
      if (directory2 === null || disposed) return;
      const seq = ++latest;
      inFlight = true;
      const current = () => {
        if (seq !== latest || generation !== state.generation || disposed) return false;
        inFlight = false;
        return true;
      };
      const cursor = state.snapshot?.cursor;
      try {
        const answer = await client2.snapshot({ directory: directory2, ...cursor ? { cursor } : {}, ...refreshWorkspace ? { refreshWorkspace: true } : {} });
        if (!current()) return;
        failures = 0;
        following = answer.following === true;
        rememberShared(directory2, answer.freshness);
        if (!answer.unchanged) {
          listedBeads = answer.beads;
          set({
            snapshot: { ...answer, beads: holding(answer.beads, answer.freshness) },
            capabilities: answer.capabilities ?? NO_CAPABILITIES,
            gates: answer.gates ?? [],
            leases: answer.leases ?? [],
            workspace: answer.workspace,
            error: null
          });
          decideView();
          followDetail();
        } else if (state.snapshot) {
          const held = answered2.size;
          const beads = holding(listedBeads, answer.freshness);
          set({ snapshot: { ...state.snapshot, cursor: answer.cursor, freshness: answer.freshness, sync: answer.sync, ...answered2.size !== held ? { beads } : {} }, error: null });
        }
        schedule(following ? LIVE_POLL_MS : POLL_MS);
      } catch (thrown) {
        if (!current()) return;
        const error = asRequestError(thrown);
        if (error.workspace) {
          set({ workspace: error.workspace, snapshot: null, error: null });
          return;
        }
        failures++;
        set({ error: toPanelError(error) });
        schedule(Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS));
      }
    }
    function decideView() {
      if (viewDecided || !storedLoaded || state.snapshot === null || state.workspace?.kind !== "ok") return;
      viewDecided = true;
      if (touched) return;
      if (needsOf(state, now()).count > 0 && state.view !== "needs") {
        chosenView = state.view;
        set({ view: "needs" });
      }
    }
    function markUnsupported(feature) {
      if (state.unsupported.has(feature)) return;
      set({ unsupported: /* @__PURE__ */ new Set([...state.unsupported, feature]) });
    }
    const answered2 = /* @__PURE__ */ new Map();
    let listedBeads = [];
    function holding(beads, freshness) {
      if (answered2.size === 0) return beads;
      const read = freshness.localRefreshedAt === null ? NaN : Date.parse(freshness.localRefreshedAt);
      for (const [id, copy] of [...answered2]) if (read > copy.at) answered2.delete(id);
      if (answered2.size === 0) return beads;
      const out = beads.map((b2) => answered2.get(b2.id)?.bead ?? b2);
      for (const [id, copy] of answered2) if (!beads.some((b2) => b2.id === id)) out.push(copy.bead);
      return out;
    }
    function applyWritten(bead) {
      const snapshot = state.snapshot;
      if (!snapshot) return;
      answered2.set(bead.id, { bead, at: now() });
      const listed2 = snapshot.beads.find((b2) => b2.id === bead.id);
      const beads = listed2 ? snapshot.beads.map((b2) => b2.id === bead.id ? bead : b2) : [...snapshot.beads, bead];
      set({ snapshot: { ...snapshot, beads } });
      const shown = shownEntry();
      if (state.detail && shown?.id === bead.id) {
        detailSeq++;
        detailSig = beadSignature(bead);
        const related = state.detail.data?.bead.id === bead.id ? state.detail.data.related : relatedFor(bead, beads);
        set({ detail: { ...state.detail, data: { bead, related }, loading: false, error: null } });
      }
    }
    const shownEntry = () => state.detail?.stack[state.detail.stack.length - 1] ?? null;
    const listed = (id) => state.snapshot?.beads.find((b2) => b2.id === id);
    const entryFor = (id) => ({ id, change: state.snapshot ? latestUnseenChange(id, state.snapshot.activity) : null });
    async function loadDetail() {
      const entry = shownEntry();
      const { directory: directory2, generation } = state;
      if (!entry || directory2 === null || !state.detail) return;
      const seq = ++detailSeq;
      const copy = listed(entry.id);
      detailSig = copy ? beadSignature(copy) : null;
      set({ detail: { ...state.detail, loading: true, error: null } });
      const current = () => seq === detailSeq && generation === state.generation && !disposed && state.detail !== null && shownEntry()?.id === entry.id;
      try {
        const data = await client2.bead({ directory: directory2, id: entry.id });
        if (!current()) return;
        if (!isObject2(data) || !isObject2(data.bead) || data.bead.id !== entry.id || !isObject2(data.related)) throw new Error("The bead answer had no bead.");
        set({ detail: { ...state.detail, data, loading: false, error: null } });
      } catch (thrown) {
        if (current()) set({ detail: { ...state.detail, loading: false, error: toPanelError(thrown) } });
      }
    }
    function applySeen(unseenIds) {
      const snapshot = state.snapshot;
      if (!snapshot) return;
      const unseen = new Set(unseenIds);
      const activity = snapshot.activity.map((e3) => e3.unseen && !unseen.has(e3.beadId) ? { ...e3, unseen: false } : e3);
      set({ snapshot: { ...snapshot, unseenIds, activity } });
    }
    async function markSeen(id) {
      const { directory: directory2, generation } = state;
      if (directory2 === null || !state.snapshot?.unseenIds.includes(id)) return;
      try {
        const { unseenIds } = await client2.seen({ directory: directory2, ids: [id] });
        if (generation !== state.generation || disposed || !isStrings(unseenIds)) return;
        applySeen(unseenIds);
      } catch {
      }
    }
    const show = (stack) => {
      const entry = stack[stack.length - 1];
      if (entry.change) bannered.add(entry.change.id);
      set({ detail: { stack, data: null, loading: true, error: null } });
      void loadDetail();
      void markSeen(entry.id);
    };
    const replaceShown = (entry) => {
      if (!state.detail) return;
      set({ detail: { ...state.detail, stack: [...state.detail.stack.slice(0, -1), entry] } });
    };
    function followDetail() {
      const entry = shownEntry();
      const snapshot = state.snapshot;
      if (!entry || !snapshot) return;
      const copy = listed(entry.id);
      if (copy && beadSignature(copy) !== detailSig) void loadDetail();
      if (!visibility.isVisible() || !snapshot.unseenIds.includes(entry.id)) return;
      const change = latestUnseenChange(entry.id, snapshot.activity);
      if (change && !bannered.has(change.id)) {
        bannered.add(change.id);
        replaceShown({ ...entry, change });
      }
      void markSeen(entry.id);
    }
    function select(id) {
      if (id === null) {
        detailSeq++;
        set({ selectedId: null, detail: null });
        return;
      }
      set({ selectedId: id });
      show([entryFor(id)]);
    }
    const leaving = (go, stay) => leaveGuard ? leaveGuard(go, stay) : go();
    function showMade(bead) {
      if (state.detail) leaving(() => openMade(bead), () => host2.toast({ kind: "success", message: `Created ${shortId(bead.id)}.` }).catch(() => {
      }));
      else openMade(bead);
    }
    function openMade(bead) {
      const entry = { id: bead.id, change: null };
      const stack = state.detail ? [...state.detail.stack, entry] : [entry];
      detailSeq++;
      detailSig = beadSignature(bead);
      const data = { bead, related: relatedFor(bead, state.snapshot?.beads ?? []) };
      set({ selectedId: state.detail ? state.selectedId : bead.id, detail: { stack, data, loading: false, error: null } });
    }
    function refreshAfterWrite(readBead) {
      void poll();
      if (readBead && state.detail) void loadDetail();
    }
    function refused(thrown, feature) {
      const error = asRequestError(thrown);
      if (error.code === "unsupported" && feature) markUnsupported(feature);
      if (error.code === "uncertain" || ANSWER_LOST.has(error.code)) {
        refreshAfterWrite(true);
        return { kind: "uncertain", current: null, saved: error.saved === true };
      }
      if (error.saved) refreshAfterWrite(true);
      else if (error.code === "writes-blocked" || error.code === "sync-running" || error.code === "merge-conflict" || error.workspace) void poll();
      return { kind: "error", error: toPanelError(error) };
    }
    async function writing(send, done, feature) {
      const { directory: directory2, generation } = state;
      if (directory2 === null || disposed) return { kind: "dropped" };
      const here = () => generation === state.generation && !disposed;
      try {
        const answer = await send(directory2);
        return here() ? done(answer) : { kind: "dropped" };
      } catch (thrown) {
        return here() ? refused(thrown, feature) : { kind: "dropped" };
      }
    }
    async function reading(send, feature) {
      const { directory: directory2, generation } = state;
      if (directory2 === null || disposed) return { kind: "dropped" };
      const here = () => generation === state.generation && !disposed;
      try {
        const value = await send(directory2);
        return here() ? { kind: "ok", value } : { kind: "dropped" };
      } catch (thrown) {
        if (!here()) return { kind: "dropped" };
        const error = asRequestError(thrown);
        if (error.code === "unsupported") markUnsupported(feature);
        return { kind: "error", error: toPanelError(error) };
      }
    }
    function humanDone(result) {
      if (result.ok) applyWritten(result.bead);
      else if (result.current) applyWritten(result.current);
      void poll();
      return { kind: "ok", value: result };
    }
    function writtenBead(result) {
      if (result.ok) {
        applyWritten(result.bead);
        void poll();
        if (result.detail) {
          host2.toast({ kind: "info", message: "Saved. It may show as a change from someone else.", copy: { text: result.detail.slice(0, COPY_MAX) } }).catch(() => {
          });
        }
        return { kind: "ok", value: result.bead };
      }
      if ("conflict" in result) {
        applyWritten(result.current);
        return { kind: "conflict", current: result.current };
      }
      if (result.current) applyWritten(result.current);
      refreshAfterWrite(result.current === null);
      return { kind: "uncertain", current: result.current, saved: result.saved === true };
    }
    const known = (id) => newerBead(state.detail?.data?.bead.id === id ? state.detail.data.bead : null, listed(id) ?? null);
    const persist = () => {
      const { directory: directory2, view, filters, collapsed } = state;
      if (directory2 === null) return;
      touched = true;
      const value = { view: chosenView ?? view, filters, collapsed };
      host2.storage.set(uiKey(directory2), value).catch(() => {
      });
    };
    const persistProject = () => {
      const { directory: directory2, settings, keep } = state;
      if (directory2 === null) return;
      projectTouched = true;
      host2.storage.set(projectKey(directory2), { staleDays: settings.staleDays, keep }).catch(() => {
      });
    };
    const stopVisibility = visibility.onChange(() => {
      const visible = visibility.isVisible();
      const shown = visible && !wasVisible;
      wasVisible = visible;
      if (!visible) {
        if (!inFlight) schedule(HIDDEN_POLL_MS);
      } else if (shown && state.directory !== null) {
        set({ watchedSince: now() });
        sendBadge(true);
        followDetail();
        if (usable() && !inFlight) void poll();
      }
    });
    return {
      get: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setDirectory(directory2) {
        if (directory2 === state.directory) return;
        clearTimer();
        failures = 0;
        touched = false;
        inFlight = false;
        detailSeq++;
        detailSig = null;
        bannered.clear();
        answered2.clear();
        listedBeads = [];
        projectTouched = false;
        storedLoaded = false;
        viewDecided = false;
        chosenView = null;
        const generation = state.generation + 1;
        set({
          directory: directory2,
          generation,
          workspace: null,
          snapshot: null,
          capabilities: NO_CAPABILITIES,
          gates: [],
          leases: [],
          unsupported: /* @__PURE__ */ new Set(),
          // A different project never sees this one's kept rows or threshold, not even while its own load is in flight.
          settings: DEFAULT_SETTINGS,
          keep: {},
          page: "list",
          error: null,
          selectedId: null,
          detail: null,
          query: "",
          watchedSince: now(),
          confirming: false,
          confirmError: null,
          create: null,
          ...readUi(void 0)
        });
        if (directory2 === null) return;
        const load = (key) => host2.storage.get(key).catch(() => void 0);
        void Promise.all([load(uiKey(directory2)), load(projectKey(directory2))]).then(([ui, project]) => {
          if (disposed || generation !== state.generation) return;
          if (!touched && ui !== void 0) set(readUi(ui));
          if (project !== void 0) {
            const read = readProject(project, now());
            set({ keep: { ...read.keep, ...state.keep }, settings: projectTouched ? state.settings : read.settings });
          }
          storedLoaded = true;
          decideView();
        });
        void poll();
      },
      retry() {
        failures = 0;
        void poll(true);
      },
      async confirmFirstContact() {
        const { directory: directory2, generation } = state;
        if (directory2 === null || state.confirming) return;
        set({ confirming: true, confirmError: null });
        try {
          const workspace = await client2.workspace({ directory: directory2, confirmFirstContact: true });
          if (generation !== state.generation || disposed) return;
          set({ confirming: false, workspace, snapshot: null });
          await poll(true);
        } catch (thrown) {
          if (generation !== state.generation || disposed) return;
          const error = asRequestError(thrown);
          if (!error.workspace) {
            set({ confirming: false, confirmError: toPanelError(error) });
            return;
          }
          const ready = error.workspace.kind === "ok";
          set({ confirming: false, workspace: error.workspace, snapshot: null, confirmError: ready ? null : toPanelError(error) });
          if (ready) void poll(true);
        }
      },
      setView(view) {
        chosenView = null;
        set({ view });
        persist();
      },
      setPage(page) {
        if (page !== state.page) set({ page });
      },
      markUnsupported,
      keepStuck(id) {
        set({ keep: { ...state.keep, [id]: now() + KEEP_MS } });
        persistProject();
      },
      setStaleDays(days) {
        const staleDays = Math.min(MAX_STALE_DAYS, Math.max(1, Math.round(days)));
        if (!Number.isFinite(staleDays) || staleDays === state.settings.staleDays) return;
        set({ settings: { ...state.settings, staleDays } });
        persistProject();
      },
      setFilters(filters) {
        set({ filters });
        persist();
      },
      toggleCollapsed(key) {
        set({ collapsed: state.collapsed.includes(key) ? state.collapsed.filter((k3) => k3 !== key) : [...state.collapsed, key] });
        persist();
      },
      setQuery(query) {
        set({ query });
      },
      select,
      openRelated(id) {
        if (!state.detail) return select(id);
        if (shownEntry()?.id === id) return;
        leaving(() => {
          if (state.detail) show([...state.detail.stack, entryFor(id)]);
        });
      },
      back() {
        if (!state.detail) return;
        leaving(() => {
          if (!state.detail) return;
          const stack = state.detail.stack.slice(0, -1);
          if (stack.length > 0) {
            show(stack);
            return;
          }
          detailSeq++;
          set({ detail: null });
        });
      },
      setLeaveGuard(guard) {
        leaveGuard = guard;
      },
      confirmLeave(go) {
        leaving(go);
      },
      setOverlay(name, open) {
        if (open === state.overlays.includes(name)) return;
        set({ overlays: open ? [...state.overlays, name] : state.overlays.filter((n2) => n2 !== name) });
      },
      draft(id, field) {
        return drafts.get(draftKey(id, field)) ?? null;
      },
      setDraft(id, field, draft) {
        if (draft) drafts.set(draftKey(id, field), draft);
        else drafts.delete(draftKey(id, field));
      },
      dropDrafts(id) {
        const prefix = draftKey(id, "");
        for (const key of [...drafts.keys()]) if (key.startsWith(prefix)) drafts.delete(key);
      },
      draftFields(id) {
        const prefix = draftKey(id, "");
        return [...drafts.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
      },
      reloadDetail() {
        void loadDetail();
      },
      dismissChange() {
        const entry = shownEntry();
        if (entry?.change) replaceShown({ ...entry, change: null });
      },
      async markAllSeen() {
        const { directory: directory2, generation } = state;
        if (directory2 === null || !state.snapshot) return;
        try {
          const { unseenIds } = await client2.seen({ directory: directory2, all: true });
          if (generation !== state.generation || disposed || !isStrings(unseenIds)) return;
          applySeen(unseenIds);
        } catch (thrown) {
          if (generation !== state.generation || disposed) return;
          const error = toPanelError(thrown);
          host2.toast({ kind: "error", message: `Couldn't mark the changes seen. ${error.message}`.slice(0, TOAST_MAX), ...error.detail ? { copy: { text: error.detail.slice(0, COPY_MAX) } } : {} }).catch(() => {
          });
        }
      },
      openUrl(url) {
        const offerCopy = () => host2.toast({ kind: "info", message: `The panel can't open this link: ${url}`.slice(0, TOAST_MAX), copy: { text: url } }).catch(() => {
        });
        if (!/^(https?:|mailto:)/i.test(url)) {
          void offerCopy();
          return;
        }
        host2.openUrl(url).catch(offerCopy);
      },
      copyDetails(error) {
        host2.toast({ kind: "error", message: error.message.slice(0, TOAST_MAX), copy: { text: (error.detail ?? error.message).slice(0, COPY_MAX) } }).catch(() => {
        });
      },
      copyText(text2) {
        host2.writeClipboard(text2).then(
          () => host2.toast({ kind: "success", message: `Copied ${text2}` }),
          () => host2.toast({ kind: "info", message: text2, copy: { text: text2 } })
        ).catch(() => {
        });
      },
      update(id, expectedUpdatedAt, patch, expected) {
        return writing((directory2) => client2.update({ directory: directory2, id, expectedUpdatedAt, patch, ...expected ? { expected } : {} }), writtenBead);
      },
      defer(id, expectedUpdatedAt, until, reason) {
        return writing((directory2) => client2.deferBead({ directory: directory2, id, expectedUpdatedAt, until, ...reason ? { reason } : {} }), writtenBead, "defer");
      },
      undefer(id, expectedUpdatedAt) {
        return writing((directory2) => client2.undeferBead({ directory: directory2, id, expectedUpdatedAt }), writtenBead, "defer");
      },
      supersede(id, withId, expectedUpdatedAt) {
        return writing((directory2) => client2.supersede({ directory: directory2, id, with: withId, expectedUpdatedAt }), writtenBead, "supersede");
      },
      duplicate(id, of, expectedUpdatedAt) {
        return writing((directory2) => client2.duplicate({ directory: directory2, id, of, expectedUpdatedAt }), writtenBead, "supersede");
      },
      requestReview(id, reason) {
        return writing(
          (directory2) => client2.gateCreate({ directory: directory2, id, ...reason ? { reason } : {} }),
          (value) => {
            void poll();
            return { kind: "ok", value };
          },
          "gates"
        );
      },
      resolveReview(gateId, reason) {
        return writing(
          (directory2) => client2.gateResolve({ directory: directory2, gateId, ...reason ? { reason } : {} }),
          (value) => {
            void poll();
            return { kind: "ok", value };
          },
          "gates"
        );
      },
      respond(id, response) {
        return writing((directory2) => client2.humanRespond({ directory: directory2, id, response }), humanDone, "human");
      },
      dismissRequest(id, reason) {
        return writing((directory2) => client2.humanDismiss({ directory: directory2, id, ...reason ? { reason } : {} }), humanDone, "human");
      },
      remember(request) {
        return writing((directory2) => client2.memoryRemember({ directory: directory2, ...request }), (value) => ({ kind: "ok", value }), "memories");
      },
      forget(key, expectedText) {
        return writing((directory2) => client2.memoryForget({ directory: directory2, key, expectedText }), (value) => ({ kind: "ok", value }), "memories");
      },
      async enableEvents() {
        let message = "";
        const outcome = await writing(
          async (directory2) => {
            try {
              return await client2.enableEvents({ directory: directory2, confirm: true });
            } catch (thrown) {
              message = asRequestError(thrown).message;
              throw thrown;
            }
          },
          (value) => {
            void poll();
            return { kind: "ok", value };
          },
          "events"
        );
        if (outcome.kind !== "uncertain") return outcome;
        const read = await reading((directory2) => client2.eventsStatus({ directory: directory2 }), "events");
        if (read.kind === "dropped") return read;
        return { ...outcome, message, status: read.kind === "ok" ? read.value : null };
      },
      async updateProject() {
        let message = "";
        const outcome = await writing(
          async (directory2) => {
            try {
              return await client2.migrateSchema({ directory: directory2, confirm: true });
            } catch (thrown) {
              message = asRequestError(thrown).message;
              throw thrown;
            }
          },
          (value) => ({ kind: "ok", value })
        );
        if (outcome.kind === "ok") {
          failures = 0;
          await poll(true);
        }
        return outcome.kind === "uncertain" ? { ...outcome, message } : outcome;
      },
      checkProject() {
        failures = 0;
        return poll(true);
      },
      readHistory(request) {
        return reading((directory2) => client2.history({ directory: directory2, ...request }), "history");
      },
      readMemories(query) {
        return reading((directory2) => client2.memories({ directory: directory2, ...query ? { query } : {} }), "memories");
      },
      readExplain(id) {
        return reading((directory2) => client2.explain({ directory: directory2, id }), "explain");
      },
      readEventsStatus() {
        return reading((directory2) => client2.eventsStatus({ directory: directory2 }), "events");
      },
      create(input) {
        return writing(
          (directory2) => client2.create({ directory: directory2, input }),
          ({ bead }) => {
            applyWritten(bead);
            set({ create: null });
            showMade(bead);
            void poll();
            return { kind: "ok", value: bead };
          }
        );
      },
      comment(id, text2) {
        return writing(
          (directory2) => client2.comment({ directory: directory2, id, text: text2 }),
          ({ comment }) => {
            const bead = known(id);
            if (bead && !bead.comments.some((c3) => c3.id === comment.id)) applyWritten({ ...bead, comments: [...bead.comments, comment] });
            void poll();
            return { kind: "ok", value: comment };
          }
        );
      },
      link(change) {
        return writing(
          (directory2) => client2.dependency({ directory: directory2, ...change }),
          () => {
            const holder = known(change.from);
            if (holder) {
              const others = holder.dependencies.filter((d3) => d3.to !== change.to);
              const createdBy = state.snapshot?.panelActor || null;
              const dependencies = change.op === "add" ? [...others, { from: change.from, to: change.to, kind: change.kind, createdBy, createdAt: null }] : others;
              applyWritten({ ...holder, dependencies });
            }
            void poll();
            return { kind: "ok", value: null };
          }
        );
      },
      notify(message) {
        host2.toast({ kind: "success", message }).catch(() => {
        });
      },
      setListCursor(id) {
        listCursor = id;
      },
      openCreate() {
        if (!state.snapshot) return;
        const from = shownEntry()?.id ?? (state.view === "epic" ? listCursor : null);
        set({ create: { parentId: defaultParent(state.snapshot.beads, from) } });
      },
      closeCreate() {
        if (state.create) set({ create: null });
      },
      syncStarted(sync) {
        if (sync && state.snapshot) set({ snapshot: { ...state.snapshot, sync } });
        void poll();
      },
      dispose() {
        disposed = true;
        clearTimer();
        stopVisibility();
        listeners.clear();
      }
    };
  }
  function firstLoadError(state) {
    const { snapshot } = state;
    if (!snapshot) return state.error;
    if (snapshot.workspace.kind !== "ok") return null;
    const f5 = snapshot.freshness;
    if (f5.localRefreshedAt !== null || f5.localError === null) return null;
    return { code: "local", message: f5.localError, ...f5.localErrorDetail ? { detail: f5.localErrorDetail } : {} };
  }
  var needsUpdate = (state) => state.snapshot?.workspace.kind === "ok" && !!state.snapshot.freshness.schemaUpdate;
  var StoreContext = X(null);
  function useStoreApi() {
    const store = x2(StoreContext);
    if (!store) throw new Error("StoreContext is missing");
    return store;
  }
  function useStore() {
    const store = useStoreApi();
    const [, setVersion] = d2(0);
    h2(() => {
      const bump = () => setVersion((v5) => v5 + 1);
      const stop = store.subscribe(bump);
      bump();
      return stop;
    }, [store]);
    return store.get();
  }
  function useNow(everyMs = 1e3) {
    const [time, setTime] = d2(Date.now);
    h2(() => {
      const id = setInterval(() => setTime(Date.now()), everyMs);
      return () => clearInterval(id);
    }, [everyMs]);
    return time;
  }
  function useOverlay(name, open) {
    const store = useStoreApi();
    h2(() => {
      store.setOverlay(name, open);
      return () => store.setOverlay(name, false);
    }, [store, name, open]);
  }

  // node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
  var f3 = 0;
  function u3(e3, t3, n2, o3, i3, u4) {
    t3 || (t3 = {});
    var a5, c3, p3 = t3;
    if ("ref" in p3) for (c3 in p3 = {}, t3) "ref" == c3 ? a5 = t3[c3] : p3[c3] = t3[c3];
    var l3 = { type: e3, props: p3, key: n2, ref: a5, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --f3, __i: -1, __u: 0, __source: i3, __self: u4 };
    if ("function" == typeof e3 && (a5 = e3.defaultProps)) for (c3 in a5) void 0 === p3[c3] && (p3[c3] = a5[c3]);
    return l.vnode && l.vnode(l3), l3;
  }

  // src/panel/ui/EmptyState.tsx
  function Thread({ tone: tone2 }) {
    return /* @__PURE__ */ u3("svg", { class: "bd-thread", "data-tone": tone2, width: "72", height: "20", viewBox: "0 0 72 20", "aria-hidden": "true", focusable: "false", children: [
      /* @__PURE__ */ u3("path", { class: "bd-thread-line", d: "M2 10h68" }),
      /* @__PURE__ */ u3("circle", { class: "bd-thread-bead", cx: "16", cy: "10", r: "5" }),
      /* @__PURE__ */ u3("circle", { class: "bd-thread-mid", cx: "36", cy: "10", r: "6" }),
      /* @__PURE__ */ u3("circle", { class: "bd-thread-bead", cx: "56", cy: "10", r: "5" })
    ] });
  }
  function EmptyState({ tone: tone2, title, body, children }) {
    return /* @__PURE__ */ u3("section", { class: "bd-empty", "data-tone": tone2, children: [
      /* @__PURE__ */ u3(Thread, { tone: tone2 }),
      /* @__PURE__ */ u3("h2", { class: "bd-empty-title", children: title }),
      body !== void 0 && /* @__PURE__ */ u3("p", { class: "bd-empty-body", children: body }),
      children !== void 0 && /* @__PURE__ */ u3("div", { class: "bd-empty-actions", children })
    ] });
  }
  var MIN_BD = "1.2.2";
  function workspaceCopy(workspace) {
    switch (workspace.kind) {
      case "no-bd":
        return { tone: "missing", title: "Beads isn't installed on this computer.", body: "Install Beads, then retry. The panel finds it on its own." };
      case "bd-too-old":
        return {
          tone: "warning",
          title: "This version of Beads is too old.",
          body: workspace.lastOpenedWith ? `This project was last opened with Beads ${workspace.lastOpenedWith}. This panel uses ${workspace.bdVersion}, which is older. Update Beads to open it here.` : `The panel needs Beads ${MIN_BD} or newer, and this computer has ${workspace.bdVersion}. Update Beads, then retry.`
        };
      case "no-workspace":
        return { tone: "neutral", title: "This project doesn't use Beads.", body: "Beads keeps a project's issues next to its code. Ask your agent to set it up here, then retry." };
      case "pre-dolt":
        return {
          tone: "warning",
          title: "This project uses an older Beads format.",
          body: "The panel can't read this format. Ask your agent to upgrade the project's Beads data to the current format, then retry."
        };
      case "needs-first-contact":
        return {
          tone: "ask",
          title: `Open this project with Beads ${workspace.bdVersion}?`,
          // Opening updates nothing: a project on an older format is shown the update, which asks again before it runs.
          body: `This project was last opened with Beads ${workspace.lastOpenedWith}. Opening it lets Beads check the project. If it is on an older format, Abacus will ask before updating it.`
        };
      case "server-down":
        return {
          tone: "error",
          title: "This project's Beads server isn't running.",
          body: "Start it the way you usually do, then retry. The panel never starts it for you.",
          detail: `The Beads database server for ${workspace.root} is expected on port ${workspace.port} and did not answer.`
        };
      case "ok":
        return { tone: "neutral", title: "This project is ready.", body: "" };
      default:
        return { tone: "neutral", title: "Beads can't open this project right now.", body: "Retry in a moment. If this keeps happening, update the Beads extension." };
    }
  }
  function RetryButton({ primary: primary2 = false }) {
    const store = useStoreApi();
    const [checking, setChecking] = d2(false);
    h2(() => {
      if (!checking) return;
      const id = setTimeout(() => setChecking(false), 900);
      return () => clearTimeout(id);
    }, [checking]);
    return /* @__PURE__ */ u3(
      "button",
      {
        type: "button",
        class: primary2 ? "bd-btn bd-btn-primary" : "bd-btn",
        "aria-busy": checking,
        disabled: checking,
        onClick: () => {
          setChecking(true);
          store.retry();
        },
        children: [
          checking && /* @__PURE__ */ u3("span", { class: "bd-spin", "aria-hidden": "true" }),
          "Retry"
        ]
      }
    );
  }
  function CopyDetails({ error, always = false }) {
    const store = useStoreApi();
    if (!error.detail && !always) return null;
    return /* @__PURE__ */ u3("button", { type: "button", class: "bd-link", onClick: () => store.copyDetails(error), children: "Copy details" });
  }
  function WorkspaceEmpty({ workspace }) {
    const state = useStore();
    const store = useStoreApi();
    const { title, body, tone: tone2, detail } = workspaceCopy(workspace);
    if (workspace.kind !== "needs-first-contact") {
      return /* @__PURE__ */ u3(EmptyState, { tone: tone2, title, body, children: [
        /* @__PURE__ */ u3(RetryButton, { primary: true }),
        detail && /* @__PURE__ */ u3(CopyDetails, { error: { code: "workspace", message: title, detail } })
      ] });
    }
    return /* @__PURE__ */ u3(EmptyState, { tone: tone2, title, body, children: [
      /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-primary", disabled: state.confirming, "aria-busy": state.confirming, onClick: () => void store.confirmFirstContact(), children: [
        state.confirming && /* @__PURE__ */ u3("span", { class: "bd-spin", "aria-hidden": "true" }),
        "Open project"
      ] }),
      /* @__PURE__ */ u3("p", { class: "bd-empty-note", children: "You only need to confirm this once for this project." }),
      state.confirmError && /* @__PURE__ */ u3("p", { class: "bd-empty-error", role: "alert", children: [
        state.confirmError.message,
        " ",
        /* @__PURE__ */ u3(CopyDetails, { error: state.confirmError })
      ] })
    ] });
  }
  function LoadError() {
    const error = firstLoadError(useStore());
    if (!error) return null;
    return /* @__PURE__ */ u3(EmptyState, { tone: "error", title: "Couldn't load this project's beads.", children: [
      /* @__PURE__ */ u3(RetryButton, { primary: true }),
      /* @__PURE__ */ u3(CopyDetails, { error, always: true })
    ] });
  }
  function NoProject() {
    return /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: "Open a project to see its beads." });
  }
  function NoBeads() {
    return /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: "No beads in this project yet.", body: "When your agent creates beads, they show up here within a few seconds." });
  }
  function Loading() {
    const widths = [72, 54, 88, 61, 79, 46, 67];
    return /* @__PURE__ */ u3("div", { class: "bd-skeleton", "aria-busy": "true", "aria-label": "Loading beads", children: widths.map((w4, i3) => /* @__PURE__ */ u3("div", { class: "bd-skel-row", style: { "--w": `${w4}%`, "--d": `${i3 * 70}ms` }, children: [
      /* @__PURE__ */ u3("i", { class: "bd-skel-dot" }),
      /* @__PURE__ */ u3("i", { class: "bd-skel-id" }),
      /* @__PURE__ */ u3("i", { class: "bd-skel-bar" })
    ] }, i3)) });
  }

  // src/panel/ui/ProjectUpdate.tsx
  var UPDATE_TITLE = "This project needs a one-time update for the newer Beads.";
  var SYNC_WAIT = "Wait for the sync to finish, then try again.";
  var REREAD = "Reading the project again.";
  function UpdateConsent({ busy, onCancel, onConfirm }) {
    return /* @__PURE__ */ u3(
      "div",
      {
        class: "bd-pm-ask bd-upd-ask",
        role: "alertdialog",
        "aria-labelledby": "bd-upd-ask-t",
        "aria-describedby": "bd-upd-ask-d",
        onKeyDown: (e3) => {
          if (e3.key !== "Escape") return;
          e3.preventDefault();
          e3.stopPropagation();
          if (!busy) onCancel();
        },
        children: [
          /* @__PURE__ */ u3("p", { class: "bd-pm-ask-t", id: "bd-upd-ask-t", children: "Update this project?" }),
          /* @__PURE__ */ u3("div", { class: "bd-pm-ask-d", id: "bd-upd-ask-d", children: [
            /* @__PURE__ */ u3("p", { children: "Beads updates this project's data to the new format. This happens once." }),
            /* @__PURE__ */ u3("p", { children: "Your beads themselves don't change." }),
            /* @__PURE__ */ u3("p", { children: "Tools that use an older Beads may not open this project afterwards." })
          ] }),
          /* @__PURE__ */ u3("div", { class: "bd-pm-ask-acts", children: [
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", "data-focus": "cancel", disabled: busy, onClick: onCancel, children: "Cancel" }),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", "data-focus": "go", "aria-busy": busy || void 0, "aria-disabled": busy || void 0, onClick: onConfirm, children: [
              busy && /* @__PURE__ */ u3("span", { class: "bd-spin", "aria-hidden": "true" }),
              busy ? "Updating\u2026" : "Update"
            ] })
          ] })
        ]
      }
    );
  }
  function focusList(attempts = 20) {
    const active2 = document.activeElement;
    if (active2 && active2 !== document.body) return;
    const list = document.querySelector('.bd-body [role="listbox"]');
    if (list) {
      list.focus({ preventScroll: true });
      return;
    }
    if (attempts > 0) setTimeout(() => focusList(attempts - 1), 150);
  }
  function failureNote(job) {
    if (job.code === "uncertain" || job.saved) {
      const said = job.saved ? "The update may have finished, but Beads didn't confirm it." : job.message || "Beads didn't say whether the update finished.";
      return { note: { tone: "info", text: `${said} ${REREAD}` }, unsure: true };
    }
    return {
      note: { tone: "error", text: job.code === "sync-running" ? SYNC_WAIT : job.message, ...job.detail ? { detail: job.detail } : {}, ...job.code === "busy" ? { again: true } : {} },
      unsure: false
    };
  }
  function ProjectUpdate() {
    const store = useStoreApi();
    const state = useStore();
    const raw = state.snapshot?.freshness.localErrorDetail ?? null;
    const job = state.snapshot?.freshness.schemaUpdateJob ?? null;
    const kept = state.directory !== null ? state.sharedUpdates[state.directory] : void 0;
    const [phase, setPhase] = d2("idle");
    const [submitting, setSubmitting] = d2(false);
    const [seen, setSeen] = d2(null);
    const [note, setNote] = d2(null);
    const [lost, setLost] = d2(false);
    const alive = A2(true);
    const box = A2(null);
    const focusNext = A2(null);
    const holds = A2(false);
    const lastEnd = A2(job?.kind === "failed" ? job.at : null);
    const running = submitting || job?.kind === "running";
    const failure = job?.kind === "failed" && job.at !== seen ? job : null;
    const said = failure ? failureNote(failure) : null;
    const shared = kept ?? (failure?.code === "update-blocked-shared" ? { message: failure.message, ...failure.detail ? { detail: failure.detail } : {} } : null);
    const unsure = !shared && !running && (lost || said?.unsure === true);
    const shownNote = shared ? { tone: "error", text: shared.message, ...shared.detail ? { detail: shared.detail } : {} } : running ? null : note ?? said?.note ?? null;
    _2(() => {
      const end = job?.kind === "failed" ? job.at : null;
      if (end === lastEnd.current) return;
      lastEnd.current = end;
      if (end !== null) focusNext.current = unsure || shared ? "note" : "go";
    });
    _2(() => {
      const want = focusNext.current;
      if (!want) return;
      focusNext.current = null;
      box.current?.querySelector(`[data-focus="${want}"]`)?.focus();
    });
    h2(
      () => () => {
        alive.current = false;
        if (holds.current) setTimeout(focusList, 0);
      },
      []
    );
    const send = async () => {
      if (running) return;
      setSeen(job?.kind === "failed" ? job.at : seen);
      setSubmitting(true);
      setNote(null);
      setLost(false);
      const outcome = await store.updateProject();
      if (!alive.current) return;
      setSubmitting(false);
      if (outcome.kind === "dropped") return;
      setPhase("idle");
      if (outcome.kind === "ok") {
        return;
      }
      if (outcome.kind === "uncertain") {
        const text2 = outcome.saved ? "The update may have finished, but Beads didn't confirm it." : outcome.message || "Beads didn't say whether the update finished.";
        setLost(true);
        setNote({ tone: "info", text: `${text2} ${REREAD}` });
        focusNext.current = "note";
      } else if (outcome.kind === "error") {
        const { code, message, detail: detail2 } = outcome.error;
        setNote({ tone: "error", text: code === "sync-running" ? SYNC_WAIT : message, ...detail2 ? { detail: detail2 } : {}, ...code === "busy" ? { again: true } : {} });
        focusNext.current = "go";
      }
    };
    const check = async () => {
      setPhase("checking");
      await store.checkProject();
      if (!alive.current) return;
      setPhase("idle");
      const now = store.get().snapshot?.freshness.schemaUpdateJob ?? null;
      if (now?.kind === "running") return;
      setSeen(now?.kind === "failed" ? now.at : seen);
      setLost(false);
      setNote({ tone: "info", text: "This project still needs the update." });
      focusNext.current = "go";
    };
    const asking = !shared && (running || phase === "asking");
    const say = running ? "Updating this project. This can take a minute or two." : phase === "checking" ? "Reading the project again\u2026" : "";
    const detail = shownNote?.detail ?? raw;
    return /* @__PURE__ */ u3(
      "section",
      {
        ref: box,
        class: "bd-empty bd-upd",
        "data-tone": "ask",
        "aria-labelledby": "bd-upd-t",
        onFocusIn: () => {
          holds.current = true;
        },
        onFocusOut: (e3) => {
          const to = e3.relatedTarget;
          if (to && !box.current?.contains(to)) holds.current = false;
        },
        children: [
          /* @__PURE__ */ u3(Thread, { tone: "ask" }),
          /* @__PURE__ */ u3("h2", { class: "bd-empty-title", id: "bd-upd-t", children: UPDATE_TITLE }),
          /* @__PURE__ */ u3("p", { class: "bd-empty-body", children: "It was made with an older version of Beads, and Abacus can't read its beads until it's updated." }),
          /* @__PURE__ */ u3("div", { class: "bd-upd-acts", children: [
            shownNote && /* @__PURE__ */ u3("p", { class: "bd-pm-note bd-upd-note", "data-tone": shownNote.tone, "data-focus": "note", tabIndex: -1, role: shownNote.tone === "error" ? "alert" : "status", children: shownNote.text }),
            asking ? /* @__PURE__ */ u3(
              UpdateConsent,
              {
                busy: running,
                onCancel: () => {
                  setPhase("idle");
                  focusNext.current = "go";
                },
                onConfirm: () => void send()
              }
            ) : unsure || phase === "checking" ? /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-primary", "data-focus": "go", "aria-busy": phase === "checking" || void 0, "aria-disabled": phase === "checking" || void 0, onClick: () => phase !== "checking" && void check(), children: [
              phase === "checking" && /* @__PURE__ */ u3("span", { class: "bd-spin", "aria-hidden": "true" }),
              "Check again"
            ] }) : shared ? null : shownNote?.again ? /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-primary", "data-focus": "go", onClick: () => void send(), children: "Try again" }) : /* @__PURE__ */ u3(
              "button",
              {
                type: "button",
                class: "bd-btn bd-btn-primary",
                "data-focus": "go",
                onClick: () => {
                  setNote(null);
                  setSeen(job?.kind === "failed" ? job.at : seen);
                  setPhase("asking");
                  focusNext.current = "cancel";
                },
                children: "Update project"
              }
            ),
            /* @__PURE__ */ u3("p", { class: "bd-upd-say", role: "status", children: say }),
            detail && /* @__PURE__ */ u3("details", { class: "bd-upd-more", children: [
              /* @__PURE__ */ u3("summary", { children: "Details" }),
              /* @__PURE__ */ u3("pre", { class: "bd-upd-raw", children: detail })
            ] })
          ] })
        ]
      }
    );
  }

  // src/panel/ui/icons.tsx
  function Icon({ size = 14, children }) {
    return /* @__PURE__ */ u3("svg", { class: "bd-i", width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false", children });
  }
  var IconFolder = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { d: "M2 4.5c0-.6.4-1 1-1h3.2l1.3 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" }) });
  var IconSearch = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("circle", { cx: "7", cy: "7", r: "4.3" }),
    /* @__PURE__ */ u3("path", { d: "M10.2 10.2l3.3 3.3" })
  ] });
  var IconFilter = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { d: "M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z" }) });
  var IconAlert = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("path", { d: "M8 2.2l6.2 11H1.8z" }),
    /* @__PURE__ */ u3("path", { d: "M8 6.6v3M8 11.4v.1" })
  ] });
  var IconEpic = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("path", { d: "M8 2l6 3-6 3-6-3z" }),
    /* @__PURE__ */ u3("path", { d: "M2 8l6 3 6-3" }),
    /* @__PURE__ */ u3("path", { d: "M2 11l6 3 6-3" })
  ] });
  var IconChevron = (p3) => /* @__PURE__ */ u3(Icon, { size: 12, ...p3, children: /* @__PURE__ */ u3("path", { d: "M4 6l4 4 4-4" }) });
  var IconMore = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { d: "M3.5 8h.1M8 8h.1M12.5 8h.1", "stroke-width": "2.2" }) });
  var IconCopy = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("rect", { x: "5.5", y: "5.5", width: "8", height: "8", rx: "1.5" }),
    /* @__PURE__ */ u3("path", { d: "M10.5 5.5V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h1.7" })
  ] });
  var IconChat = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { d: "M2.5 4.2c0-.9.7-1.7 1.7-1.7h7.6c.9 0 1.7.8 1.7 1.7v5c0 .9-.8 1.7-1.7 1.7H7l-3 2.6v-2.6h0c-.9 0-1.5-.8-1.5-1.7z" }) });
  var IconSession = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("rect", { x: "2.5", y: "2.5", width: "11", height: "11", rx: "2.2" }),
    /* @__PURE__ */ u3("path", { d: "M8 5.5v5M5.5 8h5" })
  ] });
  var IconBranch = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("circle", { cx: "4.5", cy: "3.5", r: "1.5" }),
    /* @__PURE__ */ u3("circle", { cx: "4.5", cy: "12.5", r: "1.5" }),
    /* @__PURE__ */ u3("circle", { cx: "11.5", cy: "5.5", r: "1.5" }),
    /* @__PURE__ */ u3("path", { d: "M4.5 5v6M11.5 7c0 2.5-2 3.2-4.4 3.6-1.2.2-2.2.7-2.6 1.4" })
  ] });
  var IconSpinner = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { class: "bd-spin", d: "M8 2.5a5.5 5.5 0 1 1-5.5 5.5" }) });
  var IconSync = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("path", { d: "M13 6.5A5.2 5.2 0 0 0 3.6 5M3 9.5A5.2 5.2 0 0 0 12.4 11" }),
    /* @__PURE__ */ u3("path", { d: "M3.4 2.6v2.6H6M12.6 13.4v-2.6H10" })
  ] });
  var IconPublish = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("path", { d: "M8 10.5V2.8M5 5.6l3-3 3 3" }),
    /* @__PURE__ */ u3("path", { d: "M2.8 9.5v2.7c0 .6.4 1 1 1h8.4c.6 0 1-.4 1-1V9.5" })
  ] });
  var IconBack = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { d: "M13 8H3.5M7.5 4l-4 4 4 4" }) });
  var IconX = (p3) => /* @__PURE__ */ u3(Icon, { size: 12, ...p3, children: /* @__PURE__ */ u3("path", { d: "M4.5 4.5l7 7M11.5 4.5l-7 7" }) });
  var IconWait = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { d: "M4.5 2.5h7M4.5 13.5h7M5.5 2.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5M10.5 2.5c0 3-5 3.5-5 5.5s5 2.5 5 5.5" }) });
  var IconEdit = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { d: "M10.6 3.2l2.2 2.2-7.4 7.4-2.9.7.7-2.9zM9.4 4.4l2.2 2.2" }) });
  var IconPlus = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { d: "M8 3.5v9M3.5 8h9" }) });
  var IconLink = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { d: "M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.8.8M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.8-.8" }) });
  var IconTrash = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { d: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2c0 .5.4.8.9.8h4c.5 0 .9-.3.9-.8l.6-8.2" }) });
  var IconClock = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("circle", { cx: "8", cy: "8", r: "5.5" }),
    /* @__PURE__ */ u3("path", { d: "M8 5v3.2l2 1.3" })
  ] });
  var TYPE_PATHS = {
    bug: /* @__PURE__ */ u3("path", { d: "M5.6 5.4a2.4 2.4 0 0 1 4.8 0M4.6 8.8a3.4 3.4 0 0 1 6.8 0v.8a3.4 3.4 0 0 1-6.8 0zM8 7.5V13M2.2 8.6h2.4M11.4 8.6h2.4M2.8 12.6l1.9-1M13.2 12.6l-1.9-1M3.2 4.6l1.7 1.3M12.8 4.6l-1.7 1.3" }),
    feature: /* @__PURE__ */ u3("path", { d: "M8 1.8l1.7 3.9 4.1.4-3.1 2.8.9 4.1L8 10.9 4.4 13l.9-4.1-3.1-2.8 4.1-.4z" }),
    task: /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("rect", { x: "2.5", y: "2.5", width: "11", height: "11", rx: "2.2" }),
      /* @__PURE__ */ u3("path", { d: "M5.4 8.1l1.9 1.9 3.4-3.7" })
    ] }),
    epic: /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("path", { d: "M8 2l6 3-6 3-6-3z" }),
      /* @__PURE__ */ u3("path", { d: "M2 8l6 3 6-3" }),
      /* @__PURE__ */ u3("path", { d: "M2 11l6 3 6-3" })
    ] }),
    chore: /* @__PURE__ */ u3("path", { d: "M10.6 2.3a3.1 3.1 0 0 0-2.9 4.1L2.4 11.7l1.9 1.9 5.3-5.3a3.1 3.1 0 0 0 4.1-2.9l-1.9 1.9-1.8-.4-.4-1.8z" }),
    decision: /* @__PURE__ */ u3("path", { d: "M8 2l6 6-6 6-6-6zM8 5.5v3M8 10.5v.1" }),
    spike: /* @__PURE__ */ u3("path", { d: "M9 1.8L3.8 9H8l-1 5.2L12.2 7H8z" }),
    story: /* @__PURE__ */ u3("path", { d: "M3 3.2c1.7-.6 3.4-.4 5 .8 1.6-1.2 3.3-1.4 5-.8v9.5c-1.7-.6-3.4-.4-5 .8-1.6-1.2-3.3-1.4-5-.8zM8 4v9.5" }),
    milestone: /* @__PURE__ */ u3("path", { d: "M4 14V2.5M4 3h8.5l-2 3 2 3H4" }),
    incident: /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("path", { d: "M8 2.2l6.2 11H1.8z" }),
      /* @__PURE__ */ u3("path", { d: "M8 6.6v3M8 11.4v.1" })
    ] })
  };
  function TypeIcon({ type, size }) {
    const known = Object.prototype.hasOwnProperty.call(TYPE_PATHS, type);
    return /* @__PURE__ */ u3(Icon, { size, children: known ? TYPE_PATHS[type] : /* @__PURE__ */ u3("rect", { x: "3", y: "3", width: "10", height: "10", rx: "2.2", "stroke-dasharray": "2 1.8" }) });
  }
  var IconRestore = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("path", { d: "M3.5 6.5h6.2a3.3 3.3 0 0 1 0 6.6H6" }),
    /* @__PURE__ */ u3("path", { d: "M6 3.8L3.3 6.5 6 9.2" })
  ] });

  // src/panel/ui/AttachFooter.tsx
  function useRowActions() {
    const store = useStoreApi();
    const agent = useAgent();
    const { session, busy } = useAgentState();
    return {
      addToChat: (id) => void agent?.attach(id),
      startSession: (id) => void agent?.startSession(id),
      startInWorktree: (id) => store.confirmLeave(() => agent?.askWorktree(id)),
      copyId: (id) => store.copyText(id),
      noChat: session === null,
      busy: busy !== null
    };
  }
  var RUNNING = { attach: "Adding\u2026", session: "Starting\u2026", worktree: "Starting\u2026" };
  function AttachFooter({ id }) {
    const agent = useAgent();
    const store = useStoreApi();
    const { session, busy } = useAgentState();
    if (!agent) return null;
    const mine = busy?.id === id ? busy.kind : null;
    const slow = mine === "session" || mine === "worktree";
    const button2 = (kind, label, icon2, run, off = false) => /* @__PURE__ */ u3(
      "button",
      {
        type: "button",
        class: "bd-attach-btn",
        "data-attach": kind,
        "data-running": mine === kind || void 0,
        disabled: busy !== null || off,
        onClick: run,
        children: [
          mine === kind ? /* @__PURE__ */ u3(IconSpinner, { size: 13 }) : icon2,
          /* @__PURE__ */ u3("span", { children: mine === kind ? RUNNING[kind] : label })
        ]
      }
    );
    return /* @__PURE__ */ u3("footer", { class: "bd-attach", role: "group", "aria-label": "Attach to", "aria-busy": mine !== null, children: [
      /* @__PURE__ */ u3("div", { class: "bd-attach-top", children: [
        /* @__PURE__ */ u3("span", { class: "bd-attach-lab", children: "Attach to" }),
        slow ? /* @__PURE__ */ u3("span", { class: "bd-attach-note", role: "status", children: "Starting a session. This can take up to 3 minutes." }) : session ? /* @__PURE__ */ u3("span", { class: "bd-attach-note", title: session.title, children: [
          /* @__PURE__ */ u3("span", { class: "bd-attach-dot", "aria-hidden": "true" }),
          session.title || "Open chat"
        ] }) : /* @__PURE__ */ u3("span", { class: "bd-attach-note", "data-tone": "muted", children: "No open chat. Start a new session instead." })
      ] }),
      /* @__PURE__ */ u3("div", { class: "bd-attach-acts", "data-nochat": session === null || void 0, children: [
        button2("attach", "Current chat", /* @__PURE__ */ u3(IconChat, { size: 13 }), () => void agent.attach(id), session === null),
        button2("session", "New session", /* @__PURE__ */ u3(IconSession, { size: 13 }), () => void agent.startSession(id)),
        button2("worktree", "In worktree\u2026", /* @__PURE__ */ u3(IconBranch, { size: 13 }), () => store.confirmLeave(() => agent.askWorktree(id)))
      ] })
    ] });
  }

  // src/panel/keyboard.ts
  function listKey({ key, ids, cursor, focus: focus2 }) {
    if (focus2 === "field") return null;
    const at2 = cursor === null ? -1 : ids.indexOf(cursor);
    const move = (step) => {
      if (ids.length === 0) return null;
      const next = at2 < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, at2 + step));
      return { type: "move", id: ids[next] };
    };
    switch (key) {
      case "ArrowDown":
        return move(1);
      case "ArrowUp":
        return move(-1);
      case "Enter":
        return at2 < 0 || focus2 === "control" ? null : { type: "open", id: ids[at2] };
      case "Escape":
        return { type: "escape" };
    }
    if (focus2 === "search") return null;
    switch (key) {
      case "j":
        return move(1);
      case "k":
        return move(-1);
      case "/":
        return { type: "search" };
      case "ContextMenu":
        return at2 < 0 || focus2 === "control" ? null : { type: "menu", id: ids[at2] };
    }
    return null;
  }
  var isMac = () => /Mac|iPhone|iPad/i.test(typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent);
  var saveKey = () => isMac() ? "\u2318\u21B5" : "Ctrl+Enter";
  var composing = (e3) => e3.isComposing || e3.keyCode === 229;
  var isSubmitKey = (e3) => !composing(e3) && (e3.metaKey || e3.ctrlKey) && e3.key === "Enter";
  var isEnterInInput = (e3) => e3.key === "Enter" && !composing(e3) && !e3.shiftKey && !e3.altKey && !e3.metaKey && !e3.ctrlKey && e3.target instanceof HTMLInputElement;
  var isConfirmKey = (e3) => e3.key === "Enter" && !composing(e3) && !e3.shiftKey && !e3.altKey && !(e3.target instanceof HTMLButtonElement);
  var FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  function trapTab(e3, dialog) {
    if (e3.key !== "Tab" || !dialog) return;
    const items = Array.from(dialog.querySelectorAll(FOCUSABLE));
    if (items.length === 0) return;
    const at2 = items.indexOf(document.activeElement);
    const next = e3.shiftKey ? at2 <= 0 ? items.length - 1 : -1 : at2 === items.length - 1 || at2 < 0 ? 0 : -1;
    if (next < 0) return;
    e3.preventDefault();
    items[next].focus();
  }

  // src/panel/ui/WorktreeSheet.tsx
  function WorktreeSheet() {
    const agent = useAgent();
    const store = useStoreApi();
    const { sheet, busy } = useAgentState();
    const [name, setName] = d2("");
    const [base, setBase] = d2("");
    const [problem, setProblem] = d2(null);
    const field = A2(null);
    const dialog = A2(null);
    const starting = busy?.kind === "worktree";
    useOverlay("worktree", sheet !== null);
    h2(() => {
      setName(sheet?.name ?? "");
      setBase("");
      setProblem(null);
      if (sheet) queueMicrotask(() => field.current?.select());
    }, [sheet?.id, sheet?.name]);
    if (!agent || !sheet) return null;
    const submit = () => {
      if (starting) return;
      const wanted = name.trim();
      if (!validBranchName(wanted)) {
        setProblem("Use letters, numbers, dots, dashes and slashes, with no spaces.");
        field.current?.focus();
        return;
      }
      void agent.startInWorktree(wanted, base);
    };
    return /* @__PURE__ */ u3("div", { class: "bd-sheet", children: [
      /* @__PURE__ */ u3("div", { class: "bd-scrim", "aria-hidden": "true", onClick: () => agent.cancelWorktree() }),
      /* @__PURE__ */ u3(
        "div",
        {
          ref: dialog,
          class: "bd-create bd-wt",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "New session in a worktree",
          "aria-busy": starting,
          onKeyDown: (e3) => {
            trapTab(e3, dialog.current);
            if (isEnterInInput(e3)) {
              e3.preventDefault();
              submit();
              return;
            }
            if (e3.key !== "Escape") return;
            e3.preventDefault();
            e3.stopPropagation();
            agent.cancelWorktree();
          },
          children: [
            /* @__PURE__ */ u3("div", { class: "bd-wt-head", children: [
              /* @__PURE__ */ u3("span", { class: "bd-wt-ic", "aria-hidden": "true", children: /* @__PURE__ */ u3(IconBranch, { size: 15 }) }),
              /* @__PURE__ */ u3("div", { class: "bd-wt-headtext", children: [
                /* @__PURE__ */ u3("h2", { class: "bd-wt-title", children: "New session in a worktree" }),
                /* @__PURE__ */ u3("p", { class: "bd-wt-bead", children: [
                  /* @__PURE__ */ u3("span", { class: "bd-id", children: shortId(sheet.id) }),
                  /* @__PURE__ */ u3("span", { class: "bd-wt-beadtitle", children: sheet.title })
                ] })
              ] })
            ] }),
            /* @__PURE__ */ u3("label", { class: "bd-cf", children: [
              /* @__PURE__ */ u3("span", { children: "Branch and worktree name" }),
              /* @__PURE__ */ u3(
                "input",
                {
                  ref: field,
                  class: "bd-input bd-wt-mono",
                  value: name,
                  spellcheck: false,
                  autoComplete: "off",
                  readOnly: starting,
                  "aria-invalid": problem !== null,
                  "aria-describedby": problem ? "bd-wt-problem" : void 0,
                  onInput: (e3) => {
                    setName(e3.currentTarget.value);
                    setProblem(null);
                  }
                }
              )
            ] }),
            problem && /* @__PURE__ */ u3("p", { id: "bd-wt-problem", class: "bd-wt-err", role: "alert", children: problem }),
            /* @__PURE__ */ u3("label", { class: "bd-cf", children: [
              /* @__PURE__ */ u3("span", { children: "Start from" }),
              /* @__PURE__ */ u3(
                "input",
                {
                  class: "bd-input bd-wt-mono",
                  value: base,
                  placeholder: "Project default branch",
                  spellcheck: false,
                  autoComplete: "off",
                  readOnly: starting,
                  onInput: (e3) => setBase(e3.currentTarget.value)
                }
              )
            ] }),
            /* @__PURE__ */ u3("p", { class: "bd-wt-note", role: starting ? "status" : void 0, children: starting ? "Making the worktree and starting the session. This can take up to 3 minutes." : "The worktree is a separate copy of the project, so your open files stay as they are. Nothing is sent." }),
            /* @__PURE__ */ u3("div", { class: "bd-wt-tip", children: [
              /* @__PURE__ */ u3("p", { children: [
                "The new chat is linked to the bead. To add the bead\u2019s details there, type ",
                /* @__PURE__ */ u3("code", { children: `/bd ${sheet.id}` }),
                " in it."
              ] }),
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", "aria-label": `Copy /bd ${sheet.id}`, onClick: () => store.copyText(`/bd ${sheet.id}`), children: [
                /* @__PURE__ */ u3(IconCopy, { size: 12 }),
                "Copy"
              ] })
            ] }),
            /* @__PURE__ */ u3("div", { class: "bd-edacts", children: [
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: starting, onClick: () => agent.cancelWorktree(), children: "Cancel" }),
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: starting, onClick: submit, children: starting ? /* @__PURE__ */ u3(S, { children: [
                /* @__PURE__ */ u3(IconSpinner, { size: 12 }),
                "Starting\u2026"
              ] }) : "Start session" })
            ] })
          ]
        }
      )
    ] });
  }

  // src/panel/sync.ts
  var SUPERSEDED_NAMED_MAX = 3;
  function supersededText(edits, beads) {
    const named = edits.slice(0, SUPERSEDED_NAMED_MAX).map((edit) => {
      const title = beads.find((bead) => bead.id === edit.beadId)?.title;
      const who = title ? `"${title}"` : shortId(edit.beadId);
      return edit.fields.length > 0 ? `${who} (${edit.fields.join(", ")})` : who;
    });
    const more = edits.length - named.length;
    return `Both sides edited the same thing, so the newer edit was kept: ${named.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`;
  }
  function syncProblem(snapshot) {
    if (!snapshot || snapshot.workspace.kind !== "ok") return null;
    const sync = snapshot.sync;
    if (sync.kind === "error" && sync.code === "preview-stale") return null;
    return sync.kind === "conflict" || sync.kind === "error" || sync.kind === "paused-upgrade" ? sync : null;
  }
  var LABEL = { pull: "Sync", publish: "Publish" };
  var changesText = (n2) => n2 === 1 ? "1 change" : `${n2} changes`;
  function problemMessage(problem) {
    if (problem.kind !== "conflict") return problem.message;
    return problem.halfMerged ? "Editing is paused until this is resolved." : "Your changes are safe. The team's copy has edits to the same fields.";
  }
  function createSync({ client: client2, host: host2, store }) {
    let ui = { preview: null, starting: null, dismissed: null };
    const listeners = /* @__PURE__ */ new Set();
    const set = (patch) => {
      ui = { ...ui, ...patch };
      listeners.forEach((l3) => l3());
    };
    const toast = (kind, message, copy) => host2.toast({ kind, message: message.slice(0, TOAST_MAX), ...copy ? { copy: { text: copy.slice(0, COPY_MAX) } } : {} }).catch(() => {
    });
    let awaiting = null;
    let previewSeq = 0;
    let generation = store.get().generation;
    store.subscribe(() => {
      const state = store.get();
      if (state.generation !== generation) {
        generation = state.generation;
        awaiting = null;
        previewSeq++;
        if (ui.preview || ui.starting || ui.dismissed) set({ preview: null, starting: null, dismissed: null });
        return;
      }
      if (!awaiting || awaiting.generation !== state.generation) return;
      const sync = state.snapshot?.sync;
      if (!sync || sync.kind === "running") return;
      const done = awaiting;
      awaiting = null;
      if (sync.kind === "idle") {
        const lead = done.op === "pull" ? "Synced." : `Published ${changesText(done.count)}.`;
        if (sync.superseded && sync.superseded.length > 0) toast("info", `${lead} ${supersededText(sync.superseded, state.snapshot?.beads ?? [])}`, sync.log);
        else toast("success", lead);
      } else if (done.op === "publish" && sync.kind === "error" && sync.code === "preview-stale") void openPreview(sync.message);
    });
    const running = () => ui.starting !== null || store.get().snapshot?.sync.kind === "running";
    const otherJob = (op) => toast("info", `${LABEL[op]} didn't start because a sync is running. Try again when it finishes.`);
    async function begin(op, count, send) {
      const { directory: directory2, generation: gen } = store.get();
      if (directory2 === null) return;
      if (running()) {
        if (op === "publish") otherJob(op);
        return;
      }
      set({ starting: op });
      let reopen = null;
      try {
        const { sync } = await send(directory2);
        if (store.get().generation !== gen) return;
        if (sync.kind === "running" && sync.op !== op) otherJob(op);
        else {
          awaiting = { op, count, generation: gen };
          if (ui.dismissed) set({ dismissed: null });
        }
        store.syncStarted(sync);
      } catch (thrown) {
        if (store.get().generation !== gen) return;
        const error = asRequestError(thrown);
        if (ANSWER_LOST.has(error.code)) {
          toast("info", `${LABEL[op]} may have started. The team line shows when it is done.`, error.detail);
          store.syncStarted(null);
        } else if (error.code === "sync-running") {
          otherJob(op);
          store.syncStarted(null);
        } else if (error.code === "preview-stale") {
          reopen = error.message;
        } else {
          toast("error", `Couldn't start ${LABEL[op]}. ${error.message}`, error.detail);
          if (error.workspace) store.syncStarted(null);
        }
      } finally {
        if (store.get().generation === gen) set({ starting: null });
      }
      if (reopen !== null && store.get().generation === gen) await openPreview(reopen);
    }
    async function openPreview(notice) {
      const { directory: directory2, generation: gen } = store.get();
      if (directory2 === null || running()) return;
      const seq = ++previewSeq;
      set({ preview: { kind: "loading" } });
      const current = () => seq === previewSeq && ui.preview !== null && store.get().generation === gen;
      try {
        const answer = await client2.syncPreview({ directory: directory2 });
        if (!current()) return;
        const changes = Array.isArray(answer.changes) ? answer.changes : [];
        const total = changes.length > 0 ? Math.max(changes.length, typeof answer.total === "number" ? answer.total : 0) : 0;
        const head = typeof answer.head === "string" ? answer.head : void 0;
        set({ preview: { kind: "ready", changes, noRemote: answer.noRemote === true, total, ...head ? { head } : {}, ...notice ? { notice } : {}, ...answer.teamEmpty === true ? { teamEmpty: true } : {}, ...answer.teamUnseen === true ? { teamUnseen: true } : {} } });
      } catch (thrown) {
        if (!current()) return;
        const error = asRequestError(thrown);
        set({ preview: { kind: "error", error: error.detail ? { code: error.code, message: error.message, detail: error.detail } : { code: error.code, message: error.message } } });
      }
    }
    return {
      get: () => ui,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      pull: () => begin("pull", 0, (directory2) => client2.syncPull({ directory: directory2 })),
      openPublish: (notice) => openPreview(notice),
      closePublish() {
        previewSeq++;
        if (ui.preview) set({ preview: null });
      },
      async confirmPublish() {
        const preview = ui.preview;
        if (preview?.kind !== "ready" || preview.noRemote || preview.teamEmpty || preview.teamUnseen || preview.changes.length === 0 || !preview.head) return;
        const expectedHead = preview.head;
        previewSeq++;
        set({ preview: null });
        await begin("publish", preview.total, (directory2) => client2.syncPublish({ directory: directory2, expectedHead }));
      },
      dismiss(problem) {
        if (problem.kind === "error") set({ dismissed: problem });
      },
      copyDetails(problem) {
        store.copyDetails({ code: "sync", message: problemMessage(problem), ...problem.log ? { detail: problem.log } : {} });
      }
    };
  }
  var SyncContext = X(null);
  var IDLE2 = { preview: null, starting: null, dismissed: null };
  var useSync = () => x2(SyncContext);
  function useSyncUi() {
    const sync = useSync();
    const [, setVersion] = d2(0);
    h2(() => {
      if (!sync) return;
      const bump = () => setVersion((v5) => v5 + 1);
      const stop = sync.subscribe(bump);
      bump();
      return stop;
    }, [sync]);
    return sync?.get() ?? IDLE2;
  }

  // src/panel/ui/ConflictView.tsx
  var VALUE_MAX = 64;
  var BEADS_SHOWN = 3;
  var TITLES = {
    conflict: "Sync needs attention",
    error: "Sync ran into a problem",
    "paused-upgrade": "Sync is paused"
  };
  var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  function valueText(field, value, statuses) {
    if (value === void 0 || value === null) return "none";
    if (value === "") return "empty";
    if (field === "status" && typeof value === "string") return statusLabel(value, statuses);
    if (field === "priority" && typeof value === "number") return `P${value}`;
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  function fieldsOf(info) {
    if (isRecord(info.ours) || isRecord(info.theirs)) {
      const ours = isRecord(info.ours) ? info.ours : {};
      const theirs = isRecord(info.theirs) ? info.theirs : {};
      return [.../* @__PURE__ */ new Set([...Object.keys(ours), ...Object.keys(theirs)])].map((field) => ({ field, ours: ours[field], theirs: theirs[field] }));
    }
    return [{ field: null, ours: info.ours, theirs: info.theirs }];
  }
  function FieldRow({ field, ours, theirs }) {
    const [open, setOpen] = d2(false);
    const long = ours.length > VALUE_MAX || theirs.length > VALUE_MAX;
    const cut = (text2) => open || text2.length <= VALUE_MAX ? text2 : `${text2.slice(0, VALUE_MAX).trimEnd()}\u2026`;
    return /* @__PURE__ */ u3("div", { class: "bd-sc-field", "data-open": open || void 0, children: [
      field !== null && /* @__PURE__ */ u3("dt", { children: humanize(field) }),
      /* @__PURE__ */ u3("dd", { children: [
        /* @__PURE__ */ u3("span", { class: "bd-sc-side", children: "Local" }),
        /* @__PURE__ */ u3("span", { class: "bd-sc-val", children: cut(ours) })
      ] }),
      /* @__PURE__ */ u3("dd", { children: [
        /* @__PURE__ */ u3("span", { class: "bd-sc-side", "data-side": "team", children: "Team" }),
        /* @__PURE__ */ u3("span", { class: "bd-sc-val", children: cut(theirs) })
      ] }),
      long && /* @__PURE__ */ u3("button", { type: "button", class: "bd-link bd-sc-more", "aria-expanded": open, onClick: () => setOpen((o3) => !o3), children: open ? "Show less" : "Show all" })
    ] });
  }
  function ConflictBeads({ beads, statuses, titleOf }) {
    const [all, setAll] = d2(false);
    if (beads.length === 0) return /* @__PURE__ */ u3("p", { class: "bd-sc-none", children: "Couldn't tell which beads are affected. Copy details has the full record." });
    const shown = all ? beads : beads.slice(0, BEADS_SHOWN);
    return /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("ul", { class: "bd-sc-beads", "aria-label": "Beads changed on both sides", "data-all": all || void 0, children: shown.map((info) => /* @__PURE__ */ u3("li", { class: "bd-sc-bead", children: [
        /* @__PURE__ */ u3("div", { class: "bd-sc-beadhead", children: [
          /* @__PURE__ */ u3("span", { class: "bd-id", children: shortId(info.beadId) }),
          /* @__PURE__ */ u3("span", { class: "bd-sc-title", children: info.title ?? titleOf(info.beadId) ?? "" })
        ] }),
        /* @__PURE__ */ u3("dl", { class: "bd-sc-fields", children: fieldsOf(info).map((f5) => /* @__PURE__ */ u3(FieldRow, { field: f5.field, ours: valueText(f5.field, f5.ours, statuses), theirs: valueText(f5.field, f5.theirs, statuses) }, f5.field ?? "")) })
      ] }, info.beadId)) }),
      beads.length > BEADS_SHOWN && /* @__PURE__ */ u3("button", { type: "button", class: "bd-link bd-sc-morebeads", onClick: () => setAll((a5) => !a5), children: all ? "Show fewer" : `Show ${beads.length - BEADS_SHOWN} more` })
    ] });
  }
  function SyncCard() {
    const { snapshot, detail } = useStore();
    const sync = useSync();
    const agent = useAgent();
    const { session, busy } = useAgentState();
    const { dismissed } = useSyncUi();
    const [showBeads, setShowBeads] = d2(null);
    const problem = syncProblem(snapshot);
    if (!problem || !snapshot) return null;
    if (problem.kind === "error" && dismissed?.kind === "error" && dismissed.message === problem.message && dismissed.log === problem.log) return null;
    const title = TITLES[problem.kind];
    const mine = busy?.id === SYNC_ITEM ? busy.kind : null;
    const titleOf = (id) => snapshot.beads.find((b2) => b2.id === id)?.title ?? null;
    const tone2 = problem.kind === "error" ? "error" : problem.kind === "conflict" && !problem.halfMerged ? "calm" : "warn";
    return /* @__PURE__ */ u3("section", { class: "bd-synccard", role: "region", "aria-label": title, "data-tone": tone2, children: [
      /* @__PURE__ */ u3("div", { class: "bd-sc-head", children: [
        /* @__PURE__ */ u3("span", { class: "bd-sc-ic", "aria-hidden": "true", children: /* @__PURE__ */ u3(IconAlert, { size: 13 }) }),
        /* @__PURE__ */ u3("b", { class: "bd-sc-name", children: title }),
        problem.kind === "error" && sync && /* @__PURE__ */ u3("button", { type: "button", class: "bd-iconbtn bd-iconbtn-sm bd-sc-close", "aria-label": "Dismiss", title: "Dismiss", onClick: () => sync?.dismiss(problem), children: /* @__PURE__ */ u3(IconX, {}) })
      ] }),
      /* @__PURE__ */ u3("p", { class: "bd-sc-msg", children: problemMessage(problem) }),
      problem.kind === "conflict" && problem.beads.length > 0 && /* @__PURE__ */ u3("button", { type: "button", class: "bd-link bd-sc-toggle", "aria-expanded": showBeads ?? detail === null, onClick: () => setShowBeads(!(showBeads ?? detail === null)), children: showBeads ?? detail === null ? "Hide beads" : problem.beads.length === 1 ? "Show the bead" : `Show the ${problem.beads.length} beads` }),
      problem.kind === "conflict" && (problem.beads.length === 0 || (showBeads ?? detail === null)) && /* @__PURE__ */ u3(ConflictBeads, { beads: problem.beads, statuses: snapshot.statuses, titleOf }),
      /* @__PURE__ */ u3("div", { class: "bd-sc-acts", children: [
        agent && (session ? /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: busy !== null, onClick: () => void agent.attachSync(), children: [
          mine === "attach" ? /* @__PURE__ */ u3(IconSpinner, { size: 12 }) : /* @__PURE__ */ u3(IconChat, { size: 12 }),
          mine === "attach" ? "Adding\u2026" : "Hand to agent"
        ] }) : /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: busy !== null, onClick: () => void agent.startSyncSession(), children: [
          mine === "session" ? /* @__PURE__ */ u3(IconSpinner, { size: 12 }) : /* @__PURE__ */ u3(IconSession, { size: 12 }),
          mine === "session" ? "Starting\u2026" : "Start session with this"
        ] })),
        sync && /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => sync.copyDetails(problem), children: [
          /* @__PURE__ */ u3(IconCopy, { size: 12 }),
          "Copy details"
        ] }),
        /* @__PURE__ */ u3("span", { class: "bd-sc-hint", children: session || !agent ? "Nothing is sent until you send it." : "No open chat." })
      ] })
    ] });
  }

  // src/panel/ui/SyncBar.tsx
  var AGENT_NOTE = "Your agent may also publish these when it syncs.";
  var AGENT_NOTE_ID = "bd-agent-note";
  var NOTICE_ID = "bd-pub-notice";
  var CONFIRM_GUARD_MS = 500;
  function TeamBar({ team, unpublished: counted }) {
    const unknown = counted === null;
    const unpublished = counted ?? 0;
    const { snapshot } = useStore();
    const sync = useSync();
    const { starting } = useSyncUi();
    const job = snapshot?.sync.kind === "running" ? snapshot.sync.op : null;
    const op = starting ?? job;
    const problem = syncProblem(snapshot);
    const conflict = problem?.kind === "conflict";
    return /* @__PURE__ */ u3("div", { class: "bd-teambar", "data-running": op ?? void 0, children: [
      /* @__PURE__ */ u3("span", { class: "bd-hidden", role: "status", children: op === "pull" ? "Syncing with the team\u2026" : op === "publish" ? "Publishing to the team\u2026" : "" }),
      /* @__PURE__ */ u3("span", { class: "bd-team", children: op ? (
        // The last sync time is about to change: say what is happening instead of showing it.
        /* @__PURE__ */ u3("span", { class: "bd-team-text", children: op === "pull" ? "Syncing with the team\u2026" : "Publishing to the team\u2026" })
      ) : /* @__PURE__ */ u3("span", { class: "bd-team-text", children: [
        /* @__PURE__ */ u3("span", { children: team }),
        (unpublished > 0 || unknown) && /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3("span", { class: "bd-sep", "aria-hidden": "true", children: "\xB7" }),
          /* @__PURE__ */ u3("span", { class: "bd-unpub", title: AGENT_NOTE, children: unknown ? "Unpublished count unavailable" : `${unpublished} unpublished` })
        ] })
      ] }) }),
      sync && /* @__PURE__ */ u3("span", { class: "bd-team-acts", children: [
        /* @__PURE__ */ u3(
          "button",
          {
            type: "button",
            class: "bd-tbtn bd-tbtn-icon",
            "data-running": op === "pull" || void 0,
            "aria-label": op === "pull" ? "Syncing\u2026" : "Sync",
            disabled: op !== null,
            title: op !== null ? void 0 : conflict ? "Sync again to check whether it is resolved" : "Sync: get the team's latest changes",
            onClick: () => void sync.pull(),
            children: op === "pull" ? /* @__PURE__ */ u3(IconSpinner, { size: 13 }) : /* @__PURE__ */ u3(IconSync, { size: 13 })
          }
        ),
        (unpublished > 0 || unknown || op === "publish") && /* @__PURE__ */ u3(
          "button",
          {
            type: "button",
            class: "bd-tbtn",
            "data-tone": "publish",
            "data-running": op === "publish" || void 0,
            "aria-label": op === "publish" ? "Publishing\u2026" : unknown ? "Publish" : `Publish ${changesText(unpublished)}`,
            disabled: op !== null || conflict,
            "aria-describedby": AGENT_NOTE_ID,
            title: conflict ? "Resolve the sync problem first" : op !== null ? void 0 : `Review and publish ${unknown ? "your changes" : changesText(unpublished)} to the team. ${AGENT_NOTE}`,
            onClick: () => void sync.openPublish(),
            children: [
              op === "publish" ? /* @__PURE__ */ u3(IconSpinner, { size: 12 }) : /* @__PURE__ */ u3(IconPublish, { size: 12 }),
              /* @__PURE__ */ u3("span", { children: "Publish" })
            ]
          }
        ),
        /* @__PURE__ */ u3("span", { id: AGENT_NOTE_ID, class: "bd-hidden", children: AGENT_NOTE })
      ] })
    ] });
  }
  var shortened = (summary, ids) => ids.reduce((text2, id) => text2.split(id).join(shortId(id)), summary);
  function ChangeItem({ change, titleOf, panelActor, now }) {
    const [first, ...rest] = change.beadIds;
    const at2 = change.at === null ? NaN : Date.parse(change.at);
    const meta = [personName(change.actor, panelActor), ...Number.isFinite(at2) ? [ago(now - at2)] : []];
    const summary = shortened(change.summary, change.beadIds);
    return /* @__PURE__ */ u3("li", { class: "bd-pub-item", children: [
      first !== void 0 && /* @__PURE__ */ u3("div", { class: "bd-pub-bead", children: [
        /* @__PURE__ */ u3("span", { class: "bd-id", children: shortId(first) }),
        /* @__PURE__ */ u3("span", { class: "bd-pub-title", children: titleOf(first) ?? "" }),
        rest.length > 0 && /* @__PURE__ */ u3("span", { class: "bd-pub-plus", title: `and ${rest.length} more ${rest.length === 1 ? "bead" : "beads"}`, children: `+${rest.length}` })
      ] }),
      /* @__PURE__ */ u3("div", { class: "bd-pub-meta", children: [
        /* @__PURE__ */ u3("span", { class: "bd-pub-sum", children: summary }),
        meta.map((m3, i3) => /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3("span", { class: "bd-sep", "aria-hidden": "true", children: "\xB7" }),
          /* @__PURE__ */ u3("span", { children: m3 })
        ] }, i3))
      ] })
    ] });
  }
  function PublishSheet() {
    const sync = useSync();
    const store = useStoreApi();
    const { snapshot } = useStore();
    const { preview } = useSyncUi();
    const now = useNow(3e4);
    const confirm = A2(null);
    const cancel = A2(null);
    const dialog = A2(null);
    useOverlay("publish", preview !== null);
    const shownAt = A2(0);
    const ready = preview?.kind === "ready" && !preview.noRemote && preview.changes.length > 0;
    const reopened = preview?.kind === "ready" && preview.notice !== void 0;
    const noHead = preview?.kind === "ready" && !preview.head;
    const confirmOff = preview?.kind === "ready" && (preview.teamEmpty === true || preview.teamUnseen === true || noHead);
    h2(() => {
      if (!preview || preview.kind === "loading") return;
      if (ready) shownAt.current = Date.now();
      queueMicrotask(() => (ready && !reopened && !confirmOff ? confirm.current : cancel.current)?.focus());
    }, [preview?.kind]);
    if (!sync || !preview) return null;
    const titleOf = (id) => snapshot?.beads.find((b2) => b2.id === id)?.title ?? null;
    const panelActor = snapshot?.panelActor || null;
    let body;
    if (preview.kind === "loading") {
      body = /* @__PURE__ */ u3("p", { class: "bd-pub-state", role: "status", children: [
        /* @__PURE__ */ u3(IconSpinner, { size: 12 }),
        "Reading what would be published\u2026"
      ] });
    } else if (preview.kind === "error") {
      body = /* @__PURE__ */ u3("p", { class: "bd-pub-state", "data-tone": "error", role: "alert", children: [
        /* @__PURE__ */ u3("span", { children: preview.error.message }),
        preview.error.detail && /* @__PURE__ */ u3("button", { type: "button", class: "bd-link", onClick: () => store.copyDetails(preview.error), children: "Copy details" })
      ] });
    } else if (preview.noRemote) {
      body = /* @__PURE__ */ u3("p", { class: "bd-pub-state", children: "This project has no shared copy with the team, so there is nothing to publish." });
    } else if (preview.changes.length === 0) {
      body = /* @__PURE__ */ u3("p", { class: "bd-pub-state", children: "Nothing to publish. Everything here is already on the team's shared copy." });
    } else {
      body = /* @__PURE__ */ u3(S, { children: [
        preview.notice && /* @__PURE__ */ u3("p", { id: NOTICE_ID, class: "bd-pub-state", "data-tone": "note", children: preview.notice }),
        preview.teamEmpty && /* @__PURE__ */ u3("p", { class: "bd-pub-state", "data-tone": "note", children: "The team's shared copy has nothing in it yet. Publish can't set it up." }),
        preview.teamUnseen && /* @__PURE__ */ u3("p", { class: "bd-pub-state", "data-tone": "note", children: "This computer hasn't seen the team's shared copy yet. Sync first." }),
        !preview.head && /* @__PURE__ */ u3("p", { class: "bd-pub-state", "data-tone": "note", children: "Couldn't confirm this list is current. Close and try again." }),
        /* @__PURE__ */ u3("ul", { class: "bd-pub-list", "aria-label": `${changesText(preview.total)} to publish`, children: preview.changes.map((change, i3) => /* @__PURE__ */ u3(ChangeItem, { change, titleOf, panelActor, now }, change.commit || i3)) }),
        preview.total > preview.changes.length && /* @__PURE__ */ u3("p", { class: "bd-pub-rest", children: `and ${preview.total - preview.changes.length} more` }),
        /* @__PURE__ */ u3("p", { class: "bd-pub-note", children: [
          /* @__PURE__ */ u3("span", { children: "Changes made in the moment Publish runs may go with them." }),
          " ",
          /* @__PURE__ */ u3("span", { children: AGENT_NOTE })
        ] })
      ] });
    }
    return /* @__PURE__ */ u3("div", { class: "bd-sheet", children: [
      /* @__PURE__ */ u3("div", { class: "bd-scrim", "aria-hidden": "true", onClick: () => sync.closePublish() }),
      /* @__PURE__ */ u3(
        "div",
        {
          ref: dialog,
          class: "bd-create bd-pub",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "Publish to the team",
          "aria-describedby": preview.kind === "ready" && preview.notice ? NOTICE_ID : void 0,
          "aria-busy": preview.kind === "loading",
          onKeyDown: (e3) => {
            trapTab(e3, dialog.current);
            if (e3.key !== "Escape") return;
            e3.preventDefault();
            e3.stopPropagation();
            sync.closePublish();
          },
          children: [
            /* @__PURE__ */ u3("div", { class: "bd-wt-head", children: [
              /* @__PURE__ */ u3("span", { class: "bd-wt-ic", "aria-hidden": "true", children: /* @__PURE__ */ u3(IconPublish, { size: 15 }) }),
              /* @__PURE__ */ u3("div", { class: "bd-wt-headtext", children: [
                /* @__PURE__ */ u3("h2", { class: "bd-wt-title", children: "Publish to the team" }),
                /* @__PURE__ */ u3("p", { class: "bd-pub-lead", children: "These changes go to the team's shared copy." })
              ] })
            ] }),
            body,
            /* @__PURE__ */ u3("div", { class: "bd-edacts", children: [
              /* @__PURE__ */ u3("button", { ref: cancel, type: "button", class: "bd-btn bd-btn-sm", onClick: () => sync.closePublish(), children: ready || preview.kind === "loading" ? "Cancel" : "Close" }),
              ready && /* @__PURE__ */ u3(
                "button",
                {
                  ref: confirm,
                  type: "button",
                  class: "bd-btn bd-btn-sm bd-btn-primary",
                  disabled: confirmOff,
                  onClick: () => {
                    if (Date.now() - shownAt.current < CONFIRM_GUARD_MS) return;
                    void sync.confirmPublish();
                  },
                  children: `Publish ${changesText(preview.total)}`
                }
              )
            ] })
          ]
        }
      )
    ] });
  }

  // src/panel/ui/popover.tsx
  var EDGE = 12;
  function Popover({ label, align = "start", onClose, children, role = "dialog" }) {
    const ref = A2(null);
    _2(() => {
      const el2 = ref.current;
      const panel2 = el2?.closest(".bd")?.getBoundingClientRect();
      if (!el2 || !panel2 || panel2.width === 0) return;
      const left = (el2.offsetParent?.getBoundingClientRect().left ?? 0) + el2.offsetLeft;
      const right = left + el2.offsetWidth;
      let dx = 0;
      if (right > panel2.right - EDGE) dx = panel2.right - EDGE - right;
      if (left + dx < panel2.left + EDGE) dx = panel2.left + EDGE - left;
      if (dx !== 0) el2.style.translate = `${dx}px 0`;
    }, []);
    h2(() => {
      const el2 = ref.current;
      const first = ["[data-autofocus]", '[role="menuitemradio"][aria-checked="true"]', "input", '[role="menuitemradio"]', '[role="menuitem"]:not(:disabled)', "button"].map((s3) => el2?.querySelector(s3)).find(Boolean);
      first?.focus();
      const outside = (e3) => {
        const wrap = el2?.parentElement;
        if (wrap && !wrap.contains(e3.target)) onClose();
      };
      document.addEventListener("pointerdown", outside, true);
      return () => document.removeEventListener("pointerdown", outside, true);
    }, []);
    const onKeyDown = (e3) => {
      if (e3.key === "Escape") {
        e3.preventDefault();
        e3.stopPropagation();
        (ref.current?.parentElement?.querySelector("[aria-haspopup]") ?? null)?.focus();
        onClose();
        return;
      }
      if (role !== "menu" || e3.key !== "ArrowDown" && e3.key !== "ArrowUp") return;
      const items = Array.from(ref.current?.querySelectorAll('[role="menuitemradio"], [role="menuitem"]:not(:disabled)') ?? []);
      const i3 = items.indexOf(document.activeElement);
      items[(i3 + (e3.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      e3.preventDefault();
    };
    return /* @__PURE__ */ u3("div", { ref, class: "bd-pop", "data-align": align, role, "aria-label": label, onKeyDown, children });
  }
  function usePopover(disabled) {
    const [open, setOpen] = d2(false);
    h2(() => {
      if (disabled) setOpen(false);
    }, [disabled]);
    return { open, toggle: () => setOpen((o3) => !o3), close: () => setOpen(false) };
  }
  function useChoices(items, listId) {
    const [active2, setActive] = d2(-1);
    h2(() => setActive(-1), [items.length]);
    const onKey = (e3, take) => {
      if (e3.key === "ArrowDown" || e3.key === "ArrowUp") {
        e3.preventDefault();
        if (items.length === 0) return;
        setActive((a5) => e3.key === "ArrowDown" ? (a5 + 1) % items.length : (a5 <= 0 ? items.length : a5) - 1);
      } else if (e3.key === "Enter" && !composing(e3)) {
        e3.preventDefault();
        take(active2 >= 0 ? items[active2] ?? null : null);
      }
    };
    const optionId = (i3) => `${listId}-o${i3}`;
    const activeId = active2 >= 0 && active2 < items.length ? optionId(active2) : void 0;
    return { active: active2, onKey, optionId, activeId };
  }

  // src/panel/ui/ProjectMenu.tsx
  function readDays(text2) {
    const t3 = text2.trim();
    if (!/^\d{1,3}$/.test(t3)) return null;
    const n2 = Number(t3);
    return n2 >= 1 && n2 <= MAX_STALE_DAYS ? n2 : null;
  }
  function StuckDays() {
    const store = useStoreApi();
    const saved = useStore().settings.staleDays;
    const [text2, setText2] = d2(String(saved));
    const bad = readDays(text2) === null;
    const take = (next) => {
      setText2(next);
      const days = readDays(next);
      if (days !== null) store.setStaleDays(days);
    };
    return /* @__PURE__ */ u3("div", { class: "bd-pm-set", children: [
      /* @__PURE__ */ u3("div", { class: "bd-pm-row", children: [
        /* @__PURE__ */ u3("label", { class: "bd-pm-label", for: "bd-pm-days", children: "Stuck after" }),
        /* @__PURE__ */ u3(
          "input",
          {
            id: "bd-pm-days",
            type: "text",
            inputMode: "numeric",
            role: "spinbutton",
            "aria-valuemin": 1,
            "aria-valuemax": MAX_STALE_DAYS,
            "aria-valuenow": readDays(text2) ?? saved,
            class: "bd-input bd-pm-days",
            value: text2,
            "aria-invalid": bad || void 0,
            "aria-describedby": "bd-pm-days-hint",
            onInput: (e3) => take(e3.currentTarget.value),
            onKeyDown: (e3) => {
              const days = readDays(text2) ?? saved;
              if (e3.key === "ArrowUp" || e3.key === "ArrowDown") {
                e3.preventDefault();
                take(String(Math.min(MAX_STALE_DAYS, Math.max(1, days + (e3.key === "ArrowUp" ? 1 : -1)))));
              } else if (isEnterInInput(e3) && bad) {
                e3.preventDefault();
                setText2(String(saved));
              }
            },
            onBlur: () => {
              if (bad) setText2(String(saved));
            }
          }
        ),
        /* @__PURE__ */ u3("span", { class: "bd-pm-unit", children: readDays(text2) === 1 ? "day" : "days" })
      ] }),
      bad ? /* @__PURE__ */ u3("p", { class: "bd-fieldmsg", id: "bd-pm-days-hint", role: "alert", children: `Enter a whole number of days from 1 to ${MAX_STALE_DAYS}.` }) : /* @__PURE__ */ u3("p", { class: "bd-fieldmsg", "data-tone": "quiet", id: "bd-pm-days-hint", children: "Work in progress with no update for this long shows under Stuck in Needs me. Kept on this computer, for this project." })
    ] });
  }
  var SYNC_WAIT2 = "Wait for the sync to finish, then try again.";
  var REGULAR = "the panel checks for changes every few seconds";
  var readOf = (status) => status.journal === "unknown" ? { kind: "unknown", error: null } : { kind: "status", status };
  function onLine(live) {
    if (live === "following") return { tone: "ok", text: "Following changes as they happen." };
    if (live === "backoff") return { tone: "warn", text: `Reconnecting. Until then, ${REGULAR}.` };
    if (live === "failed") return { tone: "err", text: `Not working right now, so ${REGULAR}.` };
    return { tone: "warn", text: `Starting. Until then, ${REGULAR}.` };
  }
  var carried = /* @__PURE__ */ new WeakMap();
  function LiveConsent({ busy, onCancel, onConfirm }) {
    return /* @__PURE__ */ u3(
      "div",
      {
        class: "bd-pm-ask",
        role: "alertdialog",
        "aria-labelledby": "bd-pm-ask-t",
        "aria-describedby": "bd-pm-ask-d",
        onKeyDown: (e3) => {
          if (e3.key !== "Escape") return;
          e3.preventDefault();
          e3.stopPropagation();
          if (!busy) onCancel();
        },
        children: [
          /* @__PURE__ */ u3("p", { class: "bd-pm-ask-t", id: "bd-pm-ask-t", children: "Turn on live updates?" }),
          /* @__PURE__ */ u3("div", { class: "bd-pm-ask-d", id: "bd-pm-ask-d", children: [
            /* @__PURE__ */ u3("p", { children: "Beads will keep a log of changes on this computer for 7 days." }),
            /* @__PURE__ */ u3("p", { children: [
              "This changes the project's settings file, ",
              /* @__PURE__ */ u3("span", { class: "bd-pm-file", children: ".beads/config.yaml" }),
              ", which is shared with your team if you commit it."
            ] })
          ] }),
          /* @__PURE__ */ u3("div", { class: "bd-pm-ask-acts", children: [
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", "data-focus": "cancel", disabled: busy, onClick: onCancel, children: "Cancel" }),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", "aria-busy": busy || void 0, "aria-disabled": busy || void 0, onClick: onConfirm, children: busy ? "Turning on\u2026" : "Turn on" })
          ] })
        ]
      }
    );
  }
  function LiveUpdates() {
    const store = useStoreApi();
    const state = useStore();
    const capable = state.capabilities.eventsJournal && !state.unsupported.has("events");
    const [read, setRead] = d2({ kind: "reading" });
    const [asking, setAsking] = d2(false);
    const [busy, setBusy] = d2(false);
    const [note, setNote] = d2(() => {
      const held = carried.get(store);
      if (!held || held.directory !== state.directory) return null;
      carried.delete(store);
      return held.note;
    });
    const alive = A2(true);
    const focusNext = A2(null);
    const box = A2(null);
    h2(() => () => void (alive.current = false), []);
    _2(() => {
      const want = focusNext.current;
      if (!want) return;
      focusNext.current = null;
      box.current?.querySelector(`[data-focus="${want}"]`)?.focus();
    });
    const load = async () => {
      setRead({ kind: "reading" });
      const outcome = await store.readEventsStatus();
      if (!alive.current || outcome.kind === "dropped") return;
      const next = outcome.kind === "ok" ? readOf(outcome.value) : { kind: "unknown", error: outcome.error };
      if (next.kind === "status" && next.status.journal === "on") setNote((n2) => n2?.tone === "info" ? null : n2);
      setRead(next);
    };
    h2(() => {
      if (capable) void load();
    }, [capable]);
    const enable = async () => {
      if (busy) return;
      const directory2 = state.directory;
      setBusy(true);
      setNote(null);
      const outcome = await store.enableEvents();
      if (outcome.kind === "dropped") return;
      const said = outcome.kind === "uncertain" ? { tone: "info", text: outcome.message || "Live updates may be on now, but Beads didn't confirm it." } : outcome.kind === "error" ? { tone: "error", text: outcome.error.code === "sync-running" ? SYNC_WAIT2 : outcome.error.message } : null;
      if (!alive.current) {
        if (said && directory2 !== null) carried.set(store, { directory: directory2, note: said });
        return;
      }
      setBusy(false);
      setAsking(false);
      setNote(said);
      if (outcome.kind === "ok") {
        setRead(readOf(outcome.value.status));
        focusNext.current = "state";
      } else if (outcome.kind === "uncertain") {
        setRead(outcome.status ? readOf(outcome.status) : { kind: "unknown", error: null });
        focusNext.current = "note";
      } else if (outcome.kind === "error") {
        focusNext.current = "turn-on";
      } else {
        focusNext.current = "state";
        void load();
      }
    };
    const retry = () => {
      focusNext.current = "state";
      void load();
    };
    const status = read.kind === "status" ? read.status : null;
    const unavailable = !capable || status?.available === false;
    const on = !unavailable && status?.journal === "on";
    const off = !unavailable && status?.journal === "off";
    const line = on && status ? onLine(status.live) : null;
    const reading = capable && read.kind === "reading";
    const word = unavailable ? null : on ? "On" : off ? "Off" : reading ? "Checking" : null;
    const say = unavailable ? `Needs a newer version of Beads (1.3 or later). Until then, ${REGULAR}.` : reading ? "Checking\u2026" : read.kind === "unknown" ? read.error?.code === "sync-running" ? SYNC_WAIT2 : "Couldn't read this setting for the project." : line ? line.text : `Off for this project, so ${REGULAR}. Turn it on to see changes as soon as they happen.`;
    return /* @__PURE__ */ u3("div", { ref: box, class: "bd-pm-set bd-pm-live", role: "group", "aria-labelledby": "bd-pm-live-t", "aria-busy": reading || void 0, children: [
      /* @__PURE__ */ u3("div", { class: "bd-pm-row", children: [
        /* @__PURE__ */ u3("span", { class: "bd-pm-label", id: "bd-pm-live-t", children: "Live updates" }),
        word && /* @__PURE__ */ u3("span", { class: "bd-pm-state", "data-tone": line?.tone ?? (on ? "ok" : "off"), children: [
          /* @__PURE__ */ u3("span", { class: "bd-pm-dot", "aria-hidden": "true" }),
          word
        ] })
      ] }),
      note && /* @__PURE__ */ u3("p", { class: "bd-pm-note", "data-tone": note.tone, "data-focus": "note", tabIndex: -1, role: note.tone === "error" ? "alert" : "status", children: note.text }),
      /* @__PURE__ */ u3("p", { class: "bd-pm-say", "data-focus": "state", tabIndex: -1, role: "status", children: say }),
      !reading && read.kind === "unknown" && !unavailable && /* @__PURE__ */ u3("div", { children: /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: retry, children: "Try again" }) }),
      !reading && off && (asking ? /* @__PURE__ */ u3(
        LiveConsent,
        {
          busy,
          onCancel: () => {
            setAsking(false);
            focusNext.current = "turn-on";
          },
          onConfirm: () => void enable()
        }
      ) : /* @__PURE__ */ u3("div", { children: /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: "bd-btn bd-btn-sm",
          "data-focus": "turn-on",
          onClick: () => {
            setNote(null);
            setAsking(true);
            focusNext.current = "cancel";
          },
          children: "Turn on live updates"
        }
      ) }))
    ] });
  }
  function ProjectMenu({ name, title }) {
    const popover = usePopover(false);
    const store = useStoreApi();
    const { unsupported, directory: directory2 } = useStore();
    const memories = !unsupported.has("memories");
    return /* @__PURE__ */ u3("div", { class: "bd-popwrap bd-pm", children: [
      /* @__PURE__ */ u3("button", { type: "button", class: "bd-proj bd-projbtn", title, "aria-haspopup": "dialog", "aria-expanded": popover.open, onClick: popover.toggle, children: [
        /* @__PURE__ */ u3(IconFolder, {}),
        /* @__PURE__ */ u3("span", { class: "bd-proj-name", children: name }),
        /* @__PURE__ */ u3(IconChevron, {})
      ] }),
      popover.open && /* @__PURE__ */ u3(Popover, { label: "Project menu", onClose: popover.close, children: /* @__PURE__ */ u3("div", { class: "bd-pm-body", children: [
        memories && /* @__PURE__ */ u3(
          "button",
          {
            type: "button",
            class: "bd-pm-go",
            "aria-labelledby": "bd-pm-mem-t",
            "aria-describedby": "bd-pm-mem-d",
            "data-autofocus": true,
            onClick: () => {
              popover.close();
              store.setPage("memories");
            },
            children: [
              /* @__PURE__ */ u3("span", { class: "bd-pm-go-t", id: "bd-pm-mem-t", children: "Memories" }),
              /* @__PURE__ */ u3("span", { class: "bd-pm-go-d", id: "bd-pm-mem-d", children: "What every agent session here starts with" }),
              /* @__PURE__ */ u3(IconChevron, {})
            ]
          }
        ),
        /* @__PURE__ */ u3("p", { class: "bd-pm-h", children: "Settings" }),
        /* @__PURE__ */ u3(StuckDays, {}),
        /* @__PURE__ */ u3(LiveUpdates, {}, directory2)
      ] }) })
    ] });
  }

  // src/panel/ui/Row.tsx
  function StatusDot({ look, label, marker = "builtin" }) {
    const marks = { class: "bd-sd", "data-look": look, "data-marker": marker === "builtin" ? void 0 : marker };
    return label ? /* @__PURE__ */ u3("span", { ...marks, role: "img", "aria-label": label, title: label }) : /* @__PURE__ */ u3("span", { ...marks, "aria-hidden": "true" });
  }
  function Priority({ value }) {
    if (value === null) return /* @__PURE__ */ u3("span", { class: "bd-pr", "data-p": "none", "aria-hidden": "true" });
    return /* @__PURE__ */ u3("span", { class: "bd-pr", "data-p": value, title: `Priority ${value}`, children: [
      "P",
      value
    ] });
  }
  function Who({ name }) {
    if (!name) return /* @__PURE__ */ u3("span", { class: "bd-who", "data-none": true, "aria-hidden": "true" });
    return /* @__PURE__ */ u3("span", { class: "bd-who", title: name, "aria-label": `Assigned to ${name}`, role: "img", children: initials(name) });
  }
  function SubCount({ sub }) {
    return /* @__PURE__ */ u3("span", { class: "bd-sub", "data-all": sub.done === sub.total || void 0, title: `${sub.done} of ${sub.total} direct sub-issues done`, children: `${sub.done}/${sub.total}` });
  }
  var TAG_FITS = 12;
  function EpicTag({ epic }) {
    const fits = epic.title.length <= TAG_FITS;
    return /* @__PURE__ */ u3("span", { class: "bd-ep", "data-fits": fits || void 0, title: epic.title, children: [
      /* @__PURE__ */ u3(IconEpic, { size: 11 }),
      /* @__PURE__ */ u3("em", { class: "bd-ep-name", children: epic.title }),
      !fits && /* @__PURE__ */ u3("em", { class: "bd-ep-id", children: shortId(epic.id) })
    ] });
  }
  var rowDomId = (id) => `bd-row-${id}`;
  var MENU_W = 176;
  var menuFor = (id, row2, anchor = row2) => {
    const r3 = row2.getBoundingClientRect();
    return { id, x: anchor.getBoundingClientRect().right - MENU_W, top: r3.top, bottom: r3.bottom };
  };
  function BeadRow(p3) {
    const { bead } = p3;
    const updated = Date.parse(bead.updatedAt);
    return /* @__PURE__ */ u3(
      "div",
      {
        role: "option",
        id: rowDomId(bead.id),
        class: "bd-row",
        "data-variant": p3.variant,
        "aria-selected": p3.selectedId === bead.id,
        "data-selected": p3.selectedId === bead.id || void 0,
        "data-cursor": p3.cursor === bead.id || void 0,
        "data-unseen": p3.unseen || void 0,
        "data-done": p3.look === "done" || void 0,
        "data-context": p3.context || void 0,
        style: { "--l": p3.depth },
        onClick: () => p3.pick(bead.id),
        onContextMenu: (e3) => {
          e3.preventDefault();
          const row2 = e3.currentTarget;
          p3.menu({ ...menuFor(bead.id, row2), x: e3.clientX });
        },
        children: [
          p3.dot && /* @__PURE__ */ u3(StatusDot, { look: p3.look, label: p3.label, marker: p3.marker }),
          /* @__PURE__ */ u3("span", { class: "bd-ty", "data-type": bead.type, title: bead.type, children: /* @__PURE__ */ u3(TypeIcon, { type: bead.type }) }),
          /* @__PURE__ */ u3("span", { class: "bd-id", children: p3.id }),
          /* @__PURE__ */ u3("span", { class: "bd-title", children: bead.title }),
          bead.labels.slice(0, 2).map((label) => /* @__PURE__ */ u3("span", { class: "bd-lb", children: label }, label)),
          p3.epic && /* @__PURE__ */ u3(EpicTag, { epic: p3.epic }),
          p3.sub && /* @__PURE__ */ u3(SubCount, { sub: p3.sub }),
          /* @__PURE__ */ u3(Priority, { value: bead.priority }),
          /* @__PURE__ */ u3(Who, { name: bead.assignee }),
          /* @__PURE__ */ u3("time", { class: "bd-age", dateTime: bead.updatedAt, title: `Updated ${bead.updatedAt}`, children: Number.isFinite(updated) ? shortAgo(p3.now - updated) : "" }),
          /* @__PURE__ */ u3(
            "button",
            {
              type: "button",
              class: "bd-rowmore",
              "aria-label": "More actions",
              tabIndex: -1,
              onClick: (e3) => {
                e3.stopPropagation();
                const button2 = e3.currentTarget;
                p3.menu(menuFor(bead.id, button2.closest(".bd-row") ?? button2, button2));
              },
              children: /* @__PURE__ */ u3(IconMore, {})
            }
          ),
          p3.below
        ]
      }
    );
  }
  var Row = ({ row: row2, dot, ...events }) => /* @__PURE__ */ u3(
    BeadRow,
    {
      ...events,
      bead: row2.bead,
      id: row2.id,
      look: row2.look,
      label: row2.label,
      marker: row2.marker,
      depth: row2.depth,
      unseen: row2.unseen,
      context: row2.context,
      epic: row2.epic,
      sub: row2.sub,
      dot
    }
  );
  function RowMenu({ at: at2, actions, extra = [], onClose }) {
    const ref = A2(null);
    const [place, setPlace] = d2(null);
    _2(() => {
      const menu = ref.current;
      const width = window.innerWidth || Infinity;
      const height = window.innerHeight || Infinity;
      const h4 = menu?.offsetHeight ?? 0;
      const below = at2.bottom + 2;
      const top = below + h4 <= height - 4 || at2.top - h4 - 2 < 4 ? below : at2.top - h4 - 2;
      setPlace({ left: Math.max(4, Math.min(at2.x, width - MENU_W - 4)), top: Math.max(4, top) });
    }, [at2]);
    h2(() => {
      const menu = ref.current;
      menu?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
      const outside = (e3) => {
        if (menu && !menu.contains(e3.target)) onClose("outside");
      };
      const blur = () => onClose("outside");
      document.addEventListener("pointerdown", outside, true);
      window.addEventListener("blur", blur);
      return () => {
        document.removeEventListener("pointerdown", outside, true);
        window.removeEventListener("blur", blur);
      };
    }, [onClose]);
    const busy = actions.busy === true;
    const items = [
      ...extra,
      { label: "Add to current chat", ...extra.length ? { rule: true } : {}, icon: /* @__PURE__ */ u3(IconChat, {}), run: () => actions.addToChat(at2.id), off: actions.noChat ? "No open chat" : void 0 },
      { label: "Start session", icon: /* @__PURE__ */ u3(IconSession, {}), run: () => actions.startSession(at2.id) },
      { label: "Start in worktree\u2026", icon: /* @__PURE__ */ u3(IconBranch, {}), run: () => actions.startInWorktree(at2.id) },
      { label: "Copy ID", icon: /* @__PURE__ */ u3(IconCopy, {}), run: () => actions.copyId(at2.id) }
    ];
    const agentItem = (label) => label !== "Copy ID" && !extra.some((x4) => x4.label === label);
    const onKeyDown = (e3) => {
      const buttons = Array.from(ref.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') ?? []);
      const i3 = buttons.indexOf(document.activeElement);
      const focus2 = (n2) => buttons[(n2 + buttons.length) % buttons.length]?.focus();
      if (e3.key === "ArrowDown") focus2(i3 + 1);
      else if (e3.key === "ArrowUp") focus2(i3 - 1);
      else if (e3.key === "Home") focus2(0);
      else if (e3.key === "End") focus2(buttons.length - 1);
      else if (e3.key === "Escape" || e3.key === "Tab") onClose("keyboard");
      else return;
      e3.preventDefault();
      e3.stopPropagation();
    };
    return /* @__PURE__ */ u3(
      "div",
      {
        ref,
        class: "bd-menu",
        role: "menu",
        "aria-label": `Actions for ${at2.id}`,
        style: place ? { left: `${place.left}px`, top: `${place.top}px` } : { visibility: "hidden", left: "0px", top: "0px" },
        onKeyDown,
        children: [
          items.map(({ label, icon: icon2, run, off, rule }) => [
            rule && /* @__PURE__ */ u3("div", { class: "bd-menu-rule", role: "separator" }, `${label}-rule`),
            /* @__PURE__ */ u3(
              "button",
              {
                type: "button",
                role: "menuitem",
                class: "bd-menu-item",
                disabled: off !== void 0 || busy && agentItem(label),
                title: off,
                onClick: () => {
                  onClose("item");
                  run();
                },
                children: [
                  icon2,
                  /* @__PURE__ */ u3("span", { children: label }),
                  off && /* @__PURE__ */ u3("span", { class: "bd-menu-off", children: off })
                ]
              },
              label
            )
          ]),
          /* @__PURE__ */ u3("div", { class: "bd-menu-id", children: at2.id })
        ]
      }
    );
  }

  // src/panel/ui/Filters.tsx
  function Chip({ pressed, onClick, title, children }) {
    return /* @__PURE__ */ u3("button", { type: "button", class: "bd-chip", "aria-pressed": pressed, title, onClick, children });
  }
  function Line({ label, children }) {
    return /* @__PURE__ */ u3("div", { class: "bd-fline", role: "group", "aria-label": label, children: [
      /* @__PURE__ */ u3("span", { class: "bd-flabel", "aria-hidden": "true", children: label }),
      /* @__PURE__ */ u3("div", { class: "bd-chips", children })
    ] });
  }
  var toggle = (list, value) => list.includes(value) ? list.filter((v5) => v5 !== value) : [...list, value];
  function Filters() {
    const state = useStore();
    const store = useStoreApi();
    const snapshot = state.snapshot;
    if (!snapshot) return null;
    if (state.view === "activity") {
      return /* @__PURE__ */ u3("div", { class: "bd-filters", role: "region", "aria-label": "Filters", children: /* @__PURE__ */ u3("p", { class: "bd-fnote", children: "Filters apply to the Epic and Status views. Activity shows every change; search narrows it." }) });
    }
    const f5 = state.filters;
    const set = (patch) => store.setFilters({ ...f5, ...patch });
    const look = looker(snapshot.statuses);
    const classify = classifier({ statuses: snapshot.statuses, readyIds: snapshot.readyIds, now: Date.now() });
    const used = new Set(snapshot.beads.map((b2) => classify(b2).filterAs));
    const order = snapshot.statuses.map((s3) => s3.name).filter((name) => used.has(name));
    const statuses = [...order, ...[...used].filter((name) => !order.includes(name)).sort()];
    const only = typeof f5.status === "object" ? f5.status.only : [];
    const assignees = [...new Set(snapshot.beads.map((b2) => b2.assignee).filter((a5) => !!a5))].sort((a5, b2) => a5.localeCompare(b2));
    const named = typeof f5.assignee === "object" ? f5.assignee.name : null;
    return /* @__PURE__ */ u3("div", { class: "bd-filters", role: "region", "aria-label": "Filters", children: [
      /* @__PURE__ */ u3(Line, { label: "Status", children: [
        /* @__PURE__ */ u3(Chip, { pressed: f5.status === "open", onClick: () => set({ status: "open" }), title: "Everything not done, plus what closed in the last 7 days", children: "Current" }),
        /* @__PURE__ */ u3(Chip, { pressed: f5.status === "all", onClick: () => set({ status: "all" }), title: "Everything, however long ago it closed", children: "All" }),
        /* @__PURE__ */ u3("span", { class: "bd-fsep", "aria-hidden": "true" }),
        statuses.map((name) => /* @__PURE__ */ u3(
          Chip,
          {
            title: statusLabel(name, snapshot.statuses) === name ? void 0 : name,
            pressed: only.includes(name),
            onClick: () => {
              const next = toggle(only, name);
              set({ status: next.length ? { only: next } : "open" });
            },
            children: [
              /* @__PURE__ */ u3(StatusDot, { look: look(name), marker: markerOf(name) }),
              statusLabel(name, snapshot.statuses)
            ]
          },
          name
        ))
      ] }),
      /* @__PURE__ */ u3(Line, { label: "Assignee", children: [
        /* @__PURE__ */ u3(Chip, { pressed: f5.assignee === "any", onClick: () => set({ assignee: "any" }), children: "Anyone" }),
        /* @__PURE__ */ u3(Chip, { pressed: f5.assignee === "unassigned", onClick: () => set({ assignee: f5.assignee === "unassigned" ? "any" : "unassigned" }), children: "Unassigned" }),
        assignees.map((name) => /* @__PURE__ */ u3(Chip, { pressed: named === name, onClick: () => set({ assignee: named === name ? "any" : { name } }), children: name }, name))
      ] }),
      /* @__PURE__ */ u3(Line, { label: "Priority", children: [0, 1, 2, 3, 4].map((p3) => /* @__PURE__ */ u3(Chip, { pressed: f5.priorities.includes(p3), onClick: () => set({ priorities: toggle(f5.priorities, p3).sort() }), children: /* @__PURE__ */ u3("span", { class: "bd-pr", "data-p": p3, children: `P${p3}` }) }, p3)) }),
      /* @__PURE__ */ u3(Line, { label: "Due", children: [
        /* @__PURE__ */ u3(Chip, { pressed: f5.due === "overdue", onClick: () => set({ due: f5.due === "overdue" ? "any" : "overdue" }), title: "Not done, and the due date has passed", children: "Overdue" }),
        /* @__PURE__ */ u3(Chip, { pressed: f5.due === "week", onClick: () => set({ due: f5.due === "week" ? "any" : "week" }), title: "Not done, and due in the next 7 days", children: "Due this week" })
      ] }),
      /* @__PURE__ */ u3(Line, { label: "Ready", children: [
        /* @__PURE__ */ u3(Chip, { pressed: f5.ready, onClick: () => set({ ready: !f5.ready }), title: "Open beads with nothing blocking them", children: "Only ready to start" }),
        filtersActive(f5) && /* @__PURE__ */ u3("button", { type: "button", class: "bd-link bd-freset", onClick: () => store.setFilters(DEFAULT_FILTERS), children: "Reset filters" })
      ] })
    ] });
  }

  // src/panel/ui/writes.tsx
  var UNCERTAIN = "This may have saved. Refreshing.";
  var SAVED_UNREAD = "Saved. Refreshing to show it.";
  function WriteMessage({ feedback, reword }) {
    const store = useStoreApi();
    if (!feedback) return null;
    if (feedback.kind === "checked") {
      return /* @__PURE__ */ u3("p", { class: "bd-wmsg", "data-tone": feedback.saved ? "ok" : "note", role: "status", children: feedback.saved ? "Saved." : `It did not save.${feedback.kept ? ` ${feedback.kept}` : ""}` });
    }
    if (feedback.kind === "uncertain") {
      return /* @__PURE__ */ u3("p", { class: "bd-wmsg", "data-tone": "note", role: "status", children: feedback.saved ? SAVED_UNREAD : UNCERTAIN });
    }
    const { error } = feedback;
    return /* @__PURE__ */ u3("p", { class: "bd-wmsg", role: "alert", children: [
      /* @__PURE__ */ u3("span", { children: reword && error.code === "blocked" ? reword(error.message) : error.message }),
      error.detail && /* @__PURE__ */ u3("button", { type: "button", class: "bd-link", onClick: () => store.copyDetails(error), children: "Copy details" })
    ] });
  }
  var readSince = (localRefreshedAt, since) => localRefreshedAt !== null && Date.parse(localRefreshedAt) > since;
  function shows(patch, b2) {
    for (const [key, value] of Object.entries(patch)) {
      if (key === "closeReason" || key === "closeComment" || key === "due" || value === void 0) continue;
      const now = key === "parent" ? b2.parentId : b2[key];
      if (key === "labels") {
        const want = new Set(value);
        if (want.size !== new Set(now).size || !now.every((l3) => want.has(l3))) return false;
      } else if (key === "title" ? String(value).trim() !== String(now).trim() : key === "assignee" ? (value || null) !== (now || null) : value !== now) return false;
    }
    return true;
  }
  function feedbackOf(outcome) {
    if (outcome.kind === "uncertain") return { kind: "uncertain", saved: outcome.saved };
    if (outcome.kind === "error") return { kind: "error", error: outcome.error };
    return null;
  }
  function shownFor(patch, on) {
    const shown = {};
    for (const key of Object.keys(patch)) {
      if (key === "closeReason" || key === "closeComment") continue;
      if (key === "parent") shown.parentId = on.parentId;
      else if (key === "due") shown.due = typeof on.extra.due_at === "string" ? on.extra.due_at : null;
      else shown[key] = on[key];
    }
    return shown;
  }
  function useInlineWrites(bead) {
    const store = useStoreApi();
    const [note, setNote] = d2(null);
    const snapshot = useStore().snapshot;
    const refreshed = snapshot?.freshness.localRefreshedAt ?? null;
    const listed = bead && snapshot?.beads.find((b2) => b2.id === bead.id) || null;
    const [busyIds, setBusyIds] = d2([]);
    const here = note !== null && note.id === bead?.id ? note : null;
    const report = (outcome) => {
      if (bead) setNote({ id: bead.id, conflict: null, feedback: feedbackOf(outcome) });
    };
    const write = async (make, on) => {
      const id = on.id;
      setBusyIds((ids) => [...ids, id]);
      setNote((n2) => n2?.id === id ? null : n2);
      const patch = make(on);
      const outcome = await store.update(id, on.updatedAt, patch, shownFor(patch, on));
      setBusyIds((ids) => ids.filter((x4) => x4 !== id));
      if (outcome.kind === "dropped") return outcome;
      const pending = outcome.kind === "uncertain" && !outcome.saved ? { make, since: Date.now() } : void 0;
      setNote({ id, conflict: outcome.kind === "conflict" ? { make, current: outcome.current } : null, feedback: feedbackOf(outcome), ...pending ? { pending } : {} });
      return outcome;
    };
    h2(() => {
      const p3 = here?.pending;
      if (!p3 || !bead || here?.feedback?.kind !== "uncertain") return;
      if (shows(p3.make(bead), bead) || listed && shows(p3.make(listed), listed)) setNote({ id: bead.id, conflict: null, feedback: { kind: "checked", saved: true } });
      else if (listed && readSince(refreshed, p3.since)) setNote({ id: bead.id, conflict: null, feedback: { kind: "checked", saved: false }, pending: p3 });
    }, [bead, listed, refreshed, here?.pending]);
    return {
      send: async (make) => bead ? (await write(make, bead)).kind === "ok" : false,
      sendFor: (make) => bead ? write(make, bead) : Promise.resolve({ kind: "dropped" }),
      report,
      conflict: here?.conflict ?? null,
      feedback: here?.feedback ?? null,
      busy: bead !== null && busyIds.includes(bead.id),
      reapply: () => {
        if (here?.conflict) void write(here.conflict.make, here.conflict.current);
      },
      retry: () => {
        if (bead && here?.pending) void write(here.pending.make, bead);
      },
      discard: () => setNote(null)
    };
  }
  function nowText(patch, current, statuses, titleOf = shortId) {
    const parts2 = [];
    if (patch.status !== void 0) parts2.push(`status ${statusLabel(current.status, statuses)}`);
    if (patch.priority !== void 0) parts2.push(`priority ${current.priority === null ? "none" : `P${current.priority}`}`);
    if (patch.assignee !== void 0) parts2.push(current.assignee ? `assigned to ${current.assignee}` : "unassigned");
    if (patch.labels !== void 0) parts2.push(current.labels.length ? `labels ${current.labels.join(", ")}` : "no labels");
    if (patch.title !== void 0) parts2.push(`title "${current.title}"`);
    if (patch.type !== void 0) parts2.push(`type ${humanize(current.type)}`);
    if (patch.parent !== void 0) parts2.push(current.parentId ? `in ${titleOf(current.parentId)}` : "no parent");
    return parts2.length ? `Now ${parts2.join(", ")}.` : "";
  }
  function InlineNotice({ writes, statuses, paused, reword, titleOf }) {
    if (writes.conflict) {
      return /* @__PURE__ */ u3("div", { class: "bd-wnote", role: "alert", children: [
        /* @__PURE__ */ u3("b", { children: "Changed while you were editing" }),
        /* @__PURE__ */ u3("span", { children: nowText(writes.conflict.make(writes.conflict.current), writes.conflict.current, statuses, titleOf) }),
        /* @__PURE__ */ u3("span", { class: "bd-wnote-acts", children: [
          /* @__PURE__ */ u3(
            "button",
            {
              type: "button",
              class: "bd-btn bd-btn-sm bd-btn-primary",
              disabled: writes.busy || paused !== null,
              title: paused ?? void 0,
              onClick: () => {
                if (paused === null) writes.reapply();
              },
              children: "Re-apply"
            }
          ),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: writes.discard, children: "Discard" })
        ] })
      ] });
    }
    if (!writes.feedback) return null;
    const notSaved = writes.feedback.kind === "checked" && !writes.feedback.saved;
    return /* @__PURE__ */ u3("div", { class: "bd-wnote", "data-tone": writes.feedback.kind === "error" ? "error" : "note", children: [
      /* @__PURE__ */ u3(WriteMessage, { feedback: writes.feedback, reword }),
      notSaved && /* @__PURE__ */ u3("span", { class: "bd-wnote-acts", children: /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: writes.busy || paused !== null, title: paused ?? void 0, onClick: writes.retry, children: "Try again" }) })
    ] });
  }
  function PausedNote({ reason }) {
    const card = syncProblem(useStore().snapshot) !== null;
    return /* @__PURE__ */ u3("div", { class: "bd-paused", role: "note", children: [
      /* @__PURE__ */ u3("span", { class: "bd-paused-dot", "aria-hidden": "true" }),
      /* @__PURE__ */ u3("span", { children: card ? `${reason} See sync details above.` : reason })
    ] });
  }

  // src/panel/ui/CreateForm.tsx
  var FALLBACK_TYPES = ["task", "bug", "feature", "epic", "chore"];
  function NewBeadButton() {
    const state = useStore();
    const store = useStoreApi();
    const paused = writesPaused(state.snapshot);
    return /* @__PURE__ */ u3(
      "button",
      {
        type: "button",
        class: "bd-iconbtn bd-newbtn",
        "aria-label": "New bead",
        title: paused ?? "New bead",
        disabled: paused !== null || !state.snapshot,
        "aria-expanded": state.create !== null,
        onClick: () => state.create ? store.closeCreate() : store.openCreate(),
        children: /* @__PURE__ */ u3(IconPlus, {})
      }
    );
  }
  function CreateForm() {
    const state = useStore();
    const store = useStoreApi();
    useOverlay("create", true);
    const snapshot = state.snapshot;
    const start = state.create;
    const types = snapshot?.types.length ? snapshot.types : FALLBACK_TYPES;
    const [title, setTitle] = d2("");
    const [type, setType] = d2(types.includes("task") ? "task" : types[0]);
    const [priority, setPriority] = d2(2);
    const [parentId, setParentId] = d2(start?.parentId ?? "");
    const [description, setDescription] = d2("");
    const [busy, setBusy] = d2(false);
    const [feedback, setFeedback] = d2(null);
    const [confirming, setConfirming] = d2(false);
    const first = A2(null);
    const form = A2(null);
    h2(() => {
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      first.current?.focus();
      return () => {
        requestAnimationFrame(() => {
          if (opener?.isConnected) opener.focus();
        });
      };
    }, []);
    h2(() => {
      if (!form.current || form.current.contains(document.activeElement)) return;
      first.current?.focus();
    }, [confirming]);
    const [pending, setPending] = d2(null);
    h2(() => {
      if (!pending || !snapshot) return;
      const made = snapshot.beads.find((b2) => !pending.ids.has(b2.id) && b2.title === pending.title && b2.createdBy === snapshot.panelActor);
      if (made) {
        setPending(null);
        store.closeCreate();
        store.notify(`Created ${shortId(made.id)}.`);
      } else if (readSince(snapshot.freshness.localRefreshedAt, pending.since)) {
        setPending(null);
        setFeedback({ kind: "checked", saved: false });
      }
    }, [snapshot?.beads, snapshot?.freshness.localRefreshedAt, pending]);
    if (!snapshot || !start) return null;
    const paused = writesPaused(snapshot);
    const parents = parentOptions(snapshot.beads, snapshot.statuses, start.parentId);
    const dirty = title.trim() !== "" || description.trim() !== "";
    const maybeIn = feedback?.kind === "uncertain" && !feedback.saved;
    const submit = async () => {
      if (busy || paused || title.trim() === "") return;
      setBusy(true);
      setFeedback(null);
      setPending(null);
      const ids = new Set(snapshot.beads.map((b2) => b2.id));
      const outcome = await store.create({ title: title.trim(), type, priority, parentId: parentId || null, description });
      setBusy(false);
      if (outcome.kind === "uncertain" && !outcome.saved) setPending({ title: title.trim(), ids, since: Date.now() });
      if (outcome.kind === "uncertain" && outcome.saved) {
        store.closeCreate();
        store.notify("Created. It will show in the list in a moment.");
        return;
      }
      if (outcome.kind !== "ok") setFeedback(feedbackOf(outcome));
    };
    const cancel = () => dirty && !confirming ? setConfirming(true) : store.closeCreate();
    return /* @__PURE__ */ u3("div", { class: "bd-sheet", children: [
      /* @__PURE__ */ u3("div", { class: "bd-scrim", "aria-hidden": "true", onClick: cancel }),
      /* @__PURE__ */ u3(
        "div",
        {
          ref: form,
          class: "bd-create",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "New bead",
          onKeyDown: (e3) => {
            if (e3.key === "Escape") {
              e3.preventDefault();
              e3.stopPropagation();
              cancel();
            } else if (e3.key === "Tab") {
              trapTab(e3, form.current);
            } else if (confirming) {
              if (isConfirmKey(e3)) {
                e3.preventDefault();
                store.closeCreate();
              }
            } else if (isSubmitKey(e3) || isEnterInInput(e3)) {
              e3.preventDefault();
              if (!maybeIn) void submit();
            }
          },
          children: [
            /* @__PURE__ */ u3("div", { class: "bd-create-head", children: [
              /* @__PURE__ */ u3("b", { children: "New bead" }),
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-iconbtn bd-iconbtn-sm", "aria-label": "Close", onClick: cancel, children: /* @__PURE__ */ u3(IconX, {}) })
            ] }),
            paused && /* @__PURE__ */ u3(PausedNote, { reason: paused }),
            /* @__PURE__ */ u3("label", { class: "bd-cf", children: [
              /* @__PURE__ */ u3("span", { children: "Title" }),
              /* @__PURE__ */ u3("input", { ref: first, class: "bd-input", "aria-label": "Title", required: true, placeholder: "What needs doing", value: title, readOnly: busy, onInput: (e3) => setTitle(e3.currentTarget.value) })
            ] }),
            /* @__PURE__ */ u3("div", { class: "bd-cf-row", children: [
              /* @__PURE__ */ u3("label", { class: "bd-cf", children: [
                /* @__PURE__ */ u3("span", { children: "Type" }),
                /* @__PURE__ */ u3("select", { class: "bd-select", "aria-label": "Type", value: type, disabled: busy, onChange: (e3) => setType(e3.currentTarget.value), children: types.map((t3) => /* @__PURE__ */ u3("option", { value: t3, children: t3[0].toUpperCase() + t3.slice(1) }, t3)) })
              ] }),
              /* @__PURE__ */ u3("label", { class: "bd-cf", children: [
                /* @__PURE__ */ u3("span", { children: "Priority" }),
                /* @__PURE__ */ u3("select", { class: "bd-select", "aria-label": "Priority", value: String(priority), disabled: busy, onChange: (e3) => setPriority(Number(e3.currentTarget.value)), children: PRIORITY_WORDS.map((word, p3) => /* @__PURE__ */ u3("option", { value: String(p3), children: `P${p3} ${word}` }, p3)) })
              ] })
            ] }),
            /* @__PURE__ */ u3("label", { class: "bd-cf", children: [
              /* @__PURE__ */ u3("span", { children: "Parent" }),
              /* @__PURE__ */ u3("select", { class: "bd-select", "aria-label": "Parent", value: parentId, disabled: busy, onChange: (e3) => setParentId(e3.currentTarget.value), children: [
                /* @__PURE__ */ u3("option", { value: "", children: "No parent" }),
                parents.map((b2) => /* @__PURE__ */ u3("option", { value: b2.id, children: `${shortId(b2.id)}  ${b2.title}` }, b2.id))
              ] })
            ] }),
            /* @__PURE__ */ u3("label", { class: "bd-cf", children: [
              /* @__PURE__ */ u3("span", { children: "Description" }),
              /* @__PURE__ */ u3("textarea", { class: "bd-ta bd-cf-ta", "aria-label": "Description", rows: 4, placeholder: "Optional. Markdown works.", value: description, readOnly: busy, onInput: (e3) => setDescription(e3.currentTarget.value) })
            ] }),
            /* @__PURE__ */ u3(WriteMessage, { feedback }),
            confirming ? /* @__PURE__ */ u3("div", { class: "bd-confirm", role: "alertdialog", "aria-label": "Discard this bead?", children: [
              /* @__PURE__ */ u3("span", { children: "Discard this bead?" }),
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => setConfirming(false), children: "Keep editing" }),
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", "data-tone": "danger", onClick: () => store.closeCreate(), children: "Discard" })
            ] }) : /* @__PURE__ */ u3("div", { class: "bd-edacts", children: [
              /* @__PURE__ */ u3("span", { class: "bd-edhint", children: `${saveKey()} creates` }),
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: cancel, children: "Cancel" }),
              maybeIn && /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy || paused !== null || title.trim() === "", title: paused ?? "It may already exist. Make it once more.", onClick: () => void submit(), children: "Create again" }),
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: busy || maybeIn || paused !== null || title.trim() === "", title: paused ?? void 0, onClick: () => void submit(), children: busy ? "Creating\u2026" : "Create" })
            ] })
          ]
        }
      )
    ] });
  }

  // src/panel/ui/Header.tsx
  var STALE_AFTER_MS = 3e4;
  function describeFreshness(state, now) {
    const snapshot = state.snapshot;
    if (!snapshot || snapshot.workspace.kind !== "ok") return null;
    const f5 = snapshot.freshness;
    if (f5.schemaUpdate) return null;
    const parsed = f5.localRefreshedAt === null ? NaN : Date.parse(f5.localRefreshedAt);
    const refreshedAt = Number.isFinite(parsed) ? parsed : null;
    const quietFor = now - Math.max(refreshedAt ?? -Infinity, state.watchedSince);
    const stale = f5.localError !== null || quietFor > STALE_AFTER_MS;
    let problem = null;
    if (stale) {
      if (f5.localError !== null) problem = { code: "local", message: f5.localError, ...f5.localErrorDetail ? { detail: f5.localErrorDetail } : {} };
      else if (state.error) problem = state.error;
      else problem = { code: "waiting", message: "Beads hasn't answered for a while." };
    }
    const teamAt = f5.teamSyncedAt === null ? NaN : Date.parse(f5.teamSyncedAt);
    return {
      local: refreshedAt === null ? "Local, not refreshed yet" : `Local, refreshed ${ago(now - refreshedAt)}`,
      refreshedAt,
      stale,
      problem,
      team: snapshot.workspace.hasRemote ? Number.isFinite(teamAt) ? `Team synced ${ago(now - teamAt)}` : "Team not synced yet" : null,
      unpublished: snapshot.workspace.hasRemote ? f5.unpublished : 0
    };
  }
  var VIEW_LABELS = [
    ["needs", "Needs me"],
    ["epic", "Epic"],
    ["status", "Status"],
    ["activity", "Activity"]
  ];
  function Freshness({ view }) {
    return /* @__PURE__ */ u3("div", { class: "bd-fresh", "data-state": view.stale ? "stale" : "ok", children: /* @__PURE__ */ u3("div", { class: "bd-local", children: [
      /* @__PURE__ */ u3("i", { class: "bd-pulse", "aria-hidden": "true" }, view.stale ? "stale" : view.refreshedAt ?? "none"),
      /* @__PURE__ */ u3("span", { children: view.local })
    ] }) });
  }
  function FreshnessPlaceholder() {
    return /* @__PURE__ */ u3("div", { class: "bd-fresh", "data-state": "loading", "aria-hidden": "true", children: /* @__PURE__ */ u3("div", { class: "bd-local", children: [
      /* @__PURE__ */ u3("i", { class: "bd-pulse" }),
      /* @__PURE__ */ u3("span", { class: "bd-skel-text", children: "Local, refreshed just now" })
    ] }) });
  }
  function StaleBanner({ problem }) {
    const store = useStoreApi();
    return /* @__PURE__ */ u3("div", { class: "bd-stale", role: "status", children: [
      /* @__PURE__ */ u3(IconAlert, {}),
      /* @__PURE__ */ u3("span", { class: "bd-stale-msg", children: problem.message }),
      problem.detail && /* @__PURE__ */ u3("button", { type: "button", class: "bd-link", onClick: () => store.copyDetails(problem), children: "Copy details" }),
      /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => store.retry(), children: "Retry" })
    ] });
  }
  function Tools({ state, now, loading, filtersOpen, toggleFilters }) {
    const store = useStoreApi();
    const minute = Math.floor(now / 6e4) * 6e4;
    const needs = T2(() => needsOf(state, minute).count, [state.snapshot, state.settings, state.keep, minute]);
    const count = state.snapshot?.beads.length ?? 0;
    const unseen = state.snapshot?.unseenIds.length ?? 0;
    const counted = count === 1 ? "Search 1 bead" : `Search ${count} beads`;
    const placeholder = unseen > 0 ? "Search" : state.view === "activity" ? "Search activity" : "Search beads";
    return /* @__PURE__ */ u3("div", { class: "bd-tools", "data-loading": loading || void 0, children: [
      /* @__PURE__ */ u3("label", { class: "bd-search", "data-hint": placeholder === "Search" ? void 0 : "long", children: [
        /* @__PURE__ */ u3(IconSearch, {}),
        /* @__PURE__ */ u3(
          "input",
          {
            type: "search",
            placeholder,
            "aria-label": loading ? "Search beads" : state.view === "activity" ? "Search activity" : counted,
            disabled: loading,
            value: state.query,
            onInput: (e3) => store.setQuery(e3.currentTarget.value)
          }
        )
      ] }),
      /* @__PURE__ */ u3("div", { class: "bd-seg", role: "group", "aria-label": "View", children: VIEW_LABELS.map(([id, text2]) => /* @__PURE__ */ u3("button", { type: "button", "aria-pressed": state.view === id, disabled: loading, onClick: () => store.setView(id), "data-view": id, children: [
        text2,
        id === "needs" && needs > 0 && /* @__PURE__ */ u3(S, { children: [
          " ",
          /* @__PURE__ */ u3("span", { class: "bd-seg-n", children: needs > 99 ? "99+" : needs })
        ] })
      ] }, id)) }),
      /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: "bd-iconbtn",
          "aria-label": "Filters",
          "aria-expanded": filtersOpen,
          disabled: loading,
          "data-active": filtersActive(state.filters) && (state.view === "epic" || state.view === "status") || void 0,
          onClick: toggleFilters,
          children: /* @__PURE__ */ u3(IconFilter, {})
        }
      ),
      /* @__PURE__ */ u3(NewBeadButton, {}),
      unseen > 0 && /* @__PURE__ */ u3("button", { type: "button", class: "bd-unseen", "aria-label": `${unseen === 1 ? "1 bead" : `${unseen} beads`} changed since you last looked`, title: "Beads changed since you last looked", onClick: () => store.setView("activity"), children: unseen > 99 ? "99+" : unseen })
    ] });
  }
  function Header() {
    const state = useStore();
    const [filtersOpen, setFiltersOpen] = d2(false);
    const now = useNow();
    const workspace = state.workspace;
    const failed = firstLoadError(state) !== null;
    const loading = state.directory !== null && !failed && state.snapshot === null && (workspace === null || workspace.kind === "ok");
    const fresh = failed ? null : describeFreshness(state, now);
    const name = workspace?.kind === "ok" ? workspace.projectName : state.directory ? folderName(state.directory) : "Abacus";
    return /* @__PURE__ */ u3("header", { class: "bd-head", inert: state.overlays.length > 0, children: [
      /* @__PURE__ */ u3("div", { class: "bd-top", children: [
        workspace?.kind === "ok" && state.directory !== null ? /* @__PURE__ */ u3(ProjectMenu, { name, title: state.directory }, state.directory) : /* @__PURE__ */ u3("div", { class: "bd-proj", title: state.directory ?? void 0, children: [
          /* @__PURE__ */ u3(IconFolder, {}),
          /* @__PURE__ */ u3("span", { class: "bd-proj-name", children: name })
        ] }),
        fresh && /* @__PURE__ */ u3(Freshness, { view: fresh }),
        loading && /* @__PURE__ */ u3(FreshnessPlaceholder, {})
      ] }),
      fresh?.team != null && /* @__PURE__ */ u3(TeamBar, { team: fresh.team, unpublished: fresh.unpublished }),
      fresh?.problem && /* @__PURE__ */ u3(StaleBanner, { problem: fresh.problem }),
      (fresh || loading) && !state.detail && state.page === "list" && /* @__PURE__ */ u3(Tools, { state, now, loading, filtersOpen: filtersOpen && !loading, toggleFilters: () => setFiltersOpen((open) => !open) }),
      fresh && filtersOpen && !state.detail && state.page === "list" && /* @__PURE__ */ u3(Filters, {})
    ] });
  }

  // node_modules/dompurify/dist/purify.es.mjs
  function _OverloadYield(e3, d3) {
    this.v = e3, this.k = d3;
  }
  function _arrayLikeToArray(r3, a5) {
    (null == a5 || a5 > r3.length) && (a5 = r3.length);
    for (var e3 = 0, n2 = Array(a5); e3 < a5; e3++) n2[e3] = r3[e3];
    return n2;
  }
  function _arrayWithHoles(r3) {
    if (Array.isArray(r3)) return r3;
  }
  function _iterableToArrayLimit(r3, l3) {
    var t3 = null == r3 ? null : "undefined" != typeof Symbol && r3[Symbol.iterator] || r3["@@iterator"];
    if (null != t3) {
      var e3, n2, i3, u4, a5 = [], f5 = true, o3 = false;
      try {
        if (i3 = (t3 = t3.call(r3)).next, 0 === l3) {
          if (Object(t3) !== t3) return;
          f5 = false;
        } else for (; !(f5 = (e3 = i3.call(t3)).done) && (a5.push(e3.value), a5.length !== l3); f5 = true) ;
      } catch (r4) {
        o3 = true, n2 = r4;
      } finally {
        try {
          if (!f5 && null != t3.return && (u4 = t3.return(), Object(u4) !== u4)) return;
        } finally {
          if (o3) throw n2;
        }
      }
      return a5;
    }
  }
  function _nonIterableRest() {
    throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  function _slicedToArray(r3, e3) {
    return _arrayWithHoles(r3) || _iterableToArrayLimit(r3, e3) || _unsupportedIterableToArray(r3, e3) || _nonIterableRest();
  }
  function _unsupportedIterableToArray(r3, a5) {
    if (r3) {
      if ("string" == typeof r3) return _arrayLikeToArray(r3, a5);
      var t3 = {}.toString.call(r3).slice(8, -1);
      return "Object" === t3 && r3.constructor && (t3 = r3.constructor.name), "Map" === t3 || "Set" === t3 ? Array.from(r3) : "Arguments" === t3 || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t3) ? _arrayLikeToArray(r3, a5) : void 0;
    }
  }
  function AsyncGenerator(e3) {
    var t3, n2;
    function resume(t4, n3) {
      try {
        var r3 = e3[t4](n3), o3 = r3.value, u4 = o3 instanceof _OverloadYield;
        Promise.resolve(u4 ? o3.v : o3).then(function(n4) {
          if (u4) {
            var i3 = "return" === t4 && o3.k ? t4 : "next";
            if (!o3.k || n4.done) return resume(i3, n4);
            n4 = e3[i3](n4).value;
          }
          settle(!!r3.done, n4);
        }, function(e4) {
          resume("throw", e4);
        });
      } catch (e4) {
        settle(2, e4);
      }
    }
    function settle(e4, r3) {
      2 === e4 ? t3.reject(r3) : t3.resolve({
        value: r3,
        done: e4
      }), (t3 = t3.next) ? resume(t3.key, t3.arg) : n2 = null;
    }
    this._invoke = function(e4, r3) {
      return new Promise(function(o3, u4) {
        var i3 = {
          key: e4,
          arg: r3,
          resolve: o3,
          reject: u4,
          next: null
        };
        n2 ? n2 = n2.next = i3 : (t3 = n2 = i3, resume(e4, r3));
      });
    }, "function" != typeof e3.return && (this.return = void 0);
  }
  AsyncGenerator.prototype["function" == typeof Symbol && Symbol.asyncIterator || "@@asyncIterator"] = function() {
    return this;
  }, AsyncGenerator.prototype.next = function(e3) {
    return this._invoke("next", e3);
  }, AsyncGenerator.prototype.throw = function(e3) {
    return this._invoke("throw", e3);
  }, AsyncGenerator.prototype.return = function(e3) {
    return this._invoke("return", e3);
  };
  var entries = Object.entries;
  var setPrototypeOf = Object.setPrototypeOf;
  var isFrozen = Object.isFrozen;
  var getPrototypeOf = Object.getPrototypeOf;
  var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  var freeze = Object.freeze;
  var seal = Object.seal;
  var create = Object.create;
  var _ref = typeof Reflect !== "undefined" && Reflect;
  var apply = _ref.apply;
  var construct = _ref.construct;
  if (!freeze) freeze = function freeze2(x4) {
    return x4;
  };
  if (!seal) seal = function seal2(x4) {
    return x4;
  };
  if (!apply) apply = function apply2(func, thisArg) {
    for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
    return func.apply(thisArg, args);
  };
  if (!construct) construct = function construct2(Func) {
    for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) args[_key2 - 1] = arguments[_key2];
    return new Func(...args);
  };
  var arrayForEach = unapply(Array.prototype.forEach);
  Array.prototype.indexOf;
  var arrayLastIndexOf = unapply(Array.prototype.lastIndexOf);
  var arrayPop = unapply(Array.prototype.pop);
  var arrayPush = unapply(Array.prototype.push);
  var arraySlice = unapply(Array.prototype.slice);
  var arraySplice = unapply(Array.prototype.splice);
  var arrayIsArray = Array.isArray;
  var setCreate = unconstruct(Set);
  var setAdd = unapply(Set.prototype.add);
  var setHas = unapply(Set.prototype.has);
  var stringToLowerCase = unapply(String.prototype.toLowerCase);
  var stringToString = unapply(String.prototype.toString);
  var stringMatch = unapply(String.prototype.match);
  var stringReplace = unapply(String.prototype.replace);
  var stringIndexOf = unapply(String.prototype.indexOf);
  var stringTrim = unapply(String.prototype.trim);
  var numberToString = unapply(Number.prototype.toString);
  var booleanToString = unapply(Boolean.prototype.toString);
  var bigintToString = typeof BigInt === "undefined" ? null : unapply(BigInt.prototype.toString);
  var symbolToString = typeof Symbol === "undefined" ? null : unapply(Symbol.prototype.toString);
  var objectHasOwnProperty = unapply(Object.prototype.hasOwnProperty);
  var objectToString = unapply(Object.prototype.toString);
  var regExpTest = unapply(RegExp.prototype.test);
  var typeErrorCreate = unconstruct(TypeError);
  function unapply(func) {
    return function(thisArg) {
      if (thisArg instanceof RegExp) thisArg.lastIndex = 0;
      for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) args[_key3 - 1] = arguments[_key3];
      return apply(func, thisArg, args);
    };
  }
  function unconstruct(Func) {
    return function() {
      for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) args[_key4] = arguments[_key4];
      return construct(Func, args);
    };
  }
  function addToSet(set, array) {
    let transformCaseFunc = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : stringToLowerCase;
    if (setPrototypeOf) setPrototypeOf(set, null);
    if (!arrayIsArray(array)) return set;
    let l3 = array.length;
    while (l3--) {
      let element = array[l3];
      if (typeof element === "string") {
        const lcElement = transformCaseFunc(element);
        if (lcElement !== element) {
          if (!isFrozen(array)) array[l3] = lcElement;
          element = lcElement;
        }
      }
      set[element] = true;
    }
    return set;
  }
  function cleanArray(array) {
    for (let index = 0; index < array.length; index++) if (!objectHasOwnProperty(array, index)) array[index] = null;
    return array;
  }
  function clone(object) {
    const newObject = create(null);
    for (const _ref2 of entries(object)) {
      var _ref3 = _slicedToArray(_ref2, 2);
      const property = _ref3[0];
      const value = _ref3[1];
      if (objectHasOwnProperty(object, property)) {
        if (arrayIsArray(value)) newObject[property] = cleanArray(value);
        else if (value && typeof value === "object" && value.constructor === Object) newObject[property] = clone(value);
        else newObject[property] = value;
      }
    }
    return newObject;
  }
  function stringifyValue(value) {
    switch (typeof value) {
      case "string":
        return value;
      case "number":
        return numberToString(value);
      case "boolean":
        return booleanToString(value);
      case "bigint":
        return bigintToString ? bigintToString(value) : "0";
      case "symbol":
        return symbolToString ? symbolToString(value) : "Symbol()";
      case "undefined":
        return objectToString(value);
      case "function":
      case "object": {
        if (value === null) return objectToString(value);
        const valueAsRecord = value;
        const valueToString = lookupGetter(valueAsRecord, "toString");
        if (typeof valueToString === "function") {
          const stringified = valueToString(valueAsRecord);
          return typeof stringified === "string" ? stringified : objectToString(stringified);
        }
        return objectToString(value);
      }
      default:
        return objectToString(value);
    }
  }
  function lookupGetter(object, prop) {
    while (object !== null) {
      const desc = getOwnPropertyDescriptor(object, prop);
      if (desc) {
        if (desc.get) return unapply(desc.get);
        if (typeof desc.value === "function") return unapply(desc.value);
      }
      object = getPrototypeOf(object);
    }
    function fallbackValue() {
      return null;
    }
    return fallbackValue;
  }
  function lookupAccessor(object, prop) {
    while (object !== null) {
      const desc = getOwnPropertyDescriptor(object, prop);
      if (desc) return desc.get ? unapply(desc.get) : null;
      object = getPrototypeOf(object);
    }
    return null;
  }
  function isRegex(value) {
    try {
      regExpTest(value, "");
      return true;
    } catch (_unused) {
      return false;
    }
  }
  var html$1 = freeze([
    "a",
    "abbr",
    "acronym",
    "address",
    "area",
    "article",
    "aside",
    "audio",
    "b",
    "bdi",
    "bdo",
    "big",
    "blink",
    "blockquote",
    "body",
    "br",
    "button",
    "canvas",
    "caption",
    "center",
    "cite",
    "code",
    "col",
    "colgroup",
    "content",
    "data",
    "datalist",
    "dd",
    "decorator",
    "del",
    "details",
    "dfn",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "element",
    "em",
    "fieldset",
    "figcaption",
    "figure",
    "font",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hgroup",
    "hr",
    "html",
    "i",
    "img",
    "input",
    "ins",
    "kbd",
    "label",
    "legend",
    "li",
    "main",
    "map",
    "mark",
    "marquee",
    "menu",
    "menuitem",
    "meter",
    "nav",
    "nobr",
    "ol",
    "optgroup",
    "option",
    "output",
    "p",
    "picture",
    "pre",
    "progress",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "search",
    "section",
    "select",
    "shadow",
    "slot",
    "small",
    "source",
    "spacer",
    "span",
    "strike",
    "strong",
    "style",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "template",
    "textarea",
    "tfoot",
    "th",
    "thead",
    "time",
    "tr",
    "track",
    "tt",
    "u",
    "ul",
    "var",
    "video",
    "wbr"
  ]);
  var svg$1 = freeze([
    "svg",
    "a",
    "altglyph",
    "altglyphdef",
    "altglyphitem",
    "animatecolor",
    "animatemotion",
    "animatetransform",
    "circle",
    "clippath",
    "defs",
    "desc",
    "ellipse",
    "enterkeyhint",
    "exportparts",
    "filter",
    "font",
    "g",
    "glyph",
    "glyphref",
    "hkern",
    "image",
    "inputmode",
    "line",
    "lineargradient",
    "marker",
    "mask",
    "metadata",
    "mpath",
    "part",
    "path",
    "pattern",
    "polygon",
    "polyline",
    "radialgradient",
    "rect",
    "stop",
    "style",
    "switch",
    "symbol",
    "text",
    "textpath",
    "title",
    "tref",
    "tspan",
    "view",
    "vkern"
  ]);
  var svgFilters = freeze([
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feDisplacementMap",
    "feDistantLight",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feImage",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "fePointLight",
    "feSpecularLighting",
    "feSpotLight",
    "feTile",
    "feTurbulence"
  ]);
  var svgDisallowed = freeze([
    "animate",
    "color-profile",
    "cursor",
    "discard",
    "font-face",
    "font-face-format",
    "font-face-name",
    "font-face-src",
    "font-face-uri",
    "foreignobject",
    "hatch",
    "hatchpath",
    "mesh",
    "meshgradient",
    "meshpatch",
    "meshrow",
    "missing-glyph",
    "script",
    "set",
    "solidcolor",
    "unknown",
    "use"
  ]);
  var mathMl$1 = freeze([
    "math",
    "menclose",
    "merror",
    "mfenced",
    "mfrac",
    "mglyph",
    "mi",
    "mlabeledtr",
    "mmultiscripts",
    "mn",
    "mo",
    "mover",
    "mpadded",
    "mphantom",
    "mroot",
    "mrow",
    "ms",
    "mspace",
    "msqrt",
    "mstyle",
    "msub",
    "msup",
    "msubsup",
    "mtable",
    "mtd",
    "mtext",
    "mtr",
    "munder",
    "munderover",
    "mprescripts"
  ]);
  var mathMlDisallowed = freeze([
    "maction",
    "maligngroup",
    "malignmark",
    "mlongdiv",
    "mscarries",
    "mscarry",
    "msgroup",
    "mstack",
    "msline",
    "msrow",
    "semantics",
    "annotation",
    "annotation-xml",
    "mprescripts",
    "none"
  ]);
  var text = freeze(["#text"]);
  var html = freeze([
    "accept",
    "action",
    "align",
    "alt",
    "autocapitalize",
    "autocomplete",
    "autopictureinpicture",
    "autoplay",
    "background",
    "bgcolor",
    "border",
    "capture",
    "cellpadding",
    "cellspacing",
    "checked",
    "cite",
    "class",
    "clear",
    "color",
    "cols",
    "colspan",
    "command",
    "commandfor",
    "controls",
    "controlslist",
    "coords",
    "crossorigin",
    "datetime",
    "decoding",
    "default",
    "dir",
    "disabled",
    "disablepictureinpicture",
    "disableremoteplayback",
    "download",
    "draggable",
    "enctype",
    "enterkeyhint",
    "exportparts",
    "face",
    "for",
    "headers",
    "height",
    "hidden",
    "high",
    "href",
    "hreflang",
    "id",
    "inert",
    "inputmode",
    "integrity",
    "ismap",
    "kind",
    "label",
    "lang",
    "list",
    "loading",
    "loop",
    "low",
    "max",
    "maxlength",
    "media",
    "method",
    "min",
    "minlength",
    "multiple",
    "muted",
    "name",
    "nonce",
    "noshade",
    "novalidate",
    "nowrap",
    "open",
    "optimum",
    "part",
    "pattern",
    "placeholder",
    "playsinline",
    "popover",
    "popovertarget",
    "popovertargetaction",
    "poster",
    "preload",
    "pubdate",
    "radiogroup",
    "readonly",
    "rel",
    "required",
    "rev",
    "reversed",
    "role",
    "rows",
    "rowspan",
    "spellcheck",
    "scope",
    "selected",
    "shape",
    "size",
    "sizes",
    "slot",
    "span",
    "srclang",
    "start",
    "src",
    "srcset",
    "step",
    "style",
    "summary",
    "tabindex",
    "title",
    "translate",
    "type",
    "usemap",
    "valign",
    "value",
    "width",
    "wrap",
    "xmlns"
  ]);
  var svg = freeze([
    "accent-height",
    "accumulate",
    "additive",
    "alignment-baseline",
    "amplitude",
    "ascent",
    "attributename",
    "attributetype",
    "azimuth",
    "basefrequency",
    "baseline-shift",
    "begin",
    "bias",
    "by",
    "class",
    "clip",
    "clippathunits",
    "clip-path",
    "clip-rule",
    "color",
    "color-interpolation",
    "color-interpolation-filters",
    "color-profile",
    "color-rendering",
    "cx",
    "cy",
    "d",
    "dx",
    "dy",
    "diffuseconstant",
    "direction",
    "display",
    "divisor",
    "dominant-baseline",
    "dur",
    "edgemode",
    "elevation",
    "end",
    "exponent",
    "fill",
    "fill-opacity",
    "fill-rule",
    "filter",
    "filterunits",
    "flood-color",
    "flood-opacity",
    "font-family",
    "font-size",
    "font-size-adjust",
    "font-stretch",
    "font-style",
    "font-variant",
    "font-weight",
    "fx",
    "fy",
    "g1",
    "g2",
    "glyph-name",
    "glyphref",
    "gradientunits",
    "gradienttransform",
    "height",
    "href",
    "id",
    "image-rendering",
    "in",
    "in2",
    "intercept",
    "k",
    "k1",
    "k2",
    "k3",
    "k4",
    "kerning",
    "keypoints",
    "keysplines",
    "keytimes",
    "lang",
    "lengthadjust",
    "letter-spacing",
    "kernelmatrix",
    "kernelunitlength",
    "lighting-color",
    "local",
    "marker-end",
    "marker-mid",
    "marker-start",
    "markerheight",
    "markerunits",
    "markerwidth",
    "maskcontentunits",
    "maskunits",
    "max",
    "mask",
    "mask-type",
    "media",
    "method",
    "mode",
    "min",
    "name",
    "numoctaves",
    "offset",
    "operator",
    "opacity",
    "order",
    "orient",
    "orientation",
    "origin",
    "overflow",
    "paint-order",
    "path",
    "pathlength",
    "patterncontentunits",
    "patterntransform",
    "patternunits",
    "pointer-events",
    "points",
    "preservealpha",
    "preserveaspectratio",
    "primitiveunits",
    "r",
    "rx",
    "ry",
    "radius",
    "refx",
    "refy",
    "repeatcount",
    "repeatdur",
    "restart",
    "result",
    "rotate",
    "scale",
    "seed",
    "shape-rendering",
    "slope",
    "specularconstant",
    "specularexponent",
    "spreadmethod",
    "startoffset",
    "stddeviation",
    "stitchtiles",
    "stop-color",
    "stop-opacity",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-opacity",
    "stroke",
    "stroke-width",
    "style",
    "surfacescale",
    "systemlanguage",
    "tabindex",
    "tablevalues",
    "targetx",
    "targety",
    "transform",
    "transform-origin",
    "text-anchor",
    "text-decoration",
    "text-orientation",
    "text-rendering",
    "textlength",
    "type",
    "u1",
    "u2",
    "unicode",
    "values",
    "vector-effect",
    "viewbox",
    "visibility",
    "version",
    "vert-adv-y",
    "vert-origin-x",
    "vert-origin-y",
    "width",
    "word-spacing",
    "wrap",
    "writing-mode",
    "xchannelselector",
    "ychannelselector",
    "x",
    "x1",
    "x2",
    "xmlns",
    "y",
    "y1",
    "y2",
    "z",
    "zoomandpan"
  ]);
  var mathMl = freeze([
    "accent",
    "accentunder",
    "align",
    "bevelled",
    "close",
    "columnalign",
    "columnlines",
    "columnspacing",
    "columnspan",
    "denomalign",
    "depth",
    "dir",
    "display",
    "displaystyle",
    "encoding",
    "fence",
    "frame",
    "height",
    "href",
    "id",
    "largeop",
    "length",
    "linethickness",
    "lquote",
    "lspace",
    "mathbackground",
    "mathcolor",
    "mathsize",
    "mathvariant",
    "maxsize",
    "minsize",
    "movablelimits",
    "notation",
    "numalign",
    "open",
    "rowalign",
    "rowlines",
    "rowspacing",
    "rowspan",
    "rspace",
    "rquote",
    "scriptlevel",
    "scriptminsize",
    "scriptsizemultiplier",
    "selection",
    "separator",
    "separators",
    "stretchy",
    "subscriptshift",
    "supscriptshift",
    "symmetric",
    "voffset",
    "width",
    "xmlns"
  ]);
  var xml = freeze([
    "xlink:href",
    "xml:id",
    "xlink:title",
    "xml:space",
    "xmlns:xlink"
  ]);
  var MUSTACHE_EXPR = seal(/{{[\w\W]*|^[\w\W]*}}/g);
  var ERB_EXPR = seal(/<%[\w\W]*|^[\w\W]*%>/g);
  var TMPLIT_EXPR = seal(/\${[\w\W]*/g);
  var DATA_ATTR = seal(/^data-[\-\w.\u00B7-\uFFFF]+$/);
  var ARIA_ATTR = seal(/^aria-[\-\w]+$/);
  var IS_ALLOWED_URI = seal(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i);
  var IS_SCRIPT_OR_DATA = seal(/^(?:\w+script|data):/i);
  var ATTR_WHITESPACE = seal(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g);
  var DOCTYPE_NAME = seal(/^html$/i);
  var CUSTOM_ELEMENT = seal(/^[a-z][.\w]*(-[.\w]+)+$/i);
  var ELEMENT_MARKUP_PROBE = seal(/<[/\w!]/g);
  var COMMENT_MARKUP_PROBE = seal(/<[/\w]/g);
  var FALLBACK_TAG_CLOSE = seal(/<\/no(script|embed|frames)/i);
  var SELF_CLOSING_TAG = seal(/\/>/i);
  var NODE_TYPE = {
    element: 1,
    attribute: 2,
    text: 3,
    cdataSection: 4,
    entityReference: 5,
    entityNode: 6,
    processingInstruction: 7,
    comment: 8,
    document: 9,
    documentType: 10,
    documentFragment: 11,
    notation: 12
  };
  var LITERAL_TEXT_ELEMENTS = freeze(addToSet({}, [
    "style",
    "script",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "plaintext",
    "noscript"
  ]));
  var getGlobal = function getGlobal2() {
    return typeof window === "undefined" ? null : window;
  };
  var _createTrustedTypesPolicy = function _createTrustedTypesPolicy2(trustedTypes, purifyHostElement) {
    if (typeof trustedTypes !== "object" || typeof trustedTypes.createPolicy !== "function") return null;
    let suffix = null;
    const ATTR_NAME = "data-tt-policy-suffix";
    if (purifyHostElement && purifyHostElement.hasAttribute(ATTR_NAME)) suffix = purifyHostElement.getAttribute(ATTR_NAME);
    const policyName = "dompurify" + (suffix ? "#" + suffix : "");
    try {
      return trustedTypes.createPolicy(policyName, {
        createHTML(html2) {
          return html2;
        },
        createScriptURL(scriptUrl) {
          return scriptUrl;
        }
      });
    } catch (_4) {
      console.warn("TrustedTypes policy " + policyName + " could not be created.");
      return null;
    }
  };
  var _createHooksMap = function _createHooksMap2() {
    return {
      afterSanitizeAttributes: [],
      afterSanitizeElements: [],
      afterSanitizeShadowDOM: [],
      beforeSanitizeAttributes: [],
      beforeSanitizeElements: [],
      beforeSanitizeShadowDOM: [],
      uponSanitizeAttribute: [],
      uponSanitizeElement: [],
      uponSanitizeShadowNode: []
    };
  };
  var _resolveSetOption = function _resolveSetOption2(cfg, key, fallback, options) {
    return objectHasOwnProperty(cfg, key) && arrayIsArray(cfg[key]) ? addToSet(options.base ? clone(options.base) : {}, cfg[key], options.transform) : fallback;
  };
  var _resolveObjectOption = function _resolveObjectOption2(cfg, key, makeFallback) {
    const value = objectHasOwnProperty(cfg, key) ? cfg[key] : void 0;
    return value && typeof value === "object" ? clone(value) : makeFallback();
  };
  function createDOMPurify() {
    let window2 = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : getGlobal();
    const DOMPurify = (root2) => createDOMPurify(root2);
    DOMPurify.version = "3.4.17";
    DOMPurify.removed = [];
    if (!window2 || !window2.document || window2.document.nodeType !== NODE_TYPE.document || !window2.Element) {
      DOMPurify.isSupported = false;
      return DOMPurify;
    }
    let document2 = window2.document;
    const originalDocument = document2;
    const currentScript = originalDocument.currentScript;
    window2.DocumentFragment;
    const HTMLTemplateElement = window2.HTMLTemplateElement, Node2 = window2.Node, Element2 = window2.Element, NodeFilter = window2.NodeFilter;
    window2.NamedNodeMap === void 0 && (window2.NamedNodeMap || window2.MozNamedAttrMap);
    window2.HTMLFormElement;
    const DOMParser = window2.DOMParser, trustedTypes = window2.trustedTypes;
    const ElementPrototype = Element2.prototype;
    const cloneNode = lookupGetter(ElementPrototype, "cloneNode");
    const remove = lookupGetter(ElementPrototype, "remove");
    const removeAttributeNode = lookupGetter(ElementPrototype, "removeAttributeNode");
    const getNextSibling = lookupGetter(ElementPrototype, "nextSibling");
    const getChildNodes = lookupGetter(ElementPrototype, "childNodes");
    const getParentNode = lookupGetter(ElementPrototype, "parentNode");
    const getShadowRoot = lookupGetter(ElementPrototype, "shadowRoot");
    const getAttributes = lookupGetter(ElementPrototype, "attributes");
    const getNodeType = Node2 && Node2.prototype ? lookupGetter(Node2.prototype, "nodeType") : null;
    const getNodeName = Node2 && Node2.prototype ? lookupGetter(Node2.prototype, "nodeName") : null;
    const getOwnerDocument = Node2 && Node2.prototype ? lookupGetter(Node2.prototype, "ownerDocument") : null;
    const _readNodeType = function _readNodeType2(node) {
      return getNodeType ? getNodeType(node) : node.nodeType;
    };
    const _readNodeName = function _readNodeName2(node) {
      return getNodeName ? getNodeName(node) : node.nodeName;
    };
    const getNamespaceURI = lookupAccessor(ElementPrototype, "namespaceURI");
    const _readNamespaceURI = function _readNamespaceURI2(element) {
      return getNamespaceURI ? getNamespaceURI(element) : element.namespaceURI;
    };
    if (typeof HTMLTemplateElement === "function") {
      const template = document2.createElement("template");
      if (template.content && template.content.ownerDocument) document2 = template.content.ownerDocument;
    }
    let trustedTypesPolicy;
    let emptyHTML = "";
    let defaultTrustedTypesPolicy;
    let defaultTrustedTypesPolicyResolved = false;
    let IN_TRUSTED_TYPES_POLICY = 0;
    const _assertNotInTrustedTypesPolicy = function _assertNotInTrustedTypesPolicy2() {
      if (IN_TRUSTED_TYPES_POLICY > 0) throw typeErrorCreate('A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the "DOMPurify and Trusted Types" section of the README.');
    };
    const _createTrustedHTML = function _createTrustedHTML2(html2) {
      _assertNotInTrustedTypesPolicy();
      IN_TRUSTED_TYPES_POLICY++;
      try {
        return trustedTypesPolicy.createHTML(html2);
      } finally {
        IN_TRUSTED_TYPES_POLICY--;
      }
    };
    const _createTrustedScriptURL = function _createTrustedScriptURL2(scriptUrl) {
      _assertNotInTrustedTypesPolicy();
      IN_TRUSTED_TYPES_POLICY++;
      try {
        return trustedTypesPolicy.createScriptURL(scriptUrl);
      } finally {
        IN_TRUSTED_TYPES_POLICY--;
      }
    };
    const _getDefaultTrustedTypesPolicy = function _getDefaultTrustedTypesPolicy2() {
      if (!defaultTrustedTypesPolicyResolved) {
        defaultTrustedTypesPolicy = _createTrustedTypesPolicy(trustedTypes, currentScript);
        defaultTrustedTypesPolicyResolved = true;
      }
      return defaultTrustedTypesPolicy;
    };
    const _document = document2, implementation = _document.implementation, createNodeIterator = _document.createNodeIterator, createDocumentFragment = _document.createDocumentFragment, getElementsByTagName = _document.getElementsByTagName;
    const importNode = originalDocument.importNode;
    let hooks = _createHooksMap();
    DOMPurify.isSupported = typeof entries === "function" && typeof getParentNode === "function" && implementation && implementation.createHTMLDocument !== void 0;
    const MUSTACHE_EXPR$1 = MUSTACHE_EXPR, ERB_EXPR$1 = ERB_EXPR, TMPLIT_EXPR$1 = TMPLIT_EXPR, DATA_ATTR$1 = DATA_ATTR, ARIA_ATTR$1 = ARIA_ATTR, IS_SCRIPT_OR_DATA$1 = IS_SCRIPT_OR_DATA, ATTR_WHITESPACE$1 = ATTR_WHITESPACE, CUSTOM_ELEMENT$1 = CUSTOM_ELEMENT;
    let IS_ALLOWED_URI$1 = IS_ALLOWED_URI;
    let ALLOWED_TAGS = null;
    const DEFAULT_ALLOWED_TAGS = addToSet({}, [
      ...html$1,
      ...svg$1,
      ...svgFilters,
      ...mathMl$1,
      ...text
    ]);
    let ALLOWED_ATTR = null;
    const DEFAULT_ALLOWED_ATTR = addToSet({}, [
      ...html,
      ...svg,
      ...mathMl,
      ...xml
    ]);
    let CUSTOM_ELEMENT_HANDLING = Object.seal(create(null, {
      tagNameCheck: {
        writable: true,
        configurable: false,
        enumerable: true,
        value: null
      },
      attributeNameCheck: {
        writable: true,
        configurable: false,
        enumerable: true,
        value: null
      },
      allowCustomizedBuiltInElements: {
        writable: true,
        configurable: false,
        enumerable: true,
        value: false
      }
    }));
    let FORBID_TAGS = null;
    let FORBID_ATTR = null;
    const EXTRA_ELEMENT_HANDLING = Object.seal(create(null, {
      tagCheck: {
        writable: true,
        configurable: false,
        enumerable: true,
        value: null
      },
      attributeCheck: {
        writable: true,
        configurable: false,
        enumerable: true,
        value: null
      }
    }));
    let ALLOW_ARIA_ATTR = true;
    let ALLOW_DATA_ATTR = true;
    let ALLOW_UNKNOWN_PROTOCOLS = false;
    let ALLOW_SELF_CLOSE_IN_ATTR = true;
    let SAFE_FOR_TEMPLATES = false;
    let SAFE_FOR_XML = true;
    let WHOLE_DOCUMENT = false;
    let SET_CONFIG = false;
    let SET_CONFIG_ALLOWED_TAGS = null;
    let SET_CONFIG_ALLOWED_ATTR = null;
    let FORCE_BODY = false;
    let RETURN_DOM = false;
    let RETURN_DOM_FRAGMENT = false;
    let RETURN_TRUSTED_TYPE = false;
    let SANITIZE_DOM = true;
    let SANITIZE_NAMED_PROPS = false;
    const SANITIZE_NAMED_PROPS_PREFIX = "user-content-";
    let KEEP_CONTENT = true;
    let IN_PLACE = false;
    let IN_PLACE_VISITED = null;
    let USE_PROFILES = {};
    let FORBID_CONTENTS = null;
    const DEFAULT_FORBID_CONTENTS = addToSet({}, [
      "annotation-xml",
      "audio",
      "colgroup",
      "desc",
      "foreignobject",
      "head",
      "iframe",
      "math",
      "mi",
      "mn",
      "mo",
      "ms",
      "mtext",
      "noembed",
      "noframes",
      "noscript",
      "plaintext",
      "script",
      "selectedcontent",
      "style",
      "svg",
      "template",
      "thead",
      "title",
      "video",
      "xmp"
    ]);
    let DATA_URI_TAGS = null;
    const DEFAULT_DATA_URI_TAGS = addToSet({}, [
      "audio",
      "video",
      "img",
      "source",
      "image",
      "track"
    ]);
    let URI_SAFE_ATTRIBUTES = null;
    const DEFAULT_URI_SAFE_ATTRIBUTES = addToSet({}, [
      "alt",
      "class",
      "for",
      "id",
      "label",
      "name",
      "pattern",
      "placeholder",
      "role",
      "summary",
      "title",
      "value",
      "style",
      "xmlns"
    ]);
    const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
    const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
    const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
    let NAMESPACE = HTML_NAMESPACE;
    let IS_EMPTY_INPUT = false;
    let ALLOWED_NAMESPACES = null;
    const DEFAULT_ALLOWED_NAMESPACES = addToSet({}, [
      MATHML_NAMESPACE,
      SVG_NAMESPACE,
      HTML_NAMESPACE
    ], stringToString);
    const DEFAULT_MATHML_TEXT_INTEGRATION_POINTS = freeze([
      "mi",
      "mo",
      "mn",
      "ms",
      "mtext"
    ]);
    let MATHML_TEXT_INTEGRATION_POINTS = addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS);
    const DEFAULT_HTML_INTEGRATION_POINTS = freeze(["annotation-xml"]);
    let HTML_INTEGRATION_POINTS = addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS);
    const COMMON_SVG_AND_HTML_ELEMENTS = addToSet({}, [
      "title",
      "style",
      "font",
      "a",
      "script"
    ]);
    let PARSER_MEDIA_TYPE = null;
    const SUPPORTED_PARSER_MEDIA_TYPES = ["application/xhtml+xml", "text/html"];
    const DEFAULT_PARSER_MEDIA_TYPE = "text/html";
    let transformCaseFunc = null;
    let CONFIG = null;
    const formElement = document2.createElement("form");
    const isRegexOrFunction = function isRegexOrFunction2(testValue) {
      return testValue instanceof RegExp || testValue instanceof Function;
    };
    const _parseConfig = function _parseConfig2() {
      let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      if (CONFIG && CONFIG === cfg) return;
      if (!cfg || typeof cfg !== "object") cfg = {};
      cfg = clone(cfg);
      PARSER_MEDIA_TYPE = SUPPORTED_PARSER_MEDIA_TYPES.indexOf(cfg.PARSER_MEDIA_TYPE) === -1 ? DEFAULT_PARSER_MEDIA_TYPE : cfg.PARSER_MEDIA_TYPE;
      transformCaseFunc = PARSER_MEDIA_TYPE === "application/xhtml+xml" ? stringToString : stringToLowerCase;
      ALLOWED_TAGS = _resolveSetOption(cfg, "ALLOWED_TAGS", DEFAULT_ALLOWED_TAGS, { transform: transformCaseFunc });
      ALLOWED_ATTR = _resolveSetOption(cfg, "ALLOWED_ATTR", DEFAULT_ALLOWED_ATTR, { transform: transformCaseFunc });
      ALLOWED_NAMESPACES = _resolveSetOption(cfg, "ALLOWED_NAMESPACES", DEFAULT_ALLOWED_NAMESPACES, { transform: stringToString });
      URI_SAFE_ATTRIBUTES = _resolveSetOption(cfg, "ADD_URI_SAFE_ATTR", DEFAULT_URI_SAFE_ATTRIBUTES, {
        transform: transformCaseFunc,
        base: DEFAULT_URI_SAFE_ATTRIBUTES
      });
      DATA_URI_TAGS = _resolveSetOption(cfg, "ADD_DATA_URI_TAGS", DEFAULT_DATA_URI_TAGS, {
        transform: transformCaseFunc,
        base: DEFAULT_DATA_URI_TAGS
      });
      FORBID_CONTENTS = _resolveSetOption(cfg, "FORBID_CONTENTS", DEFAULT_FORBID_CONTENTS, { transform: transformCaseFunc });
      FORBID_TAGS = _resolveSetOption(cfg, "FORBID_TAGS", clone({}), { transform: transformCaseFunc });
      FORBID_ATTR = _resolveSetOption(cfg, "FORBID_ATTR", clone({}), { transform: transformCaseFunc });
      USE_PROFILES = objectHasOwnProperty(cfg, "USE_PROFILES") ? cfg.USE_PROFILES && typeof cfg.USE_PROFILES === "object" ? clone(cfg.USE_PROFILES) : cfg.USE_PROFILES : false;
      ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false;
      ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false;
      ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false;
      ALLOW_SELF_CLOSE_IN_ATTR = cfg.ALLOW_SELF_CLOSE_IN_ATTR !== false;
      SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false;
      SAFE_FOR_XML = cfg.SAFE_FOR_XML !== false;
      WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false;
      RETURN_DOM = cfg.RETURN_DOM || false;
      RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false;
      RETURN_TRUSTED_TYPE = cfg.RETURN_TRUSTED_TYPE || false;
      FORCE_BODY = cfg.FORCE_BODY || false;
      SANITIZE_DOM = cfg.SANITIZE_DOM !== false;
      SANITIZE_NAMED_PROPS = cfg.SANITIZE_NAMED_PROPS || false;
      KEEP_CONTENT = cfg.KEEP_CONTENT !== false;
      IN_PLACE = cfg.IN_PLACE || false;
      IS_ALLOWED_URI$1 = isRegex(cfg.ALLOWED_URI_REGEXP) ? cfg.ALLOWED_URI_REGEXP : IS_ALLOWED_URI;
      NAMESPACE = typeof cfg.NAMESPACE === "string" ? cfg.NAMESPACE : HTML_NAMESPACE;
      MATHML_TEXT_INTEGRATION_POINTS = _resolveObjectOption(cfg, "MATHML_TEXT_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS));
      HTML_INTEGRATION_POINTS = _resolveObjectOption(cfg, "HTML_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS));
      const customElementHandling = _resolveObjectOption(cfg, "CUSTOM_ELEMENT_HANDLING", () => create(null));
      CUSTOM_ELEMENT_HANDLING = create(null);
      if (objectHasOwnProperty(customElementHandling, "tagNameCheck") && isRegexOrFunction(customElementHandling.tagNameCheck)) CUSTOM_ELEMENT_HANDLING.tagNameCheck = customElementHandling.tagNameCheck;
      if (objectHasOwnProperty(customElementHandling, "attributeNameCheck") && isRegexOrFunction(customElementHandling.attributeNameCheck)) CUSTOM_ELEMENT_HANDLING.attributeNameCheck = customElementHandling.attributeNameCheck;
      if (objectHasOwnProperty(customElementHandling, "allowCustomizedBuiltInElements") && typeof customElementHandling.allowCustomizedBuiltInElements === "boolean") CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements = customElementHandling.allowCustomizedBuiltInElements;
      seal(CUSTOM_ELEMENT_HANDLING);
      if (SAFE_FOR_TEMPLATES) ALLOW_DATA_ATTR = false;
      if (RETURN_DOM_FRAGMENT) RETURN_DOM = true;
      if (USE_PROFILES) {
        ALLOWED_TAGS = addToSet({}, text);
        ALLOWED_ATTR = create(null);
        if (USE_PROFILES.html === true) {
          addToSet(ALLOWED_TAGS, html$1);
          addToSet(ALLOWED_ATTR, html);
        }
        if (USE_PROFILES.svg === true) {
          addToSet(ALLOWED_TAGS, svg$1);
          addToSet(ALLOWED_ATTR, svg);
          addToSet(ALLOWED_ATTR, xml);
        }
        if (USE_PROFILES.svgFilters === true) {
          addToSet(ALLOWED_TAGS, svgFilters);
          addToSet(ALLOWED_ATTR, svg);
          addToSet(ALLOWED_ATTR, xml);
        }
        if (USE_PROFILES.mathMl === true) {
          addToSet(ALLOWED_TAGS, mathMl$1);
          addToSet(ALLOWED_ATTR, mathMl);
          addToSet(ALLOWED_ATTR, xml);
        }
      }
      EXTRA_ELEMENT_HANDLING.tagCheck = null;
      EXTRA_ELEMENT_HANDLING.attributeCheck = null;
      if (objectHasOwnProperty(cfg, "ADD_TAGS")) {
        if (typeof cfg.ADD_TAGS === "function") EXTRA_ELEMENT_HANDLING.tagCheck = cfg.ADD_TAGS;
        else if (arrayIsArray(cfg.ADD_TAGS)) {
          if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) ALLOWED_TAGS = clone(ALLOWED_TAGS);
          addToSet(ALLOWED_TAGS, cfg.ADD_TAGS, transformCaseFunc);
        }
      }
      if (objectHasOwnProperty(cfg, "ADD_ATTR")) {
        if (typeof cfg.ADD_ATTR === "function") EXTRA_ELEMENT_HANDLING.attributeCheck = cfg.ADD_ATTR;
        else if (arrayIsArray(cfg.ADD_ATTR)) {
          if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) ALLOWED_ATTR = clone(ALLOWED_ATTR);
          addToSet(ALLOWED_ATTR, cfg.ADD_ATTR, transformCaseFunc);
        }
      }
      if (objectHasOwnProperty(cfg, "ADD_FORBID_CONTENTS") && arrayIsArray(cfg.ADD_FORBID_CONTENTS)) {
        if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) FORBID_CONTENTS = clone(FORBID_CONTENTS);
        addToSet(FORBID_CONTENTS, cfg.ADD_FORBID_CONTENTS, transformCaseFunc);
      }
      if (KEEP_CONTENT) ALLOWED_TAGS["#text"] = true;
      if (WHOLE_DOCUMENT) addToSet(ALLOWED_TAGS, [
        "html",
        "head",
        "body"
      ]);
      if (ALLOWED_TAGS.table) {
        addToSet(ALLOWED_TAGS, ["tbody"]);
        delete FORBID_TAGS.tbody;
      }
      if (cfg.TRUSTED_TYPES_POLICY) {
        if (typeof cfg.TRUSTED_TYPES_POLICY.createHTML !== "function") throw typeErrorCreate('TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.');
        if (typeof cfg.TRUSTED_TYPES_POLICY.createScriptURL !== "function") throw typeErrorCreate('TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.');
        const previousTrustedTypesPolicy = trustedTypesPolicy;
        trustedTypesPolicy = cfg.TRUSTED_TYPES_POLICY;
        try {
          emptyHTML = _createTrustedHTML("");
        } catch (error) {
          trustedTypesPolicy = previousTrustedTypesPolicy;
          throw error;
        }
      } else if (cfg.TRUSTED_TYPES_POLICY === null) {
        trustedTypesPolicy = void 0;
        emptyHTML = "";
      } else {
        if (trustedTypesPolicy === void 0) trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
        if (trustedTypesPolicy && typeof emptyHTML === "string") emptyHTML = _createTrustedHTML("");
      }
      if (freeze) freeze(cfg);
      CONFIG = cfg;
    };
    const ALL_SVG_TAGS = addToSet({}, [
      ...svg$1,
      ...svgFilters,
      ...svgDisallowed
    ]);
    const ALL_MATHML_TAGS = addToSet({}, [...mathMl$1, ...mathMlDisallowed]);
    const _checkSvgNamespace = function _checkSvgNamespace2(tagName, parent, parentTagName) {
      if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "svg";
      if (parent.namespaceURI === MATHML_NAMESPACE) return tagName === "svg" && (parentTagName === "annotation-xml" || MATHML_TEXT_INTEGRATION_POINTS[parentTagName]);
      return Boolean(ALL_SVG_TAGS[tagName]);
    };
    const _checkMathMlNamespace = function _checkMathMlNamespace2(tagName, parent, parentTagName) {
      if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "math";
      if (parent.namespaceURI === SVG_NAMESPACE) return tagName === "math" && HTML_INTEGRATION_POINTS[parentTagName];
      return Boolean(ALL_MATHML_TAGS[tagName]);
    };
    const _checkHtmlNamespace = function _checkHtmlNamespace2(tagName, parent, parentTagName) {
      if (parent.namespaceURI === SVG_NAMESPACE && !HTML_INTEGRATION_POINTS[parentTagName]) return false;
      if (parent.namespaceURI === MATHML_NAMESPACE && !MATHML_TEXT_INTEGRATION_POINTS[parentTagName]) return false;
      return !ALL_MATHML_TAGS[tagName] && (COMMON_SVG_AND_HTML_ELEMENTS[tagName] || !ALL_SVG_TAGS[tagName]);
    };
    const _checkValidNamespace = function _checkValidNamespace2(element) {
      const elementNamespace = _readNamespaceURI(element);
      const tagName = stringToLowerCase(_readNodeName(element));
      const parentNode = getParentNode(element);
      let parent;
      let parentTagName;
      if (parentNode && _readNodeType(parentNode) === NODE_TYPE.element) {
        parent = { namespaceURI: _readNamespaceURI(parentNode) };
        parentTagName = stringToLowerCase(_readNodeName(parentNode));
      } else {
        parent = { namespaceURI: NAMESPACE };
        parentTagName = "template";
      }
      if (!ALLOWED_NAMESPACES[elementNamespace]) return false;
      if (elementNamespace === SVG_NAMESPACE) return _checkSvgNamespace(tagName, parent, parentTagName);
      if (elementNamespace === MATHML_NAMESPACE) return _checkMathMlNamespace(tagName, parent, parentTagName);
      if (elementNamespace === HTML_NAMESPACE) return _checkHtmlNamespace(tagName, parent, parentTagName);
      if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && ALLOWED_NAMESPACES[elementNamespace]) return true;
      return false;
    };
    const _forceRemove = function _forceRemove2(node) {
      arrayPush(DOMPurify.removed, { element: node });
      try {
        getParentNode(node).removeChild(node);
      } catch (_4) {
        remove(node);
        if (!getParentNode(node)) throw typeErrorCreate("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place");
      }
    };
    const _stripAttributeNode = function _stripAttributeNode2(element, attribute, name) {
      try {
        removeAttributeNode(element, attribute);
      } catch (_4) {
        try {
          element.removeAttribute(name);
        } catch (_5) {
        }
      }
    };
    const _neutralizeRoot = function _neutralizeRoot2(root2) {
      _neutralizeSubtree(root2);
      const childNodes = getChildNodes(root2);
      if (childNodes) arrayForEach(arraySlice(childNodes), (child) => {
        try {
          remove(child);
        } catch (_4) {
        }
      });
      const attributes = _readNodeType(root2) === NODE_TYPE.element ? getAttributes(root2) : null;
      if (attributes) for (let i3 = attributes.length - 1; i3 >= 0; --i3) {
        const attribute = attributes[i3];
        const name = attribute && attribute.name;
        if (typeof name === "string") _stripAttributeNode(root2, attribute, name);
      }
    };
    const _removeAttribute = function _removeAttribute2(name, element, attr) {
      if (!attr) try {
        attr = element.getAttributeNode(name);
      } catch (_4) {
        attr = null;
      }
      arrayPush(DOMPurify.removed, {
        attribute: attr || null,
        from: element
      });
      try {
        if (attr) removeAttributeNode(element, attr);
        else element.removeAttribute(name);
      } catch (_4) {
        try {
          element.removeAttribute(name);
        } catch (_5) {
        }
      }
      if (name === "is") {
        if (RETURN_DOM || RETURN_DOM_FRAGMENT) try {
          _forceRemove(element);
        } catch (_4) {
        }
        else try {
          element.setAttribute(name, "");
        } catch (_4) {
        }
      }
    };
    const _stripDisallowedAttributes = function _stripDisallowedAttributes2(element) {
      const attributes = getAttributes(element);
      if (!attributes) return;
      for (let i3 = attributes.length - 1; i3 >= 0; --i3) {
        const attribute = attributes[i3];
        const name = attribute && attribute.name;
        if (typeof name !== "string" || ALLOWED_ATTR[transformCaseFunc(name)]) continue;
        _stripAttributeNode(element, attribute, name);
      }
    };
    const _walkTree = function _walkTree2(root2, visit) {
      let intoShadow = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
      const stack = [root2];
      while (stack.length > 0) {
        const node = stack.pop();
        if (visit(node) === false) continue;
        if (intoShadow && _readNodeType(node) === NODE_TYPE.element) {
          const shadowRoot = getShadowRoot(node);
          if (_isDocumentFragment(shadowRoot)) stack.push(shadowRoot);
        }
        const childNodes = getChildNodes(node);
        if (childNodes) for (let i3 = childNodes.length - 1; i3 >= 0; --i3) stack.push(childNodes[i3]);
      }
    };
    const _neutralizeSubtree = function _neutralizeSubtree2(root2) {
      _walkTree(root2, (node) => {
        if (_readNodeType(node) === NODE_TYPE.element) _stripDisallowedAttributes(node);
      });
    };
    const _collectLiveNodes = function _collectLiveNodes2(root2) {
      const nodes = [];
      _walkTree(root2, (node) => {
        nodes.push(node);
      }, true);
      return nodes;
    };
    const _neutralizeEscapedElements = function _neutralizeEscapedElements2(root2, before) {
      const reachable = setCreate();
      arrayForEach(_collectLiveNodes(root2), (node) => {
        if (_readNodeType(node) === NODE_TYPE.element) setAdd(reachable, node);
      });
      arrayForEach(before, (node) => {
        if (_readNodeType(node) === NODE_TYPE.element && !setHas(reachable, node)) _stripDisallowedAttributes(node);
      });
    };
    const _neutralizeDiscarded = function _neutralizeDiscarded2(root2, before) {
      let rootRemoved = false;
      arrayForEach(DOMPurify.removed, (entry) => {
        if (entry.element) {
          rootRemoved = rootRemoved || entry.element === root2;
          _neutralizeSubtree(entry.element);
        }
      });
      _neutralizeEscapedElements(root2, before);
      return rootRemoved;
    };
    const MAX_UNVISITED_ROUNDS = 8;
    const _sanitizeUnvisitedNodes = function _sanitizeUnvisitedNodes2(root2, before) {
      const visited = IN_PLACE_VISITED;
      let original = null;
      const getOriginal = () => {
        if (!original) {
          original = setCreate();
          arrayForEach(before, (beforeNode) => {
            setAdd(original, beforeNode);
          });
        }
        return original;
      };
      for (let round = 0; ; round++) {
        const live = _collectLiveNodes(root2);
        const containers = [root2];
        let pending = false;
        arrayForEach(live, (node) => {
          if (_readNodeType(node) === NODE_TYPE.documentFragment) arrayPush(containers, node);
          else if (!pending && !setHas(visited, node)) pending = setHas(getOriginal(), node);
        });
        if (!pending) return;
        if (round >= MAX_UNVISITED_ROUNDS) throw typeErrorCreate("the tree kept changing during in-place sanitization; refusing to return it");
        arrayForEach(containers, (container, index) => {
          _sanitizeUnvisitedIn(container, index > 0, root2, getOriginal());
        });
      }
    };
    const _sanitizeUnvisitedIn = function _sanitizeUnvisitedIn2(container, inShadow, root2, original) {
      const iterator = _createNodeIterator(container);
      let node;
      while (node = iterator.nextNode()) {
        if (!setHas(original, node) || setHas(IN_PLACE_VISITED, node)) continue;
        if (inShadow) _executeHooks(hooks.uponSanitizeShadowNode, node, null);
        _sanitizeElements(node, root2);
        _sanitizeAttributes(node, root2);
        if (_isDocumentFragment(node.content)) _sanitizeShadowDOM2(node.content);
      }
    };
    const _markVisited = function _markVisited2(node) {
      if (IN_PLACE_VISITED) setAdd(IN_PLACE_VISITED, node);
    };
    const _isPatchLinkageAttribute = function _isPatchLinkageAttribute2(lcName, lcTag) {
      if (!SAFE_FOR_XML) return false;
      if (lcName === "patchsrc") return true;
      return lcName === "for" && lcTag !== "label" && lcTag !== "output";
    };
    const _neutralizePatchLinkage = function _neutralizePatchLinkage2(root2) {
      if (!SAFE_FOR_XML) return;
      _walkTree(root2, (node) => {
        const nodeType = _readNodeType(node);
        if (nodeType === NODE_TYPE.processingInstruction || nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, node.data)) {
          try {
            remove(node);
          } catch (_4) {
          }
          return false;
        }
        if (nodeType === NODE_TYPE.element) {
          const element = node;
          const lcTag = transformCaseFunc(_readNodeName(node));
          try {
            if (element.hasAttribute && element.hasAttribute("patchsrc")) element.removeAttribute("patchsrc");
            if (element.hasAttribute && element.hasAttribute("for") && _isPatchLinkageAttribute("for", lcTag)) element.removeAttribute("for");
          } catch (_4) {
          }
        }
        return true;
      });
    };
    const _initDocument = function _initDocument2(dirty) {
      let doc = null;
      let leadingWhitespace = null;
      if (FORCE_BODY) dirty = "<remove></remove>" + dirty;
      else {
        const matches2 = stringMatch(dirty, /^[\r\n\t ]+/);
        leadingWhitespace = matches2 && matches2[0];
      }
      if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && NAMESPACE === HTML_NAMESPACE) dirty = '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>' + dirty + "</body></html>";
      const dirtyPayload = trustedTypesPolicy ? _createTrustedHTML(dirty) : dirty;
      if (NAMESPACE === HTML_NAMESPACE) try {
        doc = new DOMParser().parseFromString(dirtyPayload, PARSER_MEDIA_TYPE);
      } catch (_4) {
      }
      if (!doc || !doc.documentElement) {
        doc = implementation.createDocument(NAMESPACE, "template", null);
        try {
          doc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;
        } catch (_4) {
        }
      }
      const body = doc.body || doc.documentElement;
      if (dirty && leadingWhitespace) body.insertBefore(document2.createTextNode(leadingWhitespace), body.childNodes[0] || null);
      if (NAMESPACE === HTML_NAMESPACE) return getElementsByTagName.call(doc, WHOLE_DOCUMENT ? "html" : "body")[0];
      return WHOLE_DOCUMENT ? doc.documentElement : body;
    };
    const _createNodeIterator = function _createNodeIterator2(root2) {
      const doc = getOwnerDocument ? getOwnerDocument(root2) : root2.ownerDocument;
      return createNodeIterator.call(doc || root2, root2, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_CDATA_SECTION, null);
    };
    const _stripTemplateExpressions = function _stripTemplateExpressions2(value) {
      value = stringReplace(value, MUSTACHE_EXPR$1, " ");
      value = stringReplace(value, ERB_EXPR$1, " ");
      value = stringReplace(value, TMPLIT_EXPR$1, " ");
      return value;
    };
    const _scrubTemplateExpressions2 = function _scrubTemplateExpressions(node) {
      var _node$querySelectorAl;
      _scrubOwnCharacterData(node);
      const templates = (_node$querySelectorAl = node.querySelectorAll) === null || _node$querySelectorAl === void 0 ? void 0 : _node$querySelectorAl.call(node, "template");
      if (templates) arrayForEach(templates, (tmpl) => {
        if (_isDocumentFragment(tmpl.content)) _scrubTemplateExpressions2(tmpl.content);
      });
    };
    const _scrubOwnCharacterData = function _scrubOwnCharacterData2(node) {
      node.normalize();
      const doc = getOwnerDocument ? getOwnerDocument(node) : node.ownerDocument;
      const walker = createNodeIterator.call(doc || node, node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_CDATA_SECTION | NodeFilter.SHOW_PROCESSING_INSTRUCTION, null);
      let currentNode = walker.nextNode();
      while (currentNode) {
        currentNode.data = _stripTemplateExpressions(currentNode.data);
        currentNode = walker.nextNode();
      }
    };
    const _isClobbered = function _isClobbered2(element) {
      const realTagName = getNodeName ? getNodeName(element) : null;
      if (typeof realTagName !== "string") return false;
      if (transformCaseFunc(realTagName) !== "form") return false;
      return typeof element.nodeName !== "string" || typeof element.textContent !== "string" || typeof element.removeChild !== "function" || element.attributes !== getAttributes(element) || typeof element.removeAttribute !== "function" || typeof element.removeAttributeNode !== "function" || typeof element.getAttributeNode !== "function" || typeof element.setAttribute !== "function" || typeof element.namespaceURI !== "string" || typeof element.insertBefore !== "function" || typeof element.hasChildNodes !== "function" || element.nodeType !== getNodeType(element) || element.childNodes !== getChildNodes(element);
    };
    const _isDocumentFragment = function _isDocumentFragment2(value) {
      if (!getNodeType || typeof value !== "object" || value === null) return false;
      try {
        return getNodeType(value) === NODE_TYPE.documentFragment;
      } catch (_4) {
        return false;
      }
    };
    const _isNode = function _isNode2(value) {
      if (!getNodeType || typeof value !== "object" || value === null) return false;
      try {
        return typeof getNodeType(value) === "number";
      } catch (_4) {
        return false;
      }
    };
    function _executeHooks(hooks2, currentNode, data) {
      if (hooks2.length === 0) return;
      arrayForEach(hooks2, (hook) => {
        hook.call(DOMPurify, currentNode, data, CONFIG);
      });
    }
    const _isUnsafeNode = function _isUnsafeNode2(currentNode, tagName) {
      if (SAFE_FOR_XML && currentNode.hasChildNodes() && !_isNode(currentNode.firstElementChild) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.innerHTML)) return true;
      if (SAFE_FOR_XML && LITERAL_TEXT_ELEMENTS[tagName] && _readNodeType(currentNode) === NODE_TYPE.element && _readNamespaceURI(currentNode) === HTML_NAMESPACE && (_isNode(currentNode.firstElementChild) || typeof currentNode.textContent === "string" && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent))) return true;
      if (currentNode.nodeType === NODE_TYPE.processingInstruction) return true;
      if (SAFE_FOR_XML && currentNode.nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, currentNode.data)) return true;
      return false;
    };
    const _matchesNameCheck = function _matchesNameCheck2(check, name) {
      if (check instanceof RegExp) return regExpTest(check, name);
      if (check instanceof Function) {
        for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
        return Boolean(check(name, ...args));
      }
      return false;
    };
    const _sanitizeDisallowedNode = function _sanitizeDisallowedNode2(currentNode, tagName, root2) {
      if (!FORBID_TAGS[tagName] && _isBasicCustomElement(tagName) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, tagName)) return false;
      if (KEEP_CONTENT && !FORBID_CONTENTS[tagName] && !FORBID_CONTENTS[stringToLowerCase(tagName)]) {
        const parentNode = getParentNode(currentNode);
        const childNodes = getChildNodes(currentNode);
        if (childNodes && parentNode) {
          const childCount = childNodes.length;
          for (let i3 = childCount - 1; i3 >= 0; --i3) {
            const hoisted = currentNode === root2 ? cloneNode(childNodes[i3], true) : childNodes[i3];
            parentNode.insertBefore(hoisted, getNextSibling(currentNode));
          }
        }
      }
      _forceRemove(currentNode);
      return true;
    };
    const _forkSharedAllowlist = function _forkSharedAllowlist2(hookList, set, defaultSet, setConfigSet) {
      if (hookList.length === 0) return set;
      return set === defaultSet || set === setConfigSet ? clone(set) : set;
    };
    const _handleHookDetachedNode = function _handleHookDetachedNode2(currentNode, root2) {
      if (currentNode === root2 || getParentNode(currentNode) !== null) return false;
      if (IN_PLACE) _neutralizeSubtree(currentNode);
      return true;
    };
    const _sanitizeElements = function _sanitizeElements2(currentNode, root2) {
      _markVisited(currentNode);
      _executeHooks(hooks.beforeSanitizeElements, currentNode, null);
      if (_handleHookDetachedNode(currentNode, root2)) return true;
      if (_isClobbered(currentNode)) {
        _forceRemove(currentNode);
        return true;
      }
      const tagName = transformCaseFunc(_readNodeName(currentNode));
      ALLOWED_TAGS = _forkSharedAllowlist(hooks.uponSanitizeElement, ALLOWED_TAGS, DEFAULT_ALLOWED_TAGS, SET_CONFIG_ALLOWED_TAGS);
      _executeHooks(hooks.uponSanitizeElement, currentNode, {
        tagName,
        allowedTags: ALLOWED_TAGS
      });
      if (_handleHookDetachedNode(currentNode, root2)) return true;
      if (_isUnsafeNode(currentNode, tagName)) {
        _forceRemove(currentNode);
        return true;
      }
      if (FORBID_TAGS[tagName] || !(EXTRA_ELEMENT_HANDLING.tagCheck instanceof Function && EXTRA_ELEMENT_HANDLING.tagCheck(tagName)) && !ALLOWED_TAGS[tagName]) {
        const removed = _sanitizeDisallowedNode(currentNode, tagName, root2);
        if (removed === false) {
          _executeHooks(hooks.afterSanitizeElements, currentNode, null);
          if (_handleHookDetachedNode(currentNode, root2)) return true;
        }
        return removed;
      }
      if (_readNodeType(currentNode) === NODE_TYPE.element && !_checkValidNamespace(currentNode)) {
        _forceRemove(currentNode);
        return true;
      }
      if ((tagName === "noscript" || tagName === "noembed" || tagName === "noframes") && regExpTest(FALLBACK_TAG_CLOSE, currentNode.innerHTML)) {
        _forceRemove(currentNode);
        return true;
      }
      if (SAFE_FOR_TEMPLATES && currentNode.nodeType === NODE_TYPE.text) {
        const content = _stripTemplateExpressions(currentNode.textContent);
        if (currentNode.textContent !== content) {
          arrayPush(DOMPurify.removed, { element: currentNode.cloneNode() });
          currentNode.textContent = content;
        }
      }
      _executeHooks(hooks.afterSanitizeElements, currentNode, null);
      return _handleHookDetachedNode(currentNode, root2);
    };
    const _isValidAttribute = function _isValidAttribute2(lcTag, lcName, value) {
      if (FORBID_ATTR[lcName]) return false;
      if (_isPatchLinkageAttribute(lcName, lcTag)) return false;
      if (SANITIZE_DOM && (lcName === "id" || lcName === "name") && (value in document2 || value in formElement)) return false;
      const nameIsPermitted = ALLOWED_ATTR[lcName] || EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function && EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag);
      if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR$1, lcName)) return true;
      if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR$1, lcName)) return true;
      if (!nameIsPermitted) return _isBasicCustomElement(lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.attributeNameCheck, lcName, lcTag) || lcName === "is" && CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, value);
      if (URI_SAFE_ATTRIBUTES[lcName]) return true;
      if (regExpTest(IS_ALLOWED_URI$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
      if ((lcName === "src" || lcName === "xlink:href" || lcName === "href") && lcTag !== "script" && stringIndexOf(value, "data:") === 0 && DATA_URI_TAGS[lcTag]) return true;
      if (ALLOW_UNKNOWN_PROTOCOLS && !regExpTest(IS_SCRIPT_OR_DATA$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
      return !value;
    };
    const RESERVED_CUSTOM_ELEMENT_NAMES = addToSet({}, [
      "annotation-xml",
      "color-profile",
      "font-face",
      "font-face-format",
      "font-face-name",
      "font-face-src",
      "font-face-uri",
      "missing-glyph"
    ]);
    const _isBasicCustomElement = function _isBasicCustomElement2(tagName) {
      return !RESERVED_CUSTOM_ELEMENT_NAMES[stringToLowerCase(tagName)] && regExpTest(CUSTOM_ELEMENT$1, tagName);
    };
    const _applyTrustedTypesToAttribute = function _applyTrustedTypesToAttribute2(lcTag, lcName, namespaceURI, value) {
      if (trustedTypesPolicy && typeof trustedTypes === "object" && typeof trustedTypes.getAttributeType === "function" && !namespaceURI) switch (trustedTypes.getAttributeType(lcTag, lcName)) {
        case "TrustedHTML":
          return _createTrustedHTML(value);
        case "TrustedScriptURL":
          return _createTrustedScriptURL(value);
      }
      return value;
    };
    const _setAttributeValue = function _setAttributeValue2(currentNode, name, namespaceURI, value) {
      try {
        if (namespaceURI) currentNode.setAttributeNS(namespaceURI, name, value);
        else currentNode.setAttribute(name, value);
        if (_isClobbered(currentNode)) {
          _forceRemove(currentNode);
          return false;
        }
        return true;
      } catch (_4) {
        _removeAttribute(name, currentNode);
        return false;
      }
    };
    const _isUnsafeAttributeValue = function _isUnsafeAttributeValue2(name, value) {
      if (SAFE_FOR_XML && regExpTest(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i, value)) return true;
      return stringToLowerCase(name) === "attributename" && stringMatch(value, "href") !== null;
    };
    const _sanitizeAttributes = function _sanitizeAttributes2(currentNode, root2) {
      _executeHooks(hooks.beforeSanitizeAttributes, currentNode, null);
      if (_handleHookDetachedNode(currentNode, root2)) return;
      const attributes = currentNode.attributes;
      if (!attributes || _isClobbered(currentNode)) return;
      ALLOWED_ATTR = _forkSharedAllowlist(hooks.uponSanitizeAttribute, ALLOWED_ATTR, DEFAULT_ALLOWED_ATTR, SET_CONFIG_ALLOWED_ATTR);
      const hookEvent = {
        attrName: "",
        attrValue: "",
        keepAttr: true,
        allowedAttributes: ALLOWED_ATTR,
        forceKeepAttr: void 0
      };
      let l3 = attributes.length;
      const lcTag = transformCaseFunc(currentNode.nodeName);
      while (l3--) {
        const attr = attributes[l3];
        const name = attr.name, namespaceURI = attr.namespaceURI, attrValue = attr.value;
        const lcName = transformCaseFunc(name);
        const initValue = attrValue;
        let value = name === "value" ? initValue : stringTrim(initValue);
        let recreatedNamedProp = false;
        hookEvent.attrName = lcName;
        hookEvent.attrValue = value;
        hookEvent.keepAttr = true;
        hookEvent.forceKeepAttr = void 0;
        _executeHooks(hooks.uponSanitizeAttribute, currentNode, hookEvent);
        value = hookEvent.attrValue;
        if (SANITIZE_NAMED_PROPS && (lcName === "id" || lcName === "name") && stringIndexOf(value, SANITIZE_NAMED_PROPS_PREFIX) !== 0) {
          _removeAttribute(name, currentNode, attr);
          value = SANITIZE_NAMED_PROPS_PREFIX + value;
          recreatedNamedProp = true;
        }
        if (_isUnsafeAttributeValue(name, value)) {
          _removeAttribute(name, currentNode, attr);
          continue;
        }
        if (hookEvent.forceKeepAttr) continue;
        if (!hookEvent.keepAttr) {
          _removeAttribute(name, currentNode, attr);
          continue;
        }
        if (!ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value)) {
          _removeAttribute(name, currentNode, attr);
          continue;
        }
        if (SAFE_FOR_TEMPLATES) value = _stripTemplateExpressions(value);
        if (!_isValidAttribute(lcTag, lcName, value)) {
          _removeAttribute(name, currentNode, attr);
          continue;
        }
        value = _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value);
        if (value !== initValue) {
          if (_setAttributeValue(currentNode, name, namespaceURI, value) && recreatedNamedProp) arrayPop(DOMPurify.removed);
        }
      }
      _executeHooks(hooks.afterSanitizeAttributes, currentNode, null);
      _handleHookDetachedNode(currentNode, root2);
    };
    const _sanitizeShadowDOM2 = function _sanitizeShadowDOM(fragment) {
      let shadowNode = null;
      const shadowIterator = _createNodeIterator(fragment);
      _executeHooks(hooks.beforeSanitizeShadowDOM, fragment, null);
      while (shadowNode = shadowIterator.nextNode()) {
        _executeHooks(hooks.uponSanitizeShadowNode, shadowNode, null);
        _sanitizeElements(shadowNode, fragment);
        _sanitizeAttributes(shadowNode, fragment);
        if (_isDocumentFragment(shadowNode.content)) _sanitizeShadowDOM2(shadowNode.content);
        if (_readNodeType(shadowNode) === NODE_TYPE.element) {
          const innerSr = getShadowRoot(shadowNode);
          if (_isDocumentFragment(innerSr)) {
            _sanitizeAttachedShadowRoots(innerSr);
            _sanitizeShadowDOM2(innerSr);
          }
        }
      }
      if (SAFE_FOR_TEMPLATES) _scrubOwnCharacterData(fragment);
      _executeHooks(hooks.afterSanitizeShadowDOM, fragment, null);
    };
    const _sanitizeAttachedShadowRoots = function _sanitizeAttachedShadowRoots2(root2) {
      const stack = [{
        node: root2,
        shadow: null
      }];
      while (stack.length > 0) {
        const item = stack.pop();
        if (item.shadow) {
          _sanitizeShadowDOM2(item.shadow);
          continue;
        }
        const node = item.node;
        const isElement = _readNodeType(node) === NODE_TYPE.element;
        const childNodes = getChildNodes(node);
        if (childNodes) for (let i3 = childNodes.length - 1; i3 >= 0; --i3) stack.push({
          node: childNodes[i3],
          shadow: null
        });
        if (isElement) {
          const rootName = getNodeName ? getNodeName(node) : null;
          if (typeof rootName === "string" && transformCaseFunc(rootName) === "template") {
            const content = node.content;
            if (_isDocumentFragment(content)) stack.push({
              node: content,
              shadow: null
            });
          }
        }
        if (isElement) {
          const sr = getShadowRoot(node);
          if (_isDocumentFragment(sr)) stack.push({
            node: null,
            shadow: sr
          }, {
            node: sr,
            shadow: null
          });
        }
      }
    };
    DOMPurify.sanitize = function(dirty) {
      let cfg = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      let body = null;
      let importedNode = null;
      let currentNode = null;
      let returnNode = null;
      IS_EMPTY_INPUT = !dirty;
      if (IS_EMPTY_INPUT) dirty = "<!-->";
      if (typeof dirty !== "string" && !_isNode(dirty)) {
        dirty = stringifyValue(dirty);
        if (typeof dirty !== "string") throw typeErrorCreate("dirty is not a string, aborting");
      }
      if (!DOMPurify.isSupported) return dirty;
      if (SET_CONFIG) {
        ALLOWED_TAGS = SET_CONFIG_ALLOWED_TAGS;
        ALLOWED_ATTR = SET_CONFIG_ALLOWED_ATTR;
      } else _parseConfig(cfg);
      if (hooks.uponSanitizeElement.length > 0 || hooks.uponSanitizeAttribute.length > 0) ALLOWED_TAGS = clone(ALLOWED_TAGS);
      if (hooks.uponSanitizeAttribute.length > 0) ALLOWED_ATTR = clone(ALLOWED_ATTR);
      DOMPurify.removed = [];
      const inPlace = IN_PLACE && typeof dirty !== "string" && _isNode(dirty);
      let inPlaceNodes = [];
      const outerVisited = IN_PLACE_VISITED;
      if (inPlace) {
        _neutralizePatchLinkage(dirty);
        const nn = _readNodeName(dirty);
        if (typeof nn === "string") {
          const tagName = transformCaseFunc(nn);
          if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
            _neutralizeRoot(dirty);
            throw typeErrorCreate("root node is forbidden and cannot be sanitized in-place");
          }
        }
        if (_isClobbered(dirty)) {
          _neutralizeRoot(dirty);
          throw typeErrorCreate("root node is clobbered and cannot be sanitized in-place");
        }
        inPlaceNodes = _collectLiveNodes(dirty);
        IN_PLACE_VISITED = setCreate();
      } else if (_isNode(dirty)) {
        body = _initDocument("<!---->");
        importedNode = body.ownerDocument.importNode(dirty, true);
        if (importedNode.nodeType === NODE_TYPE.element && importedNode.nodeName === "BODY") body = importedNode;
        else if (importedNode.nodeName === "HTML") body = importedNode;
        else body.appendChild(importedNode);
        _sanitizeAttachedShadowRoots(body);
      } else {
        if (!RETURN_DOM && !SAFE_FOR_TEMPLATES && !WHOLE_DOCUMENT && dirty.indexOf("<") === -1) return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(dirty) : dirty;
        body = _initDocument(dirty);
        if (!body) return RETURN_DOM ? null : RETURN_TRUSTED_TYPE ? emptyHTML : "";
      }
      if (body && FORCE_BODY) _forceRemove(body.firstChild);
      const walkRoot = inPlace ? dirty : body;
      try {
        if (inPlace) _sanitizeAttachedShadowRoots(dirty);
        const nodeIterator = _createNodeIterator(walkRoot);
        while (currentNode = nodeIterator.nextNode()) {
          _sanitizeElements(currentNode, walkRoot);
          _sanitizeAttributes(currentNode, walkRoot);
          if (_isDocumentFragment(currentNode.content)) _sanitizeShadowDOM2(currentNode.content);
        }
        if (inPlace) _sanitizeUnvisitedNodes(dirty, inPlaceNodes);
      } catch (error) {
        if (inPlace) {
          _neutralizeRoot(dirty);
          _neutralizeDiscarded(dirty, inPlaceNodes);
        }
        throw error;
      } finally {
        IN_PLACE_VISITED = outerVisited;
      }
      if (inPlace) {
        if (_neutralizeDiscarded(dirty, inPlaceNodes)) throw typeErrorCreate("a node selected for removal could not be safely returned; refusing to sanitize in place");
        if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(dirty);
        return dirty;
      }
      if (RETURN_DOM) {
        if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(body);
        if (RETURN_DOM_FRAGMENT) {
          returnNode = createDocumentFragment.call(body.ownerDocument);
          while (body.firstChild) returnNode.appendChild(body.firstChild);
        } else returnNode = body;
        if (ALLOWED_ATTR.shadowroot || ALLOWED_ATTR.shadowrootmode) returnNode = importNode.call(originalDocument, returnNode, true);
        return returnNode;
      }
      let serializedHTML = WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;
      if (WHOLE_DOCUMENT && ALLOWED_TAGS["!doctype"] && body.ownerDocument && body.ownerDocument.doctype && body.ownerDocument.doctype.name && regExpTest(DOCTYPE_NAME, body.ownerDocument.doctype.name)) serializedHTML = "<!DOCTYPE " + body.ownerDocument.doctype.name + ">\n" + serializedHTML;
      if (SAFE_FOR_TEMPLATES) serializedHTML = _stripTemplateExpressions(serializedHTML);
      return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(serializedHTML) : serializedHTML;
    };
    DOMPurify.setConfig = function() {
      let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      _parseConfig(cfg);
      SET_CONFIG = true;
      SET_CONFIG_ALLOWED_TAGS = ALLOWED_TAGS;
      SET_CONFIG_ALLOWED_ATTR = ALLOWED_ATTR;
    };
    DOMPurify.clearConfig = function() {
      CONFIG = null;
      SET_CONFIG = false;
      SET_CONFIG_ALLOWED_TAGS = null;
      SET_CONFIG_ALLOWED_ATTR = null;
      trustedTypesPolicy = defaultTrustedTypesPolicy;
      emptyHTML = "";
    };
    DOMPurify.isValidAttribute = function(tag, attr, value) {
      if (!CONFIG) _parseConfig({});
      const lcTag = transformCaseFunc(tag);
      const lcName = transformCaseFunc(attr);
      if (typeof value === "string" && (_isUnsafeAttributeValue(attr, value) || !ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value))) return false;
      return _isValidAttribute(lcTag, lcName, value);
    };
    DOMPurify.addHook = function(entryPoint, hookFunction) {
      if (typeof hookFunction !== "function") return;
      if (!objectHasOwnProperty(hooks, entryPoint)) return;
      arrayPush(hooks[entryPoint], hookFunction);
    };
    DOMPurify.removeHook = function(entryPoint, hookFunction) {
      if (!objectHasOwnProperty(hooks, entryPoint)) return;
      if (hookFunction !== void 0) {
        const index = arrayLastIndexOf(hooks[entryPoint], hookFunction);
        return index === -1 ? void 0 : arraySplice(hooks[entryPoint], index, 1)[0];
      }
      return arrayPop(hooks[entryPoint]);
    };
    DOMPurify.removeHooks = function(entryPoint) {
      if (!objectHasOwnProperty(hooks, entryPoint)) return;
      hooks[entryPoint] = [];
    };
    DOMPurify.removeAllHooks = function() {
      hooks = _createHooksMap();
    };
    return DOMPurify;
  }
  var purify_default = createDOMPurify();

  // node_modules/marked/lib/marked.esm.js
  function B3() {
    return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
  }
  var y3 = B3();
  function V2(a5) {
    y3 = a5;
  }
  var M = { exec: () => null };
  function D3(a5) {
    let e3 = [];
    return (t3) => {
      let n2 = Math.max(0, Math.min(3, t3 - 1)), i3 = e3[n2];
      return i3 || (i3 = a5(n2), e3[n2] = i3), i3;
    };
  }
  function h3(a5, e3 = "") {
    let t3 = typeof a5 == "string" ? a5 : a5.source, n2 = { replace: (i3, r3) => {
      let o3 = typeof r3 == "string" ? r3 : r3.source;
      return o3 = o3.replace(x3.caret, "$1"), t3 = t3.replace(i3, o3), n2;
    }, getRegex: () => new RegExp(t3, e3) };
    return n2;
  }
  var ze = ((a5 = "") => {
    try {
      return !!new RegExp("(?<=1)(?<!1)" + a5);
    } catch {
      return false;
    }
  })();
  var x3 = { codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, endingSpaceTabChar: /[ \t]$/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, leadingSpaceTab: /^[ \t]+/, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/, numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (a5) => new RegExp(`^( {0,3}${a5})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: D3((a5) => new RegExp(`^ {0,${a5}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: D3((a5) => new RegExp(`^ {0,${a5}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)), fencesBeginRegex: D3((a5) => new RegExp(`^ {0,${a5}}(?:\`\`\`|~~~)`)), headingBeginRegex: D3((a5) => new RegExp(`^ {0,${a5}}#`)), htmlBeginRegex: D3((a5) => new RegExp(`^ {0,${a5}}(?:</?(?:${Q2})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, "i")), blockquoteBeginRegex: D3((a5) => new RegExp(`^ {0,${a5}}>`)) };
  var Ee = /^(?:[ \t]*(?:\n|$))+/;
  var Me = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
  var Ce = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
  var N2 = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
  var Ie = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
  var Y = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
  var fe = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
  var me = h3(fe).replace(/bull/g, Y).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
  var Be = h3(fe).replace(/bull/g, Y).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
  var ee = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
  var De = /^[^\n]+/;
  var te = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
  var qe = h3(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", te).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
  var Ze = h3(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, Y).getRegex();
  var Q2 = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
  var ne = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
  var ve = h3("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", ne).replace("tag", Q2).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
  var xe = (a5) => h3(ee).replace("hr", N2).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", a5).replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Q2).getRegex();
  var He = xe(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
  var Ge = xe(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
  var Ne = h3(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", Ge).getRegex();
  var re = { blockquote: Ne, code: Me, def: qe, fences: Ce, heading: Ie, hr: N2, html: ve, lheading: me, list: Ze, newline: Ee, paragraph: He, table: M, text: De };
  var de = h3("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", N2).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Q2).getRegex();
  var Qe = { ...re, lheading: Be, table: de, paragraph: h3(ee).replace("hr", N2).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", de).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Q2).getRegex() };
  var je = { ...re, html: h3(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", ne).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: M, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: h3(ee).replace("hr", N2).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", me).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
  var Fe = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
  var Ue = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
  var be = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
  var Ke = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
  var S2 = /[\p{P}\p{S}]/u;
  var q3 = /[\s\p{P}\p{S}]/u;
  var j3 = /[^\s\p{P}\p{S}]/u;
  var Xe = h3(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, q3).getRegex();
  var We = /[\p{Pi}\p{Ps}"']/u;
  var Re = /(?!~)[\p{P}\p{S}]/u;
  var Ve = /(?!~)[\s\p{P}\p{S}]/u;
  var Je = /(?:[^\s\p{P}\p{S}]|~)/u;
  var Ye = h3(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", ze ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
  var Te = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
  var et = h3(Te, "u").replace(/punct/g, S2).getRegex();
  var tt = h3(Te, "u").replace(/punct/g, Re).getRegex();
  var nt = /^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/;
  var rt = h3(nt, "u").replace(/openQuote/g, We).replace(/punct/g, S2).getRegex();
  var Oe = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
  var st = h3(Oe, "gu").replace(/notPunctSpace/g, j3).replace(/punctSpace/g, q3).replace(/punct/g, S2).getRegex();
  var it = h3(Oe, "gu").replace(/notPunctSpace/g, Je).replace(/punctSpace/g, Ve).replace(/punct/g, Re).getRegex();
  var ot = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)";
  var at = h3(ot, "gu").replace(/notPunctSpace/g, j3).replace(/punctSpace/g, q3).replace(/punct/g, S2).getRegex();
  var lt = h3("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, j3).replace(/punctSpace/g, q3).replace(/punct/g, S2).getRegex();
  var ut = "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)";
  var pt = h3(ut, "gu").replace(/notPunctSpace/g, j3).replace(/punctSpace/g, q3).replace(/punct/g, S2).getRegex();
  var ct = h3(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, S2).getRegex();
  var ht = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
  var dt = h3(ht, "gu").replace(/notPunctSpace/g, j3).replace(/punctSpace/g, q3).replace(/punct/g, S2).getRegex();
  var kt = h3(/\\(punct)/, "gu").replace(/punct/g, S2).getRegex();
  var gt = h3(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, "gu").replace(/punct/g, S2).getRegex();
  var ft = h3(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
  var mt = h3(ne).replace("(?:-->|$)", "-->").getRegex();
  var xt = h3("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", mt).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
  var we = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
  var K2 = h3(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets", we).getRegex();
  var bt = h3(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/).replace("label", K2).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
  var Rt = h3(/^!?\[(label)\]\[(ref)\]/).replace("label", K2).replace("ref", te).getRegex();
  var Tt = h3(/^!?\[(ref)\](?:\[\])?/).replace("ref", te).getRegex();
  var ke = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
  var Ot = h3(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets", we).getRegex();
  var wt = h3("reflink|nolink(?!\\()", "g").replace("reflink", h3(/^!?\[(label)\]\[(ref)\]/).replace("label", Ot).replace("ref", ke).getRegex()).replace("nolink", h3(/^!?\[(ref)\](?:\[\])?/).replace("ref", ke).getRegex()).getRegex();
  var ge = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
  var Pt = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
  var yt = h3(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, Pt).getRegex();
  var se = { _backpedal: M, anyPunctuation: kt, anyPunctuationOutsideCode: gt, autolink: ft, blockSkip: Ye, br: be, code: Ue, del: M, delLDelim: M, delRDelim: M, emStrongLDelim: et, emStrongRDelimAst: st, emStrongRDelimUnd: lt, escape: Fe, link: bt, nolink: Tt, punctuation: Xe, reflink: Rt, reflinkSearch: wt, tag: xt, text: Ke, url: M };
  var St = { ...se, emStrongLDelim: rt, emStrongRDelimAst: at, emStrongRDelimUnd: pt, link: h3(/^!?\[(label)\]\((.*?)\)/).replace("label", K2).getRegex(), reflink: h3(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", K2).getRegex() };
  var J2 = { ...se, emStrongRDelimAst: it, emStrongLDelim: tt, delLDelim: ct, delRDelim: dt, url: h3(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("emailProtocol", yt).replace("protocol", ge).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: h3(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace("protocol", ge).replace(/emailProtocol/g, /(?:mailto|xmpp):/).getRegex() };
  var _t = { ...J2, br: h3(be).replace("{2,}", "*").getRegex(), text: h3(J2.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
  var F = { normal: re, gfm: Qe, pedantic: je };
  var Z = { normal: se, gfm: J2, breaks: _t, pedantic: St };
  var $t = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  var Pe = (a5) => $t[a5];
  function w3(a5, e3) {
    if (e3) {
      if (x3.escapeTest.test(a5)) return a5.replace(x3.escapeReplace, Pe);
    } else if (x3.escapeTestNoEncode.test(a5)) return a5.replace(x3.escapeReplaceNoEncode, Pe);
    return a5;
  }
  function ye(a5) {
    return x3.numericCharacterReference.test(a5) ? a5.replace(x3.numericCharacterReferenceOrAmpersand, (e3, t3, n2) => {
      if (t3 === void 0 && n2 === void 0) return "&amp;";
      let i3 = t3 === void 0 ? Number.parseInt(n2, 16) : Number.parseInt(t3, 10);
      return i3 === 0 || i3 > 1114111 || i3 >= 55296 && i3 <= 57343 ? "\uFFFD" : i3 === 38 ? "&amp;" : String.fromCodePoint(i3);
    }) : a5;
  }
  function ie(a5) {
    try {
      a5 = encodeURI(a5).replace(x3.percentDecode, "%");
    } catch {
      return null;
    }
    return a5;
  }
  function oe(a5, e3) {
    let t3 = a5.replace(x3.findPipe, (r3, o3, s3) => {
      let l3 = false, u4 = o3;
      for (; --u4 >= 0 && s3[u4] === "\\"; ) l3 = !l3;
      return l3 ? "|" : " |";
    }), n2 = t3.split(x3.splitPipe), i3 = 0;
    if (n2[0].trim() || n2.shift(), n2.length > 0 && !n2.at(-1)?.trim() && n2.pop(), e3) if (n2.length > e3) n2.splice(e3);
    else for (; n2.length < e3; ) n2.push("");
    for (; i3 < n2.length; i3++) n2[i3] = n2[i3].trim().replace(x3.slashPipe, "|");
    return n2;
  }
  function A3(a5, e3, t3) {
    let n2 = a5.length;
    if (n2 === 0) return "";
    let i3 = 0;
    for (; i3 < n2; ) {
      let r3 = a5.charAt(n2 - i3 - 1);
      if (r3 === e3 && !t3) i3++;
      else if (r3 !== e3 && t3) i3++;
      else break;
    }
    return a5.slice(0, n2 - i3);
  }
  function ae(a5) {
    let e3 = a5.split(`
`), t3 = e3.length - 1;
    for (; t3 >= 0 && x3.blankLine.test(e3[t3]); ) t3--;
    return e3.length - t3 <= 2 ? a5 : e3.slice(0, t3 + 1).join(`
`);
  }
  function v4(a5) {
    return a5.trim().toLowerCase().toUpperCase().toLowerCase();
  }
  function le(a5, e3) {
    if (a5.indexOf(e3[0]) === -1 && a5.indexOf(e3[1]) === -1) return -1;
    let t3 = 0;
    for (let n2 = 0; n2 < a5.length; n2++) if (a5[n2] === "\\") n2++;
    else if (a5[n2] === e3[0]) t3++;
    else if (a5[n2] === e3[1] && (t3--, t3 < 0)) return n2;
    return t3 > 0 ? -2 : -1;
  }
  function X2(a5, e3 = 0) {
    let t3 = e3, n2 = "";
    for (let i3 of a5) if (i3 === "	") {
      let r3 = 4 - t3 % 4;
      n2 += " ".repeat(r3), t3 += r3;
    } else n2 += i3, t3++;
    return n2;
  }
  function Se(a5, e3, t3, n2, i3) {
    let r3 = e3.href, o3 = e3.title || null, s3 = a5[1].replace(i3.other.outputLinkReplace, "$1"), l3 = a5[0].charAt(0) === "!", u4 = n2.state.inLink, c3 = n2.state.linkEmitted, p3 = n2.state.inRawBlock;
    n2.state.inLink = true, n2.state.linkEmitted = false;
    let d3 = n2.inlineTokens(s3), g3 = n2.state.linkEmitted;
    if (n2.state.linkEmitted = c3, n2.state.inLink = u4, !l3) {
      if (g3) {
        n2.state.inRawBlock = p3;
        return;
      }
      n2.state.linkEmitted = true;
    }
    return { type: l3 ? "image" : "link", raw: t3, href: r3, title: o3, text: s3, tokens: d3 };
  }
  function Lt(a5, e3, t3) {
    let n2 = a5.match(t3.other.indentCodeCompensation);
    if (n2 === null) return e3;
    let i3 = n2[1];
    return e3.split(`
`).map((r3) => {
      let o3 = r3.match(t3.other.beginningSpace);
      if (o3 === null) return r3;
      let [s3] = o3;
      return r3.slice(Math.min(s3.length, i3.length));
    }).join(`
`);
  }
  function _e(a5, e3, t3, n2) {
    if (!e3.includes("<")) return false;
    for (let i3 = 0; i3 < e3.length; i3++) {
      if (e3[i3] === "\\") {
        i3++;
        continue;
      }
      if (e3[i3] === "`") {
        let s3 = n2.inline.code.exec(e3.slice(i3));
        if (s3) {
          i3 += s3[0].length - 1;
          continue;
        }
      }
      if (e3[i3] !== "<") continue;
      let r3 = a5.slice(t3 + i3), o3 = n2.inline.tag.exec(r3) || n2.inline.autolink.exec(r3);
      if (o3) {
        if (o3[0].length > e3.length - i3) return true;
        i3 += o3[0].length - 1;
      }
    }
    return false;
  }
  var _3 = class {
    options;
    rules;
    lexer;
    constructor(e3) {
      this.options = e3 || y3;
    }
    space(e3) {
      let t3 = this.rules.block.newline.exec(e3);
      if (t3 && t3[0].length > 0) return { type: "space", raw: t3[0] };
    }
    code(e3) {
      let t3 = this.rules.block.code.exec(e3);
      if (t3) {
        let n2 = this.options.pedantic ? t3[0] : ae(t3[0]), i3 = n2.replace(this.rules.other.codeRemoveIndent, "");
        return { type: "code", raw: n2, codeBlockStyle: "indented", text: i3 };
      }
    }
    fences(e3) {
      let t3 = this.rules.block.fences.exec(e3);
      if (t3) {
        let n2 = t3[0], i3 = Lt(n2, t3[3] || "", this.rules);
        return { type: "code", raw: n2, lang: t3[2] ? t3[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t3[2], text: i3 };
      }
    }
    heading(e3) {
      let t3 = this.rules.block.heading.exec(e3);
      if (t3) {
        let n2 = t3[2].trim();
        if (this.rules.other.endingHash.test(n2)) {
          let i3 = A3(n2, "#");
          (this.options.pedantic || !i3 || this.rules.other.endingSpaceTabChar.test(i3)) && (n2 = i3.trim());
        }
        return { type: "heading", raw: A3(t3[0], `
`), depth: t3[1].length, text: n2, tokens: this.lexer.inline(n2) };
      }
    }
    hr(e3) {
      let t3 = this.rules.block.hr.exec(e3);
      if (t3) return { type: "hr", raw: A3(t3[0], `
`) };
    }
    blockquote(e3) {
      let t3 = this.rules.block.blockquote.exec(e3);
      if (t3) {
        let n2 = A3(t3[0], `
`).split(`
`), i3 = "", r3 = "", o3 = [];
        for (; n2.length > 0; ) {
          let s3 = false, l3 = [], u4;
          for (u4 = 0; u4 < n2.length; u4++) if (this.rules.other.blockquoteStart.test(n2[u4])) l3.push(n2[u4]), s3 = true;
          else if (!s3) l3.push(n2[u4]);
          else break;
          n2 = n2.slice(u4);
          let c3 = l3.join(`
`), p3 = c3.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
          i3 = i3 ? `${i3}
${c3}` : c3, r3 = r3 ? `${r3}
${p3}` : p3;
          let d3 = this.lexer.state.top;
          if (this.lexer.state.top = true, this.lexer.blockTokens(p3, o3, true), this.lexer.state.top = d3, n2.length === 0) break;
          let g3 = o3.at(-1);
          if (g3?.type === "code" || g3?.type === "heading" || g3?.type === "hr" || g3?.type === "html") break;
          if (g3?.type === "blockquote") {
            let k3 = g3, P2 = n2.join(`
`), R2 = k3.raw + `
` + P2.replace(this.rules.other.blockquoteSetextReplace2, ""), m3 = this.blockquote(R2);
            o3[o3.length - 1] = m3;
            let E2 = R2.substring(m3.raw.length).replace(/^\n/, ""), b2 = E2 ? E2.split(`
`).length : 0, H2 = b2 ? n2.slice(0, -b2) : n2;
            H2.length > 0 && (i3 = `${i3}
${H2.join(`
`)}`), r3 = r3.substring(0, r3.length - k3.text.length) + m3.text;
            break;
          } else if (g3?.type === "list") {
            let k3 = g3, P2 = k3.raw + `
` + n2.join(`
`), R2 = this.list(P2);
            o3[o3.length - 1] = R2, i3 = i3.substring(0, i3.length - g3.raw.length) + R2.raw, r3 = r3.substring(0, r3.length - k3.raw.length) + R2.raw, n2 = P2.substring(o3.at(-1).raw.length).split(`
`);
            continue;
          }
        }
        return { type: "blockquote", raw: i3, tokens: o3, text: r3 };
      }
    }
    list(e3) {
      let t3 = this.rules.block.list.exec(e3);
      if (t3) {
        let n2 = e3, i3 = () => n2.length - e3.length, r3 = t3[1].trim(), o3 = r3.length > 1, s3 = { type: "list", raw: "", ordered: o3, start: o3 ? +r3.slice(0, -1) : "", loose: false, items: [] };
        r3 = o3 ? `\\d{1,9}\\${r3.slice(-1)}` : `\\${r3}`, this.options.pedantic && (r3 = o3 ? r3 : "[*+-]");
        let l3 = this.rules.other.listItemRegex(r3), u4 = false;
        for (; e3; ) {
          let p3 = false, d3 = "";
          if (!(t3 = l3.exec(e3)) || this.rules.block.hr.test(e3)) break;
          let g3 = i3();
          e3 = e3.substring(t3[0].length);
          let k3 = t3[2].split(`
`, 1)[0], P2 = t3[1].length, R2 = this.options.pedantic ? X2(k3, P2) : k3.replace(this.rules.other.leadingSpaceTab, (W) => X2(W, P2)), m3 = e3.split(`
`, 1)[0], E2 = !R2.trim(), b2 = 0;
          if (this.options.pedantic ? (b2 = 2, d3 = R2.trimStart()) : E2 ? b2 = P2 + 1 : (b2 = R2.search(this.rules.other.nonSpaceChar), b2 = b2 > 4 ? 1 : b2, d3 = R2.slice(b2), b2 += P2), E2 && this.rules.other.blankLine.test(m3) && (e3 = e3.substring(m3.length + 1), p3 = true), !p3) {
            let W = this.rules.other.nextBulletRegex(b2), ue = this.rules.other.hrRegex(b2), pe = this.rules.other.fencesBeginRegex(b2), ce = this.rules.other.headingBeginRegex(b2), $e = this.rules.other.htmlBeginRegex(b2), Le = this.rules.other.blockquoteBeginRegex(b2);
            for (; e3; ) {
              let he = e3.split(`
`, 1)[0], G2;
              if (m3 = he, this.options.pedantic ? (m3 = m3.replace(this.rules.other.listReplaceNesting, "  "), G2 = m3) : G2 = m3.replace(this.rules.other.leadingSpaceTab, (Ae) => X2(Ae)), pe.test(m3) || ce.test(m3) || $e.test(m3) || Le.test(m3) || W.test(m3) || ue.test(m3)) break;
              if (G2.search(this.rules.other.nonSpaceChar) >= b2 || !m3.trim()) d3 += `
` + G2.slice(b2);
              else {
                if (E2 || R2.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || pe.test(R2) || ce.test(R2) || ue.test(R2)) break;
                d3 += `
` + m3;
              }
              E2 = !m3.trim(), e3 = e3.substring(he.length + 1), R2 = G2.slice(b2);
            }
          }
          let H2 = n2.slice(g3, i3());
          s3.loose || (u4 ? s3.loose = true : this.rules.other.doubleBlankLine.test(H2) && (u4 = true)), s3.items.push({ type: "list_item", raw: H2, task: !!this.options.gfm && this.rules.other.listIsTask.test(d3), loose: false, text: d3, tokens: [] });
        }
        let c3 = s3.items.at(-1);
        if (c3) c3.raw = c3.raw.trimEnd(), c3.text = c3.text.trimEnd();
        else return;
        s3.raw = n2.slice(0, i3()).trimEnd();
        for (let p3 of s3.items) if (this.lexer.state.top = false, p3.tokens = this.lexer.blockTokens(p3.text, []), !s3.loose) {
          let d3 = p3.tokens.filter((k3) => k3.type === "space"), g3 = d3.length > 0 && d3.some((k3) => this.rules.other.anyLine.test(k3.raw));
          s3.loose = g3;
        }
        for (let p3 of s3.items) {
          let d3 = p3.tokens[0];
          if (p3.task && (d3?.type === "text" || d3?.type === "paragraph")) {
            p3.text = p3.text.replace(this.rules.other.listReplaceTask, ""), d3.raw = d3.raw.replace(this.rules.other.listReplaceTask, ""), d3.text = d3.text.replace(this.rules.other.listReplaceTask, "");
            for (let k3 = this.lexer.inlineQueue.length - 1; k3 >= 0; k3--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[k3].src)) {
              this.lexer.inlineQueue[k3].src = this.lexer.inlineQueue[k3].src.replace(this.rules.other.listReplaceTask, "");
              break;
            }
            let g3 = this.rules.other.listTaskCheckbox.exec(p3.raw);
            if (g3) {
              let k3 = { type: "checkbox", raw: g3[0] + " ", checked: g3[0] !== "[ ]" };
              p3.checked = k3.checked, s3.loose ? p3.tokens[0] && ["paragraph", "text"].includes(p3.tokens[0].type) && "tokens" in p3.tokens[0] && p3.tokens[0].tokens ? (p3.tokens[0].raw = k3.raw + p3.tokens[0].raw, p3.tokens[0].text = k3.raw + p3.tokens[0].text, p3.tokens[0].tokens.unshift(k3)) : p3.tokens.unshift({ type: "paragraph", raw: k3.raw, text: k3.raw, tokens: [k3] }) : p3.tokens.unshift(k3);
            }
          } else p3.task && (p3.task = false);
        }
        if (s3.loose) for (let p3 of s3.items) {
          p3.loose = true;
          for (let d3 of p3.tokens) d3.type === "text" && (d3.type = "paragraph");
        }
        return s3;
      }
    }
    html(e3) {
      let t3 = this.rules.block.html.exec(e3);
      if (t3) {
        let n2 = ae(t3[0]);
        return { type: "html", block: true, raw: n2, pre: t3[1] === "pre" || t3[1] === "script" || t3[1] === "style", text: n2 };
      }
    }
    def(e3) {
      let t3 = this.rules.block.def.exec(e3);
      if (t3) {
        if (!this.rules.other.startAngleBracket.test(t3[2]) && le(t3[2], "()") !== -1) return;
        let n2 = v4(t3[1]).replace(this.rules.other.multipleSpaceGlobal, " "), i3 = t3[2] ? t3[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r3 = t3[3] ? t3[3].substring(1, t3[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t3[3];
        return { type: "def", tag: n2, raw: A3(t3[0], `
`), href: i3, title: r3 };
      }
    }
    table(e3) {
      let t3 = this.rules.block.table.exec(e3);
      if (!t3 || !this.rules.other.tableDelimiter.test(t3[2])) return;
      let n2 = oe(t3[1]), i3 = t3[2].replace(this.rules.other.tableAlignChars, "").split("|"), r3 = t3[3]?.trim() ? t3[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], o3 = { type: "table", raw: A3(t3[0], `
`), header: [], align: [], rows: [] };
      if (n2.length === i3.length) {
        for (let s3 of i3) this.rules.other.tableAlignRight.test(s3) ? o3.align.push("right") : this.rules.other.tableAlignCenter.test(s3) ? o3.align.push("center") : this.rules.other.tableAlignLeft.test(s3) ? o3.align.push("left") : o3.align.push(null);
        for (let s3 = 0; s3 < n2.length; s3++) o3.header.push({ text: n2[s3], tokens: this.lexer.inline(n2[s3]), header: true, align: o3.align[s3] });
        for (let s3 of r3) o3.rows.push(oe(s3, o3.header.length).map((l3, u4) => ({ text: l3, tokens: this.lexer.inline(l3), header: false, align: o3.align[u4] })));
        return o3;
      }
    }
    lheading(e3) {
      let t3 = this.rules.block.lheading.exec(e3);
      if (t3) {
        let n2 = t3[1].trim();
        return { type: "heading", raw: A3(t3[0], `
`), depth: t3[2].charAt(0) === "=" ? 1 : 2, text: n2, tokens: this.lexer.inline(n2) };
      }
    }
    paragraph(e3) {
      let t3 = this.rules.block.paragraph.exec(e3);
      if (t3) {
        let n2 = t3[1].charAt(t3[1].length - 1) === `
` ? t3[1].slice(0, -1) : t3[1];
        return { type: "paragraph", raw: t3[0], text: n2, tokens: this.lexer.inline(n2) };
      }
    }
    text(e3) {
      let t3 = this.rules.block.text.exec(e3);
      if (t3) return { type: "text", raw: t3[0], text: t3[0], tokens: this.lexer.inline(t3[0]) };
    }
    escape(e3) {
      let t3 = this.rules.inline.escape.exec(e3);
      if (t3) return { type: "escape", raw: t3[0], text: t3[1] };
    }
    tag(e3) {
      let t3 = this.rules.inline.tag.exec(e3);
      if (t3) return !this.lexer.state.inLink && this.rules.other.startATag.test(t3[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t3[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t3[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t3[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t3[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t3[0] };
    }
    link(e3) {
      if (this.lexer.state.linkParenPossible === false) return;
      let t3 = this.rules.inline.link.exec(e3);
      if (t3) {
        let n2 = t3[0].charAt(0) === "!" ? 2 : 1;
        if (!this.options.pedantic && _e(e3, t3[1], n2, this.rules)) return;
        let i3 = t3[2].trim();
        if (!this.options.pedantic && this.rules.other.startAngleBracket.test(i3)) {
          if (!this.rules.other.endAngleBracket.test(i3)) return;
          let s3 = A3(i3.slice(0, -1), "\\");
          if ((i3.length - s3.length) % 2 === 0) return;
        } else {
          let s3 = le(t3[2], "()");
          if (s3 === -2) return;
          if (s3 > -1) {
            let u4 = (t3[0].indexOf("!") === 0 ? 5 : 4) + t3[1].length + s3;
            t3[2] = t3[2].substring(0, s3), t3[0] = t3[0].substring(0, u4).trim(), t3[3] = "";
          }
        }
        let r3 = t3[2], o3 = "";
        if (this.options.pedantic) {
          let s3 = this.rules.other.pedanticHrefTitle.exec(r3);
          s3 && (r3 = s3[1], o3 = s3[3]);
        } else o3 = t3[3] ? t3[3].slice(1, -1) : "";
        return r3 = r3.trim(), this.rules.other.startAngleBracket.test(r3) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(i3) ? r3 = r3.slice(1) : r3 = r3.slice(1, -1)), Se(t3, { href: r3 && r3.replace(this.rules.inline.anyPunctuation, "$1"), title: o3 && o3.replace(this.rules.inline.anyPunctuation, "$1") }, t3[0], this.lexer, this.rules);
      }
    }
    reflink(e3, t3) {
      let n2;
      if ((n2 = this.rules.inline.reflink.exec(e3)) || (n2 = this.rules.inline.nolink.exec(e3))) {
        let i3 = n2[0].charAt(0) === "!" ? 2 : 1;
        if (!this.options.pedantic && _e(e3, n2[1], i3, this.rules)) return;
        let r3 = (n2[2] || n2[1]).replace(this.rules.other.multipleSpaceGlobal, " "), o3 = t3[v4(r3)];
        if (!o3) {
          let s3 = n2[0].charAt(0);
          return { type: "text", raw: s3, text: s3 };
        }
        return Se(n2, o3, n2[0], this.lexer, this.rules);
      }
    }
    emStrong(e3, t3, n2 = "") {
      let i3 = this.rules.inline.emStrongLDelim.exec(e3);
      if (!i3 || !i3[1] && !i3[2] && !i3[3] && !i3[4] || i3[4] && n2.match(this.rules.other.unicodeAlphaNumeric)) return;
      if (!(i3[1] || i3[3] || "") || !n2 || this.rules.inline.punctuation.exec(n2)) {
        let o3 = [...i3[0]].length - 1, s3, l3, u4 = o3, c3 = 0, p3 = i3[0][0], d3 = n2 === p3, g3 = p3 === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
        for (g3.lastIndex = 0, t3 = t3.slice(-1 * e3.length + o3); (i3 = g3.exec(t3)) !== null; ) {
          if (s3 = i3[1] || i3[2] || i3[3] || i3[4] || i3[5] || i3[6], !s3) continue;
          if (l3 = [...s3].length, i3[3] || i3[4]) {
            u4 += l3;
            continue;
          } else if (i3[5] || i3[6]) {
            if (o3 % 3 && !((o3 + l3) % 3)) {
              c3 += l3;
              continue;
            }
            if (d3) break;
          }
          if (u4 -= l3, u4 > 0) continue;
          l3 = Math.min(l3, l3 + u4 + c3);
          let k3 = [...i3[0]][0].length, P2 = e3.slice(0, o3 + i3.index + k3 + l3);
          if (Math.min(o3, l3) % 2) {
            let m3 = P2.slice(1, -1);
            return { type: "em", raw: P2, text: m3, tokens: this.lexer.inlineTokens(m3) };
          }
          let R2 = P2.slice(2, -2);
          return { type: "strong", raw: P2, text: R2, tokens: this.lexer.inlineTokens(R2) };
        }
      }
    }
    codespan(e3) {
      let t3 = this.rules.inline.code.exec(e3);
      if (t3) {
        let n2 = t3[2].replace(this.rules.other.newLineCharGlobal, " "), i3 = this.rules.other.nonSpaceChar.test(n2), r3 = this.rules.other.startingSpaceChar.test(n2) && this.rules.other.endingSpaceChar.test(n2);
        return i3 && r3 && (n2 = n2.substring(1, n2.length - 1)), { type: "codespan", raw: t3[0], text: n2 };
      }
    }
    br(e3) {
      let t3 = this.rules.inline.br.exec(e3);
      if (t3) return { type: "br", raw: t3[0] };
    }
    del(e3, t3, n2 = "") {
      let i3 = this.rules.inline.delLDelim.exec(e3);
      if (!i3) return;
      if (!(i3[1] || "") || !n2 || this.rules.inline.punctuation.exec(n2)) {
        let o3 = [...i3[0]].length - 1, s3, l3, u4 = o3, c3 = this.rules.inline.delRDelim;
        for (c3.lastIndex = 0, t3 = t3.slice(-1 * e3.length + o3); (i3 = c3.exec(t3)) !== null; ) {
          if (s3 = i3[1] || i3[2] || i3[3] || i3[4] || i3[5] || i3[6], !s3 || (l3 = [...s3].length, l3 !== o3)) continue;
          if (i3[3] || i3[4]) {
            u4 += l3;
            continue;
          }
          if (u4 -= l3, u4 > 0) continue;
          l3 = Math.min(l3, l3 + u4);
          let p3 = [...i3[0]][0].length, d3 = e3.slice(0, o3 + i3.index + p3 + l3), g3 = d3.slice(o3, -o3);
          return { type: "del", raw: d3, text: g3, tokens: this.lexer.inlineTokens(g3) };
        }
      }
    }
    autolink(e3) {
      let t3 = this.rules.inline.autolink.exec(e3);
      if (t3) {
        let n2, i3;
        return t3[2] === "@" ? (n2 = t3[1], i3 = "mailto:" + n2) : (n2 = t3[1], i3 = n2), { type: "link", raw: t3[0], text: n2, href: i3, autolink: true, tokens: [{ type: "text", raw: n2, text: n2 }] };
      }
    }
    url(e3) {
      let t3;
      if (t3 = this.rules.inline.url.exec(e3)) {
        let n2, i3;
        if (t3[2] === "@") n2 = t3[0], i3 = "mailto:" + n2;
        else {
          let r3;
          do
            r3 = t3[0], t3[0] = this.rules.inline._backpedal.exec(t3[0])?.[0] ?? "";
          while (r3 !== t3[0]);
          n2 = t3[0], t3[1] === "www." ? i3 = "http://" + t3[0] : i3 = t3[0];
        }
        return { type: "link", raw: t3[0], text: n2, href: i3, autolink: true, tokens: [{ type: "text", raw: n2, text: n2 }] };
      }
    }
    inlineText(e3) {
      let t3 = this.rules.inline.text.exec(e3);
      if (t3) {
        let n2 = this.lexer.state.inRawBlock;
        return { type: "text", raw: t3[0], text: n2 ? t3[0] : ye(t3[0]), escaped: n2 };
      }
    }
  };
  var T3 = class a3 {
    tokens;
    options;
    state;
    inlineQueue;
    tokenizer;
    constructor(e3) {
      this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e3 || y3, this.options.tokenizer = this.options.tokenizer || new _3(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, linkEmitted: false, linkParenPossible: true, top: true };
      let t3 = { other: x3, block: F.normal, inline: Z.normal };
      this.options.pedantic ? (t3.block = F.pedantic, t3.inline = Z.pedantic) : this.options.gfm && (t3.block = F.gfm, this.options.breaks ? t3.inline = Z.breaks : t3.inline = Z.gfm), this.tokenizer.rules = t3;
    }
    static get rules() {
      return { block: F, inline: Z };
    }
    static lex(e3, t3) {
      return new a3(t3).lex(e3);
    }
    static lexInline(e3, t3) {
      return new a3(t3).inlineTokens(e3);
    }
    lex(e3) {
      e3 = e3.replace(x3.carriageReturn, `
`), this.blockTokens(e3, this.tokens);
      for (let t3 = 0; t3 < this.inlineQueue.length; t3++) {
        let n2 = this.inlineQueue[t3];
        this.inlineTokens(n2.src, n2.tokens);
      }
      return this.inlineQueue = [], this.tokens;
    }
    blockTokens(e3, t3 = [], n2 = false) {
      this.tokenizer.lexer = this, this.options.pedantic && (e3 = e3.replace(x3.tabCharGlobal, "    ").replace(x3.spaceLine, ""));
      let i3 = 1 / 0;
      for (; e3; ) {
        if (e3.length < i3) i3 = e3.length;
        else {
          this.infiniteLoopError(e3.charCodeAt(0));
          break;
        }
        let r3;
        if (this.options.extensions?.block?.some((s3) => (r3 = s3.call({ lexer: this }, e3, t3)) ? (e3 = e3.substring(r3.raw.length), t3.push(r3), true) : false)) continue;
        if (r3 = this.tokenizer.space(e3)) {
          e3 = e3.substring(r3.raw.length);
          let s3 = t3.at(-1);
          r3.raw.length === 1 && s3 !== void 0 ? s3.raw += `
` : t3.push(r3);
          continue;
        }
        if (r3 = this.tokenizer.code(e3)) {
          e3 = e3.substring(r3.raw.length);
          let s3 = t3.at(-1);
          s3?.type === "paragraph" || s3?.type === "text" ? (s3.raw += (s3.raw.endsWith(`
`) ? "" : `
`) + r3.raw, s3.text += `
` + r3.text, this.inlineQueue.at(-1).src = s3.text) : t3.push(r3);
          continue;
        }
        if (r3 = this.tokenizer.fences(e3)) {
          e3 = e3.substring(r3.raw.length), t3.push(r3);
          continue;
        }
        if (r3 = this.tokenizer.heading(e3)) {
          e3 = e3.substring(r3.raw.length), t3.push(r3);
          continue;
        }
        if (r3 = this.tokenizer.hr(e3)) {
          e3 = e3.substring(r3.raw.length), t3.push(r3);
          continue;
        }
        if (r3 = this.tokenizer.blockquote(e3)) {
          e3 = e3.substring(r3.raw.length), t3.push(r3);
          continue;
        }
        if (r3 = this.tokenizer.list(e3)) {
          e3 = e3.substring(r3.raw.length), t3.push(r3);
          continue;
        }
        if (r3 = this.tokenizer.html(e3)) {
          e3 = e3.substring(r3.raw.length), t3.push(r3);
          continue;
        }
        if (r3 = this.tokenizer.def(e3)) {
          e3 = e3.substring(r3.raw.length);
          let s3 = t3.at(-1);
          s3?.type === "paragraph" || s3?.type === "text" ? (s3.raw += (s3.raw.endsWith(`
`) ? "" : `
`) + r3.raw, s3.text += `
` + r3.raw, this.inlineQueue.at(-1).src = s3.text) : this.tokens.links[r3.tag] || (this.tokens.links[r3.tag] = { href: r3.href, title: r3.title }, t3.push(r3));
          continue;
        }
        if (r3 = this.tokenizer.table(e3)) {
          e3 = e3.substring(r3.raw.length), t3.push(r3);
          continue;
        }
        if (r3 = this.tokenizer.lheading(e3)) {
          e3 = e3.substring(r3.raw.length), t3.push(r3);
          continue;
        }
        let o3 = e3;
        if (this.options.extensions?.startBlock) {
          let s3 = 1 / 0, l3 = e3.slice(1), u4;
          this.options.extensions.startBlock.forEach((c3) => {
            u4 = c3.call({ lexer: this }, l3), typeof u4 == "number" && u4 >= 0 && (s3 = Math.min(s3, u4));
          }), s3 < 1 / 0 && s3 >= 0 && (o3 = e3.substring(0, s3 + 1));
        }
        if (this.state.top && (r3 = this.tokenizer.paragraph(o3))) {
          let s3 = t3.at(-1);
          n2 && s3?.type === "paragraph" ? (s3.raw += (s3.raw.endsWith(`
`) ? "" : `
`) + r3.raw, s3.text += `
` + r3.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s3.text) : t3.push(r3), n2 = o3.length !== e3.length, e3 = e3.substring(r3.raw.length);
          continue;
        }
        if (r3 = this.tokenizer.text(e3)) {
          e3 = e3.substring(r3.raw.length);
          let s3 = t3.at(-1);
          s3?.type === "text" ? (s3.raw += (s3.raw.endsWith(`
`) ? "" : `
`) + r3.raw, s3.text += `
` + r3.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s3.text) : t3.push(r3);
          continue;
        }
        if (e3) {
          this.infiniteLoopError(e3.charCodeAt(0));
          break;
        }
      }
      return this.state.top = true, t3;
    }
    inline(e3, t3 = []) {
      return this.inlineQueue.push({ src: e3, tokens: t3 }), t3;
    }
    linkInText(e3) {
      if (!e3.includes("[")) return false;
      let t3 = this.tokenizer.rules.inline.link;
      for (let n2 of e3.matchAll(this.tokenizer.rules.inline.blockSkip)) if (t3.test(n2[0]) && e3.charAt(n2.index - 1) !== "!") return true;
      for (let n2 of e3.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
        let i3 = n2[0], r3 = i3.lastIndexOf("[");
        if (!(i3.charAt(0) === "!" || !Object.hasOwn(this.tokens.links, v4(i3.slice(r3 + 1, -1)))) && !(r3 > 1 && this.linkInText(i3.slice(1, r3 - 1)))) return true;
      }
      return false;
    }
    inlineTokens(e3, t3 = []) {
      this.tokenizer.lexer = this;
      let n2 = this.state.linkParenPossible;
      this.state.linkParenPossible = n2 && e3.includes(")");
      try {
        return this.#e(e3, t3);
      } finally {
        this.state.linkParenPossible = n2;
      }
    }
    #e(e3, t3) {
      let n2 = e3;
      if (this.tokens.links && e3.includes("[")) {
        let s3 = this.tokenizer.rules.inline.reflinkSearch, l3 = (u4) => {
          let c3 = u4.lastIndexOf("[");
          if (!Object.hasOwn(this.tokens.links, v4(u4.slice(c3 + 1, -1)))) return u4;
          if (c3 > 1 && u4.charAt(0) !== "!") {
            let p3 = u4.slice(1, c3 - 1);
            if (this.linkInText(p3)) return "[" + p3.replace(s3, l3) + "][" + "a".repeat(u4.length - c3 - 2) + "]";
          }
          return "[" + "a".repeat(u4.length - 2) + "]";
        };
        n2 = n2.replace(s3, l3);
      }
      n2 = n2.replace(this.tokenizer.rules.inline.anyPunctuationOutsideCode, (s3, l3, u4) => u4 ? "+".repeat(s3.length) : l3 ? l3 + s3.slice(l3.length, -l3.length).replace(/`/g, "+") + l3 : s3), n2 = n2.replace(this.tokenizer.rules.inline.blockSkip, (s3, l3, u4) => {
        let c3 = u4 ? u4.length : 0;
        return s3.slice(0, c3) + "[" + "a".repeat(s3.length - c3 - 2) + "]";
      }), n2 = this.options.hooks?.emStrongMask?.call({ lexer: this }, n2) ?? n2;
      let i3 = false, r3 = "", o3 = 1 / 0;
      for (; e3; ) {
        if (e3.length < o3) o3 = e3.length;
        else {
          this.infiniteLoopError(e3.charCodeAt(0));
          break;
        }
        i3 || (r3 = ""), i3 = false;
        let s3;
        if (this.options.extensions?.inline?.some((u4) => (s3 = u4.call({ lexer: this }, e3, t3)) ? (e3 = e3.substring(s3.raw.length), t3.push(s3), true) : false)) continue;
        if (s3 = this.tokenizer.escape(e3)) {
          e3 = e3.substring(s3.raw.length), t3.push(s3);
          continue;
        }
        if (s3 = this.tokenizer.tag(e3)) {
          e3 = e3.substring(s3.raw.length), t3.push(s3);
          continue;
        }
        if (s3 = this.tokenizer.link(e3)) {
          e3 = e3.substring(s3.raw.length), t3.push(s3);
          continue;
        }
        if (s3 = this.tokenizer.reflink(e3, this.tokens.links)) {
          e3 = e3.substring(s3.raw.length);
          let u4 = t3.at(-1);
          s3.type === "text" && u4?.type === "text" ? (u4.raw += s3.raw, u4.text += s3.text) : t3.push(s3);
          continue;
        }
        if (s3 = this.tokenizer.emStrong(e3, n2, r3)) {
          e3 = e3.substring(s3.raw.length), t3.push(s3);
          continue;
        }
        if (s3 = this.tokenizer.codespan(e3)) {
          e3 = e3.substring(s3.raw.length), t3.push(s3);
          continue;
        }
        if (s3 = this.tokenizer.br(e3)) {
          e3 = e3.substring(s3.raw.length), t3.push(s3);
          continue;
        }
        if (s3 = this.tokenizer.del(e3, n2, r3)) {
          e3 = e3.substring(s3.raw.length), t3.push(s3);
          continue;
        }
        if (s3 = this.tokenizer.autolink(e3)) {
          e3 = e3.substring(s3.raw.length), t3.push(s3);
          continue;
        }
        if (!this.state.inLink && (s3 = this.tokenizer.url(e3))) {
          e3 = e3.substring(s3.raw.length), t3.push(s3);
          continue;
        }
        let l3 = e3;
        if (this.options.extensions?.startInline) {
          let u4 = 1 / 0, c3 = e3.slice(1), p3;
          this.options.extensions.startInline.forEach((d3) => {
            p3 = d3.call({ lexer: this }, c3), typeof p3 == "number" && p3 >= 0 && (u4 = Math.min(u4, p3));
          }), u4 < 1 / 0 && u4 >= 0 && (l3 = e3.substring(0, u4 + 1));
        }
        if (s3 = this.tokenizer.inlineText(l3)) {
          e3 = e3.substring(s3.raw.length), s3.raw.slice(-1) !== "_" && (r3 = s3.raw.slice(-1)), i3 = true;
          let u4 = t3.at(-1);
          u4?.type === "text" ? (u4.raw += s3.raw, u4.text += s3.text) : t3.push(s3);
          continue;
        }
        if (e3) {
          this.infiniteLoopError(e3.charCodeAt(0));
          break;
        }
      }
      return t3;
    }
    infiniteLoopError(e3) {
      let t3 = "Infinite loop on byte: " + e3;
      if (this.options.silent) console.error(t3);
      else throw new Error(t3);
    }
  };
  var $2 = class {
    options;
    parser;
    constructor(e3) {
      this.options = e3 || y3;
    }
    space(e3) {
      return "";
    }
    code({ text: e3, lang: t3, escaped: n2 }) {
      let i3 = (t3 || "").match(x3.notSpaceStart)?.[0], r3 = e3 ? e3.replace(x3.endingNewline, "") + `
` : "";
      return i3 ? '<pre><code class="language-' + w3(i3) + '">' + (n2 ? r3 : w3(r3, true)) + `</code></pre>
` : "<pre><code>" + (n2 ? r3 : w3(r3, true)) + `</code></pre>
`;
    }
    blockquote({ tokens: e3 }) {
      return `<blockquote>
${this.parser.parse(e3)}</blockquote>
`;
    }
    html({ text: e3 }) {
      return e3;
    }
    def(e3) {
      return "";
    }
    heading({ tokens: e3, depth: t3 }) {
      return `<h${t3}>${this.parser.parseInline(e3)}</h${t3}>
`;
    }
    hr(e3) {
      return `<hr>
`;
    }
    list(e3) {
      let t3 = e3.ordered, n2 = e3.start, i3 = "";
      for (let s3 = 0; s3 < e3.items.length; s3++) {
        let l3 = e3.items[s3];
        i3 += this.listitem(l3);
      }
      let r3 = t3 ? "ol" : "ul", o3 = t3 && n2 !== 1 ? ' start="' + n2 + '"' : "";
      return "<" + r3 + o3 + `>
` + i3 + "</" + r3 + `>
`;
    }
    listitem(e3) {
      return `<li>${this.parser.parse(e3.tokens)}</li>
`;
    }
    checkbox({ checked: e3 }) {
      return "<input " + (e3 ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
    }
    paragraph({ tokens: e3 }) {
      return `<p>${this.parser.parseInline(e3)}</p>
`;
    }
    table(e3) {
      let t3 = "", n2 = "";
      for (let r3 = 0; r3 < e3.header.length; r3++) n2 += this.tablecell(e3.header[r3]);
      t3 += this.tablerow({ text: n2 });
      let i3 = "";
      for (let r3 = 0; r3 < e3.rows.length; r3++) {
        let o3 = e3.rows[r3];
        n2 = "";
        for (let s3 = 0; s3 < o3.length; s3++) n2 += this.tablecell(o3[s3]);
        i3 += this.tablerow({ text: n2 });
      }
      return i3 && (i3 = `<tbody>${i3}</tbody>`), `<table>
<thead>
` + t3 + `</thead>
` + i3 + `</table>
`;
    }
    tablerow({ text: e3 }) {
      return `<tr>
${e3}</tr>
`;
    }
    tablecell(e3) {
      let t3 = this.parser.parseInline(e3.tokens), n2 = e3.header ? "th" : "td";
      return (e3.align ? `<${n2} align="${e3.align}">` : `<${n2}>`) + t3 + `</${n2}>
`;
    }
    strong({ tokens: e3 }) {
      return `<strong>${this.parser.parseInline(e3)}</strong>`;
    }
    em({ tokens: e3 }) {
      return `<em>${this.parser.parseInline(e3)}</em>`;
    }
    codespan({ text: e3 }) {
      return `<code>${w3(e3, true)}</code>`;
    }
    br(e3) {
      return "<br>";
    }
    del({ tokens: e3 }) {
      return `<del>${this.parser.parseInline(e3)}</del>`;
    }
    link({ href: e3, title: t3, text: n2, tokens: i3, autolink: r3 }) {
      let o3 = r3 ? w3(n2, true) : this.parser.parseInline(i3), s3 = ie(e3);
      if (s3 === null) return o3;
      e3 = w3(s3, r3);
      let l3 = '<a href="' + e3 + '"';
      return t3 && (l3 += ' title="' + w3(t3) + '"'), l3 += ">" + o3 + "</a>", l3;
    }
    image({ href: e3, title: t3, text: n2, tokens: i3 }) {
      i3 && (n2 = this.parser.parseInline(i3, this.parser.textRenderer));
      let r3 = ie(e3);
      if (r3 === null) return w3(n2);
      e3 = r3;
      let o3 = `<img src="${w3(e3)}" alt="${w3(n2)}"`;
      return t3 && (o3 += ` title="${w3(t3)}"`), o3 += ">", o3;
    }
    text(e3) {
      return "tokens" in e3 && e3.tokens ? this.parser.parseInline(e3.tokens) : "escaped" in e3 && e3.escaped ? e3.text : w3(e3.text);
    }
  };
  var z3 = class {
    strong({ text: e3 }) {
      return e3;
    }
    em({ text: e3 }) {
      return e3;
    }
    codespan({ text: e3 }) {
      return e3;
    }
    del({ text: e3 }) {
      return e3;
    }
    html({ text: e3 }) {
      return e3;
    }
    text({ text: e3 }) {
      return e3;
    }
    link({ text: e3 }) {
      return "" + e3;
    }
    image({ text: e3 }) {
      return "" + e3;
    }
    br() {
      return "";
    }
    checkbox({ raw: e3 }) {
      return e3;
    }
  };
  var O2 = class a4 {
    options;
    renderer;
    textRenderer;
    constructor(e3) {
      this.options = e3 || y3, this.options.renderer = this.options.renderer || new $2(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new z3();
    }
    static parse(e3, t3) {
      return new a4(t3).parse(e3);
    }
    static parseInline(e3, t3) {
      return new a4(t3).parseInline(e3);
    }
    parse(e3) {
      this.renderer.parser = this;
      let t3 = "";
      for (let n2 = 0; n2 < e3.length; n2++) {
        let i3 = e3[n2];
        if (this.options.extensions?.renderers?.[i3.type]) {
          let o3 = i3, s3 = this.options.extensions.renderers[o3.type].call({ parser: this }, o3);
          if (s3 !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "checkbox", "html", "def", "paragraph", "text"].includes(o3.type)) {
            t3 += s3 || "";
            continue;
          }
        }
        let r3 = i3;
        switch (r3.type) {
          case "space": {
            t3 += this.renderer.space(r3);
            break;
          }
          case "hr": {
            t3 += this.renderer.hr(r3);
            break;
          }
          case "heading": {
            t3 += this.renderer.heading(r3);
            break;
          }
          case "code": {
            t3 += this.renderer.code(r3);
            break;
          }
          case "table": {
            t3 += this.renderer.table(r3);
            break;
          }
          case "blockquote": {
            t3 += this.renderer.blockquote(r3);
            break;
          }
          case "list": {
            t3 += this.renderer.list(r3);
            break;
          }
          case "checkbox": {
            t3 += this.renderer.checkbox(r3);
            break;
          }
          case "html": {
            t3 += this.renderer.html(r3);
            break;
          }
          case "def": {
            t3 += this.renderer.def(r3);
            break;
          }
          case "paragraph": {
            t3 += this.renderer.paragraph(r3);
            break;
          }
          case "text": {
            t3 += this.renderer.text(r3);
            break;
          }
          default: {
            let o3 = 'Token with "' + r3.type + '" type was not found.';
            if (this.options.silent) return console.error(o3), "";
            throw new Error(o3);
          }
        }
      }
      return t3;
    }
    parseInline(e3, t3 = this.renderer) {
      this.renderer.parser = this;
      let n2 = "";
      for (let i3 = 0; i3 < e3.length; i3++) {
        let r3 = e3[i3];
        if (this.options.extensions?.renderers?.[r3.type]) {
          let s3 = this.options.extensions.renderers[r3.type].call({ parser: this }, r3);
          if (s3 !== false || !["escape", "html", "link", "image", "checkbox", "strong", "em", "codespan", "br", "del", "text"].includes(r3.type)) {
            n2 += s3 || "";
            continue;
          }
        }
        let o3 = r3;
        switch (o3.type) {
          case "escape": {
            n2 += t3.text(o3);
            break;
          }
          case "html": {
            n2 += t3.html(o3);
            break;
          }
          case "link": {
            n2 += t3.link(o3);
            break;
          }
          case "image": {
            n2 += t3.image(o3);
            break;
          }
          case "checkbox": {
            n2 += t3.checkbox(o3);
            break;
          }
          case "strong": {
            n2 += t3.strong(o3);
            break;
          }
          case "em": {
            n2 += t3.em(o3);
            break;
          }
          case "codespan": {
            n2 += t3.codespan(o3);
            break;
          }
          case "br": {
            n2 += t3.br(o3);
            break;
          }
          case "del": {
            n2 += t3.del(o3);
            break;
          }
          case "text": {
            n2 += t3.text(o3);
            break;
          }
          default: {
            let s3 = 'Token with "' + o3.type + '" type was not found.';
            if (this.options.silent) return console.error(s3), "";
            throw new Error(s3);
          }
        }
      }
      return n2;
    }
  };
  var L2 = class {
    options;
    block;
    constructor(e3) {
      this.options = e3 || y3;
    }
    static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
    static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
    preprocess(e3) {
      return e3;
    }
    postprocess(e3) {
      return e3;
    }
    processAllTokens(e3) {
      return e3;
    }
    emStrongMask(e3) {
      return e3;
    }
    provideLexer(e3 = this.block) {
      return e3 ? T3.lex : T3.lexInline;
    }
    provideParser(e3 = this.block) {
      return e3 ? O2.parse : O2.parseInline;
    }
  };
  function C3(a5, e3) {
    if (Array.isArray(e3)) for (let t3 = 0; t3 < e3.length; t3++) a5.push(e3[t3]);
    else a5.push(e3);
  }
  var U = class {
    defaults = B3();
    options = this.setOptions;
    parse = this.parseMarkdown(true);
    parseInline = this.parseMarkdown(false);
    Parser = O2;
    Renderer = $2;
    TextRenderer = z3;
    Lexer = T3;
    Tokenizer = _3;
    Hooks = L2;
    constructor(...e3) {
      this.use(...e3);
    }
    walkTokens(e3, t3) {
      let n2 = [];
      for (let i3 of e3) switch (C3(n2, t3.call(this, i3)), i3.type) {
        case "table": {
          let r3 = i3;
          for (let o3 of r3.header) C3(n2, this.walkTokens(o3.tokens, t3));
          for (let o3 of r3.rows) for (let s3 of o3) C3(n2, this.walkTokens(s3.tokens, t3));
          break;
        }
        case "list": {
          let r3 = i3;
          C3(n2, this.walkTokens(r3.items, t3));
          break;
        }
        default: {
          let r3 = i3;
          this.defaults.extensions?.childTokens?.[r3.type] ? this.defaults.extensions.childTokens[r3.type].forEach((o3) => {
            let s3 = r3[o3].flat(1 / 0);
            C3(n2, this.walkTokens(s3, t3));
          }) : r3.tokens && C3(n2, this.walkTokens(r3.tokens, t3));
        }
      }
      return n2;
    }
    use(...e3) {
      let t3 = this.defaults.extensions || { renderers: {}, childTokens: {} };
      return e3.forEach((n2) => {
        let i3 = { ...n2 };
        if (i3.async = this.defaults.async || i3.async || false, n2.extensions && (n2.extensions.forEach((r3) => {
          if (!r3.name) throw new Error("extension name required");
          if ("renderer" in r3) {
            let o3 = t3.renderers[r3.name];
            o3 ? t3.renderers[r3.name] = function(...s3) {
              let l3 = r3.renderer.apply(this, s3);
              return l3 === false && (l3 = o3.apply(this, s3)), l3;
            } : t3.renderers[r3.name] = r3.renderer;
          }
          if ("tokenizer" in r3) {
            if (!r3.level || r3.level !== "block" && r3.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
            let o3 = t3[r3.level];
            o3 ? o3.unshift(r3.tokenizer) : t3[r3.level] = [r3.tokenizer], r3.start && (r3.level === "block" ? t3.startBlock ? t3.startBlock.push(r3.start) : t3.startBlock = [r3.start] : r3.level === "inline" && (t3.startInline ? t3.startInline.push(r3.start) : t3.startInline = [r3.start]));
          }
          "childTokens" in r3 && r3.childTokens && (t3.childTokens[r3.name] = r3.childTokens);
        }), i3.extensions = t3), n2.renderer) {
          let r3 = this.defaults.renderer || new $2(this.defaults);
          for (let o3 in n2.renderer) {
            if (!(o3 in r3)) throw new Error(`renderer '${o3}' does not exist`);
            if (["options", "parser"].includes(o3)) continue;
            let s3 = o3, l3 = n2.renderer[s3], u4 = r3[s3];
            r3[s3] = (...c3) => {
              let p3 = l3.apply(r3, c3);
              return p3 === false && (p3 = u4.apply(r3, c3)), p3 || "";
            };
          }
          i3.renderer = r3;
        }
        if (n2.tokenizer) {
          let r3 = this.defaults.tokenizer || new _3(this.defaults);
          for (let o3 in n2.tokenizer) {
            if (!(o3 in r3)) throw new Error(`tokenizer '${o3}' does not exist`);
            if (["options", "rules", "lexer"].includes(o3)) continue;
            let s3 = o3, l3 = n2.tokenizer[s3], u4 = r3[s3];
            r3[s3] = (...c3) => {
              let p3 = l3.apply(r3, c3);
              return p3 === false && (p3 = u4.apply(r3, c3)), p3;
            };
          }
          i3.tokenizer = r3;
        }
        if (n2.hooks) {
          let r3 = this.defaults.hooks || new L2();
          for (let o3 in n2.hooks) {
            if (!(o3 in r3)) throw new Error(`hook '${o3}' does not exist`);
            if (["options", "block"].includes(o3)) continue;
            let s3 = o3, l3 = n2.hooks[s3], u4 = r3[s3];
            L2.passThroughHooks.has(o3) ? r3[s3] = (c3) => {
              if (this.defaults.async && L2.passThroughHooksRespectAsync.has(o3)) return (async () => {
                let d3 = await l3.call(r3, c3);
                return u4.call(r3, d3);
              })();
              let p3 = l3.call(r3, c3);
              return u4.call(r3, p3);
            } : r3[s3] = (...c3) => {
              if (this.defaults.async) return (async () => {
                let d3 = await l3.apply(r3, c3);
                return d3 === false && (d3 = await u4.apply(r3, c3)), d3;
              })();
              let p3 = l3.apply(r3, c3);
              return p3 === false && (p3 = u4.apply(r3, c3)), p3;
            };
          }
          i3.hooks = r3;
        }
        if (n2.walkTokens) {
          let r3 = this.defaults.walkTokens, o3 = n2.walkTokens;
          i3.walkTokens = function(s3) {
            let l3 = [];
            return l3.push(o3.call(this, s3)), r3 && C3(l3, r3.call(this, s3)), l3;
          };
        }
        this.defaults = { ...this.defaults, ...i3 };
      }), this;
    }
    setOptions(e3) {
      return this.defaults = { ...this.defaults, ...e3 }, this;
    }
    lexer(e3, t3) {
      return T3.lex(e3, t3 ?? this.defaults);
    }
    parser(e3, t3) {
      return O2.parse(e3, t3 ?? this.defaults);
    }
    parseMarkdown(e3) {
      return (n2, i3) => {
        let r3 = { ...i3 }, o3 = { ...this.defaults, ...r3 }, s3 = this.onError(!!o3.silent, !!o3.async);
        if (this.defaults.async === true && r3.async === false) return s3(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
        if (typeof n2 > "u" || n2 === null) return s3(new Error("marked(): input parameter is undefined or null"));
        if (typeof n2 != "string") return s3(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n2) + ", string expected"));
        if (o3.hooks && (o3.hooks.options = o3, o3.hooks.block = e3), o3.async) return (async () => {
          let l3 = o3.hooks ? await o3.hooks.preprocess(n2) : n2, c3 = await (o3.hooks ? await o3.hooks.provideLexer(e3) : e3 ? T3.lex : T3.lexInline)(l3, o3), p3 = o3.hooks ? await o3.hooks.processAllTokens(c3) : c3;
          o3.walkTokens && await Promise.all(this.walkTokens(p3, o3.walkTokens));
          let g3 = await (o3.hooks ? await o3.hooks.provideParser(e3) : e3 ? O2.parse : O2.parseInline)(p3, o3);
          return o3.hooks ? await o3.hooks.postprocess(g3) : g3;
        })().catch(s3);
        try {
          o3.hooks && (n2 = o3.hooks.preprocess(n2));
          let u4 = (o3.hooks ? o3.hooks.provideLexer(e3) : e3 ? T3.lex : T3.lexInline)(n2, o3);
          o3.hooks && (u4 = o3.hooks.processAllTokens(u4)), o3.walkTokens && this.walkTokens(u4, o3.walkTokens);
          let p3 = (o3.hooks ? o3.hooks.provideParser(e3) : e3 ? O2.parse : O2.parseInline)(u4, o3);
          return o3.hooks && (p3 = o3.hooks.postprocess(p3)), p3;
        } catch (l3) {
          return s3(l3);
        }
      };
    }
    onError(e3, t3) {
      return (n2) => {
        if (n2.message += `
Please report this to https://github.com/markedjs/marked.`, e3) {
          let i3 = "<p>An error occurred:</p><pre>" + w3(n2.message + "", true) + "</pre>";
          return t3 ? Promise.resolve(i3) : i3;
        }
        if (t3) return Promise.reject(n2);
        throw n2;
      };
    }
  };
  var I2 = new U();
  function f4(a5, e3) {
    return I2.parse(a5, e3);
  }
  f4.options = f4.setOptions = function(a5) {
    return I2.setOptions(a5), f4.defaults = I2.defaults, V2(f4.defaults), f4;
  };
  f4.getDefaults = B3;
  f4.defaults = y3;
  function At(...a5) {
    return I2.use(...a5), f4.defaults = I2.defaults, V2(f4.defaults), f4;
  }
  f4.use = At;
  f4.walkTokens = function(a5, e3) {
    return I2.walkTokens(a5, e3);
  };
  f4.parseInline = I2.parseInline;
  f4.Parser = O2;
  f4.parser = O2.parse;
  f4.Renderer = $2;
  f4.TextRenderer = z3;
  f4.Lexer = T3;
  f4.lexer = T3.lex;
  f4.Tokenizer = _3;
  f4.Hooks = L2;
  f4.parse = f4;
  var Rn = f4.options;
  var Tn = f4.setOptions;
  var On = f4.walkTokens;
  var wn = f4.parseInline;
  var yn = O2.parse;
  var Sn = T3.lex;

  // src/panel/ui/Markdown.tsx
  var escapeAttr = (text2) => text2.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  var marked = new U({
    gfm: true,
    breaks: true,
    renderer: {
      image({ href, text: text2 }) {
        return `<a href="${escapeAttr(href)}">${escapeAttr(text2 || "image")}</a>`;
      },
      // Task list boxes as drawn marks: form controls are not allowed through, and these are not meant to be clicked.
      checkbox({ checked }) {
        return `<span data-check="${checked ? "done" : "open"}" role="img" aria-label="${checked ? "Done" : "Not done yet"}"></span> `;
      }
    }
  });
  var removedHrefs = /* @__PURE__ */ new WeakMap();
  purify_default.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName === "href" && node.nodeName === "A") removedHrefs.set(node, data.attrValue);
  });
  purify_default.addHook("afterSanitizeAttributes", (node) => {
    const href = removedHrefs.get(node);
    if (href !== void 0 && !node.hasAttribute("href")) node.setAttribute("data-href", href);
  });
  var PURIFY = {
    FORBID_TAGS: ["style", "img", "picture", "source", "video", "audio", "form", "input", "button", "textarea", "select", "svg", "math"],
    FORBID_ATTR: ["style", "class", "id"]
  };
  function toSafeHtml(text2, inline = false) {
    const html2 = inline ? marked.parseInline(text2, { async: false }) : marked.parse(text2, { async: false });
    return purify_default.sanitize(html2, PURIFY);
  }
  function Markdown({ text: text2, inline = false, class: className }) {
    const store = useStoreApi();
    const html2 = T2(() => toSafeHtml(text2, inline), [text2, inline]);
    const onClick = (e3) => {
      const link = e3.target instanceof Element ? e3.target.closest("a[href], a[data-href]") : null;
      if (!link) return;
      e3.preventDefault();
      store.openUrl(link.getAttribute("href") ?? link.getAttribute("data-href") ?? "");
    };
    const Tag = inline ? "span" : "div";
    return /* @__PURE__ */ u3(Tag, { class: `bd-md${className ? ` ${className}` : ""}`, onClick, dangerouslySetInnerHTML: { __html: html2 } });
  }

  // src/panel/ui/Comments.tsx
  function Comments({ comments, panel: panel2, now, composer }) {
    return /* @__PURE__ */ u3("div", { class: "bd-cms", children: [
      comments.length === 0 && /* @__PURE__ */ u3("p", { class: "bd-none", children: "No comments yet." }),
      comments.map((c3) => {
        const name = personName(c3.author, panel2);
        const mine = name === "you (panel)";
        return /* @__PURE__ */ u3("article", { class: "bd-cm", "aria-label": `Comment by ${name}`, children: [
          /* @__PURE__ */ u3("span", { class: "bd-av", "data-me": mine || void 0, "data-none": c3.author ? void 0 : true, "aria-hidden": "true", children: c3.author ? initials(c3.author) || "?" : "?" }),
          /* @__PURE__ */ u3("div", { class: "bd-cm-main", children: [
            /* @__PURE__ */ u3("div", { class: "bd-cm-who", children: [
              /* @__PURE__ */ u3("b", { children: name }),
              /* @__PURE__ */ u3("time", { dateTime: c3.createdAt, title: c3.createdAt, children: when(c3.createdAt, now) })
            ] }),
            /* @__PURE__ */ u3(Markdown, { class: "bd-cm-txt", text: c3.text })
          ] })
        ] }, c3.id);
      }),
      composer
    ] });
  }

  // src/panel/history.ts
  var RESTORABLE_FIELDS = ["title", "status", "priority", "assignee", "labels", "description", "design", "acceptance", "notes"];
  var isRestorable = (field) => RESTORABLE_FIELDS.includes(field);
  var isStrings2 = (value) => Array.isArray(value) && value.every((v5) => typeof v5 === "string");
  function typed(field, value) {
    switch (field) {
      case "priority":
        return typeof value === "number" ? value : void 0;
      case "assignee":
        return value === null || typeof value === "string" ? value : void 0;
      case "labels":
        return isStrings2(value) ? value : void 0;
      default:
        return typeof value === "string" ? value : void 0;
    }
  }
  function restoreRequest(bead, change) {
    if (change.truncated || !isRestorable(change.field)) return null;
    const from = typed(change.field, change.from);
    const to = typed(change.field, change.to);
    if (from === void 0 || to === void 0) return null;
    return { id: bead.id, expectedUpdatedAt: bead.updatedAt, patch: { [change.field]: from }, expected: { [change.field]: to } };
  }
  var same = (field, a5, b2) => {
    if (field === "labels") return Array.isArray(a5) && isStrings2(b2) && [...a5].sort().join("\n") === [...b2].sort().join("\n") && a5.length === b2.length;
    return a5 === b2;
  };
  function restoreState(bead, change) {
    if (restoreRequest(bead, change) === null) return "never";
    const field = change.field;
    const current = bead[field];
    if (same(field, current, change.from)) return "unchanged";
    return same(field, current, change.to) ? "ready" : "changed";
  }
  function freshChange(current, change) {
    const value = current[change.field];
    return value === void 0 ? change : { ...change, to: value };
  }
  var DIFF_CELLS = 4e4;
  function lineDiff(from, to, context = 1) {
    const a5 = from === "" ? [] : from.split("\n");
    const b2 = to === "" ? [] : to.split("\n");
    let head = 0;
    while (head < a5.length && head < b2.length && a5[head] === b2[head]) head++;
    let tail = 0;
    while (tail < a5.length - head && tail < b2.length - head && a5[a5.length - 1 - tail] === b2[b2.length - 1 - tail]) tail++;
    const midA = a5.slice(head, a5.length - tail);
    const midB = b2.slice(head, b2.length - tail);
    const rows = a5.slice(0, head).map((text2) => ({ kind: "same", text: text2 }));
    if (midA.length * midB.length > DIFF_CELLS) {
      rows.push(...midA.map((text2) => ({ kind: "del", text: text2 })), ...midB.map((text2) => ({ kind: "add", text: text2 })));
    } else {
      const n2 = midA.length;
      const m3 = midB.length;
      const lcs = Array.from({ length: n2 + 1 }, () => new Array(m3 + 1).fill(0));
      for (let i4 = n2 - 1; i4 >= 0; i4--) for (let j5 = m3 - 1; j5 >= 0; j5--) lcs[i4][j5] = midA[i4] === midB[j5] ? lcs[i4 + 1][j5 + 1] + 1 : Math.max(lcs[i4 + 1][j5], lcs[i4][j5 + 1]);
      let i3 = 0;
      let j4 = 0;
      while (i3 < n2 || j4 < m3) {
        if (i3 < n2 && j4 < m3 && midA[i3] === midB[j4]) {
          rows.push({ kind: "same", text: midA[i3] });
          i3++;
          j4++;
        } else if (i3 < n2 && (j4 >= m3 || lcs[i3 + 1][j4] >= lcs[i3][j4 + 1])) rows.push({ kind: "del", text: midA[i3++] });
        else rows.push({ kind: "add", text: midB[j4++] });
      }
    }
    rows.push(...a5.slice(a5.length - tail).map((text2) => ({ kind: "same", text: text2 })));
    const out = [];
    let k3 = 0;
    while (k3 < rows.length) {
      if (rows[k3].kind !== "same") {
        out.push(rows[k3++]);
        continue;
      }
      let end = k3;
      while (end < rows.length && rows[end].kind === "same") end++;
      const keepBefore = k3 === 0 ? 0 : context;
      const keepAfter = end === rows.length ? 0 : context;
      if (end - k3 <= keepBefore + keepAfter + 1) out.push(...rows.slice(k3, end));
      else out.push(...rows.slice(k3, k3 + keepBefore), { kind: "skip", count: end - k3 - keepBefore - keepAfter }, ...rows.slice(end - keepAfter, end));
      k3 = end;
    }
    return out;
  }
  var DAY_MS3 = 864e5;
  var startOfDay = (d3) => new Date(d3.getFullYear(), d3.getMonth(), d3.getDate()).getTime();
  function groupByDay(entries2, now) {
    const groups = [];
    const today = startOfDay(new Date(now));
    for (const entry of entries2) {
      const at2 = new Date(entry.at);
      const valid = Number.isFinite(at2.getTime());
      const last = groups[groups.length - 1];
      if (!valid && last) {
        last.entries.push(entry);
        continue;
      }
      const day = valid ? startOfDay(at2) : NaN;
      const key = valid ? `${at2.getFullYear()}-${at2.getMonth() + 1}-${at2.getDate()}` : "unknown";
      if (last && last.key === key) {
        last.entries.push(entry);
        continue;
      }
      const label = !valid ? "Earlier" : day === today ? "Today" : day === today - DAY_MS3 ? "Yesterday" : dayText(at2, now);
      groups.push({ key, label, entries: [entry] });
    }
    return groups;
  }

  // src/panel/ui/History.tsx
  var FIELD_NAMES = {
    title: "Title",
    status: "Status",
    priority: "Priority",
    type: "Type",
    assignee: "Assignee",
    labels: "Labels",
    description: "Description",
    design: "Design",
    acceptance: "Acceptance",
    notes: "Notes",
    closeReason: "Close reason"
  };
  var fieldName = (field) => FIELD_NAMES[field] ?? humanize(field);
  var fieldWord = (field) => field === "acceptance" ? "acceptance criteria" : fieldName(field).toLowerCase();
  var EXCERPT = 80;
  var firstLine = (text2) => {
    const line = text2.trim().split("\n")[0].trim();
    return line.length > EXCERPT ? `${line.slice(0, EXCERPT).trimEnd()}\u2026` : line;
  };
  function valueWords(field, value, statuses) {
    if (value === void 0) return "not recorded";
    switch (field) {
      case "status":
        return typeof value === "string" && value ? statusLabel(value, statuses) : "none";
      case "priority":
        return typeof value === "number" ? `P${value}` : "none";
      case "assignee":
        return typeof value === "string" && value ? value : "nobody";
      case "labels":
        return Array.isArray(value) ? value.length ? value.join(", ") : "no labels" : "not recorded";
      case "type":
        return typeof value === "string" && value ? humanize(value) : "none";
    }
    if (typeof value === "string") return value.trim() ? firstLine(value) : "empty";
    return value === null ? "none" : JSON.stringify(value);
  }
  var valueNow = (bead, field) => Object.hasOwn(bead, field) ? bead[field] : void 0;
  var UNKNOWN_WHO = "someone else or another computer";
  var UNKNOWN_WHY = "Beads keeps who made a change only on the computer where it was made.";
  var restoreDomId = (scope, key) => `bd-rs-${scope}-${key.replace(/[^\w-]/g, "_")}`;
  function useRestore(scope, options = {}) {
    const store = useStoreApi();
    const inflight = A2(/* @__PURE__ */ new Set());
    const [busy, setBusy] = d2(/* @__PURE__ */ new Set());
    const [outcomes, setOutcomes] = d2({});
    const live = A2(true);
    const refocus = A2(null);
    const toChoice = A2(false);
    h2(() => () => void (live.current = false), []);
    _2(() => {
      const key = refocus.current;
      if (key === null) return;
      refocus.current = null;
      const force = toChoice.current;
      toChoice.current = false;
      const active2 = document.activeElement;
      if (!force && active2 && active2 !== document.body) return;
      const box = document.getElementById(restoreDomId(scope, key));
      if (box?.hasAttribute("data-refused")) box.focus({ preventScroll: true });
      else (box?.querySelector("button:not(:disabled)") ?? box)?.focus({ preventScroll: true });
    });
    const settle = (key, outcome) => {
      setOutcomes((all) => {
        const next = { ...all };
        if (outcome) next[key] = outcome;
        else delete next[key];
        return next;
      });
    };
    return {
      busy: (key) => busy.has(key),
      outcome: (key) => outcomes[key] ?? null,
      restore: (key, on, change) => {
        const request = restoreRequest(on, change);
        if (!request || inflight.current.has(key)) return;
        inflight.current.add(key);
        setBusy(new Set(inflight.current));
        settle(key, null);
        void store.update(request.id, request.expectedUpdatedAt, request.patch, request.expected).then((outcome) => {
          inflight.current.delete(key);
          if (!live.current) return;
          setBusy(new Set(inflight.current));
          if (outcome.kind === "dropped") return;
          settle(key, outcome.kind === "ok" ? { kind: "done" } : outcome.kind === "conflict" ? { kind: "refused", current: outcome.current } : { kind: "note", feedback: feedbackOf(outcome) });
          refocus.current = key;
          toChoice.current = options.focusChoice === true && outcome.kind === "conflict";
        });
      },
      hold: (key, current) => {
        settle(key, { kind: "refused", current });
        refocus.current = key;
        toChoice.current = options.focusChoice === true;
      },
      dismiss: (key) => {
        settle(key, null);
        refocus.current = key;
      }
    };
  }
  function RestoreControl({ kit, scope, rkey, bead, change, statuses, paused, reword, grouped = false, onKeep }) {
    const outcome = kit.outcome(rkey);
    const busy = kit.busy(rkey);
    const id = restoreDomId(scope, rkey);
    const word = fieldWord(change.field);
    const off = paused !== null || busy;
    const button2 = (label, run, primary2 = false) => /* @__PURE__ */ u3("button", { type: "button", class: primary2 ? "bd-btn bd-btn-sm bd-btn-primary" : "bd-btn bd-btn-sm", disabled: off, "aria-busy": busy || void 0, title: paused ?? void 0, onClick: run, children: label });
    if (outcome?.kind === "done") {
      return /* @__PURE__ */ u3("div", { id, class: "bd-rs", tabIndex: -1, children: /* @__PURE__ */ u3("p", { class: "bd-rs-msg", "data-tone": "done", role: "status", children: `Restored the earlier ${word}.` }) });
    }
    if (outcome?.kind === "refused") {
      const current = outcome.current;
      const state2 = restoreState(current, change);
      const held = valueNow(current, change.field);
      const now = valueWords(change.field, held, statuses);
      const text2 = change.text && typeof held === "string" && typeof change.from === "string";
      const preview = text2 && /* @__PURE__ */ u3("div", { class: "bd-rs-diff", children: [
        /* @__PURE__ */ u3("p", { class: "bd-rs-msg", children: "Restoring would change it like this:" }),
        /* @__PURE__ */ u3(TextDiff, { from: held, to: change.from })
      ] });
      const again = freshChange(current, change);
      const sendable = restoreRequest(current, state2 === "ready" ? change : again) !== null;
      const acts = (run) => sendable ? /* @__PURE__ */ u3("div", { class: "bd-rs-acts", children: [
        button2("Restore anyway", run, true),
        button2("Keep current", () => onKeep ? onKeep() : kit.dismiss(rkey))
      ] }) : /* @__PURE__ */ u3("p", { class: "bd-rs-msg", children: `The ${word} it holds now cannot be put back from here.` });
      return /* @__PURE__ */ u3("div", { id, class: "bd-rs", "data-refused": true, tabIndex: -1, ...grouped ? {} : { role: "group", "aria-label": `Restore ${word}` }, children: state2 === "unchanged" ? /* @__PURE__ */ u3("p", { class: "bd-rs-msg", role: "status", children: `The ${word} is already the earlier value.` }) : state2 === "ready" ? /* @__PURE__ */ u3(S, { children: [
        /* @__PURE__ */ u3("p", { class: "bd-rs-msg", role: "alert", children: text2 ? `This bead changed since it was shown. The ${word} has not. Nothing was changed.` : `This bead changed since it was shown. The ${word} is still ${now}. Nothing was changed.` }),
        preview,
        acts(() => kit.restore(rkey, current, change))
      ] }) : /* @__PURE__ */ u3(S, { children: [
        /* @__PURE__ */ u3("p", { class: "bd-rs-msg", role: "alert", children: [
          /* @__PURE__ */ u3("b", { children: `The ${word} was changed again since.` }),
          " ",
          !text2 && /* @__PURE__ */ u3("span", { children: `Now: ${now}.` }),
          " ",
          /* @__PURE__ */ u3("span", { children: "Nothing was changed." })
        ] }),
        preview,
        acts(() => kit.restore(rkey, current, again))
      ] }) });
    }
    const state = restoreState(bead, change);
    if (state === "never") {
      return change.truncated ? /* @__PURE__ */ u3("span", { id, class: "bd-rs-tag", title: "Only the start of this text is shown here, so it cannot be put back from here.", children: "Too long to restore here" }) : null;
    }
    if (state === "unchanged") {
      return /* @__PURE__ */ u3("span", { id, class: "bd-rs-tag", children: "Already the earlier value" });
    }
    return /* @__PURE__ */ u3("div", { id, class: "bd-rs", "data-state": state, children: [
      /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: "bd-rs-btn",
          "aria-label": `Restore previous ${word}`,
          title: paused ?? (state === "changed" ? `The ${word} was changed again since. You choose before anything is written.` : `Put the earlier ${word} back`),
          disabled: off,
          "aria-busy": busy || void 0,
          onClick: () => state === "changed" ? kit.hold(rkey, bead) : kit.restore(rkey, bead, change),
          children: [
            /* @__PURE__ */ u3(IconRestore, { size: 12 }),
            /* @__PURE__ */ u3("span", { children: busy ? "Restoring\u2026" : "Restore" })
          ]
        }
      ),
      outcome?.kind === "note" && /* @__PURE__ */ u3(WriteMessage, { feedback: outcome.feedback, reword })
    ] });
  }
  var MAX_DIFF_ROWS = 14;
  function TextDiff({ from, to }) {
    const rows = T2(() => lineDiff(from, to), [from, to]);
    const [all, setAll] = d2(false);
    const shown = all ? rows : rows.slice(0, MAX_DIFF_ROWS);
    const hidden = rows.length - shown.length;
    const line = (row2, i3) => row2.kind === "skip" ? /* @__PURE__ */ u3("li", { class: "bd-diff-skip", children: row2.count === 1 ? "1 unchanged line" : `${row2.count} unchanged lines` }, i3) : /* @__PURE__ */ u3("li", { class: "bd-diff-line", "data-kind": row2.kind, children: [
      /* @__PURE__ */ u3("span", { class: "bd-vh", children: row2.kind === "add" ? "Added: " : row2.kind === "del" ? "Removed: " : "" }),
      /* @__PURE__ */ u3("span", { "aria-hidden": "true", class: "bd-diff-mark", children: row2.kind === "add" ? "+" : row2.kind === "del" ? "\u2212" : " " }),
      /* @__PURE__ */ u3("span", { class: "bd-diff-t", children: row2.text || " " })
    ] }, i3);
    return /* @__PURE__ */ u3("div", { class: "bd-diff", children: [
      /* @__PURE__ */ u3("ul", { role: "list", class: "bd-diff-rows", children: shown.map(line) }),
      hidden > 0 && /* @__PURE__ */ u3("button", { type: "button", class: "bd-link bd-diff-more", onClick: () => setAll(true), children: `Show ${hidden} more ${hidden === 1 ? "line" : "lines"}` })
    ] });
  }
  function Values({ change, statuses }) {
    const { field, from, to } = change;
    if (field === "status" && typeof from === "string" && typeof to === "string") {
      const look = looker(statuses);
      return /* @__PURE__ */ u3("span", { class: "bd-hv", children: [
        /* @__PURE__ */ u3("span", { class: "bd-hv-old", "data-look": look(from), children: statusLabel(from, statuses) }),
        /* @__PURE__ */ u3("span", { class: "bd-hv-to", children: [
          /* @__PURE__ */ u3("span", { class: "bd-hv-arrow", "aria-hidden": "true", children: "\u2192" }),
          /* @__PURE__ */ u3("span", { class: "bd-vh", children: "to" }),
          /* @__PURE__ */ u3("span", { class: "bd-hv-new", "data-look": look(to), children: statusLabel(to, statuses) })
        ] })
      ] });
    }
    if (field === "labels" && Array.isArray(from) && Array.isArray(to)) {
      const added = to.filter((l3) => !from.includes(l3));
      const removed = from.filter((l3) => !to.includes(l3));
      return /* @__PURE__ */ u3("span", { class: "bd-hv bd-hv-labels", children: [
        added.map((l3) => /* @__PURE__ */ u3("span", { class: "bd-lb", "data-diff": "add", children: [
          /* @__PURE__ */ u3("span", { class: "bd-vh", children: "Added " }),
          String(l3)
        ] }, `+${l3}`)),
        removed.map((l3) => /* @__PURE__ */ u3("span", { class: "bd-lb", "data-diff": "del", children: [
          /* @__PURE__ */ u3("span", { class: "bd-vh", children: "Removed " }),
          String(l3)
        ] }, `-${l3}`))
      ] });
    }
    const stacked = field === "title" || field === "closeReason" || typeof from === "string" && from.length > 24 || typeof to === "string" && to.length > 24;
    return /* @__PURE__ */ u3("span", { class: "bd-hv", "data-stacked": stacked || void 0, children: [
      /* @__PURE__ */ u3("span", { class: "bd-hv-old", children: [
        /* @__PURE__ */ u3("span", { class: "bd-vh", children: "From " }),
        valueWords(field, from, statuses)
      ] }),
      /* @__PURE__ */ u3("span", { class: "bd-hv-to", children: [
        !stacked && /* @__PURE__ */ u3("span", { class: "bd-hv-arrow", "aria-hidden": "true", children: "\u2192" }),
        /* @__PURE__ */ u3("span", { class: "bd-hv-new", children: [
          /* @__PURE__ */ u3("span", { class: "bd-vh", children: "to " }),
          valueWords(field, to, statuses)
        ] })
      ] })
    ] });
  }
  function ChangeRow({ entry, change, bead, kit, statuses, paused, reword }) {
    const key = `${entry.id}:${change.field}`;
    const restorable = entry.restorable.includes(change.field);
    const control = restorable || change.truncated ? /* @__PURE__ */ u3(RestoreControl, { kit, scope: "h", rkey: key, bead, change, statuses, paused, reword }) : null;
    const text2 = change.text && typeof change.from === "string" && typeof change.to === "string";
    return /* @__PURE__ */ u3("li", { class: "bd-hc", "data-field": change.field, "data-text": text2 || void 0, children: [
      /* @__PURE__ */ u3("span", { class: "bd-hc-f", children: fieldName(change.field) }),
      text2 ? /* @__PURE__ */ u3("span", { class: "bd-hc-what", children: change.to === "" ? "Cleared" : change.from === "" ? "Added" : "Edited" }) : /* @__PURE__ */ u3(Values, { change, statuses }),
      control && /* @__PURE__ */ u3("span", { class: "bd-hc-act", children: control }),
      text2 && /* @__PURE__ */ u3("div", { class: "bd-hc-diff", children: [
        /* @__PURE__ */ u3(TextDiff, { from: change.from, to: change.to }),
        change.truncated && /* @__PURE__ */ u3("p", { class: "bd-hc-cut", children: "Only the start of this text is shown." })
      ] })
    ] });
  }
  var closes2 = (entry, statuses) => {
    const look = looker(statuses);
    return entry.changes.some((c3) => c3.field === "status" && [c3.from, c3.to].some((v5) => typeof v5 === "string" && look(v5) === "done"));
  };
  function Who2({ actor, panel: panel2 }) {
    if (actor) return /* @__PURE__ */ u3("span", { class: "bd-he-who", children: personName(actor, panel2) });
    return /* @__PURE__ */ u3("span", { class: "bd-he-who", "data-unknown": true, title: UNKNOWN_WHY, children: UNKNOWN_WHO });
  }
  function Entry({ entry, bead, kit, statuses, panel: panel2, paused, reword }) {
    const date = recordedDate(entry.at);
    const time = /* @__PURE__ */ u3("time", { class: "bd-he-time", dateTime: entry.at, title: date ? fullText(date) : void 0, children: date ? timeText(date) : entry.at });
    if (entry.gate) {
      const g3 = entry.gate;
      const { head, by } = gateEventWords({ ...g3, actor: entry.actor });
      const who = by === null && g3.what !== "deleted" && (entry.actor || g3.byPanel) ? personName(entry.actor, panel2) : null;
      const reason = g3.reason ? g3.reason.trim().split("\n")[0] : "";
      return /* @__PURE__ */ u3("li", { class: "bd-he", "data-kind": "gate", "data-what": g3.what, children: [
        /* @__PURE__ */ u3("div", { class: "bd-he-top", children: [
          time,
          who && /* @__PURE__ */ u3("span", { class: "bd-he-who", children: who })
        ] }),
        /* @__PURE__ */ u3("p", { class: "bd-he-gate", children: [
          /* @__PURE__ */ u3(IconWait, { size: 12 }),
          /* @__PURE__ */ u3("span", { children: by ? `${head} by ${by}` : head })
        ] }),
        reason && /* @__PURE__ */ u3("p", { class: "bd-he-reason", children: reason })
      ] });
    }
    if (entry.created) {
      return /* @__PURE__ */ u3("li", { class: "bd-he", "data-kind": "created", children: [
        /* @__PURE__ */ u3("div", { class: "bd-he-top", children: [
          time,
          /* @__PURE__ */ u3(Who2, { actor: entry.actor, panel: panel2 })
        ] }),
        /* @__PURE__ */ u3("p", { class: "bd-he-gate", children: /* @__PURE__ */ u3("span", { children: "Created" }) })
      ] });
    }
    const quiet = !entry.actor && closes2(entry, statuses);
    return /* @__PURE__ */ u3("li", { class: "bd-he", "data-kind": "change", children: [
      /* @__PURE__ */ u3("div", { class: "bd-he-top", children: [
        time,
        !quiet && /* @__PURE__ */ u3(Who2, { actor: entry.actor, panel: panel2 })
      ] }),
      /* @__PURE__ */ u3("ul", { role: "list", class: "bd-hcs", children: entry.changes.map((change) => /* @__PURE__ */ u3(ChangeRow, { entry, change, bead, kit, statuses, paused, reword }, change.field)) })
    ] });
  }
  function History({ bead, open, statuses, panel: panel2, paused, now, reword }) {
    const store = useStoreApi();
    const kit = useRestore("h");
    const [loaded, setLoaded] = d2(null);
    const [reading, setReading] = d2(null);
    const [error, setError] = d2(null);
    const live = A2(true);
    h2(() => () => void (live.current = false), []);
    const read = async (older) => {
      if (reading) return;
      const before = older ? loaded?.entries.at(-1)?.id : void 0;
      setReading(older ? "older" : "first");
      setError(null);
      const shownAt = bead.updatedAt;
      const outcome = await store.readHistory({ id: bead.id, ...before ? { before } : {} });
      if (!live.current) return;
      setReading(null);
      if (outcome.kind === "dropped") return;
      if (outcome.kind === "error") {
        setError({ error: outcome.error, older });
        return;
      }
      const page = outcome.value;
      setLoaded((prev) => {
        if (!older || !prev) return { entries: page.entries, more: page.more, labelsKnown: page.labelsKnown, at: shownAt };
        const seen = new Set(prev.entries.map((e3) => e3.id));
        return { ...prev, entries: [...prev.entries, ...page.entries.filter((e3) => !seen.has(e3.id))], more: page.more, labelsKnown: prev.labelsKnown && page.labelsKnown };
      });
    };
    h2(() => {
      if (open && !loaded && !reading && !error) void read(false);
    }, [open]);
    if (!loaded) {
      if (error) {
        return /* @__PURE__ */ u3("div", { class: "bd-hist-err", role: "alert", children: [
          /* @__PURE__ */ u3("span", { children: error.error.message }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => void read(false), children: "Try again" })
        ] });
      }
      return /* @__PURE__ */ u3("p", { class: "bd-hist-load", role: "status", children: [
        /* @__PURE__ */ u3("span", { class: "bd-spin", "aria-hidden": "true" }),
        "Reading history\u2026"
      ] });
    }
    const groups = groupByDay(loaded.entries, now);
    const newer = bead.updatedAt !== loaded.at;
    return /* @__PURE__ */ u3("div", { class: "bd-hist", "aria-busy": reading !== null || void 0, children: [
      newer && /* @__PURE__ */ u3("p", { class: "bd-hist-newer", role: "status", children: [
        /* @__PURE__ */ u3("span", { children: "This bead changed since its history was read." }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-link", disabled: reading !== null, onClick: () => void read(false), children: "Refresh" })
      ] }),
      loaded.entries.length === 0 && /* @__PURE__ */ u3("p", { class: "bd-hist-none", children: "No earlier versions." }),
      groups.map((group) => {
        const head = `bd-hday-${shortId(bead.id)}-${group.key}`;
        return /* @__PURE__ */ u3("div", { class: "bd-hday", children: [
          /* @__PURE__ */ u3("h4", { class: "bd-hday-h", id: head, children: group.label }),
          /* @__PURE__ */ u3("ul", { role: "list", class: "bd-hes", "aria-labelledby": head, children: group.entries.map((entry) => /* @__PURE__ */ u3(Entry, { entry, bead, kit, statuses, panel: panel2, paused, reword }, entry.id)) })
        ] }, group.key);
      }),
      !loaded.labelsKnown && /* @__PURE__ */ u3("p", { class: "bd-hist-note", children: "Label changes are not listed: Beads has no record of them on this computer." }),
      error?.older && /* @__PURE__ */ u3("div", { class: "bd-hist-err", role: "alert", children: /* @__PURE__ */ u3("span", { children: error.error.message }) }),
      loaded.more && /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-hist-older", disabled: reading !== null, "aria-busy": reading === "older" || void 0, onClick: () => void read(true), children: reading === "older" ? "Loading\u2026" : "Load older" })
    ] });
  }

  // src/panel/ui/CloseDialog.tsx
  var CLOSE_DRAFTS = ["closeReason", "closeComment"];
  var CHECKING_COMMENT = "Checking whether your comment went in.";
  var panelCount = (b2, text2, actor) => b2 ? b2.comments.filter((c3) => c3.text === text2 && (!actor || c3.author === actor)).length : 0;
  function useCloseDrafts(bead) {
    const store = useStoreApi();
    const snapshot = useStore().snapshot;
    const id = bead.id;
    const read = () => ({ reason: store.draft(id, "closeReason")?.text ?? "", comment: store.draft(id, "closeComment")?.text ?? "" });
    const [text2, setText2] = d2(read);
    const set = (field, value) => {
      setText2((t3) => ({ ...t3, [field]: value }));
      const key = field === "reason" ? "closeReason" : "closeComment";
      const was = store.draft(id, key);
      const same2 = field === "comment" && was !== null && was.text.trim() === value.trim();
      store.setDraft(id, key, value.trim() ? same2 ? { ...was, text: value } : { text: value } : null);
    };
    const drop = (which = "all") => {
      for (const field of which === "comment" ? ["closeComment"] : CLOSE_DRAFTS) store.setDraft(id, field, null);
      setText2((t3) => which === "comment" ? { ...t3, comment: "" } : { reason: "", comment: "" });
    };
    const posted = (body, also = null) => {
      const snap = store.get().snapshot;
      const actor = snap?.panelActor ?? "";
      const listed = snap?.beads.find((b2) => b2.id === id) ?? null;
      return Math.max(panelCount(bead, body, actor), panelCount(listed, body, actor), panelCount(also, body, actor));
    };
    const sent = () => {
      const d3 = store.draft(id, "closeComment");
      return d3?.base === void 0 ? null : { body: d3.text.trim(), before: Number(d3.base), at: d3.original === void 0 ? null : Number(d3.original) };
    };
    const listedComments = snapshot?.beads.find((b2) => b2.id === id)?.comments;
    h2(() => {
      const s4 = sent();
      if (s4 && posted(s4.body) > s4.before) drop("comment");
    }, [id, bead.comments, listedComments]);
    const s3 = sent();
    return {
      ...text2,
      setReason: (value) => set("reason", value),
      setComment: (value) => set("comment", value),
      /** Reads them again (another bead, or the dialog opening again). */
      load: () => setText2(read()),
      /** Lets go of `which`, or both. */
      drop,
      /** A close that may have added the comment has not been checked yet: nothing is sent until the project is read again. */
      checking: s3?.at != null && !readSince(snapshot?.freshness.localRefreshedAt ?? null, s3.at),
      /** Before a close is sent: notes how many such comments the bead has, the first time this comment goes. */
      sending: () => {
        const d3 = store.draft(id, "closeComment");
        if (!d3 || !d3.text.trim()) return;
        store.setDraft(id, "closeComment", { text: d3.text, base: d3.base ?? String(posted(d3.text.trim())) });
      },
      /** The close came back without saying whether it went in. */
      uncertain: () => {
        const d3 = store.draft(id, "closeComment");
        if (d3?.base !== void 0) store.setDraft(id, "closeComment", { ...d3, original: String(Date.now()) });
      },
      /** The comment to send with a close on `b`: none once it is on the bead. Read at send time, so a retry sees what is there now. */
      commentFor: (b2) => {
        const d3 = store.draft(id, "closeComment");
        const body = d3?.text.trim() ?? "";
        if (!body) return "";
        return d3?.base !== void 0 && posted(body, b2) > Number(d3.base) ? "" : body;
      }
    };
  }
  var closePatch = (status, reason, comment) => ({
    status,
    ...reason.trim() ? { closeReason: reason.trim() } : {},
    ...comment.trim() ? { closeComment: comment.trim() } : {}
  });
  var commentWentIn = (outcome) => outcome.kind === "error" && outcome.error.message.startsWith(COMMENT_ADDED);
  function CloseFields({ question, action, reason, comment, setReason, setComment, busy, disabled, send, cancel, variant = "pop", onEscape, autofocus, message }) {
    const id = g2();
    const [asking, setAsking] = d2(false);
    const typed2 = reason.trim() !== "" || comment.trim() !== "";
    const go = () => {
      if (!busy && disabled === null) send();
    };
    const box = A2(null);
    const keep = A2(null);
    const why = A2(null);
    h2(() => {
      if (autofocus) why.current?.focus({ preventScroll: true });
    }, []);
    _2(() => {
      const el2 = box.current;
      if (!el2) return;
      el2.style.height = "auto";
      if (el2.scrollHeight > 0) el2.style.height = `${Math.min(el2.scrollHeight + 2, 160)}px`;
    }, [comment]);
    const asked = A2(false);
    h2(() => {
      if (asking) keep.current?.focus({ preventScroll: true });
      else if (asked.current) box.current?.focus({ preventScroll: true });
      asked.current = asking;
    }, [asking]);
    return /* @__PURE__ */ u3(
      "div",
      {
        class: variant === "step" ? "bd-nstep bd-closeform" : "bd-popform bd-closeform",
        role: "group",
        "aria-label": question,
        onKeyDown: (e3) => {
          if (e3.key !== "Escape" || composing(e3)) return;
          if (asking) {
            e3.preventDefault();
            e3.stopPropagation();
            setAsking(false);
          } else if (onEscape) {
            e3.preventDefault();
            e3.stopPropagation();
            onEscape();
          }
        },
        children: [
          /* @__PURE__ */ u3("p", { class: "bd-closeq", children: question }),
          /* @__PURE__ */ u3("label", { class: "bd-flab", for: `${id}-why`, children: "Reason (optional)" }),
          /* @__PURE__ */ u3(
            "input",
            {
              ref: why,
              id: `${id}-why`,
              class: "bd-input",
              "aria-label": "Close reason (optional)",
              placeholder: "For example the commit",
              "data-autofocus": true,
              value: reason,
              readOnly: busy,
              onInput: (e3) => setReason(e3.currentTarget.value),
              onKeyDown: (e3) => {
                if (e3.key !== "Enter" || composing(e3) || e3.shiftKey || e3.altKey || e3.metaKey || e3.ctrlKey) return;
                e3.preventDefault();
                go();
              }
            }
          ),
          /* @__PURE__ */ u3("label", { class: "bd-flab", for: `${id}-note`, children: "Comment (optional)" }),
          /* @__PURE__ */ u3(
            "textarea",
            {
              ref: box,
              id: `${id}-note`,
              class: "bd-input bd-ntext bd-closenote",
              placeholder: "Added to the comments before it closes",
              rows: 2,
              value: comment,
              readOnly: busy,
              onInput: (e3) => setComment(e3.currentTarget.value),
              onKeyDown: (e3) => {
                if (!isSubmitKey(e3)) return;
                e3.preventDefault();
                go();
              }
            }
          ),
          asking ? /* @__PURE__ */ u3("div", { class: "bd-confirm", role: "alertdialog", "aria-label": "Discard what you typed?", children: [
            /* @__PURE__ */ u3("span", { children: "Discard what you typed?" }),
            /* @__PURE__ */ u3("button", { ref: keep, type: "button", class: "bd-btn bd-btn-sm", onClick: () => setAsking(false), children: "Keep editing" }),
            /* @__PURE__ */ u3(
              "button",
              {
                type: "button",
                class: "bd-btn bd-btn-sm",
                "data-tone": "danger",
                onClick: () => {
                  setAsking(false);
                  cancel();
                },
                children: "Discard"
              }
            )
          ] }) : /* @__PURE__ */ u3("div", { class: "bd-popacts", children: [
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, onClick: () => typed2 ? setAsking(true) : cancel(), children: "Cancel" }),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", "aria-disabled": busy || disabled !== null || void 0, "aria-busy": busy || void 0, title: disabled ?? void 0, onClick: go, children: busy ? "Closing\u2026" : action })
          ] }),
          message
        ]
      }
    );
  }

  // src/panel/ui/DateInput.tsx
  var BEADS_READS = "Beads will read this when you save.";
  var DATE_HINT = "For example tomorrow, next monday, +3d or 2026-10-20.";
  function DateInput({ value, onInput, onEnter, label, lead, disabled, readOnly, autoFocus, now, zone }) {
    const hintId = A2(`bd-date-${Math.random().toString(36).slice(2, 9)}`).current;
    const box = A2(null);
    h2(() => {
      if (autoFocus) box.current?.focus();
    }, []);
    const text2 = value.trim();
    const parsed = text2 === "" ? null : parseDateInput(text2, now ?? Date.now(), zone ?? localZone());
    const preview = parsed === null ? DATE_HINT : parsed.kind === "ok" ? lead ? `${lead} ${parsed.label}` : parsed.label : BEADS_READS;
    return /* @__PURE__ */ u3("div", { class: "bd-date", children: [
      /* @__PURE__ */ u3(
        "input",
        {
          type: "text",
          class: "bd-input",
          "aria-label": label,
          "aria-describedby": hintId,
          autoComplete: "off",
          spellcheck: false,
          placeholder: "tomorrow, +3d, 2026-10-20",
          value,
          disabled,
          readOnly,
          ref: box,
          onInput: (e3) => onInput(e3.currentTarget.value),
          onKeyDown: (e3) => {
            if (onEnter && isEnterInInput(e3)) {
              e3.preventDefault();
              onEnter();
            }
          }
        }
      ),
      /* @__PURE__ */ u3("p", { class: "bd-date-preview", id: hintId, "data-kind": parsed === null ? "hint" : parsed.kind, children: preview })
    ] });
  }

  // src/panel/ui/Editors.tsx
  var isMod = isSubmitKey;
  function TextEditor({ bead, field, label, disabled, onClose: closed, onDirty }) {
    const store = useStoreApi();
    const [kept] = d2(() => store.draft(bead.id, field));
    const [draft, setDraft] = d2(kept?.text ?? bead[field]);
    const [original, setOriginal] = d2(kept?.original ?? bead[field]);
    const [base, setBase] = d2(kept?.base ?? bead.updatedAt);
    const onClose = () => {
      store.setDraft(bead.id, field, null);
      closed();
    };
    const [conflict, setConflict] = d2(null);
    const [feedback, setFeedback] = d2(null);
    const [busy, setBusy] = d2(false);
    const [confirming, setConfirming] = d2(false);
    const box = A2(null);
    const root2 = A2(null);
    const title = field === "title";
    h2(() => {
      const el2 = box.current;
      if (!el2) return;
      el2.focus();
      el2.setSelectionRange(el2.value.length, el2.value.length);
    }, []);
    h2(() => {
      if (!root2.current || root2.current.contains(document.activeElement)) return;
      box.current?.focus();
    }, [confirming]);
    const [checking, setChecking] = d2(null);
    const snapshot = useStore().snapshot;
    const refreshed = snapshot?.freshness.localRefreshedAt ?? null;
    const listed = snapshot?.beads.find((b2) => b2.id === bead.id) ?? null;
    h2(() => {
      if (busy) return;
      const current = title ? bead[field].trim() : bead[field];
      if (checking !== null) {
        const inList = listed === null ? null : title ? listed[field].trim() : listed[field];
        if (current === value || inList === value) {
          setChecking(null);
          setOriginal(draft);
          setBase(inList === value && listed ? listed.updatedAt : bead.updatedAt);
          setFeedback({ kind: "checked", saved: true });
          return;
        }
        if (listed === null || !readSince(refreshed, checking)) return;
        setChecking(null);
        if (listed[field] === original) {
          setBase(listed.updatedAt);
          setFeedback({ kind: "checked", saved: false, kept: "Your draft is still here." });
        } else {
          setFeedback(null);
          setConflict(listed);
        }
        return;
      }
      if (conflict) return;
      if (listed !== null && listed[field] !== bead[field]) return;
      if (bead[field] === original) setBase(bead.updatedAt);
      else if (current === value) {
        setOriginal(draft);
        setBase(bead.updatedAt);
      } else if (draft === original) {
        setDraft(bead[field]);
        setOriginal(bead[field]);
        setBase(bead.updatedAt);
      } else setConflict(bead);
    }, [bead, listed, refreshed]);
    _2(() => {
      const el2 = box.current;
      if (!el2 || title) return;
      el2.style.height = "auto";
      if (el2.scrollHeight > 0) el2.style.height = `${el2.scrollHeight + 2}px`;
    }, [draft]);
    const value = title ? draft.trim() : draft;
    const changed2 = draft !== original;
    const maybeIn = feedback?.kind === "uncertain";
    h2(() => onDirty?.(changed2), [changed2]);
    h2(() => () => onDirty?.(false), []);
    h2(() => store.setDraft(bead.id, field, changed2 ? { text: draft, original, base } : null), [draft, original, base]);
    const save = async (expected, shown = original) => {
      if (busy || disabled || title && value === "") return;
      if (!changed2 && !conflict) return onClose();
      setBusy(true);
      setFeedback(null);
      setConfirming(false);
      const outcome = await store.update(bead.id, expected, { [field]: value }, { [field]: shown });
      setBusy(false);
      if (outcome.kind === "ok") return onClose();
      if (outcome.kind === "conflict") return setConflict(outcome.current);
      if (outcome.kind === "uncertain" && outcome.saved) return onClose();
      if (outcome.kind === "uncertain" && !outcome.current) setChecking(Date.now());
      if (outcome.kind === "uncertain" && outcome.current) {
        if (outcome.current[field] === value) return onClose();
        if (outcome.current[field] !== shown) setConflict(outcome.current);
        else setBase(outcome.current.updatedAt);
      }
      setFeedback(feedbackOf(outcome));
    };
    const reapply = () => {
      if (!conflict) return;
      const now = conflict;
      setOriginal(now[field]);
      setBase(now.updatedAt);
      setConflict(null);
      void save(now.updatedAt, now[field]);
    };
    const cancel = () => {
      if (changed2 && !confirming) setConfirming(true);
      else onClose();
    };
    const onKeyDown = (e3) => {
      if (e3.key === "Escape") {
        e3.preventDefault();
        e3.stopPropagation();
        cancel();
      } else if (confirming) {
        if (isConfirmKey(e3)) {
          e3.preventDefault();
          onClose();
        }
      } else if (isMod(e3) || title && e3.key === "Enter" && !composing(e3)) {
        e3.preventDefault();
        if (!conflict && !maybeIn) void save(base);
      }
    };
    const lines = draft.split("\n").length;
    const field_ = title ? /* @__PURE__ */ u3("input", { ref: box, class: "bd-input bd-titlein", "aria-label": label, value: draft, readOnly: busy, onInput: (e3) => setDraft(e3.currentTarget.value), onKeyDown }) : /* @__PURE__ */ u3(
      "textarea",
      {
        ref: box,
        class: "bd-ta",
        "aria-label": label,
        rows: Math.min(16, Math.max(4, lines + 1)),
        value: draft,
        readOnly: busy,
        spellcheck: true,
        onInput: (e3) => setDraft(e3.currentTarget.value),
        onKeyDown
      }
    );
    return /* @__PURE__ */ u3(
      "div",
      {
        ref: root2,
        class: "bd-editor",
        "data-field": field,
        "data-busy": busy || void 0,
        onKeyDown: (e3) => {
          if (e3.key !== "Escape" || e3.defaultPrevented) return;
          e3.preventDefault();
          e3.stopPropagation();
          if (confirming) {
            setConfirming(false);
            box.current?.focus();
          } else cancel();
        },
        children: [
          conflict && /* @__PURE__ */ u3("div", { class: "bd-wnote bd-wnote-edit", role: "alert", children: [
            /* @__PURE__ */ u3("b", { children: "Changed while you were editing" }),
            conflict[field] === original ? /* @__PURE__ */ u3("span", { children: "Other parts of the bead changed; this one did not. Re-apply to save yours." }) : /* @__PURE__ */ u3("div", { class: "bd-theirs", children: [
              /* @__PURE__ */ u3("span", { class: "bd-theirs-lab", children: "Now" }),
              conflict[field].trim() === "" ? /* @__PURE__ */ u3("span", { class: "bd-none", children: "Empty" }) : title ? /* @__PURE__ */ u3("span", { children: conflict[field] }) : /* @__PURE__ */ u3(Markdown, { class: "bd-txt", text: conflict[field] })
            ] }),
            /* @__PURE__ */ u3("span", { class: "bd-wnote-acts", children: [
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: onClose, children: "Discard" }),
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: busy || disabled !== null, title: disabled ?? "Save your version over it", onClick: reapply, children: "Re-apply" })
            ] })
          ] }),
          conflict && !title && /* @__PURE__ */ u3("span", { class: "bd-theirs-lab bd-draft-lab", children: "Your draft" }),
          field_,
          confirming && /* @__PURE__ */ u3("div", { class: "bd-confirm", role: "alertdialog", "aria-label": "Discard your changes?", children: [
            /* @__PURE__ */ u3("span", { children: "Discard your changes?" }),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => setConfirming(false), children: "Keep editing" }),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", "data-tone": "danger", onClick: onClose, children: "Discard" })
          ] }),
          /* @__PURE__ */ u3(WriteMessage, { feedback }),
          !conflict && !confirming && /* @__PURE__ */ u3("div", { class: "bd-edacts", children: [
            !title && /* @__PURE__ */ u3("span", { class: "bd-edhint", children: `Markdown \xB7 ${saveKey()} saves` }),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: cancel, children: "Cancel" }),
            maybeIn && /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy || disabled !== null, title: disabled ?? "It may already be saved. Send it once more.", onClick: () => void save(base), children: "Save again" }),
            /* @__PURE__ */ u3(
              "button",
              {
                type: "button",
                class: "bd-btn bd-btn-sm bd-btn-primary",
                disabled: busy || maybeIn || disabled !== null || title && value === "",
                title: disabled ?? (title && value === "" ? "A bead needs a title." : void 0),
                onClick: () => void save(base),
                children: busy ? "Saving\u2026" : "Save"
              }
            )
          ] })
        ]
      }
    );
  }
  function CommentComposer({ bead, disabled, onDirty }) {
    const store = useStoreApi();
    const [text2, setText2] = d2(() => store.draft(bead.id, "comment")?.text ?? "");
    const [busy, setBusy] = d2(false);
    const [feedback, setFeedback] = d2(null);
    const maybeIn = feedback?.kind === "uncertain" && !feedback.saved;
    const empty = text2.trim() === "";
    h2(() => onDirty?.(!empty), [empty]);
    h2(() => () => onDirty?.(false), []);
    h2(() => store.setDraft(bead.id, "comment", empty ? null : { text: text2 }), [text2]);
    const snapshot = useStore().snapshot;
    const panelActor = snapshot?.panelActor ?? "";
    const refreshed = snapshot?.freshness.localRefreshedAt ?? null;
    const [pending, setPending] = d2(null);
    const listed = snapshot?.beads.find((b2) => b2.id === bead.id) ?? null;
    const count = (comments, t3) => comments.filter((c3) => c3.text === t3 && (!panelActor || c3.author === panelActor)).length;
    const mine = (t3) => Math.max(count(bead.comments, t3), listed ? count(listed.comments, t3) : 0);
    h2(() => {
      if (!pending) return;
      if (mine(pending.text) > pending.before) {
        setPending(null);
        setText2("");
        setFeedback({ kind: "checked", saved: true });
      } else if (listed && readSince(refreshed, pending.since)) {
        setPending(null);
        setFeedback({ kind: "checked", saved: false, kept: "Your comment is still here." });
      }
    }, [bead.comments, listed, refreshed, pending]);
    const post = async () => {
      if (busy || empty || disabled) return;
      const sent = text2.trim();
      const before = mine(sent);
      setBusy(true);
      setFeedback(null);
      setPending(null);
      const outcome = await store.comment(bead.id, sent);
      setBusy(false);
      if (outcome.kind === "ok" || outcome.kind === "uncertain" && outcome.saved) setText2("");
      if (outcome.kind === "uncertain" && !outcome.saved) setPending({ text: sent, before, since: Date.now() });
      setFeedback(feedbackOf(outcome));
    };
    return /* @__PURE__ */ u3("div", { class: "bd-cmp", "data-open": !empty || void 0, children: [
      /* @__PURE__ */ u3(
        "textarea",
        {
          class: "bd-cmp-ta",
          "aria-label": "Add a comment",
          placeholder: "Add a comment\u2026",
          rows: empty ? 1 : Math.min(8, Math.max(3, text2.split("\n").length + 1)),
          value: text2,
          disabled: disabled !== null,
          readOnly: busy,
          title: disabled ?? void 0,
          onInput: (e3) => {
            setText2(e3.currentTarget.value);
            if (e3.currentTarget.value.trim() === "") setFeedback(null);
          },
          onKeyDown: (e3) => {
            if (e3.key === "Escape" && !empty) {
              e3.preventDefault();
              e3.stopPropagation();
              e3.currentTarget.blur();
            } else if (isMod(e3)) {
              e3.preventDefault();
              if (!maybeIn) void post();
            }
          }
        }
      ),
      /* @__PURE__ */ u3(WriteMessage, { feedback }),
      /* @__PURE__ */ u3("div", { class: "bd-cmp-acts", children: [
        /* @__PURE__ */ u3("kbd", { class: "bd-edhint", "aria-hidden": "true", children: saveKey() }),
        maybeIn && /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: disabled !== null || busy || empty, title: disabled ?? "It may already be posted. Send it once more.", onClick: () => void post(), children: "Post again" }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: disabled !== null || busy || empty || maybeIn, title: disabled ?? void 0, onClick: () => void post(), children: busy ? "Posting\u2026" : "Post" })
      ] })
    ] });
  }
  var asksReason = (from, to, statuses) => closes(to, statuses) && (!closes(from, statuses) || to === "closed" && from !== "closed");
  var answered = /* @__PURE__ */ new WeakSet();
  function StatusMenu({ bead, writes, disabled, statuses }) {
    const store = useStoreApi();
    const pop = usePopover(disabled !== null);
    const trigger = A2(null);
    const said = (to) => store.notify(`Status set to ${statusLabel(to, statuses)}.`);
    const move = async (to) => {
      if (await writes.send(() => ({ status: to }))) said(to);
    };
    const [closing, setClosing] = d2(null);
    const drafts = useCloseDrafts(bead);
    const look = looker(statuses);
    h2(() => drafts.load(), [bead.id]);
    const done = look(bead.status) === "done";
    h2(() => {
      if (done && !closing) drafts.drop();
    }, [done, bead.id, closing]);
    const fb = writes.feedback;
    h2(() => {
      if (!fb || answered.has(fb)) return;
      answered.add(fb);
      if (fb?.kind === "uncertain" && !fb.saved) drafts.uncertain();
      else if (fb?.kind === "error" && fb.error.message.startsWith(COMMENT_ADDED)) drafts.drop("comment");
    }, [fb]);
    const names = statuses.map((s3) => s3.name);
    if (!names.includes(bead.status)) names.push(bead.status);
    const label = statusLabel(bead.status, statuses);
    const close = () => {
      pop.close();
      setClosing(null);
    };
    const choose = (name) => {
      if (name === bead.status) return close();
      if (asksReason(bead.status, name, statuses)) {
        drafts.load();
        setClosing(name);
        return;
      }
      close();
      void move(name);
    };
    const confirmClose = async () => {
      if (!closing || writes.busy || drafts.checking) return;
      const to = closing;
      const reason = drafts.reason;
      drafts.sending();
      const outcome = await writes.sendFor((b2) => closePatch(to, reason, drafts.commentFor(b2)));
      if (outcome.kind === "dropped") return;
      if (outcome.kind === "ok") {
        drafts.drop();
        said(to);
      } else if (commentWentIn(outcome)) drafts.drop("comment");
      else if (outcome.kind === "uncertain" && !outcome.saved) drafts.uncertain();
      close();
      refocusSoon(trigger.current);
    };
    return /* @__PURE__ */ u3("span", { class: "bd-popwrap", children: [
      /* @__PURE__ */ u3(
        "button",
        {
          ref: trigger,
          type: "button",
          class: "bd-statbtn",
          "aria-label": `Status: ${label}`,
          "aria-haspopup": "menu",
          "aria-expanded": pop.open,
          title: disabled ?? bead.status,
          disabled: disabled !== null || writes.busy && !pop.open,
          onClick: () => pop.open ? close() : pop.toggle(),
          children: [
            /* @__PURE__ */ u3(StatusDot, { look: look(bead.status), marker: markerOf(bead.status) }),
            label,
            /* @__PURE__ */ u3(IconChevron, {})
          ]
        }
      ),
      pop.open && !closing && /* @__PURE__ */ u3(Popover, { label: "Status", align: "end", role: "menu", onClose: close, children: names.map((name) => /* @__PURE__ */ u3("button", { type: "button", role: "menuitemradio", "aria-checked": name === bead.status, class: "bd-menu-item", title: name, onClick: () => choose(name), children: [
        /* @__PURE__ */ u3(StatusDot, { look: look(name), marker: markerOf(name) }),
        /* @__PURE__ */ u3("span", { children: statusLabel(name, statuses) })
      ] }, name)) }),
      pop.open && closing && /* @__PURE__ */ u3(Popover, { label: "Close", align: "end", onClose: close, children: /* @__PURE__ */ u3(
        CloseFields,
        {
          question: `Why is it ${statusLabel(closing, statuses).toLowerCase()}?`,
          action: `Mark ${statusLabel(closing, statuses).toLowerCase()}`,
          reason: drafts.reason,
          comment: drafts.comment,
          setReason: drafts.setReason,
          setComment: drafts.setComment,
          busy: writes.busy,
          disabled: disabled ?? (drafts.checking ? CHECKING_COMMENT : null),
          message: drafts.checking && /* @__PURE__ */ u3("p", { class: "bd-wmsg", "data-tone": "note", role: "status", children: CHECKING_COMMENT }),
          send: () => void confirmClose(),
          cancel: () => {
            drafts.drop();
            close();
            refocusSoon(trigger.current);
          }
        }
      ) })
    ] });
  }
  function PriorityMenu({ bead, writes, disabled }) {
    const pop = usePopover(disabled !== null);
    return /* @__PURE__ */ u3("span", { class: "bd-popwrap", children: [
      /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: "bd-chipbtn",
          "aria-label": `Priority: ${bead.priority === null ? "none" : `P${bead.priority}`}`,
          "aria-haspopup": "menu",
          "aria-expanded": pop.open,
          title: disabled ?? "Priority",
          disabled: disabled !== null || writes.busy,
          onClick: pop.toggle,
          children: bead.priority === null ? /* @__PURE__ */ u3("span", { class: "bd-pr", "data-p": "none-set", children: "P\u2013" }) : /* @__PURE__ */ u3(Priority, { value: bead.priority })
        }
      ),
      pop.open && /* @__PURE__ */ u3(Popover, { label: "Priority", role: "menu", onClose: pop.close, children: PRIORITY_WORDS.map((word, p3) => /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          role: "menuitemradio",
          "aria-checked": p3 === bead.priority,
          class: "bd-menu-item",
          onClick: () => {
            pop.close();
            if (p3 !== bead.priority) void writes.send(() => ({ priority: p3 }));
          },
          children: [
            /* @__PURE__ */ u3(Priority, { value: p3 }),
            /* @__PURE__ */ u3("span", { children: word })
          ]
        },
        p3
      )) })
    ] });
  }
  var FALLBACK_TYPES2 = ["task", "bug", "feature", "epic", "chore"];
  var refocusSoon = (el2) => requestAnimationFrame(() => el2?.isConnected && el2.focus({ preventScroll: true }));
  function TypeMenu({ bead, writes, disabled, types }) {
    const store = useStoreApi();
    const pop = usePopover(disabled !== null);
    const trigger = A2(null);
    const names = (types.length ? types : FALLBACK_TYPES2).filter((t3) => t3 !== "gate");
    if (bead.type && !names.includes(bead.type)) names.push(bead.type);
    const choose = async (type) => {
      pop.close();
      refocusSoon(trigger.current);
      if (type === bead.type) return;
      if (await writes.send(() => ({ type }))) store.notify(`Type set to ${humanize(type)}.`);
      refocusSoon(trigger.current);
    };
    return /* @__PURE__ */ u3("span", { class: "bd-popwrap", children: [
      /* @__PURE__ */ u3(
        "button",
        {
          ref: trigger,
          type: "button",
          class: "bd-chipbtn bd-dtype",
          "aria-label": `Type: ${humanize(bead.type || "bead")}`,
          "aria-haspopup": "menu",
          "aria-expanded": pop.open,
          title: disabled ?? "Change the type",
          disabled: disabled !== null || writes.busy,
          onClick: pop.toggle,
          children: [
            humanize(bead.type || "bead"),
            /* @__PURE__ */ u3(IconChevron, {})
          ]
        }
      ),
      pop.open && /* @__PURE__ */ u3(Popover, { label: "Type", role: "menu", onClose: pop.close, children: names.map((name) => /* @__PURE__ */ u3("button", { type: "button", role: "menuitemradio", "aria-checked": name === bead.type, class: "bd-menu-item", title: name, onClick: () => void choose(name), children: [
        /* @__PURE__ */ u3(TypeIcon, { type: name, size: 13 }),
        /* @__PURE__ */ u3("span", { children: humanize(name) })
      ] }, name)) })
    ] });
  }
  function inside(candidate, id, byId) {
    const seen = /* @__PURE__ */ new Set();
    for (let at2 = candidate.parentId; at2 !== null && !seen.has(at2); at2 = byId.get(at2)?.parentId ?? null) {
      if (at2 === id) return true;
      seen.add(at2);
    }
    return false;
  }
  function ParentMenu({ bead, writes, disabled, beads, byId, statuses }) {
    const store = useStoreApi();
    const pop = usePopover(disabled !== null);
    const trigger = A2(null);
    const parent = bead.parentId ? byId.get(bead.parentId) ?? null : null;
    const named = (id) => byId.get(id)?.title || shortId(id);
    const options = pop.open ? parentOptions(beads, statuses, bead.parentId).filter((b2) => b2.id !== bead.id && !inside(b2, bead.id, byId)) : [];
    const choose = async (to) => {
      pop.close();
      refocusSoon(trigger.current);
      if (to === bead.parentId) return;
      const from = bead.parentId;
      if (await writes.send(() => ({ parent: to }))) store.notify(to ? `Moved under ${named(to)}.` : `Moved out of ${from ? named(from) : "its parent"}.`);
      refocusSoon(trigger.current);
    };
    const shown = bead.parentId ? parent?.title || shortId(bead.parentId) : null;
    const epicParent = parent?.type === "epic";
    return /* @__PURE__ */ u3("span", { class: "bd-popwrap bd-parentwrap", children: [
      /* @__PURE__ */ u3(
        "button",
        {
          ref: trigger,
          type: "button",
          class: "bd-chipbtn bd-parent",
          "data-none": shown === null || void 0,
          "aria-label": `Parent: ${shown ?? "No parent"}`,
          "aria-haspopup": "menu",
          "aria-expanded": pop.open,
          title: disabled ?? (epicParent ? "Move to another epic" : "Move to an epic"),
          disabled: disabled !== null || writes.busy,
          onClick: pop.toggle,
          children: [
            epicParent && /* @__PURE__ */ u3(IconEpic, { size: 12 }),
            /* @__PURE__ */ u3("span", { class: "bd-parent-t", children: shown ?? "No parent" }),
            /* @__PURE__ */ u3(IconChevron, {})
          ]
        }
      ),
      pop.open && /* @__PURE__ */ u3(Popover, { label: "Move to", role: "menu", onClose: pop.close, children: [
        /* @__PURE__ */ u3("button", { type: "button", role: "menuitemradio", "aria-checked": bead.parentId === null, class: "bd-menu-item", onClick: () => void choose(null), children: /* @__PURE__ */ u3("span", { children: "No parent" }) }),
        options.length > 0 && /* @__PURE__ */ u3("div", { class: "bd-menu-rule", role: "separator" }),
        /* @__PURE__ */ u3("div", { class: "bd-menu-scroll", role: "none", children: options.map((epic) => /* @__PURE__ */ u3("button", { type: "button", role: "menuitemradio", "aria-checked": epic.id === bead.parentId, class: "bd-menu-item bd-menu-epic", title: epic.title, onClick: () => void choose(epic.id), children: [
          /* @__PURE__ */ u3(IconEpic, { size: 12 }),
          /* @__PURE__ */ u3("span", { class: "bd-menu-t", children: epic.title }),
          /* @__PURE__ */ u3("span", { class: "bd-menu-sub", children: shortId(epic.id) })
        ] }, epic.id)) }),
        options.length === 0 && /* @__PURE__ */ u3("button", { type: "button", role: "menuitem", class: "bd-menu-item bd-menu-note", disabled: true, children: "No other open epics in this project." })
      ] })
    ] });
  }
  var dueOf = (b2) => typeof b2.extra.due_at === "string" ? b2.extra.due_at : null;
  var deferOf = (b2) => typeof b2.extra.defer_until === "string" ? b2.extra.defer_until : null;
  var storedLabel = (text2, now) => {
    const ms = Date.parse(text2);
    return Number.isFinite(ms) ? dateLabel(ms, now) : text2;
  };
  function snoozed(b2, now) {
    const until = deferOf(b2);
    if (b2.status === "deferred") return { until };
    const at2 = until === null ? NaN : Date.parse(until);
    return Number.isFinite(at2) && at2 > now ? { until } : null;
  }
  var shownKey = (kind, b2) => kind === "due" ? dueOf(b2) ?? "" : `${b2.status === "deferred"}|${deferOf(b2) ?? ""}`;
  function dateNow(kind, b2, now) {
    if (kind === "due") {
      const due = dueOf(b2);
      return due === null ? "Now no due date." : `Now due ${storedLabel(due, now)}.`;
    }
    const s3 = snoozed(b2, now);
    return s3 === null ? "Now not deferred." : s3.until === null ? "Now deferred until someone brings it back." : `Now deferred until ${storedLabel(s3.until, now)}.`;
  }
  function DateRow({ kind, bead, disabled, done, now, reword, onDirty }) {
    const store = useStoreApi();
    const due = kind === "due";
    const [editing, setEditing] = d2(false);
    const [text2, setText2] = d2("");
    const [base, setBase] = d2(null);
    const [busy, setBusy] = d2(false);
    const sending = A2(false);
    const [feedback, setFeedback] = d2(null);
    const [conflict, setConflict] = d2(null);
    const [confirming, setConfirming] = d2(false);
    const row2 = A2(null);
    const typed2 = text2.trim();
    const dirty = editing && typed2 !== "";
    h2(() => onDirty(dirty), [dirty]);
    h2(() => () => onDirty(false), []);
    const home = () => requestAnimationFrame(() => (row2.current?.querySelector("[data-date-open]:not(:disabled)") ?? row2.current?.querySelector("button:not(:disabled)"))?.focus({ preventScroll: true }));
    const close = () => {
      setEditing(false);
      setText2("");
      setBase(null);
      setConfirming(false);
      setConflict(null);
      home();
    };
    h2(() => {
      if (!editing || busy || conflict || base === null) return;
      if (shownKey(kind, bead) === shownKey(kind, base)) {
        if (bead.updatedAt !== base.updatedAt) setBase(bead);
      } else if (typed2 === "") setBase(bead);
      else setConflict({ current: bead, again: (current) => void save(current), same: false });
    }, [bead]);
    const settle = (outcome, on, again, said, keepOpen) => {
      if (outcome.kind === "dropped") return;
      if (outcome.kind === "ok") {
        store.notify(said(outcome.value));
        return close();
      }
      if (outcome.kind === "conflict") {
        setConflict({ current: outcome.current, again, same: shownKey(kind, outcome.current) === shownKey(kind, on) });
        requestAnimationFrame(() => row2.current?.querySelector(".bd-wnote-date")?.focus({ preventScroll: true }));
        return;
      }
      if (outcome.kind === "uncertain" && outcome.saved && keepOpen) close();
      else if (!editing) home();
      setFeedback(feedbackOf(outcome));
    };
    const run = async (on, send, again, said, keepOpen = false) => {
      if (sending.current || disabled !== null) return;
      sending.current = true;
      setBusy(true);
      setFeedback(null);
      setConflict(null);
      setConfirming(false);
      const outcome = await send();
      sending.current = false;
      setBusy(false);
      settle(outcome, on, again, said, keepOpen);
    };
    const save = (on) => {
      if (typed2 === "") return;
      setBase(on);
      const sent = typed2;
      void run(
        on,
        () => due ? store.update(bead.id, on.updatedAt, { due: sent }, { due: dueOf(on) }) : store.defer(bead.id, on.updatedAt, sent),
        (current) => save(current),
        (b2) => {
          const stored2 = due ? dueOf(b2) : deferOf(b2);
          return stored2 === null ? due ? "Due date saved." : "Deferred." : due ? `Due ${storedLabel(stored2, now)}.` : `Deferred until ${storedLabel(stored2, now)}.`;
        },
        true
      );
    };
    const clearDue = (on) => void run(on, () => store.update(bead.id, on.updatedAt, { due: null }, { due: dueOf(on) }), clearDue, () => "Due date cleared.");
    const indefinitely = (on) => void run(on, () => store.defer(bead.id, on.updatedAt, null), indefinitely, () => "Deferred until someone brings it back.");
    const undefer = (on) => void run(on, () => store.undefer(bead.id, on.updatedAt), undefer, () => "No longer deferred.");
    const open = () => {
      setEditing(true);
      setText2("");
      setBase(bead);
      setFeedback(null);
      setConflict(null);
    };
    const cancel = () => {
      if (busy) return;
      if (typed2 !== "" && !confirming) setConfirming(true);
      else close();
    };
    const onKeyDown = (e3) => {
      if (e3.key !== "Escape" || e3.defaultPrevented || !(editing || confirming)) return;
      e3.preventDefault();
      e3.stopPropagation();
      if (confirming) {
        setConfirming(false);
        row2.current?.querySelector("input")?.focus({ preventScroll: true });
      } else cancel();
    };
    const off = disabled !== null || busy;
    const title = disabled ?? void 0;
    const stored = due ? dueOf(bead) : null;
    const snooze = due ? null : snoozed(bead, now);
    const storedAt = stored === null ? NaN : Date.parse(stored);
    const overdue = due && !done && Number.isFinite(storedAt) && storedAt < now;
    const value = due ? stored === null ? "No due date" : storedLabel(stored, now) : snooze === null ? "Not deferred" : snooze.until === null ? "Until someone brings it back" : `Until ${storedLabel(snooze.until, now)}`;
    const empty = due ? stored === null : snooze === null;
    const actions = due ? stored === null ? /* @__PURE__ */ u3("button", { type: "button", class: "bd-datebtn", "data-date-open": true, title, disabled: off, onClick: open, children: "Set due date" }) : /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("button", { type: "button", class: "bd-datebtn", "data-date-open": true, "aria-label": "Change due date", title, disabled: off, onClick: open, children: "Change" }),
      /* @__PURE__ */ u3("button", { type: "button", class: "bd-datebtn", "aria-label": "Clear due date", title, disabled: off, onClick: () => clearDue(bead), children: "Clear" })
    ] }) : /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("button", { type: "button", class: "bd-datebtn", "data-date-open": true, "aria-label": snooze === null ? "Defer until a date" : snooze.until ? "Change defer date" : "Set a date to defer until", title, disabled: off, onClick: open, children: snooze === null ? "Defer until\u2026" : snooze.until ? "Change" : "Set a date" }),
      (snooze === null || snooze.until !== null) && /* @__PURE__ */ u3("button", { type: "button", class: "bd-datebtn", title: title ?? "Set aside with no date, until someone brings it back", disabled: off, onClick: () => indefinitely(bead), children: "Defer indefinitely" }),
      snooze !== null && /* @__PURE__ */ u3("button", { type: "button", class: "bd-datebtn", title: title ?? "Back to open", disabled: off, onClick: () => undefer(bead), children: "Undefer" })
    ] });
    return /* @__PURE__ */ u3("div", { ref: row2, class: "bd-daterow", "data-date": kind, "data-editing": editing || void 0, "data-busy": busy || void 0, role: "group", "aria-label": due ? "Due date" : "Deferred", onKeyDown, children: [
      /* @__PURE__ */ u3("span", { class: "bd-datelab", "aria-hidden": "true", children: due ? "Due" : "Deferred" }),
      /* @__PURE__ */ u3("div", { class: "bd-dateval", children: [
        !editing && /* @__PURE__ */ u3("div", { class: "bd-dateline", children: [
          /* @__PURE__ */ u3("span", { class: "bd-datetext", "data-none": empty || void 0, children: [
            value,
            overdue && /* @__PURE__ */ u3("span", { class: "bd-overdue", children: "Overdue" })
          ] }),
          /* @__PURE__ */ u3("span", { class: "bd-dateacts", children: actions })
        ] }),
        editing && /* @__PURE__ */ u3("div", { class: "bd-dateedit", children: [
          /* @__PURE__ */ u3(
            DateInput,
            {
              label: due ? "Due date" : "Defer until",
              lead: due ? "Due" : "Until",
              value: text2,
              onInput: setText2,
              onEnter: () => confirming ? close() : conflict ? void 0 : save(base ?? bead),
              readOnly: busy || conflict !== null,
              disabled: disabled !== null,
              autoFocus: true
            }
          ),
          confirming ? /* @__PURE__ */ u3("div", { class: "bd-confirm", role: "alertdialog", "aria-label": "Discard your changes?", children: [
            /* @__PURE__ */ u3("span", { children: "Discard your changes?" }),
            /* @__PURE__ */ u3(
              "button",
              {
                type: "button",
                class: "bd-btn bd-btn-sm",
                onClick: () => {
                  setConfirming(false);
                  row2.current?.querySelector("input")?.focus({ preventScroll: true });
                },
                children: "Keep editing"
              }
            ),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", "data-tone": "danger", onClick: close, children: "Discard" })
          ] }) : !conflict && /* @__PURE__ */ u3("div", { class: "bd-edacts", children: [
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, onClick: cancel, children: "Cancel" }),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: off || typed2 === "", title, onClick: () => save(base ?? bead), children: busy ? "Saving\u2026" : due ? "Save" : "Defer" })
          ] })
        ] }),
        conflict && /* @__PURE__ */ u3("div", { class: "bd-wnote bd-wnote-date", role: "alert", tabIndex: -1, children: [
          /* @__PURE__ */ u3("b", { children: "Changed while you were editing" }),
          /* @__PURE__ */ u3("span", { children: conflict.same ? "Something else on this bead changed; this date did not. Re-apply to make your change." : dateNow(kind, conflict.current, now) }),
          /* @__PURE__ */ u3("span", { class: "bd-wnote-acts", children: [
            /* @__PURE__ */ u3(
              "button",
              {
                type: "button",
                class: "bd-btn bd-btn-sm",
                onClick: () => {
                  setConflict(null);
                  if (editing) close();
                  else home();
                },
                children: "Discard"
              }
            ),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: off, title: disabled ?? "Make your change over it", onClick: () => conflict.again(conflict.current), children: "Re-apply" })
          ] })
        ] }),
        /* @__PURE__ */ u3(WriteMessage, { feedback, reword })
      ] })
    ] });
  }
  function DateFields({ canDefer, onDirty, ...props }) {
    const [dirty, setDirty] = d2({ due: false, defer: false });
    const any = dirty.due || dirty.defer;
    h2(() => onDirty?.(any), [any]);
    return /* @__PURE__ */ u3("div", { class: "bd-dates", children: [
      /* @__PURE__ */ u3(DateRow, { kind: "due", ...props, onDirty: (d3) => setDirty((x4) => x4.due === d3 ? x4 : { ...x4, due: d3 }) }),
      canDefer && !props.done && /* @__PURE__ */ u3(DateRow, { kind: "defer", ...props, onDirty: (d3) => setDirty((x4) => x4.defer === d3 ? x4 : { ...x4, defer: d3 }) })
    ] });
  }
  function AssigneePicker({ bead, writes, disabled, beads, panelActor }) {
    const pop = usePopover(disabled !== null);
    const [text2, setText2] = d2("");
    const listId = g2();
    const q4 = text2.trim().toLowerCase();
    const options = assigneeOptions(beads, panelActor).filter((n2) => n2 !== bead.assignee && (q4 === "" || n2.toLowerCase().includes(q4)));
    const choices = useChoices(options, listId);
    const close = () => {
      pop.close();
      setText2("");
    };
    const assign = (name) => {
      close();
      if (name !== bead.assignee) void writes.send(() => ({ assignee: name }));
    };
    const shown = bead.assignee ? personName(bead.assignee, panelActor || null) : "unassigned";
    return /* @__PURE__ */ u3("span", { class: "bd-popwrap", children: [
      /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: "bd-assignee bd-chipbtn",
          "data-none": bead.assignee ? void 0 : true,
          "aria-label": `Assignee: ${bead.assignee ?? "unassigned"}`,
          "aria-haspopup": "dialog",
          "aria-expanded": pop.open,
          title: disabled ?? (bead.assignee ? `Assigned to ${bead.assignee}` : "Assign"),
          disabled: disabled !== null || writes.busy,
          onClick: () => pop.open ? close() : pop.toggle(),
          children: [
            bead.assignee ? /* @__PURE__ */ u3("span", { class: "bd-av", "data-size": "sm", "aria-hidden": "true", children: initials(bead.assignee) }) : /* @__PURE__ */ u3("i", { "aria-hidden": "true" }),
            shown
          ]
        }
      ),
      pop.open && /* @__PURE__ */ u3(Popover, { label: "Assignee", onClose: close, children: [
        /* @__PURE__ */ u3(
          "input",
          {
            class: "bd-input",
            "aria-label": "Assignee",
            "aria-controls": listId,
            "aria-activedescendant": choices.activeId,
            placeholder: "Name",
            value: text2,
            onInput: (e3) => setText2(e3.currentTarget.value),
            onKeyDown: (e3) => choices.onKey(e3, (picked) => picked ? assign(picked) : text2.trim() ? assign(text2.trim()) : void 0)
          }
        ),
        options.length > 0 && /* @__PURE__ */ u3("ul", { id: listId, class: "bd-opts", role: "listbox", "aria-label": "People", children: options.map((name, i3) => /* @__PURE__ */ u3("li", { id: choices.optionId(i3), role: "option", "aria-selected": i3 === choices.active, class: "bd-opt", onClick: () => assign(name), children: name }, name)) }),
        text2.trim() && !options.some((n2) => n2.toLowerCase() === q4) && /* @__PURE__ */ u3("button", { type: "button", class: "bd-menu-item", onClick: () => assign(text2.trim()), children: `Assign to "${text2.trim()}"` }),
        bead.assignee && /* @__PURE__ */ u3("button", { type: "button", class: "bd-menu-item bd-menu-sep", onClick: () => assign(null), children: "Unassign" })
      ] })
    ] });
  }
  function LabelsEditor({ bead, writes, disabled, beads }) {
    const pop = usePopover(disabled !== null);
    const [text2, setText2] = d2("");
    const [tried, setTried] = d2(false);
    const listId = g2();
    const problem = labelProblem(text2, bead.labels);
    const q4 = text2.trim().toLowerCase();
    const known = [...new Set(beads.flatMap((b2) => b2.labels))].filter((l3) => !bead.labels.includes(l3) && q4 !== "" && l3.toLowerCase().includes(q4)).sort().slice(0, 5);
    const choices = useChoices(known, listId);
    const close = () => {
      pop.close();
      setText2("");
      setTried(false);
    };
    const add = (label) => {
      setTried(true);
      if (labelProblem(label, bead.labels)) return;
      setText2("");
      setTried(false);
      const added = label.trim();
      void writes.send((b2) => ({ labels: b2.labels.includes(added) ? b2.labels : [...b2.labels, added] }));
    };
    return /* @__PURE__ */ u3("span", { class: "bd-popwrap", children: [
      /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: "bd-lbadd",
          "aria-label": "Edit labels",
          "aria-haspopup": "dialog",
          "aria-expanded": pop.open,
          title: disabled ?? "Labels",
          disabled: disabled !== null,
          onClick: () => pop.open ? close() : pop.toggle(),
          children: bead.labels.length ? "+" : "+ Label"
        }
      ),
      pop.open && /* @__PURE__ */ u3(Popover, { label: "Labels", align: "end", onClose: close, children: [
        bead.labels.length > 0 && /* @__PURE__ */ u3("div", { class: "bd-lbs", children: bead.labels.map((label) => /* @__PURE__ */ u3("span", { class: "bd-lb bd-lb-edit", children: [
          label,
          /* @__PURE__ */ u3(
            "button",
            {
              type: "button",
              "aria-label": `Remove label ${label}`,
              disabled: writes.busy,
              onClick: () => void writes.send((b2) => ({ labels: b2.labels.filter((l3) => l3 !== label) })),
              children: /* @__PURE__ */ u3(IconX, { size: 10 })
            }
          )
        ] }, label)) }),
        /* @__PURE__ */ u3(
          "input",
          {
            class: "bd-input",
            "aria-label": "Add a label",
            "aria-controls": listId,
            "aria-activedescendant": choices.activeId,
            "aria-invalid": problem !== null && (tried || text2 !== "") ? true : void 0,
            placeholder: "Add a label",
            "data-autofocus": true,
            value: text2,
            disabled: writes.busy,
            onInput: (e3) => setText2(e3.currentTarget.value),
            onKeyDown: (e3) => choices.onKey(e3, (picked) => add(picked ?? text2))
          }
        ),
        problem && (tried || text2 !== "") && /* @__PURE__ */ u3("p", { class: "bd-fieldmsg", children: problem }),
        known.length > 0 && /* @__PURE__ */ u3("ul", { id: listId, class: "bd-opts", role: "listbox", "aria-label": "Labels in this project", children: known.map((label, i3) => /* @__PURE__ */ u3("li", { id: choices.optionId(i3), role: "option", "aria-selected": i3 === choices.active, class: "bd-opt", onClick: () => add(label), children: label }, label)) })
      ] })
    ] });
  }
  var REPLACE = {
    supersede: { title: "Superseded by", ask: "Which bead replaces this one?", as: "superseded by", action: "Close as superseded", done: "superseded by" },
    duplicate: { title: "Duplicate of", ask: "Which bead does this one repeat?", as: "a duplicate of", action: "Close as duplicate", done: "a duplicate of" }
  };
  function ReplaceStep({ kind, bead, beads, statuses, disabled, reword, onClose }) {
    const store = useStoreApi();
    const words = REPLACE[kind];
    const [text2, setText2] = d2("");
    const [chosen, setChosen] = d2(null);
    const [busy, setBusy] = d2(false);
    const sending = A2(false);
    const [feedback, setFeedback] = d2(null);
    const [changed2, setChanged] = d2(false);
    const listId = g2();
    const input = A2(null);
    const confirm = A2(null);
    const look = looker(statuses);
    const found = chosen ? [] : linkTargets(text2, beads, bead.id, statuses);
    const choices = useChoices(found, listId);
    h2(() => (chosen ? confirm.current : input.current)?.focus({ preventScroll: true }), [chosen === null]);
    const pick = (target) => {
      if (!target) return;
      setFeedback(null);
      setChanged(false);
      setChosen(target);
    };
    const send = async () => {
      if (!chosen || sending.current || disabled !== null) return;
      sending.current = true;
      setBusy(true);
      setFeedback(null);
      setChanged(false);
      const outcome = kind === "supersede" ? await store.supersede(bead.id, chosen.id, bead.updatedAt) : await store.duplicate(bead.id, chosen.id, bead.updatedAt);
      sending.current = false;
      setBusy(false);
      if (outcome.kind === "dropped") return;
      if (outcome.kind === "ok") {
        store.notify(`Closed ${shortId(bead.id)} as ${words.done} ${shortId(chosen.id)}.`);
        return onClose(true);
      }
      if (outcome.kind === "conflict") setChanged(true);
      else setFeedback(feedbackOf(outcome));
    };
    const back = () => {
      if (busy) return;
      setChosen(null);
      setFeedback(null);
      setChanged(false);
    };
    const named = (b2) => `${shortId(b2.id)} ${b2.title}`.trim();
    return /* @__PURE__ */ u3(
      "div",
      {
        class: "bd-nstep bd-replace",
        "data-stage": chosen ? "confirm" : "pick",
        role: "group",
        "aria-label": words.title,
        onKeyDown: (e3) => {
          if (e3.key !== "Escape" || composing(e3)) return;
          e3.preventDefault();
          e3.stopPropagation();
          if (busy) return;
          if (!chosen && text2) setText2("");
          else onClose(false);
        },
        children: chosen ? /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3("p", { class: "bd-replace-q", children: [
            /* @__PURE__ */ u3("span", { class: "bd-replace-lab", children: words.title }),
            /* @__PURE__ */ u3("span", { class: "bd-replace-pick", children: [
              /* @__PURE__ */ u3(StatusDot, { look: look(chosen.status), marker: markerOf(chosen.status) }),
              /* @__PURE__ */ u3("span", { class: "bd-id", children: shortId(chosen.id) }),
              /* @__PURE__ */ u3("span", { class: "bd-title", children: chosen.title })
            ] })
          ] }),
          /* @__PURE__ */ u3("p", { class: "bd-replace-says", children: [
            /* @__PURE__ */ u3("b", { children: `This closes ${bead.id}.` }),
            " ",
            `It will show as ${words.as} ${named(chosen)}.`
          ] }),
          changed2 && /* @__PURE__ */ u3("p", { class: "bd-wmsg", "data-tone": "note", role: "status", children: "This bead changed while you were choosing. Nothing was saved. Look it over, then close it again." }),
          feedback && /* @__PURE__ */ u3(WriteMessage, { feedback, reword }),
          /* @__PURE__ */ u3("div", { class: "bd-nstep-acts", children: [
            /* @__PURE__ */ u3(
              "button",
              {
                ref: confirm,
                type: "button",
                class: "bd-btn bd-btn-sm bd-btn-primary",
                "aria-disabled": busy || disabled !== null || void 0,
                "aria-busy": busy || void 0,
                title: disabled ?? void 0,
                onClick: () => void send(),
                children: busy ? "Closing\u2026" : words.action
              }
            ),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, onClick: back, children: "Choose another" }),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, onClick: () => onClose(false), children: "Cancel" })
          ] })
        ] }) : /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3("label", { class: "bd-flab", for: `${listId}-in`, children: words.ask }),
          /* @__PURE__ */ u3(
            "input",
            {
              ref: input,
              id: `${listId}-in`,
              class: "bd-input",
              role: "combobox",
              "aria-expanded": found.length > 0,
              "aria-controls": listId,
              "aria-activedescendant": choices.activeId,
              "aria-autocomplete": "list",
              placeholder: "Bead id or title",
              value: text2,
              onInput: (e3) => setText2(e3.currentTarget.value),
              onKeyDown: (e3) => choices.onKey(e3, (b2) => pick(b2 ?? found[0] ?? null))
            }
          ),
          found.length > 0 && /* @__PURE__ */ u3("ul", { id: listId, class: "bd-opts bd-opts-in", role: "listbox", "aria-label": "Beads", children: found.map((b2, i3) => /* @__PURE__ */ u3("li", { id: choices.optionId(i3), role: "option", "aria-selected": i3 === choices.active, class: "bd-opt bd-opt-bead", onClick: () => pick(b2), children: [
            /* @__PURE__ */ u3(StatusDot, { look: look(b2.status), marker: markerOf(b2.status) }),
            /* @__PURE__ */ u3("span", { class: "bd-id", children: shortId(b2.id) }),
            /* @__PURE__ */ u3("span", { class: "bd-title", children: b2.title })
          ] }, b2.id)) }),
          text2.trim() !== "" && found.length === 0 && /* @__PURE__ */ u3("p", { class: "bd-fieldmsg", "data-tone": "quiet", children: "No bead matches." }),
          /* @__PURE__ */ u3("p", { class: "bd-nstep-hint", children: `Closes ${bead.id} and links it to the bead you pick. You confirm first.` }),
          /* @__PURE__ */ u3("div", { class: "bd-nstep-acts", children: /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => onClose(false), children: "Cancel" }) })
        ] })
      }
    );
  }
  function LinkAdder({ bead, beads, statuses, disabled, onDone }) {
    const store = useStoreApi();
    const [kind, setKind] = d2(LINK_KINDS[0].value);
    const [text2, setText2] = d2("");
    const [busy, setBusy] = d2(false);
    const [feedback, setFeedback] = d2(null);
    const listId = g2();
    const input = A2(null);
    h2(() => input.current?.focus(), []);
    const look = looker(statuses);
    const found = linkTargets(text2, beads, bead.id, statuses);
    const choices = useChoices(found, listId);
    const pick = async (target) => {
      if (!target || busy || disabled !== null) return;
      setBusy(true);
      setFeedback(null);
      const outcome = await store.link({ op: "add", ...linkRequest(kind, bead.id, target.id) });
      setBusy(false);
      if (outcome.kind === "ok") onDone();
      else setFeedback(feedbackOf(outcome));
    };
    return /* @__PURE__ */ u3(
      "div",
      {
        class: "bd-linkadd",
        onKeyDown: (e3) => {
          if (e3.key !== "Escape") return;
          e3.preventDefault();
          e3.stopPropagation();
          onDone();
        },
        children: [
          /* @__PURE__ */ u3("div", { class: "bd-linkrow", children: [
            /* @__PURE__ */ u3("select", { class: "bd-select", "aria-label": "Kind of link", value: kind, disabled: disabled !== null || busy, onChange: (e3) => setKind(e3.currentTarget.value), children: LINK_KINDS.map((k3) => /* @__PURE__ */ u3("option", { value: k3.value, children: k3.label }, k3.value)) }),
            /* @__PURE__ */ u3(
              "input",
              {
                class: "bd-input",
                role: "combobox",
                "aria-label": "Find a bead by id or title",
                "aria-expanded": found.length > 0,
                "aria-controls": listId,
                "aria-activedescendant": choices.activeId,
                "aria-autocomplete": "list",
                placeholder: "Bead id or title",
                ref: input,
                value: text2,
                disabled: disabled !== null || busy,
                onInput: (e3) => setText2(e3.currentTarget.value),
                onKeyDown: (e3) => choices.onKey(e3, (b2) => void pick(b2 ?? found[0] ?? null))
              }
            ),
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-iconbtn bd-iconbtn-sm", "aria-label": "Cancel adding a link", onClick: onDone, children: /* @__PURE__ */ u3(IconX, {}) })
          ] }),
          found.length > 0 && /* @__PURE__ */ u3("ul", { id: listId, class: "bd-opts bd-opts-in", role: "listbox", "aria-label": "Beads", children: found.map((b2, i3) => /* @__PURE__ */ u3(
            "li",
            {
              id: choices.optionId(i3),
              role: "option",
              "aria-selected": i3 === choices.active,
              "aria-disabled": disabled !== null || busy || void 0,
              class: "bd-opt bd-opt-bead",
              title: disabled ?? void 0,
              onClick: () => void pick(b2),
              children: [
                /* @__PURE__ */ u3(StatusDot, { look: look(b2.status), marker: markerOf(b2.status) }),
                /* @__PURE__ */ u3("span", { class: "bd-id", children: shortId(b2.id) }),
                /* @__PURE__ */ u3("span", { class: "bd-title", children: b2.title })
              ]
            },
            b2.id
          )) }),
          text2.trim() !== "" && found.length === 0 && /* @__PURE__ */ u3("p", { class: "bd-fieldmsg", "data-tone": "quiet", children: "No bead matches." }),
          /* @__PURE__ */ u3(WriteMessage, { feedback })
        ]
      }
    );
  }

  // src/panel/ui/Gates.tsx
  var DEFAULT_REASON = { review: REVIEW_REASON, plan: PLAN_APPROVAL_REASON };
  var MAX_REASON = 500;
  function askReason(kind, text2) {
    const typed2 = text2.replace(/\s+/g, " ").trim();
    if (!typed2) return DEFAULT_REASON[kind];
    if (kind === "review" || typed2.startsWith(PLAN_APPROVAL_REASON)) return typed2.slice(0, MAX_REASON);
    return `${PLAN_APPROVAL_REASON}: ${typed2}`.slice(0, MAX_REASON);
  }
  var gateDomId = (id) => `bd-gate-${id.replace(/[^\w.-]/g, "_")}`;
  var askKey = (beadId) => `ask:${beadId}`;
  var gateKey = (id) => `gate:${id}`;
  var ASK_FIELD = "bd-ask-field";
  var goId = (gateId) => `${gateDomId(gateId)}-go`;
  var fieldId = (gateId) => `${gateDomId(gateId)}-field`;
  function useGates(bead) {
    const state = useStore();
    const store = useStoreApi();
    const id = bead?.id ?? null;
    const current = A2(id);
    current.current = id;
    const seen = A2(/* @__PURE__ */ new Set());
    for (const g3 of state.gates) seen.current.add(g3.id);
    const inflight = A2(/* @__PURE__ */ new Set());
    const [busy, setBusy] = d2(/* @__PURE__ */ new Set());
    const [step, setStep] = d2(null);
    const [feedback, setFeedback] = d2({});
    const [settled, setSettled] = d2({});
    const [made, setMade] = d2([]);
    const [found, setFound] = d2(null);
    const follow = A2(null);
    const refocus = A2(null);
    h2(() => {
      setStep(null);
      setFeedback({});
      setSettled({});
      setMade([]);
      setFound(null);
      follow.current = null;
    }, [id]);
    const listed = bead ? gatesOn(bead, state.gates) : [];
    const gates = [...listed, ...made.filter((g3) => id !== null && g3.blocks.includes(id) && !seen.current.has(g3.id) && !settled[g3.id])];
    _2(() => {
      const target = refocus.current;
      if (target) {
        refocus.current = null;
        document.getElementById(target)?.focus({ preventScroll: true });
      }
      const f5 = follow.current;
      if (!f5 || document.getElementById(gateDomId(f5.id))) return;
      follow.current = null;
      const active2 = document.activeElement;
      if (active2 && active2 !== document.body) return;
      const next = f5.next && document.getElementById(gateDomId(f5.next)) || document.querySelector(".bd-detail");
      next?.focus({ preventScroll: true });
    });
    async function run(at2, key, feedbackKey, send, done, back) {
      if (inflight.current.has(key)) return;
      inflight.current.add(key);
      setBusy(new Set(inflight.current));
      setFeedback((f5) => ({ ...f5, [feedbackKey]: null }));
      const outcome = await send();
      inflight.current.delete(key);
      setBusy(new Set(inflight.current));
      if (outcome.kind === "dropped" || current.current !== at2) return;
      if (outcome.kind === "ok") {
        done(outcome.value);
        return;
      }
      setFeedback((f5) => ({ ...f5, [feedbackKey]: feedbackOf(outcome) }));
      const active2 = document.activeElement;
      if (!active2 || active2 === document.body) refocus.current = back();
    }
    const ask = (kind, reason) => {
      if (!bead) return;
      const at2 = bead.id;
      const why = askReason(kind, reason ?? "");
      const send = () => store.requestReview(at2, why === REVIEW_REASON ? void 0 : why);
      const back = () => document.getElementById(ASK_FIELD) ? ASK_FIELD : MENU_ID;
      void run(at2, askKey(at2), "ask", send, (result) => {
        setStep((s3) => s3?.mode === "ask" ? null : s3);
        if (!seen.current.has(result.gate.id)) setMade((list) => [...list.filter((g3) => g3.id !== result.gate.id), result.gate]);
        refocus.current = gateDomId(result.gate.id);
        if (result.ok) {
          setFound(null);
          store.notify(kind === "plan" ? `Plan approval asked for on ${shortId(at2)}.` : `Review asked for on ${shortId(at2)}.`);
        } else {
          setFound(result.gate.id);
        }
      }, back);
    };
    const resolve = (gate, reason) => {
      if (!bead) return;
      const at2 = bead.id;
      const shown = gates.map((g3) => g3.id);
      const next = shown[shown.indexOf(gate.id) + 1] ?? shown[shown.indexOf(gate.id) - 1] ?? null;
      const back = () => document.getElementById(fieldId(gate.id)) ? fieldId(gate.id) : goId(gate.id);
      void run(at2, gateKey(gate.id), gate.id, () => store.resolveReview(gate.id, reason.trim() || void 0), (result) => {
        const li = document.getElementById(gateDomId(gate.id));
        const held = !!li && (li.contains(document.activeElement) || document.activeElement === document.body);
        setStep((s3) => s3?.mode === "resolve" && s3.gateId === gate.id ? null : s3);
        if (result.ok) {
          setSettled((s3) => ({ ...s3, [gate.id]: { text: gate.planApproval ? "Approved. Updating." : "Resolved. Updating.", tone: "done" } }));
          store.notify(gate.planApproval ? `Plan approved for ${shortId(at2)}.` : `Review resolved for ${shortId(at2)}.`);
        } else {
          const when2 = result.at === null ? NaN : Date.parse(result.at);
          const what = gate.planApproval ? "This plan was already approved" : "This review was already resolved";
          const who = result.resolvedBy ? ` by ${result.resolvedBy}` : "";
          setSettled((s3) => ({ ...s3, [gate.id]: { text: `${what}${who}${Number.isFinite(when2) ? ` ${ago(Date.now() - when2)}` : ""}. Updating.`, tone: "note" } }));
        }
        if (held) {
          refocus.current = gateDomId(gate.id);
          follow.current = { id: gate.id, next };
        }
      }, back);
    };
    return {
      gates,
      asking: id !== null && busy.has(askKey(id)),
      resolving: (gateId) => busy.has(gateKey(gateId)),
      ask,
      resolve,
      step,
      openStep: (s3) => setStep(s3),
      closeStep: (focus2) => {
        if (focus2) refocus.current = focus2;
        setStep(null);
      },
      feedback,
      settled,
      found,
      supported: !state.unsupported.has("gates")
    };
  }
  var MENU_ID = "bd-bead-menu";
  var BEAD_MENU_ID = MENU_ID;
  function BeadMenu({ kit, disabled, done, replace }) {
    const pop = usePopover(disabled !== null);
    if (!kit.supported && !replace || done) return null;
    const off = kit.asking;
    const pick = (go) => () => {
      pop.close();
      go();
    };
    return /* @__PURE__ */ u3("span", { class: "bd-popwrap", children: [
      /* @__PURE__ */ u3("button", { type: "button", id: MENU_ID, class: "bd-iconbtn", "aria-label": "Bead actions", "aria-haspopup": "menu", "aria-expanded": pop.open, title: disabled ?? "Bead actions", disabled: disabled !== null, onClick: pop.toggle, children: /* @__PURE__ */ u3(IconMore, {}) }),
      pop.open && /* @__PURE__ */ u3(Popover, { label: "Bead actions", align: "end", role: "menu", onClose: pop.close, children: [
        kit.supported && /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3("button", { type: "button", role: "menuitem", class: "bd-menu-item", disabled: off, onClick: pick(() => kit.ask("review")), children: /* @__PURE__ */ u3("span", { children: "Ask for a review" }) }),
          /* @__PURE__ */ u3("button", { type: "button", role: "menuitem", class: "bd-menu-item", disabled: off, onClick: pick(() => kit.ask("plan")), children: /* @__PURE__ */ u3("span", { children: "Ask for plan approval" }) }),
          /* @__PURE__ */ u3("div", { class: "bd-menu-rule", role: "separator" }),
          /* @__PURE__ */ u3("button", { type: "button", role: "menuitem", class: "bd-menu-item", onClick: pick(() => kit.openStep({ mode: "ask", kind: "review", text: REVIEW_REASON })), children: /* @__PURE__ */ u3("span", { children: "Ask with a reason\u2026" }) })
        ] }),
        replace && /* @__PURE__ */ u3(S, { children: [
          kit.supported && /* @__PURE__ */ u3("div", { class: "bd-menu-rule", role: "separator" }),
          /* @__PURE__ */ u3("button", { type: "button", role: "menuitem", class: "bd-menu-item", onClick: pick(() => replace("supersede")), children: /* @__PURE__ */ u3("span", { children: "Superseded by\u2026" }) }),
          /* @__PURE__ */ u3("button", { type: "button", role: "menuitem", class: "bd-menu-item", onClick: pick(() => replace("duplicate")), children: /* @__PURE__ */ u3("span", { children: "Duplicate of\u2026" }) })
        ] })
      ] })
    ] });
  }
  function PlanAsk({ kit, disabled }) {
    if (!kit.supported || kit.gates.some((g3) => g3.planApproval)) return null;
    const busy = kit.asking;
    return /* @__PURE__ */ u3(
      "button",
      {
        type: "button",
        class: "bd-edit bd-planask",
        title: disabled ?? "Ask for approval of this plan before work starts",
        disabled: disabled !== null || busy,
        "aria-busy": busy || void 0,
        onClick: () => kit.ask("plan"),
        children: "Ask for plan approval"
      }
    );
  }
  var escapeCloses = (cancel) => (e3) => {
    if (e3.key !== "Escape" || composing(e3)) return;
    e3.preventDefault();
    e3.stopPropagation();
    cancel();
  };
  function useFirstFocus() {
    const ref = A2(null);
    h2(() => {
      ref.current?.focus({ preventScroll: true });
      ref.current?.select();
    }, []);
    return ref;
  }
  function ReasonStep({ id, label, text: text2, set, send, cancel, action, hint, busy, paused, message, children }) {
    const field = useFirstFocus();
    const go = () => {
      if (!busy && paused === null) send();
    };
    return /* @__PURE__ */ u3("div", { class: "bd-nstep bd-gstep", role: "group", "aria-label": label, children: [
      children,
      /* @__PURE__ */ u3(
        "input",
        {
          ref: field,
          id,
          type: "text",
          class: "bd-input",
          "aria-label": label,
          placeholder: "Reason (optional)",
          maxLength: MAX_REASON,
          value: text2,
          disabled: busy,
          onInput: (e3) => set(e3.currentTarget.value),
          onKeyDown: (e3) => {
            escapeCloses(() => !busy && cancel())(e3);
            if (isEnterInInput(e3)) {
              e3.preventDefault();
              go();
            }
          }
        }
      ),
      /* @__PURE__ */ u3("p", { class: "bd-nstep-hint", children: hint }),
      /* @__PURE__ */ u3("div", { class: "bd-nstep-acts", children: [
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: busy || paused !== null, "aria-busy": busy || void 0, title: paused ?? void 0, onClick: go, children: action }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, onClick: cancel, children: "Cancel" })
      ] }),
      message
    ] });
  }
  var ASK_HINT = {
    review: "The bead cannot close until someone resolves the review. Agents see it too.",
    plan: "Work waits until someone approves the plan in Design. Agents see it too."
  };
  function AskStep({ kit, step, paused }) {
    const busy = kit.asking;
    const choose = (kind) => {
      const text2 = step.text === DEFAULT_REASON[step.kind] || !step.text.trim() ? DEFAULT_REASON[kind] : step.text;
      kit.openStep({ ...step, kind, text: text2 });
    };
    const fb = kit.feedback.ask ?? null;
    return /* @__PURE__ */ u3(
      ReasonStep,
      {
        id: ASK_FIELD,
        label: step.kind === "plan" ? "Reason for the plan approval" : "Reason for the review",
        text: step.text,
        set: (text2) => kit.openStep({ ...step, text: text2 }),
        send: () => kit.ask(step.kind, step.text),
        cancel: () => kit.closeStep(MENU_ID),
        action: step.kind === "plan" ? "Ask for plan approval" : "Ask for a review",
        hint: ASK_HINT[step.kind],
        busy,
        paused,
        message: fb && /* @__PURE__ */ u3(WriteMessage, { feedback: fb }),
        children: /* @__PURE__ */ u3("div", { class: "bd-gkind", role: "group", "aria-label": "Ask for", children: ["review", "plan"].map((kind) => /* @__PURE__ */ u3("button", { type: "button", class: "bd-gkind-opt", "aria-pressed": step.kind === kind, disabled: busy, onClick: () => choose(kind), children: kind === "plan" ? "Plan approval" : "Review" }, kind)) })
      }
    );
  }
  function resolveHint(gate, others) {
    if (others) return gate.planApproval ? "Approving clears this plan approval. The bead still waits on the rest." : "Resolving clears this review. The bead still waits on the rest.";
    return gate.planApproval ? "Approving lets work on the plan start." : "Resolving lets the bead close.";
  }
  var kindOf = (gate) => gate.kind === "human" ? gate.planApproval ? "plan" : "review" : gate.kind === "gh:run" || gate.kind === "gh:pr" ? "github" : gate.kind === "timer" || gate.kind === "bead" ? gate.kind : "other";
  var firstLine2 = (text2) => text2.trim().split("\n")[0].trim();
  function WaitingOn({ kit, now, panel: panel2, paused }) {
    const step = kit.step;
    const askFeedback = step?.mode === "ask" ? null : kit.feedback.ask ?? null;
    if (kit.gates.length === 0 && step?.mode !== "ask" && !askFeedback) return null;
    return /* @__PURE__ */ u3("div", { class: "bd-gates-wrap", children: [
      step?.mode === "ask" && /* @__PURE__ */ u3(AskStep, { kit, step, paused }),
      askFeedback && /* @__PURE__ */ u3("div", { class: "bd-gnote", children: /* @__PURE__ */ u3(WriteMessage, { feedback: askFeedback }) }),
      kit.gates.length > 0 && /* @__PURE__ */ u3("section", { class: "bd-gates", "aria-labelledby": "bd-gates-h", children: [
        /* @__PURE__ */ u3("h3", { class: "bd-gates-h", id: "bd-gates-h", children: [
          /* @__PURE__ */ u3(IconWait, { size: 12 }),
          /* @__PURE__ */ u3("span", { children: "Waiting on" }),
          kit.gates.length > 1 && /* @__PURE__ */ u3("span", { class: "bd-n", children: kit.gates.length })
        ] }),
        /* @__PURE__ */ u3("ul", { class: "bd-glist", role: "list", children: kit.gates.map((gate) => /* @__PURE__ */ u3(GateItem, { kit, gate, now, panel: panel2, paused }, gate.id)) })
      ] })
    ] });
  }
  function GateItem({ kit, gate, now, panel: panel2, paused }) {
    const id = gateDomId(gate.id);
    const human = gate.kind === "human";
    const busy = kit.resolving(gate.id);
    const settled = kit.settled[gate.id] ?? null;
    const step = kit.step?.mode === "resolve" && kit.step.gateId === gate.id ? kit.step : null;
    const fb = kit.feedback[gate.id] ?? null;
    const off = paused !== null || busy;
    const reason = gate.reason ? firstLine2(gate.reason) : null;
    const closeStep = () => kit.closeStep(`${id}-why`);
    return /* @__PURE__ */ u3("li", { id, class: "bd-gate", "data-kind": kindOf(gate), "data-found": kit.found === gate.id || void 0, tabIndex: -1, "aria-labelledby": `${id}-k ${id}-r`, "aria-describedby": `${id}-m`, children: [
      /* @__PURE__ */ u3("div", { class: "bd-gate-top", children: [
        /* @__PURE__ */ u3("span", { class: "bd-tag", id: `${id}-k`, "data-kind": kindOf(gate), children: gateLabel(gate) }),
        /* @__PURE__ */ u3("span", { class: "bd-gate-reason", id: `${id}-r`, title: gate.reason ?? void 0, "data-none": reason ? void 0 : true, children: reason ?? "No reason given" })
      ] }),
      /* @__PURE__ */ u3("p", { class: "bd-gate-meta", id: `${id}-m`, children: gateState(gate, now, panel2) }),
      kit.found === gate.id && !settled && /* @__PURE__ */ u3("p", { class: "bd-why", "data-tone": "hold", role: "status", children: gate.planApproval ? "This bead already waits on a plan approval." : "This bead already waits on a review." }),
      settled ? /* @__PURE__ */ u3("p", { class: "bd-why bd-gate-settled", "data-tone": settled.tone, role: "status", children: settled.text }) : step ? /* @__PURE__ */ u3(
        ReasonStep,
        {
          id: fieldId(gate.id),
          label: gate.planApproval ? "Reason for approving" : "Reason for resolving",
          text: step.text,
          set: (text2) => kit.openStep({ ...step, text: text2 }),
          send: () => kit.resolve(gate, step.text),
          cancel: closeStep,
          action: gate.planApproval ? "Approve plan" : "Resolve review",
          hint: resolveHint(gate, kit.gates.length > 1),
          busy,
          paused,
          message: fb && /* @__PURE__ */ u3(WriteMessage, { feedback: fb })
        }
      ) : human && kit.supported && /* @__PURE__ */ u3("div", { class: "bd-gate-acts", children: [
        /* @__PURE__ */ u3("div", { class: "bd-nacts-row", children: [
          /* @__PURE__ */ u3("button", { type: "button", id: goId(gate.id), class: "bd-btn bd-btn-sm bd-btn-primary", disabled: off, "aria-busy": busy || void 0, title: paused ?? void 0, onClick: () => kit.resolve(gate, ""), children: gate.planApproval ? "Approve" : "Resolve" }),
          /* @__PURE__ */ u3("button", { type: "button", id: `${id}-why`, class: "bd-link bd-nreason", disabled: off, title: paused ?? void 0, onClick: () => kit.openStep({ mode: "resolve", gateId: gate.id, text: "" }), children: "Add a reason" })
        ] }),
        fb && /* @__PURE__ */ u3(WriteMessage, { feedback: fb })
      ] })
    ] });
  }

  // src/panel/ui/Relationships.tsx
  function Done({ sub, whose }) {
    return /* @__PURE__ */ u3("span", { class: "bd-sub", "data-all": sub.done === sub.total || void 0, title: `${sub.done} of ${sub.total} of ${whose} direct sub-issues done`, children: `${sub.done}/${sub.total}` });
  }
  function linkNote(item, panel2) {
    if (!item.dep) return void 0;
    const time = depTime(item.dep.createdAt);
    return `Linked by ${personName(item.dep.createdBy, panel2)}${time ? `, ${time}` : ""}`;
  }
  function Relationships({ related, parentId, root: root2, current, classify, sub, panel: panel2, open, remove, disabled = null, removing = [], footer }) {
    const groups = relationGroups(related, parentId);
    if (groups.length === 0 && !footer) return null;
    const idFor = (id) => root2 && id !== root2.id ? childId(id, root2.id) : shortId(id);
    const removeFor = (item) => remove && item.dep && item.dep.kind !== "parent-child" ? /* @__PURE__ */ u3(
      "button",
      {
        type: "button",
        class: "bd-relx",
        "aria-label": `Remove link to ${item.id}`,
        title: disabled ?? "Remove link",
        disabled: disabled !== null || removing.includes(`${item.dep.from}>${item.dep.to}`),
        onClick: () => remove(item.dep),
        children: /* @__PURE__ */ u3(IconX, { size: 11 })
      }
    ) : null;
    return /* @__PURE__ */ u3("div", { class: "bd-rels", children: [
      groups.map((group) => {
        const kids = group.key === "children" ? group.items.map((i3) => current(i3.id) ?? i3.bead).filter((b2) => b2 !== null) : [];
        const done = kids.filter((b2) => classify(b2).look === "done").length;
        return /* @__PURE__ */ u3("div", { class: "bd-rgroup", "data-group": group.key, role: "group", "aria-label": group.label, children: [
          /* @__PURE__ */ u3("div", { class: "bd-rlab", "data-tone": group.tone, children: [
            /* @__PURE__ */ u3("b", { children: group.label }),
            group.key === "children" && /* @__PURE__ */ u3(S, { children: [
              /* @__PURE__ */ u3("span", { class: "bd-n", title: `${done} of ${kids.length} of this bead's children done`, children: `${done}/${kids.length} done` }),
              /* @__PURE__ */ u3("span", { class: "bd-bar", "aria-hidden": "true", children: /* @__PURE__ */ u3("i", { "data-look": "done", style: { width: `${kids.length ? done / kids.length * 100 : 0}%` } }) })
            ] })
          ] }),
          group.items.map((item) => {
            const bead = current(item.id) ?? item.bead;
            const note = linkNote(item, panel2);
            const x4 = removeFor(item);
            if (!bead) {
              return /* @__PURE__ */ u3("div", { class: "bd-relrow", "data-x": x4 ? true : void 0, children: [
                /* @__PURE__ */ u3(
                  "div",
                  {
                    class: "bd-rel",
                    "data-missing": true,
                    tabIndex: 0,
                    title: note ?? "This bead is not in the project any more.",
                    "aria-label": `${item.id}, not in this project${note ? `. ${note}` : ""}`,
                    children: [
                      /* @__PURE__ */ u3("span", { class: "bd-sd", "data-look": "other", "aria-hidden": "true" }),
                      /* @__PURE__ */ u3("span", { class: "bd-id", children: item.id }),
                      /* @__PURE__ */ u3("span", { class: "bd-title", children: "Not in this project" })
                    ]
                  }
                ),
                x4
              ] }, `${item.id}:${item.dep?.kind ?? ""}`);
            }
            const c3 = classify(bead);
            const s3 = sub(bead.id);
            return /* @__PURE__ */ u3("div", { class: "bd-relrow", "data-x": x4 ? true : void 0, children: [
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-rel", "data-done": c3.look === "done" || void 0, title: note, onClick: () => open(bead.id), children: [
                group.key === "parent" ? /* @__PURE__ */ u3("span", { class: "bd-ty", "data-type": bead.type, title: bead.type, children: /* @__PURE__ */ u3(TypeIcon, { type: bead.type }) }) : /* @__PURE__ */ u3(StatusDot, { look: c3.look, label: c3.label, marker: c3.marker }),
                /* @__PURE__ */ u3("span", { class: "bd-id", children: idFor(bead.id) }),
                /* @__PURE__ */ u3("span", { class: "bd-title", children: bead.title }),
                s3 && /* @__PURE__ */ u3(Done, { sub: s3, whose: group.key === "parent" ? "this parent's" : "its" })
              ] }),
              x4
            ] }, `${item.id}:${item.dep?.kind ?? ""}`);
          })
        ] }, group.key);
      }),
      footer
    ] });
  }

  // src/panel/ui/EpicView.tsx
  function EpicReady({ epic, where, paused }) {
    const store = useStoreApi();
    const gates = useStore().gates;
    const drafts = useCloseDrafts(epic);
    const refreshed = useStore().snapshot?.freshness.localRefreshedAt ?? null;
    const [unsure, setUnsure] = d2(null);
    h2(() => {
      if (unsure === null || !readSince(refreshed, unsure)) return;
      setUnsure(null);
      setFeedback({ kind: "checked", saved: false });
    }, [refreshed, unsure]);
    const [step, setStep] = d2(false);
    const [busy, setBusy] = d2(false);
    const sending = A2(false);
    const [feedback, setFeedback] = d2(null);
    const [changed2, setChanged] = d2(false);
    const root2 = A2(null);
    const opener = A2(null);
    const send = async (withText) => {
      if (sending.current || paused !== null || withText && drafts.checking) return;
      sending.current = true;
      setBusy(true);
      setFeedback(null);
      setChanged(false);
      setUnsure(null);
      if (withText) drafts.sending();
      const patch = closePatch("closed", withText ? drafts.reason : "", withText ? drafts.commentFor(epic) : "");
      const outcome = await store.update(epic.id, epic.updatedAt, patch, { status: epic.status });
      sending.current = false;
      setBusy(false);
      if (outcome.kind === "dropped") return;
      if (outcome.kind === "ok") {
        drafts.drop();
        store.notify(`Closed ${epic.title || shortId(epic.id)}.`);
        const next = where === "row" ? document.getElementById(rowDomId(epic.id))?.closest('[role="listbox"]') : document.querySelector(".bd-detail .bd-statbtn");
        next?.focus({ preventScroll: true });
        return;
      }
      if (commentWentIn(outcome)) drafts.drop("comment");
      if (outcome.kind === "uncertain" && !outcome.saved) {
        if (withText) drafts.uncertain();
        setUnsure(Date.now());
      }
      if (outcome.kind === "conflict") setChanged(true);
      else setFeedback(feedbackOf(outcome));
    };
    const leave = () => {
      setStep(false);
      requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
    };
    return /* @__PURE__ */ u3("div", { ref: root2, class: "bd-epic-ready", "data-where": where, children: [
      /* @__PURE__ */ u3("div", { class: "bd-epic-ready-row", children: [
        /* @__PURE__ */ u3("span", { class: "bd-epic-ready-t", children: [
          /* @__PURE__ */ u3("span", { class: "bd-epic-ready-mark", "aria-hidden": "true" }),
          "All children done"
        ] }),
        !step && /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3(
            "button",
            {
              type: "button",
              class: where === "detail" ? "bd-btn bd-btn-sm bd-btn-primary" : "bd-btn bd-btn-sm",
              "aria-disabled": busy || paused !== null || void 0,
              "aria-busy": busy || void 0,
              title: paused ?? void 0,
              onClick: () => void send(false),
              children: busy ? "Closing\u2026" : "Close epic"
            }
          ),
          /* @__PURE__ */ u3(
            "button",
            {
              ref: opener,
              type: "button",
              class: "bd-link bd-nreason",
              disabled: busy || paused !== null,
              title: paused ?? void 0,
              onClick: () => {
                drafts.load();
                setFeedback(null);
                setChanged(false);
                setStep(true);
              },
              children: "Add a reason"
            }
          )
        ] })
      ] }),
      step && /* @__PURE__ */ u3(
        CloseFields,
        {
          variant: "step",
          question: "Why is it closed?",
          action: "Close epic",
          reason: drafts.reason,
          comment: drafts.comment,
          setReason: drafts.setReason,
          setComment: drafts.setComment,
          busy,
          disabled: paused ?? (drafts.checking ? CHECKING_COMMENT : null),
          message: drafts.checking && /* @__PURE__ */ u3("p", { class: "bd-wmsg", "data-tone": "note", role: "status", children: CHECKING_COMMENT }),
          send: () => void send(true),
          cancel: () => {
            drafts.drop();
            leave();
          },
          onEscape: leave,
          autofocus: true
        }
      ),
      changed2 && /* @__PURE__ */ u3("p", { class: "bd-wmsg", "data-tone": "note", role: "status", children: "This epic changed since it was shown. Nothing was saved. Look it over, then close it again." }),
      feedback && /* @__PURE__ */ u3(WriteMessage, { feedback, reword: (message) => blockedMessage(message, epic, gates) })
    ] });
  }
  function Bar({ progress }) {
    const share = (n2) => `${progress.total ? n2 / progress.total * 100 : 0}%`;
    return /* @__PURE__ */ u3("span", { class: "bd-bar", "aria-hidden": "true", children: [
      /* @__PURE__ */ u3("i", { "data-look": "done", style: { width: share(progress.done) } }),
      /* @__PURE__ */ u3("i", { "data-look": "progress", style: { width: share(progress.inProgress) } }),
      /* @__PURE__ */ u3("i", { "data-look": "blocked", style: { width: share(progress.blocked) } })
    ] });
  }
  function ProgressLine({ progress, changed: changed2 }) {
    return /* @__PURE__ */ u3("div", { class: "bd-prog", children: [
      /* @__PURE__ */ u3(Bar, { progress }),
      progress.total === 0 ? /* @__PURE__ */ u3("span", { children: "Nothing in it yet" }) : /* @__PURE__ */ u3("span", { title: `${progress.done} of ${progress.total} beads in this epic done`, children: `${progress.done}/${progress.total} done` }),
      progress.blocked > 0 && /* @__PURE__ */ u3("span", { class: "bd-prog-blk", children: `${progress.blocked} blocked` }),
      changed2 > 0 && /* @__PURE__ */ u3("span", { class: "bd-prog-new", children: `${changed2} changed` })
    ] });
  }
  var headerId = (key) => `bd-h-${key}`;
  function EpicView({ groups, toggle: toggle2, box, ready, paused = null, ...events }) {
    return /* @__PURE__ */ u3(S, { children: groups.map((group) => {
      const { epic } = group;
      const rows = group.rows.map((row2) => /* @__PURE__ */ u3(Row, { row: row2, dot: true, ...events }, row2.bead.id));
      if (!epic) {
        return /* @__PURE__ */ u3("section", { class: "bd-orphans", "data-collapsed": group.collapsed || void 0, children: [
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-sect", "aria-expanded": !group.collapsed, onClick: () => toggle2(group.key), children: [
            /* @__PURE__ */ u3("span", { class: "bd-chev", children: /* @__PURE__ */ u3(IconChevron, {}) }),
            /* @__PURE__ */ u3("span", { id: headerId(group.key), children: "Not in an epic" }),
            /* @__PURE__ */ u3("span", { class: "bd-n", children: group.count }),
            group.changed > 0 && /* @__PURE__ */ u3("span", { class: "bd-ux", children: `${group.changed} changed` })
          ] }),
          rows.length > 0 && /* @__PURE__ */ u3("div", { role: "listbox", "aria-labelledby": headerId(group.key), ...box(group.key), children: rows })
        ] }, group.key);
      }
      return /* @__PURE__ */ u3("section", { class: "bd-epic", "data-collapsed": group.collapsed || void 0, children: [
        /* @__PURE__ */ u3(
          "button",
          {
            type: "button",
            class: "bd-chev bd-epic-chev",
            "aria-expanded": !group.collapsed,
            "aria-label": `${group.collapsed ? "Expand" : "Collapse"} ${epic.title}`,
            onClick: () => toggle2(group.key),
            children: /* @__PURE__ */ u3(IconChevron, {})
          }
        ),
        /* @__PURE__ */ u3("div", { role: "listbox", "aria-label": epic.title, ...box(group.key), children: [
          /* @__PURE__ */ u3(
            BeadRow,
            {
              ...events,
              variant: "epic",
              bead: epic,
              id: shortId(epic.id),
              look: group.look,
              label: epic.status,
              marker: "builtin",
              depth: 0,
              unseen: group.unseen,
              context: group.context,
              dot: false,
              below: group.progress && /* @__PURE__ */ u3(ProgressLine, { progress: group.progress, changed: group.changed })
            }
          ),
          rows
        ] }),
        ready?.has(epic.id) && /* @__PURE__ */ u3(EpicReady, { epic, where: "row", paused }, epic.id)
      ] }, group.key);
    }) });
  }

  // src/panel/ui/Detail.tsx
  function StatusPill({ status, statuses }) {
    const look = looker(statuses)(status);
    return /* @__PURE__ */ u3("span", { class: "bd-pill", "data-look": look, title: status, children: [
      /* @__PURE__ */ u3(StatusDot, { look, marker: markerOf(status) }),
      statusLabel(status, statuses)
    ] });
  }
  var peekOf = (text2) => text2.split("\n").map((l3) => l3.replace(/^\s*(?:#+|>|[-*+]|\d+[.)])\s*(?:\[[ xX]\]\s*)?/, "").replace(/[*_`~]/g, "").trim()).find(Boolean) ?? "";
  function Section({ id, title, note, peek, folded = false, action, editing = false, onToggle, children }) {
    const [isFolded, setFolded] = d2(folded);
    const open = editing || !isFolded;
    const bodyId = `bd-sec-${id}`;
    return /* @__PURE__ */ u3("section", { class: "bd-sec", "data-section": id, "data-open": open || void 0, "data-editing": editing || void 0, children: [
      /* @__PURE__ */ u3("h3", { class: "bd-sh", children: [
        /* @__PURE__ */ u3(
          "button",
          {
            type: "button",
            class: "bd-sh-tog",
            "aria-expanded": open,
            "aria-controls": bodyId,
            disabled: editing,
            onClick: () => {
              setFolded(!isFolded);
              onToggle?.(isFolded);
            },
            children: [
              /* @__PURE__ */ u3("span", { class: "bd-chev", children: /* @__PURE__ */ u3(IconChevron, {}) }),
              /* @__PURE__ */ u3("span", { class: "bd-sh-t", children: title }),
              note && /* @__PURE__ */ u3("span", { class: "bd-n", children: note }),
              !open && peek && /* @__PURE__ */ u3("span", { class: "bd-peek", children: peek })
            ]
          }
        ),
        !editing && action
      ] }),
      /* @__PURE__ */ u3("div", { id: bodyId, class: "bd-sec-body", hidden: !open, children })
    ] });
  }
  var TEXT_SECTIONS = [
    { field: "description", title: "Description", chip: "Description" },
    { field: "acceptance", title: "Acceptance criteria", chip: "Acceptance" },
    { field: "design", title: "Design", chip: "Design", folded: true },
    { field: "notes", title: "Notes", chip: "Notes", folded: true }
  ];
  var EDITABLE = ["title", ...TEXT_SECTIONS.map((s3) => s3.field)];
  function acceptanceNote(text2) {
    const boxes = acceptanceLines(text2).filter((l3) => l3.kind === "box");
    if (boxes.length > 0) return `${boxes.filter((l3) => l3.done).length}/${boxes.length}`;
    return acceptanceItems(text2)?.length.toString();
  }
  function Acceptance({ bead, paused }) {
    const store = useStoreApi();
    const text2 = bead.acceptance;
    const base = g2();
    const [sending, setSending] = d2(null);
    const [note, setNote] = d2(null);
    h2(() => setNote((n2) => n2?.kind === "feedback" && n2.feedback?.kind === "uncertain" ? null : n2), [text2]);
    const tick = async (index) => {
      if (sending || paused !== null) return;
      const next = toggleLine(text2, index);
      if (next === null) return;
      setSending({ index, text: text2 });
      setNote(null);
      const outcome = await store.update(bead.id, bead.updatedAt, { acceptance: next }, { acceptance: text2 });
      setSending(null);
      if (outcome.kind === "ok" || outcome.kind === "dropped") return;
      if (outcome.kind === "conflict") setNote({ kind: outcome.current.acceptance === text2 ? "other" : "changed" });
      else setNote({ kind: "feedback", feedback: feedbackOf(outcome) });
    };
    const pending = sending?.text === text2 ? sending.index : null;
    return /* @__PURE__ */ u3("div", { class: "bd-acwrap", children: [
      acceptanceBlocks(text2).map(
        (block, b2) => block.kind === "text" ? /* @__PURE__ */ u3(Markdown, { class: "bd-txt", text: block.text }, b2) : (
          // role="list": Safari drops a styled list's semantics without it.
          /* @__PURE__ */ u3("ul", { class: "bd-ac", role: "list", children: block.lines.map((line) => {
            if (line.kind !== "box") {
              return /* @__PURE__ */ u3("li", { "data-kind": "bullet", "data-depth": line.depth || void 0, children: [
                /* @__PURE__ */ u3("span", { class: "bd-ac-dot", "aria-hidden": "true" }),
                /* @__PURE__ */ u3(Markdown, { inline: true, text: line.text })
              ] }, line.index);
            }
            const id = `${base}-${line.index}`;
            const busy = pending === line.index;
            const done = busy ? !line.done : line.done;
            const off = sending !== null || paused !== null;
            return /* @__PURE__ */ u3("li", { "data-done": done || void 0, "data-busy": busy || void 0, "data-depth": line.depth || void 0, children: [
              /* @__PURE__ */ u3(
                "button",
                {
                  type: "button",
                  id,
                  role: "checkbox",
                  class: "bd-ac-tick",
                  "aria-checked": done,
                  "aria-labelledby": `${id}-t`,
                  "aria-disabled": off || void 0,
                  "aria-busy": busy || void 0,
                  title: paused ?? void 0,
                  onClick: () => void tick(line.index),
                  children: /* @__PURE__ */ u3("span", { class: "bd-ac-box", "aria-hidden": "true" })
                }
              ),
              /* @__PURE__ */ u3("label", { id: `${id}-t`, for: id, class: "bd-ac-text", children: /* @__PURE__ */ u3(Markdown, { inline: true, text: line.text }) })
            ] }, line.index);
          }) }, b2)
        )
      ),
      note?.kind === "feedback" ? /* @__PURE__ */ u3(WriteMessage, { feedback: note.feedback }) : note && /* @__PURE__ */ u3("p", { class: "bd-wmsg bd-ac-note", "data-tone": "note", role: "status", children: note.kind === "changed" ? "The criteria changed before your tick was saved. Nothing was saved. They show as they are now." : "Something else on this bead changed first. Nothing was saved. Tick it again to save it." })
    ] });
  }
  function NoAcceptance({ paused, onAdd }) {
    return /* @__PURE__ */ u3("div", { class: "bd-noac", children: [
      /* @__PURE__ */ u3("span", { children: "No acceptance criteria" }),
      /* @__PURE__ */ u3("button", { type: "button", class: "bd-edit", "data-edit": "acceptance", "aria-label": "Add acceptance criteria", title: paused ?? void 0, disabled: paused !== null, onClick: onAdd, children: "Add" })
    ] });
  }
  function LeaveConfirm({ onKeep, onDiscard }) {
    const box = A2(null);
    h2(() => box.current?.focus(), []);
    return /* @__PURE__ */ u3(
      "div",
      {
        ref: box,
        tabIndex: -1,
        class: "bd-confirm bd-leave",
        role: "alertdialog",
        "aria-label": "Discard your changes?",
        onKeyDown: (e3) => {
          if (e3.key === "Escape") {
            e3.preventDefault();
            e3.stopPropagation();
            onKeep();
          } else if (isConfirmKey(e3)) {
            e3.preventDefault();
            e3.stopPropagation();
            onDiscard();
          }
        },
        children: [
          /* @__PURE__ */ u3("span", { children: "Discard your changes?" }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: onKeep, children: "Keep editing" }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", "data-tone": "danger", onClick: onDiscard, children: "Discard" })
        ]
      }
    );
  }
  var Arrow = () => /* @__PURE__ */ u3(S, { children: [
    /* @__PURE__ */ u3("span", { "aria-hidden": "true", children: "\u2192" }),
    /* @__PURE__ */ u3("span", { class: "bd-vh", children: "to" }),
    " "
  ] });
  var arrowed = (text2) => text2.split(" \u2192 ").map((part, i3) => /* @__PURE__ */ u3(S, { children: [
    i3 > 0 && /* @__PURE__ */ u3(S, { children: [
      " ",
      /* @__PURE__ */ u3(Arrow, {})
    ] }),
    part
  ] }));
  function Banner({ line, onDismiss }) {
    return /* @__PURE__ */ u3("div", { class: "bd-banner", role: "status", "aria-label": "Change since you last looked", children: [
      /* @__PURE__ */ u3("span", { class: "bd-banner-txt", children: line.to !== void 0 ? /* @__PURE__ */ u3(S, { children: [
        `${line.lead}: ${line.from} `,
        /* @__PURE__ */ u3(Arrow, {}),
        /* @__PURE__ */ u3("span", { class: "bd-banner-to", "data-look": line.toLook, children: line.to })
      ] }) : line.what ? arrowed(`${line.lead}: ${line.what}`) : line.lead }),
      /* @__PURE__ */ u3("button", { type: "button", class: "bd-banner-x", "aria-label": "Dismiss", onClick: onDismiss, children: /* @__PURE__ */ u3(IconX, {}) })
    ] });
  }
  function withoutGates(related, gates, gateIds) {
    const hidden = /* @__PURE__ */ new Set([...gateIds, ...gates.map((g3) => g3.id)]);
    if (hidden.size === 0) return related;
    const deps = related.deps.filter((d3) => !hidden.has(d3.dep.to) && !hidden.has(d3.dep.from));
    return deps.length === related.deps.length ? related : { ...related, deps };
  }
  function WhyBlocked({ waits, fallback, known, open }) {
    const { items, more } = waits ? waitItems(waits) : { items: [], more: "" };
    return /* @__PURE__ */ u3("div", { class: "bd-dhint", "data-tone": "blocked", children: [
      /* @__PURE__ */ u3(IconWait, { size: 13 }),
      items.length === 0 ? /* @__PURE__ */ u3("span", { children: fallback }) : /* @__PURE__ */ u3("span", { children: [
        "Waiting on ",
        items.map(({ sep, item }) => /* @__PURE__ */ u3(S, { children: [
          sep,
          item.kind === "gate" ? item.word : /* @__PURE__ */ u3(S, { children: [
            known(item.id) ? /* @__PURE__ */ u3("button", { type: "button", class: "bd-hint-id", title: `Open ${item.title}`, onClick: () => open(item.id), children: shortId(item.id) }) : /* @__PURE__ */ u3("span", { class: "bd-hint-id", "data-plain": true, children: shortId(item.id) }),
            item.title ? ` ${item.title}` : ""
          ] })
        ] })),
        more
      ] })
    ] });
  }
  var isField = (el2) => !!el2 && (el2 instanceof HTMLElement && el2.isContentEditable ? true : !!el2.closest("input, textarea, select"));
  function Detail({ footer, composer, inert }) {
    const state = useStore();
    const store = useStoreApi();
    const now = useNow(15e3);
    const scroller = A2(null);
    const region = A2(null);
    const detail = state.detail;
    const snapshot = state.snapshot;
    const entry = detail?.stack[detail.stack.length - 1] ?? null;
    const entryId = entry?.id ?? null;
    const minute = Math.floor(now / 6e4) * 6e4;
    const beads = snapshot?.beads;
    const byId = T2(() => new Map((beads ?? []).map((b2) => [b2.id, b2])), [beads]);
    const kids = T2(() => {
      const map = /* @__PURE__ */ new Map();
      for (const b2 of beads ?? []) {
        if (!b2.parentId || b2.parentId === b2.id) continue;
        map.set(b2.parentId, [...map.get(b2.parentId) ?? [], b2]);
      }
      return map;
    }, [beads]);
    const liveRelated = T2(() => {
      const listedBead = entryId ? byId.get(entryId) : void 0;
      return listedBead && beads ? relatedFor(listedBead, beads) : null;
    }, [beads, byId, entryId]);
    const [scrolled, setScrolled] = d2(false);
    const classify = T2(
      () => classifier({ statuses: snapshot?.statuses ?? [], readyIds: snapshot?.readyIds ?? [], now: minute }),
      [snapshot?.statuses, snapshot?.readyIds, minute]
    );
    h2(() => {
      scroller.current?.scrollTo?.({ top: 0 });
      setScrolled(false);
      region.current?.focus({ preventScroll: true });
    }, [entryId, detail?.stack.length]);
    h2(() => {
      const onKey = (e3) => {
        if (e3.key !== "Escape" || e3.defaultPrevented || e3.metaKey || e3.ctrlKey || e3.altKey) return;
        if (isField(e3.target instanceof Element ? e3.target : null)) return;
        e3.preventDefault();
        store.back();
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [store]);
    const data = entry && detail?.data?.bead.id === entry.id ? detail.data : null;
    const listed = entry ? byId.get(entry.id) ?? null : null;
    const bead = newerBead(data?.bead ?? null, listed);
    const writes = useInlineWrites(bead);
    const gateKit = useGates(bead);
    const [explained, setExplained] = d2(null);
    const explainFor = bead && snapshot && bead.status === "open" && !snapshot.readyIds.includes(bead.id) && !state.unsupported.has("explain") ? `${bead.id}
${snapshot.cursor}` : null;
    h2(() => {
      if (!explainFor) return;
      const id = explainFor.split("\n")[0];
      let live = true;
      void store.readExplain(id).then((outcome) => {
        if (live && outcome.kind === "ok") setExplained({ key: explainFor, value: outcome.value });
      });
      return () => {
        live = false;
      };
    }, [explainFor]);
    const [linking, setLinking] = d2(false);
    const [replacing, setReplacing] = d2(null);
    const [historyFor, setHistoryFor] = d2(null);
    const drafted = (id) => id === null ? null : EDITABLE.find((field) => store.draft(id, field) !== null) ?? null;
    const [editing, setEditing] = d2(() => drafted(entryId));
    const [removing, setRemoving] = d2([]);
    const removingNow = A2(/* @__PURE__ */ new Set());
    const [composerRound, setComposerRound] = d2(0);
    h2(() => {
      setLinking(false);
      setReplacing(null);
      setEditing(drafted(entryId));
    }, [entryId]);
    const [dirty, setDirty] = d2({ editor: false, comment: false, dates: false });
    const [asking, setAsking] = d2(null);
    useOverlay("leave", asking !== null);
    const unsaved = dirty.editor || dirty.comment || dirty.dates;
    h2(() => {
      store.setLeaveGuard(unsaved ? (go, stay) => setAsking({ go, stay, drops: "all" }) : null);
      return () => store.setLeaveGuard(null);
    }, [unsaved, store]);
    const refocus = A2(null);
    const closeEditor = () => {
      refocus.current = editing;
      setEditing(null);
    };
    h2(() => {
      const field = refocus.current;
      refocus.current = null;
      if (editing === null && field) region.current?.querySelector(`[data-edit="${field}"]`)?.focus();
    }, [editing]);
    const edit = (field) => dirty.editor ? setAsking({ go: () => setEditing(field), drops: "editor" }) : setEditing(field);
    const discard = () => {
      if (!asking) return;
      setAsking(null);
      setDirty((d3) => asking.drops === "editor" ? { ...d3, editor: false } : { editor: false, comment: false, dates: false });
      if (entryId !== null && asking.drops === "editor" && editing) store.setDraft(entryId, editing, null);
      if (entryId !== null && asking.drops === "all") {
        store.dropDrafts(entryId);
        setEditing(null);
        setComposerRound((r3) => r3 + 1);
      }
      asking.go();
    };
    if (!detail || !entry || !snapshot) return null;
    const statuses = snapshot.statuses;
    const panel2 = snapshot.panelActor || null;
    const paused = writesPaused(snapshot);
    const back = /* @__PURE__ */ u3("button", { type: "button", class: "bd-iconbtn bd-back", "aria-label": "Back", title: "Back (Esc)", onClick: () => store.back(), children: /* @__PURE__ */ u3(IconBack, {}) });
    if (!bead) {
      return /* @__PURE__ */ u3("section", { ref: region, class: "bd-detail", "aria-label": "Bead", "aria-busy": detail.loading, tabIndex: -1, inert, children: [
        /* @__PURE__ */ u3("nav", { class: "bd-dnav", children: [
          back,
          /* @__PURE__ */ u3("span", { class: "bd-crumb", children: /* @__PURE__ */ u3("span", { class: "bd-crumb-here", children: shortId(entry.id) }) })
        ] }),
        detail.loading && /* @__PURE__ */ u3("div", { class: "bd-loadbar", "aria-hidden": "true" }),
        /* @__PURE__ */ u3("div", { class: "bd-dbody", ref: scroller, children: detail.error ? /* @__PURE__ */ u3("div", { class: "bd-derr", role: "alert", children: [
          /* @__PURE__ */ u3("span", { children: detail.error.message }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => store.reloadDetail(), children: "Try again" })
        ] }) : /* @__PURE__ */ u3("div", { class: "bd-dskel", "aria-hidden": "true", children: [
          /* @__PURE__ */ u3("i", { style: { "--w": "78%" } }),
          /* @__PURE__ */ u3("i", { style: { "--w": "40%" } }),
          /* @__PURE__ */ u3("i", { style: { "--w": "92%" } }),
          /* @__PURE__ */ u3("i", { style: { "--w": "86%" } }),
          /* @__PURE__ */ u3("i", { style: { "--w": "60%" } })
        ] }) })
      ] });
    }
    const related = withoutGates(liveRelated ?? data?.related ?? relatedFor(bead, snapshot.beads), state.gates, snapshot.gateIds);
    const epic = bead.type === "epic" ? null : nearestEpic(bead, byId);
    const root2 = bead.type === "epic" ? bead : epic;
    const c3 = classify(bead);
    const reason = closeReason(bead, snapshot.activity, statuses);
    const closed = closedAt2(bead, snapshot.activity, statuses);
    const extra = moreFields(bead.extra, now).filter((f5) => f5.key !== "due_at" && f5.key !== "defer_until");
    const gone = data !== null && !listed;
    const sub = (id) => {
      const list = kids.get(id);
      return list?.length ? { done: list.filter((k3) => classify(k3).look === "done").length, total: list.length } : null;
    };
    const blockers = related.deps.filter((d3) => d3.direction === "out" && d3.dep.kind === "blocks").map((d3) => byId.get(d3.dep.to) ?? d3.other).filter((b2) => b2 !== null && classify(b2).look !== "done");
    const explain = explainFor !== null && explained?.key === explainFor ? explained.value : null;
    const waits = waitsOf(bead, explain, state.gates, snapshot.gateIds, blockers);
    const waiting2 = bead.status === "open" && (c3.bucket === "blocked" || waits !== null);
    const reword = (message) => blockedMessage(message, bead, state.gates, waits?.beads ?? []);
    const missing = TEXT_SECTIONS.filter((s3) => s3.field !== "acceptance" && !bead[s3.field].trim() && editing !== s3.field);
    const hasRelations = !!(related.parent || bead.parentId || related.children.length > 0 || related.deps.length > 0);
    const ready = bead.type === "epic" && eligibleEpics(snapshot.beads, statuses, state.gates).some((e3) => e3.id === bead.id);
    const deferUntil = bead.status === "open" && c3.bucket === "deferred" && typeof bead.extra.defer_until === "string" ? bead.extra.defer_until : null;
    return /* @__PURE__ */ u3(
      "section",
      {
        ref: region,
        class: "bd-detail",
        "aria-label": bead.title || bead.id,
        "aria-busy": detail.loading,
        tabIndex: -1,
        inert,
        onKeyDownCapture: (e3) => {
          if (!asking || !isConfirmKey(e3)) return;
          e3.preventDefault();
          e3.stopPropagation();
          discard();
        },
        children: [
          /* @__PURE__ */ u3("nav", { class: "bd-dnav", "data-scrolled": scrolled || void 0, children: [
            back,
            /* @__PURE__ */ u3("span", { class: "bd-crumb", children: [
              epic && /* @__PURE__ */ u3(S, { children: [
                /* @__PURE__ */ u3("button", { type: "button", class: "bd-crumb-epic", title: `Open ${epic.title}`, onClick: () => store.openRelated(epic.id), children: [
                  /* @__PURE__ */ u3(IconEpic, { size: 12 }),
                  /* @__PURE__ */ u3("span", { children: epic.title })
                ] }),
                /* @__PURE__ */ u3("span", { class: "bd-crumb-sep", "aria-hidden": "true", children: "\u203A" })
              ] }),
              /* @__PURE__ */ u3("span", { class: "bd-crumb-here", children: epic ? childId(bead.id, epic.id) : shortId(bead.id) })
            ] }),
            /* @__PURE__ */ u3("span", { class: "bd-dacts", children: [
              /* @__PURE__ */ u3(NewBeadButton, {}),
              /* @__PURE__ */ u3(StatusMenu, { bead, writes, disabled: paused, statuses }),
              /* @__PURE__ */ u3(BeadMenu, { kit: gateKit, disabled: paused, done: c3.look === "done", replace: state.unsupported.has("supersede") ? void 0 : setReplacing })
            ] })
          ] }),
          detail.loading && /* @__PURE__ */ u3("div", { class: "bd-loadbar", "aria-hidden": "true" }),
          asking && /* @__PURE__ */ u3(
            LeaveConfirm,
            {
              onKeep: () => {
                setAsking(null);
                asking.stay?.();
              },
              onDiscard: discard
            }
          ),
          /* @__PURE__ */ u3("div", { class: "bd-dbody", ref: scroller, onScroll: (e3) => setScrolled(e3.currentTarget.scrollTop > 2), children: [
            detail.error && /* @__PURE__ */ u3("div", { class: "bd-derr", role: "alert", children: [
              /* @__PURE__ */ u3("span", { children: detail.error.message }),
              detail.error.detail && /* @__PURE__ */ u3("button", { type: "button", class: "bd-link", onClick: () => store.copyDetails(detail.error), children: "Copy details" }),
              /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => store.reloadDetail(), children: "Try again" })
            ] }),
            gone && /* @__PURE__ */ u3("div", { class: "bd-derr", "data-tone": "note", role: "note", children: "This bead is no longer in the project. This is the last copy read." }),
            paused && /* @__PURE__ */ u3(PausedNote, { reason: paused }),
            /* @__PURE__ */ u3("header", { class: "bd-dhead", children: [
              editing === "title" ? /* @__PURE__ */ u3("div", { class: "bd-dtitle", "data-editing": true, children: [
                /* @__PURE__ */ u3("span", { class: "bd-ty", "data-type": bead.type, title: bead.type, children: /* @__PURE__ */ u3(TypeIcon, { type: bead.type, size: 16 }) }),
                /* @__PURE__ */ u3(TextEditor, { bead, field: "title", label: "Title", disabled: paused, onClose: () => closeEditor(), onDirty: (d3) => setDirty((x4) => ({ ...x4, editor: d3 })) })
              ] }) : /* @__PURE__ */ u3("h2", { class: "bd-dtitle", children: [
                /* @__PURE__ */ u3("span", { class: "bd-ty", "data-type": bead.type, title: bead.type, children: /* @__PURE__ */ u3(TypeIcon, { type: bead.type, size: 16 }) }),
                /* @__PURE__ */ u3("span", { children: bead.title || bead.id }),
                /* @__PURE__ */ u3("button", { type: "button", class: "bd-edit bd-edit-title", "data-edit": "title", "aria-label": "Edit title", title: paused ?? "Edit title", disabled: paused !== null, onClick: () => edit("title"), children: /* @__PURE__ */ u3(IconEdit, { size: 13 }) })
              ] }),
              /* @__PURE__ */ u3("div", { class: "bd-didrow", children: [
                /* @__PURE__ */ u3("button", { type: "button", class: "bd-did", title: "Copy ID", onClick: () => store.copyText(bead.id), children: [
                  /* @__PURE__ */ u3("span", { children: bead.id }),
                  /* @__PURE__ */ u3(IconCopy, { size: 11 })
                ] }),
                /* @__PURE__ */ u3(TypeMenu, { bead, writes, disabled: paused, types: snapshot.types }),
                /* @__PURE__ */ u3(ParentMenu, { bead, writes, disabled: paused, beads: snapshot.beads, byId, statuses })
              ] }),
              /* @__PURE__ */ u3("div", { class: "bd-dmeta", children: [
                /* @__PURE__ */ u3(StatusPill, { status: bead.status, statuses }),
                /* @__PURE__ */ u3(PriorityMenu, { bead, writes, disabled: paused }),
                /* @__PURE__ */ u3(AssigneePicker, { bead, writes, disabled: paused, beads: snapshot.beads, panelActor: snapshot.panelActor }),
                bead.labels.map((label) => /* @__PURE__ */ u3("span", { class: "bd-lb", children: label }, label)),
                /* @__PURE__ */ u3(LabelsEditor, { bead, writes, disabled: paused, beads: snapshot.beads })
              ] }),
              /* @__PURE__ */ u3(InlineNotice, { writes, statuses, paused, reword, titleOf: (id) => byId.get(id)?.title || shortId(id) }),
              waiting2 ? /* @__PURE__ */ u3(WhyBlocked, { waits, fallback: whyLine(bead, explain, state.gates, now, void 0, snapshot.gateIds) ?? c3.label, known: (id) => byId.has(id), open: (id) => store.openRelated(id) }) : bead.status === "open" && explain?.state === "ready" && /* @__PURE__ */ u3("div", { class: "bd-dhint", children: /* @__PURE__ */ u3("span", { children: "Ready to start" }) }),
              deferUntil && /* @__PURE__ */ u3("div", { class: "bd-dhint", children: [
                /* @__PURE__ */ u3(IconClock, { size: 13 }),
                /* @__PURE__ */ u3("span", { children: `Deferred until ${when(deferUntil, now)}` })
              ] }),
              ready && /* @__PURE__ */ u3(EpicReady, { epic: bead, where: "detail", paused }, bead.id)
            ] }),
            entry.change && /* @__PURE__ */ u3(Banner, { line: changeLine(entry.change, statuses, now), onDismiss: () => store.dismissChange() }),
            replacing && /* @__PURE__ */ u3("div", { class: "bd-gates-wrap", children: /* @__PURE__ */ u3(
              ReplaceStep,
              {
                kind: replacing,
                bead,
                beads: snapshot.beads,
                statuses,
                disabled: paused,
                reword,
                onClose: (closed2) => {
                  setReplacing(null);
                  (closed2 ? region.current?.querySelector(".bd-statbtn") : document.getElementById(BEAD_MENU_ID))?.focus({ preventScroll: true });
                }
              },
              `${bead.id}:${replacing}`
            ) }),
            /* @__PURE__ */ u3(WaitingOn, { kit: gateKit, now, panel: panel2, paused }),
            TEXT_SECTIONS.map(({ field, title, folded }) => {
              const text2 = bead[field];
              if (field === "acceptance" && !text2.trim() && editing !== field) return /* @__PURE__ */ u3(NoAcceptance, { paused, onAdd: () => edit(field) }, `${bead.id}:noac`);
              if (!text2.trim() && editing !== field) return null;
              return /* @__PURE__ */ u3(
                Section,
                {
                  id: field,
                  title,
                  folded,
                  peek: folded ? peekOf(text2) : void 0,
                  note: field === "acceptance" ? acceptanceNote(text2) : void 0,
                  editing: editing === field,
                  action: /* @__PURE__ */ u3(S, { children: [
                    field === "design" && c3.look !== "done" && /* @__PURE__ */ u3(PlanAsk, { kit: gateKit, disabled: paused }),
                    /* @__PURE__ */ u3("button", { type: "button", class: "bd-edit", "data-edit": field, "aria-label": `Edit ${title.toLowerCase()}`, title: paused ?? void 0, disabled: paused !== null, onClick: () => edit(field), children: "Edit" })
                  ] }),
                  children: editing === field ? /* @__PURE__ */ u3(TextEditor, { bead, field, label: title, disabled: paused, onClose: () => closeEditor(), onDirty: (d3) => setDirty((x4) => ({ ...x4, editor: d3 })) }) : field === "acceptance" ? /* @__PURE__ */ u3(Acceptance, { bead, paused }) : /* @__PURE__ */ u3(Markdown, { class: "bd-txt", text: text2 })
                },
                `${bead.id}:${field}`
              );
            }),
            (missing.length > 0 || !hasRelations && !linking) && /* @__PURE__ */ u3("div", { class: "bd-addrow", children: [
              /* @__PURE__ */ u3("span", { class: "bd-addrow-lab", children: "Add" }),
              missing.map((s3) => /* @__PURE__ */ u3("button", { type: "button", class: "bd-addchip", "data-edit": s3.field, "aria-label": `Add ${s3.title.toLowerCase()}`, disabled: paused !== null, title: paused ?? void 0, onClick: () => edit(s3.field), children: s3.chip }, s3.field)),
              !hasRelations && !linking && /* @__PURE__ */ u3("button", { type: "button", class: "bd-addchip", "aria-label": "Add link", disabled: paused !== null, title: paused ?? void 0, onClick: () => setLinking(true), children: "Link" })
            ] }),
            (hasRelations || linking) && /* @__PURE__ */ u3(Section, { id: "relationships", title: "Relationships", children: /* @__PURE__ */ u3(
              Relationships,
              {
                related,
                parentId: bead.parentId,
                root: root2,
                current: (id) => byId.get(id) ?? null,
                classify,
                sub,
                panel: panel2,
                open: (id) => store.openRelated(id),
                remove: async (d3) => {
                  const key = `${d3.from}>${d3.to}`;
                  if (removingNow.current.has(key)) return;
                  removingNow.current.add(key);
                  setRemoving((r3) => [...r3, key]);
                  const outcome = await store.link({ op: "remove", from: d3.from, to: d3.to });
                  removingNow.current.delete(key);
                  setRemoving((r3) => r3.filter((k3) => k3 !== key));
                  writes.report(outcome);
                },
                removing,
                disabled: paused,
                footer: linking ? /* @__PURE__ */ u3(LinkAdder, { bead, beads: snapshot.beads, statuses, disabled: paused, onDone: () => setLinking(false) }) : /* @__PURE__ */ u3("button", { type: "button", class: "bd-addlink", "aria-label": "Add link", disabled: paused !== null, title: paused ?? void 0, onClick: () => setLinking(true), children: [
                  /* @__PURE__ */ u3("span", { "aria-hidden": "true", children: "+" }),
                  " Add link"
                ] })
              }
            ) }, `${bead.id}:relationships`),
            /* @__PURE__ */ u3(Section, { id: "more", title: "More", note: Object.keys(bead.extra).length > 0 ? String(Object.keys(bead.extra).length) : void 0, children: [
              /* @__PURE__ */ u3(
                DateFields,
                {
                  bead,
                  disabled: paused,
                  done: c3.look === "done",
                  now,
                  canDefer: !state.unsupported.has("defer"),
                  reword,
                  onDirty: (d3) => setDirty((x4) => x4.dates === d3 ? x4 : { ...x4, dates: d3 })
                },
                `${bead.id}:${composerRound}`
              ),
              extra.length > 0 && /* @__PURE__ */ u3("dl", { class: "bd-more", children: extra.map((f5) => /* @__PURE__ */ u3("div", { class: "bd-more-row", "data-sub": f5.sub || void 0, "data-group": f5.group || void 0, children: [
                /* @__PURE__ */ u3("dt", { title: f5.key, children: f5.label }),
                /* @__PURE__ */ u3("dd", { title: f5.title, children: f5.code ? /* @__PURE__ */ u3("code", { children: f5.value }) : f5.value })
              ] }, f5.key)) })
            ] }, `${bead.id}:more`),
            /* @__PURE__ */ u3(Section, { id: "activity", title: "Activity", note: bead.comments.length === 1 ? "1 comment" : `${bead.comments.length} comments`, children: [
              /* @__PURE__ */ u3(Comments, { comments: bead.comments, panel: panel2, now, composer: composer ?? /* @__PURE__ */ u3(CommentComposer, { bead, disabled: paused, onDirty: (d3) => setDirty((x4) => ({ ...x4, comment: d3 })) }, `${bead.id}:${composerRound}`) }),
              /* @__PURE__ */ u3("p", { class: "bd-stamp", children: [
                /* @__PURE__ */ u3("span", { children: [
                  /* @__PURE__ */ u3("b", { children: "Created" }),
                  " ",
                  `${when(bead.createdAt, now)} by ${personName(bead.createdBy, panel2)}`
                ] }),
                /* @__PURE__ */ u3("span", { class: "bd-sep", "aria-hidden": "true", children: " \xB7 " }),
                /* @__PURE__ */ u3("span", { children: [
                  /* @__PURE__ */ u3("b", { children: "Updated" }),
                  " ",
                  when(bead.updatedAt, now)
                ] }),
                closed && /* @__PURE__ */ u3("span", { class: "bd-stamp-line", children: [
                  /* @__PURE__ */ u3("b", { children: "Closed" }),
                  " ",
                  closed.historical ? recordedDay(closed.at, now) : when(closed.at, now)
                ] }),
                reason && /* @__PURE__ */ u3("span", { class: "bd-stamp-line", children: [
                  /* @__PURE__ */ u3("b", { children: "Reason" }),
                  " ",
                  reason
                ] })
              ] })
            ] }, `${bead.id}:activity`),
            !state.unsupported.has("history") && /* @__PURE__ */ u3(Section, { id: "history", title: "History", folded: historyFor !== bead.id, onToggle: (open) => setHistoryFor(open ? bead.id : null), children: /* @__PURE__ */ u3(History, { bead, open: historyFor === bead.id, statuses, panel: panel2, paused, now, reword }, bead.id) }, `${bead.id}:history`)
          ] }),
          footer
        ]
      }
    );
  }

  // src/panel/ui/StatusView.tsx
  function StatusView({ sections, toggle: toggle2, expand, box, ...events }) {
    return /* @__PURE__ */ u3(S, { children: sections.map((s3) => /* @__PURE__ */ u3("section", { class: "bd-grp", "data-collapsed": s3.collapsed || void 0, children: [
      /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: "bd-grp-h",
          "aria-expanded": !s3.collapsed,
          title: s3.status ?? void 0,
          onClick: () => toggle2(s3.key),
          children: [
            /* @__PURE__ */ u3("span", { class: "bd-chev", children: /* @__PURE__ */ u3(IconChevron, {}) }),
            /* @__PURE__ */ u3(StatusDot, { look: s3.look, marker: s3.marker }),
            /* @__PURE__ */ u3("span", { class: "bd-grp-title", id: headerId(s3.key), children: s3.title }),
            /* @__PURE__ */ u3("span", { class: "bd-n", children: s3.count }),
            s3.changed > 0 && /* @__PURE__ */ u3("span", { class: "bd-ux", children: `${s3.changed} changed` })
          ]
        }
      ),
      s3.rows.length > 0 && /* @__PURE__ */ u3("div", { role: "listbox", "aria-labelledby": headerId(s3.key), ...box(s3.key), children: s3.rows.map((row2) => /* @__PURE__ */ u3(Row, { row: { ...row2, depth: 1 }, dot: false, ...events }, row2.bead.id)) }),
      s3.more > 0 && /* @__PURE__ */ u3("button", { type: "button", class: "bd-morerows", onClick: () => expand(s3.key), children: `Show ${s3.more} more` })
    ] }, s3.key)) });
  }

  // src/panel/ui/List.tsx
  var SEARCH = ".bd-search input";
  function focusOf(target) {
    if (!(target instanceof HTMLElement)) return "list";
    if (target.matches(SEARCH)) return "search";
    if (target.isContentEditable || target.closest("input, textarea, select")) return "field";
    if (target.closest('button, a, [role="menuitem"], [data-refused]')) return "control";
    return "list";
  }
  function List() {
    const state = useStore();
    const store = useStoreApi();
    const now = useNow(5e3);
    const [cursor, setCursor] = d2(null);
    const [menu, setMenu] = d2(null);
    const [expanded, setExpanded] = d2([]);
    const scrollTo = A2(false);
    const actions = useRowActions();
    const snapshot = state.snapshot;
    const minute = Math.floor(now / 6e4) * 6e4;
    const { beads, statuses, readyIds, unseenIds } = snapshot ?? {};
    const model = T2(() => {
      if (!beads || !statuses || !readyIds || !unseenIds) return null;
      const input = { beads, statuses, readyIds, unseenIds, filters: state.filters, query: state.query, collapsed: state.collapsed, expanded, now: minute };
      if (state.view === "status") {
        const sections = statusView(input);
        return { kind: "status", sections, keyed: sections.map((s3) => ({ key: s3.key, ids: rowOrder([s3]) })), ids: rowOrder(sections), input };
      }
      const groups = epicView(input);
      return { kind: "epic", groups, keyed: groups.map((g3) => ({ key: g3.key, ids: rowOrder([g3]) })), ids: rowOrder(groups), input };
    }, [beads, statuses, readyIds, unseenIds, state.filters, state.query, state.collapsed, state.view, expanded, minute]);
    const gates = state.gates;
    const ready = T2(() => new Set(beads && statuses ? eligibleEpics(beads, statuses, gates).map((b2) => b2.id) : []), [beads, statuses, gates]);
    const shown = cursor !== null && (model?.ids.includes(cursor) ?? false) ? cursor : null;
    h2(() => {
      store.setListCursor(shown);
      return () => store.setListCursor(null);
    }, [shown, store]);
    const holder = model?.keyed.find((k3) => shown !== null && k3.ids.includes(shown))?.key ?? model?.keyed.find((k3) => k3.ids.length > 0)?.key;
    const live = A2({ ids: [], cursor: shown, menu, state });
    live.current = { ids: model?.ids ?? [], cursor: shown, menu, state };
    const focusRow = () => {
      const at2 = live.current.cursor;
      const row2 = at2 ? document.getElementById(rowDomId(at2)) : null;
      row2?.closest('[role="listbox"]')?.focus();
    };
    const closeMenu = q2((why) => {
      setMenu(null);
      if (why !== "outside") queueMicrotask(focusRow);
    }, []);
    h2(() => {
      const onKey = (e3) => {
        const { ids, cursor: at2, menu: open, state: s3 } = live.current;
        if (s3.detail || s3.page !== "list" || s3.overlays.length > 0 || open || e3.defaultPrevented || e3.metaKey || e3.ctrlKey || e3.altKey) return;
        const key = e3.key === "F10" && e3.shiftKey ? "ContextMenu" : e3.key;
        const focus2 = focusOf(e3.target);
        const action = listKey({ key, ids, cursor: at2, focus: focus2 });
        if (!action) return;
        e3.preventDefault();
        switch (action.type) {
          case "move":
            scrollTo.current = true;
            setCursor(action.id);
            break;
          case "open":
            setCursor(action.id);
            store.select(action.id);
            break;
          case "menu": {
            const row2 = document.getElementById(rowDomId(action.id));
            if (row2) setMenu(menuFor(action.id, row2, row2.querySelector(".bd-rowmore") ?? row2));
            break;
          }
          case "search":
            document.querySelector(SEARCH)?.focus();
            break;
          case "escape":
            if (focus2 === "search") {
              if (s3.query) store.setQuery("");
              else e3.target.blur();
            } else if (s3.selectedId !== null) store.select(null);
            else setCursor(null);
            break;
        }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [store]);
    h2(() => {
      if (shown === null) return;
      const row2 = document.getElementById(rowDomId(shown));
      const box2 = row2?.closest('[role="listbox"]');
      const active2 = document.activeElement;
      if (box2 && active2 instanceof HTMLElement && active2 !== box2 && active2.matches('.bd-list [role="listbox"]')) box2.focus({ preventScroll: true });
      if (!scrollTo.current) return;
      scrollTo.current = false;
      row2?.scrollIntoView?.({ block: "nearest" });
    }, [shown, holder]);
    if (!snapshot || !model) return null;
    if (snapshot.beads.length === 0) return /* @__PURE__ */ u3(NoBeads, {});
    const events = {
      cursor: shown,
      selectedId: state.selectedId,
      now: minute,
      pick: (id) => {
        setCursor(id);
        store.select(id);
      },
      menu: (at2) => {
        setCursor(at2.id);
        setMenu(at2);
      }
    };
    const box = (key) => key === holder ? { tabIndex: 0, ...shown ? { "aria-activedescendant": rowDomId(shown) } : {} } : { tabIndex: -1 };
    const stale = describeFreshness(state, now)?.stale ?? false;
    if (model.kind === "epic" ? model.groups.length === 0 : model.sections.length === 0) {
      const filtered = filtersActive(state.filters);
      if (state.query && state.filters.status === "open" && matchesWithAll(model.input)) {
        return /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: "Only older closed beads match.", body: "They closed more than 7 days ago.", children: /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn", onClick: () => store.setFilters({ ...state.filters, status: "all" }), children: "Show all" }) });
      }
      return /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: "No beads match.", body: state.query ? "Nothing has that id or title." : "Nothing fits these filters.", children: [
        state.query && /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn", onClick: () => store.setQuery(""), children: "Clear search" }),
        filtered && /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn", onClick: () => store.setFilters(DEFAULT_FILTERS), children: "Reset filters" })
      ] });
    }
    return /* @__PURE__ */ u3("div", { class: "bd-list", role: "group", "aria-label": model.kind === "epic" ? "Beads by epic" : "Beads by status", "data-stale": stale || void 0, "data-view": model.kind, children: [
      model.kind === "epic" ? /* @__PURE__ */ u3(EpicView, { groups: model.groups, toggle: (key) => store.toggleCollapsed(key), box, ready, paused: writesPaused(snapshot), ...events }) : /* @__PURE__ */ u3(StatusView, { sections: model.sections, toggle: (key) => store.toggleCollapsed(key), expand: (key) => setExpanded((list) => [...list, key]), box, ...events }),
      menu && /* @__PURE__ */ u3(RowMenu, { at: menu, actions, onClose: closeMenu })
    ] });
  }

  // src/panel/activity.ts
  var EXCERPT_MAX = 56;
  function excerpt(text2) {
    const line = text2.replace(/\s+/g, " ").trim();
    if (line.length <= EXCERPT_MAX) return line;
    const cut = line.slice(0, EXCERPT_MAX);
    const space = cut.lastIndexOf(" ");
    return `${(space > EXCERPT_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}\u2026`;
  }
  var listWords = (items) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  var TEXT_FIELDS = { description: "Description", design: "Design", acceptance: "Acceptance criteria", notes: "Notes" };
  var isText = (v5) => typeof v5 === "string";
  var strings = (v5) => Array.isArray(v5) && v5.every(isText) ? v5 : null;
  var priorityWord = (v5) => typeof v5 === "number" ? `P${v5}` : "none";
  function fieldWhat(e3, statuses) {
    const { field = "", from, to } = e3;
    const text2 = TEXT_FIELDS[field];
    if (text2) {
      if (to === "") return `${text2} cleared`;
      return isText(to) && to.trim() ? `${text2} edited: ${excerpt(to)}` : `${text2} edited`;
    }
    switch (field) {
      case "status": {
        if (!isText(to)) return "Status changed";
        const label = (s3) => statusLabel(s3, statuses);
        return isText(from) && from ? `Status: ${label(from)} \u2192 ${label(to)}` : `Status: ${label(to)}`;
      }
      case "priority":
        if (to === void 0) return "Priority changed";
        return typeof from === "number" ? `Priority: ${priorityWord(from)} \u2192 ${priorityWord(to)}` : `Priority: ${priorityWord(to)}`;
      case "title":
        return "Title changed";
      case "assignee":
        if (to === void 0) return "Assignee changed";
        return isText(to) && to ? `Assigned to ${to}` : "Unassigned";
      case "labels": {
        const before = strings(from);
        const after = strings(to);
        if (!before || !after) return "Labels changed";
        const added = after.filter((l3) => !before.includes(l3));
        const removed = before.filter((l3) => !after.includes(l3));
        const parts2 = [added.length ? `added ${listWords(added)}` : "", removed.length ? `removed ${listWords(removed)}` : ""].filter(Boolean);
        return parts2.length ? `Labels: ${parts2.join(", ")}` : "Labels changed";
      }
      case "type":
        if (!isText(to)) return "Type changed";
        return isText(from) && from ? `Type: ${humanize(from)} \u2192 ${humanize(to)}` : `Type: ${humanize(to)}`;
      case "parentId":
        if (isText(to) && to) return `Moved under ${shortId(to)}`;
        return to === void 0 ? "Parent changed" : "Removed from its parent";
      case "closeReason":
        if (isText(to) && to.trim()) return `Close reason: ${excerpt(to)}`;
        return to === void 0 ? "Close reason changed" : "Close reason cleared";
      case "":
        return "Changed";
      default:
        return `${humanize(field)} changed`;
    }
  }
  function linkWords(kind) {
    if (kind === "related" || kind === "relates-to") return "related to";
    return isKnownLinkKind(kind) ? kindLabel(kind, "out").toLowerCase() : kind;
  }
  function changeWhat(e3, statuses) {
    switch (e3.kind) {
      case "created":
        return "Created";
      case "deleted":
        return "Deleted";
      case "reopened":
        return "Reopened";
      case "closed": {
        const as = isText(e3.to) && e3.to && e3.to !== "closed" ? ` as ${statusLabel(e3.to, statuses)}` : "";
        return `Closed${as}${e3.reason ? ` \xB7 ${excerpt(e3.reason)}` : ""}`;
      }
      case "comment":
        return isText(e3.to) && e3.to.trim() ? `Commented: ${excerpt(e3.to)}` : "Commented";
      case "dep_added":
      case "dep_removed": {
        const other = e3.kind === "dep_added" ? e3.to : e3.from;
        const id = isText(other) && other ? shortId(other) : "";
        const head = e3.kind === "dep_added" ? "Link added" : "Link removed";
        const words = e3.field ? linkWords(e3.field) : "";
        return `${head}: ${[words, id].filter(Boolean).join(" ") || "unknown link"}`;
      }
      case "field":
        return fieldWhat(e3, statuses);
      case "gate_opened":
      case "gate_resolved": {
        const { head, by } = gateEventWords(gateEventOf(e3));
        return by ? `${head} by ${by}` : head;
      }
    }
    return humanize(String(e3.kind));
  }
  var ROW_RESTORABLE = /* @__PURE__ */ new Set(["title", "status", "priority", "assignee", "labels"]);
  var ROW_TEXT_MAX = 2e3;
  var whole = (v5) => v5 !== void 0 && !(typeof v5 === "string" && v5.length > ROW_TEXT_MAX);
  function rowChange(e3) {
    if (e3.kind !== "field" || !e3.field || !ROW_RESTORABLE.has(e3.field)) return null;
    if (!whole(e3.from) || !whole(e3.to)) return null;
    if (e3.field === "labels" && (strings(e3.from) === null || strings(e3.to) === null)) return null;
    return { field: e3.field, from: e3.from, to: e3.to, text: false };
  }
  var whoOf = (e3) => e3.byPanel ? "you (panel)" : e3.actor ?? "unknown";
  var atOf = (e3) => e3.changedAt ?? e3.observedAt;
  function whenOf(e3, now) {
    const at2 = atOf(e3);
    if (e3.historical) return recordedDay(at2, now);
    const t3 = Date.parse(at2);
    return Number.isFinite(t3) ? ago(now - t3) : at2;
  }
  function whenTitle(e3) {
    const at2 = atOf(e3);
    if (e3.historical && isDateOnly(at2)) return "From Beads' history. Only the day is known.";
    const date = recordedDate(at2);
    if (!date) return at2;
    const full = fullText(date);
    return e3.changedAt || e3.historical ? full : `${full}, when the panel saw it`;
  }
  function markOf(e3, look) {
    switch (e3.kind) {
      case "created":
      case "deleted":
      case "comment":
        return { kind: e3.kind };
      case "dep_added":
      case "dep_removed":
        return { kind: "link" };
      case "gate_opened":
      case "gate_resolved":
        return { kind: "gate" };
      case "closed":
        return { kind: "status", look: "done", marker: isText(e3.to) ? markerOf(e3.to) : "builtin" };
      case "reopened":
        return isText(e3.to) ? { kind: "status", look: look(e3.to), marker: markerOf(e3.to) } : { kind: "status", look: "open", marker: "builtin" };
      default:
        return e3.field === "status" && isText(e3.to) ? { kind: "status", look: look(e3.to), marker: markerOf(e3.to) } : { kind: "edit" };
    }
  }
  var pad = (n2) => String(n2).padStart(2, "0");
  var localKey = (d3) => `${d3.getFullYear()}-${pad(d3.getMonth() + 1)}-${pad(d3.getDate())}`;
  function dayOf(e3) {
    const date = recordedDate(atOf(e3));
    return date ? { key: localKey(date), date } : null;
  }
  function dayLabel(key, date, now) {
    const today = new Date(now);
    if (key === localKey(today)) return "Today";
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (key === localKey(yesterday)) return "Yesterday";
    return dayText(date, now);
  }
  var valueText2 = (v5) => v5 === void 0 || v5 === null ? "" : typeof v5 === "object" ? JSON.stringify(v5) : String(v5);
  function searchText({ event, title, who, what }) {
    return [event.beadId, title ?? "", who, event.actor ?? "", what, event.field ?? "", valueText2(event.from), valueText2(event.to), event.reason ?? "", event.title ?? ""].join("\n").toLowerCase();
  }
  function activityFeed({ activity, beads, statuses, query, now }) {
    const byId = new Map(beads.map((b2) => [b2.id, b2]));
    const deletedTitles = /* @__PURE__ */ new Map();
    for (const e3 of activity) if (e3.kind === "deleted" && typeof e3.title === "string" && !deletedTitles.has(e3.beadId)) deletedTitles.set(e3.beadId, e3.title);
    const look = looker(statuses);
    const q4 = query.trim().toLowerCase();
    const days = [];
    const timed = activity.map((event) => ({ event, at: recordedDate(atOf(event))?.getTime() ?? -Infinity }));
    timed.sort((a5, b2) => a5.at === b2.at ? 0 : b2.at - a5.at);
    for (const { event } of timed) {
      const bead = byId.get(event.beadId);
      const entry = {
        event,
        what: changeWhat(event, statuses),
        mark: markOf(event, look),
        short: shortId(event.beadId),
        title: bead ? bead.title : deletedTitles.get(event.beadId) ?? null,
        gone: !bead,
        who: whoOf(event),
        whenTitle: whenTitle(event)
      };
      if (q4 && !searchText(entry).includes(q4)) continue;
      const day = dayOf(event);
      const key = day?.key ?? "unknown";
      const last = days[days.length - 1];
      if (last && last.key === key) last.entries.push(entry);
      else days.push({ key, label: day ? dayLabel(key, day.date, now) : "Unknown day", entries: [entry] });
    }
    return days;
  }

  // src/panel/ui/ActivityView.tsx
  var entryDomId = (eventId) => `bd-act-${eventId}`;
  function Mark({ mark }) {
    if (mark.kind === "status") return /* @__PURE__ */ u3(StatusDot, { look: mark.look, marker: mark.marker });
    const Icon2 = { created: IconPlus, deleted: IconTrash, comment: IconChat, link: IconLink, edit: IconEdit, gate: IconWait }[mark.kind];
    return /* @__PURE__ */ u3("span", { class: "bd-act-ic", "data-kind": mark.kind, children: /* @__PURE__ */ u3(Icon2, { size: 13 }) });
  }
  function Entry2({ entry, now, cursor, selected, pick, menu }) {
    const { event } = entry;
    return /* @__PURE__ */ u3(
      "div",
      {
        role: "option",
        id: entryDomId(event.id),
        class: "bd-row bd-act-row",
        "aria-selected": selected,
        "aria-disabled": entry.gone || void 0,
        "data-selected": selected || void 0,
        "data-cursor": cursor || void 0,
        "data-unseen": event.unseen || void 0,
        "data-gone": entry.gone || void 0,
        "data-kind": event.kind,
        onClick: () => pick(entry),
        onContextMenu: (e3) => {
          if (entry.gone) return;
          e3.preventDefault();
          menu(entry, { ...menuFor(event.beadId, e3.currentTarget), x: e3.clientX });
        },
        children: [
          /* @__PURE__ */ u3("span", { class: "bd-act-mark", children: /* @__PURE__ */ u3(Mark, { mark: entry.mark }) }),
          /* @__PURE__ */ u3("span", { class: "bd-act-what", title: entry.what, children: entry.what }),
          /* @__PURE__ */ u3("time", { class: "bd-act-when", dateTime: event.changedAt ?? event.observedAt, title: entry.whenTitle, children: whenOf(event, now) }),
          /* @__PURE__ */ u3("span", { class: "bd-act-bead", children: [
            /* @__PURE__ */ u3("span", { class: "bd-id", title: event.beadId, children: entry.short }),
            entry.title !== null ? /* @__PURE__ */ u3("span", { class: "bd-title", children: entry.title }) : entry.gone && /* @__PURE__ */ u3("span", { class: "bd-act-notitle", children: "(title not recorded)" }),
            entry.gone && event.kind !== "deleted" && /* @__PURE__ */ u3("span", { class: "bd-act-gone", children: "deleted" })
          ] }),
          /* @__PURE__ */ u3("span", { class: "bd-act-who", title: entry.who, children: entry.who }),
          !entry.gone && /* @__PURE__ */ u3(
            "button",
            {
              type: "button",
              class: "bd-rowmore",
              "aria-label": "More actions",
              tabIndex: -1,
              onClick: (e3) => {
                e3.stopPropagation();
                const button2 = e3.currentTarget;
                menu(entry, menuFor(event.beadId, button2.closest(".bd-row") ?? button2, button2));
              },
              children: /* @__PURE__ */ u3(IconMore, {})
            }
          )
        ]
      }
    );
  }
  function SeenBar({ total, unseen, beadsUnseen }) {
    const store = useStoreApi();
    const [busy, setBusy] = d2(false);
    return /* @__PURE__ */ u3("div", { class: "bd-act-bar", children: [
      /* @__PURE__ */ u3("span", { class: "bd-act-count", children: total === 1 ? "1 change" : `${total} changes` }),
      unseen > 0 && /* @__PURE__ */ u3("span", { class: "bd-act-unseen", children: `${unseen} unseen` }),
      (unseen > 0 || beadsUnseen > 0) && /* @__PURE__ */ u3(
        "button",
        {
          type: "button",
          class: "bd-link bd-act-seen",
          disabled: busy,
          "aria-busy": busy,
          onClick: () => {
            setBusy(true);
            void store.markAllSeen().finally(() => setBusy(false));
          },
          children: "Mark all seen"
        }
      )
    ] });
  }
  function RestoreBar({ target, bead, kit, statuses, paused, reword, onClose }) {
    const label = `${fieldWord(target.change.field)} on ${shortId(target.beadId)}`;
    return /* @__PURE__ */ u3("div", { class: "bd-act-rs", role: "group", "aria-label": `Restore ${label}`, children: [
      /* @__PURE__ */ u3("div", { class: "bd-act-rs-top", children: [
        /* @__PURE__ */ u3(IconRestore, { size: 13 }),
        /* @__PURE__ */ u3("span", { class: "bd-act-rs-what", children: [
          `Restore ${fieldWord(target.change.field)} on `,
          /* @__PURE__ */ u3("span", { class: "bd-id", children: shortId(target.beadId) }),
          bead && /* @__PURE__ */ u3("span", { class: "bd-title", children: ` ${bead.title}` })
        ] }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-banner-x", "aria-label": "Close", disabled: kit.busy(target.key), onClick: onClose, children: /* @__PURE__ */ u3(IconX, {}) })
      ] }),
      bead ? /* @__PURE__ */ u3(RestoreControl, { kit, scope: "a", rkey: target.key, bead, change: target.change, statuses, paused, reword, grouped: true, onKeep: onClose }) : /* @__PURE__ */ u3("p", { class: "bd-rs-msg", children: "This bead is no longer in the project." })
    ] });
  }
  function ActivityView() {
    const state = useStore();
    const store = useStoreApi();
    const now = useNow(5e3);
    const [cursor, setCursor] = d2(null);
    const [opened, setOpened] = d2(null);
    const [menu, setMenu] = d2(null);
    const actions = useRowActions();
    const kit = useRestore("a", { focusChoice: true });
    const [restoring, setRestoring] = d2(null);
    const scrollTo = A2(false);
    const box = A2(null);
    const snapshot = state.snapshot;
    const { activity, beads, statuses } = snapshot ?? {};
    const today = new Date(now).setHours(0, 0, 0, 0);
    const days = T2(
      () => activity && beads && statuses ? activityFeed({ activity, beads, statuses, query: state.query, now: today }) : [],
      [activity, beads, statuses, state.query, today]
    );
    const entries2 = T2(() => days.flatMap((d3) => d3.entries), [days]);
    const ids = entries2.map((e3) => e3.event.id);
    const shown = cursor !== null && ids.includes(cursor) ? cursor : null;
    const open = (entry) => {
      setCursor(entry.event.id);
      if (entry.gone) return;
      setOpened(entry.event.id);
      store.select(entry.event.beadId);
    };
    const showMenu = (entry, at2) => {
      setCursor(entry.event.id);
      setMenu({ at: at2, eventId: entry.event.id });
    };
    const closeMenu = q2((why) => {
      setMenu(null);
      if (why !== "outside") queueMicrotask(() => box.current?.focus({ preventScroll: true }));
    }, []);
    const live = A2({ ids, cursor: shown, entries: entries2, state, open, menu, showMenu });
    live.current = { ids, cursor: shown, entries: entries2, state, open, menu, showMenu };
    h2(() => {
      const onKey = (e3) => {
        const { ids: order, cursor: at2, entries: list, state: s3, open: go, menu: opened2, showMenu: openMenu } = live.current;
        if (s3.detail || s3.page !== "list" || s3.overlays.length > 0 || opened2 || e3.defaultPrevented || e3.metaKey || e3.ctrlKey || e3.altKey) return;
        const focus2 = focusOf(e3.target);
        const key = e3.key === "F10" && e3.shiftKey ? "ContextMenu" : e3.key;
        const action = listKey({ key, ids: order, cursor: at2, focus: focus2 });
        if (!action) return;
        if (action.type === "menu") {
          const entry = list.find((x4) => x4.event.id === action.id);
          const row2 = document.getElementById(entryDomId(action.id));
          if (!entry || entry.gone || !row2) return;
          e3.preventDefault();
          openMenu(entry, menuFor(entry.event.beadId, row2, row2.querySelector(".bd-rowmore") ?? row2));
          return;
        }
        e3.preventDefault();
        switch (action.type) {
          case "move":
            scrollTo.current = true;
            setCursor(action.id);
            break;
          case "open": {
            const entry = list.find((x4) => x4.event.id === action.id);
            if (entry) go(entry);
            break;
          }
          case "search":
            document.querySelector(SEARCH)?.focus();
            break;
          case "escape":
            if (focus2 === "search") {
              if (s3.query) store.setQuery("");
              else e3.target.blur();
            } else if (s3.selectedId !== null) store.select(null);
            else setCursor(null);
            break;
        }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [store]);
    h2(() => {
      if (shown === null || !scrollTo.current) return;
      scrollTo.current = false;
      document.getElementById(entryDomId(shown))?.scrollIntoView?.({ block: "nearest" });
    }, [shown]);
    const hadDetail = A2(state.detail !== null);
    h2(() => {
      const back = hadDetail.current && state.detail === null;
      hadDetail.current = state.detail !== null;
      const active2 = document.activeElement;
      if (back && (!active2 || active2 === document.body)) box.current?.focus({ preventScroll: true });
    }, [state.detail]);
    if (!snapshot || !activity) return null;
    if (activity.length === 0) {
      if (snapshot.beads.length === 0) return /* @__PURE__ */ u3(NoBeads, {});
      return /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: "Nothing has changed yet.", body: "Changes your agent makes show up here." });
    }
    if (entries2.length === 0) {
      return /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: "No changes match.", body: "Nothing in the activity has that id, title, name or change.", children: /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn", onClick: () => store.setQuery(""), children: "Clear search" }) });
    }
    const stale = describeFreshness(state, now)?.stale ?? false;
    const unseen = entries2.filter((e3) => e3.event.unseen).length;
    const paused = writesPaused(snapshot);
    const beadOf = (id) => beads?.find((b2) => b2.id === id) ?? null;
    const reword = (message) => restoring ? blockedMessage(message, { id: restoring.beadId }, state.gates) : message;
    const restoreItem = (entry) => {
      const change = entry && !entry.gone ? rowChange(entry.event) : null;
      const bead = entry ? beadOf(entry.event.beadId) : null;
      if (!entry || !change || !bead || !restoreRequest(bead, change)) return [];
      const where = restoreState(bead, change);
      const key = entry.event.id;
      const run = () => {
        setRestoring({ key, beadId: bead.id, change });
        if (where === "changed") kit.hold(key, bead);
        else kit.restore(key, bead, change);
      };
      const off = paused ?? (where === "unchanged" ? "Already the earlier value" : kit.busy(key) ? "Restoring" : void 0);
      return [{ label: "Restore previous value", icon: /* @__PURE__ */ u3(IconRestore, {}), run, ...off ? { off } : {} }];
    };
    return /* @__PURE__ */ u3("div", { class: "bd-list bd-act", "data-stale": stale || void 0, children: [
      /* @__PURE__ */ u3(SeenBar, { total: entries2.length, unseen, beadsUnseen: snapshot.unseenIds.length }),
      restoring && /* @__PURE__ */ u3(
        RestoreBar,
        {
          target: restoring,
          bead: beadOf(restoring.beadId),
          kit,
          statuses: snapshot.statuses,
          paused,
          reword,
          onClose: () => {
            kit.dismiss(restoring.key);
            setRestoring(null);
            box.current?.focus({ preventScroll: true });
          }
        },
        restoring.key
      ),
      /* @__PURE__ */ u3("div", { role: "listbox", "aria-label": "Activity", tabIndex: 0, ref: box, ...shown ? { "aria-activedescendant": entryDomId(shown) } : {}, children: days.map((day) => /* @__PURE__ */ u3("div", { role: "group", class: "bd-day-grp", "aria-labelledby": `bd-day-${day.key}`, children: [
        /* @__PURE__ */ u3("div", { class: "bd-day", id: `bd-day-${day.key}`, role: "presentation", children: day.label }),
        day.entries.map((entry) => /* @__PURE__ */ u3(
          Entry2,
          {
            entry,
            now,
            cursor: shown === entry.event.id,
            selected: opened === entry.event.id && state.selectedId === entry.event.beadId,
            pick: open,
            menu: showMenu
          },
          entry.event.id
        ))
      ] }, day.key)) }),
      menu && /* @__PURE__ */ u3(RowMenu, { at: menu.at, actions, extra: restoreItem(entries2.find((e3) => e3.event.id === menu.eventId)), onClose: closeMenu })
    ] });
  }

  // src/panel/ui/NeedsView.tsx
  var SECTION_TITLES = {
    waiting: "Waiting for your review",
    asked: "Asked for help",
    stuck: "Stuck",
    changed: "Changed since you looked"
  };
  var ORDER = ["waiting", "asked", "stuck", "changed"];
  var needDomId = (key) => `bd-need-${key.replace(/[^\w.-]/g, "_")}`;
  var firstLine3 = (text2) => text2.trim().split("\n")[0].trim();
  function blockerText(ids, beads, gates) {
    const held = gates.filter((g3) => ids.includes(g3.id));
    const named = ids.flatMap((id) => held.some((g3) => g3.id === id) ? [] : beads.filter((b2) => b2.id === id).map((b2) => ({ id: b2.id, title: b2.title })));
    return sentence(waitsText({ gates: held, beads: named }));
  }
  var targetGate = (row2) => row2.gates.find((g3) => g3.reason) ?? row2.gates[0];
  var gateLock = (gateId) => `gate:${gateId}`;
  function itemsOf(state, now) {
    const needs = needsOf(state, now);
    return {
      waiting: needs.waiting.map((row2) => ({ section: "waiting", key: `waiting:${row2.bead.id}`, bead: row2.bead, row: row2 })),
      asked: needs.asked.map((row2) => ({ section: "asked", key: `asked:${row2.bead.id}`, bead: row2.bead, row: row2 })),
      stuck: needs.stuck.map((row2) => ({ section: "stuck", key: `stuck:${row2.bead.id}`, bead: row2.bead, row: row2 })),
      changed: needs.changed.map((row2) => ({ section: "changed", key: `changed:${row2.bead.id}`, bead: row2.bead, row: row2 }))
    };
  }
  function whyOf(item) {
    switch (item.section) {
      case "waiting":
        return item.row.gates.map((g3) => g3.reason ?? "").join(" ");
      case "asked":
        return item.row.text;
      case "stuck":
        return item.row.why;
      case "changed":
        return item.row.summary;
    }
  }
  var matches = (item, query) => {
    const q4 = query.trim().toLowerCase();
    if (!q4) return true;
    return [item.bead.id, item.bead.title, whyOf(item)].some((text2) => text2.toLowerCase().includes(q4));
  };
  function sinceOf(item) {
    switch (item.section) {
      case "waiting":
        return targetGate(item.row).createdAt;
      case "asked":
        return item.bead.createdAt;
      case "stuck":
        return item.bead.updatedAt;
      case "changed":
        return item.row.event?.changedAt ?? item.row.event?.observedAt ?? item.bead.updatedAt;
    }
  }
  function SectionIcon({ section }) {
    if (section === "waiting") return /* @__PURE__ */ u3(IconWait, { size: 13 });
    if (section === "asked") return /* @__PURE__ */ u3(IconChat, { size: 13 });
    if (section === "stuck") return /* @__PURE__ */ u3(IconClock, { size: 13 });
    return /* @__PURE__ */ u3("span", { class: "bd-nsec-dot" });
  }
  var without = (map, key) => {
    if (!(key in map)) return map;
    const { [key]: _gone, ...rest } = map;
    return rest;
  };
  var MAX_NOTICES = 3;
  function NeedsView() {
    const state = useStore();
    const store = useStoreApi();
    const now = useNow(3e4);
    const minute = Math.floor(now / 6e4) * 6e4;
    const [cursor, setCursor] = d2(null);
    const [opened, setOpened] = d2(null);
    const [steps, setSteps] = d2({});
    const inflight = A2(/* @__PURE__ */ new Set());
    const [busy, setBusy] = d2(/* @__PURE__ */ new Set());
    const [feedback, setFeedback] = d2({});
    const [settled, setSettled] = d2({});
    const [notices, setNotices] = d2([]);
    const noticeId = A2(0);
    const snapshot = state.snapshot;
    const sections = T2(() => itemsOf(state, minute), [state.snapshot, state.settings, state.keep, minute]);
    const shownSections = ORDER.map((section) => ({ section, items: sections[section].filter((item) => matches(item, state.query)) })).filter((s3) => s3.items.length > 0);
    const total = ORDER.reduce((n2, s3) => n2 + sections[s3].length, 0);
    const ids = shownSections.flatMap((s3) => s3.items.map((i3) => i3.key));
    const shown = cursor !== null && ids.includes(cursor) ? cursor : null;
    const tabStop = shown ?? ids[0] ?? null;
    const items = shownSections.flatMap((s3) => s3.items);
    const paused = writesPaused(snapshot);
    const look = looker(snapshot?.statuses ?? []);
    const open = (item) => {
      setCursor(item.key);
      setOpened(item.key);
      store.select(item.bead.id);
    };
    const focusRow = (...keys) => {
      const listed = keys.map((key) => key && document.getElementById(needDomId(key))).find(Boolean);
      const target = listed || document.querySelector('.bd-nmain[tabindex="0"]');
      target?.focus({ preventScroll: true });
    };
    const refocus = A2(null);
    _2(() => {
      const keys = refocus.current;
      if (!keys) return;
      refocus.current = null;
      focusRow(...keys);
    });
    const neighbourOf = (key) => {
      const at2 = ids.indexOf(key);
      return at2 < 0 ? null : ids[at2 + 1] ?? ids[at2 - 1] ?? null;
    };
    const live = A2({ ids, cursor: shown, items, state, open });
    live.current = { ids, cursor: shown, items, state, open };
    h2(() => {
      const onKey = (e3) => {
        const { ids: order, cursor: at2, items: list, state: s3, open: go } = live.current;
        if (s3.detail || s3.page !== "list" || s3.overlays.length > 0 || e3.defaultPrevented || e3.metaKey || e3.ctrlKey || e3.altKey) return;
        const focus2 = focusOf(e3.target);
        const action = listKey({ key: e3.key, ids: order, cursor: at2, focus: focus2 });
        if (!action || action.type === "menu") return;
        e3.preventDefault();
        switch (action.type) {
          case "move": {
            setCursor(action.id);
            const row2 = document.getElementById(needDomId(action.id));
            row2?.focus({ preventScroll: true });
            row2?.scrollIntoView?.({ block: "nearest" });
            break;
          }
          case "open": {
            const item = list.find((x4) => x4.key === action.id);
            if (item) go(item);
            break;
          }
          case "search":
            document.querySelector(SEARCH)?.focus();
            break;
          case "escape":
            if (focus2 === "search") {
              if (s3.query) store.setQuery("");
              else e3.target.blur();
            } else if (s3.selectedId !== null) store.select(null);
            else setCursor(null);
            break;
        }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [store]);
    const hadDetail = A2(state.detail !== null);
    h2(() => {
      const back = hadDetail.current && state.detail === null;
      hadDetail.current = state.detail !== null;
      const active2 = document.activeElement;
      if (back && (!active2 || active2 === document.body)) focusRow(live.current.cursor);
    }, [state.detail]);
    if (!snapshot) return null;
    if (snapshot.beads.length === 0) return /* @__PURE__ */ u3(NoBeads, {});
    const notice = (text2) => setNotices((list) => [...list, { id: ++noticeId.current, text: text2 }].slice(-MAX_NOTICES));
    const settle = (key, text2) => setSettled((s3) => ({ ...s3, [key]: text2 }));
    const setStep = (key, step) => setSteps((all) => step ? { ...all, [key]: step } : without(all, key));
    const closeStep = (key) => {
      refocus.current = [key];
      setStep(key, null);
    };
    async function run(item, send, done, locks = []) {
      const { key } = item;
      const held = [key, ...locks];
      if (held.some((k3) => inflight.current.has(k3))) return;
      for (const k3 of held) inflight.current.add(k3);
      setBusy(new Set(inflight.current));
      setFeedback((f5) => without(f5, key));
      const neighbour = neighbourOf(key);
      const outcome = await send();
      for (const k3 of held) inflight.current.delete(k3);
      setBusy(new Set(inflight.current));
      if (outcome.kind === "dropped") return;
      if (outcome.kind === "ok") {
        done(outcome.value);
        const inRow = document.activeElement?.closest("[data-row]")?.dataset.row === key;
        setStep(key, null);
        if (inRow || document.activeElement === document.body) refocus.current = [key, neighbour];
        return;
      }
      if (outcome.kind === "conflict") {
        setFeedback((f5) => ({ ...f5, [key]: { kind: "error", error: { code: "conflict", message: "This bead changed since it was shown. Check it, then try again." } } }));
        return;
      }
      setFeedback((f5) => ({ ...f5, [key]: feedbackOf(outcome) }));
    }
    const resolve = (item, reason) => {
      const gate = targetGate(item.row);
      void run(item, () => store.resolveReview(gate.id, reason.trim() || void 0), (result) => {
        if (result.ok) {
          settle(gate.id, gate.planApproval ? "Approved. Updating the list." : "Resolved. Updating the list.");
          store.notify(gate.planApproval ? `Plan approved for ${shortId(item.bead.id)}.` : `Review resolved for ${shortId(item.bead.id)}.`);
          return;
        }
        const at2 = result.at === null ? NaN : Date.parse(result.at);
        const who = result.resolvedBy ?? "someone else";
        settle(gate.id, "Updating the list.");
        notice(`The ${gate.planApproval ? "plan approval" : "review"} on ${shortId(item.bead.id)} was already resolved by ${who}${Number.isFinite(at2) ? ` ${ago(Date.now() - at2)}` : ""}.`);
      }, [gateLock(gate.id)]);
    };
    const answer = (item, mode, text2) => {
      const version = `${item.bead.id}@${item.bead.updatedAt}`;
      const send = () => mode === "respond" ? store.respond(item.bead.id, text2.trim()) : store.dismissRequest(item.bead.id, text2.trim() || void 0);
      void run(item, send, (result) => {
        if (result.ok) {
          store.notify(mode === "respond" ? `Answer sent to ${shortId(item.bead.id)}.` : `Request ${shortId(item.bead.id)} dismissed.`);
          return;
        }
        settle(version, "Updating the list.");
        notice(`The request ${shortId(item.bead.id)} was already answered or closed.`);
      });
    };
    const defer = (item, until) => {
      const read = parseDateInput(until, Date.now(), localZone());
      void run(item, () => store.defer(item.bead.id, item.bead.updatedAt, until.trim()), () => {
        store.notify(read.kind === "ok" ? `${shortId(item.bead.id)} deferred until ${read.label}.` : `${shortId(item.bead.id)} deferred.`);
      });
    };
    const keep = (item) => {
      refocus.current = [neighbourOf(item.key)];
      store.keepStuck(item.bead.id);
      store.notify(`${shortId(item.bead.id)} is hidden from Stuck for 7 days.`);
    };
    const stale = describeFreshness(state, now)?.stale ?? false;
    return /* @__PURE__ */ u3("div", { class: "bd-list bd-needs", "data-stale": stale || void 0, children: [
      notices.length > 0 && /* @__PURE__ */ u3("div", { class: "bd-nnotes", children: notices.map((n2) => /* @__PURE__ */ u3("div", { class: "bd-nnote", role: "status", children: [
        /* @__PURE__ */ u3("span", { children: n2.text }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-nnote-x", "aria-label": "Hide this note", onClick: () => setNotices((list) => list.filter((x4) => x4.id !== n2.id)), children: /* @__PURE__ */ u3(IconX, {}) })
      ] }, n2.id)) }),
      paused && total > 0 && /* @__PURE__ */ u3(PausedNote, { reason: paused }),
      total === 0 ? /* @__PURE__ */ u3("p", { class: "bd-nquiet", children: "Nothing needs you right now." }) : shownSections.length === 0 ? /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: "Nothing here matches.", body: "No bead in Needs me has that id, title or reason.", children: /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn", onClick: () => store.setQuery(""), children: "Clear search" }) }) : shownSections.map(({ section, items: rows }) => /* @__PURE__ */ u3("section", { class: "bd-nsec", "data-section": section, "aria-labelledby": `bd-nsec-${section}`, children: [
        /* @__PURE__ */ u3("div", { class: "bd-nsec-h", children: [
          /* @__PURE__ */ u3("span", { class: "bd-nsec-ic", "data-section": section, "aria-hidden": "true", children: /* @__PURE__ */ u3(SectionIcon, { section }) }),
          /* @__PURE__ */ u3("h2", { class: "bd-nsec-title", id: `bd-nsec-${section}`, children: [
            SECTION_TITLES[section],
            " ",
            /* @__PURE__ */ u3("span", { class: "bd-n", children: rows.length })
          ] }),
          section === "changed" && /* @__PURE__ */ u3(SeenAll, {})
        ] }),
        /* @__PURE__ */ u3("ul", { class: "bd-nlist", role: "list", "aria-labelledby": `bd-nsec-${section}`, children: rows.map((item) => /* @__PURE__ */ u3(
          NeedRow,
          {
            item,
            now: minute,
            look,
            cursor: shown === item.key,
            tabStop: tabStop === item.key,
            selected: opened === item.key && state.selectedId === item.bead.id,
            pick: open,
            onFocus: () => setCursor(item.key),
            children: /* @__PURE__ */ u3(
              RowActions,
              {
                item,
                state,
                step: steps[item.key] ?? null,
                setStep: (step) => setStep(item.key, step),
                closeStep: () => closeStep(item.key),
                busy: busy.has(item.key) || item.section === "waiting" && busy.has(gateLock(targetGate(item.row).id)),
                paused,
                settled: settledText(item, settled),
                feedback: feedback[item.key] ?? null,
                resolve,
                answer,
                defer,
                keep
              }
            )
          },
          item.key
        )) })
      ] }, section))
    ] });
  }
  function settledText(item, settled) {
    if (item.section === "waiting") return settled[targetGate(item.row).id] ?? null;
    if (item.section === "asked") return settled[`${item.bead.id}@${item.bead.updatedAt}`] ?? null;
    return null;
  }
  function SeenAll() {
    const store = useStoreApi();
    const [busy, setBusy] = d2(false);
    return /* @__PURE__ */ u3(
      "button",
      {
        type: "button",
        class: "bd-link bd-nsec-act",
        disabled: busy,
        "aria-busy": busy,
        onClick: () => {
          setBusy(true);
          void store.markAllSeen().finally(() => setBusy(false));
        },
        children: "Mark all seen"
      }
    );
  }
  function NeedRow({ item, now, look, cursor, tabStop, selected, pick, onFocus, children }) {
    const { bead } = item;
    const since = Date.parse(sinceOf(item));
    const id = needDomId(item.key);
    return /* @__PURE__ */ u3(
      "li",
      {
        class: "bd-row bd-nrow",
        "data-row": item.key,
        "data-section": item.section,
        "data-cursor": cursor || void 0,
        "data-selected": selected || void 0,
        "data-unseen": item.section === "changed" || void 0,
        onFocusCapture: onFocus,
        children: [
          /* @__PURE__ */ u3(
            "div",
            {
              id,
              class: "bd-nmain",
              role: "button",
              tabIndex: tabStop ? 0 : -1,
              "aria-labelledby": `${id}-id ${id}-t`,
              "aria-describedby": `${id}-why`,
              "aria-current": selected || void 0,
              onClick: () => pick(item),
              onKeyDown: (e3) => {
                if ((e3.key === " " || e3.key === "Enter" && !composing(e3)) && e3.target === e3.currentTarget) {
                  e3.preventDefault();
                  pick(item);
                }
              },
              children: [
                /* @__PURE__ */ u3("div", { class: "bd-nrow-top", children: [
                  /* @__PURE__ */ u3(StatusDot, { look: look(bead.status), marker: markerOf(bead.status) }),
                  /* @__PURE__ */ u3("span", { class: "bd-id", id: `${id}-id`, title: bead.id, children: shortId(bead.id) }),
                  /* @__PURE__ */ u3("span", { class: "bd-title", id: `${id}-t`, title: bead.title, children: bead.title }),
                  Number.isFinite(since) && /* @__PURE__ */ u3("time", { class: "bd-age", dateTime: sinceOf(item), children: shortAgo(now - since) })
                ] }),
                /* @__PURE__ */ u3("div", { id: `${id}-why`, class: "bd-nwhy", children: /* @__PURE__ */ u3(Why, { item }) })
              ]
            }
          ),
          children
        ]
      }
    );
  }
  function Why({ item }) {
    const state = useStore();
    switch (item.section) {
      case "waiting": {
        const gate = targetGate(item.row);
        const more = item.row.gates.length - 1;
        return /* @__PURE__ */ u3("p", { class: "bd-why", "data-section": "waiting", children: [
          /* @__PURE__ */ u3("span", { class: "bd-tag", "data-kind": gate.planApproval ? "plan" : "review", children: gate.planApproval ? "Plan" : "Review" }),
          /* @__PURE__ */ u3("span", { class: "bd-why-text", children: [
            gate.reason ? firstLine3(gate.reason) : "No reason given",
            gate.createdBy && /* @__PURE__ */ u3("span", { class: "bd-why-by", children: ` from ${gate.createdBy}` })
          ] }),
          more > 0 && /* @__PURE__ */ u3("span", { class: "bd-why-more", children: `and ${more} more` })
        ] });
      }
      case "asked": {
        const { row: row2, bead } = item;
        const own = row2.text.trim() !== bead.title.trim();
        return /* @__PURE__ */ u3(S, { children: [
          own ? /* @__PURE__ */ u3("p", { class: "bd-quote", title: row2.text, children: row2.text }) : /* @__PURE__ */ u3("p", { class: "bd-why", "data-section": "asked", children: bead.createdBy ? `Asked by ${bead.createdBy}` : "Asked for help" }),
          row2.blockers.length > 0 && /* @__PURE__ */ u3("p", { class: "bd-why", "data-tone": "hold", children: [
            /* @__PURE__ */ u3(IconWait, { size: 12 }),
            /* @__PURE__ */ u3("span", { class: "bd-why-text", children: `${blockerText(row2.blockers, state.snapshot?.beads ?? [], state.gates)}. You can answer once that is done.` })
          ] })
        ] });
      }
      case "stuck":
        return /* @__PURE__ */ u3("p", { class: "bd-why", "data-section": "stuck", children: /* @__PURE__ */ u3("span", { class: "bd-why-text", children: item.row.why }) });
      case "changed":
        return /* @__PURE__ */ u3("p", { class: "bd-why", "data-section": "changed", children: /* @__PURE__ */ u3("span", { class: "bd-why-text", children: item.row.summary }) });
    }
  }
  function RowActions(props) {
    const { item, state, step, setStep, closeStep, busy, paused, settled, feedback } = props;
    if (item.section === "changed") return null;
    if (settled) {
      return /* @__PURE__ */ u3("p", { class: "bd-why bd-nsettled", "data-tone": "done", role: "status", children: settled });
    }
    const message = feedback && /* @__PURE__ */ u3("div", { class: "bd-nmsg", children: /* @__PURE__ */ u3(WriteMessage, { feedback }) });
    if (step) {
      const common = { text: step.text, set: (text2) => setStep({ ...step, text: text2 }), cancel: () => !busy && closeStep(), busy, paused, message };
      if (step.mode === "respond" && item.section === "asked") return /* @__PURE__ */ u3(AnswerStep, { ...common, send: (text2) => props.answer(item, "respond", text2) });
      if (step.mode === "defer" && item.section === "stuck") return /* @__PURE__ */ u3(DeferStep, { ...common, send: (text2) => props.defer(item, text2) });
      if (step.mode === "resolve" && item.section === "waiting") {
        const plan = targetGate(item.row).planApproval;
        return /* @__PURE__ */ u3(ReasonStep2, { ...common, action: plan ? "Approve plan" : "Resolve review", hint: plan ? "Approving lets work on the plan start." : "Resolving lets the bead close.", send: (text2) => props.resolve(item, text2) });
      }
      if (step.mode === "dismiss" && item.section === "asked") return /* @__PURE__ */ u3(ReasonStep2, { ...common, action: "Dismiss request", hint: "Closes the request without an answer.", send: (text2) => props.answer(item, "dismiss", text2) });
    }
    const openStep = (mode) => () => setStep({ mode, text: "" });
    const off = paused !== null || busy;
    const title = paused ?? void 0;
    const buttons = [];
    if (item.section === "waiting" && !state.unsupported.has("gates")) {
      const plan = targetGate(item.row).planApproval;
      buttons.push(
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: off, "aria-busy": busy || void 0, title, onClick: () => props.resolve(item, ""), children: plan ? "Approve" : "Resolve" }, "resolve"),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-link bd-nreason", disabled: off, title, onClick: openStep("resolve"), children: "Add a reason" }, "reason")
      );
    }
    if (item.section === "asked" && item.row.blockers.length === 0 && !state.unsupported.has("human")) {
      buttons.push(
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: off, title, onClick: openStep("respond"), children: "Respond" }, "respond"),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: off, "aria-busy": busy || void 0, title, onClick: () => props.answer(item, "dismiss", ""), children: "Dismiss" }, "dismiss"),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-link bd-nreason", disabled: off, title, onClick: openStep("dismiss"), children: "Dismiss with a reason" }, "reason")
      );
    }
    if (item.section === "stuck") {
      buttons.push(
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, title: "Hide it from Stuck for 7 days. Nothing changes in Beads.", onClick: () => props.keep(item), children: "Keep" }, "keep")
      );
      if (!state.unsupported.has("defer")) {
        buttons.push(
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: off, title, onClick: openStep("defer"), children: "Defer" }, "defer")
        );
      }
    }
    if (buttons.length === 0 && !message) return null;
    return /* @__PURE__ */ u3("div", { class: "bd-nacts", children: [
      buttons.length > 0 && /* @__PURE__ */ u3("div", { class: "bd-nacts-row", children: buttons }),
      message
    ] });
  }
  function useFirstFocus2() {
    const ref = A2(null);
    h2(() => ref.current?.focus(), []);
    return ref;
  }
  var escapeCloses2 = (cancel) => (e3) => {
    if (e3.key !== "Escape" || composing(e3)) return;
    e3.preventDefault();
    e3.stopPropagation();
    cancel();
  };
  function StepBox({ children, go, action, primaryOff, busy, paused, cancel, message }) {
    return /* @__PURE__ */ u3("div", { class: "bd-nstep", children: [
      children,
      /* @__PURE__ */ u3("div", { class: "bd-nstep-acts", children: [
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: primaryOff || busy || paused !== null, "aria-busy": busy, title: paused ?? void 0, onClick: go, children: action }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, onClick: cancel, children: "Cancel" })
      ] }),
      message
    ] });
  }
  function AnswerStep({ text: text2, set, cancel, send, busy, paused, message }) {
    const field = useFirstFocus2();
    const go = () => {
      if (text2.trim() && !busy && paused === null) send(text2);
    };
    return /* @__PURE__ */ u3(StepBox, { go, action: "Send", primaryOff: !text2.trim(), busy, paused, cancel, message, children: [
      /* @__PURE__ */ u3(
        "textarea",
        {
          ref: field,
          class: "bd-input bd-ntext",
          "aria-label": "Your answer",
          placeholder: "Your answer",
          rows: 3,
          value: text2,
          disabled: busy,
          onInput: (e3) => set(e3.currentTarget.value),
          onKeyDown: (e3) => {
            escapeCloses2(cancel)(e3);
            if (isSubmitKey(e3)) {
              e3.preventDefault();
              go();
            }
          }
        }
      ),
      /* @__PURE__ */ u3("p", { class: "bd-nstep-hint", children: `Added as a comment, then the request closes. ${saveKey()} sends.` })
    ] });
  }
  function ReasonStep2({ text: text2, set, cancel, send, busy, paused, message, action, hint }) {
    const field = useFirstFocus2();
    const go = () => {
      if (!busy && paused === null) send(text2);
    };
    return /* @__PURE__ */ u3(StepBox, { go, action, primaryOff: false, busy, paused, cancel, message, children: [
      /* @__PURE__ */ u3(
        "input",
        {
          ref: field,
          type: "text",
          class: "bd-input",
          "aria-label": "Reason (optional)",
          placeholder: "Reason (optional)",
          value: text2,
          disabled: busy,
          onInput: (e3) => set(e3.currentTarget.value),
          onKeyDown: (e3) => {
            escapeCloses2(cancel)(e3);
            if (isEnterInInput(e3)) {
              e3.preventDefault();
              go();
            }
          }
        }
      ),
      /* @__PURE__ */ u3("p", { class: "bd-nstep-hint", children: hint })
    ] });
  }
  function DeferStep({ text: text2, set, cancel, send, busy, paused, message }) {
    const go = () => {
      if (text2.trim() && !busy && paused === null) send(text2);
    };
    return /* @__PURE__ */ u3(StepBox, { go, action: "Defer", primaryOff: !text2.trim(), busy, paused, cancel, message, children: /* @__PURE__ */ u3("div", { onKeyDown: escapeCloses2(cancel), children: /* @__PURE__ */ u3(DateInput, { label: "Defer until", lead: "Until", value: text2, onInput: set, onEnter: go, disabled: busy, autoFocus: true }) }) });
  }

  // src/panel/ui/MemoriesPage.tsx
  var SEARCH_WAIT_MS = 250;
  function newestFirst(memories) {
    return memories.map((m3, i3) => [m3, i3]).sort(([a5, i3], [b2, j4]) => {
      if (a5.changedAt === b2.changedAt) return i3 - j4;
      if (a5.changedAt === null) return 1;
      if (b2.changedAt === null) return -1;
      return Date.parse(b2.changedAt) - Date.parse(a5.changedAt) || i3 - j4;
    }).map(([m3]) => m3);
  }
  function changedLine(memory, now) {
    if (memory.changedAt === null) return null;
    const at2 = Date.parse(memory.changedAt);
    if (Number.isNaN(at2)) return null;
    return `Changed ${ago(now - at2)}${memory.changedBy ? ` by ${memory.changedBy}` : ""}`;
  }
  var controlId = (control, key) => `bd-mem${control}-${key}`;
  var keyId = (key) => controlId("key", key);
  var DRAFTS = "\0memories";
  var editField = (key) => `edit:${key}`;
  var ADD_FIELD = "add";
  var editDirty = (item) => item.refused !== void 0 || item.draft !== item.base;
  var composerDirty = (c3) => c3 !== null && (c3.text.trim() !== "" || c3.name.trim() !== "");
  function MemoriesPage() {
    const store = useStoreApi();
    const state = useStore();
    const now = useNow(6e4);
    const paused = writesPaused(state.snapshot);
    const [loaded, setLoaded] = d2({ kind: "loading" });
    const [query, setQuery] = d2("");
    const [items, setItems] = d2({});
    const [busy, setBusy] = d2([]);
    const [composer, setComposer] = d2(() => {
      const kept = store.draft(DRAFTS, ADD_FIELD);
      return kept ? { text: kept.text, name: kept.base ?? "", taken: null, feedback: null } : null;
    });
    const [leaving, setLeaving] = d2(false);
    const restored = A2(false);
    const [adding, setAdding] = d2(false);
    const [notice, setNotice] = d2(null);
    const [undoing, setUndoing] = d2(false);
    const [fresh, setFresh] = d2(null);
    const seq = A2(0);
    const queryRef = A2("");
    const refocus = A2("heading");
    const heading = A2(null);
    const addButton = A2(null);
    const itemsRef = A2(items);
    itemsRef.current = items;
    const patchItem = (key, next) => setItems((all) => {
      const copy = { ...all };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });
    const busyNow = A2(/* @__PURE__ */ new Set());
    const hold = (key, on) => {
      if (on) busyNow.current.add(key);
      else busyNow.current.delete(key);
      setBusy((keys) => on ? [...keys, key] : keys.filter((k3) => k3 !== key));
    };
    const load = async () => {
      const mine = ++seq.current;
      const query2 = queryRef.current.trim() || void 0;
      const outcome = await store.readMemories(query2);
      if (mine !== seq.current || outcome.kind === "dropped") return null;
      if (outcome.kind === "error") {
        setLoaded((l3) => l3.kind === "ok" ? { ...l3, error: outcome.error } : { kind: "error", error: outcome.error });
        return null;
      }
      const memories = newestFirst(outcome.value.memories);
      const filtered = query2 !== void 0;
      setLoaded({ kind: "ok", memories, filtered, error: null });
      if (!restored.current && !filtered) restoreEdits(memories);
      settle(memories, filtered);
      return memories;
    };
    const restoreEdits = (memories) => {
      restored.current = true;
      const back2 = {};
      for (const field of store.draftFields(DRAFTS)) {
        if (!field.startsWith("edit:")) continue;
        const key = field.slice("edit:".length);
        const kept = store.draft(DRAFTS, field);
        const base = kept.original ?? kept.text;
        const last = memories.find((m3) => m3.key === key) ?? { key, text: base, changedAt: null, changedBy: null };
        back2[key] = { mode: "edit", draft: kept.text, base, last, feedback: null };
      }
      if (Object.keys(back2).length > 0) setItems((all) => ({ ...back2, ...all }));
    };
    const settle = (memories, filtered) => {
      const byKey = new Map(memories.map((m3) => [m3.key, m3]));
      for (const [key, item] of Object.entries(itemsRef.current)) {
        const now2 = byKey.get(key);
        if (item.mode === "forget" && !busyNow.current.has(key) && !item.check && now2 && now2.text !== item.text) refocus.current = { key, control: "cancel" };
      }
      setItems((all) => {
        const copy = { ...all };
        for (const [key, item] of Object.entries(all)) {
          const now2 = byKey.get(key);
          if (busyNow.current.has(key)) continue;
          if (item.mode === "forget") {
            if (!item.check && now2 && now2.text !== item.text) copy[key] = { ...item, text: now2.text, moved: true, feedback: null };
            else if (!item.check && !now2 && !filtered) delete copy[key];
            else if (item.check && !filtered) {
              if (!now2) delete copy[key];
              else copy[key] = { ...item, check: false, feedback: { kind: "checked", saved: false } };
            }
            continue;
          }
          if (!now2 && filtered) continue;
          if (item.check) {
            if (filtered) continue;
            if (now2?.text === item.draft.trim()) {
              delete copy[key];
              continue;
            }
            copy[key] = { ...item, check: false, feedback: { kind: "checked", saved: false, kept: "Your text is still here." } };
          }
          const edit = copy[key];
          if (!now2) copy[key] = { ...edit, refused: "gone" };
          else if (now2.text !== edit.base) copy[key] = { ...edit, base: now2.text, last: now2, refused: "changed" };
          else copy[key] = { ...edit, last: now2 };
        }
        return copy;
      });
      setComposer((c3) => {
        if (!c3?.check || filtered) return c3;
        return memories.some((m3) => m3.text === c3.text.trim()) ? null : { ...c3, check: false, feedback: { kind: "checked", saved: false, kept: "Your text is still here." } };
      });
    };
    h2(() => {
      void load();
    }, []);
    h2(() => {
      if (query === queryRef.current) return;
      const id = setTimeout(() => {
        queryRef.current = query;
        void load();
      }, SEARCH_WAIT_MS);
      return () => clearTimeout(id);
    }, [query]);
    _2(() => {
      const want = refocus.current;
      if (!want) return;
      const el2 = want === "heading" ? heading.current : want === "add" ? addButton.current : want === "new" ? document.getElementById("bd-mem-new") : document.getElementById(controlId(want.control, want.key));
      if (!el2) return;
      refocus.current = null;
      el2.focus({ preventScroll: true });
    });
    h2(() => {
      const want = refocus.current;
      if (loaded.kind === "ok" && want && typeof want === "object" && !document.getElementById(controlId(want.control, want.key))) refocus.current = null;
    }, [loaded]);
    const back = () => store.setPage("list");
    const dirtyKeys = Object.entries(items).flatMap(([key, item]) => item.mode === "edit" && editDirty(item) ? [key] : []);
    const unsaved = dirtyKeys.length > 0 || composerDirty(composer);
    const unsavedRef = A2(unsaved);
    unsavedRef.current = unsaved;
    const requestBack = () => {
      if (unsavedRef.current) setLeaving(true);
      else back();
    };
    const discardAndLeave = () => {
      store.dropDrafts(DRAFTS);
      back();
    };
    const keepEditing = () => {
      setLeaving(false);
      refocus.current = dirtyKeys[0] !== void 0 ? { key: dirtyKeys[0], control: "field" } : "new";
    };
    h2(() => {
      const want = /* @__PURE__ */ new Map();
      for (const [key, item] of Object.entries(items)) if (item.mode === "edit" && editDirty(item)) want.set(editField(key), { text: item.draft, original: item.base });
      if (composer && composerDirty(composer)) want.set(ADD_FIELD, { text: composer.text, base: composer.name });
      for (const field of store.draftFields(DRAFTS)) {
        if (!want.has(field) && (restored.current || !field.startsWith("edit:"))) store.setDraft(DRAFTS, field, null);
      }
      for (const [field, draft] of want) store.setDraft(DRAFTS, field, draft);
    }, [items, composer]);
    h2(() => {
      const onKey = (e3) => {
        if (e3.key !== "Escape" || e3.defaultPrevented || e3.metaKey || e3.ctrlKey || e3.altKey || composing(e3)) return;
        if (e3.target instanceof Element && e3.target.closest("input, textarea, select")) return;
        if (store.get().overlays.length > 0) return;
        e3.preventDefault();
        requestBack();
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [store]);
    const listed = loaded.kind === "ok" ? loaded.memories : [];
    const pinned = Object.values(items).flatMap((item) => item.mode === "edit" && !listed.some((m3) => m3.key === item.last.key) ? [item.last] : []);
    const shown = [...pinned, ...listed];
    const neighbourOf = (key) => {
      const i3 = listed.findIndex((m3) => m3.key === key);
      const next = listed[i3 + 1] ?? listed[i3 - 1];
      return next ? { key: next.key, control: "edit" } : "add";
    };
    const replaceListed = (memory) => setLoaded((l3) => l3.kind === "ok" ? { ...l3, memories: l3.memories.map((m3) => m3.key === memory.key ? memory : m3) } : l3);
    const startEdit = (memory) => patchItem(memory.key, { mode: "edit", draft: memory.text, base: memory.text, last: memory, feedback: null });
    const cancelItem = (key, control) => {
      const item = itemsRef.current[key];
      if (item?.mode === "edit" && editDirty(item)) {
        patchItem(key, { ...item, asking: true });
        return;
      }
      patchItem(key, null);
      refocus.current = { key, control };
    };
    const keepEdit = (key) => {
      const item = itemsRef.current[key];
      if (item?.mode === "edit") patchItem(key, { ...item, asking: false });
      refocus.current = { key, control: "field" };
    };
    const discardEdit = (key) => {
      const item = itemsRef.current[key];
      if (item?.mode === "edit" && item.refused === "gone") return leaveGone(key);
      if (item?.mode === "edit" && item.refused === "changed") return keepCurrent(key);
      patchItem(key, null);
      refocus.current = { key, control: "edit" };
    };
    const save = async (key, item, readd = false) => {
      if (busy.includes(key) || paused !== null) return;
      hold(key, true);
      patchItem(key, { ...item, feedback: null });
      const outcome = await store.remember(readd ? { key, text: item.draft } : { key, text: item.draft, expectedText: item.base });
      hold(key, false);
      if (outcome.kind === "dropped") return;
      if (outcome.kind === "ok") {
        const result = outcome.value;
        if (result.ok) {
          patchItem(key, null);
          refocus.current = { key, control: "edit" };
          setFresh(key);
          void load();
          return;
        }
        if (result.current) {
          replaceListed(result.current);
          patchItem(key, { ...item, base: result.current.text, last: result.current, refused: "changed", feedback: null });
        } else {
          patchItem(key, { ...item, refused: "gone", feedback: null });
        }
        return;
      }
      if (outcome.kind === "uncertain" && outcome.saved) {
        patchItem(key, null);
        refocus.current = { key, control: "edit" };
        void load();
        return;
      }
      patchItem(key, { ...item, feedback: feedbackOf(outcome), check: outcome.kind === "uncertain" });
      if (outcome.kind === "uncertain") void load();
    };
    const leaveGone = (key) => {
      refocus.current = neighbourOf(key);
      patchItem(key, null);
      setLoaded((l3) => l3.kind === "ok" ? { ...l3, memories: l3.memories.filter((m3) => m3.key !== key) } : l3);
      void load();
    };
    const keepCurrent = (key) => {
      patchItem(key, null);
      refocus.current = { key, control: "edit" };
      void load();
    };
    const askForget = (memory) => {
      patchItem(memory.key, { mode: "forget", text: memory.text, feedback: null });
      refocus.current = { key: memory.key, control: "cancel" };
    };
    const forget = async (shown2, step) => {
      const key = shown2.key;
      if (busy.includes(key) || paused !== null) return;
      const memory = { ...shown2, text: step.text };
      const after = neighbourOf(key);
      hold(key, true);
      patchItem(key, { ...step, feedback: null });
      const outcome = await store.forget(key, step.text);
      hold(key, false);
      if (outcome.kind === "dropped") return;
      if (outcome.kind === "ok") {
        const result = outcome.value;
        if (result.ok) {
          patchItem(key, null);
          setNotice({ kind: "forgot", memory, feedback: null });
          refocus.current = after;
          void load();
          return;
        }
        if (result.current) {
          replaceListed(result.current);
          patchItem(key, { mode: "forget", text: result.current.text, moved: true, feedback: null });
          refocus.current = { key, control: "cancel" };
          return;
        }
        patchItem(key, null);
        refocus.current = after;
        void load();
        return;
      }
      patchItem(key, { ...step, feedback: feedbackOf(outcome), check: outcome.kind === "uncertain" && !outcome.saved });
      if (outcome.kind === "uncertain") {
        const memories = await load();
        if (memories && !memories.some((m3) => m3.key === key)) setNotice({ kind: "forgot", memory, feedback: null });
      }
    };
    const undo = async (memory) => {
      if (undoing || paused !== null) return;
      setUndoing(true);
      const outcome = await store.remember({ key: memory.key, text: memory.text });
      setUndoing(false);
      if (outcome.kind === "dropped") return;
      if (outcome.kind === "ok") {
        setNotice(outcome.value.ok ? { kind: "back", key: memory.key } : { kind: "taken", memory });
        if (outcome.value.ok) {
          refocus.current = { key: memory.key, control: "edit" };
          setFresh(memory.key);
        }
        void load();
        return;
      }
      setNotice({ kind: "forgot", memory, feedback: feedbackOf(outcome) });
      if (outcome.kind === "uncertain") void load();
    };
    const openComposer = () => {
      if (!composer) setComposer({ text: "", name: "", taken: null, feedback: null });
    };
    const closeComposer = () => {
      if (adding) return;
      setComposer(null);
      refocus.current = "add";
    };
    const cancelComposer = () => {
      if (adding || !composer) return;
      if (composerDirty(composer)) setComposer({ ...composer, asking: true });
      else closeComposer();
    };
    const add = async (c3, replace = false) => {
      const text2 = c3.text.trim();
      const name = c3.name.trim();
      if (adding || text2 === "" || paused !== null) return;
      setAdding(true);
      setComposer({ ...c3, feedback: null, vanished: void 0 });
      const outcome = await store.remember({ text: c3.text, ...name ? { key: name } : {}, ...replace && c3.taken ? { key: c3.taken.key, expectedText: c3.taken.text } : {} });
      setAdding(false);
      if (outcome.kind === "dropped") return;
      if (outcome.kind === "ok") {
        const result = outcome.value;
        if (result.ok) {
          setComposer(null);
          refocus.current = "add";
          if (result.memory) setFresh(result.memory.key);
          void load();
          return;
        }
        if (replace && !result.current && c3.taken) {
          setComposer({ ...c3, taken: null, feedback: null, vanished: `${c3.taken.key} was removed elsewhere. Nothing was saved. Add memory adds yours as new.` });
          return;
        }
        setComposer({ ...c3, taken: result.current, feedback: null, vanished: void 0 });
        return;
      }
      if (outcome.kind === "uncertain" && outcome.saved) {
        setComposer(null);
        refocus.current = "add";
        void load();
        return;
      }
      setComposer({ ...c3, feedback: feedbackOf(outcome), check: outcome.kind === "uncertain" });
      if (outcome.kind === "uncertain") void load();
    };
    const count = loaded.kind === "ok" && !loaded.filtered ? loaded.memories.length : null;
    const searching = queryRef.current.trim() !== "";
    return /* @__PURE__ */ u3("section", { class: "bd-mem", "aria-labelledby": "bd-mem-h", children: [
      /* @__PURE__ */ u3("nav", { class: "bd-dnav bd-mem-nav", children: [
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-iconbtn bd-back", "aria-label": "Back", title: "Back (Esc)", onClick: requestBack, children: /* @__PURE__ */ u3(IconBack, {}) }),
        /* @__PURE__ */ u3("h1", { class: "bd-mem-h", id: "bd-mem-h", ref: heading, tabIndex: -1, children: [
          "Memories",
          " ",
          count !== null && !searching && /* @__PURE__ */ u3("span", { class: "bd-n", children: count })
        ] }),
        /* @__PURE__ */ u3(
          "button",
          {
            ref: addButton,
            type: "button",
            class: "bd-btn bd-btn-sm bd-mem-addbtn",
            "aria-expanded": composer !== null,
            disabled: paused !== null,
            title: paused ?? "Add a memory",
            onClick: openComposer,
            children: [
              /* @__PURE__ */ u3(IconPlus, {}),
              "Add"
            ]
          }
        )
      ] }),
      leaving && /* @__PURE__ */ u3(DiscardAsk, { label: "Discard your unsaved text?", detail: "What you typed here goes. Saved memories stay as they are.", onKeep: keepEditing, onDiscard: discardAndLeave }),
      /* @__PURE__ */ u3("div", { class: "bd-mem-body", inert: leaving, children: [
        /* @__PURE__ */ u3("p", { class: "bd-mem-lede", children: "Every agent session in this project starts with these." }),
        /* @__PURE__ */ u3("label", { class: "bd-search bd-mem-search", "data-hint": "long", children: [
          /* @__PURE__ */ u3(IconSearch, {}),
          /* @__PURE__ */ u3(
            "input",
            {
              type: "search",
              placeholder: "Search memories",
              "aria-label": "Search memories",
              value: query,
              onInput: (e3) => setQuery(e3.currentTarget.value),
              onKeyDown: (e3) => {
                if (e3.key === "Escape" && query !== "" && !composing(e3)) {
                  e3.preventDefault();
                  setQuery("");
                }
              }
            }
          )
        ] }),
        paused && /* @__PURE__ */ u3(PausedNote, { reason: paused }),
        notice && /* @__PURE__ */ u3(NoticeBar, { notice, undoing, paused, undo, hide: () => setNotice(null) }),
        composer && /* @__PURE__ */ u3(
          AddBox,
          {
            composer,
            busy: adding,
            paused,
            set: (next) => setComposer({ ...composer, ...next }),
            add: (replace) => void add(composer, replace),
            cancel: cancelComposer,
            keep: () => {
              setComposer({ ...composer, asking: false });
              refocus.current = "new";
            },
            discard: closeComposer
          }
        ),
        loaded.kind === "ok" && loaded.error && /* @__PURE__ */ u3("div", { class: "bd-mem-err", role: "alert", children: [
          /* @__PURE__ */ u3("span", { children: `Could not read the memories again: ${loaded.error.message} The list shows them as last read.` }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => void load(), children: "Try again" })
        ] }),
        loaded.kind === "loading" ? /* @__PURE__ */ u3("p", { class: "bd-mem-quiet", role: "status", children: "Reading memories\u2026" }) : loaded.kind === "error" ? /* @__PURE__ */ u3("div", { class: "bd-mem-err", role: "alert", children: [
          /* @__PURE__ */ u3("span", { children: loaded.error.message }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => void load(), children: "Try again" })
        ] }) : shown.length === 0 ? searching ? /* @__PURE__ */ u3("div", { class: "bd-mem-quiet", children: [
          /* @__PURE__ */ u3("p", { children: "No memory matches." }),
          /* @__PURE__ */ u3(
            "button",
            {
              type: "button",
              class: "bd-btn bd-btn-sm",
              onClick: () => {
                setQuery("");
                queryRef.current = "";
                void load();
              },
              children: "Clear search"
            }
          )
        ] }) : /* @__PURE__ */ u3("div", { class: "bd-mem-quiet", children: [
          /* @__PURE__ */ u3("p", { children: "No memories yet." }),
          /* @__PURE__ */ u3("p", { class: "bd-mem-quiet-sub", children: "Add one and every agent session in this project starts with it." })
        ] }) : (
          // role="list": Safari drops a styled list's semantics without it.
          /* @__PURE__ */ u3("ul", { class: "bd-mem-list", role: "list", "aria-label": "Memories", children: shown.map((memory) => /* @__PURE__ */ u3(
            MemoryItem,
            {
              memory,
              item: items[memory.key] ?? null,
              busy: busy.includes(memory.key),
              paused,
              fresh: fresh === memory.key,
              when: changedLine(memory, now),
              pinned: pinned.includes(memory),
              edit: () => startEdit(memory),
              setDraft: (draft) => {
                const item = items[memory.key];
                if (item?.mode === "edit") patchItem(memory.key, { ...item, draft });
              },
              save: (readd) => {
                const item = items[memory.key];
                if (item?.mode === "edit") void save(memory.key, item, readd);
              },
              keepCurrent: () => keepCurrent(memory.key),
              leaveGone: () => leaveGone(memory.key),
              askForget: () => askForget(memory),
              forget: () => {
                const item = items[memory.key];
                if (item?.mode === "forget") void forget(memory, item);
              },
              cancel: (control) => cancelItem(memory.key, control),
              keepEditing: () => keepEdit(memory.key),
              discard: () => discardEdit(memory.key)
            },
            memory.key
          )) })
        )
      ] })
    ] });
  }
  var escapeCloses3 = (cancel) => (e3) => {
    if (e3.key !== "Escape" || composing(e3)) return;
    e3.preventDefault();
    e3.stopPropagation();
    cancel();
  };
  function MemoryItem(props) {
    const { memory, item, busy, paused, fresh, when: when2 } = props;
    const off = busy || paused !== null;
    const title = paused ?? void 0;
    const head = /* @__PURE__ */ u3("span", { class: "bd-mem-key", id: keyId(memory.key), title: memory.key, children: memory.key });
    if (item?.mode === "forget") {
      const stepId = controlId("ask", memory.key);
      return /* @__PURE__ */ u3("li", { class: "bd-mem-item", "data-mode": "forget", children: [
        head,
        /* @__PURE__ */ u3("div", { class: "bd-mem-forget", role: "group", "aria-labelledby": stepId, onKeyDown: escapeCloses3(() => !busy && props.cancel("forget")), children: [
          /* @__PURE__ */ u3("p", { class: "bd-mem-forget-h", id: stepId, children: `Forget ${memory.key}?` }),
          item.moved && /* @__PURE__ */ u3("p", { class: "bd-mem-alert", role: "alert", children: "This memory changed since you opened this step. This is its text now; nothing was forgotten." }),
          /* @__PURE__ */ u3("p", { class: "bd-mem-text bd-mem-quote", children: item.text }),
          /* @__PURE__ */ u3("p", { class: "bd-mem-hint", children: "Every agent session in this project will stop seeing this." }),
          /* @__PURE__ */ u3("div", { class: "bd-mem-acts", children: [
            /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-mem-danger", disabled: off, "aria-busy": busy || void 0, title, onClick: props.forget, children: "Forget memory" }),
            /* @__PURE__ */ u3("button", { type: "button", id: controlId("cancel", memory.key), class: "bd-btn bd-btn-sm", disabled: busy, onClick: () => props.cancel("forget"), children: "Cancel" })
          ] }),
          item.feedback && /* @__PURE__ */ u3(WriteMessage, { feedback: item.feedback })
        ] })
      ] });
    }
    if (item?.mode === "edit") {
      const fieldId2 = controlId("field", memory.key);
      const unchanged = item.draft.trim() === "" || item.draft === item.base && !item.refused;
      const go = () => {
        if (!unchanged && !off) props.save(item.refused === "gone");
      };
      return /* @__PURE__ */ u3("li", { class: "bd-mem-item", "data-mode": "edit", children: [
        head,
        /* @__PURE__ */ u3("div", { class: "bd-mem-was", "data-refused": item.refused, children: [
          /* @__PURE__ */ u3("span", { class: "bd-mem-label", children: item.refused === "changed" ? "Now in Beads" : item.refused === "gone" ? "Was" : "Now" }),
          /* @__PURE__ */ u3("p", { class: "bd-mem-text", children: memory.text })
        ] }),
        item.refused && /* @__PURE__ */ u3("p", { class: "bd-mem-alert", role: "alert", children: item.refused === "changed" ? `${memory.key} changed elsewhere while you were editing. Nothing was saved.` : "This memory was removed elsewhere. Nothing was saved. Add it again with your text, or discard it." }),
        /* @__PURE__ */ u3("label", { class: "bd-mem-label", for: fieldId2, children: "New text" }),
        /* @__PURE__ */ u3(
          EditField,
          {
            id: fieldId2,
            value: item.draft,
            busy,
            onInput: props.setDraft,
            onSave: item.refused ? () => {
            } : go,
            onEscape: () => !busy && props.cancel("edit")
          }
        ),
        props.pinned && !item.refused && /* @__PURE__ */ u3("p", { class: "bd-mem-hint", children: "Shown while you edit it, though the search leaves it out." }),
        !item.refused && /* @__PURE__ */ u3("p", { class: "bd-mem-hint", children: `${saveKey()} saves. The text above stays until you save.` }),
        item.asking ? /* @__PURE__ */ u3(DiscardAsk, { label: "Discard your changes?", onKeep: props.keepEditing, onDiscard: props.discard }) : /* @__PURE__ */ u3("div", { class: "bd-mem-acts", children: item.refused === "changed" ? /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: off || item.draft.trim() === "", "aria-busy": busy || void 0, title, onClick: go, children: "Save mine anyway" }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, onClick: props.keepCurrent, children: "Keep current" })
        ] }) : item.refused === "gone" ? /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: off || item.draft.trim() === "", "aria-busy": busy || void 0, title, onClick: go, children: "Add it again" }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, onClick: props.leaveGone, children: "Discard" })
        ] }) : /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: off || unchanged, "aria-busy": busy || void 0, title, onClick: go, children: "Save" }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, onClick: () => props.cancel("edit"), children: "Cancel" })
        ] }) }),
        item.feedback && /* @__PURE__ */ u3(WriteMessage, { feedback: item.feedback })
      ] });
    }
    return (
      // The name and its actions on one line, then the text, then when and by whom if Beads knows: a memory with no date simply ends
      // with its text, the same shape as the others.
      /* @__PURE__ */ u3("li", { class: "bd-mem-item", "data-fresh": fresh || void 0, children: [
        /* @__PURE__ */ u3("div", { class: "bd-mem-top", children: [
          head,
          /* @__PURE__ */ u3("span", { class: "bd-mem-tools", children: [
            /* @__PURE__ */ u3("button", { type: "button", id: controlId("edit", memory.key), class: "bd-mem-act", disabled: off, title, "aria-describedby": keyId(memory.key), onClick: props.edit, children: "Edit" }),
            /* @__PURE__ */ u3("button", { type: "button", id: controlId("forget", memory.key), class: "bd-mem-act", disabled: off, title, "aria-describedby": keyId(memory.key), onClick: props.askForget, children: "Forget" })
          ] })
        ] }),
        /* @__PURE__ */ u3("p", { class: "bd-mem-text", children: memory.text }),
        when2 && /* @__PURE__ */ u3("p", { class: "bd-mem-meta", children: when2 })
      ] })
    );
  }
  function EditField({ id, value, busy, onInput, onSave, onEscape }) {
    const ref = A2(null);
    h2(() => {
      const el2 = ref.current;
      if (!el2) return;
      el2.focus({ preventScroll: true });
      el2.setSelectionRange(el2.value.length, el2.value.length);
    }, []);
    return /* @__PURE__ */ u3(
      "textarea",
      {
        ref,
        id,
        class: "bd-input bd-ntext bd-mem-field",
        rows: 3,
        value,
        readOnly: busy,
        onInput: (e3) => onInput(e3.currentTarget.value),
        onKeyDown: (e3) => {
          escapeCloses3(onEscape)(e3);
          if (isSubmitKey(e3)) {
            e3.preventDefault();
            if (!busy) onSave();
          }
        }
      }
    );
  }
  function AddBox({ composer, busy, paused, set, add, cancel, keep, discard }) {
    const off = busy || paused !== null || composer.text.trim() === "";
    const taken = composer.taken;
    const go = () => {
      if (!off) add(false);
    };
    return /* @__PURE__ */ u3("div", { class: "bd-mem-add", role: "group", "aria-label": "New memory", onKeyDown: escapeCloses3(cancel), children: [
      /* @__PURE__ */ u3("label", { class: "bd-mem-label", for: "bd-mem-new", children: "Memory" }),
      /* @__PURE__ */ u3(EditField, { id: "bd-mem-new", value: composer.text, busy, onInput: (text2) => set({ text: text2 }), onSave: go, onEscape: cancel }),
      /* @__PURE__ */ u3(
        "input",
        {
          type: "text",
          class: "bd-input bd-mem-name",
          "aria-label": "Name (optional)",
          "aria-describedby": "bd-mem-name-hint",
          placeholder: "Name (optional)",
          value: composer.name,
          readOnly: busy,
          spellcheck: false,
          autoCapitalize: "off",
          onInput: (e3) => set({ name: e3.currentTarget.value, taken: null }),
          onKeyDown: (e3) => {
            if (isEnterInInput(e3)) {
              e3.preventDefault();
              go();
            }
          }
        }
      ),
      /* @__PURE__ */ u3("p", { class: "bd-mem-hint", id: "bd-mem-name-hint", children: `Leave the name empty and Beads makes one from the text. ${saveKey()} adds.` }),
      composer.vanished && /* @__PURE__ */ u3("p", { class: "bd-mem-alert", role: "alert", children: composer.vanished }),
      taken && /* @__PURE__ */ u3("div", { class: "bd-mem-taken", children: [
        /* @__PURE__ */ u3("p", { class: "bd-mem-alert", role: "alert", children: `A memory named ${taken.key} already exists. Nothing was saved.` }),
        /* @__PURE__ */ u3("p", { class: "bd-mem-text bd-mem-quote", children: taken.text })
      ] }),
      composer.asking ? /* @__PURE__ */ u3(DiscardAsk, { label: "Discard this memory?", onKeep: keep, onDiscard: discard }) : /* @__PURE__ */ u3("div", { class: "bd-mem-acts", children: [
        taken ? /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: off, "aria-busy": busy || void 0, title: paused ?? void 0, onClick: () => add(true), children: "Replace it with mine" }) : /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: off, "aria-busy": busy || void 0, title: paused ?? void 0, onClick: go, children: "Add memory" }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", disabled: busy, onClick: cancel, children: "Cancel" })
      ] }),
      composer.feedback && /* @__PURE__ */ u3(WriteMessage, { feedback: composer.feedback })
    ] });
  }
  function NoticeBar({ notice, undoing, paused, undo, hide }) {
    let body;
    if (notice.kind === "forgot") {
      body = /* @__PURE__ */ u3(S, { children: [
        /* @__PURE__ */ u3("span", { children: `Forgot ${notice.memory.key}.` }),
        /* @__PURE__ */ u3(
          "button",
          {
            type: "button",
            class: "bd-btn bd-btn-sm bd-btn-primary bd-mem-undo",
            disabled: undoing || paused !== null,
            "aria-busy": undoing || void 0,
            title: paused ?? `Bring back ${notice.memory.key} with the same text`,
            onClick: () => undo(notice.memory),
            children: "Undo"
          }
        ),
        notice.feedback && /* @__PURE__ */ u3(WriteMessage, { feedback: notice.feedback })
      ] });
    } else if (notice.kind === "back") {
      body = /* @__PURE__ */ u3("span", { children: `${notice.key} is back.` });
    } else {
      body = /* @__PURE__ */ u3(S, { children: [
        /* @__PURE__ */ u3("span", { children: `Could not bring back ${notice.memory.key}: a memory with that name exists now. Nothing was saved. Its text was:` }),
        /* @__PURE__ */ u3("p", { class: "bd-mem-text bd-mem-quote", children: notice.memory.text })
      ] });
    }
    return /* @__PURE__ */ u3("div", { class: "bd-nnote bd-mem-note", role: "status", "data-kind": notice.kind, children: [
      /* @__PURE__ */ u3("span", { class: "bd-mem-note-body", children: body }),
      /* @__PURE__ */ u3("button", { type: "button", class: "bd-nnote-x", "aria-label": "Hide this note", onClick: hide, children: /* @__PURE__ */ u3(IconX, {}) })
    ] });
  }
  function DiscardAsk({ label, detail, onKeep, onDiscard }) {
    const box = A2(null);
    h2(() => box.current?.focus({ preventScroll: true }), []);
    return /* @__PURE__ */ u3(
      "div",
      {
        ref: box,
        tabIndex: -1,
        class: "bd-confirm bd-mem-ask",
        role: "alertdialog",
        "aria-label": label,
        onKeyDown: (e3) => {
          if (e3.key === "Escape") {
            e3.preventDefault();
            e3.stopPropagation();
            onKeep();
          } else if (isConfirmKey(e3)) {
            e3.preventDefault();
            e3.stopPropagation();
            onDiscard();
          }
        },
        children: [
          /* @__PURE__ */ u3("span", { class: "bd-mem-ask-q", children: [
            label,
            detail && /* @__PURE__ */ u3("span", { class: "bd-mem-ask-d", children: detail })
          ] }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: onKeep, children: "Keep editing" }),
          /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", "data-tone": "danger", onClick: onDiscard, children: "Discard" })
        ]
      }
    );
  }

  // src/panel/ui/Footer.tsx
  function Footer() {
    const snapshot = useStore().snapshot;
    const now = useNow(6e4);
    if (!snapshot) return null;
    const t3 = totals({ beads: snapshot.beads, statuses: snapshot.statuses, readyIds: snapshot.readyIds, now });
    return /* @__PURE__ */ u3("footer", { class: "bd-foot", children: [
      /* @__PURE__ */ u3("span", { children: [
        /* @__PURE__ */ u3("b", { children: t3.open }),
        " open"
      ] }),
      /* @__PURE__ */ u3("span", { children: [
        /* @__PURE__ */ u3("b", { children: t3.inProgress }),
        " in progress"
      ] }),
      /* @__PURE__ */ u3("span", { "data-tone": t3.blocked > 0 ? "blocked" : void 0, children: [
        /* @__PURE__ */ u3("b", { children: t3.blocked }),
        " blocked"
      ] }),
      /* @__PURE__ */ u3("span", { children: [
        /* @__PURE__ */ u3("b", { children: t3.closedThisWeek }),
        " closed this week"
      ] })
    ] });
  }

  // src/panel/ui/styles.css
  var styles_default = `/*
 * Abacus panel. Colors come only from the host's --oc-* tokens (applyHostReady); the literals after each token are
 * fallbacks for a frame that has not been themed yet. Density follows the approved mockups: 26 px rows, 12.5 to 13 px text.
 */

.bd {
  --bd-bg: var(--oc-bg, #fffdf4);
  --bd-fg: var(--oc-fg, #494741);
  --bd-muted: var(--oc-muted, #6a6962);
  --bd-dim: color-mix(in srgb, var(--bd-muted) 66%, var(--bd-bg));
  --bd-field: var(--oc-elevated, #f5f3ea);
  --bd-line: var(--oc-border, #e6e4db);
  --bd-hover: var(--oc-hover, rgba(0, 0, 0, 0.04));
  --bd-press: var(--oc-active, rgba(0, 0, 0, 0.08));
  --bd-focus: var(--oc-focus, rgba(181, 79, 20, 0.35));
  --bd-accent: var(--oc-primary, #b54f14);
  --bd-accent-fg: var(--oc-primary-fg, #fffdf4);
  --bd-accent-text: var(--oc-primary-text, var(--bd-accent));
  --bd-ok: var(--oc-success, #5e760a);
  --bd-warn: var(--oc-warning, #b54f14);
  --bd-warn-text: var(--oc-warning-text, var(--bd-warn));
  --bd-err: var(--oc-error, #af3029);
  --bd-err-text: var(--oc-error-text, var(--bd-err));
  --bd-on: color-mix(in srgb, var(--bd-fg) 11%, var(--bd-field));
  --bd-sel: var(--oc-selection, rgba(118, 115, 111, 0.19));
  /* Pressed-in shading, from the foreground so it suits both themes. */
  --bd-inset: color-mix(in srgb, var(--bd-fg) 14%, transparent);
  /* Started work: amber, between the warning and success tokens, so it never reads as the accent's "changed" dot. */
  --bd-prog: color-mix(in srgb, var(--bd-warn) 55%, var(--bd-ok));
  --bd-mono: var(--oc-mono, ui-monospace, 'SFMono-Regular', Menlo, monospace);
  --bd-radius: calc(var(--oc-radius, 9px) - 3px);

  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 0;
  color: var(--bd-fg);
  font-family: var(--oc-font, system-ui, sans-serif);
  font-size: 13px;
  line-height: 1.35;
  -webkit-font-smoothing: antialiased;
}

.bd *,
.bd *::before,
.bd *::after {
  box-sizing: border-box;
}

/* Zero-specificity reset, so component classes win without !important. */
:where(.bd) button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}

:where(.bd) button:disabled {
  cursor: default;
}

.bd :focus-visible {
  outline: 2px solid var(--bd-focus);
  outline-offset: 1px;
}

.bd-i {
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ---------------------------------------------------------------- header */

.bd-head {
  flex-shrink: 0;
}

.bd-top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--bd-line);
}

.bd-proj {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.bd-proj .bd-i {
  color: var(--bd-accent-text);
}

.bd-proj-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-fresh {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--bd-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.bd-local {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bd-pulse {
  position: relative;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--bd-ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bd-ok) 18%, transparent);
}

/* One ring per successful refresh (the element is re-keyed on each one). */
.bd-pulse::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid var(--bd-ok);
  opacity: 0;
  animation: bd-ring 900ms cubic-bezier(0.2, 0.7, 0.3, 1) 1;
}

@keyframes bd-ring {
  from {
    transform: scale(1);
    opacity: 0.7;
  }
  to {
    transform: scale(2.8);
    opacity: 0;
  }
}

.bd-fresh[data-state='stale'] .bd-local {
  color: var(--bd-warn-text);
}

.bd-fresh[data-state='stale'] .bd-pulse {
  background: transparent;
  border: 1.5px solid var(--bd-warn);
  box-shadow: none;
}

.bd-fresh[data-state='stale'] .bd-pulse::after {
  display: none;
}

.bd-team {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--bd-dim);
}

.bd-unpub {
  color: var(--bd-warn-text);
}

.bd-stale {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--bd-warn) 30%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-warn) 9%, var(--bd-bg));
  font-size: 12px;
  animation: bd-drop 180ms ease-out;
}

.bd-stale > .bd-i {
  color: var(--bd-warn-text);
}

.bd-stale-msg {
  flex: 1;
  min-width: 0;
}

@keyframes bd-drop {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}

/* Loading: the header keeps its final shape, with the freshness text and tools held as quiet placeholders. */
.bd-fresh[data-state='loading'] .bd-pulse {
  background: color-mix(in srgb, var(--bd-muted) 35%, transparent);
  box-shadow: none;
}

.bd-fresh[data-state='loading'] .bd-pulse::after {
  display: none;
}

/* The loaded line's text, kept for its size and covered by the bar. */
.bd-skel-text {
  position: relative;
  color: transparent;
}

.bd-skel-text::before {
  content: '';
  position: absolute;
  inset: 50% 0 auto;
  height: 8px;
  margin-top: -4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bd-muted) 16%, transparent);
  animation: bd-breathe 1400ms ease-in-out infinite;
}

.bd-tools[data-loading] > * {
  animation: bd-breathe 1400ms ease-in-out infinite;
}

.bd-tools[data-loading] .bd-seg button {
  color: var(--bd-dim);
}

/* ---------------------------------------------------------------- tools */

.bd-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--bd-line);
}

.bd-search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  color: var(--bd-dim);
  cursor: text;
}

.bd-search:focus-within {
  border-color: color-mix(in srgb, var(--bd-accent) 55%, var(--bd-line));
  box-shadow: 0 0 0 2px var(--bd-focus);
}

.bd-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--bd-fg);
  font: inherit;
  font-size: 12.5px;
}

.bd-search input:focus-visible {
  outline: none;
}

.bd-search input::placeholder {
  color: var(--bd-dim);
}

.bd-search input::-webkit-search-cancel-button {
  -webkit-appearance: none;
}

/* The box sizes from the row, never from its hint, so the hint can be measured against it. */
.bd-search {
  container-type: inline-size;
}

/*
 * Too narrow for the whole hint: leave it out rather than cut it mid-word. The magnifier still says what the box is.
 * Widths are of the content box: the magnifier and gap (20 px), then "Search" or "Search activity" at 12.5 px.
 */
@container (max-width: 66px) {
  .bd-search input::placeholder {
    color: transparent;
  }
}

@container (max-width: 112px) {
  .bd-search[data-hint='long'] input::placeholder {
    color: transparent;
  }
}

.bd-seg {
  display: flex;
  flex-shrink: 0;
  height: 26px;
  padding: 2px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
}

.bd-seg button {
  display: flex;
  align-items: center;
  padding: 0 7px;
  border: 0;
  border-radius: calc(var(--bd-radius) - 2px);
  background: transparent;
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bd-seg button:hover {
  color: var(--bd-fg);
}

.bd-seg button[aria-pressed='true'] {
  background: var(--bd-on);
  color: var(--bd-fg);
  font-weight: 600;
}

.bd-iconbtn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: transparent;
  color: var(--bd-muted);
}

.bd-iconbtn:hover {
  background: var(--bd-hover);
  color: var(--bd-fg);
}

.bd-iconbtn[aria-expanded='true'] {
  border-color: color-mix(in srgb, var(--bd-accent) 55%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-accent) 14%, var(--bd-field));
  color: var(--bd-accent-text);
  box-shadow: inset 0 1px 2px var(--bd-inset);
}

.bd-iconbtn[data-active]::after {
  content: '';
  position: absolute;
  top: 3px;
  right: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--bd-accent);
}

.bd-unseen {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-accent) 14%, transparent);
  color: var(--bd-accent-text);
  font-weight: 600;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.bd-unseen::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bd-accent);
}

.bd-unseen:hover {
  background: color-mix(in srgb, var(--bd-accent) 22%, transparent);
}

/* ---------------------------------------------------------------- buttons */

.bd-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  color: var(--bd-fg);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
}

.bd-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bd-fg) 6%, var(--bd-field));
}

.bd-btn:active:not(:disabled) {
  background: var(--bd-on);
}

.bd-btn-sm {
  height: 24px;
  padding: 0 9px;
  font-size: 12px;
  flex-shrink: 0;
}

.bd-btn-primary {
  border-color: transparent;
  background: var(--bd-accent);
  color: var(--bd-accent-fg);
  font-weight: 600;
}

.bd-btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bd-accent) 88%, var(--bd-fg));
}

.bd-btn:disabled {
  opacity: 0.75;
}

/* Saving, with focus kept on the button: it reads as working, not as off. */
.bd-btn[aria-busy='true'] {
  cursor: progress;
}

.bd-btn[aria-disabled='true']:not([aria-busy='true']) {
  opacity: 0.75;
  cursor: default;
}

.bd-link {
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--bd-muted);
  font-size: 12px;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
  text-underline-offset: 2px;
}

.bd-link:hover {
  color: var(--bd-fg);
}

.bd-spin {
  width: 11px;
  height: 11px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: bd-turn 700ms linear infinite;
}

@keyframes bd-turn {
  to {
    transform: rotate(360deg);
  }
}

/* ---------------------------------------------------------------- body */

.bd-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/*
 * Scrollbars for a page without OpenChamber's guest styles (the dev preview). OpenChamber appends its own scrollbar
 * rules after the panel's, as \`*\` and \`:hover\`. These stay at zero specificity so the host's rules always win: a class
 * selector here beat \`*\` at rest and lost to \`:hover\`, so moving the pointer into the panel swapped the thin native
 * scrollbar for the host's 6 px one and the list reflowed.
 */
:where(.bd-body, .bd-dbody, .bd-theirs, .bdp-list, .bdp-preview) {
  scrollbar-width: thin;
}

:where(.bd-body, .bd-dbody) {
  scrollbar-color: color-mix(in srgb, var(--bd-muted) 35%, transparent) transparent;
}

/* The host's scrollbar takes width, so the list keeps its room for it: rows do not widen when it stops overflowing. */
:where(.bd-body) {
  scrollbar-gutter: stable;
}

/* ---------------------------------------------------------------- empty states */

.bd-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 320px;
  margin: 0 auto;
  padding: 52px 24px 32px;
  text-align: center;
  animation: bd-rise 260ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

@keyframes bd-rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

.bd-thread {
  margin-bottom: 16px;
  overflow: visible;
}

.bd-thread-line {
  stroke: var(--bd-line);
  stroke-width: 1.5;
}

.bd-thread-bead {
  fill: color-mix(in srgb, var(--bd-muted) 30%, var(--bd-bg));
}

.bd-thread-mid {
  fill: var(--bd-bg);
  stroke: var(--bd-muted);
  stroke-width: 1.5;
}

.bd-thread[data-tone='missing'] .bd-thread-mid {
  stroke-dasharray: 3 2.4;
}

.bd-thread[data-tone='warning'] .bd-thread-mid {
  stroke: var(--bd-warn);
  fill: color-mix(in srgb, var(--bd-warn) 22%, var(--bd-bg));
}

.bd-thread[data-tone='error'] .bd-thread-mid {
  stroke: var(--bd-err);
  fill: var(--bd-err);
}

.bd-thread[data-tone='ask'] .bd-thread-mid {
  stroke: var(--bd-accent);
  fill: color-mix(in srgb, var(--bd-accent) 22%, var(--bd-bg));
}

.bd-empty-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.005em;
  text-wrap: balance;
}

.bd-empty-body {
  margin: 6px 0 0;
  color: var(--bd-muted);
  font-size: 12.5px;
  line-height: 1.5;
  text-wrap: pretty;
}

.bd-empty-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 12px;
  margin-top: 16px;
}

.bd-empty-note {
  flex-basis: 100%;
  margin: 2px 0 0;
  color: var(--bd-dim);
  font-size: 11.5px;
}

.bd-empty-error {
  flex-basis: 100%;
  margin: 2px 0 0;
  color: var(--bd-err-text);
  font-size: 12px;
}

/* ---------------------------------------------------------------- the one-time project update */

/* The empty state's column, with a left-aligned stack under it: the confirm, the note and the details read as text, not as a caption. */
.bd-upd-acts {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  align-self: stretch;
  margin-top: 16px;
}

.bd-upd-ask,
.bd-upd-note {
  align-self: stretch;
  text-align: left;
}

.bd-upd-ask {
  padding: 10px 11px;
  font-size: 12px;
}

.bd-upd-ask .bd-pm-ask-t {
  font-size: 12.5px;
}

.bd-upd-ask .bd-pm-ask-acts {
  margin-top: 4px;
}

.bd-upd-note {
  font-size: 12px;
}

.bd-upd-note:focus {
  outline: none;
  box-shadow: none;
}

.bd-upd-note[data-tone='ok'] {
  border-left-color: var(--bd-ok);
}

.bd-upd-note[data-tone='info'] {
  border-left-color: var(--bd-accent);
}

.bd-upd-say {
  margin: 0;
  color: var(--bd-muted);
  font-size: 11.5px;
  line-height: 1.4;
  /* A live region that stays in the accessibility tree while empty (display:none would drop it, and the first message would not be announced). One line is kept, so nothing shifts when text arrives. */
  min-height: 1.4em;
}

.bd-upd-more {
  align-self: stretch;
  text-align: left;
}

.bd-upd-more > summary {
  width: max-content;
  margin: 0 auto;
  padding: 2px 4px;
  border-radius: var(--bd-radius);
  color: var(--bd-muted);
  font-size: 11.5px;
  cursor: pointer;
}

.bd-upd-more > summary:hover {
  color: var(--bd-fg);
}

.bd-upd-more > summary:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bd-focus);
}

.bd-upd-raw {
  max-height: 10.5em;
  margin: 6px 0 0;
  padding: 7px 8px;
  overflow: auto;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  color: var(--bd-fg);
  font-family: var(--bd-mono);
  font-size: 10.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* ---------------------------------------------------------------- loading */

.bd-skeleton {
  padding: 8px 0;
}

.bd-skel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 12px 0 14px;
}

.bd-skel-row i {
  display: block;
  height: 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bd-muted) 16%, transparent);
  animation: bd-breathe 1400ms ease-in-out var(--d, 0ms) infinite;
}

.bd-skel-row .bd-skel-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.bd-skel-row .bd-skel-id {
  width: 34px;
}

.bd-skel-row .bd-skel-bar {
  width: var(--w, 60%);
}

@keyframes bd-breathe {
  50% {
    opacity: 0.45;
  }
}

/* ---------------------------------------------------------------- list */

.bd-list {
  container-type: inline-size;
  margin: 0;
  /* Room under the last row, so scrolling to the end shows it whole above the footer's fade. */
  padding: 4px 0 32px;
  list-style: none;
  color: var(--bd-fg);
  transition: color 200ms ease;
}

/* A section's listbox shows focus through its cursor row; without one, the box itself shows it. */
.bd-list [role='listbox']:focus-visible {
  outline: none;
}

.bd-list [role='listbox']:focus-visible:not([aria-activedescendant]) {
  box-shadow: inset 0 0 0 2px var(--bd-focus);
}

/*
 * Stale: titles step toward the background, and secondary text keeps its usual mix from the stepped colors, so in both
 * themes it stays quieter than the titles. Status color loses some saturation so nothing reads as fresh.
 */
.bd-list[data-stale] {
  --bd-fg: color-mix(in srgb, var(--oc-fg, #494741) 72%, var(--bd-bg));
  --bd-muted: color-mix(in srgb, var(--oc-muted, #6a6962) 82%, var(--bd-bg));
  --bd-dim: color-mix(in srgb, var(--bd-muted) 66%, var(--bd-bg));
}

.bd-list[data-stale] :is(.bd-sd, .bd-bar, .bd-pr, .bd-ty),
.bd-list[data-stale] .bd-row[data-unseen]::before {
  filter: saturate(0.45);
}

/* ---------------------------------------------------------------- rows */

.bd-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  padding: 0 12px 0 calc(14px + var(--l, 0) * 16px);
  cursor: default;
  user-select: none;
}

.bd-row:hover {
  background: var(--bd-hover);
}

.bd-row[data-unseen] {
  background: color-mix(in srgb, var(--bd-accent) 7%, transparent);
}

.bd-row[data-unseen]:hover {
  background: color-mix(in srgb, var(--bd-accent) 11%, transparent);
}

.bd-row[data-unseen]::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 4px;
  width: 5px;
  height: 5px;
  margin-top: -2.5px;
  border-radius: 50%;
  background: var(--bd-accent);
}

/* Keyboard cursor: a hairline ring, so it reads over the unseen tint and the selection alike. */
.bd-row[data-cursor] {
  background: var(--bd-hover);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bd-accent) 45%, transparent);
}

.bd-row[data-selected] {
  background: var(--bd-sel);
}

.bd-row[data-selected]::after {
  content: '';
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: var(--bd-accent);
}

.bd-id {
  flex-shrink: 0;
  color: var(--bd-dim);
  font-family: var(--bd-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.bd-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/*
 * Done titles step back but stay readable: muted nudged toward the foreground measures about 6:1 on the light
 * background (5:1 on an unseen row's tint), and more in dark.
 */
.bd-row[data-done] .bd-title {
  color: color-mix(in srgb, var(--bd-muted) 80%, var(--bd-fg));
}

.bd-row[data-context] .bd-title {
  color: var(--bd-dim);
}

.bd-ty {
  display: flex;
  flex-shrink: 0;
  color: color-mix(in srgb, var(--bd-accent-text) 62%, var(--bd-muted));
}

.bd-row[data-done] .bd-ty,
.bd-row[data-context] .bd-ty {
  color: var(--bd-dim);
}

.bd-lb {
  flex-shrink: 1;
  min-width: 0;
  max-width: 76px;
  overflow: hidden;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--bd-fg) 7%, transparent);
  color: var(--bd-muted);
  font-size: 10.5px;
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-ep {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 1;
  min-width: 0;
  max-width: 96px;
  color: var(--bd-dim);
  font-size: 11px;
}

.bd-ep em {
  overflow: hidden;
  font-style: normal;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-ep-id {
  display: none;
  font-family: var(--bd-mono);
  font-size: 10.5px;
}

.bd-sub {
  flex-shrink: 0;
  color: var(--bd-dim);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.bd-sub[data-all] {
  color: color-mix(in srgb, var(--bd-ok) 70%, var(--bd-muted));
}

/* P0 to P4: urgent and high get fills; the rest step down to outlines. */
.bd-pr {
  flex-shrink: 0;
  width: 21px;
  padding: 3px 0;
  border-radius: 4px;
  font: 600 10px/1 var(--bd-mono);
  text-align: center;
}

.bd-pr[data-p='0'] {
  background: color-mix(in srgb, var(--bd-err) 20%, transparent);
  color: var(--bd-err-text);
}

.bd-pr[data-p='1'] {
  background: color-mix(in srgb, var(--bd-prog) 22%, transparent);
  color: color-mix(in srgb, var(--bd-prog) 75%, var(--bd-fg));
}

.bd-pr[data-p='2'] {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bd-fg) 24%, transparent);
  color: var(--bd-muted);
}

.bd-pr:is([data-p='3'], [data-p='4']) {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bd-fg) 13%, transparent);
  color: var(--bd-dim);
}

.bd-who {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bd-fg) 10%, transparent);
  color: var(--bd-muted);
  font: 600 8px/1 var(--bd-mono);
  letter-spacing: -0.02em;
}

.bd-who[data-none] {
  background: none;
}

.bd-age {
  flex-shrink: 0;
  width: 20px;
  color: var(--bd-dim);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* Row menu button: floats over the meta columns on hover, cursor, or selection. */
.bd-rowmore {
  position: absolute;
  top: 50%;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--bd-line);
  border-radius: calc(var(--bd-radius) - 1px);
  background: var(--bd-field);
  color: var(--bd-muted);
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity 100ms ease;
}

.bd-row:is(:hover, [data-cursor]) .bd-rowmore {
  opacity: 1;
}

.bd-rowmore:hover {
  color: var(--bd-fg);
}

/* Narrow panes drop the second label first, then labels and avatars. */
@container (max-width: 419px) {
  .bd-lb + .bd-lb {
    display: none;
  }

  /* Too narrow for about 10 characters of a long epic title: show the epic's short id instead. */
  .bd-ep:not([data-fits]) .bd-ep-name {
    display: none;
  }

  .bd-ep:not([data-fits]) .bd-ep-id {
    display: inline;
  }

  /* The status view's epic tag says more than a label, so labels give way to keep titles readable. */
  [data-view='status'] .bd-lb {
    display: none;
  }
}

@container (max-width: 339px) {
  .bd-lb,
  .bd-who {
    display: none;
  }
}

/* ---------------------------------------------------------------- status icons */

.bd-sd {
  display: inline-block;
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--bd-muted);
}

.bd-sd[data-look='progress'] {
  border-color: var(--bd-prog);
  background: conic-gradient(var(--bd-prog) 0 50%, transparent 0);
}

.bd-sd[data-look='blocked'] {
  width: 8px;
  height: 8px;
  margin: 0 0.5px;
  border: 0;
  background: var(--bd-err);
  box-shadow: inset 0 0 0 2px var(--bd-bg), 0 0 0 1.5px var(--bd-err);
}

.bd-sd[data-look='deferred'] {
  border-style: dashed;
  border-color: var(--bd-dim);
}

.bd-sd[data-look='done'] {
  border: 0;
  background: var(--bd-ok);
}

/* A status Beads does not describe: neutral, dotted, named on hover. */
.bd-sd[data-look='other'] {
  border-style: dotted;
  border-color: var(--bd-muted);
}

/*
 * Markers beyond the five built-ins, in their category's color, so none borrows a built-in's icon: the project's
 * statuses are diamonds (In review is not In progress), Beads' own extras are squares (Pinned is not Deferred, and not
 * a diamond like QA wait).
 */
.bd-sd[data-marker] {
  width: 8px;
  height: 8px;
  margin: 0 0.5px;
}

.bd-sd[data-marker='custom'] {
  border-radius: 1.5px;
  transform: rotate(45deg);
}

.bd-sd[data-marker='custom'][data-look='progress'] {
  background: linear-gradient(135deg, var(--bd-prog) 0 50%, transparent 0);
}

/* On ice: a light fill sets it apart from an unstarted project status's empty diamond. */
.bd-sd[data-marker='custom'][data-look='deferred'] {
  border-style: solid;
  border-color: var(--bd-muted);
  background: color-mix(in srgb, var(--bd-muted) 30%, transparent);
}

.bd-sd[data-marker='beads'] {
  border-style: solid;
  border-radius: 2px;
}

.bd-sd[data-marker='beads'][data-look='deferred'] {
  border-color: var(--bd-muted);
  background: color-mix(in srgb, var(--bd-muted) 55%, transparent);
}

.bd-sd[data-marker='beads'][data-look='progress'] {
  background: linear-gradient(to right, var(--bd-prog) 0 50%, transparent 0);
}

/* ---------------------------------------------------------------- epic view */

.bd-chev {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 12px;
  height: 18px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--bd-dim);
}

button.bd-chev:hover {
  color: var(--bd-fg);
}

.bd-chev .bd-i {
  transition: transform 140ms ease;
}

[data-collapsed] > :first-child .bd-chev .bd-i,
[data-collapsed] > .bd-chev .bd-i {
  transform: rotate(-90deg);
}

.bd-epic {
  position: relative;
  padding: 6px 0 4px;
  border-bottom: 1px solid var(--bd-line);
}

/* The collapse control sits beside the epic's listbox, drawn over the row's left edge. */
.bd-epic-chev {
  position: absolute;
  z-index: 1;
  top: 6px;
  left: 14px;
  height: 26px;
}

/* The epic option holds its progress line too (a listbox holds options only), so its row wraps onto two lines. */
.bd-row[data-variant='epic'] {
  flex-wrap: wrap;
  align-content: flex-start;
  row-gap: 2px;
  padding-top: 4px;
  padding-left: 33px;
}

/* The menu button and the unseen dot stay on the epic's title line, not the middle of both lines. */
.bd-row[data-variant='epic'] .bd-rowmore {
  top: 13px;
}

.bd-row[data-variant='epic'][data-unseen]::before {
  top: 13px;
}

[data-collapsed] > .bd-epic-chev .bd-i {
  transform: rotate(-90deg);
}

.bd-epic .bd-row[data-variant='epic'] .bd-title {
  font-weight: 600;
  letter-spacing: -0.005em;
}

.bd-epic .bd-row[data-variant='epic'] .bd-ty {
  color: var(--bd-accent-text);
}

.bd-epic .bd-row[data-variant='epic'][data-done] .bd-ty {
  color: var(--bd-dim);
}

.bd-prog {
  display: flex;
  flex-basis: 100%;
  align-items: center;
  gap: 8px;
  padding: 0 0 4px 21px;
  color: var(--bd-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bd-epic[data-collapsed] .bd-prog {
  padding-bottom: 2px;
}

.bd-bar {
  display: flex;
  flex: 1;
  min-width: 40px;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: color-mix(in srgb, var(--bd-fg) 9%, transparent);
}

.bd-bar i {
  display: block;
  height: 100%;
  transition: width 320ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.bd-bar i[data-look='done'] {
  background: var(--bd-ok);
}

.bd-bar i[data-look='progress'] {
  background: var(--bd-prog);
}

.bd-bar i[data-look='blocked'] {
  background: var(--bd-err);
}

.bd-prog-blk {
  color: var(--bd-err-text);
}

.bd-prog-new,
.bd-ux {
  color: var(--bd-accent-text);
  font-weight: 500;
}

/* "Not in an epic": a quiet small-caps divider rather than a section card. */
.bd-sect {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 12px 4px 14px;
  border: 0;
  background: none;
  color: var(--bd-dim);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: left;
}

.bd-sect:hover {
  color: var(--bd-muted);
}

.bd-sect .bd-n,
.bd-sect .bd-ux {
  letter-spacing: 0;
  text-transform: none;
}

.bd-sect .bd-ux {
  margin-left: auto;
  font-size: 11px;
}

/* ---------------------------------------------------------------- status view */

.bd-grp + .bd-grp {
  border-top: 1px solid var(--bd-line);
}

.bd-grp:last-child {
  padding-bottom: 4px;
}

.bd-grp-h {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 8px 12px 4px;
  border: 0;
  background: none;
  color: var(--bd-muted);
  font-size: 11.5px;
  font-weight: 600;
  text-align: left;
}

.bd-grp[data-collapsed] .bd-grp-h {
  padding-bottom: 7px;
}

.bd-grp-h:hover {
  color: var(--bd-fg);
}

.bd-grp-title {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-n {
  color: var(--bd-dim);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.bd-grp-h .bd-ux {
  margin-left: auto;
  font-size: 11px;
}

.bd-morerows {
  display: block;
  padding: 3px 12px 6px 53px;
  border: 0;
  background: none;
  color: var(--bd-accent-text);
  font-size: 11.5px;
}

.bd-morerows:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* ---------------------------------------------------------------- row menu */

.bd-menu {
  position: fixed;
  z-index: 10;
  min-width: 176px;
  padding: 4px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--oc-elevated, var(--bd-field));
  color: var(--oc-elevated-fg, var(--bd-fg));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22), 0 2px 6px rgba(0, 0, 0, 0.12);
  animation: bd-pop 120ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

@keyframes bd-pop {
  from {
    opacity: 0;
    transform: translateY(-3px) scale(0.98);
  }
}

.bd-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: calc(var(--bd-radius) - 2px);
  background: none;
  font-size: 12.5px;
  text-align: left;
}

.bd-menu-item .bd-i {
  color: var(--bd-muted);
}

.bd-menu-item:is(:hover, :focus-visible) {
  outline: none;
  background: var(--bd-hover);
}

.bd-menu-item:is(:hover, :focus-visible) .bd-i {
  color: var(--bd-fg);
}

.bd-menu-id {
  margin: 4px -4px -4px;
  padding: 5px 12px 6px;
  border-top: 1px solid var(--bd-line);
  /* Which bead the menu is for: information, so muted (readable in both themes), never the dim of something switched off. */
  color: var(--bd-muted);
  font: 10.5px/1.3 var(--bd-mono);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ---------------------------------------------------------------- filters */

.bd-filters {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 12px 10px;
  border-bottom: 1px solid var(--bd-line);
  background: color-mix(in srgb, var(--bd-field) 55%, var(--bd-bg));
  animation: bd-drop 160ms ease-out;
}

.bd-fline {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.bd-flabel {
  flex-shrink: 0;
  width: 54px;
  padding-top: 4px;
  color: var(--bd-dim);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.bd-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.bd-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  max-width: 100%;
  padding: 0 7px;
  border: 1px solid var(--bd-line);
  border-radius: 11px;
  background: var(--bd-bg);
  color: var(--bd-muted);
  font-size: 11.5px;
  white-space: nowrap;
}

.bd-chip:hover {
  color: var(--bd-fg);
}

.bd-chip[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--bd-accent) 50%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-accent) 12%, var(--bd-bg));
  color: var(--bd-fg);
  font-weight: 600;
}

.bd-chip .bd-pr {
  width: auto;
  padding: 0;
  background: none;
  box-shadow: none;
}

.bd-fsep {
  width: 1px;
  height: 14px;
  margin: 0 2px;
  background: var(--bd-line);
}

.bd-freset {
  margin-left: auto;
}

/* ---------------------------------------------------------------- footer */

.bd-foot {
  /* Above the epic chevrons (z-index 1), so its fade covers everything that scrolls under it. */
  position: relative;
  z-index: 2;
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 7px 12px;
  border-top: 1px solid var(--bd-line);
  background: var(--bd-bg);
  color: var(--bd-muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

/* A soft fade above the footer, so rows scroll under it rather than being cut off. */
.bd-foot::before {
  content: '';
  position: absolute;
  right: 0;
  bottom: 100%;
  left: 0;
  height: 28px;
  background: linear-gradient(to bottom, color-mix(in srgb, var(--bd-bg) 0%, transparent), color-mix(in srgb, var(--bd-bg) 92%, transparent));
  pointer-events: none;
}

.bd-foot b {
  color: var(--bd-fg);
  font-weight: 600;
}

.bd-foot [data-tone='blocked'],
.bd-foot [data-tone='blocked'] b {
  /* Toward the foreground: darker on light, lighter on dark, so the red reads in both themes. */
  color: color-mix(in srgb, var(--bd-err-text) 80%, var(--bd-fg));
}

/* ---------------------------------------------------------------- detail */

/* Read by screen readers only. */
.bd-vh {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.bd-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  outline: none;
  animation: bd-enter 170ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

/* Focus lands on the detail itself only so Escape and Tab start here; it draws no ring. */
.bd .bd-detail:focus-visible {
  outline: none;
}

@keyframes bd-enter {
  from {
    opacity: 0;
    transform: translateX(10px);
  }
}

.bd-dnav {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 39px;
  padding: 6px 10px 6px 6px;
  border-bottom: 1px solid var(--bd-line);
  transition: box-shadow 160ms ease;
}

/* Content scrolled under the top bar: a soft shade says there is more above. */
.bd-dnav[data-scrolled] {
  box-shadow: 0 6px 10px -6px color-mix(in srgb, var(--bd-fg) 22%, transparent);
}

.bd-back {
  border-color: transparent;
}

.bd-crumb {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--bd-muted);
  font-size: 12.5px;
  white-space: nowrap;
}

.bd-crumb-epic {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 2px 5px;
  margin-left: -3px;
  border: 0;
  border-radius: calc(var(--bd-radius) - 2px);
  background: none;
  color: var(--bd-muted);
}

.bd-crumb-epic span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.bd-crumb-epic .bd-i {
  color: var(--bd-dim);
}

.bd-crumb-epic:hover {
  background: var(--bd-hover);
  color: var(--bd-fg);
}

.bd-crumb-sep {
  color: var(--bd-dim);
}

.bd-crumb-here {
  flex-shrink: 0;
  color: var(--bd-fg);
  font-family: var(--bd-mono);
  font-size: 11px;
}

.bd-dacts {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  margin-left: auto;
}

/* The status menu at the top right. */
.bd-statbtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 5px 0 7px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  color: var(--bd-fg);
  font-size: 11.5px;
}

.bd-statbtn > .bd-i {
  color: var(--bd-dim);
}

.bd-statbtn:hover:not(:disabled),
.bd-statbtn[aria-expanded='true'] {
  border-color: color-mix(in srgb, var(--bd-fg) 22%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-fg) 5%, var(--bd-field));
}

/* ---------------------------------------------------------------- editing */

:is(.bd-statbtn, .bd-chipbtn, .bd-lbadd, .bd-addchip, .bd-addlink, .bd-edit, .bd-relx):disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.bd-popwrap {
  position: relative;
  display: inline-flex;
}

.bd-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 12;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: max-content;
  min-width: 168px;
  max-width: min(260px, calc(100vw - 24px));
  padding: 4px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--oc-elevated, var(--bd-field));
  color: var(--oc-elevated-fg, var(--bd-fg));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22), 0 2px 6px rgba(0, 0, 0, 0.12);
  animation: bd-pop 120ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.bd-pop[data-align='end'] {
  right: 0;
  left: auto;
}

/* Over the detail's header, a menu keeps a band of the page around it, so the words it covers end at a clean edge, not mid-letter. */
.bd-dnav .bd-pop {
  box-shadow: 0 0 0 6px var(--bd-bg), 0 12px 30px rgba(0, 0, 0, 0.24), 0 2px 6px rgba(0, 0, 0, 0.12);
}

.bd-pop .bd-menu-item[aria-checked='true'] {
  background: var(--bd-on);
  font-weight: 600;
}

.bd-pop .bd-menu-item .bd-pr {
  width: 22px;
}

.bd-menu-sep {
  margin-top: 2px;
  border-top: 1px solid var(--bd-line);
  border-radius: 0;
  color: var(--bd-muted);
}

.bd-popform {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 232px;
  padding: 4px;
}

.bd-flab {
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bd-popacts {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.bd-input,
.bd-select {
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--bd-line);
  border-radius: calc(var(--bd-radius) - 1px);
  background: var(--bd-bg);
  color: var(--bd-fg);
  font: inherit;
  font-size: 12.5px;
}

.bd-select {
  padding-right: 4px;
}

:is(.bd-input, .bd-select):focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--bd-accent) 55%, var(--bd-line));
  box-shadow: 0 0 0 2px var(--bd-focus);
}

.bd-input[aria-invalid='true'] {
  border-color: color-mix(in srgb, var(--bd-err) 60%, var(--bd-line));
}

.bd-input::placeholder {
  color: var(--bd-dim);
}

.bd-fieldmsg {
  margin: 0;
  padding: 0 2px;
  color: var(--bd-err-text);
  font-size: 11.5px;
  line-height: 1.4;
}

.bd-fieldmsg[data-tone='quiet'] {
  color: var(--bd-dim);
}

.bd-opts {
  margin: 0;
  padding: 0;
  list-style: none;
}

.bd-opt {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  padding: 0 8px;
  border-radius: calc(var(--bd-radius) - 2px);
  font-size: 12.5px;
  cursor: pointer;
}

.bd-opt:hover,
.bd-opt[aria-selected='true'] {
  background: var(--bd-hover);
}

.bd-opt[aria-selected='true'] {
  box-shadow: inset 2px 0 0 var(--bd-accent);
}

/* Fields in the header that open a picker look like what they show, with a quiet frame on hover. */
.bd-chipbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: -2px -3px;
  padding: 2px 3px;
  border: 0;
  border-radius: 5px;
  background: none;
  font: inherit;
}

.bd-chipbtn:hover:not(:disabled),
.bd-chipbtn[aria-expanded='true'] {
  background: var(--bd-hover);
  box-shadow: inset 0 0 0 1px var(--bd-line);
}

.bd-chipbtn.bd-assignee {
  margin: -2px -4px;
  padding: 2px 4px;
  font-size: 11.5px;
}

.bd-pr[data-p='none-set'] {
  color: var(--bd-dim);
  outline: 1px dashed var(--bd-line);
  outline-offset: -1px;
}

.bd-lbadd {
  height: 18px;
  padding: 0 6px;
  border: 1px dashed color-mix(in srgb, var(--bd-muted) 45%, transparent);
  border-radius: 9px;
  background: none;
  color: var(--bd-dim);
  font-size: 11px;
  line-height: 1;
}

.bd-lbadd:hover:not(:disabled),
.bd-lbadd[aria-expanded='true'] {
  border-style: solid;
  color: var(--bd-fg);
}

.bd-lbs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px 2px 4px;
}

.bd-lb-edit {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding-right: 2px;
}

.bd-lb-edit button {
  display: inline-flex;
  padding: 1px;
  border: 0;
  border-radius: 3px;
  background: none;
  color: var(--bd-dim);
}

.bd-lb-edit button:hover {
  background: var(--bd-hover);
  color: var(--bd-err-text);
}

/* A write that met a newer bead, may have saved, or was refused. */
.bd-wnote {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 10px 0 0 24px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--bd-warn) 35%, var(--bd-line));
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-warn) 8%, var(--bd-bg));
  font-size: 11.5px;
  line-height: 1.4;
}

.bd-wnote b {
  color: var(--bd-warn-text);
  font-weight: 600;
}

.bd-wnote[data-tone='error'] {
  border-color: color-mix(in srgb, var(--bd-err) 30%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-err) 7%, var(--bd-bg));
}

.bd-wnote[data-tone='note'] {
  border-color: var(--bd-line);
  background: var(--bd-field);
}

.bd-wnote-acts {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.bd-wmsg {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  margin: 0;
  color: var(--bd-err-text);
  font-size: 11.5px;
  line-height: 1.4;
}

.bd-wmsg[data-tone='note'] {
  color: var(--bd-muted);
}

.bd-paused {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 10px 12px 0;
  padding: 6px 9px;
  border: 1px solid color-mix(in srgb, var(--bd-warn) 30%, var(--bd-line));
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-warn) 8%, var(--bd-bg));
  color: var(--bd-warn-text);
  font-size: 11.5px;
}

.bd-paused-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--bd-warn);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bd-warn) 18%, transparent);
}

/* Relationship rows with a remove button that shows on hover or focus. */
.bd-relrow {
  position: relative;
}

.bd-relrow[data-x] .bd-rel {
  padding-right: 34px;
}

.bd-relx {
  position: absolute;
  top: 50%;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: calc(var(--bd-radius) - 2px);
  background: none;
  color: var(--bd-dim);
  opacity: 0;
  transform: translateY(-50%);
}

.bd-relrow:is(:hover, :focus-within) .bd-relx {
  opacity: 1;
}

.bd-relx:hover:not(:disabled) {
  background: var(--bd-hover);
  color: var(--bd-err-text);
}

.bd-addlink {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 26px;
  padding: 0 12px 0 30px;
  border: 0;
  background: none;
  color: var(--bd-dim);
  font-size: 12px;
  text-align: left;
}

.bd-addlink:hover:not(:disabled) {
  background: var(--bd-hover);
  color: var(--bd-fg);
}

.bd-linkadd {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 12px 4px 30px;
  padding: 6px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  animation: bd-drop 160ms ease-out;
}

.bd-linkrow {
  display: flex;
  gap: 5px;
}

.bd-linkrow .bd-select {
  flex: 0 0 auto;
  max-width: 112px;
}

.bd-linkrow .bd-input {
  flex: 1;
}

.bd-iconbtn-sm {
  width: 28px;
  height: 28px;
  border-color: transparent;
}

.bd-opt-bead .bd-title {
  font-size: 12.5px;
}

/* Section Edit buttons: quiet until the section is hovered or focused, always there for touch and keyboard. */
.bd-sh {
  display: flex;
  align-items: center;
}

.bd-sh .bd-sh-tog {
  flex: 1;
  min-width: 0;
}

.bd-sh .bd-sh-tog:disabled {
  cursor: default;
}

.bd-edit {
  flex-shrink: 0;
  height: 20px;
  margin-right: 8px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: calc(var(--bd-radius) - 2px);
  background: none;
  color: var(--bd-dim);
  font-size: 11px;
  opacity: 0.55;
  transition: opacity 120ms ease;
}

.bd-sec:is(:hover, :focus-within) .bd-edit,
.bd-dtitle:is(:hover, :focus-within) .bd-edit,
.bd-edit:focus-visible {
  opacity: 1;
}

.bd-edit:hover:not(:disabled) {
  border-color: var(--bd-line);
  background: var(--bd-field);
  color: var(--bd-fg);
}

@media (hover: none) {
  .bd-edit {
    opacity: 1;
  }
}

.bd-edit-title {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  height: 22px;
  margin: -1px -4px 0 auto;
  padding: 0 4px;
}

.bd-dtitle[data-editing] {
  align-items: flex-start;
}

.bd-dtitle[data-editing] .bd-editor {
  flex: 1;
  min-width: 0;
}

.bd-titlein {
  width: 100%;
  height: 30px;
  font-size: 14px;
  font-weight: 600;
}

.bd-sec[data-editing] .bd-sh .bd-sh-tog {
  color: var(--bd-accent-text);
}

.bd-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bd-sec-body .bd-editor {
  margin-left: -16px;
}

.bd-editor .bd-wnote {
  margin: 0;
}

.bd-ta {
  width: 100%;
  min-height: 84px;
  max-height: 60vh;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--bd-accent) 40%, var(--bd-line));
  border-radius: var(--bd-radius);
  background: var(--bd-bg);
  color: var(--bd-fg);
  font: 12px/1.55 var(--bd-mono);
  resize: vertical;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bd-accent) 9%, transparent);
  box-sizing: border-box;
}

.bd-ta:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bd-focus);
}

.bd-editor[data-busy] :is(.bd-ta, .bd-titlein) {
  opacity: 0.7;
}

.bd-edacts,
.bd-confirm {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.bd-edhint {
  margin-right: auto;
  color: var(--bd-dim);
  font-size: 10.5px;
}

.bd-confirm {
  padding: 5px 6px 5px 9px;
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  font-size: 11.5px;
}

.bd-confirm span {
  margin-right: auto;
}

.bd-btn[data-tone='danger'] {
  color: var(--bd-err-text);
}

.bd-wnote-edit {
  flex-direction: column;
  align-items: stretch;
}

.bd-wnote-edit .bd-wnote-acts {
  justify-content: flex-end;
}

.bd-theirs {
  max-height: 180px;
  overflow-y: auto;
  padding: 6px 8px 16px;
  border-radius: calc(var(--bd-radius) - 2px);
  background: var(--bd-bg);
  /* Long text fades out above the buttons instead of being cut under them; scrolling shows the rest. */
  mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent);
}

.bd-draft-lab {
  margin: 2px 0 -2px;
}

.bd-wmsg[data-tone='ok'] {
  color: var(--bd-ok-text, var(--bd-ok));
}

.bd-theirs-lab {
  display: block;
  margin-bottom: 2px;
  color: var(--bd-dim);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* Add a comment, as in the mockup: one quiet line that opens up as you write. */
.bd-cmp {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 6px;
  margin: 2px 0 6px 28px;
}

.bd-cmp-ta {
  min-height: 28px;
  padding: 5px 9px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  color: var(--bd-fg);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.45;
  resize: none;
  box-sizing: border-box;
}

.bd-cmp-ta::placeholder {
  color: var(--bd-dim);
}

.bd-cmp-ta:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--bd-accent) 55%, var(--bd-line));
  background: var(--bd-bg);
  box-shadow: 0 0 0 2px var(--bd-focus);
}

.bd-cmp-ta:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.bd-cmp .bd-wmsg {
  grid-column: 1 / -1;
}

.bd-cmp-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
}

.bd-cmp kbd {
  font-family: var(--bd-mono);
}

.bd-cmp:not([data-open]) .bd-cmp-acts .bd-btn {
  display: none;
}

.bd-cmp[data-open] {
  grid-template-columns: minmax(0, 1fr);
}

.bd-cmp[data-open] .bd-cmp-acts {
  justify-content: flex-end;
}

/* New bead: a sheet that drops from the top bar over whatever is showing. */
.bd {
  position: relative;
}

.bd-newbtn {
  flex-shrink: 0;
}

.bd-dacts .bd-newbtn {
  width: 24px;
  height: 24px;
  border-color: transparent;
}

.bd-sheet {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
}

.bd-scrim {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bd-bg) 55%, rgba(0, 0, 0, 0.35));
  animation: bd-fade 140ms ease-out;
}

@keyframes bd-fade {
  from {
    opacity: 0;
  }
}

.bd-create {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 9px;
  max-height: calc(100% - 24px);
  margin: 8px 8px 0;
  padding: 10px 12px 12px;
  overflow-y: auto;
  border: 1px solid var(--bd-line);
  border-radius: calc(var(--bd-radius) + 2px);
  background: var(--bd-bg);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.14);
  animation: bd-sheet 180ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

@keyframes bd-sheet {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}

.bd-create .bd-paused {
  margin: 0;
}

.bd-create-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-right: -6px;
  font-size: 13px;
}

.bd-cf {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.bd-cf > span {
  color: var(--bd-muted);
  font-size: 11px;
  font-weight: 600;
}

.bd-cf-row {
  display: flex;
  gap: 8px;
}

.bd-cf .bd-select {
  width: 100%;
}

.bd-cf-ta {
  min-height: 72px;
  font-family: inherit;
  font-size: 12.5px;
  box-shadow: none;
  border-color: var(--bd-line);
}

/* Missing context, one tap away: "Add  Description  Design  Link". */
.bd-addrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  padding: 8px 14px 9px 30px;
  border-top: 1px solid var(--bd-line);
}

.bd-addrow-lab {
  margin-right: 2px;
  color: var(--bd-dim);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bd-addchip {
  height: 20px;
  padding: 0 8px;
  border: 1px dashed color-mix(in srgb, var(--bd-muted) 45%, transparent);
  border-radius: 10px;
  background: none;
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bd-addchip::before {
  content: '+ ';
  color: var(--bd-dim);
}

.bd-addchip:hover:not(:disabled) {
  border-style: solid;
  border-color: color-mix(in srgb, var(--bd-accent) 50%, var(--bd-line));
  color: var(--bd-fg);
}

/* A thin sweep under the top bar while the full bead is read; the list's copy is already on screen. */
.bd-loadbar {
  position: relative;
  z-index: 3;
  height: 3px;
  margin-top: -3px;
  overflow: hidden;
  background: color-mix(in srgb, var(--bd-accent) 14%, transparent);
}

.bd-loadbar::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -40%;
  width: 40%;
  border-radius: 2px;
  background: linear-gradient(to right, transparent, var(--bd-accent) 40%, var(--bd-accent) 60%, transparent);
  animation: bd-sweep 1100ms cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

/* While the full bead is read, the parts that may still change breathe a little. */
.bd-detail[aria-busy='true'] .bd-cms {
  animation: bd-breathe 1400ms ease-in-out infinite;
}

@keyframes bd-sweep {
  to {
    left: 100%;
  }
}

.bd-dbody {
  flex: 1;
  min-height: 0;
  /* Clear of the Attach footer's fade, also when a field scrolls into view. */
  padding-bottom: 36px;
  scroll-padding-bottom: 40px;
  overflow-x: clip;
  overflow-y: auto;
}

.bd-derr {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin: 10px 12px 0;
  padding: 6px 8px 6px 10px;
  border: 1px solid color-mix(in srgb, var(--bd-err) 30%, var(--bd-line));
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-err) 8%, var(--bd-bg));
  font-size: 12px;
}

.bd-derr > span {
  flex: 1;
  min-width: 0;
}

.bd-derr[data-tone='note'] {
  border-color: color-mix(in srgb, var(--bd-warn) 30%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-warn) 8%, var(--bd-bg));
}

.bd-dskel {
  padding: 16px 14px;
}

.bd-dskel i {
  display: block;
  width: var(--w, 70%);
  height: 9px;
  margin-bottom: 11px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bd-muted) 16%, transparent);
  animation: bd-breathe 1400ms ease-in-out infinite;
}

.bd-dskel i:first-child {
  height: 14px;
  margin-bottom: 16px;
}

/* header */

.bd-dhead {
  padding: 12px 14px 10px;
}

.bd-dtitle {
  display: flex;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}

.bd-dtitle .bd-ty {
  margin-top: 2px;
  color: var(--bd-accent-text);
}

.bd-did {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: calc(100% - 24px);
  margin: 6px 0 0 24px;
  padding: 1px 6px;
  border: 0;
  border-radius: 4px;
  background: var(--bd-field);
  color: var(--bd-muted);
  font: 11px/1.5 var(--bd-mono);
}

.bd-did span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-did .bd-i {
  color: var(--bd-dim);
}

.bd-did:hover,
.bd-did:hover .bd-i {
  color: var(--bd-fg);
}

/* The id, type and parent share a line and wrap under one another at the same indent when the panel is narrow. */
.bd-didrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 6px 0 0 24px;
}

.bd-didrow .bd-did {
  margin: 0;
  max-width: 100%;
}

.bd-didrow .bd-chipbtn {
  gap: 3px;
  min-width: 0;
  color: var(--bd-muted);
  font-size: 11.5px;
  line-height: 1.5;
}

.bd-didrow .bd-chipbtn .bd-i:last-child {
  width: 10px;
  height: 10px;
  opacity: 0.7;
}

.bd-didrow .bd-chipbtn:hover:not(:disabled),
.bd-didrow .bd-chipbtn[aria-expanded='true'] {
  color: var(--bd-fg);
}

.bd-parentwrap {
  min-width: 0;
  max-width: 100%;
}

.bd-parent .bd-i:first-child {
  flex-shrink: 0;
  color: var(--bd-accent-text);
}

.bd-parent-t {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-parent[data-none] .bd-parent-t {
  font-style: italic;
}

.bd-menu-rule {
  height: 1px;
  margin: 2px -4px;
  background: var(--bd-line);
}

/* A long list of epics scrolls inside the menu instead of running off the panel. */
.bd-menu-scroll {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 232px;
  overflow-y: auto;
}

.bd-menu-epic .bd-i {
  flex-shrink: 0;
  color: var(--bd-accent-text);
}

.bd-menu-t {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-menu-sub {
  margin-left: auto;
  padding-left: 8px;
  color: var(--bd-muted);
  font: 10.5px/1 var(--bd-mono);
}

/* A menu item that only says something: muted (readable), not the dim of a switched-off choice. */
.bd-menu-item.bd-menu-note:disabled {
  height: auto;
  padding: 4px 8px 6px;
  color: var(--bd-muted);
  cursor: default;
  font-size: 11.5px;
  line-height: 1.4;
  white-space: normal;
}

.bd-dmeta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0 24px;
}

/* Every label shows here; rows in the list are the place for "two at most". */
.bd-dmeta .bd-lb {
  max-width: 100%;
  flex-shrink: 0;
}

.bd-dhint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0 24px;
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bd-dhint[data-tone='blocked'] {
  color: var(--bd-err-text);
}

.bd-hint-id {
  padding: 0 3px;
  border: 0;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  color: inherit;
  font: 11px/1.4 var(--bd-mono);
}

.bd-hint-id:hover {
  background: color-mix(in srgb, currentColor 18%, transparent);
}

.bd-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px 0 6px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bd-fg) 7%, transparent);
  color: var(--bd-fg);
  font-size: 11px;
  font-weight: 600;
}

.bd-pill[data-look='progress'] {
  background: color-mix(in srgb, var(--bd-prog) 16%, transparent);
  color: color-mix(in srgb, var(--bd-prog) 72%, var(--bd-fg));
}

.bd-pill[data-look='blocked'] {
  background: color-mix(in srgb, var(--bd-err) 14%, transparent);
  color: var(--bd-err-text);
}

.bd-pill[data-look='deferred'] {
  background: color-mix(in srgb, var(--bd-muted) 12%, transparent);
  color: var(--bd-muted);
}

.bd-pill[data-look='done'] {
  background: color-mix(in srgb, var(--bd-ok) 15%, transparent);
  color: color-mix(in srgb, var(--bd-ok) 70%, var(--bd-fg));
}

/* A status Beads does not describe: no color claims, just its name. */
.bd-pill[data-look='other'] {
  background: none;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bd-muted) 45%, transparent);
  color: var(--bd-muted);
}

.bd-pill .bd-sd[data-look='blocked'] {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--bd-err) 14%, var(--bd-bg)), 0 0 0 1.5px var(--bd-err);
}

.bd-assignee {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bd-assignee[data-none] {
  color: var(--bd-dim);
}

.bd-assignee[data-none] i {
  width: 14px;
  height: 14px;
  border: 1px dashed color-mix(in srgb, var(--bd-muted) 60%, transparent);
  border-radius: 50%;
}

.bd-av {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bd-fg) 9%, transparent);
  color: var(--bd-muted);
  font: 600 9px/1 var(--bd-mono);
  letter-spacing: -0.02em;
}

.bd-av[data-size='sm'] {
  width: 16px;
  height: 16px;
  font-size: 8px;
}

.bd-av[data-me] {
  background: color-mix(in srgb, var(--bd-accent) 20%, transparent);
  color: var(--bd-accent-text);
}

.bd-av[data-none] {
  background: none;
  border: 1px dashed color-mix(in srgb, var(--bd-muted) 60%, transparent);
  color: var(--bd-dim);
}

/* "Changed since you last looked" */

.bd-banner {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 0 12px 10px;
  padding: 6px 4px 6px 9px;
  border: 1px solid color-mix(in srgb, var(--bd-accent) 24%, transparent);
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-accent) 9%, var(--bd-bg));
  color: color-mix(in srgb, var(--bd-accent-text) 55%, var(--bd-fg));
  font-size: 11.5px;
  line-height: 1.45;
  animation: bd-drop 200ms ease-out;
}

.bd-banner::before {
  content: '';
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--bd-accent);
}

.bd-banner-txt {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.bd-banner-to {
  font-weight: 600;
}

.bd-banner-to[data-look='blocked'] {
  color: var(--bd-err-text);
}

.bd-banner-to[data-look='progress'] {
  color: color-mix(in srgb, var(--bd-prog) 75%, var(--bd-fg));
}

.bd-banner-to[data-look='done'] {
  color: color-mix(in srgb, var(--bd-ok) 75%, var(--bd-fg));
}

.bd-banner-x {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: -1px;
  padding: 0;
  border: 0;
  border-radius: calc(var(--bd-radius) - 2px);
  background: none;
  color: var(--bd-dim);
}

.bd-banner-x:hover {
  background: var(--bd-hover);
  color: var(--bd-fg);
}

/* sections */

.bd-sec {
  border-top: 1px solid var(--bd-line);
}

.bd-sh {
  margin: 0;
  font: inherit;
}

.bd-sh .bd-sh-tog {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px 6px;
  border: 0;
  background: none;
  color: var(--bd-muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-align: left;
  text-transform: uppercase;
}

.bd-sh .bd-sh-tog:hover {
  color: var(--bd-fg);
}

.bd-sh .bd-chev {
  height: 14px;
}

.bd-sec:not([data-open]) .bd-sh .bd-chev .bd-i {
  transform: rotate(-90deg);
}

.bd-sec:not([data-open]) .bd-sh .bd-sh-tog {
  padding-bottom: 8px;
}

.bd-sh-t {
  flex-shrink: 0;
}

.bd-sh .bd-n {
  flex-shrink: 0;
  letter-spacing: 0;
  text-transform: none;
}

.bd-peek {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--bd-dim);
  font-size: 11.5px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-sec-body {
  padding: 0 14px 10px 30px;
}

.bd-sec-body[hidden] {
  display: none;
}

[data-section='relationships'] .bd-sec-body {
  padding: 0 0 6px;
}

[data-section='activity'] .bd-sec-body {
  padding: 0 14px 4px;
}

/* markdown */

.bd-md {
  color: color-mix(in srgb, var(--bd-fg) 90%, var(--bd-muted));
  font-size: 12.5px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.bd-md > :first-child {
  margin-top: 0;
}

.bd-md > :last-child {
  margin-bottom: 0;
}

.bd-md :is(p, ul, ol, blockquote, pre, table) {
  margin: 0 0 7px;
}

.bd-md :is(ul, ol) {
  padding-left: 18px;
}

.bd-md li {
  margin: 2px 0;
}

.bd-md li:has(> [data-check]) {
  list-style: none;
  margin-left: -16px;
}

.bd-md :is(h1, h2, h3, h4, h5, h6) {
  margin: 10px 0 4px;
  color: var(--bd-fg);
  font-size: 12.5px;
  font-weight: 600;
}

.bd-md a:is([href^='http:' i], [href^='https:' i], [href^='mailto:' i]) {
  color: var(--bd-accent-text);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
  text-underline-offset: 2px;
  cursor: pointer;
}

.bd-md code {
  padding: 0 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--bd-fg) 7%, transparent);
  font: 11.5px/1.4 var(--bd-mono);
}

.bd-md pre {
  padding: 8px 10px;
  overflow-x: auto;
  border-radius: var(--bd-radius);
  background: var(--bd-field);
}

.bd-md pre code {
  padding: 0;
  background: none;
  font-size: 11px;
}

.bd-md blockquote {
  padding-left: 9px;
  border-left: 2px solid var(--bd-line);
  color: var(--bd-muted);
}

.bd-md hr {
  margin: 10px 0;
  border: 0;
  border-top: 1px solid var(--bd-line);
}

.bd-md table {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 11.5px;
}

.bd-md :is(th, td) {
  padding: 2px 6px;
  border: 1px solid var(--bd-line);
}

/* Task boxes, in descriptions and acceptance criteria alike. */
.bd-md [data-check],
.bd-ac-box {
  display: inline-block;
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  margin-right: 2px;
  border: 1.3px solid color-mix(in srgb, var(--bd-muted) 70%, transparent);
  border-radius: 2.5px;
  vertical-align: -1px;
}

.bd-md [data-check='done'],
.bd-ac li[data-done] .bd-ac-box {
  border-color: var(--bd-ok);
  background: var(--bd-ok);
  box-shadow: inset 0 0 0 1.5px var(--bd-bg);
}

.bd-ac {
  margin: 0;
  padding: 0;
  list-style: none;
}

.bd-ac li {
  display: flex;
  gap: 7px;
  margin-bottom: 4px;
  color: color-mix(in srgb, var(--bd-fg) 90%, var(--bd-muted));
  font-size: 12.5px;
  line-height: 1.45;
}

.bd-ac-box {
  margin-top: 3.5px;
}

.bd-ac li[data-done] .bd-md {
  color: var(--bd-muted);
}

/* Criteria that mix prose and lists: each block keeps a little air. */
.bd-acwrap > * + * {
  margin-top: 6px;
}

.bd-ac li {
  align-items: flex-start;
}

.bd-ac li[data-depth] {
  padding-left: 18px;
}

/* A written box is a checkbox: an 18 px target around a 12 px box, its text the label (a click there ticks too). */
.bd-ac-tick {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin: 0 -3px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  cursor: pointer;
}

.bd-ac-tick .bd-ac-box {
  position: relative;
  width: 12px;
  height: 12px;
  margin: 0;
  border-color: var(--bd-muted);
  border-radius: 3px;
  transition:
    background 140ms ease,
    border-color 140ms ease;
}

.bd-ac-tick:hover:not([aria-disabled]) .bd-ac-box {
  border-color: var(--bd-accent);
  background: color-mix(in srgb, var(--bd-accent) 10%, transparent);
}

.bd-ac-tick:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bd-focus);
}

.bd-ac-tick[aria-disabled] {
  cursor: default;
}

.bd-ac li[data-done] .bd-ac-tick .bd-ac-box {
  border-color: var(--bd-ok);
  background: var(--bd-ok);
  box-shadow: none;
}

/* The tick mark itself, drawn in the page colour on the filled box. */
.bd-ac li[data-done] .bd-ac-tick .bd-ac-box::after {
  position: absolute;
  top: 1px;
  left: 3.5px;
  width: 3px;
  height: 6px;
  border: solid var(--bd-bg);
  border-width: 0 1.6px 1.6px 0;
  content: '';
  transform: rotate(45deg);
}

/* Saving: the box already shows where it is going, and breathes until Beads answers. */
.bd-ac li[data-busy] .bd-ac-box {
  animation: bd-breathe 900ms ease-in-out infinite;
}

.bd-ac-text {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.bd-ac-tick[aria-disabled] + .bd-ac-text {
  cursor: default;
}

/* A list line without a box: a bullet, so it never looks like something to tick. */
.bd-ac-dot {
  flex-shrink: 0;
  width: 4px;
  height: 4px;
  margin: 7.5px 4px 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bd-muted) 75%, transparent);
}

.bd-ac-note {
  margin-top: 6px;
}

/* No criteria: one quiet line where the section would be, with its Add. */
.bd-noac {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0 4px 0 30px;
  border-top: 1px solid var(--bd-line);
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bd-noac span {
  flex: 1;
  min-width: 0;
}

.bd-noac .bd-edit {
  opacity: 1;
  color: var(--bd-muted);
}

/* relationships */

.bd-rgroup + .bd-rgroup {
  margin-top: 2px;
}

.bd-rlab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px 2px 30px;
  color: var(--bd-dim);
  font-size: 11px;
}

.bd-rlab b {
  color: var(--bd-muted);
  font-weight: 600;
}

.bd-rlab[data-tone='blocked'] b {
  color: var(--bd-err-text);
}

.bd-rlab .bd-bar {
  flex: 0 1 70px;
}

.bd-rel {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 26px;
  padding: 0 12px 0 30px;
  border: 0;
  background: none;
  font-size: 12.5px;
  text-align: left;
}

button.bd-rel:hover {
  background: var(--bd-hover);
}

button.bd-rel:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--bd-focus);
}

.bd-rel .bd-ty {
  color: var(--bd-accent-text);
}

.bd-rel[data-done] .bd-title {
  color: color-mix(in srgb, var(--bd-muted) 80%, var(--bd-fg));
}

.bd-rel[data-missing]:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--bd-focus);
}

.bd-rel[data-missing] .bd-title {
  color: var(--bd-dim);
  font-style: italic;
}

/* more */

.bd-more {
  display: grid;
  grid-template-columns: minmax(72px, max-content) minmax(0, 1fr);
  gap: 4px 14px;
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
}

.bd-more-row {
  display: contents;
}

.bd-more dt {
  color: var(--bd-dim);
}

.bd-more dd {
  margin: 0;
  min-width: 0;
  color: var(--bd-fg);
  overflow-wrap: anywhere;
}

.bd-more-row[data-group] dt {
  color: var(--bd-muted);
}

.bd-more-row[data-sub] dt {
  padding-left: 12px;
  font-family: var(--bd-mono);
  font-size: 11px;
}

.bd-more code {
  font: 11px/1.45 var(--bd-mono);
  white-space: pre-wrap;
  word-break: break-all;
}

/* Due and defer dates: the same label column as the fields under them, each value with its own small actions. */
.bd-dates {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bd-dates + .bd-more {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--bd-line);
}

.bd-daterow {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 0 14px;
  font-size: 12px;
  line-height: 1.45;
}

.bd-datelab {
  color: var(--bd-muted);
}

.bd-dateval {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

/* The value, then its actions on a line of their own, so they start at the same edge at every width. */
.bd-dateline {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-height: 22px;
}

.bd-datetext {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  color: var(--bd-fg);
  font-variant-numeric: tabular-nums;
}

.bd-datetext[data-none] {
  color: var(--bd-muted);
}

.bd-overdue {
  padding: 0 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--bd-err) 12%, transparent);
  color: var(--bd-err-text);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.01em;
}

.bd-dateacts {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  /* The buttons' own padding: their text lines up with the value above. */
  margin-left: -7px;
}

/* Quiet text actions that read as what they do, framed on hover like the section Edit buttons. */
.bd-datebtn {
  height: 22px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: calc(var(--bd-radius) - 2px);
  background: none;
  color: var(--bd-muted);
  font-size: 11.5px;
  white-space: nowrap;
}

.bd-datebtn:hover:not(:disabled),
.bd-datebtn:focus-visible {
  border-color: var(--bd-line);
  background: var(--bd-field);
  color: var(--bd-fg);
}

.bd-datebtn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.bd-daterow[data-busy] .bd-datetext {
  opacity: 0.6;
}

.bd-dateedit {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bd-dateedit .bd-input {
  width: 100%;
}

.bd-wnote-date {
  margin: 0;
}

/* comments */

.bd-cm {
  display: flex;
  gap: 8px;
  padding: 4px 0 9px;
}

.bd-cm-main {
  flex: 1;
  min-width: 0;
}

.bd-cm-who {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 7px;
  color: var(--bd-dim);
  font-size: 11.5px;
}

.bd-cm-who b {
  color: var(--bd-fg);
  font-weight: 600;
}

.bd-cm-txt {
  margin-top: 2px;
}

.bd-none {
  margin: 0 0 8px;
  color: var(--bd-dim);
  font-size: 12px;
}

.bd-stamp {
  margin: 2px 0 0;
  padding: 7px 0 2px;
  border-top: 1px dashed color-mix(in srgb, var(--bd-line) 80%, transparent);
  color: var(--bd-dim);
  font-size: 11px;
  line-height: 1.65;
}

.bd-stamp b {
  color: var(--bd-muted);
  font-weight: 500;
}

.bd-stamp-line {
  display: block;
}

/* ---------------------------------------------------------------- activity */

.bd-act {
  --bd-act-bar: 30px;
  padding-top: 0;
}

/* Count and Mark all seen stay in reach while the feed scrolls. */
.bd-act-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--bd-act-bar);
  padding: 0 12px 0 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--bd-line) 70%, transparent);
  background: var(--bd-bg);
  color: var(--bd-muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.bd-act-unseen {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--bd-accent-text);
  font-weight: 600;
}

.bd-act-unseen::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--bd-accent);
}

.bd-act-seen {
  margin-left: auto;
  font-size: 11.5px;
}

/* Not sticky: a pinned label would sit over the first line of the entry scrolling under it, leaving a row with no headline. */
.bd-day {
  padding: 9px 12px 3px 14px;
  color: var(--bd-muted);
  font-size: 11.5px;
  font-weight: 600;
}

/* Two lines: what changed and when, then which bead and who. The left column scans as a story, the right as a log. */
.bd-act-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  grid-template-areas:
    'mark what when'
    '.    bead who';
  align-items: center;
  column-gap: 7px;
  row-gap: 1px;
  min-height: 0;
  padding: 5px 12px 6px 14px;
}

.bd-act-row:not([data-gone]) {
  cursor: pointer;
}

.bd-act-row[data-unseen]::before {
  top: 13px;
}

.bd-act-mark {
  grid-area: mark;
  display: flex;
  justify-content: center;
}

.bd-act-ic {
  display: flex;
  color: var(--bd-muted);
}

.bd-act-ic[data-kind='created'] {
  color: var(--bd-ok);
}

.bd-act-ic[data-kind='deleted'] {
  color: var(--bd-err-text);
}

.bd-act-ic[data-kind='link'] {
  color: color-mix(in srgb, var(--bd-accent-text) 62%, var(--bd-muted));
}

.bd-act-what {
  grid-area: what;
  min-width: 0;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-act-when {
  grid-area: when;
  color: var(--bd-dim);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bd-act-bead {
  grid-area: bead;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.bd-act-bead .bd-title {
  color: var(--bd-muted);
  font-size: 12px;
}

/* Struck through but still readable: muted rather than dim, so the dark theme keeps enough contrast. */
.bd-act-row[data-gone] .bd-title {
  color: var(--bd-muted);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, currentColor 55%, transparent);
}

/* A stale list fades its muted text toward the background; these two stay at the theme's own muted colour. */
.bd-list[data-stale] .bd-act-row[data-gone] .bd-title,
.bd-list[data-stale] .bd-act-notitle {
  color: var(--oc-muted, #6a6962);
}

.bd-act-notitle {
  min-width: 0;
  overflow: hidden;
  color: var(--bd-muted);
  font-size: 12px;
  font-style: italic;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-act-gone {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bd-err) 11%, transparent);
  color: var(--bd-err-text);
  font-size: 10.5px;
  line-height: 15px;
}

/* Activity rows: the menu button sits on the first line, in place of the time, so it never covers who made the change. */
.bd-act-row .bd-rowmore {
  top: 13px;
}

.bd-act-row:is(:hover, [data-cursor]) .bd-act-when {
  visibility: hidden;
}

.bd-act-who {
  grid-area: who;
  max-width: 132px;
  overflow: hidden;
  color: var(--bd-dim);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
  justify-self: end;
}

.bd-fnote {
  margin: 0;
  color: var(--bd-muted);
  font-size: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .bd *,
  .bd *::before,
  .bd *::after {
    animation: none !important;
    transition: none !important;
  }
}

/* Leaving with a draft: asked once, under the top bar. */
.bd-leave {
  position: relative;
  z-index: 3;
  margin: 0;
  padding: 7px 10px 7px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--bd-warn) 30%, var(--bd-line));
  border-radius: 0;
  background: color-mix(in srgb, var(--bd-warn) 9%, var(--bd-bg));
  animation: bd-drop 160ms ease-out;
}

/* ---------------------------------------------------------------- send to agent */

/* A button's running spinner: an open arc that turns. */
.bd-spin {
  transform-origin: 8px 8px;
  animation: bd-turn 750ms linear infinite;
}

/* "Attach to" under a bead: where the chat stands, then three ways to hand the bead over, as one segmented control. */
.bd-attach {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 6px;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--bd-line);
  background: var(--bd-bg);
}

.bd-attach::before {
  content: '';
  position: absolute;
  right: 0;
  bottom: 100%;
  left: 0;
  height: 24px;
  background: linear-gradient(to bottom, color-mix(in srgb, var(--bd-bg) 0%, transparent), color-mix(in srgb, var(--bd-bg) 92%, transparent));
  pointer-events: none;
}

.bd-attach-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.bd-attach-lab {
  flex-shrink: 0;
  color: var(--bd-muted);
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bd-attach-note {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  color: var(--bd-fg);
  font-size: 11.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-attach-note[data-tone='muted'] {
  color: var(--bd-muted);
}

/* The open chat: a small lit dot, like a status light. */
.bd-attach-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bd-ok);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bd-ok) 22%, transparent);
}

.bd-attach-acts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
}

.bd-attach-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  height: 30px;
  padding: 0 6px;
  border: 0;
  background: none;
  color: var(--bd-fg);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.bd-attach-btn + .bd-attach-btn {
  border-left: 1px solid var(--bd-line);
}

.bd-attach-btn > span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.bd-attach-btn .bd-i {
  flex-shrink: 0;
  color: var(--bd-muted);
}

/* The likely choice carries the accent: the open chat, or a new session when there is none. */
.bd-attach-acts:not([data-nochat]) [data-attach='attach'],
.bd-attach-acts[data-nochat] [data-attach='session'] {
  color: var(--bd-accent-text);
  font-weight: 600;
}

.bd-attach-acts:not([data-nochat]) [data-attach='attach'] .bd-i,
.bd-attach-acts[data-nochat] [data-attach='session'] .bd-i {
  color: currentColor;
}

.bd-attach-btn:hover:not(:disabled) {
  background: var(--bd-hover);
}

.bd-attach-btn:active:not(:disabled) {
  background: var(--bd-press);
}

.bd-attach-btn:focus-visible {
  z-index: 1;
  outline: none;
  box-shadow: inset 0 0 0 2px var(--bd-focus);
}

.bd-attach-btn:disabled:not([data-running]) {
  color: var(--bd-dim);
}

.bd-attach-btn:disabled:not([data-running]) .bd-i {
  color: var(--bd-dim);
}

/* The running choice stays lit, with a sweep under it while OpenChamber works. */
.bd-attach-btn[data-running] {
  background: color-mix(in srgb, var(--bd-accent) 9%, transparent);
  color: var(--bd-accent-text);
  font-weight: 600;
}

.bd-attach-btn[data-running] .bd-i {
  color: currentColor;
}

.bd-attach-btn[data-running]::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: linear-gradient(to right, transparent, var(--bd-accent) 40%, var(--bd-accent) 60%, transparent);
  background-size: 50% 100%;
  background-repeat: no-repeat;
  animation: bd-attach-sweep 1100ms cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

@keyframes bd-attach-sweep {
  from {
    background-position: -100% 0;
  }
  to {
    background-position: 200% 0;
  }
}

/* Row menu: an action with nowhere to go says why, on the right. */
.bd-menu-item:disabled {
  color: var(--bd-dim);
}

.bd-menu-item:disabled .bd-i {
  color: var(--bd-dim);
}

.bd-menu-item:has(.bd-menu-off) {
  flex-wrap: wrap;
  row-gap: 0;
  height: auto;
  min-height: 28px;
  padding-block: 4px;
}

/* Why it is off, under its label, so the menu keeps its width. */
.bd-menu-off {
  flex-basis: 100%;
  padding-left: 22px;
  color: var(--bd-dim);
  font-size: 11px;
  white-space: nowrap;
}

/* ---------------------------------------------------------------- worktree confirm */

.bd-wt {
  gap: 10px;
}

.bd-wt-head {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}

.bd-wt-ic {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-accent) 12%, transparent);
  color: var(--bd-accent-text);
}

.bd-wt-headtext {
  min-width: 0;
}

.bd-wt-title {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.3;
}

.bd-wt-bead {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  margin: 2px 0 0;
  color: var(--bd-muted);
  font-size: 12px;
}

.bd-wt-beadtitle {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-wt-mono {
  font-family: var(--bd-mono);
  font-size: 12px;
}

.bd-wt-err {
  margin: -5px 0 0;
  color: var(--bd-err-text);
  font-size: 11.5px;
}

.bd-wt-note {
  margin: 0;
  color: var(--bd-muted);
  font-size: 11.5px;
  line-height: 1.45;
}

.bd-wt-tip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 10px;
  border: 1px solid color-mix(in srgb, var(--bd-accent) 28%, var(--bd-line));
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-accent) 7%, var(--bd-bg));
}

.bd-wt-tip p {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
}

.bd-wt-tip code {
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bd-fg) 8%, transparent);
  font: 11.5px var(--bd-mono);
  white-space: nowrap;
}

.bd-wt[aria-busy='true'] .bd-wt-note {
  color: var(--bd-fg);
}

/* ---------------------------------------------------------------- + menu picker (attach dialog) */

.bd-dialog {
  background: var(--bd-bg);
}

.bdp {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  container: bdp / inline-size;
}

.bdp-search {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 14px;
  border-bottom: 1px solid var(--bd-line);
  color: var(--bd-muted);
}

.bdp-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: none;
  background: none;
  color: var(--bd-fg);
  font: inherit;
  font-size: 13.5px;
}

/* The search box always holds focus here; the row itself is the field, so no ring. */
.bd .bdp-search input:focus-visible {
  outline: none;
}

.bdp-search input::placeholder {
  color: var(--bd-dim);
}

.bdp-error {
  margin: 0;
  padding: 7px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--bd-err) 30%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-err) 8%, var(--bd-bg));
  color: var(--bd-err-text);
  font-size: 12px;
}

.bdp-body {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  min-height: 0;
}

.bdp-list {
  min-height: 0;
  padding: 4px 0;
  overflow-y: auto;
}

.bdp-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 10px 0 12px;
  cursor: default;
  user-select: none;
}

.bdp-row[data-cursor] {
  background: var(--bd-sel);
}

.bdp-row[data-cursor]::after {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: var(--bd-accent);
}

.bdp-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bdp-row[data-done] .bdp-row-title {
  color: color-mix(in srgb, var(--bd-muted) 80%, var(--bd-fg));
}

.bdp-empty,
.bdp-none {
  margin: 0;
  padding: 14px;
  color: var(--bd-muted);
  font-size: 12px;
}

.bdp-preview {
  min-height: 0;
  overflow-y: auto;
  border-left: 1px solid var(--bd-line);
  background: var(--oc-muted-surface, color-mix(in srgb, var(--bd-fg) 3%, var(--bd-bg)));
}

.bdp-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px 18px;
}

.bdp-kind {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bdp-fullid {
  margin-left: auto;
  color: var(--bd-dim);
  font: 11px var(--bd-mono);
}

.bdp-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.3;
  text-wrap: pretty;
}

.bdp-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.bdp-who {
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bdp-text {
  font-size: 12.5px;
}

.bdp-sec {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--bd-line);
}

.bdp-sec-title {
  margin: 0;
  color: var(--bd-muted);
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bdp-card .bdp-none {
  padding: 0;
}

.bdp-foot {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--bd-line);
}

.bdp-keys {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  color: var(--bd-dim);
  font-size: 11px;
  white-space: nowrap;
}

.bdp-keys kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border: 1px solid var(--bd-line);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--bd-field);
  color: var(--bd-muted);
  font: 10.5px var(--bd-mono);
}

.bdp-keys kbd + kbd {
  margin-left: -1px;
}

.bdp-chip-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* A narrow dialog keeps the list and drops the preview. */
@container bdp (max-width: 519px) {
  .bdp-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .bdp-preview {
    display: none;
  }

  .bdp-keys {
    display: none;
  }

  .bdp-foot {
    justify-content: flex-end;
  }
}

/* ---------------------------------------------------------------- team line: Sync and Publish */

/* Read by screen readers, not shown. */
.bd-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.bd-teambar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 3px 8px 3px 12px;
  border-bottom: 1px solid var(--bd-line);
  background: color-mix(in srgb, var(--bd-fg) 2.5%, var(--bd-bg));
}

.bd-teambar .bd-team {
  flex: 1;
  gap: 6px;
  min-width: 0;
  font-size: 11.5px;
  color: var(--bd-muted);
  font-variant-numeric: tabular-nums;
}

.bd-team-text {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.bd-team-text > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
}

.bd-teambar .bd-unpub {
  flex-shrink: 0;
  cursor: help;
}

.bd-team-acts {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}

.bd-tbtn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 7px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: var(--bd-radius);
  background: none;
  color: var(--bd-muted);
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.bd-tbtn .bd-i {
  flex-shrink: 0;
}

.bd-tbtn-icon {
  justify-content: center;
  width: 24px;
  padding: 0;
}

.bd-tbtn:hover:not(:disabled) {
  background: var(--bd-hover);
  color: var(--bd-fg);
}

.bd-tbtn:active:not(:disabled) {
  background: var(--bd-press);
}

.bd-tbtn[data-tone='publish'] {
  border-color: color-mix(in srgb, var(--bd-warn) 32%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-warn) 8%, var(--bd-bg));
  color: var(--bd-warn-text);
  font-weight: 600;
}

.bd-tbtn[data-tone='publish']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bd-warn) 15%, var(--bd-bg));
  color: var(--bd-warn-text);
}

.bd-tbtn:disabled:not([data-running]) {
  opacity: 0.5;
}

/* The job running stays lit; the whole line carries a slow sweep until the snapshot says it ended. */
.bd-tbtn[data-running] {
  color: var(--bd-accent-text);
  font-weight: 600;
}

.bd-tbtn[data-running][data-tone='publish'] {
  color: var(--bd-warn-text);
}

.bd-teambar[data-running]::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 1.5px;
  background: linear-gradient(to right, transparent, var(--bd-accent) 40%, var(--bd-accent) 60%, transparent);
  background-size: 40% 100%;
  background-repeat: no-repeat;
  animation: bd-attach-sweep 1400ms cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

/* ---------------------------------------------------------------- publish preview */

.bd-pub {
  gap: 10px;
}

.bd-pub-lead {
  margin: 2px 0 0;
  color: var(--bd-muted);
  font-size: 12px;
  line-height: 1.4;
}

.bd-pub-list {
  display: flex;
  flex-direction: column;
  max-height: 260px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
}

.bd-pub-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 9px;
}

.bd-pub-item + .bd-pub-item {
  border-top: 1px solid color-mix(in srgb, var(--bd-line) 80%, transparent);
}

.bd-pub-bead {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  font-size: 12.5px;
}

.bd-pub-title {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-pub-plus {
  flex-shrink: 0;
  color: var(--bd-muted);
  font-size: 11px;
}

.bd-pub-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 5px;
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bd-pub-meta .bd-sep {
  color: var(--bd-dim);
}

.bd-pub-sum {
  color: var(--bd-fg);
}

.bd-pub-rest {
  margin: -4px 0 0;
  color: var(--bd-fg);
  font-size: 12px;
}

.bd-pub-note {
  margin: -2px 0 0;
  color: var(--bd-muted);
  font-size: 11.5px;
  line-height: 1.4;
}

.bd-pub-state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin: 0;
  padding: 9px 10px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  color: var(--bd-muted);
  font-size: 12px;
  line-height: 1.45;
}

.bd-pub-state[data-tone='note'] {
  border-color: color-mix(in srgb, var(--bd-warn) 32%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-warn) 8%, var(--bd-bg));
  color: var(--bd-warn-text);
}

.bd-pub-state[data-tone='error'] {
  border-color: color-mix(in srgb, var(--bd-err) 30%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-err) 6%, var(--bd-bg));
  color: var(--bd-err-text);
}

/* ---------------------------------------------------------------- sync problem card */

.bd-synccard {
  /* Calm by default (a backed-out conflict: nothing is lost), warning when editing is paused, error when a job failed. */
  --sc-tone: var(--oc-info, #205ea6);
  --sc-text: var(--oc-info-text, var(--sc-tone));
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 7px;
  margin: 8px 8px 0;
  padding: 9px 10px 10px 12px;
  border: 1px solid color-mix(in srgb, var(--sc-tone) 30%, var(--bd-line));
  border-radius: calc(var(--bd-radius) + 2px);
  background: color-mix(in srgb, var(--sc-tone) 6%, var(--bd-bg));
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--sc-tone) 70%, transparent);
  animation: bd-drop 180ms ease-out;
}

.bd-synccard[data-tone='warn'] {
  --sc-tone: var(--bd-warn);
  --sc-text: var(--bd-warn-text);
}

.bd-synccard[data-tone='error'] {
  --sc-tone: var(--bd-err);
  --sc-text: var(--bd-err-text);
}

.bd-sc-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 20px;
}

.bd-sc-ic {
  display: flex;
  color: var(--sc-text);
}

.bd-sc-name {
  color: var(--sc-text);
  font-size: 12.5px;
  font-weight: 650;
}

.bd-sc-close {
  margin: -2px -4px -2px auto;
}

.bd-sc-msg {
  margin: -3px 0 0 20px;
  font-size: 12px;
  line-height: 1.45;
}

.bd-sc-none {
  margin: 0 0 0 20px;
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bd-sc-beads {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 0 20px;
  padding: 0;
  list-style: none;
}

/* Only the first few beads show until "Show N more", so every card is whole. Once all show, they scroll inside the card so its actions stay in view. */
.bd-sc-beads[data-all] {
  max-height: 168px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.bd-sc-bead {
  flex-shrink: 0;
  padding: 6px 8px 7px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-bg);
}

.bd-sc-beadhead {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  font-size: 12.5px;
}

.bd-sc-title {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-sc-fields {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 5px 0 0;
}

.bd-sc-field {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1px 8px;
  font-size: 11.5px;
  line-height: 1.4;
}

.bd-sc-field dt {
  grid-column: 1 / -1;
  color: var(--bd-muted);
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.bd-sc-field dd {
  display: contents;
}

.bd-sc-side {
  color: var(--bd-muted);
}

.bd-sc-val {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--bd-mono);
  font-size: 11px;
}

.bd-sc-field[data-open] .bd-sc-val {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.bd-sc-more,
.bd-sc-morebeads {
  justify-self: start;
  font-size: 11.5px;
}

.bd-sc-more {
  grid-column: 2;
}

.bd-sc-morebeads,
.bd-sc-toggle {
  align-self: flex-start;
  margin-left: 20px;
}

.bd-sc-toggle {
  margin-top: -4px;
  font-size: 11.5px;
}

.bd-sc-acts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 1px 0 0 20px;
}

.bd-sc-hint {
  flex-basis: 100%;
  color: var(--bd-muted);
  font-size: 11px;
}

/* ---------------------------------------------------------------- needs me */

/*
 * A calm inbox: each section is a sentence-case heading with a tinted mark, each row a bead, the reason it is here, and its
 * actions under it. Decisions (Resolve, Respond) carry the accent; ways out (Keep, Dismiss, Defer) stay quiet.
 */
.bd-needs {
  padding-top: 0;
  /* Room for the last row's actions above the footer's fade. */
  padding-bottom: 56px;
}

.bd-nsec {
  padding-bottom: 6px;
}

.bd-nsec + .bd-nsec {
  border-top: 1px solid var(--bd-line);
}

.bd-nsec-h {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px 12px 5px;
  color: var(--bd-muted);
  font-size: 11.5px;
  font-weight: 600;
}

.bd-nsec-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--bd-accent) 13%, transparent);
  color: var(--bd-accent-text);
}

.bd-nsec-ic[data-section='stuck'] {
  background: color-mix(in srgb, var(--bd-prog) 18%, transparent);
  color: color-mix(in srgb, var(--bd-prog) 75%, var(--bd-fg));
}

.bd-nsec-ic[data-section='changed'] {
  background: color-mix(in srgb, var(--bd-fg) 7%, transparent);
}

.bd-nsec-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bd-accent);
}

.bd-nsec-title {
  margin: 0;
  font: inherit;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  color: var(--bd-fg);
}

.bd-nsec-act {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 400;
}

/* A two-line row: the bead, then why it is here and what can be done, set under the id. */
.bd-nrow {
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
  padding: 6px 12px 7px 14px;
}

/* The section already says these changed: the tint stays, the unseen dot (which read as an indent) does not. */
.bd-nrow[data-unseen]::before {
  display: none;
}

.bd-nrow-top {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  min-width: 0;
  min-height: 20px;
}

/* The list is plain; each item holds the focusable part (bead and why) and, beside it, the row's actions. */
.bd-nlist {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A question is the point of the row: its title gets two lines before it is cut. */
.bd-nrow-top .bd-title {
  display: -webkit-box;
  line-height: 18px;
  white-space: normal;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.bd-nrow-top :is(.bd-id, .bd-age) {
  line-height: 18px;
}

.bd-nrow-top .bd-sd {
  margin-top: 4.5px;
}

.bd-nmain {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  outline: none;
}

/* The row shows keyboard focus as the list's cursor ring does. */
.bd-nrow:has(> .bd-nmain:focus-visible) {
  box-shadow: inset 0 0 0 2px var(--bd-focus);
}

.bd-nwhy,
.bd-nrow > :not(.bd-nmain) {
  margin-left: 16px;
}

.bd-nwhy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.bd-why-by {
  color: var(--bd-dim);
}

.bd-nreason {
  align-self: center;
  margin-left: 2px;
}

.bd-why {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  margin: 0;
  color: color-mix(in srgb, var(--bd-muted) 82%, var(--bd-fg));
  font-size: 12px;
  line-height: 1.4;
}

.bd-why-text {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.bd-why > .bd-i {
  align-self: flex-start;
  margin-top: 2px;
}

.bd-why[data-tone='hold'] {
  color: var(--bd-warn-text);
}

.bd-why[data-tone='done'] {
  color: var(--bd-dim);
}

.bd-why-more {
  flex-shrink: 0;
  color: var(--bd-dim);
  font-size: 11px;
}

.bd-tag {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--bd-accent) 12%, transparent);
  color: var(--bd-accent-text);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.bd-tag[data-kind='plan'] {
  background: color-mix(in srgb, var(--bd-ok) 18%, transparent);
  color: color-mix(in srgb, var(--bd-ok) 58%, var(--bd-fg));
}

/* A help request is someone's words: set as a quote, three lines at most. */
.bd-quote {
  display: -webkit-box;
  margin: 1px 0;
  padding: 0 0 0 8px;
  overflow: hidden;
  border-left: 2px solid color-mix(in srgb, var(--bd-accent) 45%, var(--bd-line));
  color: var(--bd-fg);
  font-size: 12.5px;
  line-height: 1.45;
  white-space: pre-line;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.bd-nacts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 3px;
}

.bd-nacts-row,
.bd-nstep-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bd-nstep {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding: 8px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  cursor: auto;
  animation: bd-drop 160ms ease-out;
}

.bd-nstep .bd-input {
  width: 100%;
}

.bd-ntext {
  height: auto;
  min-height: 62px;
  padding: 6px 8px;
  line-height: 1.45;
  resize: vertical;
}

.bd-nstep-hint {
  margin: 0;
  /* Muted, not dim: it says what the button will do, and dim text was the faintest on screen in dark mode. */
  color: var(--bd-muted);
  font-size: 11px;
  line-height: 1.4;
}

/* A date as typed, with what Beads will store under it. */
.bd-date {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bd-date-preview {
  margin: 0;
  padding: 0 2px;
  color: var(--bd-dim);
  font-size: 11.5px;
  line-height: 1.4;
}

.bd-date-preview[data-kind='ok'] {
  color: var(--bd-fg);
  font-weight: 500;
}

.bd-nquiet {
  margin: 0;
  padding: 32px 16px;
  color: var(--bd-dim);
  font-size: 12.5px;
  text-align: center;
  animation: bd-rise 260ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

/* Something changed under the person (an agent got there first): said once, at the top, until hidden. */
.bd-nnotes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px 2px;
}

.bd-nnote {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 5px 6px 9px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  color: var(--bd-muted);
  font-size: 11.5px;
  line-height: 1.4;
  animation: bd-drop 180ms ease-out;
}

.bd-nnote > span {
  flex: 1;
  min-width: 0;
}

.bd-nnote-x {
  display: flex;
  padding: 2px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--bd-dim);
}

.bd-nnote-x:hover {
  background: var(--bd-hover);
  color: var(--bd-fg);
}

/* ---------------------------------------------------------------- header: Needs me tab, project menu */

/* Its count rides in the tab; zero shows none. The rail badge is a different count (unseen beads). */
.bd-seg-n {
  min-width: 16px;
  height: 15px;
  margin-left: 5px;
  padding: 0 4px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bd-accent) 16%, transparent);
  color: var(--bd-accent-text);
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.bd-seg button[aria-pressed='true'] .bd-seg-n {
  background: var(--bd-accent);
  color: var(--bd-accent-fg);
}

/* Four tabs and the tools do not fit one line in a narrow panel: the tabs take a line of their own, the search gets its room back. */
.bd-head {
  container: bdhead / inline-size;
}

@container bdhead (max-width: 419px) {
  .bd-tools {
    flex-wrap: wrap;
    row-gap: 7px;
  }

  .bd-tools .bd-seg {
    order: 1;
    flex-basis: 100%;
  }

  .bd-tools .bd-seg button {
    flex: 1 0 auto;
    justify-content: center;
    padding: 0 6px;
    white-space: nowrap;
  }
}

/* Too narrow for the name and the freshness line both: the menu's chevron gives its room to the name (hover still shows the button). */
@container bdhead (max-width: 359px) {
  .bd-projbtn > .bd-i:last-child {
    display: none;
  }
}

/* The project name opens the project menu. */
/* The frame reaches past the name so the folder icon stays where the plain name had it; the wrapper takes the offset, so the button keeps its full width. */
.bd-pm {
  min-width: 0;
  margin: -3px -6px;
}

.bd-projbtn {
  min-width: 0;
  max-width: 100%;
  padding: 3px 6px;
  border: 0;
  border-radius: var(--bd-radius);
  background: none;
  font-size: inherit;
}

.bd-projbtn:hover,
.bd-projbtn[aria-expanded='true'] {
  background: var(--bd-hover);
}

.bd-projbtn > .bd-i:last-child {
  color: var(--bd-dim);
  transition: transform 140ms ease;
}

.bd-projbtn[aria-expanded='true'] > .bd-i:last-child {
  transform: rotate(180deg);
}

.bd-pm .bd-pop {
  left: 10px;
}

.bd-pm-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 244px;
  padding: 6px 6px 5px;
}

.bd-pm-h {
  margin: 0;
  color: var(--bd-dim);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bd-pm-set {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bd-pm-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}

.bd-pm-days {
  width: 44px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.bd-pm-unit {
  color: var(--bd-muted);
}

/* Live updates: a hairline above sets it apart from the panel's own settings, since this one is written to the project. */
.bd-pm-live {
  padding-top: 8px;
  border-top: 1px solid var(--bd-line);
}

.bd-pm-live .bd-pm-label {
  font-weight: 500;
}

.bd-pm-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  color: var(--bd-fg);
  font-size: 11.5px;
  font-weight: 500;
}

.bd-pm-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--bd-muted);
}

.bd-pm-state[data-tone='ok'] .bd-pm-dot {
  background: var(--bd-ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bd-ok) 22%, transparent);
}

.bd-pm-state[data-tone='warn'] .bd-pm-dot {
  background: var(--bd-warn);
}

.bd-pm-state[data-tone='err'] .bd-pm-dot {
  background: var(--bd-err);
}

.bd-pm-state[data-tone='off'] .bd-pm-dot {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--bd-muted);
}

.bd-pm-say {
  margin: 0;
  padding: 0 2px;
  color: var(--bd-muted);
  font-size: 11.5px;
  line-height: 1.4;
}

/* The status line and the note take focus only so their words are read out; they are not controls, so no ring. */
.bd-pm-say:focus,
.bd-pm-note:focus {
  outline: none;
  box-shadow: none;
}

.bd-pm-note {
  margin: 0;
  padding: 5px 8px;
  border-left: 2px solid var(--bd-warn);
  border-radius: 0 var(--bd-radius) var(--bd-radius) 0;
  background: var(--bd-field);
  color: var(--bd-fg);
  font-size: 11.5px;
  line-height: 1.4;
}

.bd-pm-note[data-tone='error'] {
  border-left-color: var(--bd-err);
  color: var(--bd-err-text);
}

/* The confirm sits in the menu itself: the panel's frame allows no pop-up windows or modal dialogs. */
.bd-pm-ask {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 9px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  font-size: 11.5px;
  line-height: 1.45;
  animation: bd-pm-ask-in 160ms ease-out;
}

.bd-pm-ask p {
  margin: 0;
}

.bd-pm-ask-d {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bd-pm-ask-t {
  font-size: 12px;
  font-weight: 600;
}

.bd-pm-file {
  padding: 0 3px;
  border-radius: 3px;
  background: var(--bd-on);
  font-family: var(--bd-mono);
  font-size: 10.5px;
  white-space: nowrap;
}

.bd-pm-ask-acts {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}

@keyframes bd-pm-ask-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bd-pm-ask {
    animation: none;
  }
}

/* ------------------------------------------------------------------------------------------------- gates on the detail */

/* What holds the bead, right under its header: a held card, warm like a waiting hint, quieter than an error. */
.bd-gates-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 12px 12px;
}

.bd-gates {
  position: relative;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--bd-warn) 26%, var(--bd-line));
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-warn) 5%, var(--bd-bg));
  animation: bd-drop 200ms ease-out;
}

/* A rail down the left edge: the bead is held until these clear. */
.bd-gates::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: color-mix(in srgb, var(--bd-warn) 70%, var(--bd-bg));
}

.bd-gates-h {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 8px 10px 4px 14px;
  color: var(--bd-warn-text);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bd-gates-h .bd-n {
  letter-spacing: 0;
}

.bd-glist {
  margin: 0;
  padding: 0;
  list-style: none;
}

.bd-gate {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 10px 9px 14px;
  outline: none;
}

.bd-gate + .bd-gate {
  border-top: 1px solid color-mix(in srgb, var(--bd-warn) 14%, var(--bd-line));
}

.bd-gate:focus-visible {
  box-shadow: inset 0 0 0 2px var(--bd-focus);
}

/* An ask that found this gate already open: it lights up once, so the eye lands on it. */
.bd-gate[data-found] {
  animation: bd-gate-found 1.4s ease-out;
}

@keyframes bd-gate-found {
  from {
    background: color-mix(in srgb, var(--bd-accent) 16%, transparent);
  }
  to {
    background: transparent;
  }
}

.bd-gate-top {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.bd-gate-reason {
  min-width: 0;
  color: var(--bd-fg);
  font-size: 12.5px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.bd-gate-reason[data-none] {
  color: var(--bd-dim);
  font-style: italic;
}

.bd-gate-meta {
  margin: 0;
  color: color-mix(in srgb, var(--bd-muted) 82%, var(--bd-fg));
  font-size: 11.5px;
  line-height: 1.4;
}

.bd-gate-acts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
}

.bd-gate .bd-gstep {
  margin-top: 4px;
  background: var(--bd-bg);
}

.bd-gate-settled {
  padding-top: 2px;
}

/* Kinds that only say where they stand: neutral, so a person's review keeps the colour. */
.bd-tag[data-kind='timer'],
.bd-tag[data-kind='github'],
.bd-tag[data-kind='bead'],
.bd-tag[data-kind='other'] {
  background: color-mix(in srgb, var(--bd-fg) 8%, transparent);
  color: var(--bd-muted);
}

/* Asking with a reason: which kind, as two pressed-or-not buttons. */
.bd-gkind {
  display: flex;
  align-self: flex-start;
  padding: 2px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-bg);
}

.bd-gkind-opt {
  height: 22px;
  padding: 0 9px;
  border: 0;
  border-radius: calc(var(--bd-radius) - 2px);
  background: none;
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bd-gkind-opt:hover:not(:disabled) {
  color: var(--bd-fg);
}

.bd-gkind-opt[aria-pressed='true'] {
  background: var(--bd-on);
  color: var(--bd-fg);
  font-weight: 600;
  box-shadow: inset 0 1px 1px var(--bd-inset);
}

.bd-gnote {
  padding: 0 2px;
}

/* Beside Design's Edit: the way to ask for the plan's approval, as quiet as Edit until the section is hovered. */
.bd-planask {
  margin-right: 0;
  color: var(--bd-accent-text);
}

/* A bead Beads named that this list does not have: an id, not a link. */
.bd-hint-id[data-plain] {
  cursor: default;
}

.bd-menu-rule {
  height: 1px;
  margin: 4px 2px;
  background: var(--bd-line);
}

/* ---------------------------------------------------------------- history */

/* A timeline: a rail down the left, a dot per version, the day as a quiet label on the rail. */
[data-section='history'] .bd-sec-body {
  padding: 0 12px 10px 16px;
}

.bd-hist {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bd-hist-load,
.bd-hist-none,
.bd-hist-note {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 2px 0 4px 14px;
  color: var(--bd-dim);
  font-size: 11.5px;
}

.bd-hist-note {
  margin-top: 6px;
}

.bd-hist-err {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 2px 0 4px 14px;
  color: var(--bd-err-text);
  font-size: 11.5px;
}

.bd-hist-newer {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  margin: 0 0 4px;
  padding: 5px 8px;
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  color: var(--bd-muted);
  font-size: 11.5px;
}

.bd-hday-h {
  position: relative;
  margin: 6px 0 2px;
  padding-left: 14px;
  color: var(--bd-muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bd-hes,
.bd-hcs,
.bd-diff-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.bd-he {
  position: relative;
  padding: 3px 0 9px 14px;
  border-left: 1px solid var(--bd-line);
  margin-left: 3px;
}

.bd-hday:last-of-type .bd-he:last-child {
  border-left-color: transparent;
}

/* The dot: hollow for a change, filled for a review event, accent-ringed for the bead's creation. */
.bd-he::before {
  content: '';
  position: absolute;
  top: 7px;
  left: -4px;
  width: 7px;
  height: 7px;
  border: 1.5px solid color-mix(in srgb, var(--bd-muted) 70%, var(--bd-bg));
  border-radius: 50%;
  background: var(--bd-bg);
}

.bd-he[data-kind='gate']::before {
  border-color: color-mix(in srgb, var(--bd-warn) 70%, var(--bd-bg));
  background: color-mix(in srgb, var(--bd-warn) 40%, var(--bd-bg));
}

.bd-he[data-kind='gate'][data-what='resolved']::before {
  border-color: color-mix(in srgb, var(--bd-ok) 70%, var(--bd-bg));
  background: color-mix(in srgb, var(--bd-ok) 40%, var(--bd-bg));
}

.bd-he[data-kind='created']::before {
  border-color: var(--bd-accent);
}

.bd-he-top {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  color: var(--bd-dim);
  font-size: 11px;
  line-height: 1.6;
}

.bd-he-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.bd-he-who {
  min-width: 0;
  overflow: hidden;
  color: var(--bd-muted);
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-he-who[data-unknown] {
  color: var(--bd-dim);
  font-weight: 400;
  font-style: italic;
  text-decoration: underline dotted color-mix(in srgb, currentColor 50%, transparent);
  text-underline-offset: 2px;
  cursor: help;
}

.bd-he-gate {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 1px 0 0;
  color: var(--bd-fg);
  font-size: 12.5px;
}

.bd-he[data-kind='gate'] .bd-he-gate .bd-i {
  color: var(--bd-warn-text);
}

.bd-he[data-what='resolved'] .bd-he-gate .bd-i {
  color: color-mix(in srgb, var(--bd-ok) 75%, var(--bd-fg));
}

.bd-he-reason {
  margin: 1px 0 0 18px;
  color: var(--bd-dim);
  font-size: 11.5px;
  line-height: 1.4;
}

/* One field per line: its name, before and after, and Restore at the end. */
.bd-hc {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr) auto;
  grid-template-areas:
    'f v a'
    'd d d';
  align-items: baseline;
  column-gap: 8px;
  padding: 2px 0;
  font-size: 12.5px;
  line-height: 1.45;
}

.bd-hc-f {
  grid-area: f;
  overflow: hidden;
  color: var(--bd-muted);
  font-size: 11.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-hv,
.bd-hc-what {
  grid-area: v;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 1px 6px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.bd-hc-what {
  color: var(--bd-muted);
}

.bd-hv[data-stacked] {
  flex-direction: column;
  gap: 1px;
}

.bd-hv-to {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  /* Names and statuses break between words, never inside one. */
  overflow-wrap: normal;
}

.bd-hv[data-stacked] .bd-hv-to {
  display: block;
}

.bd-rs-diff {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bd-hv-old {
  color: var(--bd-dim);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, currentColor 55%, transparent);
}

.bd-hv-new {
  color: var(--bd-fg);
}

.bd-hv-arrow {
  color: var(--bd-dim);
}

.bd-hv-new[data-look='blocked'] {
  color: var(--bd-err-text);
}

.bd-hv-new[data-look='progress'] {
  color: color-mix(in srgb, var(--bd-prog) 75%, var(--bd-fg));
}

.bd-hv-new[data-look='done'] {
  color: color-mix(in srgb, var(--bd-ok) 75%, var(--bd-fg));
}

.bd-hv-labels .bd-lb[data-diff='add'] {
  background: color-mix(in srgb, var(--bd-ok) 16%, transparent);
  color: color-mix(in srgb, var(--bd-ok) 70%, var(--bd-fg));
}

.bd-hv-labels .bd-lb[data-diff='add']::before {
  content: '+';
}

.bd-hv-labels .bd-lb[data-diff='del'] {
  text-decoration: line-through;
}

.bd-hc-act {
  grid-area: a;
  justify-self: end;
  min-width: 0;
}

/* A refusal or a message takes the whole line under the change. */
.bd-hc-act:has(.bd-rs[data-refused], .bd-wmsg) {
  grid-column: 1 / -1;
  grid-row: 3;
  justify-self: stretch;
}

.bd-hc-diff {
  grid-area: d;
  min-width: 0;
}

/* The restore action: readable at rest (muted text, a visible outline), so it never depends on hover, which touch does not have. */
.bd-rs-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  border: 1px solid color-mix(in srgb, var(--bd-line) 70%, transparent);
  border-radius: var(--bd-radius);
  background: none;
  color: var(--bd-muted);
  font-size: 11.5px;
  white-space: nowrap;
}

.bd-hc:hover .bd-rs-btn,
.bd-rs-btn:focus-visible {
  border-color: var(--bd-line);
  color: var(--bd-fg);
}

.bd-rs-btn:hover:not(:disabled) {
  background: var(--bd-hover);
  color: var(--bd-accent-text);
}

.bd-rs-btn[aria-busy='true'] {
  color: var(--bd-muted);
}

/* Changed again since: a small mark says a choice comes first. */
.bd-rs[data-state='changed'] .bd-rs-btn .bd-i {
  color: var(--bd-warn-text);
}

.bd-rs-tag {
  display: block;
  max-width: 7.5em;
  color: var(--bd-muted);
  font-size: 11px;
  line-height: 1.3;
  text-align: right;
}

.bd-rs {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  outline: none;
}

.bd-rs[data-refused] {
  align-items: stretch;
  margin: 4px 0 2px;
  padding: 7px 9px 8px;
  border: 1px solid color-mix(in srgb, var(--bd-warn) 32%, var(--bd-line));
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-warn) 7%, var(--bd-bg));
  animation: bd-drop 160ms ease-out;
}

.bd-rs-msg {
  margin: 0;
  color: var(--bd-muted);
  font-size: 11.5px;
  line-height: 1.45;
}

.bd-rs-msg b {
  color: var(--bd-warn-text);
  font-weight: 600;
}

.bd-rs-msg[data-tone='done'] {
  color: color-mix(in srgb, var(--bd-ok) 75%, var(--bd-fg));
}

.bd-rs-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bd-rs-acts .bd-btn {
  white-space: normal;
  height: auto;
  min-height: 24px;
  padding-block: 3px;
  text-align: left;
}

/* Compact diff: removed and added lines tinted, unchanged runs folded into a count. */
.bd-diff {
  margin: 3px 0 2px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--bd-line) 80%, transparent);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  font-family: var(--bd-mono);
  font-size: 11px;
  line-height: 1.5;
}

.bd-diff-line {
  display: flex;
  gap: 6px;
  padding: 0 8px 0 4px;
}

.bd-diff-mark {
  flex-shrink: 0;
  width: 9px;
  color: var(--bd-dim);
  text-align: center;
}

.bd-diff-t {
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.bd-diff-line[data-kind='same'] .bd-diff-t {
  color: var(--bd-muted);
}

.bd-diff-line[data-kind='del'] {
  background: color-mix(in srgb, var(--bd-err) 9%, transparent);
}

.bd-diff-line[data-kind='del'] .bd-diff-t {
  color: var(--bd-err-text);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
}

.bd-diff-line[data-kind='add'] {
  background: color-mix(in srgb, var(--bd-ok) 11%, transparent);
}

.bd-diff-line[data-kind='add'] .bd-diff-mark,
.bd-diff-line[data-kind='add'] .bd-diff-t {
  color: color-mix(in srgb, var(--bd-ok) 70%, var(--bd-fg));
}

.bd-diff-skip {
  padding: 1px 8px 1px 19px;
  color: var(--bd-dim);
  font-family: var(--oc-font, system-ui, sans-serif);
  font-size: 10.5px;
  font-style: italic;
  background: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--bd-line) 45%, transparent) 4px 5px);
}

.bd-diff-more {
  margin: 2px 8px 4px 19px;
  font-family: var(--oc-font, system-ui, sans-serif);
  font-size: 11px;
}

.bd-hc-cut {
  margin: 2px 0 0;
  color: var(--bd-dim);
  font-size: 11px;
}

.bd-hist-older {
  align-self: flex-start;
  margin: 4px 0 0 14px;
}

/* Activity: a restore chosen from a row's menu, above the feed. */
.bd-act-rs {
  position: sticky;
  top: var(--bd-act-bar);
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 12px 8px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--bd-accent) 22%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-accent) 5%, var(--bd-bg));
  animation: bd-drop 160ms ease-out;
}

.bd-act-rs-top {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 12px;
}

.bd-act-rs-top > .bd-i {
  color: var(--bd-accent-text);
}

.bd-act-rs-what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-act-rs-what .bd-title {
  color: var(--bd-muted);
}

.bd-act-rs .bd-rs {
  align-items: flex-start;
}

.bd-act-rs .bd-rs[data-refused] {
  margin: 0;
}

/* ---------------------------------------------------------------- project menu: pages */

/* A page the menu opens: its name, what it holds, and an arrow that says it goes somewhere. */
.bd-pm-go {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 1px 8px;
  width: 100%;
  padding: 6px 6px 6px 8px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  text-align: left;
}

.bd-pm-go:hover {
  background: color-mix(in srgb, var(--bd-fg) 6%, var(--bd-field));
}

.bd-pm-go-t {
  font-size: 12.5px;
  font-weight: 600;
}

.bd-pm-go-d {
  grid-row: 2;
  color: var(--bd-muted);
  font-size: 11px;
  line-height: 1.35;
}

.bd-pm-go .bd-i {
  grid-row: 1 / span 2;
  grid-column: 2;
  color: var(--bd-muted);
  transform: rotate(-90deg);
}

/* ---------------------------------------------------------------- memories page */

/*
 * What every agent session in the project starts with. Set like notes on a board: the name small and exact, the text at
 * reading size, and nothing destructive that is one click away. Each memory hangs off a hairline rule on its left that
 * warms to the accent while it is being changed, and red while a forget is asked.
 */
.bd-mem {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  animation: bd-enter 170ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.bd-mem-h {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  outline: none;
}

.bd-mem-h .bd-n {
  color: var(--bd-muted);
  font-size: 12px;
}

.bd-mem-addbtn .bd-i {
  margin-left: -2px;
}

.bd-mem-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 10px 12px 20px;
  overflow-y: auto;
}

.bd-mem-lede {
  margin: 0;
  color: var(--bd-muted);
  font-size: 12px;
  line-height: 1.45;
}

.bd-mem-search {
  flex: none;
  height: 28px;
}

.bd-mem-body > .bd-paused {
  margin: 0;
}

.bd-mem-note {
  align-items: center;
  color: var(--bd-fg);
  font-size: 12px;
}

.bd-mem-note-body {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  min-width: 0;
}

.bd-mem-note-body > span {
  overflow-wrap: anywhere;
}

/* After a forget: tinted with the accent so it is seen, with Undo as the one strong button on it. */
.bd-mem-note[data-kind='forgot'] {
  border-color: color-mix(in srgb, var(--bd-accent) 45%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-accent) 10%, var(--bd-bg));
  font-weight: 500;
}

.bd-mem-note .bd-mem-quote {
  flex-basis: 100%;
  margin: 0;
  font-weight: 400;
}

.bd-mem-note[data-kind='taken'] {
  border-color: color-mix(in srgb, var(--bd-warn) 35%, var(--bd-line));
}

.bd-mem-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bd-mem-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 0 10px 11px;
  border-bottom: 1px solid var(--bd-line);
}

.bd-mem-item:last-child {
  border-bottom: 0;
}

.bd-mem-item::before {
  content: '';
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 0;
  width: 2px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--bd-muted) 30%, transparent);
  transition: background 160ms ease;
}

.bd-mem-item:hover::before,
.bd-mem-item:focus-within::before,
.bd-mem-item[data-mode='edit']::before {
  background: var(--bd-accent);
}

.bd-mem-item[data-mode='forget']::before {
  background: var(--bd-err);
}

/* Just written: a short warm wash, so the eye finds it at the top of the list. */
.bd-mem-item[data-fresh] {
  animation: bd-mem-fresh 1400ms ease-out;
}

@keyframes bd-mem-fresh {
  from {
    background: color-mix(in srgb, var(--bd-accent) 14%, transparent);
  }
}

.bd-mem-key {
  overflow: hidden;
  color: var(--bd-fg);
  font-family: var(--bd-mono);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-mem-text {
  margin: 0;
  color: var(--bd-fg);
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.bd-mem-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin: -2px 0 0;
}

.bd-mem-top .bd-mem-key {
  flex: 1;
  min-width: 0;
}

.bd-mem-meta {
  margin: 1px 0 0;
  /* Between muted and the text colour: above 4.5:1 on both themes (preview tokens: light 6.3:1, dark 7.8:1). */
  color: color-mix(in srgb, var(--bd-muted) 70%, var(--bd-fg));
  font-size: 11px;
}

.bd-mem-tools {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  margin-right: -4px;
}

/* Quiet at rest but plainly readable, touch has no hover (preview tokens: light 7.2:1, dark 9.6:1). */
.bd-mem-act {
  padding: 2px 7px;
  border: 0;
  border-radius: calc(var(--bd-radius) - 1px);
  background: none;
  color: color-mix(in srgb, var(--bd-muted) 45%, var(--bd-fg));
  font-size: 11.5px;
  font-weight: 500;
}

.bd-mem-act:hover:not(:disabled) {
  background: var(--bd-hover);
  color: var(--bd-fg);
}

.bd-mem-act[id^='bd-memforget-']:hover:not(:disabled) {
  color: var(--bd-err-text);
}

.bd-mem-act:disabled {
  opacity: 0.6;
}

/* Changing a memory: what it says now stays on screen, above the new text, until Save. */
.bd-mem-was {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px 7px;
  border: 1px solid var(--bd-line);
  border-radius: var(--bd-radius);
  background: var(--bd-field);
}

.bd-mem-was[data-refused='changed'] {
  border-color: color-mix(in srgb, var(--bd-warn) 45%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-warn) 7%, var(--bd-field));
}

.bd-mem-was[data-refused='gone'] .bd-mem-text {
  color: var(--bd-muted);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--bd-muted) 60%, transparent);
}

.bd-mem-label {
  color: var(--bd-muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.bd-mem-item > .bd-mem-label {
  margin-top: 4px;
}

.bd-mem-field {
  width: 100%;
  min-height: 72px;
}

.bd-mem-hint {
  margin: 0;
  color: var(--bd-muted);
  font-size: 11px;
  line-height: 1.4;
}

.bd-mem-alert {
  margin: 0;
  color: var(--bd-err-text);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.4;
}

.bd-mem-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

/* The forget step: the text that goes, what happens, and a red button that is not where Forget was. */
.bd-mem-forget {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
  padding: 8px 9px 9px;
  border: 1px solid color-mix(in srgb, var(--bd-err) 35%, var(--bd-line));
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-err) 6%, var(--bd-bg));
  animation: bd-drop 160ms ease-out;
}

.bd-mem-forget-h {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.bd-mem-quote {
  padding-left: 8px;
  border-left: 2px solid color-mix(in srgb, var(--bd-err) 45%, var(--bd-line));
}

.bd-mem-forget .bd-mem-hint {
  color: var(--bd-fg);
}

.bd-mem-danger {
  border-color: transparent;
  background: var(--bd-err);
  color: var(--bd-bg);
  font-weight: 600;
}

.bd-mem-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bd-err) 86%, var(--bd-fg));
}

/* A new memory: the text first, then an optional name. */
.bd-mem-add {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--bd-accent) 30%, var(--bd-line));
  border-radius: var(--bd-radius);
  background: var(--bd-field);
  animation: bd-drop 160ms ease-out;
}

.bd-mem-name {
  width: 100%;
  font-family: var(--bd-mono);
  font-size: 12px;
}

.bd-mem-taken {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bd-mem-quiet {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 28px 12px;
  color: var(--bd-muted);
  font-size: 12.5px;
  text-align: center;
}

.bd-mem-quiet p {
  margin: 0;
}

.bd-mem-quiet-sub {
  max-width: 30ch;
  font-size: 11.5px;
  line-height: 1.45;
}

.bd-mem-err {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  color: var(--bd-err-text);
  font-size: 12px;
}

/* Focus lands on the page title only so Tab and screen readers start there; it draws no ring. */
.bd .bd-mem-h:focus-visible {
  outline: none;
}

/* "Discard your changes?": in place of the step's buttons, or under the top bar when leaving the page. */
.bd-mem-ask {
  flex-wrap: wrap;
  gap: 6px 6px;
  border: 1px solid color-mix(in srgb, var(--bd-warn) 35%, var(--bd-line));
  color: var(--bd-fg);
  outline: none;
  animation: bd-drop 140ms ease-out;
}

.bd-mem-ask:focus-visible {
  box-shadow: 0 0 0 2px var(--bd-focus);
}

.bd-mem-ask-q {
  display: flex;
  flex: 1 1 140px;
  flex-direction: column;
  gap: 2px;
  font-weight: 600;
}

.bd-mem-ask-d {
  color: var(--bd-muted);
  font-weight: 400;
}

.bd-mem > .bd-mem-ask {
  margin: 8px 12px 0;
}

/* Leaving the page: the question and what it means take the full width, the two buttons a row of their own. */
.bd-mem > .bd-mem-ask .bd-mem-ask-q {
  flex-basis: 100%;
}

/* ---------------------------------------------------------------- supersede and duplicate */

.bd-replace .bd-input {
  width: 100%;
}

.bd-replace .bd-opts {
  margin: 0 -2px;
}

/* The confirmation closes the bead: tinted like the other questions that cannot be taken back in one click. */
.bd-replace[data-stage='confirm'] {
  border-color: color-mix(in srgb, var(--bd-warn) 35%, var(--bd-line));
  background: color-mix(in srgb, var(--bd-warn) 6%, var(--bd-field));
}

.bd-replace-q {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
}

.bd-replace-lab {
  color: var(--bd-muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bd-replace-pick {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 12.5px;
}

.bd-replace-pick .bd-title {
  min-width: 0;
  overflow: hidden;
  color: var(--bd-fg);
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bd-replace-says {
  margin: 0;
  color: var(--bd-muted);
  font-size: 12px;
  line-height: 1.45;
}

.bd-replace-says b {
  color: var(--bd-fg);
  font-weight: 600;
}

/* ---------------------------------------------------------------- close dialog */

.bd-closeform {
  gap: 4px;
}

.bd-closeq {
  margin: 0 0 2px;
  color: var(--bd-fg);
  font-size: 12px;
  font-weight: 600;
}

.bd-closeform .bd-flab {
  margin-top: 2px;
  font-size: 11px;
}

.bd-closeform .bd-input {
  width: 100%;
}

.bd-closenote {
  min-height: 48px;
  max-height: 160px;
  padding: 5px 8px;
  line-height: 1.45;
  resize: none;
}

.bd-closeform .bd-popacts,
.bd-closeform .bd-confirm {
  margin-top: 4px;
}

.bd-closeform .bd-confirm {
  flex-wrap: wrap;
}

/* ---------------------------------------------------------------- epics ready to close */

/* Under the epic's group, lined up with its progress bar: the one thing left to do for it. */
.bd-epic-ready {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 12px 4px 54px;
}

.bd-epic-ready[data-where='detail'] {
  margin: 8px 0 0 24px;
}

.bd-epic-ready-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
}

.bd-epic-ready-t {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
  color: var(--bd-ok-text, var(--bd-ok));
  font-size: 11.5px;
  font-weight: 500;
}

.bd-epic-ready[data-where='detail'] .bd-epic-ready-t {
  margin-right: 0;
}

/* A small filled tick, the same mark as a done acceptance box. */
.bd-epic-ready-mark {
  position: relative;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--bd-ok);
}

.bd-epic-ready-mark::after {
  position: absolute;
  top: 2px;
  left: 4px;
  width: 3px;
  height: 6px;
  border: solid var(--bd-bg);
  border-width: 0 1.6px 1.6px 0;
  content: '';
  transform: rotate(45deg);
}

.bd-epic-ready .bd-nstep {
  margin-top: 0;
}
`;

  // src/panel/ui/App.tsx
  var listing = (state) => state.directory !== null && (!state.workspace || state.workspace.kind === "ok") && !firstLoadError(state) && (state.snapshot?.beads.length ?? 0) > 0;
  var showingDetail = (state) => state.detail !== null && state.snapshot !== null && (!state.workspace || state.workspace.kind === "ok") && !needsUpdate(state);
  var showingMemories = (state) => state.page === "memories" && state.directory !== null && state.workspace?.kind === "ok" && !needsUpdate(state);
  function Body() {
    const state = useStore();
    if (state.directory === null) return /* @__PURE__ */ u3(NoProject, {});
    if (state.workspace && state.workspace.kind !== "ok") return /* @__PURE__ */ u3(WorkspaceEmpty, { workspace: state.workspace });
    if (needsUpdate(state)) return /* @__PURE__ */ u3(ProjectUpdate, {}, state.directory);
    if (firstLoadError(state)) return /* @__PURE__ */ u3(LoadError, {});
    if (!state.snapshot) return /* @__PURE__ */ u3(Loading, {});
    if (state.view === "activity") return /* @__PURE__ */ u3(ActivityView, {}, state.directory);
    if (state.view === "needs") return /* @__PURE__ */ u3(NeedsView, {}, state.directory);
    return /* @__PURE__ */ u3(List, {}, state.directory);
  }
  function App() {
    const state = useStore();
    const detail = showingDetail(state);
    const memories = showingMemories(state);
    const covered = state.overlays.length > 0;
    const sheet = state.overlays.some((name) => name !== "leave");
    const body = A2(null);
    const scrolled = A2(0);
    const wasDetail = A2(detail);
    if (detail && !wasDetail.current && body.current) scrolled.current = body.current.scrollTop;
    _2(() => {
      const leaving = wasDetail.current && !detail;
      wasDetail.current = detail;
      if (!leaving || !body.current) return;
      body.current.scrollTop = scrolled.current;
      const active2 = document.activeElement;
      if (active2 && active2 !== document.body && body.current.contains(active2)) return;
      const row2 = state.selectedId ? document.getElementById(rowDomId(state.selectedId)) : null;
      row2?.closest('[role="listbox"]')?.focus({ preventScroll: true });
    }, [detail]);
    const wasMemories = A2(memories);
    _2(() => {
      const leaving = wasMemories.current && !memories;
      wasMemories.current = memories;
      const active2 = document.activeElement;
      if (!leaving || active2 && active2 !== document.body) return;
      document.querySelector(".bd-projbtn")?.focus({ preventScroll: true });
    }, [memories]);
    return /* @__PURE__ */ u3("div", { class: "bd", children: [
      /* @__PURE__ */ u3(Header, {}),
      /* @__PURE__ */ u3(SyncCard, {}, state.directory ?? ""),
      /* @__PURE__ */ u3("main", { class: "bd-body", ref: body, hidden: detail || memories, inert: covered, onScroll: (e3) => {
        if (!detail) scrolled.current = e3.currentTarget.scrollTop;
      }, children: /* @__PURE__ */ u3(Body, {}) }),
      memories && /* @__PURE__ */ u3(MemoriesPage, {}, state.directory),
      detail && !memories && /* @__PURE__ */ u3(Detail, { inert: sheet, footer: /* @__PURE__ */ u3(AttachFooter, { id: state.detail.stack[state.detail.stack.length - 1].id }) }),
      listing(state) && !detail && !memories && /* @__PURE__ */ u3(Footer, {}),
      state.create && state.snapshot && !needsUpdate(state) && /* @__PURE__ */ u3(CreateForm, {}),
      /* @__PURE__ */ u3(WorktreeSheet, {}),
      !needsUpdate(state) && /* @__PURE__ */ u3(PublishSheet, {})
    ] });
  }
  var styled = false;
  function addStyles() {
    if (styled) return;
    const style = document.createElement("style");
    style.textContent = styles_default;
    document.head.append(style);
    styled = true;
  }
  function mountPanel(host2, root2, deps = {}) {
    addStyles();
    const client2 = deps.client ?? createClient(host2);
    const store = createStore({ client: client2, host: host2, ...deps });
    const agent = createAgent({ client: client2, host: host2, store });
    const sync = createSync({ client: client2, host: host2, store });
    const stopDirectory = host2.onDirectory((directory2) => store.setDirectory(directory2));
    const stopSession = host2.onSession((session) => agent.setSession(session));
    R(
      /* @__PURE__ */ u3(StoreContext.Provider, { value: store, children: /* @__PURE__ */ u3(AgentContext.Provider, { value: agent, children: /* @__PURE__ */ u3(SyncContext.Provider, { value: sync, children: /* @__PURE__ */ u3(App, {}) }) }) }),
      root2
    );
    return {
      store,
      dispose() {
        stopSession();
        stopDirectory();
        store.dispose();
        R(null, root2);
      }
    };
  }

  // src/panel/main.tsx
  var host = connectHost();
  var client = createClient(host);
  var root = document.getElementById("root");
  var panel;
  var directory = null;
  host.onResolve((request) => {
    const state = panel?.store.get();
    const known = state?.snapshot ? { directory: state.directory, ids: state.snapshot.beads.map((b2) => b2.id) } : null;
    return resolveCommand(request, { client, directory: state?.directory ?? directory, known });
  });
  host.onDirectory((next) => {
    directory = next;
  });
  host.onReady((ctx) => {
    applyHostReady(ctx, document.documentElement);
    directory = ctx.directory;
    panel ??= mountPanel(host, root, { client });
  });
  window.addEventListener("pagehide", () => {
    panel?.dispose();
    host.dispose();
  });
})();
/*! Bundled license information:

dompurify/dist/purify.es.mjs:
  (*! @license DOMPurify 3.4.17 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.4.17/LICENSE *)
  (*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE *)
*/
