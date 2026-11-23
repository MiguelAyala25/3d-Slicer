import { describe, it, expect } from 'vitest';
import { affineApply } from '../core/affine2d';
import { pointInPolygonWithHoles } from '../core/geometry2d';
import { DEFAULT_PARAMS } from '../core/params';
import { buildPrintCalibrationPackage } from '../core/printCalibration';

describe('printCalibration (end-to-end orientation chain proof)', () => {
  it('maps asymmetric F calibration image pixels into exact sheet cut polygons (reverse-print default)', () => {
    const pkg = buildPrintCalibrationPackage(DEFAULT_PARAMS, {
      bleedMm: 0,
      mirrorPrint: false,
    });

    expect(pkg.sliceResult.plates).toHaveLength(2);
    expect(pkg.regions).toHaveLength(2);
    expect(pkg.printSheets).toHaveLength(1);

    const ps = pkg.printSheets[0];
    const plate0Cut = pkg.sheets[0].plates.find((p) => p.plateIndex === 0)!;
    const plate0Print = ps.regions.find((r) => r.plateIndex === 0)!;
    expect(plate0Cut).toBeDefined();
    expect(plate0Print).toBeDefined();

    // Image pixel (220, 150) lies inside the top bar of the upright F in the calibration SVG
    // In slice-local coordinates (world X=-6mm, world Z=+17mm -> slice x=-6, y=-17), inside F silhouette!
    const sheetPt = affineApply(plate0Print.imageToSheet, [220, 150]);
    const localCutPt: [number, number] = [
      sheetPt[0] - plate0Cut.xOffset,
      sheetPt[1] - plate0Cut.yOffset,
    ];
    expect(pointInPolygonWithHoles(localCutPt[0], localCutPt[1], plate0Cut.polygons[0])).toBe(true);

    // Image pixel (400, 480) is at bottom-right away from the F stem, so NOT inside plate 0 cut F
    const outsidePt = affineApply(plate0Print.imageToSheet, [400, 480]);
    const localOutPt: [number, number] = [
      outsidePt[0] - plate0Cut.xOffset,
      outsidePt[1] - plate0Cut.yOffset,
    ];
    expect(pointInPolygonWithHoles(localOutPt[0], localOutPt[1], plate0Cut.polygons[0])).toBe(false);
  });

  it('preserves pixel-to-cut alignment under 90-degree rotated packing (optimizeLayout: true)', () => {
    // Tall/narrow sheet 75x250 forces 64mm-tall plate 1 to pack cleanly, and test narrow width 70x250
    const pkg = buildPrintCalibrationPackage(
      {
        ...DEFAULT_PARAMS,
        sheetW: 72,
        sheetH: 250,
        sheetMargin: 5,
        optimizeLayout: true,
      },
      { bleedMm: 0, mirrorPrint: false }
    );

    const plate0Cut = pkg.sheets[0].plates.find((p) => p.plateIndex === 0)!;
    const plate0Print = pkg.printSheets[0].regions.find((r) => r.plateIndex === 0)!;
    const sheetPt = affineApply(plate0Print.imageToSheet, [220, 150]);
    expect(
      pointInPolygonWithHoles(
        sheetPt[0] - plate0Cut.xOffset,
        sheetPt[1] - plate0Cut.yOffset,
        plate0Cut.polygons[0]
      )
    ).toBe(true);
  });

  it('mirrors pixel coordinates consistently with mirrored cut sheet when mirrorPrint is true', () => {
    const pkgNormal = buildPrintCalibrationPackage(DEFAULT_PARAMS, {
      bleedMm: 0,
      mirrorPrint: false,
    });
    const pkgMirror = buildPrintCalibrationPackage(DEFAULT_PARAMS, {
      bleedMm: 0,
      mirrorPrint: true,
    });

    const pNormal = affineApply(pkgNormal.printSheets[0].regions[0].imageToSheet, [220, 150]);
    const pMirror = affineApply(pkgMirror.printSheets[0].regions[0].imageToSheet, [220, 150]);
    expect(pMirror[0]).toBeCloseTo(pkgMirror.sheets[0].width - pNormal[0], 4);
    expect(pMirror[1]).toBeCloseTo(pNormal[1], 4);
  });
});
