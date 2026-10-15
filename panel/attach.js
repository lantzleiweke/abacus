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
  var isGuestAttachItem = (item) => item !== null && item.kind !== "message" && item.kind !== "session";
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
  function A2(n2) {
    return o2 = 5, T2(function() {
      return { current: n2 };
    }, []);
  }
  function T2(n2, r3) {
    var u4 = s2(t2++, 7);
    return C2(u4.__H, r3) && (u4.__ = n2(), u4.__H = r3, u4.__h = n2), u4.__;
  }
  function x2(n2) {
    var u4 = r2.context[n2.__c], i3 = s2(t2++, 9);
    return i3.c = n2, u4 ? (null == i3.__ && (i3.__ = true, u4.sub(r2)), u4.props.value) : n2.__;
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
      seen: call("seen"),
      context: call("context"),
      syncPreview: call("sync-preview"),
      syncPull: call("sync-pull"),
      syncPublish: call("sync-publish"),
      conflictContext: call("conflict-context")
    };
  }

  // src/panel/format.ts
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
  var utc = (options) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
  var MONTH_DAY = utc({ month: "short", day: "numeric" });
  var MONTH_DAY_YEAR = utc({ month: "short", day: "numeric", year: "numeric" });
  var TIME = utc({ hour: "numeric", minute: "2-digit" });
  var FULL = utc({ month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

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
  var WEEK_MS = 7 * 864e5;
  function nearestEpic(b2, byId) {
    let parent = b2.parentId ? byId.get(b2.parentId) : void 0;
    for (let hops = 0; parent && hops < 64; hops++) {
      if (parent.type === "epic") return parent;
      parent = parent.parentId ? byId.get(parent.parentId) : void 0;
    }
    return null;
  }

  // src/panel/detail.ts
  function latestUnseenChange(id, activity) {
    return activity.find((e3) => e3.beadId === id && e3.unseen) ?? null;
  }
  function newerBead(read, listed) {
    if (!read || !listed) return read ?? listed;
    return Date.parse(listed.updatedAt) > Date.parse(read.updatedAt) ? listed : read;
  }
  function beadSignature(b2) {
    const fields = JSON.stringify([b2.title, b2.status, b2.priority, b2.assignee, b2.labels, b2.parentId, b2.description, b2.design, b2.acceptance, b2.notes, b2.closeReason, b2.extra]);
    return `${b2.updatedAt}|${fields}|${b2.comments.map((c3) => c3.id).join(",")}|${b2.dependencies.map((d3) => `${d3.kind}>${d3.to}`).sort().join(",")}`;
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

  // src/panel/keyboard.ts
  var composing = (e3) => e3.isComposing || e3.keyCode === 229;

  // src/panel/resolve.ts
  var PROVIDER_ID = "beads";
  function attachPayload(context, directory, sync = false) {
    const data = sync ? { v: 1, directory, sync: true } : { v: 1, directory };
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
  var isChipData = (value) => typeof value === "object" && value !== null && value.v === 1 && typeof value.directory === "string";
  function beadOfItem(item, directory) {
    if (!item || !isGuestAttachItem(item) || item.providerId !== PROVIDER_ID || isSyncChip(item)) return null;
    return isChipData(item.data) && item.data.directory === directory ? item.id : null;
  }
  function isSyncChip(item) {
    if (!item || !isGuestAttachItem(item) || item.providerId !== PROVIDER_ID) return false;
    return isChipData(item.data) && item.data.sync === true;
  }
  function chipDirectory(item) {
    if (!item || !isGuestAttachItem(item) || item.providerId !== PROVIDER_ID) return null;
    return isChipData(item.data) ? item.data.directory : null;
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

  // src/panel/edit.ts
  function defaultParent(beads, shownId) {
    if (shownId === null) return null;
    const byId = new Map(beads.map((b2) => [b2.id, b2]));
    const shown = byId.get(shownId);
    if (!shown) return null;
    if (shown.type === "epic") return shown.id;
    return nearestEpic(shown, byId)?.id ?? null;
  }

  // src/panel/store.ts
  var VIEWS = ["epic", "status", "activity"];
  var DEFAULT_FILTERS = { status: "open", assignee: "any", priorities: [], ready: false };
  var DEFAULT_COLLAPSED = ["status:deferred", "status:closed"];
  var POLL_MS = 2e3;
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
  var uiKey = (directory) => `ui:${fnv(directory, 2166136261)}${fnv(directory, 16777619)}`;
  var isObject2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  var isStrings = (value) => Array.isArray(value) && value.every((v5) => typeof v5 === "string");
  function readFilters(value) {
    if (!isObject2(value)) return DEFAULT_FILTERS;
    const { status, assignee, priorities, ready } = value;
    return {
      status: status === "open" || status === "all" ? status : isObject2(status) && isStrings(status.only) ? { only: status.only } : "open",
      assignee: assignee === "any" || assignee === "unassigned" ? assignee : isObject2(assignee) && typeof assignee.name === "string" ? { name: assignee.name } : "any",
      priorities: Array.isArray(priorities) ? priorities.filter((p3) => Number.isInteger(p3) && p3 >= 0 && p3 <= 4) : [],
      ready: ready === true
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
  function createStore({ client, host: host2, visibility = defaultVisibility(), now = Date.now }) {
    let state = {
      directory: null,
      generation: 0,
      workspace: null,
      snapshot: null,
      view: "epic",
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
    let touched = false;
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
    async function poll(refreshWorkspace = false) {
      clearTimer();
      const { directory, generation } = state;
      if (directory === null || disposed) return;
      const seq = ++latest;
      inFlight = true;
      const current = () => {
        if (seq !== latest || generation !== state.generation || disposed) return false;
        inFlight = false;
        return true;
      };
      const cursor = state.snapshot?.cursor;
      try {
        const answer = await client.snapshot({ directory, ...cursor ? { cursor } : {}, ...refreshWorkspace ? { refreshWorkspace: true } : {} });
        if (!current()) return;
        failures = 0;
        if (!answer.unchanged) {
          listedBeads = answer.beads;
          set({ snapshot: { ...answer, beads: holding(answer.beads, answer.freshness) }, workspace: answer.workspace, error: null });
          followDetail();
        } else if (state.snapshot) {
          const held = answered.size;
          const beads = holding(listedBeads, answer.freshness);
          set({ snapshot: { ...state.snapshot, cursor: answer.cursor, freshness: answer.freshness, sync: answer.sync, ...answered.size !== held ? { beads } : {} }, error: null });
        }
        schedule(POLL_MS);
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
    const answered = /* @__PURE__ */ new Map();
    let listedBeads = [];
    function holding(beads, freshness) {
      if (answered.size === 0) return beads;
      const read = freshness.localRefreshedAt === null ? NaN : Date.parse(freshness.localRefreshedAt);
      for (const [id, copy] of [...answered]) if (read > copy.at) answered.delete(id);
      if (answered.size === 0) return beads;
      const out = beads.map((b2) => answered.get(b2.id)?.bead ?? b2);
      for (const [id, copy] of answered) if (!beads.some((b2) => b2.id === id)) out.push(copy.bead);
      return out;
    }
    function applyWritten(bead) {
      const snapshot = state.snapshot;
      if (!snapshot) return;
      answered.set(bead.id, { bead, at: now() });
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
      const { directory, generation } = state;
      if (!entry || directory === null || !state.detail) return;
      const seq = ++detailSeq;
      const copy = listed(entry.id);
      detailSig = copy ? beadSignature(copy) : null;
      set({ detail: { ...state.detail, loading: true, error: null } });
      const current = () => seq === detailSeq && generation === state.generation && !disposed && state.detail !== null && shownEntry()?.id === entry.id;
      try {
        const data = await client.bead({ directory, id: entry.id });
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
      const { directory, generation } = state;
      if (directory === null || !state.snapshot?.unseenIds.includes(id)) return;
      try {
        const { unseenIds } = await client.seen({ directory, ids: [id] });
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
    function refused(thrown) {
      const error = asRequestError(thrown);
      if (error.code === "uncertain" || ANSWER_LOST.has(error.code)) {
        refreshAfterWrite(true);
        return { kind: "uncertain", current: null, saved: error.saved === true };
      }
      if (error.saved) refreshAfterWrite(true);
      else if (error.code === "writes-blocked" || error.code === "sync-running" || error.code === "merge-conflict" || error.workspace) void poll();
      return { kind: "error", error: toPanelError(error) };
    }
    async function writing(send, done) {
      const { directory, generation } = state;
      if (directory === null || disposed) return { kind: "dropped" };
      const here = () => generation === state.generation && !disposed;
      try {
        const answer = await send(directory);
        return here() ? done(answer) : { kind: "dropped" };
      } catch (thrown) {
        return here() ? refused(thrown) : { kind: "dropped" };
      }
    }
    const known = (id) => newerBead(state.detail?.data?.bead.id === id ? state.detail.data.bead : null, listed(id) ?? null);
    const persist = () => {
      const { directory, view, filters, collapsed } = state;
      if (directory === null) return;
      touched = true;
      const value = { view, filters, collapsed };
      host2.storage.set(uiKey(directory), value).catch(() => {
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
      setDirectory(directory) {
        if (directory === state.directory) return;
        clearTimer();
        failures = 0;
        touched = false;
        inFlight = false;
        detailSeq++;
        detailSig = null;
        bannered.clear();
        answered.clear();
        listedBeads = [];
        const generation = state.generation + 1;
        set({
          directory,
          generation,
          workspace: null,
          snapshot: null,
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
        if (directory === null) return;
        host2.storage.get(uiKey(directory)).then((stored) => {
          if (!disposed && generation === state.generation && !touched && stored !== void 0) set(readUi(stored));
        }).catch(() => {
        });
        void poll();
      },
      retry() {
        failures = 0;
        void poll(true);
      },
      async confirmFirstContact() {
        const { directory, generation } = state;
        if (directory === null || state.confirming) return;
        set({ confirming: true, confirmError: null });
        try {
          const workspace = await client.workspace({ directory, confirmFirstContact: true });
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
        set({ view });
        persist();
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
      reloadDetail() {
        void loadDetail();
      },
      dismissChange() {
        const entry = shownEntry();
        if (entry?.change) replaceShown({ ...entry, change: null });
      },
      async markAllSeen() {
        const { directory, generation } = state;
        if (directory === null || !state.snapshot) return;
        try {
          const { unseenIds } = await client.seen({ directory, all: true });
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
        return writing(
          (directory) => client.update({ directory, id, expectedUpdatedAt, patch, ...expected ? { expected } : {} }),
          (result) => {
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
        );
      },
      create(input) {
        return writing(
          (directory) => client.create({ directory, input }),
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
          (directory) => client.comment({ directory, id, text: text2 }),
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
          (directory) => client.dependency({ directory, ...change }),
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

  // src/panel/agent.ts
  var AgentContext = X(null);

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

  // src/panel/ui/icons.tsx
  function Icon({ size = 14, children }) {
    return /* @__PURE__ */ u3("svg", { class: "bd-i", width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false", children });
  }
  var IconSearch = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: [
    /* @__PURE__ */ u3("circle", { cx: "7", cy: "7", r: "4.3" }),
    /* @__PURE__ */ u3("path", { d: "M10.2 10.2l3.3 3.3" })
  ] });
  var IconSpinner = (p3) => /* @__PURE__ */ u3(Icon, { ...p3, children: /* @__PURE__ */ u3("path", { class: "bd-spin", d: "M8 2.5a5.5 5.5 0 1 1-5.5 5.5" }) });
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

  // src/panel/sync.ts
  var SyncContext = X(null);

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
        const matches = stringMatch(dirty, /^[\r\n\t ]+/);
        leadingWhitespace = matches && matches[0];
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
  var q2 = /[\s\p{P}\p{S}]/u;
  var j3 = /[^\s\p{P}\p{S}]/u;
  var Xe = h3(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, q2).getRegex();
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
  var st = h3(Oe, "gu").replace(/notPunctSpace/g, j3).replace(/punctSpace/g, q2).replace(/punct/g, S2).getRegex();
  var it = h3(Oe, "gu").replace(/notPunctSpace/g, Je).replace(/punctSpace/g, Ve).replace(/punct/g, Re).getRegex();
  var ot = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)";
  var at = h3(ot, "gu").replace(/notPunctSpace/g, j3).replace(/punctSpace/g, q2).replace(/punct/g, S2).getRegex();
  var lt = h3("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, j3).replace(/punctSpace/g, q2).replace(/punct/g, S2).getRegex();
  var ut = "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)";
  var pt = h3(ut, "gu").replace(/notPunctSpace/g, j3).replace(/punctSpace/g, q2).replace(/punct/g, S2).getRegex();
  var ct = h3(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, S2).getRegex();
  var ht = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
  var dt = h3(ht, "gu").replace(/notPunctSpace/g, j3).replace(/punctSpace/g, q2).replace(/punct/g, S2).getRegex();
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

  // src/panel/ui/Detail.tsx
  var TEXT_SECTIONS = [
    { field: "description", title: "Description", chip: "Description" },
    { field: "acceptance", title: "Acceptance criteria", chip: "Acceptance" },
    { field: "design", title: "Design", chip: "Design", folded: true },
    { field: "notes", title: "Notes", chip: "Notes", folded: true }
  ];
  var EDITABLE = ["title", ...TEXT_SECTIONS.map((s3) => s3.field)];

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
          body: `This project was last opened with Beads ${workspace.lastOpenedWith}. Opening it here lets Beads update it to ${workspace.bdVersion}, which may change its files.`
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
  function Loading() {
    const widths = [72, 54, 88, 61, 79, 46, 67];
    return /* @__PURE__ */ u3("div", { class: "bd-skeleton", "aria-busy": "true", "aria-label": "Loading beads", children: widths.map((w4, i3) => /* @__PURE__ */ u3("div", { class: "bd-skel-row", style: { "--w": `${w4}%`, "--d": `${i3 * 70}ms` }, children: [
      /* @__PURE__ */ u3("i", { class: "bd-skel-dot" }),
      /* @__PURE__ */ u3("i", { class: "bd-skel-id" }),
      /* @__PURE__ */ u3("i", { class: "bd-skel-bar" })
    ] }, i3)) });
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
  transition: background-color 120ms ease, color 120ms ease;
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
  color: var(--bd-dim);
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
  color: var(--bd-err-text);
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
  padding-bottom: 18px;
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

.bd-dtype {
  margin-left: 8px;
  color: var(--bd-dim);
  font-size: 11.5px;
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
`;

  // src/panel/ui/App.tsx
  var styled = false;
  function addStyles() {
    if (styled) return;
    const style = document.createElement("style");
    style.textContent = styles_default;
    document.head.append(style);
    styled = true;
  }

  // src/panel/ui/Picker.tsx
  function pickable(beads, statuses, query, now) {
    const look = looker(statuses);
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hits = beads.filter((b2) => {
      if (words.length === 0) {
        if (look(b2.status) !== "done") return true;
        const closed = Date.parse(b2.closedAt ?? b2.updatedAt);
        return Number.isFinite(closed) && now - closed < WEEK_MS;
      }
      const text2 = `${b2.id} ${b2.title}`.toLowerCase();
      return words.every((w4) => text2.includes(w4));
    });
    return hits.sort((a5, b2) => Date.parse(b2.updatedAt) - Date.parse(a5.updatedAt) || a5.id.localeCompare(b2.id));
  }
  var optionId = (id) => `bdp-opt-${id}`;
  function Preview({ bead, statuses }) {
    const look = looker(statuses)(bead.status);
    const acceptance = bead.acceptance.trim();
    const items = acceptance ? acceptanceItems(acceptance) : null;
    return /* @__PURE__ */ u3("article", { class: "bdp-card", children: [
      /* @__PURE__ */ u3("div", { class: "bdp-kind", children: [
        /* @__PURE__ */ u3("span", { class: "bd-ty", "data-type": bead.type, title: bead.type, children: /* @__PURE__ */ u3(TypeIcon, { type: bead.type, size: 13 }) }),
        /* @__PURE__ */ u3("span", { children: humanize(bead.type || "bead") }),
        /* @__PURE__ */ u3("span", { class: "bdp-fullid", children: bead.id })
      ] }),
      /* @__PURE__ */ u3("h2", { class: "bdp-title", children: bead.title || bead.id }),
      /* @__PURE__ */ u3("div", { class: "bdp-meta", children: [
        /* @__PURE__ */ u3("span", { class: "bd-pill", "data-look": look, title: bead.status, children: [
          /* @__PURE__ */ u3(StatusDot, { look, marker: markerOf(bead.status) }),
          statusLabel(bead.status, statuses)
        ] }),
        /* @__PURE__ */ u3(Priority, { value: bead.priority }),
        bead.assignee && /* @__PURE__ */ u3("span", { class: "bdp-who", children: bead.assignee }),
        bead.labels.slice(0, 4).map((label) => /* @__PURE__ */ u3("span", { class: "bd-lb", children: label }, label))
      ] }),
      bead.description.trim() ? /* @__PURE__ */ u3(Markdown, { class: "bd-txt bdp-text", text: bead.description }) : /* @__PURE__ */ u3("p", { class: "bdp-none", children: "No description." }),
      acceptance && /* @__PURE__ */ u3("section", { class: "bdp-sec", children: [
        /* @__PURE__ */ u3("h3", { class: "bdp-sec-title", children: [
          "Acceptance criteria",
          items ? ` \xB7 ${items.length}` : ""
        ] }),
        /* @__PURE__ */ u3(Markdown, { class: "bd-txt bdp-text", text: acceptance })
      ] })
    ] }, bead.id);
  }
  function Picker({ host: host2, client }) {
    const state = useStore();
    const now = useNow(6e4);
    const snapshot = state.snapshot;
    const [query, setQuery] = d2("");
    const [cursor, setCursor] = d2(null);
    const [busy, setBusy] = d2(false);
    const [error, setError] = d2(null);
    const input = A2(null);
    const list = A2(null);
    const minute = Math.floor(now / 6e4) * 6e4;
    const beads = T2(() => pickable(snapshot.beads, snapshot.statuses, query, minute), [snapshot.beads, snapshot.statuses, query, minute]);
    const at2 = cursor !== null && beads.some((b2) => b2.id === cursor) ? cursor : beads[0]?.id ?? null;
    const shown = beads.find((b2) => b2.id === at2) ?? null;
    const look = T2(() => looker(snapshot.statuses), [snapshot.statuses]);
    h2(() => input.current?.focus(), []);
    h2(() => {
      if (at2 !== cursor) setCursor(at2);
    }, [at2, cursor]);
    h2(() => {
      if (at2) document.getElementById(optionId(at2))?.scrollIntoView?.({ block: "nearest" });
    }, [at2]);
    const move = (step) => {
      if (beads.length === 0) return;
      const i3 = beads.findIndex((b2) => b2.id === at2);
      setCursor(beads[Math.max(0, Math.min(beads.length - 1, i3 + step))].id);
    };
    async function attach(id) {
      const directory = state.directory;
      if (busy || id === null || directory === null) return;
      setBusy(true);
      setError(null);
      try {
        const chip = attachPayload(await client.context({ directory, id }), directory);
        await host2.attach(chip);
      } catch (thrown) {
        setBusy(false);
        setError(`Couldn't attach ${shortId(id)}. ${asRequestError(thrown).message}`);
        return;
      }
      setBusy(false);
      host2.close().catch(() => {
      });
    }
    const confirm = () => void attach(at2);
    const onKeyDown = (e3) => {
      if (composing(e3)) return;
      const ctrl = e3.ctrlKey && !e3.metaKey && !e3.altKey;
      if (e3.key === "ArrowDown" || ctrl && e3.key === "n") move(1);
      else if (e3.key === "ArrowUp" || ctrl && e3.key === "p") move(-1);
      else if (e3.key === "Enter") {
        if (!e3.shiftKey) confirm();
      } else if (e3.key === "Escape") {
        if (query) setQuery("");
        else host2.close().catch(() => {
        });
      } else return;
      e3.preventDefault();
      e3.stopPropagation();
    };
    return /* @__PURE__ */ u3("div", { class: "bdp", "aria-busy": busy, children: [
      /* @__PURE__ */ u3("div", { class: "bdp-search", children: [
        /* @__PURE__ */ u3(IconSearch, { size: 14 }),
        /* @__PURE__ */ u3(
          "input",
          {
            ref: input,
            role: "combobox",
            "aria-label": "Search beads",
            "aria-expanded": "true",
            "aria-controls": "bdp-list",
            "aria-activedescendant": at2 ? optionId(at2) : void 0,
            "aria-autocomplete": "list",
            placeholder: "Search by id or title",
            value: query,
            spellcheck: false,
            autoComplete: "off",
            onInput: (e3) => {
              setQuery(e3.currentTarget.value);
              setCursor(null);
            },
            onKeyDown
          }
        )
      ] }),
      error && /* @__PURE__ */ u3("p", { class: "bdp-error", role: "alert", children: error }),
      /* @__PURE__ */ u3("div", { class: "bdp-body", children: [
        /* @__PURE__ */ u3("div", { ref: list, id: "bdp-list", class: "bdp-list", role: "listbox", "aria-label": "Beads", children: beads.length === 0 ? /* @__PURE__ */ u3("p", { class: "bdp-empty", children: query ? "No bead has that id or title." : "No open beads." }) : beads.map((b2) => {
          const l3 = look(b2.status);
          const updated = Date.parse(b2.updatedAt);
          return /* @__PURE__ */ u3(
            "div",
            {
              id: optionId(b2.id),
              role: "option",
              class: "bdp-row",
              "data-id": b2.id,
              "data-cursor": b2.id === at2 || void 0,
              "data-done": l3 === "done" || void 0,
              "aria-selected": b2.id === at2,
              onMouseMove: () => b2.id !== at2 && setCursor(b2.id),
              onMouseDown: (e3) => e3.preventDefault(),
              onClick: () => void attach(b2.id),
              children: [
                /* @__PURE__ */ u3(StatusDot, { look: l3, marker: markerOf(b2.status), label: statusLabel(b2.status, snapshot.statuses) }),
                /* @__PURE__ */ u3("span", { class: "bd-id", children: shortId(b2.id) }),
                /* @__PURE__ */ u3("span", { class: "bdp-row-title", children: b2.title }),
                /* @__PURE__ */ u3("time", { class: "bd-age", dateTime: b2.updatedAt, children: Number.isFinite(updated) ? shortAgo(minute - updated) : "" })
              ]
            },
            b2.id
          );
        }) }),
        /* @__PURE__ */ u3("section", { class: "bdp-preview", role: "region", "aria-label": "Preview", children: shown ? /* @__PURE__ */ u3(Preview, { bead: shown, statuses: snapshot.statuses }) : /* @__PURE__ */ u3("p", { class: "bdp-none", children: "Nothing to preview." }) })
      ] }),
      /* @__PURE__ */ u3("footer", { class: "bdp-foot", children: [
        /* @__PURE__ */ u3("span", { class: "bdp-keys", "aria-hidden": "true", children: [
          /* @__PURE__ */ u3("kbd", { children: "\u2191" }),
          /* @__PURE__ */ u3("kbd", { children: "\u2193" }),
          " move ",
          /* @__PURE__ */ u3("kbd", { children: "\u21B5" }),
          " attach ",
          /* @__PURE__ */ u3("kbd", { children: "esc" }),
          " close"
        ] }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => host2.close().catch(() => {
        }), children: "Cancel" }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm bd-btn-primary", disabled: busy || !at2, onClick: confirm, children: busy ? /* @__PURE__ */ u3(S, { children: [
          /* @__PURE__ */ u3(IconSpinner, { size: 12 }),
          "Attaching\u2026"
        ] }) : "Attach" })
      ] })
    ] });
  }
  function ChipView({ id, host: host2 }) {
    const state = useStore();
    const bead = state.snapshot?.beads.find((b2) => b2.id === id) ?? null;
    return /* @__PURE__ */ u3("div", { class: "bdp bdp-chip", children: [
      /* @__PURE__ */ u3("div", { class: "bdp-chip-body", children: bead ? /* @__PURE__ */ u3(Preview, { bead, statuses: state.snapshot.statuses }) : /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: `${shortId(id)} is no longer in this project.`, body: "It may have been deleted since it was attached." }) }),
      /* @__PURE__ */ u3("footer", { class: "bdp-foot", children: [
        /* @__PURE__ */ u3("span", { class: "bdp-keys" }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => host2.close().catch(() => {
        }), children: "Close" })
      ] })
    ] });
  }
  function SyncChipView({ host: host2, here }) {
    return /* @__PURE__ */ u3("div", { class: "bdp bdp-chip", children: [
      /* @__PURE__ */ u3("div", { class: "bdp-chip-body", children: /* @__PURE__ */ u3(
        EmptyState,
        {
          tone: "neutral",
          title: "Beads sync problem",
          body: here ? "This holds the details of a team sync that stopped: what happened and what Beads ran. Abacus shows whether it is still there." : "This holds the details of a team sync that stopped in another project. Open that project to see it."
        }
      ) }),
      /* @__PURE__ */ u3("footer", { class: "bdp-foot", children: [
        /* @__PURE__ */ u3("span", { class: "bdp-keys" }),
        /* @__PURE__ */ u3("button", { type: "button", class: "bd-btn bd-btn-sm", onClick: () => host2.close().catch(() => {
        }), children: "Close" })
      ] })
    ] });
  }
  function Dialog({ host: host2, client, item }) {
    const state = useStore();
    const chipId = beadOfItem(item, state.directory);
    const body = (() => {
      if (state.directory === null) return /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: "Open a project to pick beads." });
      if (isSyncChip(item)) return /* @__PURE__ */ u3(SyncChipView, { host: host2, here: chipDirectory(item) === state.directory });
      if (chipId === null && chipDirectory(item) !== null) return /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: "That bead is in another project.", body: "Open that project to see it." });
      if (state.workspace && state.workspace.kind !== "ok") return /* @__PURE__ */ u3(WorkspaceEmpty, { workspace: state.workspace });
      if (firstLoadError(state)) return /* @__PURE__ */ u3(LoadError, {});
      if (!state.snapshot) return /* @__PURE__ */ u3(Loading, {});
      if (chipId) return /* @__PURE__ */ u3(ChipView, { id: chipId, host: host2 });
      if (state.snapshot.beads.length === 0) return /* @__PURE__ */ u3(EmptyState, { tone: "neutral", title: "No beads in this project yet." });
      return /* @__PURE__ */ u3(Picker, { host: host2, client });
    })();
    return /* @__PURE__ */ u3("div", { class: "bd bd-dialog", children: body });
  }
  function mountAttachDialog(host2, root2, ctx, deps = {}) {
    addStyles();
    const client = deps.client ?? createClient(host2);
    const store = createStore({ client, host: host2, ...deps });
    store.setDirectory(ctx.directory);
    R(
      /* @__PURE__ */ u3(StoreContext.Provider, { value: store, children: /* @__PURE__ */ u3(Dialog, { host: host2, client, item: ctx.item }) }),
      root2
    );
    return () => {
      store.dispose();
      R(null, root2);
    };
  }

  // src/panel/attach.tsx
  var host = connectHost();
  var root = document.getElementById("root");
  var dispose;
  host.onReady((ctx) => {
    applyHostReady(ctx, document.documentElement);
    dispose ??= mountAttachDialog(host, root, { directory: ctx.directory, item: ctx.item });
  });
  window.addEventListener("pagehide", () => {
    dispose?.();
    host.dispose();
  });
})();
/*! Bundled license information:

dompurify/dist/purify.es.mjs:
  (*! @license DOMPurify 3.4.17 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.4.17/LICENSE *)
  (*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE *)
*/
