import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HAND_PATH = fileURLToPath(
  new URL('../fixtures/Hand.OBJ', import.meta.url)
);
const HEAD_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../Models/head-reference-male-149x202x220.stl'
);
const USER_REF_IMAGE =
  'C:/Users/tlacu/.gemini/antigravity/brain/3c646f67-334a-4fed-84a3-ff0bc6131734/.user_uploaded/media_1795054830394_0c16def0.jpg';

async function buildDataCollagePngBuffer(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0B1020';
    ctx.fillRect(0, 0, 640, 640);

    // Colorful pixel/data blocks
    const palette = [
      '#FF2D78',
      '#00E5FF',
      '#FFE600',
      '#7C3AED',
      '#22C55E',
      '#FB923C',
      '#F8FAFC',
    ];
    for (let y = 24; y < 616; y += 36) {
      for (let x = 24; x < 616; x += 48) {
        const idx = ((x * 7 + y * 13) >>> 0) % palette.length;
        ctx.fillStyle = palette[idx];
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, y, 38, 26);
      }
    }
    ctx.globalAlpha = 1;

    // Dark terminal card in center for high-contrast typography
    ctx.fillStyle = 'rgba(9, 9, 11, 0.88)';
    ctx.fillRect(60, 210, 520, 220);
    ctx.strokeStyle = '#00E5FF';
    ctx.lineWidth = 6;
    ctx.strokeRect(60, 210, 520, 220);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DATA // 2026', 320, 285);

    ctx.fillStyle = '#FFE600';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('ARRIBA ^ PROYECCION', 320, 345);

    ctx.fillStyle = '#FF2D78';
    ctx.font = 'bold 24px monospace';
    ctx.fillText('<- IZQ       DER ->', 320, 395);

    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

async function uploadMeshAndSelectStacked(
  page: Page,
  meshPath: string,
  expectedFileName: string,
  joint: 'none' | 'discs' = 'none'
): Promise<void> {
  await page.setInputFiles('[data-testid="mesh-file-input"]', meshPath);

  const repairBtn = page.getByTestId('btn-repair-and-load');
  const fileBadge = page.getByText(expectedFileName, { exact: true });

  await Promise.race([
    repairBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    fileBadge.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
  ]);

  if (await repairBtn.isVisible()) {
    await repairBtn.click();
  }

  await expect(fileBadge).toBeVisible({ timeout: 20_000 });

  const techSelect = page.locator('[data-testid="select-technique"]');
  if ((await techSelect.inputValue()) !== 'stacked') {
    await techSelect.selectOption('stacked');
  }

  const jointSelect = page.locator('[data-testid="select-joint"]');
  if ((await jointSelect.isVisible()) && (await jointSelect.inputValue()) !== joint) {
    await jointSelect.selectOption(joint);
  }

  await expect(page.locator('text=Piso 0')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('viewport-loading-overlay')).not.toBeVisible({
    timeout: 20_000,
  });
}

async function assertCleanAxisYSlice(page: Page): Promise<void> {
  const status = await page.evaluate(() => {
    const w = window as unknown as {
      __SCULPTURE_STORE__: {
        getState: () => {
          errorMessage: string | null;
          lastSliceAxis: string | null;
          sliceResult: unknown;
        };
      };
    };
    const st = w.__SCULPTURE_STORE__.getState();
    return {
      errorMessage: st.errorMessage,
      lastSliceAxis: st.lastSliceAxis,
      hasSliceResult: st.sliceResult !== null,
    };
  });
  expect(status.errorMessage).toBeNull();
  expect(status.lastSliceAxis).toBe('y');
  expect(status.hasSliceResult).toBe(true);
}

test.describe('Front Image Projection (Path A)', () => {
  test('1. Projects decal on axis Y, inspects cut+print & tiling modal, and opens calibration sheet without errors', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await page.route('**/favicon.ico', (route) =>
      route.fulfill({ status: 204, body: '' })
    );

    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto('/');
    await uploadMeshAndSelectStacked(page, HAND_PATH, 'Hand.OBJ');

    const pngBuf = await buildDataCollagePngBuffer(page);
    await page.setInputFiles('[data-testid="decal-file-input"]', {
      name: 'collage_data.png',
      mimeType: 'image/png',
      buffer: pngBuf,
    });

    await expect(page.getByText('collage_data.png', { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Default axis is Z -> warning banner prompts switch to Y
    await expect(page.getByTestId('axis-y-projection-warning')).toBeVisible();
    await page.getByTestId('btn-switch-axis-y').click();
    await expect(page.getByTestId('axis-y-projection-warning')).not.toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('viewport-loading-overlay')).not.toBeVisible({
      timeout: 10_000,
    });

    // Open SheetPreviewModal
    await page.getByRole('button', { name: 'Vista previa y exportar' }).click();
    await expect(page.getByTestId('print-export-options-bar')).toBeVisible();

    const modal = page.getByRole('dialog');
    await expect(modal.locator('svg #impresion')).toBeAttached();
    await expect(modal.locator('svg #corte-guia')).toBeAttached();
    await expect(modal.locator('svg #registro')).toBeAttached();

    // Switch to adhesive-film + tiling
    await modal.locator('select').first().selectOption('adhesive-film');
    await expect(
      modal.getByText('Usa film PET o polipropileno. Nunca PVC en el láser.')
    ).toBeVisible();
    await modal.getByLabel('Dividir en mosaicos').check();
    await modal.getByRole('button', { name: 'Mapa de mosaico' }).click();
    await expect(modal.locator('svg #mosaicos')).toBeAttached();

    await modal.getByRole('button', { name: 'Cerrar previsualización' }).click();
    await expect(modal).not.toBeVisible();

    // Calibration sheet preview
    await page.getByTestId('btn-print-calibration-sheet').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('dialog').getByText('Calibración de Impresión', { exact: true })
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('2. Captures visual screenshots with real models and projected images', async ({
    page,
  }) => {
    const outDir = process.env.CAPTURE_SCREENSHOTS_DIR;
    test.skip(!outDir, 'Set CAPTURE_SCREENSHOTS_DIR to capture screenshots');
    if (!outDir) return;

    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await page.route('**/favicon.ico', (route) =>
      route.fulfill({ status: 204, body: '' })
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const headExists = fs.existsSync(HEAD_PATH);
    const meshToUse = headExists ? HEAD_PATH : HAND_PATH;
    const meshName = headExists
      ? 'head-reference-male-149x202x220.stl'
      : 'Hand.OBJ';

    await uploadMeshAndSelectStacked(page, meshToUse, meshName, 'discs');

    // Set 16 plates, 2 mm gap, axis Y for rich silhouette & clear slices
    await page.evaluate(async () => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: {
          getState: () => {
            setParam: (k: string, v: unknown) => void;
            runSlice: () => Promise<void>;
          };
        };
      };
      const st = w.__SCULPTURE_STORE__.getState();
      st.setParam('plates', 16);
      st.setParam('gap', 2);
      st.setParam('axis', 'y');
      await st.runSlice();
    });

    await expect(page.getByTestId('viewport-loading-overlay')).not.toBeVisible({
      timeout: 20_000,
    });
    await assertCleanAxisYSlice(page);

    const collageBuf = await buildDataCollagePngBuffer(page);

    if (fs.existsSync(USER_REF_IMAGE)) {
      await page.setInputFiles('[data-testid="decal-file-input"]', USER_REF_IMAGE);
    } else {
      await page.setInputFiles('[data-testid="decal-file-input"]', {
        name: 'collage_data.png',
        mimeType: 'image/png',
        buffer: collageBuf,
      });
    }

    await page.waitForFunction(() => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: { getState: () => { decals: unknown[] } };
      };
      return w.__SCULPTURE_STORE__.getState().decals.length === 1;
    });

    // Scale image nicely across the head silhouette so the entire gizmo & handles fit in Front view
    await page.evaluate(() => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: {
          getState: () => {
            decals: Array<{ id: string; pxW: number; pxH: number }>;
            sliceResult: { scaledBounds: [[number, number], [number, number]] } | null;
            updateDecal: (id: string, patch: Record<string, unknown>) => void;
            setCameraPreset: (p: string) => void;
          };
        };
      };
      const st = w.__SCULPTURE_STORE__.getState();
      const d = st.decals[0];
      if (d && st.sliceResult) {
        const [[minX], [maxX]] = st.sliceResult.scaledBounds;
        const wMm = Number(((maxX - minX) * 0.72).toFixed(2));
        const hMm = Number((wMm * (d.pxH / d.pxW)).toFixed(2));
        st.updateDecal(d.id, { widthMm: wMm, heightMm: hMm });
      }
      st.setCameraPreset('front');
    });

    await page.getByTestId('section-images').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(outDir, 'shot_01_head_front_gizmo.png'),
    });

    // Shot 2: ISO 3D view showing multi-slice surface projection (gizmo auto-hidden)
    await page.keyboard.press('0');
    await page.waitForTimeout(900);
    await page.screenshot({
      path: path.join(outDir, 'shot_02_head_iso_surface.png'),
    });

    // Shot 5: Export modal (Corte + Impresión in UV)
    await page.getByRole('button', { name: 'Vista previa y exportar' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('print-export-options-bar')).toBeVisible();
    await expect(modal.locator('svg #impresion')).toBeAttached();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(outDir, 'shot_05_modal_cut_print_uv.png'),
    });

    // Shot 6: Adhesive film + Tiling Map
    await modal.locator('select').first().selectOption('adhesive-film');
    await expect(
      modal.getByText('Usa film PET o polipropileno. Nunca PVC en el láser.')
    ).toBeVisible();
    await modal.getByLabel('Dividir en mosaicos').check();
    await modal.getByRole('button', { name: 'Mapa de mosaico' }).click();
    await expect(modal.locator('svg #mosaicos')).toBeAttached();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(outDir, 'shot_06_modal_film_tiling.png'),
    });

    await modal.getByRole('button', { name: 'Cerrar previsualización' }).click();
    await expect(modal).not.toBeVisible();

    // Shot 7: Calibration Sheet F
    await page.evaluate(() => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: {
          getState: () => { setPrintConfig: (patch: Record<string, unknown>) => void };
        };
      };
      w.__SCULPTURE_STORE__.getState().setPrintConfig({ technique: 'uv' });
    });
    await page.getByTestId('btn-print-calibration-sheet').click();
    await expect(modal).toBeVisible();
    await expect(
      modal.getByText('Calibración de Impresión', { exact: true })
    ).toBeVisible();
    await expect(modal.locator('svg #impresion')).toBeAttached();
    const zoomInBtn = modal.locator('button[title="Acercar"]');
    for (let i = 0; i < 6; i++) {
      await zoomInBtn.click();
    }
    await page.evaluate(() => {
      const container = document.querySelector(
        '[role="dialog"] .overflow-auto'
      ) as HTMLElement | null;
      if (container) {
        container.scrollLeft = 0;
        container.scrollTop = container.scrollHeight;
      }
    });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(outDir, 'shot_07_modal_calibration_f.png'),
    });
    await modal.getByRole('button', { name: 'Cerrar previsualización' }).click();
    await expect(modal).not.toBeVisible();

    // Shot 4: Hand.OBJ model with colorful data collage graphic on axis Y
    await page.evaluate(() => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: { getState: () => { clearDecals: () => void } };
      };
      w.__SCULPTURE_STORE__.getState().clearDecals();
    });
    await uploadMeshAndSelectStacked(page, HAND_PATH, 'Hand.OBJ', 'discs');
    await page.evaluate(async () => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: {
          getState: () => {
            setParam: (k: string, v: unknown) => void;
            runSlice: () => Promise<void>;
          };
        };
      };
      const st = w.__SCULPTURE_STORE__.getState();
      st.setParam('plates', 14);
      st.setParam('gap', 2);
      st.setParam('axis', 'y');
      await st.runSlice();
    });
    await expect(page.getByTestId('viewport-loading-overlay')).not.toBeVisible({
      timeout: 20_000,
    });
    await assertCleanAxisYSlice(page);
    await page.setInputFiles('[data-testid="decal-file-input"]', {
      name: 'collage_data.png',
      mimeType: 'image/png',
      buffer: collageBuf,
    });
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: { getState: () => { decals: unknown[] } };
      };
      return w.__SCULPTURE_STORE__.getState().decals.length === 1;
    });
    await page.evaluate(() => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: {
          getState: () => {
            decals: Array<{ id: string }>;
            sliceResult: { scaledBounds: [[number, number], [number, number]] } | null;
            updateDecal: (id: string, patch: Record<string, unknown>) => void;
            setCameraPreset: (p: string) => void;
          };
        };
      };
      const st = w.__SCULPTURE_STORE__.getState();
      const d = st.decals[0];
      if (d && st.sliceResult) {
        const [[minX], [maxX]] = st.sliceResult.scaledBounds;
        const wMm = Number(((maxX - minX) * 0.85).toFixed(2));
        st.updateDecal(d.id, { widthMm: wMm, heightMm: wMm });
      }
      st.setCameraPreset('iso');
    });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(outDir, 'shot_04_hand_collage_3d.png'),
    });

    expect(errors).toEqual([]);
  });

  test('3. Drags center Move Gizmo and corner scale handle smoothly in Front view', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await page.route('**/favicon.ico', (route) =>
      route.fulfill({ status: 204, body: '' })
    );

    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto('/');
    await uploadMeshAndSelectStacked(page, HAND_PATH, 'Hand.OBJ', 'discs');

    await page.evaluate(async () => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: {
          getState: () => {
            setParam: (k: string, v: unknown) => void;
            runSlice: () => Promise<void>;
          };
        };
      };
      const st = w.__SCULPTURE_STORE__.getState();
      st.setParam('plates', 12);
      st.setParam('gap', 2);
      st.setParam('axis', 'y');
      await st.runSlice();
    });
    await expect(page.getByTestId('viewport-loading-overlay')).not.toBeVisible({
      timeout: 15_000,
    });
    await assertCleanAxisYSlice(page);

    const pngBuf = await buildDataCollagePngBuffer(page);
    await page.setInputFiles('[data-testid="decal-file-input"]', {
      name: 'collage_data.png',
      mimeType: 'image/png',
      buffer: pngBuf,
    });

    await page.waitForFunction(() => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: { getState: () => { decals: unknown[] } };
      };
      return w.__SCULPTURE_STORE__.getState().decals.length === 1;
    });

    await page.evaluate(() => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: {
          getState: () => {
            setCameraPreset: (p: string) => void;
          };
        };
      };
      w.__SCULPTURE_STORE__.getState().setCameraPreset('front');
    });
    await page.waitForTimeout(450);

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const getEditorScreenPoint = async (offsetX: number, offsetZ: number) => {
      return page.evaluate(
        ({ ox, oz, w, h, bx, by }) => {
          const win = window as unknown as {
            __SCULPTURE_STORE__: {
              getState: () => {
                decals: Array<{
                  centerX: number;
                  centerZ: number;
                  widthMm: number;
                  heightMm: number;
                }>;
                params: { thickness: number };
                sliceResult: {
                  zPositions: number[];
                  scaledBounds: [[number, number], [number, number]];
                  scaledHeight: number;
                };
              };
            };
          };
          const st = win.__SCULPTURE_STORE__.getState();
          const d = st.decals[0];
          const sr = st.sliceResult;
          const [[minX, minY], [maxX, maxY]] = sr.scaledBounds;
          const span = Math.max(maxX - minX, maxY - minY, sr.scaledHeight, 50);
          const dist = span * 1.65;
          const editorY = sr.zPositions[0] - st.params.thickness * 0.5 - 4.0;
          const dz = dist + editorY;
          const halfVisZ = dz * Math.tan((42 * Math.PI) / 360);
          const halfVisX = halfVisZ * (w / h);
          const wx = d.centerX + ox * d.widthMm * 0.5;
          const wz = d.centerZ + oz * d.heightMm * 0.5;
          return {
            x: bx + w * (0.5 + wx / (2 * halfVisX)),
            y: by + h * (0.5 - wz / (2 * halfVisZ)),
            decal: { ...d },
          };
        },
        {
          ox: offsetX,
          oz: offsetZ,
          w: box.width,
          h: box.height,
          bx: box.x,
          by: box.y,
        }
      );
    };

    const getSelectionState = async () =>
      page.evaluate(() => {
        const w = window as unknown as {
          __SCULPTURE_STORE__: {
            getState: () => {
              selectedDecalId: string | null;
              decals: Array<{ id: string }>;
            };
          };
        };
        const st = w.__SCULPTURE_STORE__.getState();
        return {
          selectedDecalId: st.selectedDecalId,
          firstDecalId: st.decals[0]?.id ?? null,
        };
      });

    // 1) Click outside image on canvas -> hides gizmos (selectedDecalId becomes null)
    const initialSel = await getSelectionState();
    expect(initialSel.selectedDecalId).toBe(initialSel.firstDecalId);

    const outsidePt = await getEditorScreenPoint(2.2, 0.5);
    await page.mouse.click(outsidePt.x, outsidePt.y);
    await page.waitForTimeout(100);
    expect((await getSelectionState()).selectedDecalId).toBeNull();

    // 2) Drag across empty canvas (> 20px orbit) while deselected -> does not accidentally select
    await page.mouse.move(outsidePt.x, outsidePt.y);
    await page.mouse.down();
    await page.mouse.move(outsidePt.x + 35, outsidePt.y - 25, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect((await getSelectionState()).selectedDecalId).toBeNull();

    // Return to Front view and click directly on the image -> brings gizmos back
    await page.evaluate(() => {
      const w = window as unknown as {
        __SCULPTURE_STORE__: {
          getState: () => { setCameraPreset: (p: string) => void };
        };
      };
      w.__SCULPTURE_STORE__.getState().setCameraPreset('front');
    });
    await page.waitForTimeout(350);

    const selectPt = await getEditorScreenPoint(0, 0);
    await page.mouse.click(selectPt.x, selectPt.y);
    await page.waitForTimeout(150);
    const reselected = await getSelectionState();
    expect(reselected.selectedDecalId).toBe(reselected.firstDecalId);

    // 3) Drag the dedicated center Move Gizmo right and up
    const centerPt = await getEditorScreenPoint(0, 0);
    await page.mouse.move(centerPt.x, centerPt.y);
    await page.mouse.down();
    await page.mouse.move(centerPt.x + 55, centerPt.y - 35, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const afterMove = await getEditorScreenPoint(0, 0);
    expect(afterMove.decal.centerX).toBeGreaterThan(centerPt.decal.centerX + 2);
    expect(afterMove.decal.centerZ).toBeGreaterThan(centerPt.decal.centerZ + 2);

    // 4) Drag top-right corner scale handle outward to enlarge uniformly
    const trCorner = await getEditorScreenPoint(1, 1);
    await page.mouse.move(trCorner.x, trCorner.y);
    await page.mouse.down();
    await page.mouse.move(trCorner.x + 35, trCorner.y - 35, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const afterScale = await getEditorScreenPoint(0, 0);
    expect(afterScale.decal.widthMm).toBeGreaterThan(afterMove.decal.widthMm + 2);
    expect(afterScale.decal.heightMm).toBeGreaterThan(afterMove.decal.heightMm + 2);

    expect(errors).toEqual([]);
  });
});
