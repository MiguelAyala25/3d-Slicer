import {
  Clipper64,
  Path64,
  Rect64,
} from 'clipper2-js';

interface OutRecLike {
  bounds?: Rect64;
  path?: Path64;
  [key: string]: unknown;
}

interface Clipper64WithInternalProto {
  newOutRec?: () => OutRecLike;
  __patchedOutRec?: boolean;
}

const clipperProto = Clipper64.prototype as unknown as Clipper64WithInternalProto;
const origNewOutRec = clipperProto.newOutRec;

/**
 * Checks whether unpatched Clipper64.prototype.newOutRec exhibits the clipper2-js@1.2.4 port issue
 * where OutRec instances lack initialized bounds and/or path.
 */
export function checkUnpatchedOutRecBug(): {
  hasOriginalMethod: boolean;
  missingBounds: boolean;
  missingPath: boolean;
} {
  if (!origNewOutRec) {
    return { hasOriginalMethod: false, missingBounds: false, missingPath: false };
  }
  const dummy = new Clipper64();
  const rawOutRec = origNewOutRec.call(dummy);
  return {
    hasOriginalMethod: true,
    missingBounds: !rawOutRec.bounds,
    missingPath: !rawOutRec.path,
  };
}

/**
 * Idempotently patches Clipper64.prototype.newOutRec to initialize bounds and path on OutRec,
 * preventing executePolyTree's checkBounds from throwing or failing silently.
 */
export function applyClipperPatch(): void {
  if (origNewOutRec && !clipperProto.__patchedOutRec) {
    clipperProto.newOutRec = function (this: Clipper64) {
      const r = origNewOutRec.call(this);
      if (!r.bounds) r.bounds = new Rect64(false);
      if (!r.path) r.path = new Path64();
      return r;
    };
    clipperProto.__patchedOutRec = true;
  }
}
