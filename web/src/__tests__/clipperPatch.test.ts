import { describe, it, expect } from 'vitest';
import {
  Clipper,
  Clipper64,
  PolyTree64,
  ClipType,
  EndType,
  FillRule,
  JoinType,
  Point64,
  Path64,
  Paths64,
} from 'clipper2-js';
import {
  applyClipperPatch,
  checkUnpatchedOffsetPolygonBug,
  checkUnpatchedOutRecBug,
} from '../core/vendor/clipperPatch';

describe('Clipper64 newOutRec patch (M2)', () => {
  it('guard test: unpatched newOutRec exhibits bug in clipper2-js@1.2.4 port', () => {
    const bugStatus = checkUnpatchedOutRecBug();
    expect(bugStatus.hasOriginalMethod).toBe(true);
    // If upstream clipper2-js fixes this bug in a future release, this guard test will fail
    // alerting the maintainers that the workaround can be safely removed.
    expect(
      bugStatus.missingBounds || bugStatus.missingPath,
      'Guard test: unpatched newOutRec() should produce OutRec without bounds/path. If upstream is fixed, remove patch.'
    ).toBe(true);
  });

  it('applies patch idempotently and executes polyTree successfully with outer and hole', () => {
    applyClipperPatch();
    applyClipperPatch();

    // Outer square: 0,0 to 100,100
    const outer = new Path64();
    outer.push(new Point64(0, 0));
    outer.push(new Point64(100, 0));
    outer.push(new Point64(100, 100));
    outer.push(new Point64(0, 100));

    // Hole: 20,20 to 80,80 (opposite orientation for non-zero or subject)
    const hole = new Path64();
    hole.push(new Point64(20, 20));
    hole.push(new Point64(20, 80));
    hole.push(new Point64(80, 80));
    hole.push(new Point64(80, 20));

    const subj = new Paths64();
    subj.push(outer);
    subj.push(hole);

    const clipper = new Clipper64();
    clipper.addSubjectPaths(subj);
    const polyTree = new PolyTree64();

    expect(() => {
      clipper.executePolyTree(ClipType.Union, FillRule.NonZero, polyTree);
    }).not.toThrow();

    expect(polyTree.children.length).toBeGreaterThan(0);
  });

  it('guard test & fix: patches ClipperOffset.offsetPolygon ref-param bug in clipper2-js@1.2.4', () => {
    const bugStatus = checkUnpatchedOffsetPolygonBug();
    expect(bugStatus.hasOriginalMethod).toBe(true);
    expect(
      bugStatus.producesDistortedOffsetArea,
      'Guard test: unpatched offsetPolygon() distorts offset area. If upstream is fixed, remove patch.'
    ).toBe(true);

    applyClipperPatch();
    const sq = new Path64();
    sq.push(new Point64(0, 0));
    sq.push(new Point64(1000, 0));
    sq.push(new Point64(1000, 1000));
    sq.push(new Point64(0, 1000));
    const paths = new Paths64();
    paths.push(sq);

    const expanded = Clipper.InflatePaths(paths, 100, JoinType.Round, EndType.Polygon);
    const expandedArea = Clipper.areaPaths(expanded);
    const expectedExpanded = 1000 * 1000 + 4 * 1000 * 100 + Math.PI * 100 * 100;
    expect(Math.abs(expandedArea - expectedExpanded)).toBeLessThan(1000);

    const shrunk = Clipper.InflatePaths(paths, -100, JoinType.Round, EndType.Polygon);
    expect(Math.abs(Clipper.areaPaths(shrunk) - 800 * 800)).toBeLessThan(1000);
  });
});
