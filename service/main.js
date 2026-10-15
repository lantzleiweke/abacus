"use strict";
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

// src/service/main.ts
var main_exports = {};
__export(main_exports, {
  startServer: () => startServer
});
module.exports = __toCommonJS(main_exports);
var import_node_http = require("node:http");

// src/service/routes.ts
var import_promises4 = require("node:fs/promises");
var import_node_path5 = require("node:path");

// src/service/bd/adapter.ts
var import_node_os2 = require("node:os");

// src/service/bd/audit.ts
var import_node_path3 = require("node:path");

// src/service/workspace.ts
var import_node_net = require("node:net");
var import_promises2 = require("node:fs/promises");
var import_node_path2 = require("node:path");

// src/service/bd/exec.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_promises = require("node:fs/promises");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var BdError = class extends Error {
  kind;
  code;
  stderr;
  constructor(kind, message, details = {}) {
    super(message);
    this.name = "BdError";
    this.kind = kind;
    this.code = details.code;
    this.stderr = details.stderr ?? "";
  }
};
var DEFAULT_TIMEOUT_MS = 15e3;
var DEFAULT_DEADLINE_MS = 18e3;
var DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
var DEFAULT_BACKOFF_MS = 150;
var MIN_ATTEMPT_MS = 1e3;
var KILL_GRACE_MS = 1e3;
function extraDirs() {
  const home = (0, import_node_os.homedir)();
  return ["/opt/homebrew/bin", "/usr/local/bin", (0, import_node_path.join)(home, ".local", "bin"), (0, import_node_path.join)(home, "go", "bin")];
}
function searchDirs() {
  const host = (process.env.PATH ?? "").split(import_node_path.delimiter);
  return [...new Set([...host, ...extraDirs()].filter((dir) => (0, import_node_path.isAbsolute)(dir)))];
}
var LEAKY_ENV = [
  "BEADS_DIR",
  "BEADS_DB",
  "BEADS_DOLT_SERVER_HOST",
  "BEADS_DOLT_SERVER_PORT",
  "BEADS_DOLT_SERVER_SOCKET",
  "BEADS_DOLT_DATA_DIR",
  "BEADS_DOLT_SHARED_SERVER",
  "GIT_DIR",
  "GIT_WORK_TREE"
];
function childEnv() {
  const env = { ...process.env, PATH: searchDirs().join(import_node_path.delimiter) };
  for (const key of LEAKY_ENV) delete env[key];
  return env;
}
async function isExecutableFile(path) {
  try {
    if (!(await (0, import_promises.stat)(path)).isFile()) return false;
    await (0, import_promises.access)(path, import_node_fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function resolveExecutable(name, dirs = searchDirs()) {
  for (const dir of dirs) {
    const candidate = (0, import_node_path.join)(dir, name);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}
var LOCK_PATTERN = /(?<![\w/-])lock(?:ed)?(?![\w/-])/i;
function isLockError(errorText2) {
  return LOCK_PATTERN.test(errorText2);
}
var BEADS_ROLE_WARNING = /^warning: beads\.role not configured.*$/gim;
function withoutKnownWarnings(stderr) {
  return stderr.replace(BEADS_ROLE_WARNING, "").trim();
}
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function errorText(result) {
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
  }
  return withoutKnownWarnings(result.stderr);
}
function startFailure(name, cause) {
  if (cause.code === "ENOENT" || cause.code === "EACCES") {
    return new BdError("exit", `${name} could not be started: the project folder is missing or cannot be opened`);
  }
  if (cause.code === "ERR_INVALID_ARG_VALUE") {
    return new BdError("exit", `${name} could not be started: an argument contains a character that cannot be passed`);
  }
  if (cause.code === "EMFILE" || cause.code === "ENFILE") {
    return new BdError("exit", `${name} could not be started: too many files are open`);
  }
  if (cause.code === "E2BIG") {
    return new BdError("exit", `${name} could not be started: the arguments are too long`);
  }
  return new BdError("exit", `${name} could not be started: ${cause.message}`);
}
function runOnce(exe, name, cwd, args, timeoutMs, opts) {
  const maxBytes = Math.min(opts.maxBytes ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  return new Promise((resolve2, reject2) => {
    let child;
    try {
      child = (0, import_node_child_process.spawn)(exe, args, { cwd, env: childEnv(), detached: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (cause) {
      reject2(startFailure(name, cause));
      return;
    }
    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    let failure;
    let settled = false;
    let killTimer;
    let timeout;
    const stderrText = () => Buffer.concat(err).toString("utf8");
    const finish = (settle2) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      settle2();
    };
    child.on("error", (cause) => finish(() => reject2(startFailure(name, cause))));
    const { stdout, stderr: stderrStream, stdin } = child;
    if (!stdout || !stderrStream || !stdin) {
      timeout = setTimeout(
        () => finish(() => reject2(new BdError("exit", `${name} could not be started: no pipes were created`))),
        50
      );
      return;
    }
    const killGroup = (signal) => {
      try {
        if (child.pid !== void 0) process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };
    const abort = (error) => {
      if (failure) return;
      failure = error;
      killGroup("SIGTERM");
      killTimer = setTimeout(() => {
        killGroup("SIGKILL");
        stdout.destroy();
        stderrStream.destroy();
        finish(() => reject2(failure));
      }, KILL_GRACE_MS);
    };
    timeout = setTimeout(() => abort(new BdError("timeout", `${name} timed out after ${timeoutMs} ms`)), timeoutMs);
    stdout.on("data", (chunk) => {
      outBytes += chunk.length;
      if (outBytes > maxBytes) abort(new BdError("exit", `${name} output exceeded ${maxBytes} bytes`));
      else out.push(chunk);
    });
    stderrStream.on("data", (chunk) => {
      errBytes += chunk.length;
      if (errBytes > maxBytes) abort(new BdError("exit", `${name} error output exceeded ${maxBytes} bytes`));
      else err.push(chunk);
    });
    child.on(
      "close",
      (code, signal) => finish(() => {
        if (failure) {
          reject2(failure.kind === "timeout" ? failure : new BdError(failure.kind, failure.message, { stderr: stderrText() }));
          return;
        }
        resolve2({ stdout: Buffer.concat(out).toString("utf8"), stderr: stderrText(), code: code ?? (signal ? 1 : 0) });
      })
    );
    stdin.on("error", () => {
    });
    stdin.end(opts.input);
  });
}
async function runTool(name, cwd, args, opts, retryOnLock) {
  const exe = await resolveExecutable(name, opts.searchDirs);
  if (!exe) throw new BdError("not-found", `${name} was not found on PATH or in the usual install folders`);
  const startedAt = Date.now();
  if (opts.deadlineAt !== void 0 && opts.deadlineAt <= startedAt) {
    throw new BdError("timeout", `${name} was not started: the time for this request had run out`);
  }
  const deadlineMs = opts.deadlineAt !== void 0 ? opts.deadlineAt - startedAt : opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const retries = retryOnLock ? Math.max(0, opts.retries ?? 0) : 0;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  for (let attempt = 0; ; attempt += 1) {
    const remaining = deadlineMs - (Date.now() - startedAt);
    const attemptMs = Math.max(1, Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, remaining));
    const result = await runOnce(exe, name, cwd, args, attemptMs, opts);
    if (!retryOnLock || result.code === 0) return result;
    const text = errorText(result);
    if (!isLockError(text)) return result;
    const delay = backoff * 2 ** attempt;
    const outOfTime = Date.now() - startedAt + delay + MIN_ATTEMPT_MS > deadlineMs;
    if (attempt >= retries || outOfTime) {
      throw new BdError("lock", `${name} is busy: ${text}`, { code: result.code, stderr: result.stderr });
    }
    await sleep(delay);
  }
}
var VALUE_FLAGS = /* @__PURE__ */ new Set(["--actor", "--db", "--directory", "-C", "--dolt-auto-commit"]);
var REFUSED_SUBCOMMANDS = /* @__PURE__ */ new Set(["show", "view"]);
function subcommandOf(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("-")) return arg;
    if (VALUE_FLAGS.has(arg)) i += 1;
  }
  return void 0;
}
function refusalFor(args) {
  const subcommand = subcommandOf(args);
  if (subcommand !== void 0 && REFUSED_SUBCOMMANDS.has(subcommand)) {
    return `"bd ${subcommand}" moves .beads/last-touched`;
  }
  const separator = args.indexOf("--");
  const flags = separator === -1 ? args : args.slice(0, separator);
  if (flags.some((arg) => arg === "--force" || arg.startsWith("--force=") || arg === "-f")) {
    return "--force is never passed";
  }
  return void 0;
}
function runBd(directory, args, opts = {}) {
  const refusal = refusalFor(args);
  if (refusal) return Promise.reject(new BdError("exit", `refused: ${refusal}`));
  return runTool("bd", directory, args, opts, true);
}
function runDolt(cwd, args, opts = {}) {
  return runTool("dolt", cwd, args, opts, true);
}
function runGit(directory, args, opts = {}) {
  return runTool("git", directory, args, opts, false);
}
function errorMessageFor(result) {
  return errorText(result) || `bd exited with code ${result.code}`;
}
function parseJsonLines(stdout) {
  return stdout.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
}
async function runBdJson(directory, args, opts = {}) {
  const result = await runBd(directory, args, opts);
  if (result.code !== 0) {
    throw new BdError("exit", errorMessageFor(result), { code: result.code, stderr: result.stderr });
  }
  try {
    return opts.jsonl ? parseJsonLines(result.stdout) : JSON.parse(result.stdout);
  } catch (cause) {
    throw new BdError("parse", `bd printed output that is not valid JSON: ${cause.message}`, {
      code: result.code,
      stderr: result.stderr
    });
  }
}

// src/service/workspace.ts
var MIN_BD_VERSION = "1.2.2";
var SERVER_PROBE_TIMEOUT_MS = 500;
var NO_DATABASE = /no beads database found/i;
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "::1"]);
function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    const diff = a[i] - b[i];
    if (diff !== 0) return diff;
  }
  return 0;
}
async function isDirectory(path) {
  try {
    return (await (0, import_promises2.stat)(path)).isDirectory();
  } catch {
    return false;
  }
}
async function exists(path) {
  try {
    await (0, import_promises2.stat)(path);
    return true;
  } catch {
    return false;
  }
}
async function readText(path) {
  try {
    return await (0, import_promises2.readFile)(path, "utf8");
  } catch {
    return null;
  }
}
async function mainCheckoutOf(dir) {
  const gitFile = await readText((0, import_node_path2.join)(dir, ".git"));
  const gitdirLine = gitFile ? /^gitdir:\s*(.+)$/m.exec(gitFile) : null;
  if (!gitdirLine) return null;
  const gitDir = (0, import_node_path2.resolve)(dir, gitdirLine[1].trim());
  const commonDirText = await readText((0, import_node_path2.join)(gitDir, "commondir"));
  if (!commonDirText) return null;
  const commonDir = (0, import_node_path2.resolve)(gitDir, commonDirText.trim());
  return (0, import_node_path2.basename)(commonDir) === ".git" ? (0, import_node_path2.dirname)(commonDir) : null;
}
async function findWorkspaceRoot(directory) {
  let dir = (0, import_node_path2.resolve)(directory);
  for (; ; ) {
    const main2 = await mainCheckoutOf(dir);
    if (main2 && await isDirectory((0, import_node_path2.join)(main2, ".beads"))) return main2;
    if (await isDirectory((0, import_node_path2.join)(dir, ".beads"))) return dir;
    if (await exists((0, import_node_path2.join)(dir, ".git"))) return null;
    const parent = (0, import_node_path2.dirname)(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
async function readMetadata(root) {
  const text = await readText((0, import_node_path2.join)(root, ".beads", "metadata.json"));
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function isPreDolt(metadata) {
  return typeof metadata.database === "string" && metadata.database.endsWith(".db");
}
function modeOf(metadata) {
  if (metadata.dolt_mode === "server") return "server";
  if (metadata.dolt_mode === "embedded") return "embedded";
  return metadata.dolt_server_port !== void 0 || metadata.dolt_server_host !== void 0 ? "server" : "embedded";
}
function probeTarget(metadata) {
  const port = metadata.dolt_server_port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const host = typeof metadata.dolt_server_host === "string" && metadata.dolt_server_host ? metadata.dolt_server_host : "127.0.0.1";
  return LOCAL_HOSTS.has(host) ? { host, port } : null;
}
function acceptsConnections(host, port) {
  return new Promise((resolveProbe) => {
    const socket = (0, import_node_net.connect)({ host, port });
    const done = (up) => {
      socket.destroy();
      resolveProbe(up);
    };
    socket.setTimeout(SERVER_PROBE_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
var versionCache = /* @__PURE__ */ new Map();
async function installedVersion(exe, searchDirs2) {
  let mtimeMs;
  try {
    mtimeMs = (await (0, import_promises2.stat)(exe)).mtimeMs;
  } catch (cause) {
    throw new BdError("not-found", `bd could not be read at ${exe}: ${cause.message}`);
  }
  const cached = versionCache.get(exe);
  if (cached && cached.mtimeMs === mtimeMs) return cached.version;
  const version = (async () => {
    const result = await runBd((0, import_node_path2.dirname)(exe), ["--version"], { searchDirs: searchDirs2 });
    if (result.code !== 0) {
      throw new BdError("exit", `bd --version failed: ${result.stderr.trim() || `exit code ${result.code}`}`, {
        code: result.code,
        stderr: result.stderr
      });
    }
    const parsed = parseVersion(result.stdout);
    if (!parsed) throw new BdError("parse", `bd printed a version that could not be read: ${result.stdout.trim()}`);
    return parsed.join(".");
  })();
  const entry = { mtimeMs, version };
  versionCache.set(exe, entry);
  version.catch(() => {
    if (versionCache.get(exe) === entry) versionCache.delete(exe);
  });
  return version;
}
async function hasDoltRemote(root, searchDirs2) {
  const remotes = await runBdJson(root, ["--readonly", "dolt", "remote", "list", "--json"], { retries: 2, searchDirs: searchDirs2 });
  if (!Array.isArray(remotes)) throw new BdError("parse", "bd printed a remote list that is not a list");
  return remotes.length > 0;
}
async function detectWorkspace(directory, opts = {}) {
  const root = await findWorkspaceRoot(directory);
  if (!root) return { kind: "no-workspace" };
  const metadata = await readMetadata(root);
  if (!metadata) {
    const sqlite = await (0, import_promises2.stat)((0, import_node_path2.join)(root, ".beads", "beads.db")).then((s) => s.isFile(), () => false);
    return sqlite ? { kind: "pre-dolt", root } : { kind: "no-workspace" };
  }
  if (isPreDolt(metadata)) return { kind: "pre-dolt", root };
  const mode = modeOf(metadata);
  if (metadata.dolt_mode === "embedded" && !await isDirectory((0, import_node_path2.join)(root, ".beads", "embeddeddolt"))) {
    return { kind: "no-workspace" };
  }
  const exe = await resolveExecutable("bd", opts.searchDirs);
  if (!exe) return { kind: "no-bd" };
  let bdVersion;
  try {
    bdVersion = await installedVersion(exe, opts.searchDirs);
  } catch (cause) {
    if (cause instanceof BdError && cause.kind === "not-found") return { kind: "no-bd" };
    throw cause;
  }
  if (compareVersions(parseVersion(bdVersion), parseVersion(MIN_BD_VERSION)) < 0) {
    return { kind: "bd-too-old", bdVersion };
  }
  const lastOpenedWith = (await readText((0, import_node_path2.join)(root, ".beads", ".local_version")))?.trim() ?? "";
  const lastOpened = parseVersion(lastOpenedWith);
  if (lastOpened && compareVersions(lastOpened, parseVersion(bdVersion)) > 0) {
    return { kind: "bd-too-old", bdVersion, lastOpenedWith: lastOpened.join(".") };
  }
  if (!opts.confirmedFirstContact && lastOpened && compareVersions(lastOpened, parseVersion(bdVersion)) < 0) {
    return { kind: "needs-first-contact", root, lastOpenedWith: lastOpened.join("."), bdVersion };
  }
  const target = mode === "server" ? probeTarget(metadata) : null;
  if (target && !await acceptsConnections(target.host, target.port)) {
    return { kind: "server-down", root, port: target.port };
  }
  let hasRemote;
  try {
    hasRemote = await hasDoltRemote(root, opts.searchDirs);
  } catch (cause) {
    if (cause instanceof BdError && cause.kind === "exit" && NO_DATABASE.test(`${cause.message}
${cause.stderr}`)) {
      return { kind: "no-workspace" };
    }
    throw cause;
  }
  return { kind: "ok", root, mode, bdVersion, hasRemote, projectName: (0, import_node_path2.basename)(root) };
}

// src/service/bd/audit.ts
var REQUIRED_COLUMNS = ["issue_id", "event_type", "actor", "old_value", "new_value", "created_at", "id"];
var EVENT_COLUMNS = "id, issue_id, event_type, actor, old_value, new_value, created_at";
var AUDIT_LIMIT_MAX = 1e3;
var AUDIT_BEAD_IDS_MAX = 200;
var SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;
var UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/i;
var READ_ONLY_SQL = /^(SELECT|DESCRIBE)\s[^;]*$/i;
function isRow(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSafeDatabaseName(name) {
  return typeof name === "string" && SAFE_ID.test(name) && name !== "." && name !== "..";
}
function rowsFrom(parsed) {
  if (parsed === null || isRow(parsed) && Object.keys(parsed).length === 0) return [];
  const list = Array.isArray(parsed) ? parsed : isRow(parsed) && Array.isArray(parsed.rows) ? parsed.rows : null;
  if (!list) throw new BdError("parse", "the database printed rows in a shape that was not expected");
  return list.filter(isRow);
}
function parseOutput(stdout) {
  if (stdout.trim() === "") return [];
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new BdError("parse", `the database printed output that is not valid JSON: ${cause.message}`);
  }
}
async function runSql(root, mode, query, searchDirs2) {
  if (!READ_ONLY_SQL.test(query)) throw new BdError("exit", "refused: only a single SELECT or DESCRIBE is run");
  const run = { retries: 2, searchDirs: searchDirs2 };
  if (mode === "server") {
    const result2 = await runBd(root, ["--readonly", "sql", "--json", query], run);
    if (result2.code !== 0) throw new BdError("exit", `bd sql failed with exit code ${result2.code}`, { code: result2.code, stderr: result2.stderr });
    return rowsFrom(parseOutput(result2.stdout));
  }
  const database = (await readMetadata(root))?.dolt_database;
  if (!isSafeDatabaseName(database)) throw new BdError("exit", "the project has no usable embedded database name");
  const cwd = (0, import_node_path3.join)(root, ".beads", "embeddeddolt", database);
  const result = await runDolt(cwd, ["sql", "-r", "json", "-q", query], run);
  if (result.code !== 0) throw new BdError("exit", `dolt sql failed with exit code ${result.code}`, { code: result.code, stderr: result.stderr });
  return rowsFrom(parseOutput(result.stdout));
}
var schemaCache = /* @__PURE__ */ new Map();
async function describeEvents(root, mode, searchDirs2) {
  const rows = await runSql(root, mode, "DESCRIBE events", searchDirs2);
  const fields = new Set(rows.map((row) => row.Field).filter((field) => typeof field === "string"));
  return REQUIRED_COLUMNS.every((column) => fields.has(column));
}
function checkAuditSchema(root, mode, opts = {}) {
  const cached = schemaCache.get(root);
  if (cached) return cached;
  const check = describeEvents(root, mode, opts.searchDirs).catch(() => {
    if (schemaCache.get(root) === check) schemaCache.delete(root);
    return false;
  });
  schemaCache.set(root, check);
  return check;
}
function str(value) {
  return typeof value === "string" ? value : "";
}
function optStr(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function toEvent(row) {
  const id = str(row.id);
  const beadId = str(row.issue_id);
  const type = str(row.event_type);
  const rawCreatedAt = str(row.created_at);
  if (id === "" || beadId === "" || type === "" || rawCreatedAt === "") return null;
  return {
    id,
    beadId,
    type,
    actor: optStr(row.actor),
    oldValue: optStr(row.old_value),
    newValue: optStr(row.new_value),
    rawCreatedAt
  };
}
function buildQuery(limit, beadIds) {
  let where = "";
  if (beadIds) {
    if (!beadIds.every((id) => typeof id === "string" && SAFE_ID.test(id))) return null;
    where = ` WHERE issue_id IN (${[...new Set(beadIds)].map((id) => `'${id}'`).join(", ")})`;
  }
  return `SELECT ${EVENT_COLUMNS} FROM events${where} ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
}
async function readAuditEvents(root, mode, opts) {
  try {
    if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > AUDIT_LIMIT_MAX) return null;
    if (opts.beadIds !== void 0) {
      if (!Array.isArray(opts.beadIds) || new Set(opts.beadIds).size > AUDIT_BEAD_IDS_MAX) return null;
      if (opts.beadIds.length === 0) return [];
    }
    const query = buildQuery(opts.limit, opts.beadIds);
    if (query === null) return null;
    if (!await checkAuditSchema(root, mode, { searchDirs: opts.searchDirs })) return null;
    const rows = await runSql(root, mode, query, opts.searchDirs);
    return rows.map(toEvent).filter((event) => event !== null);
  } catch {
    return null;
  }
}
function eventTimeMs(event) {
  if (!UUID_V7.test(event.id)) return null;
  return parseInt(event.id.replace(/-/g, "").slice(0, 12), 16);
}

// src/service/bd/parse.ts
var MAPPED_KEYS = /* @__PURE__ */ new Set([
  "id",
  "title",
  "status",
  "priority",
  "issue_type",
  "assignee",
  "labels",
  "parent",
  "description",
  "design",
  "acceptance_criteria",
  "notes",
  "created_at",
  "created_by",
  "updated_at",
  "closed_at",
  "close_reason",
  "dependencies",
  "comments"
]);
var BOOKKEEPING_KEYS = /* @__PURE__ */ new Set([
  "_type",
  "schema_version",
  "comment_count",
  "dependency_count",
  "dependent_count"
]);
function isObj(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str2(value) {
  return typeof value === "string" ? value : "";
}
function optStr2(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function isEmpty(value) {
  if (value === null || value === void 0 || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return isObj(value) && Object.keys(value).length === 0;
}
function parseDependency(raw, ownerId) {
  if (!isObj(raw)) return null;
  const to = str2(raw.depends_on_id);
  if (to === "") return null;
  return {
    from: optStr2(raw.issue_id) ?? ownerId,
    to,
    kind: str2(raw.type),
    createdBy: optStr2(raw.created_by),
    createdAt: optStr2(raw.created_at)
  };
}
function parseComment(raw) {
  if (!isObj(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  return {
    id: raw.id,
    author: optStr2(raw.author),
    text: str2(raw.text),
    createdAt: str2(raw.created_at)
  };
}
function mapArray(value, map) {
  if (!Array.isArray(value)) return [];
  return value.map(map).filter((item) => item !== null);
}
function parentOf(row, id, dependencies) {
  const direct = optStr2(row.parent);
  if (direct !== null) return direct;
  return dependencies.find((dep) => dep.kind === "parent-child" && dep.from === id)?.to ?? null;
}
function parseIssue(row) {
  if (!isObj(row) || typeof row.id !== "string" || row.id === "") return null;
  const id = row.id;
  const dependencies = mapArray(row.dependencies, (dep) => parseDependency(dep, id));
  const extra = {};
  for (const [key, value] of Object.entries(row)) {
    if (MAPPED_KEYS.has(key) || BOOKKEEPING_KEYS.has(key) || isEmpty(value)) continue;
    extra[key] = value;
  }
  return {
    id,
    title: str2(row.title),
    status: str2(row.status),
    priority: typeof row.priority === "number" && Number.isInteger(row.priority) && row.priority >= 0 && row.priority <= 4 ? row.priority : null,
    type: str2(row.issue_type),
    assignee: optStr2(row.assignee),
    labels: Array.isArray(row.labels) ? row.labels.filter((label) => typeof label === "string") : [],
    parentId: parentOf(row, id, dependencies),
    description: str2(row.description),
    design: str2(row.design),
    acceptance: str2(row.acceptance_criteria),
    notes: str2(row.notes),
    createdAt: str2(row.created_at),
    createdBy: optStr2(row.created_by),
    updatedAt: str2(row.updated_at),
    closedAt: optStr2(row.closed_at),
    closeReason: optStr2(row.close_reason),
    dependencies,
    // bd omits `comments` when the bead has none; only `comment_count` remains.
    comments: mapArray(row.comments, parseComment),
    extra
  };
}
function parseExportWithWarnings(jsonl) {
  const beads = [];
  let skipped = 0;
  let firstSkipped = null;
  const skip = (line) => {
    skipped += 1;
    firstSkipped ??= line;
  };
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skip(line);
      continue;
    }
    if (isObj(row) && typeof row._type === "string" && row._type !== "issue") continue;
    const bead = parseIssue(row);
    if (bead) beads.push(bead);
    else skip(line);
  }
  return { beads, skipped, firstSkipped };
}
function parseList(json) {
  return mapArray(json, parseIssue);
}
function parseComments(json) {
  return mapArray(json, parseComment);
}
function parseStatuses(json) {
  if (!isObj(json)) return [];
  const toDef = (raw) => {
    if (!isObj(raw) || typeof raw.name !== "string" || raw.name === "") return null;
    return { name: raw.name, category: str2(raw.category), icon: optStr2(raw.icon) };
  };
  return [...mapArray(json.built_in_statuses, toDef), ...mapArray(json.custom_statuses, toDef)];
}
function parseTypes(json) {
  if (!isObj(json)) return [];
  const core = mapArray(json.core_types, (raw) => isObj(raw) && typeof raw.name === "string" && raw.name !== "" ? raw.name : null);
  const custom = mapArray(json.custom_types, (raw) => typeof raw === "string" && raw !== "" ? raw : null);
  return [...core, ...custom];
}
function parseReady(json) {
  return mapArray(json, (raw) => isObj(raw) && typeof raw.id === "string" && raw.id !== "" ? raw.id : null);
}

// src/service/bd/adapter.ts
var READ_OPTS = { retries: 2 };
var BAD_LINE_MAX = 200;
var SIGNAL_QUERY = "SELECT DOLT_HASHOF_DB() AS working, DOLT_HASHOF('HEAD') AS head";
var queueTails = /* @__PURE__ */ new Map();
function withRootQueue(root, fn) {
  const previous = queueTails.get(root) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail2 = run.then(
    () => void 0,
    () => void 0
  );
  queueTails.set(root, tail2);
  void tail2.then(() => {
    if (queueTails.get(root) === tail2) queueTails.delete(root);
  });
  return run;
}
var actors = /* @__PURE__ */ new Map();
function osUserName() {
  try {
    return (0, import_node_os2.userInfo)().username;
  } catch {
    return process.env.USER ?? "user";
  }
}
function panelActor(root) {
  const cached = actors.get(root);
  if (cached) return cached;
  const lookup = (async () => {
    let name = "";
    try {
      const result = await runGit(root, ["config", "user.name"]);
      if (result.code === 0) name = result.stdout.trim();
    } catch {
    }
    return `${name || osUserName()} (panel)`;
  })();
  actors.set(root, lookup);
  return lookup;
}
var WriteError = class extends Error {
  code;
  detail;
  saved;
  constructor(code, message, detail = message, saved = false) {
    super(message);
    this.name = "WriteError";
    this.code = code;
    this.detail = detail;
    this.saved = saved;
  }
};
var SAVED_UNREAD = "Saved, but couldn't load the result. Refreshing.";
var BUSY_NOT_SAVED = "Beads is busy. Nothing was saved. Try again in a moment.";
var WRITE_BUDGET_MS = 18e3;
var WRITE_RESERVE_MS = 3e3;
var MIN_WRITE_MS = 1e3;
var MIN_START_MS = WRITE_RESERVE_MS + MIN_WRITE_MS;
var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
var ID_MAX = 128;
var KIND_PATTERN = /^[a-z][a-z0-9-]*$/i;
var OPEN = "open";
var CLOSED = "closed";
function invalid(message) {
  return new WriteError("invalid", message);
}
function checkId(id) {
  if (id.length > ID_MAX || !ID_PATTERN.test(id)) throw invalid("That bead id is not valid.");
}
function checkPriority(priority) {
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) throw invalid("Priority must be a whole number from 0 to 4.");
}
function checkTitle(title) {
  if (title.trim() === "") throw invalid("A bead needs a title.");
}
function checkPatch(patch) {
  if (patch.title !== void 0) checkTitle(patch.title);
  if (patch.priority !== void 0) checkPriority(patch.priority);
  if (patch.status !== void 0 && patch.status.trim() === "") throw invalid("Pick a status.");
  for (const label of patch.labels ?? []) {
    if (label.trim() === "") throw invalid("A label cannot be empty.");
    if (/[\r\n]/.test(label)) throw invalid("A label cannot contain a line break.");
    if (label.includes(",") || label.includes('"')) throw invalid("A label cannot contain a comma or a double quote.");
  }
}
function writeFailure(error, partial = false) {
  const saved = partial ? " Part of your change was saved." : "";
  if (error instanceof WriteError) return error;
  if (!(error instanceof BdError)) return new WriteError("failed", `The change could not be saved.${saved}`, String(error));
  if (error.kind === "not-found") return new WriteError("no-bd", "Beads could not be found on this computer, so nothing was saved.", error.message);
  if (error.kind === "lock") return new WriteError("busy", `Beads is busy.${partial ? saved : " Nothing was saved."} Try again in a moment.`, error.message);
  const text = `${error.message}
${error.stderr}`;
  const blocked = /blocked by open issues\s*\[([^\]]*)\]/i.exec(text);
  if (blocked) {
    const ids = blocked[1].split(/[\s,]+/).filter((id) => id !== "");
    return new WriteError("blocked", `This bead can't be closed yet. It is still blocked by ${ids.join(", ")}. Close those first.${saved}`, text);
  }
  if (/no issue found matching|Error resolving/i.test(text)) {
    return new WriteError("not-found", `That bead no longer exists.${saved}`, text);
  }
  const existing = /already exists with type "([^"]+)"/i.exec(text);
  if (existing) {
    return new WriteError("dep-exists", `These two beads are already linked as "${existing[1]}". Remove that link first, then add the new one.${saved}`, text);
  }
  if (/in conflict|Merge conflict detected/i.test(text)) {
    return new WriteError("merge-conflict", `The team sync has changes that need sorting out first. Resolve them, then try again.${saved}`, text);
  }
  if (/tasks can only block other tasks/i.test(text)) return new WriteError("invalid", "Only tasks can block other tasks.", text);
  return new WriteError("failed", `The change could not be saved.${saved}`, text);
}
function readFailure(error) {
  if (error instanceof BdError && (error.kind === "timeout" || error.kind === "lock")) {
    return new WriteError("busy", BUSY_NOT_SAVED, error.message);
  }
  return writeFailure(error);
}
var NotStarted = class extends Error {
};
function notStartedError(partial) {
  return partial ? new WriteError("busy", "Beads is busy. Part of your change was saved. Try again in a moment.", "ran out of time before the last step") : new WriteError("busy", BUSY_NOT_SAVED, "ran out of time before the write started");
}
function ensureCanStart(overall) {
  if (overall - Date.now() < MIN_START_MS) throw notStartedError(false);
}
var panelWriteListeners = /* @__PURE__ */ new Set();
function onPanelWrite(listener) {
  panelWriteListeners.add(listener);
  return () => panelWriteListeners.delete(listener);
}
var patchFields = (patch) => Object.keys(patch).filter((key) => patch[key] !== void 0);
async function notifyPanelWrite(root, beadId, wrote) {
  const problems = [];
  for (const listener of [...panelWriteListeners]) {
    try {
      await listener(root, beadId, wrote);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  return problems.length > 0 ? `Could not note the change to ${beadId}: ${problems.join("; ")}` : void 0;
}
async function readBeadRow(root, id, deadlineAt) {
  const rows = await runBdJson(root, ["--readonly", "list", "--all", "--id", id, "--json"], { ...READ_OPTS, deadlineAt });
  const bead = parseList(rows).find((b) => b.id === id);
  if (!bead) return null;
  const raw = (Array.isArray(rows) ? rows : []).find((row) => row?.id === id);
  return { bead, commentCount: typeof raw?.comment_count === "number" ? raw.comment_count : 0 };
}
async function withComments(root, row, deadlineAt) {
  if (row.commentCount > 0) {
    row.bead.comments = parseComments(await runBdJson(root, ["--readonly", "comments", row.bead.id, "--json"], { ...READ_OPTS, deadlineAt }));
  }
  return row.bead;
}
async function readBead(root, id, deadlineAt) {
  const row = await readBeadRow(root, id, deadlineAt);
  return row === null ? null : withComments(root, row, deadlineAt);
}
function runWrite(root, actor, args, overall) {
  const deadlineAt = overall - WRITE_RESERVE_MS;
  if (deadlineAt - Date.now() < MIN_WRITE_MS) return Promise.reject(new NotStarted());
  return runBdJson(root, ["--actor", actor, ...args], { retries: 0, deadlineAt });
}
async function writeOne(root, actor, args, overall, owner, what) {
  try {
    return await runWrite(root, actor, args, overall);
  } catch (error) {
    if (error instanceof NotStarted) throw notStartedError(false);
    if (error instanceof BdError && error.kind === "timeout") {
      const noted = owner !== null ? await notifyPanelWrite(root, owner.id, owner.wrote) : void 0;
      throw new WriteError("uncertain", `Beads did not answer in time. The ${what} may or may not have been saved. Check before trying again.`, [error.message, noted].filter(Boolean).join("\n"));
    }
    throw writeFailure(error);
  }
}
var sameLabels = (a, b) => a.length === b.length && new Set(a).size === (/* @__PURE__ */ new Set([...a, ...b])).size;
function stillAsShown(expected, current) {
  for (const [key, value] of Object.entries(expected)) {
    if (value === void 0) continue;
    const now = current[key];
    if (key === "title" ? String(value).trim() !== String(now).trim() : key === "labels" ? !sameLabels(value, now) : key === "assignee" ? (value || null) !== (now || null) : value !== now) return false;
  }
  return true;
}
function planUpdate(id, current, patch, done) {
  const flags = [];
  const title = patch.title?.trim();
  if (title !== void 0 && title !== current.title) flags.push(`--title=${title}`);
  if (patch.priority !== void 0 && patch.priority !== current.priority) flags.push(`--priority=${patch.priority}`);
  if (patch.assignee !== void 0) {
    const assignee = patch.assignee === "" ? null : patch.assignee;
    if (assignee !== current.assignee) flags.push(`--assignee=${assignee ?? ""}`);
  }
  if (patch.description !== void 0 && patch.description !== current.description) flags.push(`--description=${patch.description}`);
  if (patch.design !== void 0 && patch.design !== current.design) flags.push(`--design=${patch.design}`);
  if (patch.acceptance !== void 0 && patch.acceptance !== current.acceptance) flags.push(`--acceptance=${patch.acceptance}`);
  if (patch.notes !== void 0 && patch.notes !== current.notes) flags.push(`--notes=${patch.notes}`);
  if (patch.labels !== void 0) {
    const wanted = new Set(patch.labels);
    const have = new Set(current.labels);
    for (const label of wanted) if (!have.has(label)) flags.push(`--add-label=${label}`);
    for (const label of have) if (!wanted.has(label)) flags.push(`--remove-label=${label}`);
  }
  const steps = [];
  const target = patch.status;
  if (target !== void 0 && target !== current.status) {
    const toDone = done.has(target);
    const fromDone = done.has(current.status);
    if (toDone && (!fromDone || target === CLOSED)) {
      const reason = patch.closeReason?.trim();
      steps.push(["close", "--json", ...reason ? [`--reason=${reason}`] : [], "--", id]);
      if (target !== CLOSED) flags.push(`--status=${target}`);
    } else if (!toDone && current.status === CLOSED) {
      steps.push(["reopen", "--json", "--", id]);
      if (target !== OPEN) flags.push(`--status=${target}`);
    } else {
      flags.push(`--status=${target}`);
    }
  }
  if (flags.length > 0) steps.push(["update", "--json", ...flags, "--", id]);
  return steps;
}
function rowString(row, key) {
  const value = row?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}
var BdProvider = class {
  constructor(root, mode) {
    this.root = root;
    this.mode = mode;
  }
  root;
  mode;
  /**
   * A string that differs whenever the database does (working set and last commit). Cheap: about 0.15 s embedded, 0.25 s server.
   * When the query cannot run because a tool is missing (embedded mode without the dolt CLI), the last commit hash from
   * `bd vc status` stands in. When that cannot be read either, this throws a `not-found` BdError.
   */
  changeSignal() {
    return withRootQueue(this.root, async () => {
      try {
        const [row] = await runSql(this.root, this.mode, SIGNAL_QUERY, void 0);
        const working = rowString(row, "working");
        const head = rowString(row, "head");
        if (working === null || head === null) throw new BdError("parse", "the database did not answer with a change signal");
        return `${working}:${head}`;
      } catch (error) {
        if (!(error instanceof BdError) || error.kind !== "not-found") throw error;
        return this.vcStatusSignal(error);
      }
    });
  }
  async vcStatusSignal(primary) {
    try {
      const status = await runBdJson(this.root, ["--readonly", "vc", "status", "--json"], READ_OPTS);
      const commit = typeof status === "object" && status !== null ? status.commit : void 0;
      if (typeof commit !== "string" || commit === "") throw new BdError("parse", "bd vc status did not print a commit");
      return `vc:${commit}`;
    } catch (error) {
      if (error instanceof BdError && (error.kind === "lock" || error.kind === "timeout")) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new BdError("not-found", `no change signal is available (${primary.message}; ${reason})`);
    }
  }
  /**
   * Every bead. Throws when bd fails, or when any line of the output could not be read: an export is
   * applied whole or not at all, never with beads missing (a missing bead would show as deleted).
   */
  export() {
    return withRootQueue(this.root, async () => {
      const result = await runBd(this.root, ["--readonly", "export"], READ_OPTS);
      if (result.code !== 0) {
        throw new BdError("exit", `bd export failed with exit code ${result.code}`, { code: result.code, stderr: result.stderr });
      }
      const { beads, skipped, firstSkipped } = parseExportWithWarnings(result.stdout);
      if (skipped > 0) {
        const line = firstSkipped ?? "";
        const first = line.length > BAD_LINE_MAX ? `${line.slice(0, BAD_LINE_MAX)}\u2026` : line;
        throw new BdError("parse", `bd export printed ${skipped} line${skipped === 1 ? "" : "s"} that could not be read; the first was: ${first}`, {
          stderr: result.stderr
        });
      }
      return beads;
    });
  }
  statuses() {
    return withRootQueue(this.root, async () => parseStatuses(await runBdJson(this.root, ["--readonly", "statuses", "--json"], READ_OPTS)));
  }
  types() {
    return withRootQueue(this.root, async () => parseTypes(await runBdJson(this.root, ["--readonly", "types", "--json"], READ_OPTS)));
  }
  /** Ids of ready beads. `--limit 0`: bd's default stops at 100. */
  ready() {
    return withRootQueue(this.root, async () => parseReady(await runBdJson(this.root, ["--readonly", "ready", "--json", "--limit", "0"], READ_OPTS)));
  }
  /**
   * Changes a bead if it is still as the panel last saw it (`expectedUpdatedAt`): the bead is read again first, and a
   * different `updatedAt` returns `conflict` with the current bead and writes nothing. Fields that already have the
   * wanted value are left out. A status change into a done category closes first (with `closeReason`; a refused close
   * stops everything), and a custom done status is then set with an update. Away from "closed" it reopens.
   * Beads not answering in time returns `uncertain` (never retried); the write saved but could not be read back returns
   * `uncertain` with `saved: true`. Throws WriteError for a refusal, and `busy` when the queue wait used up the 18 s.
   */
  async update(id, expectedUpdatedAt, patch, actor, expected = {}) {
    checkId(id);
    checkPatch(patch);
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      let row;
      try {
        row = await readBeadRow(this.root, id, overall);
      } catch (error) {
        throw readFailure(error);
      }
      if (row === null) throw new WriteError("not-found", "That bead no longer exists.");
      const current = row.bead;
      const returnCurrent = async () => {
        try {
          return await withComments(this.root, row, overall);
        } catch (error) {
          throw readFailure(error);
        }
      };
      if (current.updatedAt !== expectedUpdatedAt || !stillAsShown(expected, current)) return { ok: false, conflict: true, current: await returnCurrent() };
      let done = /* @__PURE__ */ new Set([CLOSED]);
      if (patch.status !== void 0 && patch.status !== current.status) {
        try {
          const statuses = parseStatuses(await runBdJson(this.root, ["--readonly", "statuses", "--json"], { ...READ_OPTS, deadlineAt: overall }));
          if (statuses.length > 0 && !statuses.some((s) => s.name === patch.status)) throw invalid(`"${patch.status}" is not a status in this project.`);
          done = /* @__PURE__ */ new Set([CLOSED, ...statuses.filter((s) => s.category === "done").map((s) => s.name)]);
        } catch (error) {
          throw readFailure(error);
        }
      }
      const steps = planUpdate(id, current, patch, done);
      if (steps.length === 0) return { ok: true, bead: await returnCurrent() };
      let wrote = false;
      try {
        for (const step2 of steps) {
          await runWrite(this.root, actor, step2, overall);
          wrote = true;
        }
      } catch (error) {
        const timedOut = error instanceof BdError && error.kind === "timeout";
        const noted2 = wrote || timedOut ? await notifyPanelWrite(this.root, id, { fields: patchFields(patch) }) : void 0;
        if (timedOut) {
          const detail = [noted2, error.message].filter(Boolean).join("\n");
          return { ok: false, uncertain: true, current: await this.readAgain(id, overall), detail };
        }
        const failure = error instanceof NotStarted ? notStartedError(wrote) : writeFailure(error, wrote);
        throw new WriteError(failure.code, failure.message, noted2 ? `${failure.detail}
${noted2}` : failure.detail, failure.saved || wrote);
      }
      const noted = await notifyPanelWrite(this.root, id, { fields: patchFields(patch) });
      const bead = await this.readAgain(id, overall);
      if (bead === null) return { ok: false, uncertain: true, current: null, saved: true, ...noted ? { detail: noted } : {} };
      return { ok: true, bead, ...noted ? { detail: noted } : {} };
    });
  }
  /** A re-read that gives up quietly: null when there is no time, no answer, or no such bead. Call inside the queue. */
  async readAgain(id, overall) {
    try {
      return await readBead(this.root, id, overall);
    } catch {
      return null;
    }
  }
  /**
   * Makes a bead and returns it as Beads lists it. Throws WriteError. A timeout is `uncertain` (it may exist, look before
   * trying again); a bead that was made but could not be read back is `uncertain` with `saved: true`.
   */
  async create(input, actor) {
    checkTitle(input.title);
    checkPriority(input.priority);
    if (input.type.trim() === "") throw invalid("Pick a type.");
    if (input.parentId !== null) checkId(input.parentId);
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      const args = [
        "create",
        "--json",
        `--title=${input.title.trim()}`,
        `--type=${input.type}`,
        `--priority=${input.priority}`,
        ...input.parentId !== null ? [`--parent=${input.parentId}`] : [],
        ...input.description !== "" ? [`--description=${input.description}`] : []
      ];
      const created = await writeOne(this.root, actor, args, overall, null, "bead");
      const id = typeof created?.id === "string" ? created.id : "";
      if (id === "") throw new WriteError("uncertain", SAVED_UNREAD, `create did not print an id: ${JSON.stringify(created)}`, true);
      const noted = await notifyPanelWrite(this.root, id, { created: true });
      const bead = await this.readAgain(id, overall);
      if (bead === null) throw new WriteError("uncertain", SAVED_UNREAD, [`${id} was created but could not be read back`, noted].filter(Boolean).join("\n"), true);
      return bead;
    });
  }
  /** Adds a comment written by the panel's actor. Throws WriteError; a timeout is `uncertain` (it may have been added). */
  async comment(id, text, actor) {
    checkId(id);
    if (text.trim() === "") throw invalid("A comment cannot be empty.");
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      const added = await writeOne(this.root, actor, ["comments", "add", "--json", `--author=${actor}`, "--", id, text], overall, { id, wrote: { comment: true } }, "comment");
      const noted = await notifyPanelWrite(this.root, id, { comment: true });
      const [comment] = parseComments([added]);
      if (!comment) throw new WriteError("uncertain", SAVED_UNREAD, [`comments add printed: ${JSON.stringify(added)}`, noted].filter(Boolean).join("\n"), true);
      return comment;
    });
  }
  /**
   * `from` depends on `to`. Removing needs no kind: Beads keeps one dependency per ordered pair, so the pair names it
   * (`kind` is ignored then). Throws WriteError; a timeout is `uncertain`.
   */
  async dependency(op, from, to, kind, actor) {
    checkId(from);
    checkId(to);
    if (op === "add" && !KIND_PATTERN.test(kind)) throw invalid("That is not a kind of link.");
    const overall = Date.now() + WRITE_BUDGET_MS;
    return withRootQueue(this.root, async () => {
      ensureCanStart(overall);
      const args = op === "add" ? ["dep", "add", "--json", `--type=${kind}`, "--", from, to] : ["dep", "remove", "--json", "--", from, to];
      const wrote = { deps: [[from, to]] };
      await writeOne(this.root, actor, args, overall, { id: from, wrote }, "link");
      await notifyPanelWrite(this.root, from, wrote);
    });
  }
};

// src/service/errors.ts
var DETAIL_MAX = 4e3;
function capText(text, max) {
  return text.length > max ? `${text.slice(0, max)}\u2026` : text;
}
var NO_DOLT_TEXT = "Publishing needs the Dolt tool, which isn't installed.";
function isNoDolt(error) {
  return error instanceof BdError && error.kind === "not-found" && /^dolt\b/.test(error.message);
}
function isBusyError(error) {
  return error instanceof BdError && (error.kind === "lock" || error.kind === "timeout");
}
function errorDetail(error) {
  const text = error instanceof BdError ? [error.message, error.stderr.trim()].filter(Boolean).join("\n") : error instanceof Error ? error.message : String(error);
  return capText(text, DETAIL_MAX);
}
function readErrorText(error, retrying) {
  if (isBusyError(error)) return retrying ? "Beads is busy. Retrying." : "Beads is busy. Try again in a moment.";
  return retrying ? "Couldn't read beads. Retrying." : "Couldn't read beads.";
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

// src/service/context.ts
var CAP = 16e3;
var MARK = " [truncated]";
var FIELD_FLOOR = 500;
var TITLE_MAX = 200;
var RULES_MAX = 4e3;
var TRIMMED_LOG = "[earlier output trimmed]\n";
var ISSUE_PREFIX = "Beads issue context (JSON)\n";
var CONFLICT_PREFIX = "Beads sync needs attention (JSON)\n";
function largest(max, ok2) {
  let lo = 0;
  let hi = max;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok2(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
function plainSlice(text, keep) {
  let end = Math.min(keep, text.length);
  if (end > 0 && end < text.length) {
    const code = text.charCodeAt(end - 1);
    if (code >= 55296 && code <= 56319) end -= 1;
  }
  return text.slice(0, end);
}
function cutStart(text, keep) {
  return plainSlice(text, keep) + MARK;
}
function cutField(text, keep) {
  if (keep <= 0) return "";
  if (keep + MARK.length >= text.length) return text;
  return cutStart(text, keep);
}
var clampText = (text) => cutField(text, FIELD_FLOOR);
var clampTitle = (title) => title.length > TITLE_MAX ? `${plainSlice(title, TITLE_MAX - 1)}\u2026` : title;
function clampValue(value) {
  if (typeof value === "string") return clampText(value);
  if (value === null || typeof value !== "object") return value;
  const json = JSON.stringify(value);
  return json.length > FIELD_FLOOR ? cutStart(json, FIELD_FLOOR) : value;
}
function clampFields(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return clampValue(value);
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, clampValue(inner)]));
}
function cutEnd(text, keep) {
  let start2 = Math.max(0, text.length - keep);
  if (start2 > 0 && start2 < text.length) {
    const code = text.charCodeAt(start2);
    if (code >= 56320 && code <= 57343) start2 += 1;
  }
  return text.slice(start2);
}
var SEGMENT = /^[A-Za-z0-9._~-]+$/;
function parseRemote(remote) {
  const text = remote.trim();
  let host;
  let hostname;
  let path;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) {
    const url = new URL(text);
    if (!["http:", "https:", "ssh:", "git:"].includes(url.protocol)) return null;
    hostname = url.hostname.toLowerCase();
    host = url.protocol === "http:" || url.protocol === "https:" ? url.host.toLowerCase() : hostname;
    path = url.pathname;
  } else {
    const match = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(text);
    if (!match) return null;
    hostname = match[1].toLowerCase();
    host = hostname;
    path = match[2];
  }
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length < 2 || !segments.every((segment) => SEGMENT.test(segment))) return null;
  const last = segments[segments.length - 1];
  if (last.endsWith(".git")) segments[segments.length - 1] = last.slice(0, -".git".length);
  if (segments.some((segment) => segment === "")) return null;
  return { host, hostname, segments };
}
var NO_WEB_PAGE_URL = "https://github.com/lantzleiweke/abacus/blob/main/docs/user-guide.md#beads-with-no-web-page";
var isForgeHost = (hostname) => hostname === "github.com" || hostname === "gitlab.com" || hostname.includes("gitlab");
async function beadUrl(root, _projectName, id) {
  const fallback = NO_WEB_PAGE_URL;
  try {
    const result = await runGit(root, ["remote", "get-url", "origin"]);
    if (result.code !== 0) return fallback;
    const location = parseRemote(result.stdout);
    if (!location || !isForgeHost(location.hostname)) return fallback;
    return `https://${location.host}/${location.segments.join("/")}?bead=${encodeURIComponent(id)}`;
  } catch {
    return fallback;
  }
}
var refOf = (bead) => ({ id: bead.id, title: bead.title, status: bead.status });
var TEXT_FIELDS = ["description", "design", "notes"];
var ACCEPTANCE_RESERVE = 2e3;
var omittedKey = (count, key) => count > 0 ? { [key]: count } : {};
function buildContext(bead, related, stale) {
  const staleKeys = stale ? { stale: true, readAt: stale.readAt } : {};
  const children = related.children.map(refOf);
  const dependencies = related.deps.map(({ dep, other, direction }) => ({
    kind: dep.kind,
    direction,
    id: direction === "out" ? dep.to : dep.from,
    title: other?.title ?? null,
    status: other?.status ?? null
  }));
  const comments = bead.comments.map((comment, index) => ({ comment, index })).sort((a, b) => a.comment.createdAt < b.comment.createdAt ? -1 : a.comment.createdAt > b.comment.createdAt ? 1 : a.index - b.index).map(({ comment }) => ({ author: comment.author, createdAt: comment.createdAt, text: comment.text }));
  const d = {
    title: bead.title,
    labels: bead.labels,
    labelsOmitted: 0,
    children,
    childrenOmitted: 0,
    dependencies,
    dependenciesOmitted: 0,
    description: bead.description,
    acceptance: bead.acceptance,
    design: bead.design,
    notes: bead.notes,
    closeReason: bead.closeReason,
    extra: bead.extra,
    extraOmitted: 0,
    comments
  };
  const issueOf = () => ({
    id: bead.id,
    title: d.title,
    type: bead.type,
    status: bead.status,
    priority: bead.priority,
    assignee: bead.assignee,
    labels: d.labels,
    ...omittedKey(d.labelsOmitted, "labelsOmitted"),
    parent: related.parent ? refOf(related.parent) : null,
    children: d.children,
    ...omittedKey(d.childrenOmitted, "childrenOmitted"),
    dependencies: d.dependencies,
    ...omittedKey(d.dependenciesOmitted, "dependenciesOmitted"),
    description: d.description,
    acceptance: d.acceptance,
    design: d.design,
    notes: d.notes,
    createdAt: bead.createdAt,
    createdBy: bead.createdBy,
    updatedAt: bead.updatedAt,
    closedAt: bead.closedAt,
    closeReason: d.closeReason,
    extra: d.extra,
    ...omittedKey(d.extraOmitted, "extraOmitted")
  });
  const render = () => ISSUE_PREFIX + JSON.stringify({ ...staleKeys, issue: issueOf(), comments: d.comments }, null, 2);
  const fits = () => render().length <= CAP;
  const setComments = (n) => {
    d.comments = comments.slice(comments.length - n);
  };
  const setRelations = (n) => {
    d.children = children.slice(0, n);
    d.childrenOmitted = children.length - d.children.length;
    d.dependencies = dependencies.slice(0, n);
    d.dependenciesOmitted = dependencies.length - d.dependencies.length;
  };
  const setField = (field, n) => {
    d[field] = cutField(bead[field], n);
  };
  const setAcceptance = (n) => {
    d.acceptance = cutField(bead.acceptance, n);
  };
  if (!fits()) {
    d.closeReason = bead.closeReason === null ? null : clampText(bead.closeReason);
    d.extra = clampFields(bead.extra);
  }
  if (!fits()) {
    d.comments = [];
    for (const field of TEXT_FIELDS) d[field] = clampText(bead[field]);
    const n = largest(Math.max(children.length, dependencies.length), (count) => {
      setRelations(count);
      return fits();
    });
    setRelations(n);
    for (const field of TEXT_FIELDS) d[field] = bead[field];
    d.comments = comments;
  }
  if (!fits()) {
    const n = largest(comments.length, (count) => {
      setComments(count);
      return fits();
    });
    setComments(n);
  }
  for (const field of TEXT_FIELDS) {
    if (fits()) break;
    const full = bead[field];
    if (full.length <= FIELD_FLOOR + MARK.length) continue;
    const extra = largest(full.length - MARK.length - 1 - FIELD_FLOOR, (more) => {
      setField(field, FIELD_FLOOR + more);
      return fits();
    });
    setField(field, FIELD_FLOOR + extra);
  }
  if (!fits()) {
    const entries = Object.entries(d.extra);
    if (entries.length > 0) {
      const keep = largest(entries.length, (n) => {
        d.extra = Object.fromEntries(entries.slice(0, n));
        d.extraOmitted = entries.length - n;
        return fits();
      });
      d.extra = Object.fromEntries(entries.slice(0, keep));
      d.extraOmitted = entries.length - keep;
    }
    if (!fits() && bead.labels.length > 0) {
      const keep = largest(bead.labels.length, (n) => {
        d.labels = bead.labels.slice(0, n);
        d.labelsOmitted = bead.labels.length - n;
        return fits();
      });
      d.labels = bead.labels.slice(0, keep);
      d.labelsOmitted = bead.labels.length - keep;
    }
  }
  if (!fits()) {
    setAcceptance(ACCEPTANCE_RESERVE);
    for (const field of TEXT_FIELDS) {
      if (fits()) break;
      if (d[field] === "") continue;
      const keep2 = largest(FIELD_FLOOR, (n) => {
        setField(field, n);
        return fits();
      });
      setField(field, keep2);
    }
    if (!fits()) d.title = clampTitle(bead.title);
    const keep = largest(bead.acceptance.length, (n) => {
      setAcceptance(n);
      return fits();
    });
    setAcceptance(keep);
  }
  const title = clampTitle(bead.title);
  if (fits()) return { text: render(), title };
  const minimal = {
    ...staleKeys,
    issue: { id: plainSlice(bead.id, 128), title, status: plainSlice(bead.status, 100), priority: bead.priority, contextTruncated: true },
    comments: []
  };
  return { text: ISSUE_PREFIX + JSON.stringify(minimal, null, 2), title };
}
function lastCommandStart(log) {
  let at = -1;
  for (const match of log.matchAll(/^\$ bd /gm)) at = match.index;
  return at < 0 ? log.length : at;
}
function buildConflictContext(directory, state, rules) {
  const source = state.kind === "conflict" ? state.beads : [];
  const whole = (info) => ({ id: info.beadId, title: info.title, ours: info.ours, theirs: info.theirs });
  const clamped = (info) => ({ id: info.beadId, title: info.title === null ? null : clampText(info.title), ours: clampFields(info.ours), theirs: clampFields(info.theirs) });
  let beads = source.map(whole);
  let omitted = 0;
  let log = state.log;
  let projectRules = rules !== null && rules.length > RULES_MAX ? cutStart(rules, RULES_MAX) : rules;
  const render = () => {
    const payload = { project: directory };
    if (state.kind === "conflict") payload.mode = state.mode;
    payload.problem = state.kind;
    if (state.kind === "conflict") payload.halfMerged = state.halfMerged;
    else payload.message = state.message;
    payload.beads = beads;
    if (omitted > 0) payload.beadsOmitted = omitted;
    payload.log = log;
    payload.projectRules = projectRules;
    return CONFLICT_PREFIX + JSON.stringify(payload, null, 2);
  };
  const fits = () => render().length <= CAP;
  const full = state.log;
  const setLog = (n) => {
    log = n <= 0 ? "" : n >= full.length ? full : TRIMMED_LOG + cutEnd(full, n);
  };
  const setBeads = (n) => {
    beads = source.slice(0, n).map(clamped);
    omitted = source.length - n;
  };
  if (!fits()) beads = source.map(clamped);
  if (!fits()) {
    const floor = full.length - lastCommandStart(full);
    const more = largest(full.length - floor, (extra) => {
      setLog(floor + extra);
      return fits();
    });
    setLog(floor + more);
  }
  if (!fits()) {
    const keep = largest(source.length, (n) => {
      setBeads(n);
      return fits();
    });
    setBeads(keep);
  }
  if (!fits() && rules !== null) {
    const base = projectRules ?? "";
    const keep = largest(base.length, (n) => {
      projectRules = cutField(base, n);
      return fits();
    });
    projectRules = cutField(base, keep);
  }
  if (!fits()) {
    const keep = largest(full.length, (n) => {
      setLog(n);
      return fits();
    });
    setLog(keep);
  }
  return render();
}

// src/service/snapshot.ts
var import_node_crypto = require("node:crypto");
var import_promises3 = require("node:fs/promises");
var import_node_os3 = require("node:os");
var import_node_path4 = require("node:path");

// src/service/shell.ts
function shellQuote(arg) {
  if (arg !== "" && /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

// src/service/sync.ts
var JOB_RUN = { timeoutMs: 12e4, deadlineMs: 12e4, retries: 2 };
var LOOKUP_RUN = { timeoutMs: 2e4, deadlineMs: 2e4, retries: 2 };
var POLL_RUN = { retries: 2 };
var MAX_PUSH_ATTEMPTS = 3;
var LOG_MAX = 8e3;
var OUTPUT_MAX = 3e3;
var UNPUBLISHED_LIMIT = 1e3;
var UNPUBLISHED_FALLBACK_LIMIT = 500;
var CONFLICT_LIMIT = 100;
var SAFE_REMOTE = /^[A-Za-z0-9._-]{1,64}$/;
var SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,128}$/;
var ABORTED = /merge aborted and working set restored/i;
var CONFLICT_TEXT = /merge conflicts? in/i;
var DIRTY_CONFIG = /refusing to auto-commit[^\n]*dirty[^\n]*config/i;
var EMPTY_REMOTE = /no branches found in remote/i;
var FORMAT_REFUSAL = /unsupported (?:storage |database |dolt )?format|format version|newer version of bd|please upgrade|(?:schema|storage) version[^\n]*(?:newer|unsupported|mismatch)/i;
var REJECTED = /non-fast-forward|\[rejected\]/i;
var AUTH = /authentication failed|permission denied|access denied|could not read username|invalid credentials|\b40[13]\b|not authorized|publickey/i;
var NETWORK = /could not resolve host|unable to access|connection (?:refused|timed out|reset)|network is unreachable|no route to host|timed out|dial tcp|name resolution|unexpected eof/i;
var MESSAGES = {
  noRemote: "This project has no shared copy with the team, so there is nothing to sync with.",
  dirtyConfig: "Some project settings changed on this computer and have not been saved, so Sync cannot start. Ask your agent to save or undo them, then try again.",
  upgrade: "This project's beads data needs a different Beads version. Hand it to your agent to check.",
  auth: "The team's shared copy did not accept your sign-in. Check your access, then try again.",
  network: "Could not reach the team's shared copy. Check your connection, then try again.",
  generic: "Sync did not finish. Try again, or copy the details.",
  timeout: "Beads did not answer in time. Try again.",
  notFound: "Beads could not be found on this computer.",
  busy: "Beads is busy with another task. Try again in a moment.",
  churn: "The team keeps changing the shared copy while you publish. Try again.",
  stale: "New changes arrived since you looked. Review them again.",
  pending: "Some changes on this computer are still being saved. Try again in a moment.",
  emptyPull: "The team's shared copy is empty, so there is nothing to bring in yet.",
  emptyPublish: "The team's shared copy is empty, so there is nothing to publish into yet. Setting it up the first time is a one-time step: hand it to your agent. Nothing was published."
};
var PREVIEW_STALE_TEXT = MESSAGES.stale;
var roots = /* @__PURE__ */ new Map();
var syncedListeners = /* @__PURE__ */ new Set();
var changeListeners = /* @__PURE__ */ new Set();
function rootSync(root) {
  let entry = roots.get(root);
  if (!entry) {
    entry = { state: { kind: "idle" }, blocked: false, lastTeamSyncAt: null, teamSeenEmpty: false, job: null, revision: 0 };
    roots.set(root, entry);
  }
  return entry;
}
function onTeamSynced(listener) {
  syncedListeners.add(listener);
  return () => syncedListeners.delete(listener);
}
function onSyncChange(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}
function notifyChange(root) {
  for (const listener of changeListeners) {
    try {
      listener(root);
    } catch {
    }
  }
}
function setState(root, state) {
  const entry = rootSync(root);
  entry.state = state;
  entry.revision += 1;
  notifyChange(root);
}
function syncState(root) {
  return rootSync(root).state;
}
function syncSignature(root) {
  const entry = rootSync(root);
  return `${entry.revision}${entry.blocked ? "b" : ""}`;
}
function lastTeamSync(root) {
  return rootSync(root).lastTeamSyncAt;
}
function seedLastTeamSync(root, iso) {
  if (!iso || Number.isNaN(Date.parse(iso))) return;
  const entry = rootSync(root);
  if (entry.lastTeamSyncAt === null || Date.parse(iso) > Date.parse(entry.lastTeamSyncAt)) entry.lastTeamSyncAt = iso;
}
function markSynced(root) {
  const entry = rootSync(root);
  let at = Date.now();
  if (entry.lastTeamSyncAt !== null) at = Math.max(at, Date.parse(entry.lastTeamSyncAt) + 1);
  const iso = new Date(at).toISOString();
  entry.lastTeamSyncAt = iso;
  for (const listener of syncedListeners) {
    try {
      listener(root, iso);
    } catch {
    }
  }
}
function writesBlocked(root) {
  return rootSync(root).blocked;
}
var tail = (text, max) => text.length > max ? text.slice(text.length - max) : text;
var redact = (text) => text.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s@]+@/g, "$1***@");
var commandLine = (args) => `$ bd ${args.map(shellQuote).join(" ")}`;
var JobLog = class {
  parts = [];
  command(args, result) {
    const lines = [commandLine(args), `exit ${result.code}`];
    for (const output of [result.stdout, result.stderr]) if (output.trim() !== "") lines.push(tail(output.trim(), OUTPUT_MAX));
    this.parts.push(lines.join("\n"));
  }
  failure(args, error) {
    this.parts.push(`${commandLine(args)}
failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  note(text) {
    this.parts.push(text);
  }
  text() {
    return tail(redact(this.parts.join("\n\n")), LOG_MAX);
  }
};
function parseRemotes(stdout) {
  const text = stdout.trim();
  if (text === "" || text === "null") return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BdError("parse", "the remote list was not valid JSON");
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray(parsed.remotes) ? parsed.remotes : null;
  if (!list) throw new BdError("parse", "the remote list was not in the expected shape");
  return list.filter((item) => !!item && typeof item === "object" && typeof item.name === "string");
}
var REMOTE_LIST = ["--readonly", "dolt", "remote", "list", "--json"];
async function chooseRemote(root, log, run) {
  let result;
  try {
    result = await runBd(root, REMOTE_LIST, run);
  } catch (error) {
    log?.failure(REMOTE_LIST, error);
    throw error;
  }
  log?.command(REMOTE_LIST, result);
  if (result.code !== 0) throw new BdError("exit", `listing the remotes failed with exit code ${result.code}`, { code: result.code, stderr: result.stderr });
  const remotes = parseRemotes(result.stdout);
  if (remotes.length === 0) return null;
  const chosen = remotes.find((r) => r.name === "origin") ?? remotes[0];
  if (!SAFE_REMOTE.test(chosen.name)) throw new BdError("parse", "the remote has a name that is not safe to use");
  return { name: chosen.name };
}
var remoteSelector = (remote) => remote.name === "origin" ? [] : ["--remote", remote.name];
async function activeBranch(root, mode) {
  const rows = await runSql(root, mode, "SELECT active_branch() AS branch", void 0);
  const branch = rows[0]?.branch;
  if (typeof branch !== "string" || !SAFE_BRANCH.test(branch)) throw new BdError("parse", "the current branch has a name that is not safe to use");
  return branch;
}
var VERBS = {
  update: "Updated",
  create: "Created",
  close: "Closed",
  delete: "Deleted",
  reopen: "Reopened",
  comment: "Commented on",
  "comments add": "Commented on",
  "dep add": "Linked",
  "dep remove": "Unlinked",
  "label add": "Labeled",
  "label remove": "Unlabeled"
};
function summaryOf(verb, ids) {
  const word = VERBS[verb] ?? "Changed";
  return ids.length > 0 ? `${word} ${ids.join(", ")}` : `${word} beads`;
}
function describeCommit(message) {
  const first = message.split("\n")[0] ?? "";
  const embedded = /^bd: ([a-z-]+(?: [a-z-]+)?)(?: \(auto-commit\))? by (.+?) \[([^\]]*)\]\s*$/.exec(first);
  if (embedded) {
    const ids = embedded[3].split(",").map((id) => id.trim()).filter(Boolean);
    return { beadIds: ids, summary: summaryOf(embedded[1], ids), actor: embedded[2].trim() };
  }
  const server = /^bd: (\S+) (\S+)\s*$/.exec(first);
  if (server) return { beadIds: [server[2]], summary: summaryOf(server[1], [server[2]]), actor: null };
  const dependency = /^dependency: (add|remove) (\S+) (\S+) -> (\S+)/.exec(first);
  if (dependency) {
    const ids = [dependency[3], dependency[4]];
    return { beadIds: ids, summary: `${dependency[1] === "add" ? "Linked" : "Unlinked"} ${ids[0]} and ${ids[1]}`, actor: null };
  }
  if (/^Merge /i.test(first)) return { beadIds: [], summary: "Merged changes from the team", actor: null };
  return { beadIds: [], summary: "Saved a change", actor: null };
}
function isoOf(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const text = value.trim();
  const zoned = /(?:Z|[+-]\d\d:?\d\d)$/.test(text);
  const candidate = zoned ? text : `${text.replace(" ", "T")}Z`;
  const ms = Date.parse(candidate);
  if (Number.isNaN(ms)) return null;
  return zoned ? text : new Date(ms).toISOString();
}
async function trackingOf(root, mode) {
  const remote = await chooseRemote(root, void 0, POLL_RUN);
  if (!remote) return null;
  return { remote: remote.name, branch: await activeBranch(root, mode) };
}
async function rangeOf(root, mode, tracking) {
  return (await rangeTo(root, mode, tracking, tracking.branch)).range;
}
async function rangeTo(root, mode, { remote, branch }, to) {
  const ref = `remotes/${remote}/${branch}`;
  const rows = await runSql(root, mode, `SELECT COUNT(*) AS n FROM dolt_remote_branches WHERE name = '${ref}'`, void 0);
  const tracked = Number(rows[0]?.n) > 0;
  return { range: tracked ? `${ref}..${to}` : to, tracked };
}
async function outgoingOf(root, mode) {
  const tracking = await trackingOf(root, mode);
  return tracking ? rangeTo(root, mode, tracking, tracking.branch) : null;
}
async function listOutgoing(root, mode, outgoing) {
  const limit = outgoing.tracked ? UNPUBLISHED_LIMIT : UNPUBLISHED_FALLBACK_LIMIT;
  const rows = await runSql(root, mode, `SELECT commit_hash, committer, date, message FROM dolt_log('${outgoing.range}') ORDER BY date DESC LIMIT ${limit}`, void 0);
  return rows.map((row) => {
    const message = String(row.message ?? "");
    return { commit: String(row.commit_hash ?? ""), message, at: isoOf(row.date), ...describeCommit(message) };
  });
}
async function countOutgoing(root, mode, outgoing) {
  const rows = await runSql(root, mode, `SELECT COUNT(*) AS n FROM dolt_log('${outgoing.range}')`, void 0);
  const n = Number(rows[0]?.n);
  if (!Number.isInteger(n) || n < 0) throw new BdError("parse", "the database printed a count that was not expected");
  return n;
}
async function readUnpublishedCount(root, mode) {
  const outgoing = await outgoingOf(root, mode);
  return outgoing ? countOutgoing(root, mode, outgoing) : null;
}
var HEAD_PATTERN = /^[a-z0-9]{8,64}$/;
async function readHead(root, mode) {
  const rows = await runSql(root, mode, "SELECT HASHOF('HEAD') AS head", void 0);
  const head = rows[0]?.head;
  if (typeof head !== "string" || !HEAD_PATTERN.test(head)) throw new BdError("parse", "the database printed a head commit that was not expected");
  return head;
}
var staleError = (log) => ({ kind: "error", code: "preview-stale", message: MESSAGES.stale, log: log.text() });
function hashesOf(rows) {
  return rows.map((row) => {
    const hash = String(row.commit_hash ?? "");
    if (!HEAD_PATTERN.test(hash)) throw new BdError("parse", "the database printed a commit that was not expected");
    return hash;
  });
}
async function pendingChanges(root, mode) {
  const status = await runSql(root, mode, "SELECT COUNT(*) AS n FROM dolt_status", void 0);
  return Number(status[0]?.n) !== 0;
}
async function unpreviewed(root, mode, expectedHead, before, pulled) {
  const tracking = await trackingOf(root, mode);
  if (!tracking) return "The project has no remote.";
  const { range: outgoingRange } = await rangeTo(root, mode, tracking, "HEAD");
  const { range: previewedRange } = await rangeTo(root, mode, tracking, expectedHead);
  const outgoing = hashesOf(await runSql(root, mode, `SELECT commit_hash FROM dolt_log('${outgoingRange}')`, void 0));
  const previewed = new Set(hashesOf(await runSql(root, mode, `SELECT commit_hash FROM dolt_log('${previewedRange}')`, void 0)));
  const extra = outgoing.filter((hash) => !previewed.has(hash));
  if (extra.length === 0) return null;
  if (extra.some((hash) => before.has(hash))) return "A commit not in the preview was already there.";
  const list = extra.map((hash) => `'${hash}'`).join(", ");
  const merges = new Set(hashesOf(await runSql(root, mode, `SELECT DISTINCT commit_hash FROM dolt_commit_ancestors WHERE parent_index = 1 AND commit_hash IN (${list})`, void 0)));
  const plain = extra.filter((hash) => !(merges.has(hash) && pulled.has(hash)));
  return plain.length === 0 ? null : `New commits that were not in the preview: ${plain.join(", ")}.`;
}
function localHead(root, mode) {
  return withRootQueue(root, () => readHead(root, mode));
}
function publishPreview(root, mode) {
  return withRootQueue(root, async () => {
    const head = await readHead(root, mode);
    const outgoing = await outgoingOf(root, mode);
    if (outgoing === null) return null;
    const changes = await listOutgoing(root, mode, outgoing);
    const total = await countOutgoing(root, mode, outgoing);
    const entry = rootSync(root);
    const fetched = entry.lastTeamSyncAt !== null || entry.teamSeenEmpty;
    const noTeamBranch = !outgoing.tracked;
    return {
      head,
      changes,
      total: Math.max(total, changes.length),
      ...noTeamBranch && fetched ? { teamEmpty: true } : {},
      ...noTeamBranch && !fetched ? { teamUnseen: true } : {}
    };
  });
}
function unpublishedCount(root, mode) {
  return withRootQueue(root, () => readUnpublishedCount(root, mode));
}
var NOISE_FIELDS = /* @__PURE__ */ new Set(["id", "updated_at", "content_hash", "diff_type"]);
function jsonOf(value) {
  if (value === void 0) return void 0;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}
function textOf(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function conflictOf(row) {
  const beadId = textOf(row.base_id) ?? textOf(row.our_id) ?? textOf(row.their_id);
  if (!beadId) return null;
  const fields = /* @__PURE__ */ new Set();
  for (const key of Object.keys(row)) {
    const match = /^(?:base|our|their)_(.+)$/.exec(key);
    if (match && !NOISE_FIELDS.has(match[1])) fields.add(match[1]);
  }
  const ours = {};
  const theirs = {};
  for (const field of fields) {
    const our = jsonOf(row[`our_${field}`]);
    const their = jsonOf(row[`their_${field}`]);
    if (our === their || our === void 0 && their === void 0) continue;
    ours[field] = our ?? null;
    theirs[field] = their ?? null;
  }
  const title = textOf(row.our_title) ?? textOf(row.their_title) ?? textOf(row.base_title);
  return { beadId, title, ours, theirs };
}
async function readConflictBeads(root, mode, halfMerged, remote, log) {
  try {
    let query;
    if (halfMerged) {
      query = `SELECT * FROM dolt_conflicts_issues LIMIT ${CONFLICT_LIMIT}`;
    } else {
      if (!remote) return [];
      const branch = await activeBranch(root, mode);
      query = `SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS('${branch}', 'remotes/${remote}/${branch}', 'issues') LIMIT ${CONFLICT_LIMIT}`;
    }
    const rows = await runSql(root, mode, query, void 0);
    return rows.map(conflictOf).filter((info) => info !== null);
  } catch (error) {
    const detail = error instanceof BdError && error.stderr.trim() !== "" ? ` ${tail(error.stderr.trim(), OUTPUT_MAX)}` : "";
    log.note(`Could not read which beads conflict: ${error instanceof Error ? error.message : String(error)}${detail}`);
    return [];
  }
}
var truthy = (value) => value === true || value === 1 || value === "1" || value === "true";
async function isMerging(root, mode) {
  const rows = await runSql(root, mode, "SELECT is_merging FROM dolt_merge_status", void 0);
  return rows.some((row) => truthy(row.is_merging));
}
async function mergeStatusOf(root, mode) {
  try {
    return await isMerging(root, mode) ? "merging" : "clear";
  } catch {
    return "unknown";
  }
}
async function checkHalfMerge(root, mode) {
  if (mode !== "server") return;
  const entry = rootSync(root);
  if (entry.job) return;
  try {
    await withRootQueue(root, async () => {
      if (entry.job) return;
      const merging = await isMerging(root, mode);
      const state = entry.state;
      const alreadyHalf = state.kind === "conflict" && state.halfMerged;
      if (merging) {
        entry.blocked = true;
        if (alreadyHalf) return;
        const log = new JobLog();
        const beads = await readConflictBeads(root, mode, true, null, log);
        setState(root, { kind: "conflict", mode, halfMerged: true, beads, log: log.text() });
        return;
      }
      if (!entry.blocked && !alreadyHalf) return;
      entry.blocked = false;
      setState(root, alreadyHalf ? { kind: "idle" } : state);
    });
  } catch {
  }
}
async function checkBackedOut(root, mode) {
  const entry = rootSync(root);
  const shown = entry.state;
  if (entry.job || shown.kind !== "conflict" || shown.halfMerged) return;
  try {
    await withRootQueue(root, async () => {
      if (entry.job || entry.state !== shown) return;
      const tracking = await trackingOf(root, mode);
      if (!tracking) return;
      const ref = `remotes/${tracking.remote}/${tracking.branch}`;
      const { tracked } = await rangeTo(root, mode, tracking, "HEAD");
      if (!tracked) return;
      const rows = await runSql(root, mode, `SELECT COUNT(*) AS n FROM dolt_log('HEAD..${ref}')`, void 0);
      const n = Number(rows[0]?.n);
      if (Number.isInteger(n) && n === 0 && entry.state === shown) setState(root, { kind: "idle" });
    });
  } catch {
  }
}
function plainError(message, log) {
  return { kind: "error", message, log: log.text() };
}
function messageForText(text) {
  if (AUTH.test(text)) return MESSAGES.auth;
  if (NETWORK.test(text)) return MESSAGES.network;
  return MESSAGES.generic;
}
function stateForThrown(error, log) {
  if (isNoDolt(error)) return plainError(NO_DOLT_TEXT, log);
  if (error instanceof BdError) {
    if (error.kind === "timeout") return plainError(MESSAGES.timeout, log);
    if (error.kind === "not-found") return plainError(MESSAGES.notFound, log);
    if (error.kind === "lock") return plainError(MESSAGES.busy, log);
    if (error.kind === "exit" && FORMAT_REFUSAL.test(error.stderr)) return { kind: "paused-upgrade", message: MESSAGES.upgrade, log: log.text() };
  }
  return plainError(MESSAGES.generic, log);
}
async function step(job, args) {
  try {
    const result = await runBd(job.root, args, JOB_RUN);
    job.log.command(args, result);
    return result;
  } catch (error) {
    job.log.failure(args, error);
    throw error;
  }
}
async function conflictState(job, halfMerged) {
  const beads = await readConflictBeads(job.root, job.mode, halfMerged, job.remote.name, job.log);
  return { kind: "conflict", mode: job.mode, halfMerged, beads, log: job.log.text() };
}
async function pullFailed(job, result) {
  const text = `${result.stderr}
${result.stdout}`;
  if (DIRTY_CONFIG.test(text)) return { state: plainError(MESSAGES.dirtyConfig, job.log) };
  if (EMPTY_REMOTE.test(text)) {
    rootSync(job.root).teamSeenEmpty = true;
    return { state: plainError(job.op === "pull" ? MESSAGES.emptyPull : MESSAGES.emptyPublish, job.log) };
  }
  if (FORMAT_REFUSAL.test(text)) return { state: { kind: "paused-upgrade", message: MESSAGES.upgrade, log: job.log.text() } };
  if (ABORTED.test(text)) return { state: await conflictState(job, false) };
  let status = "clear";
  if (job.mode === "server") {
    status = await mergeStatusOf(job.root, job.mode);
    if (status === "merging") return { state: await conflictState(job, true) };
  }
  if (CONFLICT_TEXT.test(text)) {
    return { state: await conflictState(job, status === "unknown") };
  }
  return { state: plainError(messageForText(text), job.log), hold: status === "unknown" };
}
async function runJob(root, mode, op, expectedHead) {
  const log = new JobLog();
  try {
    let before = /* @__PURE__ */ new Set();
    const pulled = /* @__PURE__ */ new Set();
    if (expectedHead !== void 0) {
      const head = await readHead(root, mode);
      if (head !== expectedHead) {
        log.note(`The local head is ${head}, not ${expectedHead} as previewed. Nothing was published.`);
        return { state: staleError(log) };
      }
      const tracking = await trackingOf(root, mode);
      if (tracking) before = new Set(hashesOf(await runSql(root, mode, `SELECT commit_hash FROM dolt_log('${await rangeOf(root, mode, tracking)}')`, void 0)));
    }
    const remote = await chooseRemote(root, log, LOOKUP_RUN);
    if (!remote) return { state: plainError(MESSAGES.noRemote, log) };
    const job = { root, mode, op, log, remote };
    const as = ["--actor", await panelActor(root)];
    const selector = remoteSelector(remote);
    let hold = false;
    for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt += 1) {
      const pull = await step(job, [...as, "dolt", "pull", ...selector]);
      if (pull.code !== 0) return await pullFailed(job, pull);
      if (mode === "server") {
        const status = await mergeStatusOf(root, mode);
        if (status === "merging") return { state: await conflictState(job, true) };
        if (status === "unknown") {
          log.note("Could not tell whether the database was left halfway through a merge.");
          if (op === "publish") return { state: plainError(MESSAGES.generic, log), hold: true };
          hold = true;
        }
      }
      if (expectedHead !== void 0) pulled.add(await readHead(root, mode));
      markSynced(root);
      if (op === "pull") return { state: { kind: "idle" }, hold };
      if (expectedHead !== void 0) {
        if (await pendingChanges(root, mode)) {
          log.note("There are changes not yet saved as a commit. Nothing was published.");
          return { state: plainError(MESSAGES.pending, log) };
        }
        const why = await unpreviewed(root, mode, expectedHead, before, pulled);
        if (why !== null) {
          log.note(`${why} Nothing was published.`);
          return { state: staleError(log) };
        }
      }
      const push = await step(job, [...as, "dolt", "push", ...selector]);
      if (push.code === 0) return { state: { kind: "idle" } };
      const text = `${push.stderr}
${push.stdout}`;
      if (!REJECTED.test(text)) return { state: plainError(messageForText(text), log) };
    }
    return { state: plainError(MESSAGES.churn, log) };
  } catch (error) {
    return { state: stateForThrown(error, log) };
  }
}
function settle(root, { state, hold }) {
  const entry = rootSync(root);
  if (state.kind === "conflict") entry.blocked = state.halfMerged;
  else if (state.kind === "idle") entry.blocked = false;
  if (hold) entry.blocked = true;
  setState(root, state);
}
function start(root, mode, op, expectedHead) {
  const entry = rootSync(root);
  if (entry.job) return entry.state;
  setState(root, { kind: "running", op, startedAt: (/* @__PURE__ */ new Date()).toISOString() });
  const running = entry.state;
  entry.job = withRootQueue(root, () => runJob(root, mode, op, expectedHead)).then(
    (outcome) => settle(root, outcome),
    () => settle(root, { state: { kind: "error", message: MESSAGES.generic, log: "" } })
  ).finally(() => {
    entry.job = null;
  });
  return running;
}
function startPull(root, mode) {
  return start(root, mode, "pull");
}
function startPublish(root, mode, expectedHead) {
  return start(root, mode, "publish", expectedHead);
}

// src/service/snapshot.ts
var ACTIVITY_MAX = 500;
var USED_AUDIT_IDS_MAX = 2e3;
var BACKFILL_MAX = 50;
var COMMENT_TEXT_MAX = 500;
var FIELD_TEXT_MAX = 2e3;
var FILE_VERSION = 1;
var DELETED_KEEP_MS = 30 * 24 * 60 * 60 * 1e3;
function defaultStorageDir(env = process.env) {
  const xdg = env.XDG_DATA_HOME;
  return (0, import_node_path4.join)(xdg !== void 0 && (0, import_node_path4.isAbsolute)(xdg) ? xdg : (0, import_node_path4.join)((0, import_node_os3.homedir)(), ".local", "share"), "openchamber-beads");
}
function capValue(value) {
  return typeof value === "string" ? capText(value, FIELD_TEXT_MAX) : value;
}
var FIELDS = ["title", "status", "priority", "type", "assignee", "labels", "description", "design", "acceptance", "notes", "parentId"];
var AUDIT_KEYS = {
  title: ["title"],
  status: ["status"],
  priority: ["priority"],
  type: ["issue_type", "type"],
  assignee: ["assignee"],
  labels: ["labels"],
  description: ["description"],
  design: ["design"],
  acceptance: ["acceptance_criteria", "acceptance"],
  notes: ["notes"],
  parentId: ["parent", "parent_id", "parentId"]
};
var DEFAULT_DONE = /* @__PURE__ */ new Set(["closed"]);
function isPanelActor(actor, panelActor2) {
  return actor !== null && actor === panelActor2;
}
function makeEvent(beadId, kind, observedAt, actor, rest = {}) {
  return { id: (0, import_node_crypto.randomUUID)(), beadId, kind, ...rest, actor, byPanel: false, observedAt };
}
var depKey = (d) => `${d.from}|${d.kind}|${d.to}`;
function beadVersion(b) {
  return `${b.updatedAt}|${b.comments.length}|${b.dependencies.map(depKey).sort().join(",")}`;
}
function sameField(name, a, b) {
  if (name === "labels") return [...a.labels].sort().join("\0") === [...b.labels].sort().join("\0");
  return a[name] === b[name];
}
var isCount = (key) => key.endsWith("_count");
var sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function diffBead(prev, next, observedAt, done, out) {
  let movedDone = false;
  let movedStatus = false;
  for (const name of FIELDS) {
    if (sameField(name, prev, next)) continue;
    const rest = { field: name, from: capValue(prev[name]), to: capValue(next[name]) };
    if (name === "status") {
      movedStatus = true;
      const wasDone = done.has(prev.status);
      const isDone = done.has(next.status);
      if (!wasDone && isDone) {
        movedDone = true;
        out.push(makeEvent(next.id, "closed", observedAt, null, rest));
        continue;
      }
      if (wasDone && !isDone) {
        movedDone = true;
        out.push(makeEvent(next.id, "reopened", observedAt, null, rest));
        continue;
      }
    }
    out.push(makeEvent(next.id, "field", observedAt, null, rest));
  }
  const reasonBefore = prev.closeReason ?? null;
  const reasonAfter = next.closeReason ?? null;
  if (reasonBefore !== reasonAfter && !movedDone) {
    out.push(makeEvent(next.id, "field", observedAt, null, { field: "closeReason", from: capValue(reasonBefore), to: capValue(reasonAfter) }));
  }
  const extraBefore = prev.extra ?? {};
  const extraAfter = next.extra ?? {};
  for (const key of /* @__PURE__ */ new Set([...Object.keys(extraBefore), ...Object.keys(extraAfter)])) {
    if (isCount(key) || sameJson(extraBefore[key], extraAfter[key])) continue;
    if (key === "started_at" && movedStatus && isBlank(extraBefore[key])) continue;
    out.push(makeEvent(next.id, "field", observedAt, null, { field: key, from: capValue(extraBefore[key] ?? null), to: capValue(extraAfter[key] ?? null) }));
  }
  const knownComments = new Set(prev.comments.map((c) => c.id));
  for (const c of next.comments) {
    if (!knownComments.has(c.id)) out.push(makeEvent(next.id, "comment", observedAt, c.author, { to: capText(c.text, COMMENT_TEXT_MAX) }));
  }
  const before = new Map(prev.dependencies.filter((d) => d.kind !== "parent-child").map((d) => [depKey(d), d]));
  const after = new Map(next.dependencies.filter((d) => d.kind !== "parent-child").map((d) => [depKey(d), d]));
  for (const [key, d] of after) {
    if (!before.has(key)) out.push(makeEvent(next.id, "dep_added", observedAt, d.createdBy, { field: d.kind, to: d.to }));
  }
  for (const [key, d] of before) {
    if (!after.has(key)) out.push(makeEvent(next.id, "dep_removed", observedAt, null, { field: d.kind, from: d.to }));
  }
}
function diffSnapshots(prev, next, observedAt, done = DEFAULT_DONE) {
  const out = [];
  const before = new Map(prev.map((b) => [b.id, b]));
  const present = /* @__PURE__ */ new Set();
  for (const b of next) {
    present.add(b.id);
    const old = before.get(b.id);
    if (old) diffBead(old, b, observedAt, done, out);
    else out.push(makeEvent(b.id, "created", observedAt, b.createdBy));
  }
  for (const b of prev) {
    if (!present.has(b.id)) out.push({ ...makeEvent(b.id, "deleted", observedAt, null), ...typeof b.title === "string" ? { title: capText(b.title, FIELD_TEXT_MAX) } : {} });
  }
  return out;
}
function parseFields(text) {
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
var isBlank = (v) => v === null || v === void 0 || v === "";
function sameValue(audited, to) {
  const a = typeof audited === "string" ? capText(audited, FIELD_TEXT_MAX) : audited;
  if (isBlank(a) && isBlank(to)) return true;
  if (Array.isArray(a) && Array.isArray(to)) return JSON.stringify([...a].sort()) === JSON.stringify([...to].sort());
  return JSON.stringify(a) === JSON.stringify(to);
}
function matchesField(p, field, to) {
  switch (p.event.type) {
    case "updated":
    case "status_changed":
    case "claimed": {
      if (p.fields !== null) {
        const keys = AUDIT_KEYS[field] ?? (field === "closeReason" ? ["close_reason"] : [field]);
        const key = keys.find((k) => p.fields !== null && k in p.fields);
        return key !== void 0 && sameValue(p.fields[key], to);
      }
      if (p.event.type === "status_changed") return field === "status";
      if (p.event.type === "claimed") return field === "assignee" || field === "status";
      return false;
    }
    case "renamed":
      return field === "title";
    case "label_added":
    case "label_removed":
      return field === "labels";
    default:
      return false;
  }
}
function matches(c, p) {
  switch (c.kind) {
    case "created":
      return p.event.type === "created";
    case "deleted":
      return p.event.type === "deleted";
    case "closed":
    case "reopened":
      if (p.event.type === c.kind) return true;
      return p.event.type !== "claimed" && matchesField(p, "status", c.to);
    case "field":
      return c.field !== void 0 && matchesField(p, c.field, c.to);
    default:
      return false;
  }
}
function slotOf(c) {
  if (c.kind === "closed" || c.kind === "reopened") return "status";
  return c.kind === "field" ? c.field ?? "" : c.kind;
}
function eventIso(e) {
  const ms = eventTimeMs(e);
  return ms !== null ? new Date(ms).toISOString() : null;
}
function attributeChanges(changes, audit, panelActor2, usedAuditIds = /* @__PURE__ */ new Set()) {
  const byBead = /* @__PURE__ */ new Map();
  for (const event of audit ?? []) {
    if (usedAuditIds.has(event.id)) continue;
    const list = byBead.get(event.beadId) ?? [];
    list.push({ event, fields: parseFields(event.newValue) });
    byBead.set(event.beadId, list);
  }
  const filled = /* @__PURE__ */ new Map();
  const out = changes.map((c) => {
    let { actor, changedAt } = c;
    let reason;
    const slot = slotOf(c);
    const hit = (byBead.get(c.beadId) ?? []).find((p) => !filled.get(p.event.id)?.has(slot) && matches(c, p));
    if (hit) {
      filled.set(hit.event.id, (filled.get(hit.event.id) ?? /* @__PURE__ */ new Set()).add(slot));
      if (!(c.kind === "created" && actor !== null)) actor = hit.event.actor ?? actor;
      changedAt = eventIso(hit.event) ?? changedAt;
      if (hit.event.type === "closed" && hit.event.newValue !== null) reason = capText(hit.event.newValue, FIELD_TEXT_MAX);
    }
    return { ...c, actor, ...changedAt !== void 0 ? { changedAt } : {}, ...reason !== void 0 ? { reason } : {}, byPanel: isPanelActor(actor, panelActor2) };
  });
  for (const id of filled.keys()) usedAuditIds.add(id);
  return out;
}
function panelWrote(wrote, e) {
  const linked = (other) => typeof other === "string" && (wrote.deps ?? []).some(([from, to]) => from === e.beadId && to === other);
  switch (e.kind) {
    case "field":
    case "closed":
    case "reopened":
      if (e.field === "parentId" && (linked(e.from) || linked(e.to))) return true;
      return (wrote.fields ?? []).includes(e.kind === "field" ? e.field ?? "" : "status");
    case "dep_added":
      return linked(e.to);
    case "dep_removed":
      return linked(e.from);
    case "comment":
      return wrote.comment === true;
    case "created":
      return wrote.created === true;
    default:
      return false;
  }
}
function historicalTime(e) {
  return eventIso(e) ?? e.rawCreatedAt.slice(0, 10);
}
function historicalEvents(e, panelActor2) {
  const base = (kind, suffix, rest = {}) => ({
    id: `audit:${e.id}${suffix}`,
    beadId: e.beadId,
    kind,
    ...rest,
    actor: e.actor,
    byPanel: isPanelActor(e.actor, panelActor2),
    observedAt: historicalTime(e),
    historical: true
  });
  const fields = parseFields(e.newValue);
  const before = parseFields(e.oldValue);
  switch (e.type) {
    case "created":
      return [base("created", "")];
    case "closed":
      return [{ ...base("closed", "", { field: "status" }), ...e.newValue !== null ? { reason: capText(e.newValue, FIELD_TEXT_MAX) } : {} }];
    case "reopened":
      return [base("reopened", "", { field: "status" })];
    case "deleted":
      return [base("deleted", "")];
    case "commented":
      return [base("comment", "")];
    case "renamed":
      return [base("field", "", { field: "title" })];
    case "label_added":
    case "label_removed":
      return [base("field", "", { field: "labels" })];
    case "claimed":
    case "updated":
    case "status_changed": {
      if (fields === null) return e.type === "claimed" ? [base("field", "", { field: "assignee" })] : [];
      return Object.keys(fields).map((key) => {
        const name = FIELDS.find((f) => AUDIT_KEYS[f].includes(key)) ?? key;
        const rest = { field: name, to: capValue(fields[key]) };
        if (before !== null && key in before) rest.from = capValue(before[key]);
        return base("field", `#${key}`, rest);
      });
    }
    default:
      return [];
  }
}
var NOT_DONE_STATUSES = /* @__PURE__ */ new Set(["open", "in_progress", "blocked", "deferred"]);
function reopenedAfterClose(audit, statuses) {
  const done = (status) => statuses ? statuses.some((s) => s.name === status && s.category === "done") : !NOT_DONE_STATUSES.has(status);
  const out = /* @__PURE__ */ new Set();
  const before = /* @__PURE__ */ new Map();
  for (const e of [...audit].reverse()) {
    if (e.type === "reopened" && before.get(e.beadId)?.type === "closed") {
      const target = parseFields(e.newValue)?.status;
      if (typeof target === "string" && done(target)) out.add(e.id);
    }
    before.set(e.beadId, e);
  }
  return out;
}
var CHANGE_KINDS = /* @__PURE__ */ new Set(["created", "field", "closed", "reopened", "deleted", "dep_added", "dep_removed", "comment"]);
function isChangeEvent(v) {
  if (typeof v !== "object" || v === null) return false;
  const e = v;
  return typeof e.id === "string" && typeof e.beadId === "string" && typeof e.kind === "string" && CHANGE_KINDS.has(e.kind) && (e.actor === null || typeof e.actor === "string") && typeof e.byPanel === "boolean" && typeof e.observedAt === "string" && (e.title === void 0 || typeof e.title === "string");
}
var isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function isSnapshotBead(v) {
  if (!isRecord(v)) return false;
  return typeof v.id === "string" && typeof v.updatedAt === "string" && Array.isArray(v.labels) && v.labels.every((l) => typeof l === "string") && Array.isArray(v.comments) && v.comments.every((c) => isRecord(c) && typeof c.id === "string" && typeof c.text === "string") && Array.isArray(v.dependencies) && v.dependencies.every((d) => isRecord(d) && typeof d.from === "string" && typeof d.to === "string" && typeof d.kind === "string");
}
function stringMap(v) {
  return isRecord(v) ? Object.fromEntries(Object.entries(v).filter((entry) => typeof entry[1] === "string")) : {};
}
function parsePersisted(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== FILE_VERSION) return null;
  if (!isRecord(raw.seen) || !Array.isArray(raw.activity) || !Array.isArray(raw.usedAuditIds)) return null;
  return {
    v: FILE_VERSION,
    snapshot: Array.isArray(raw.snapshot) && raw.snapshot.every(isSnapshotBead) ? raw.snapshot : null,
    seen: stringMap(raw.seen),
    seenAt: stringMap(raw.seenAt),
    activity: raw.activity.filter(isChangeEvent).slice(-ACTIVITY_MAX),
    usedAuditIds: raw.usedAuditIds.filter((id) => typeof id === "string").slice(-USED_AUDIT_IDS_MAX),
    firstContactConfirmedFor: typeof raw.firstContactConfirmedFor === "string" ? raw.firstContactConfirmedFor : null,
    lastTeamSyncAt: typeof raw.lastTeamSyncAt === "string" && !Number.isNaN(Date.parse(raw.lastTeamSyncAt)) ? raw.lastTeamSyncAt : null
  };
}
var ProjectStore = class {
  constructor(root, storageDir) {
    this.root = root;
    this.storageDir = storageDir;
    this.path = (0, import_node_path4.join)(storageDir, `${(0, import_node_crypto.createHash)("sha1").update(root).digest("hex")}.json`);
  }
  root;
  storageDir;
  path;
  snapshot = null;
  index = /* @__PURE__ */ new Map();
  seen = /* @__PURE__ */ new Map();
  seenAt = /* @__PURE__ */ new Map();
  /** Oldest first. */
  ring = [];
  usedAuditIds = /* @__PURE__ */ new Set();
  confirmedFor = null;
  teamSyncedAt = null;
  saving = Promise.resolve();
  rev = 0;
  /** What the panel wrote to each bead since the last apply. In memory only. */
  panelWrites = /* @__PURE__ */ new Map();
  /**
   * Reads the persisted state. No file, bad JSON, another version, or the wrong shape is the same as
   * none. Any other read error (permissions, too many open files) is thrown: the caller must not
   * go on and overwrite a file that may be fine.
   */
  async load() {
    let text;
    try {
      text = await (0, import_promises3.readFile)(this.path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const persisted = parsePersisted(text);
    if (!persisted) return;
    this.setSnapshot(persisted.snapshot);
    this.seen = new Map(Object.entries(persisted.seen));
    this.seenAt = new Map(Object.entries(persisted.seenAt));
    this.ring = persisted.activity;
    this.usedAuditIds = new Set(persisted.usedAuditIds);
    this.confirmedFor = persisted.firstContactConfirmedFor;
    this.teamSyncedAt = persisted.lastTeamSyncAt;
    seedLastTeamSync(this.root, persisted.lastTeamSyncAt);
  }
  /** When the last pull from the team remote finished (ISO), or null. */
  lastTeamSyncAt() {
    return this.teamSyncedAt;
  }
  /** Remembers a finished pull. Not part of `revision()`: the panel gets it through the freshness block. Call `save()` to keep it. */
  recordTeamSync(iso) {
    this.teamSyncedAt = iso;
  }
  setSnapshot(snapshot) {
    this.snapshot = snapshot;
    this.index = new Map((snapshot ?? []).map((b) => [b.id, b]));
  }
  /**
   * The panel has written (or may have written) `wrote` on this bead. The next apply credits the changes that match it
   * and that nothing else names to the panel, so the user's own edit does not show up as unseen news; any other change
   * to the bead keeps no name. The mark lasts for one apply.
   */
  recordPanelWrite(beadId, wrote) {
    this.panelWrites.set(beadId, [...this.panelWrites.get(beadId) ?? [], wrote]);
  }
  /** Moves whenever something a snapshot shows changes: new events, new history rows, or seen state. */
  revision() {
    return this.rev;
  }
  /** True once a snapshot exists, taken in this run or restored from a saved one. */
  hasBaseline() {
    return this.snapshot !== null;
  }
  /** How many beads the current snapshot holds; 0 before the first one. */
  beadCount() {
    return this.snapshot?.length ?? 0;
  }
  /** Ids of beads that differ from the current snapshot (new, changed, or gone), without changing anything. Empty before the first snapshot. */
  changedBeadIds(next) {
    if (!this.snapshot) return [];
    return [...new Set(diffSnapshots(this.snapshot, next, "").map((c) => c.beadId))];
  }
  /**
   * Takes a fresh read of all beads. With no snapshot yet it only sets the baseline: every bead is
   * seen and there are no change events. Otherwise it diffs against the previous read, attributes
   * the changes, and adds them to the activity ring. Returns the new change events.
   */
  apply(next, audit, panelActor2, now, statuses) {
    const prev = this.snapshot;
    const panelWrites = this.panelWrites;
    this.panelWrites = /* @__PURE__ */ new Map();
    this.setSnapshot(next);
    for (const id of [...this.seen.keys()]) if (!this.index.has(id)) this.seen.delete(id);
    if (prev === null) {
      for (const b of next) {
        if (this.seen.has(b.id)) continue;
        this.seen.set(b.id, beadVersion(b));
        this.seenAt.set(b.id, now);
      }
      this.pruneSeenAt(now);
      this.rev += 1;
      return [];
    }
    const done = new Set(statuses.filter((s) => s.category === "done").map((s) => s.name));
    const events = attributeChanges(diffSnapshots(prev, next, now, done.size > 0 ? done : DEFAULT_DONE), audit, panelActor2, this.usedAuditIds);
    for (const e of events) {
      if (e.actor === null && (panelWrites.get(e.beadId) ?? []).some((wrote) => panelWrote(wrote, e))) {
        e.actor = panelActor2;
        e.byPanel = true;
      }
    }
    this.autoSeePanelChanges(prev, next, events, now);
    for (const b of prev) if (!this.index.has(b.id) && !this.seenAt.has(b.id)) this.seenAt.set(b.id, "");
    if (events.length > 0) this.rev += 1;
    this.ring.push(...events);
    if (this.ring.length > ACTIVITY_MAX) this.ring = this.ring.slice(-ACTIVITY_MAX);
    this.trimUsedAuditIds();
    this.pruneSeenAt(now);
    return events;
  }
  /** A gone bead keeps its `seenAt` while its deletion is in the feed and under 30 days old, so the deletion can still show as unseen; anything else for a gone bead goes. */
  pruneSeenAt(now) {
    const cutoff = Date.parse(now) - DELETED_KEEP_MS;
    const recentlyDeleted = new Set(this.ring.filter((e) => e.kind === "deleted" && !(Date.parse(e.observedAt) < cutoff)).map((e) => e.beadId));
    for (const id of [...this.seenAt.keys()]) if (!this.index.has(id) && !recentlyDeleted.has(id)) this.seenAt.delete(id);
  }
  /** A bead whose every change this refresh came from the panel stays seen, unless an earlier change by someone else was still unseen. */
  autoSeePanelChanges(prev, next, events, now) {
    const before = new Map(prev.map((b) => [b.id, b]));
    const byBead = /* @__PURE__ */ new Map();
    for (const e of events) byBead.set(e.beadId, [...byBead.get(e.beadId) ?? [], e]);
    for (const b of next) {
      const list = byBead.get(b.id);
      if (!list || !list.every((e) => e.byPanel)) continue;
      const old = before.get(b.id);
      const wasSeen = old === void 0 || this.seen.get(b.id) === beadVersion(old);
      if (!wasSeen) continue;
      this.seen.set(b.id, beadVersion(b));
      this.seenAt.set(b.id, now);
    }
  }
  trimUsedAuditIds() {
    const excess = this.usedAuditIds.size - USED_AUDIT_IDS_MAX;
    if (excess <= 0) return;
    for (const id of [...this.usedAuditIds].slice(0, excess)) this.usedAuditIds.delete(id);
  }
  /**
   * First load only: seeds the activity feed from the newest audit events (newest first), marked
   * historical and dated coarsely. Does nothing once a snapshot exists. Returns the rows added. A move into a custom done status that
   * bd recorded as `closed` then `reopened` shows as the close alone (see `reopenedAfterClose`).
   */
  backfill(audit, panelActor2, statuses) {
    if (this.snapshot !== null) return [];
    const collapsed = reopenedAfterClose(audit, statuses);
    const fresh = audit.slice(0, BACKFILL_MAX).filter((e) => !this.usedAuditIds.has(e.id));
    const rows = [];
    for (const e of fresh) {
      this.usedAuditIds.add(e.id);
      if (!collapsed.has(e.id)) rows.push(...historicalEvents(e, panelActor2));
    }
    this.ring.push(...rows.reverse());
    if (this.ring.length > ACTIVITY_MAX) this.ring = this.ring.slice(-ACTIVITY_MAX);
    this.trimUsedAuditIds();
    if (rows.length > 0) this.rev += 1;
    return rows;
  }
  isUnseen(b) {
    return this.seen.get(b.id) !== beadVersion(b);
  }
  /** Beads that are new or changed since they were last marked seen. */
  unseenIds() {
    return (this.snapshot ?? []).filter((b) => this.isUnseen(b)).map((b) => b.id);
  }
  /** Ids of gone beads whose deletion has not been marked seen. */
  unseenDeletionIds() {
    const ids = /* @__PURE__ */ new Set();
    for (const e of this.ring) if (e.kind === "deleted" && !this.index.has(e.beadId) && this.isEventUnseen(e)) ids.add(e.beadId);
    return [...ids];
  }
  /** Marks beads seen as of `now` (ISO). Beads that are gone but have a deletion in the feed are marked too, which dismisses the deletion. */
  markSeen(ids, now = (/* @__PURE__ */ new Date()).toISOString()) {
    if (!this.snapshot) return;
    this.rev += 1;
    const wanted = ids === "all" ? null : new Set(ids);
    for (const b of this.snapshot) {
      if (wanted !== null && !wanted.has(b.id)) continue;
      this.seen.set(b.id, beadVersion(b));
      this.seenAt.set(b.id, now);
    }
    for (const e of this.ring) {
      if (e.kind !== "deleted" || this.index.has(e.beadId)) continue;
      if (wanted === null || wanted.has(e.beadId)) this.seenAt.set(e.beadId, now);
    }
  }
  /**
   * For the activity feed: the event is newer (service clock) than when its bead was last marked
   * seen, and the bead is unseen now. A deleted bead has no seen state; its deletion is unseen
   * until the bead's mark is newer, and never once that mark is forgotten. Backfilled history is never unseen.
   */
  isEventUnseen(e) {
    if (e.historical) return false;
    const at = this.seenAt.get(e.beadId);
    const b = this.index.get(e.beadId);
    if (!b) return e.kind === "deleted" && at !== void 0 && e.observedAt > at;
    if (!this.isUnseen(b)) return false;
    return at === void 0 || e.observedAt > at;
  }
  /** Newest first. */
  activity(limit) {
    if (!Number.isFinite(limit) || limit < 1) return [];
    return this.ring.slice(-Math.floor(limit)).reverse();
  }
  /** The bd version the user confirmed first contact for, if any. */
  firstContactConfirmedFor() {
    return this.confirmedFor;
  }
  confirmFirstContact(bdVersion) {
    this.confirmedFor = bdVersion;
    this.rev += 1;
  }
  /** Puts the consent back as it was (`previous` is what `firstContactConfirmedFor()` returned before), when saving a new one failed. */
  restoreFirstContact(previous) {
    this.confirmedFor = previous;
    this.rev += 1;
  }
  /** Writes the state. Saves run one at a time; each is a temp file renamed into place. */
  save() {
    const run = this.saving.then(() => this.write());
    this.saving = run.catch(() => void 0);
    return run;
  }
  async write() {
    const body = {
      v: FILE_VERSION,
      snapshot: this.snapshot,
      seen: Object.fromEntries(this.seen),
      seenAt: Object.fromEntries(this.seenAt),
      activity: this.ring,
      usedAuditIds: [...this.usedAuditIds],
      firstContactConfirmedFor: this.confirmedFor,
      lastTeamSyncAt: this.teamSyncedAt
    };
    await (0, import_promises3.mkdir)(this.storageDir, { recursive: true });
    const tmp = `${this.path}.${(0, import_node_crypto.randomUUID)()}.tmp`;
    try {
      await (0, import_promises3.writeFile)(tmp, JSON.stringify(body), "utf8");
      await (0, import_promises3.rename)(tmp, this.path);
    } catch (error) {
      await (0, import_promises3.rm)(tmp, { force: true });
      throw error;
    }
  }
};
var SIGNAL_THROTTLE_MS = 4e3;
var FORCE_EXPORT_MS = 6e4;
var PROCESS_ID = (0, import_node_crypto.randomUUID)().slice(0, 8);
var ACTIVITY_LIMIT = 200;
var clock = Date.now;
var storageDirOverride = null;
var isoOf2 = (ms) => new Date(ms).toISOString();
var roots2 = /* @__PURE__ */ new Map();
var stores = /* @__PURE__ */ new Map();
var workspaces = /* @__PURE__ */ new Map();
var detections = /* @__PURE__ */ new Map();
async function bdIdentity() {
  try {
    const exe = await resolveExecutable("bd");
    if (!exe) return null;
    const real = await (0, import_promises3.realpath)(exe);
    return `${real}:${(await (0, import_promises3.stat)(real)).mtimeMs}`;
  } catch {
    return null;
  }
}
function projectStore(root) {
  const known = stores.get(root);
  if (known) return known;
  const store = new ProjectStore(root, storageDirOverride ?? defaultStorageDir());
  const loading = store.load().then(() => store);
  stores.set(root, loading);
  loading.catch(() => {
    if (stores.get(root) === loading) stores.delete(root);
  });
  return loading;
}
onPanelWrite(async (root, beadId, wrote) => {
  const held = roots2.get(root);
  if (held) held.writeGen += 1;
  try {
    (await projectStore(root)).recordPanelWrite(beadId, wrote);
    const known = roots2.get(root);
    if (known) {
      known.writeNoteError = null;
      known.unpublishedGen += 1;
    }
  } catch (error) {
    const known = roots2.get(root);
    if (known) known.writeNoteError = capText(`Could not note the panel's change to ${beadId}: ${error instanceof Error ? error.message : String(error)}`, DETAIL_MAX);
    throw error;
  }
});
onTeamSynced((root, at) => {
  void projectStore(root).then((store) => {
    store.recordTeamSync(at);
    return store.save();
  }).then(() => {
    const known = roots2.get(root);
    if (known?.saveError?.startsWith("Could not save panel state")) known.saveError = null;
  }).catch((error) => {
    const known = roots2.get(root);
    if (known) known.saveError = capText(`Could not save panel state: ${error instanceof Error ? error.message : String(error)}`, DETAIL_MAX);
  });
});
onSyncChange((root) => {
  const known = roots2.get(root);
  if (!known) return;
  known.attemptAt = null;
  known.unpublishedGen += 1;
});
function cacheFor(root, mode) {
  const known = roots2.get(root);
  if (known) return known;
  const created = {
    root,
    panelActor: "",
    provider: new BdProvider(root, mode),
    store: null,
    beads: [],
    statuses: null,
    types: null,
    readyIds: [],
    dataKey: "",
    loaded: false,
    localRefreshedAt: null,
    localError: null,
    localErrorDetail: null,
    saveError: null,
    writeNoteError: null,
    noSignal: false,
    attemptAt: null,
    halfMergeAt: null,
    conflictCheckAt: null,
    exportedSignal: null,
    exportedAt: null,
    inflight: null,
    unpublishedCount: null,
    unpublishedError: null,
    unpublishedAt: null,
    unpublishedGen: 1,
    unpublishedCountedGen: 0,
    unpublishedInflight: null,
    emptyExportPending: false,
    writeGen: 0,
    exportedGen: 0,
    attemptedGen: 0
  };
  roots2.set(root, created);
  return created;
}
async function detectWithConsent(directory) {
  const first = await detectWorkspace(directory, {});
  if (first.kind !== "needs-first-contact") return first;
  let confirmed = false;
  try {
    confirmed = (await projectStore(first.root)).firstContactConfirmedFor() === first.bdVersion;
  } catch {
  }
  return confirmed ? detectWorkspace(directory, { confirmedFirstContact: true }) : first;
}
async function lookupWorkspace(directory, refresh2) {
  const bdKey = await bdIdentity();
  const known = workspaces.get(directory);
  const stale = known !== void 0 && known.bdKey !== bdKey;
  if (known && !refresh2 && !stale) return { workspace: known.workspace };
  let detecting = detections.get(directory);
  if (!detecting) {
    detecting = detectWithConsent(directory).then((workspace) => {
      const detected = { workspace, bdKey };
      workspaces.set(directory, detected);
      if (workspace.kind === "ok") {
        const cache = roots2.get(workspace.root);
        if (cache && cache.provider.mode !== workspace.mode) cache.provider = new BdProvider(workspace.root, workspace.mode);
      }
      return detected;
    }).finally(() => detections.delete(directory));
    detections.set(directory, detecting);
  }
  try {
    return { workspace: (await detecting).workspace };
  } catch (error) {
    if (known && !stale) return { workspace: known.workspace, error };
    throw error;
  }
}
async function resolveWorkspace(directory, opts = {}) {
  const { workspace, error } = await lookupWorkspace(directory, opts.refreshWorkspace ?? false);
  if (error !== void 0) throw error;
  return { workspace, root: workspace.kind === "ok" ? workspace.root : null };
}
function providerFor(root, mode) {
  return cacheFor(root, mode).provider;
}
function cachedBeads(root) {
  const known = roots2.get(root);
  return known?.loaded ? known.beads : null;
}
function recordError(c, error) {
  c.localError = readErrorText(error, true);
  c.localErrorDetail = errorDetail(error);
}
function clearError(c) {
  c.localError = null;
  c.localErrorDetail = null;
}
var EMPTY_EXPORT_NOTE = "Beads returned no issues. Checking again.";
var NO_SIGNAL_NOTE = "Change detection unavailable; checking every minute.";
function detailOf(c) {
  const lines = [c.localErrorDetail, c.saveError, c.writeNoteError, c.unpublishedError, c.noSignal ? NO_SIGNAL_NOTE : null].filter((line) => line !== null);
  return lines.length > 0 ? lines.join("\n") : null;
}
async function readAuditFor(c, ids) {
  if (ids.length === 0) return null;
  const events = [];
  let anyRead = false;
  for (let i = 0; i < ids.length; i += AUDIT_BEAD_IDS_MAX) {
    const batch = await withRootQueue(c.root, () => readAuditEvents(c.root, c.provider.mode, { beadIds: ids.slice(i, i + AUDIT_BEAD_IDS_MAX), limit: AUDIT_LIMIT_MAX }));
    if (batch === null) continue;
    anyRead = true;
    events.push(...batch);
  }
  return anyRead ? events : null;
}
async function exportAndApply(c, signal, startedAt, forced, gen) {
  const next = await c.provider.export();
  const store = c.store;
  if (next.length === 0 && store.beadCount() > 0 && !c.emptyExportPending) {
    c.emptyExportPending = true;
    c.localError = EMPTY_EXPORT_NOTE;
    c.localErrorDetail = null;
    return;
  }
  const refetchVocabulary = c.statuses === null || c.types === null || forced;
  const statuses = refetchVocabulary ? await c.provider.statuses() : c.statuses;
  const types = refetchVocabulary ? await c.provider.types() : c.types;
  const readyIds = await c.provider.ready();
  const actor = await panelActor(c.root);
  c.panelActor = actor;
  if (!store.hasBaseline()) store.backfill(await withRootQueue(c.root, () => readAuditEvents(c.root, c.provider.mode, { limit: BACKFILL_MAX })) ?? [], actor, statuses);
  const audit = await readAuditFor(c, store.changedBeadIds(next));
  store.apply(next, audit, actor, isoOf2(clock()), statuses);
  c.beads = next;
  c.statuses = statuses;
  c.types = types;
  c.readyIds = readyIds;
  c.dataKey = (0, import_node_crypto.createHash)("sha1").update(JSON.stringify([next, readyIds, statuses, types])).digest("hex").slice(0, 12);
  c.exportedSignal = signal;
  c.exportedAt = startedAt;
  c.exportedGen = gen;
  c.loaded = true;
  c.emptyExportPending = false;
  c.localRefreshedAt = isoOf2(startedAt);
  clearError(c);
  try {
    await store.save();
    c.saveError = null;
  } catch (error) {
    c.saveError = capText(`Could not save panel state: ${error instanceof Error ? error.message : String(error)}`, DETAIL_MAX);
  }
}
async function refresh(c) {
  const startedAt = clock();
  const gen = c.writeGen;
  const written = gen !== c.exportedGen;
  const catchUp = written && gen !== c.attemptedGen;
  if (!catchUp && c.attemptAt !== null && startedAt >= c.attemptAt && startedAt - c.attemptAt < SIGNAL_THROTTLE_MS) return;
  c.attemptAt = startedAt;
  c.attemptedGen = gen;
  const forced = c.emptyExportPending || c.exportedAt === null || startedAt < c.exportedAt || startedAt - c.exportedAt >= FORCE_EXPORT_MS;
  try {
    c.store ??= await projectStore(c.root);
    let signal = null;
    let noSignalAtAll = false;
    try {
      signal = await c.provider.changeSignal();
      c.noSignal = false;
    } catch (error) {
      noSignalAtAll = error instanceof BdError && error.kind === "not-found";
      c.noSignal = noSignalAtAll;
    }
    if (noSignalAtAll && !forced && !written) return;
    if (signal !== null && signal === c.exportedSignal && !forced && !written) {
      c.localRefreshedAt = isoOf2(startedAt);
      clearError(c);
      return;
    }
    await exportAndApply(c, signal, startedAt, forced, gen);
  } catch (error) {
    c.emptyExportPending = false;
    recordError(c, error);
  }
}
var UNPUBLISHED_TTL_MS = 3e4;
function checkDue(c, key, intervalMs) {
  const now = clock();
  const last = c[key];
  if (last !== null && now >= last && now - last < intervalMs) return false;
  c[key] = now;
  return true;
}
async function refreshUnpublished(c, workspace) {
  if (!workspace.hasRemote) {
    c.unpublishedCount = null;
    c.unpublishedError = null;
    return;
  }
  const now = clock();
  const fresh = c.unpublishedAt !== null && now >= c.unpublishedAt && now - c.unpublishedAt < UNPUBLISHED_TTL_MS;
  if (fresh && c.unpublishedCountedGen === c.unpublishedGen) return;
  if (!c.unpublishedInflight) {
    const generation = c.unpublishedGen;
    c.unpublishedInflight = (async () => {
      try {
        c.unpublishedCount = await unpublishedCount(c.root, workspace.mode);
        c.unpublishedError = null;
      } catch (error) {
        c.unpublishedError = capText(`Could not count unpublished changes: ${errorDetail(error)}`, DETAIL_MAX);
      } finally {
        c.unpublishedCountedGen = generation;
        c.unpublishedAt = clock();
        c.unpublishedInflight = null;
      }
    })();
  }
  await c.unpublishedInflight;
}
function emptyFreshness() {
  return { localRefreshedAt: null, localError: null, localErrorDetail: null, teamSyncedAt: null, unpublished: null };
}
var IDLE = { kind: "idle" };
function workspaceDigest(workspace) {
  return (0, import_node_crypto.createHash)("sha1").update(JSON.stringify(workspace)).digest("hex").slice(0, 8);
}
function respond(c, workspace, cursor) {
  const store = c.store;
  const freshness = {
    localRefreshedAt: c.localRefreshedAt,
    localError: c.localError,
    localErrorDetail: detailOf(c),
    teamSyncedAt: lastTeamSync(c.root),
    unpublished: workspace.kind === "ok" && workspace.hasRemote ? c.unpublishedCount : null
  };
  const sync = syncState(c.root);
  const actor = (0, import_node_crypto.createHash)("sha1").update(c.panelActor).digest("hex").slice(0, 8);
  const current = `${PROCESS_ID}:${workspaceDigest(workspace)}:${store?.revision() ?? 0}:${c.dataKey}:${syncSignature(c.root)}:${actor}`;
  if (c.loaded && cursor === current) return { unchanged: true, cursor: current, freshness, sync };
  return {
    unchanged: false,
    cursor: current,
    workspace,
    beads: c.beads,
    statuses: c.statuses ?? [],
    types: c.types ?? [],
    readyIds: c.readyIds,
    unseenIds: store ? [...store.unseenIds(), ...store.unseenDeletionIds()] : [],
    activity: store ? store.activity(ACTIVITY_LIMIT).map((e) => ({ ...e, unseen: store.isEventUnseen(e) })) : [],
    freshness,
    sync,
    writesBlocked: writesBlocked(c.root),
    panelActor: c.panelActor
  };
}
async function getSnapshot(directory, cursor, refreshWorkspace = false) {
  const { workspace, error } = await lookupWorkspace(directory, refreshWorkspace);
  if (workspace.kind !== "ok") {
    return {
      unchanged: false,
      cursor: `${PROCESS_ID}:workspace:${workspaceDigest(workspace)}`,
      workspace,
      beads: [],
      statuses: [],
      types: [],
      readyIds: [],
      unseenIds: [],
      activity: [],
      freshness: emptyFreshness(),
      sync: IDLE,
      writesBlocked: false,
      panelActor: ""
    };
  }
  const c = cacheFor(workspace.root, workspace.mode);
  if (error !== void 0) recordError(c, error);
  if (syncState(c.root).kind === "running" && c.loaded) return respond(c, workspace, cursor);
  const refreshOnce = async () => {
    c.inflight ??= refresh(c).finally(() => {
      c.inflight = null;
    });
    await c.inflight;
  };
  await refreshOnce();
  if (c.writeGen !== c.exportedGen && c.writeGen !== c.attemptedGen) await refreshOnce();
  const syncing = () => syncState(c.root).kind === "running";
  if (syncing()) return respond(c, workspace, cursor);
  if (writesBlocked(c.root) && checkDue(c, "halfMergeAt", SIGNAL_THROTTLE_MS)) await checkHalfMerge(c.root, workspace.mode);
  const shown = syncState(c.root);
  if (shown.kind === "conflict" && !shown.halfMerged && checkDue(c, "conflictCheckAt", UNPUBLISHED_TTL_MS)) await checkBackedOut(c.root, workspace.mode);
  if (syncing()) return respond(c, workspace, cursor);
  await refreshUnpublished(c, workspace);
  return respond(c, workspace, cursor);
}

// src/service/routes.ts
var defaultDeps = {
  resolveWorkspace,
  getSnapshot,
  projectStore,
  providerFor,
  cachedBeads,
  panelActor,
  preview: publishPreview,
  localHead,
  startPull,
  startPublish,
  syncState,
  writesBlocked,
  checkHalfMerge,
  beadUrl
};
var ID_PATTERN2 = /^[A-Za-z0-9._-]{1,128}$/;
var HEAD_PATTERN2 = /^[a-z0-9]{8,64}$/;
var SYNC_RUNNING_TEXT = "Sync in progress. Try again when it finishes.";
var UNEXPECTED_TEXT = "Something went wrong.";
var HEADING_RANKS = [[/\bsync\b/i, 0], [/\bdolt\b/i, 1], [/\bbeads?\b/i, 2]];
var ok = (_route, json) => ({ status: 200, json });
function fail(status, code, message, extra = {}) {
  const error = { code, message };
  if (extra.detail !== void 0) error.detail = capText(extra.detail, DETAIL_MAX);
  if (extra.workspace !== void 0) error.workspace = extra.workspace;
  if (extra.saved) error.saved = true;
  return { status, json: { error } };
}
var Reject = class extends Error {
  constructor(result) {
    super("rejected");
    this.result = result;
  }
  result;
};
var reject = (status, code, message, extra) => new Reject(fail(status, code, message, extra));
var badRequest = (message) => reject(400, "BAD_REQUEST", message);
function readFailure2(error, retrying) {
  const busy = isBusyError(error);
  return reject(busy ? 503 : 500, busy ? "busy" : "beads-error", readErrorText(error, retrying), { detail: errorDetail(error) });
}
async function reading(run, retrying = false) {
  try {
    return await run();
  } catch (error) {
    throw readFailure2(error, retrying);
  }
}
async function syncReading(run) {
  try {
    return await run();
  } catch (error) {
    if (isNoDolt(error)) throw reject(500, "beads-error", NO_DOLT_TEXT, { detail: errorDetail(error) });
    throw readFailure2(error, false);
  }
}
var WORKSPACE_TEXT = {
  ok: "This project is ready.",
  "no-bd": "Beads isn't installed on this computer.",
  "bd-too-old": "This panel can't use the installed Beads version with this project.",
  "no-workspace": "This folder doesn't use Beads.",
  "pre-dolt": "This project uses an older Beads format that this panel can't read.",
  "needs-first-contact": "Confirm that Beads may open this project first.",
  "server-down": "This project's Beads server isn't running."
};
var workspaceReject = (workspace, message = WORKSPACE_TEXT[workspace.kind]) => reject(409, "workspace", message, { workspace });
var WRITE_STATUS = {
  invalid: 400,
  "not-found": 404,
  blocked: 409,
  "dep-exists": 409,
  "merge-conflict": 409,
  busy: 503,
  uncertain: 504,
  "no-bd": 500,
  failed: 500
};
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
async function validDirectory(body) {
  const { directory } = body;
  const bad = badRequest("directory must be the absolute path of an existing folder.");
  if (typeof directory !== "string" || !(0, import_node_path5.isAbsolute)(directory)) throw bad;
  try {
    if (!(await (0, import_promises4.stat)(directory)).isDirectory()) throw bad;
  } catch {
    throw bad;
  }
  return directory;
}
function idOf(value, field) {
  if (typeof value !== "string" || !ID_PATTERN2.test(value)) throw badRequest(`${field} is not a valid bead id.`);
  return value;
}
function stringOf(value, field) {
  if (typeof value !== "string") throw badRequest(`${field} must be text.`);
  return value;
}
function optionalBoolean(body, field) {
  const value = body[field];
  if (value === void 0) return false;
  if (typeof value !== "boolean") throw badRequest(`${field} must be true or false.`);
  return value;
}
var PATCH_STRINGS = ["title", "status", "description", "design", "acceptance", "notes", "closeReason"];
function patchOf(value) {
  if (!isObject(value)) throw badRequest("patch must be an object.");
  const patch = {};
  for (const key of PATCH_STRINGS) {
    if (value[key] === void 0) continue;
    patch[key] = stringOf(value[key], `patch.${key}`);
  }
  if (value.priority !== void 0) {
    if (typeof value.priority !== "number" || !Number.isFinite(value.priority)) throw badRequest("patch.priority must be a number.");
    patch.priority = value.priority;
  }
  if (value.assignee !== void 0) {
    if (value.assignee !== null && typeof value.assignee !== "string") throw badRequest("patch.assignee must be text or null.");
    patch.assignee = value.assignee;
  }
  if (value.labels !== void 0) {
    if (!Array.isArray(value.labels) || !value.labels.every((label) => typeof label === "string")) throw badRequest("patch.labels must be a list of text.");
    patch.labels = value.labels;
  }
  return patch;
}
var EXPECTED_STRINGS = ["title", "status", "description", "design", "acceptance", "notes"];
function expectedOf(value) {
  if (value === void 0) return {};
  if (!isObject(value)) throw badRequest("expected must be an object.");
  const expected = {};
  for (const key of EXPECTED_STRINGS) {
    if (value[key] === void 0) continue;
    expected[key] = stringOf(value[key], `expected.${key}`);
  }
  if (value.priority !== void 0) {
    if (value.priority !== null && (typeof value.priority !== "number" || !Number.isFinite(value.priority))) throw badRequest("expected.priority must be a number or null.");
    expected.priority = value.priority;
  }
  if (value.assignee !== void 0) {
    if (value.assignee !== null && typeof value.assignee !== "string") throw badRequest("expected.assignee must be text or null.");
    expected.assignee = value.assignee;
  }
  if (value.labels !== void 0) {
    if (!Array.isArray(value.labels) || !value.labels.every((label) => typeof label === "string")) throw badRequest("expected.labels must be a list of text.");
    expected.labels = value.labels;
  }
  return expected;
}
function newBeadOf(value) {
  if (!isObject(value)) throw badRequest("input must be an object.");
  if (typeof value.priority !== "number" || !Number.isFinite(value.priority)) throw badRequest("input.priority must be a number.");
  const parentId = value.parentId === void 0 || value.parentId === null ? null : idOf(value.parentId, "input.parentId");
  const description = value.description === void 0 ? "" : stringOf(value.description, "input.description");
  return { title: stringOf(value.title, "input.title"), type: stringOf(value.type, "input.type"), priority: value.priority, parentId, description };
}
function headingRank(title) {
  for (const [pattern, rank] of HEADING_RANKS) if (pattern.test(title)) return rank;
  return null;
}
function rulesFrom(text) {
  if (text.trim() === "") return null;
  const lines = text.split(/\r\n|\r|\n/);
  const headings = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) headings.push({ index, level: heading[1].length, rank: headingRank(heading[2]) });
  });
  const named = headings.filter((h) => h.rank !== null);
  if (named.length === 0) return lines.join("\n");
  const bestRank = Math.min(...named.map((h) => h.rank));
  const ofRank = named.filter((h) => h.rank === bestRank);
  const pool = ofRank.some((h) => h.level > 1) ? ofRank.filter((h) => h.level > 1) : ofRank;
  const best = pool.reduce((a, b) => b.level < a.level ? b : a);
  const next = headings.find((h) => h.index > best.index && h.level <= best.level);
  return lines.slice(best.index, next?.index ?? lines.length).join("\n").trim();
}
async function readRules(root) {
  try {
    return rulesFrom(await (0, import_promises4.readFile)((0, import_node_path5.join)(root, "AGENTS.md"), "utf8"));
  } catch {
    return null;
  }
}
function createRoutes(deps = defaultDeps) {
  async function project(directory) {
    const resolved = await reading(() => deps.resolveWorkspace(directory));
    const { workspace, root } = resolved;
    if (root === null || workspace.kind !== "ok") throw workspaceReject(workspace);
    return { root, workspace };
  }
  async function beadsOf(directory, root) {
    let all = deps.cachedBeads(root);
    if (all === null) {
      const snapshot = await reading(() => deps.getSnapshot(directory));
      all = deps.cachedBeads(root);
      if (all === null) throw reject(500, "beads-error", readErrorText(void 0, false), { detail: snapshot.freshness?.localErrorDetail ?? void 0 });
    }
    return all;
  }
  async function findBead(directory, root, id) {
    const all = await beadsOf(directory, root);
    const bead = all.find((b) => b.id === id);
    if (!bead) throw reject(404, "not-found", "That bead no longer exists.");
    return { bead, all };
  }
  function refuseWhileSyncing(root) {
    if (deps.syncState(root).kind === "running") throw reject(409, "sync-running", SYNC_RUNNING_TEXT);
  }
  function refuseWrites(root) {
    if (deps.writesBlocked(root)) throw reject(409, "writes-blocked", "The team sync left this project half merged. Resolve the sync problem first.");
    refuseWhileSyncing(root);
  }
  async function write(root, mode, run) {
    refuseWrites(root);
    try {
      return await run(deps.providerFor(root, mode), await deps.panelActor(root));
    } catch (error) {
      if (error instanceof Reject) throw error;
      if (!(error instanceof WriteError)) throw reject(500, "failed", "The change could not be saved.", { detail: errorDetail(error) });
      if (error.code === "merge-conflict" || /in conflict/i.test(`${error.message}
${error.detail}`)) void deps.checkHalfMerge(root, mode);
      throw reject(WRITE_STATUS[error.code], error.code, error.message, { detail: error.detail, ...error.saved ? { saved: true } : {} });
    }
  }
  const handle = (run) => async (raw) => {
    try {
      const body = isObject(raw) ? raw : {};
      return await run(body, await validDirectory(body));
    } catch (error) {
      if (error instanceof Reject) return error.result;
      return fail(500, "INTERNAL", UNEXPECTED_TEXT, { detail: errorDetail(error) });
    }
  };
  return {
    workspace: handle(async (body, directory) => {
      const confirm = optionalBoolean(body, "confirmFirstContact");
      const { workspace } = await reading(() => deps.resolveWorkspace(directory));
      if (!confirm) return ok("workspace", workspace);
      if (workspace.kind !== "needs-first-contact") throw workspaceReject(workspace, "This project is not waiting for confirmation.");
      const store = await deps.projectStore(workspace.root).catch((error) => {
        throw reject(500, "beads-error", "Couldn't save your confirmation.", { detail: errorDetail(error) });
      });
      const before = store.firstContactConfirmedFor();
      store.confirmFirstContact(workspace.bdVersion);
      try {
        await store.save();
      } catch (error) {
        store.restoreFirstContact(before);
        throw reject(500, "beads-error", "Couldn't save your confirmation.", { detail: errorDetail(error) });
      }
      const next = await reading(() => deps.resolveWorkspace(directory, { refreshWorkspace: true }));
      return ok("workspace", next.workspace);
    }),
    snapshot: handle(async (body, directory) => {
      const { cursor } = body;
      if (cursor !== void 0 && typeof cursor !== "string") throw badRequest("cursor must be text.");
      const refresh2 = optionalBoolean(body, "refreshWorkspace");
      return ok("snapshot", await reading(() => deps.getSnapshot(directory, cursor, refresh2), true));
    }),
    bead: handle(async (body, directory) => {
      const id = idOf(body.id, "id");
      const { root } = await project(directory);
      const { bead, all } = await findBead(directory, root, id);
      return ok("bead", { bead, related: relatedFor(bead, all) });
    }),
    update: handle(async (body, directory) => {
      const id = idOf(body.id, "id");
      const expectedUpdatedAt = stringOf(body.expectedUpdatedAt, "expectedUpdatedAt");
      const patch = patchOf(body.patch);
      const expected = expectedOf(body.expected);
      const { root, workspace } = await project(directory);
      return ok("update", await write(root, workspace.mode, (provider, actor) => provider.update(id, expectedUpdatedAt, patch, actor, expected)));
    }),
    create: handle(async (body, directory) => {
      const input = newBeadOf(body.input);
      const { root, workspace } = await project(directory);
      return ok("create", { bead: await write(root, workspace.mode, (provider, actor) => provider.create(input, actor)) });
    }),
    comment: handle(async (body, directory) => {
      const id = idOf(body.id, "id");
      const text = stringOf(body.text, "text");
      const { root, workspace } = await project(directory);
      return ok("comment", { comment: await write(root, workspace.mode, (provider, actor) => provider.comment(id, text, actor)) });
    }),
    dependency: handle(async (body, directory) => {
      const { op } = body;
      if (op !== "add" && op !== "remove") throw badRequest('op must be "add" or "remove".');
      const from = idOf(body.from, "from");
      const to = idOf(body.to, "to");
      const kind = op === "add" ? stringOf(body.kind, "kind") : typeof body.kind === "string" ? body.kind : "";
      const { root, workspace } = await project(directory);
      await write(root, workspace.mode, (provider, actor) => provider.dependency(op, from, to, kind, actor));
      return ok("dependency", { ok: true });
    }),
    seen: handle(async (body, directory) => {
      const all = optionalBoolean(body, "all");
      const { ids } = body;
      if (ids !== void 0 && !Array.isArray(ids)) throw badRequest("ids must be a list of bead ids.");
      if (!all && ids === void 0) throw badRequest("Send ids or all.");
      const wanted = all ? "all" : ids.map((id) => idOf(id, "ids"));
      const { root } = await project(directory);
      try {
        const store = await deps.projectStore(root);
        store.markSeen(wanted);
        await store.save();
        return ok("seen", { unseenIds: [...store.unseenIds(), ...store.unseenDeletionIds()] });
      } catch (error) {
        throw reject(500, "beads-error", "Couldn't save what you've seen.", { detail: errorDetail(error) });
      }
    }),
    context: handle(async (body, directory) => {
      const id = idOf(body.id, "id");
      const { root, workspace } = await project(directory);
      const snapshot = await reading(() => deps.getSnapshot(directory));
      const { bead, all } = await findBead(directory, root, id);
      const freshness = snapshot.freshness;
      const stale = freshness?.localError ? { readAt: freshness.localRefreshedAt } : void 0;
      const { text, title } = buildContext(bead, relatedFor(bead, all), stale);
      return ok("context", { id: bead.id, title, text, url: await deps.beadUrl(root, workspace.projectName, bead.id) });
    }),
    "sync-preview": handle(async (_body, directory) => {
      const { root, workspace } = await project(directory);
      refuseWhileSyncing(root);
      const preview = await syncReading(() => deps.preview(root, workspace.mode));
      return ok("sync-preview", preview === null ? { changes: [], noRemote: true } : preview);
    }),
    "sync-pull": handle(async (_body, directory) => {
      const { root, workspace } = await project(directory);
      return ok("sync-pull", { sync: deps.startPull(root, workspace.mode) });
    }),
    "sync-publish": handle(async (body, directory) => {
      const expected = body.expectedHead;
      if (typeof expected !== "string" || !HEAD_PATTERN2.test(expected)) throw badRequest("expectedHead must be the head commit of the preview.");
      const { root, workspace } = await project(directory);
      if (deps.syncState(root).kind === "running") throw reject(409, "sync-running", SYNC_RUNNING_TEXT);
      const head = await syncReading(() => deps.localHead(root, workspace.mode));
      if (head !== expected) throw reject(409, "preview-stale", PREVIEW_STALE_TEXT);
      return ok("sync-publish", { sync: deps.startPublish(root, workspace.mode, expected) });
    }),
    "conflict-context": handle(async (_body, directory) => {
      const { root, workspace } = await project(directory);
      const state = deps.syncState(root);
      if (state.kind !== "conflict" && state.kind !== "error" && state.kind !== "paused-upgrade") throw badRequest("There is no sync problem to attach.");
      const text = buildConflictContext(root, state, await readRules(root));
      const id = `sync-${(0, import_node_path5.basename)(root)}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
      return ok("conflict-context", { id, title: "Beads sync needs attention", text, url: await deps.beadUrl(root, workspace.projectName, "sync") });
    })
  };
}

// src/service/main.ts
var MAX_BODY_CHARS = 64e3;
var MAX_BODY_BYTES = MAX_BODY_CHARS * 4;
var HttpError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
  status;
  code;
};
function send(res, status, json) {
  const encoded = JSON.stringify(json);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(encoded);
}
function sendError(res, status, code, message) {
  const envelope = { error: { code, message } };
  send(res, status, envelope);
}
async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length > MAX_BODY_CHARS) throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "Request body must be a JSON object.");
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new HttpError(400, "BAD_REQUEST", "Request body must be a JSON object.");
  }
  return value;
}
function startServer(opts) {
  const { port, token, handlers } = opts;
  const server = (0, import_node_http.createServer)(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      return sendError(res, 401, "UNAUTHORIZED", "Missing or invalid service token.");
    }
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
    const name = req.method === "POST" && req.url?.startsWith("/api/") ? req.url.slice("/api/".length) : "";
    const handler = Object.hasOwn(handlers, name) ? handlers[name] : void 0;
    if (!handler) return sendError(res, 404, "NOT_FOUND", "Route not found.");
    try {
      const body = await readJsonBody(req);
      const result = await handler(body);
      send(res, result.status, result.json);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message);
      const message = err instanceof Error ? err.message : "Unexpected error.";
      sendError(res, 500, "INTERNAL", message);
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}
function main() {
  const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
  const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
  if (!Number.isInteger(port) || port <= 0 || !token) {
    process.stderr.write("OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required.\n");
    process.exit(1);
  }
  startServer({ port, token, handlers: createRoutes() });
}
if (!process.env.VITEST) main();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  startServer
});
