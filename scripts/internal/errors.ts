/**
 * The slice of CPython's exception hierarchy that `classify_exception` branches
 * on, plus `str()` for each shape.
 *
 * `classify_exception` dispatches with `isinstance`, so the port needs real
 * classes with the same inheritance -- notably that `gaierror` and `SSLError`
 * are both `OSError`, and that `socket.timeout` *is* `TimeoutError` on 3.10+.
 */

import { pyRepr } from './pystr.js';

/** Base for anything carrying Python-style positional `args`. */
export class PyException extends Error {
  readonly args: readonly unknown[];

  constructor(...args: unknown[]) {
    super(args.length === 1 ? String(args[0]) : args.map((a) => String(a)).join(', '));
    this.args = args;
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** `str(exc)`. Overridden where CPython overrides `__str__`. */
  pyStr(): string {
    if (this.args.length === 0) return '';
    if (this.args.length === 1) return pyStrOf(this.args[0]);
    return reprTuple(this.args);
  }
}

export class PyValueError extends PyException {}

export class PyOSError extends PyException {
  override pyStr(): string {
    // OSError(errno, strerror) renders as "[Errno n] strerror"; other arities
    // fall back to the generic tuple form.
    if (this.args.length === 2) return `[Errno ${pyStrOf(this.args[0])}] ${pyStrOf(this.args[1])}`;
    return super.pyStr();
  }
}

/** `socket.gaierror` -- DNS resolution failure. */
export class GaiError extends PyOSError {}

/**
 * `ssl.SSLError`.
 *
 * Its `__str__` returns `strerror` when the C layer set one and `str(self.args)`
 * otherwise -- so `str(SSLError("bad certificate"))` is `"('bad certificate',)"`,
 * not `"bad certificate"`. The tuple form is what ends up in the message.
 */
export class SSLError extends PyOSError {
  readonly strerror: string | null;

  constructor(...args: unknown[]) {
    super(...args);
    this.strerror = args.length >= 2 && typeof args[1] === 'string' ? args[1] : null;
  }

  override pyStr(): string {
    if (this.strerror !== null) return this.strerror;
    return reprTuple(this.args);
  }
}

export class SSLCertVerificationError extends SSLError {}

/** `TimeoutError`; `socket.timeout` is an alias for it. */
export class PyTimeoutError extends PyOSError {}

/** `http.client.HTTPException` -- note it is *not* an OSError. */
export class HTTPException extends PyException {}

export class RemoteDisconnected extends HTTPException {}

/** `urllib.error.URLError`. Carries the underlying failure in `.reason`. */
export class URLError extends PyOSError {
  readonly reason: unknown;

  constructor(reason: unknown, filename?: string) {
    super(reason);
    this.reason = reason;
    if (filename !== undefined) (this as { filename?: string }).filename = filename;
  }

  override pyStr(): string {
    return `<urlopen error ${pyStrOf(this.reason)}>`;
  }
}

/** `urllib.error.HTTPError`. A URLError *and* a response object. */
export class HTTPError extends URLError {
  readonly code: number;
  readonly msg: string;
  readonly hdrs: Record<string, string>;
  readonly url: string;

  // CPython exposes `reason` as a property returning `msg`; passing msg to the
  // URLError constructor gives the same value without shadowing the field.
  constructor(url: string, code: number, msg: string, hdrs: Record<string, string> = {}) {
    super(msg);
    this.url = url;
    this.code = code;
    this.msg = msg;
    this.hdrs = hdrs;
  }

  override pyStr(): string {
    return `HTTP Error ${this.code}: ${this.msg}`;
  }
}

function reprTuple(args: readonly unknown[]): string {
  const parts = args.map((a) => (typeof a === 'string' ? pyRepr(a) : String(a)));
  return parts.length === 1 ? `(${parts[0]},)` : `(${parts.join(', ')})`;
}

/** `str(value)` for the values these exceptions wrap. */
export function pyStrOf(value: unknown): string {
  if (value instanceof PyException) return value.pyStr();
  if (value === null) return 'None';
  return String(value);
}
