import { HostRequestError, type HostClient, type HostRequestErrorCode } from '@openchamber/sdk';
import type { ApiErrorCode, ApiRequest, ApiResponse, ApiRouteName } from '../shared/api';
import type { ErrorEnvelope, WorkspaceState } from '../shared/types';

/** What a failed request can carry: a service error code, or the host's code when the request never reached the service. */
export type RequestErrorCode = ApiErrorCode | HostRequestErrorCode;

/**
 * A request that did not answer 2xx. `message` is plain language and safe to show; `detail` is raw text for "Copy details"
 * only; `workspace` is set when the project cannot be used; `status` is null when the host failed before any answer.
 */
export class BeadsRequestError extends Error {
  constructor(
    readonly code: RequestErrorCode,
    message: string,
    readonly status: number | null,
    readonly detail?: string,
    readonly workspace?: WorkspaceState,
    readonly saved?: true,
  ) {
    super(message);
    this.name = 'BeadsRequestError';
    // An empty detail has nothing to copy: treat it as none, so no dead "Copy details" appears.
    if (detail === '') this.detail = undefined;
  }
}

const UNEXPECTED = 'Something went wrong.';

/** Host failures in plain words. The raw host message (for SERVICE_FAILED, the helper's output) goes to `detail`. */
const HOST_TEXT: Partial<Record<HostRequestErrorCode, string>> = {
  DISCONNECTED: "OpenChamber isn't connected.",
  HOST_UNAVAILABLE: "OpenChamber isn't available right now.",
  HOST_REJECTED: 'OpenChamber refused the request.',
  NO_SERVICE: "Abacus's helper isn't available.",
  DISABLED: 'The Beads extension is turned off.',
  SERVICE_FAILED: "Abacus's helper stopped unexpectedly.",
  REQUEST_FAILED: "The request didn't go through.",
  RESPONSE_TOO_LARGE: 'The answer was too large to show.',
  HOST_TIMEOUT: 'Beads took too long to answer.',
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function fromEnvelope(status: number, body: string): BeadsRequestError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new BeadsRequestError('INTERNAL', UNEXPECTED, status, body);
  }
  const error = isObject(parsed) && isObject(parsed.error) ? (parsed as ErrorEnvelope).error : null;
  if (!error || typeof error.code !== 'string' || typeof error.message !== 'string') return new BeadsRequestError('INTERNAL', UNEXPECTED, status, body);
  return new BeadsRequestError(error.code, error.message, status, error.detail, error.workspace, error.saved);
}

function fromThrown(error: unknown): BeadsRequestError {
  if (error instanceof BeadsRequestError) return error;
  if (error instanceof HostRequestError) return new BeadsRequestError(error.code, HOST_TEXT[error.code] ?? UNEXPECTED, null, error.message);
  return new BeadsRequestError('INTERNAL', UNEXPECTED, null, error instanceof Error ? error.message : String(error));
}

/** Host failures after a request was sent: the service may have acted on it, so the answer is unknown, never "no". */
export const ANSWER_LOST: ReadonlySet<string> = new Set(['HOST_TIMEOUT', 'SERVICE_FAILED', 'REQUEST_FAILED', 'RESPONSE_TOO_LARGE']);

/** OpenChamber's toast limits: the message, and the text its Copy action carries. */
export const TOAST_MAX = 500;
export const COPY_MAX = 32_000;

/** Any thrown value as a BeadsRequestError, so the UI only ever handles one shape. */
export const asRequestError = fromThrown;

type Method<N extends ApiRouteName> = (request: ApiRequest<N>) => Promise<ApiResponse<N>>;

/** One method per service route; hyphenated route names in camel case. */
export type BeadsClient = {
  workspace: Method<'workspace'>;
  snapshot: Method<'snapshot'>;
  bead: Method<'bead'>;
  update: Method<'update'>;
  create: Method<'create'>;
  comment: Method<'comment'>;
  dependency: Method<'dependency'>;
  seen: Method<'seen'>;
  context: Method<'context'>;
  syncPreview: Method<'sync-preview'>;
  syncPull: Method<'sync-pull'>;
  syncPublish: Method<'sync-publish'>;
  conflictContext: Method<'conflict-context'>;
};

/** The typed service client. Every route is `POST /api/<name>` with a JSON string body; failures throw BeadsRequestError. */
export function createClient(host: Pick<HostClient, 'serviceRequest'>): BeadsClient {
  const call =
    <N extends ApiRouteName>(name: N): Method<N> =>
    async (request) => {
      let answer: { status: number; body: string };
      try {
        answer = await host.serviceRequest({ method: 'POST', path: `/api/${name}`, body: JSON.stringify(request) });
      } catch (error) {
        throw fromThrown(error);
      }
      if (answer.status < 200 || answer.status >= 300) throw fromEnvelope(answer.status, answer.body);
      try {
        return JSON.parse(answer.body) as ApiResponse<N>;
      } catch {
        throw new BeadsRequestError('INTERNAL', UNEXPECTED, answer.status, answer.body);
      }
    };
  return {
    workspace: call('workspace'),
    snapshot: call('snapshot'),
    bead: call('bead'),
    update: call('update'),
    create: call('create'),
    comment: call('comment'),
    dependency: call('dependency'),
    seen: call('seen'),
    context: call('context'),
    syncPreview: call('sync-preview'),
    syncPull: call('sync-pull'),
    syncPublish: call('sync-publish'),
    conflictContext: call('conflict-context'),
  };
}
