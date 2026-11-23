import {
  Clipper,
  Clipper64,
  ClipperOffset,
  EndType,
  JoinType,
  Path64,
  Paths64,
  Point64,
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

interface OffsetGroupLike {
  inPaths: Path64[];
  outPath: Point64[];
  outPaths: Paths64;
}

interface ClipperOffsetWithInternalProto {
  offsetPolygon?: (group: OffsetGroupLike, path: Point64[]) => void;
  offsetPoint: (group: OffsetGroupLike, path: Point64[], j: number, k: number) => void;
  _groupDelta: number;
  __patchedOffsetPolygon?: boolean;
}

const clipperProto = Clipper64.prototype as unknown as Clipper64WithInternalProto;
const origNewOutRec = clipperProto.newOutRec;

const offsetProto = ClipperOffset.prototype as unknown as ClipperOffsetWithInternalProto;
const origOffsetPolygon = offsetProto.offsetPolygon;

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
 * Checks whether unpatched ClipperOffset.prototype.offsetPolygon exhibits the clipper2-js@1.2.4
 * C# `ref int k` port bug where `prev` stays fixed at `cnt - 1` for every vertex.
 */
export function checkUnpatchedOffsetPolygonBug(): {
  hasOriginalMethod: boolean;
  producesDistortedOffsetArea: boolean;
} {
  if (!origOffsetPolygon) {
    return { hasOriginalMethod: false, producesDistortedOffsetArea: false };
  }
  const saved = offsetProto.offsetPolygon;
  offsetProto.offsetPolygon = origOffsetPolygon;
  try {
    const sq = new Path64();
    sq.push(new Point64(0, 0));
    sq.push(new Point64(1000, 0));
    sq.push(new Point64(1000, 1000));
    sq.push(new Point64(0, 1000));
    const paths = new Paths64();
    paths.push(sq);
    const sol = Clipper.InflatePaths(paths, 100, JoinType.Round, EndType.Polygon);
    const area = Clipper.areaPaths(sol);
    // Expected area for 1000x1000 inflated by +100 with Round corners: ~1,431,416
    // Buggy unpatched clipper2-js@1.2.4 returns ~1,223,562 (< 1,350,000)
    return {
      hasOriginalMethod: true,
      producesDistortedOffsetArea: area < 1_350_000,
    };
  } finally {
    offsetProto.offsetPolygon = saved;
  }
}

/**
 * Idempotently patches Clipper64.prototype.newOutRec and ClipperOffset.prototype.offsetPolygon
 * to work around clipper2-js@1.2.4 port issues.
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

  if (origOffsetPolygon && !offsetProto.__patchedOffsetPolygon) {
    offsetProto.offsetPolygon = function (
      this: ClipperOffsetWithInternalProto,
      group: OffsetGroupLike,
      path: Point64[]
    ) {
      const area = Clipper.area(path);
      if ((area < 0) !== (this._groupDelta < 0)) {
        const rect = Clipper.getBounds(path);
        const offsetMinDim = Math.abs(this._groupDelta) * 2;
        if (offsetMinDim > rect.width || offsetMinDim > rect.height) {
          return;
        }
      }
      group.outPath = [];
      const cnt = path.length;
      let prev = cnt - 1;
      for (let i = 0; i < cnt; i++) {
        this.offsetPoint(group, path, i, prev);
        prev = i;
      }
      group.outPaths.push(group.outPath);
    };
    offsetProto.__patchedOffsetPolygon = true;
  }
}
