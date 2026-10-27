import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/test_l_block.obj', import.meta.url)
);

async function loadMeshAndSlice(
  page: Page,
  options: { technique?: string; joint?: string } = {}
) {
  await page.setInputFiles('[data-testid="mesh-file-input"]', FIXTURE_PATH);
  await expect(page.getByText('test_l_block.obj', { exact: true })).toBeVisible({
    timeout: 10_000,
  });

  const technique = options.technique ?? 'stacked';
  const joint = options.joint ?? (technique === 'waffle' ? 'slots' : 'discs');

  const techSelect = page.locator('[data-testid="select-technique"]');
  if ((await techSelect.inputValue()) !== technique) {
    await techSelect.selectOption(technique);
  }

  const jointSelect = page.locator('[data-testid="select-joint"]');
  if (
    technique !== 'waffle' &&
    (await jointSelect.isVisible()) &&
    (await jointSelect.inputValue()) !== joint
  ) {
    await jointSelect.selectOption(joint);
  }

  if (technique === 'waffle') {
    await expect(page.locator('[data-testid="waffle-navigator-hud"]')).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(page.locator('text=Piso 0')).toBeVisible({ timeout: 10_000 });
  }
}

test.describe('Sculpture Studio E2E Acceptance Suite', () => {
  test('1. Total offline loading: loads mesh and slices without any external network requests', async ({
    page,
    context,
  }) => {
    const externalRequests: string[] = [];
    page.on('requestfailed', (req) => {
      externalRequests.push(req.url());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);

    await loadMeshAndSlice(page);

    const nonLocalFailed = externalRequests.filter(
      (url) => !url.includes('localhost') && !url.includes('127.0.0.1')
    );
    expect(nonLocalFailed.length).toBe(0);
  });

  test('2. Add discs mode: 100px camera orbit does not place discs, placing discs works on static click', async ({
    page,
  }) => {
    await page.goto('/');
    await loadMeshAndSlice(page);

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // En modo "Seleccionar", hacer clic en el canvas no debe crear discos
    await page.mouse.click(centerX, centerY);
    await expect(page.getByTestId('total-discs-count')).toHaveText('0');

    // Activar modo "Poner discos"
    await page.click('[data-testid="toggle-add-discs"]');

    // Test obligatorio de órbita (#1): arrastrar 100px sobre el canvas
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 100, centerY, { steps: 5 });
    await page.mouse.up();

    // Comprobar 0 discos y 0 alertas de error
    await expect(page.getByTestId('total-discs-count')).toHaveText('0');
    await expect(page.locator('[role="alert"]')).not.toBeVisible();

    // Cambiar a vista Superior ('7')
    await page.keyboard.press('7');

    // Clic corto estático en la placa (en Piso 0 donde ambas placas cubren la base sólida completa)
    await page.mouse.click(centerX, centerY);
    await expect(page.getByText('Disco #1 Ø')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('total-discs-count')).toHaveText('2');
  });

  test('3. Safe keyboard shortcuts and input focus isolation', async ({
    page,
  }) => {
    await page.goto('/');
    await loadMeshAndSlice(page);

    // Fuera de inputs: 'w' avanza piso
    await page.keyboard.press('w');
    await expect(page.locator('text=Piso 1')).toBeVisible();

    // 's' retrocede piso
    await page.keyboard.press('s');
    await expect(page.locator('text=Piso 0')).toBeVisible();

    // Foco en input de Diámetro
    const diameterInput = page.locator('input[aria-label="Diámetro"]');
    await diameterInput.focus();
    await diameterInput.fill('15');

    // Atajos dentro de input no deben alterar piso ni borrar discos
    await page.keyboard.press('w');
    await page.keyboard.press('s');
    await page.keyboard.press('7');
    await page.keyboard.press('1');

    await expect(page.locator('text=Piso 0')).toBeVisible();
  });

  test('4. Autosave banner displays on startup without automatic state overwrite', async ({
    page,
  }) => {
    await page.goto('/');
    await loadMeshAndSlice(page);

    // Colocar un disco
    await page.click('[data-testid="toggle-add-discs"]');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    // Recargar página
    await page.reload();

    // Banner de autosave debe estar visible
    await expect(
      page.locator('[data-testid="autosave-banner"]')
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('text=Sesión anterior encontrada')
    ).toBeVisible();

    // Restaurar sesión
    await page.click('button:has-text("Restaurar sesión")');
    await expect(page.locator('text=Piso 0')).toBeVisible({ timeout: 5_000 });
  });

  test('5. Export and download DXF AC1015 and Sheet Preview Modal', async ({
    page,
  }) => {
    await page.goto('/');
    await loadMeshAndSlice(page);

    // Abrir modal de corte
    await page.click('button:has-text("Vista previa y exportar")');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('text=Hoja 1')).toBeVisible();

    // Descarga de DXF
    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("Exportar esta hoja (.dxf)")');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.dxf');

    // Verificar contenido DXF
    const stream = await download.createReadStream();
    if (stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const dxfContent = Buffer.concat(chunks).toString('utf-8');
      expect(dxfContent).toContain('AC1015');
      expect(dxfContent).toContain('$INSUNITS');
    }
  });

  test('6. Inspector section order, labels Alto (Z)/Ancho (X)/Largo (Y), Advanced summary and disabled options (A-1 to A-6)', async ({
    page,
  }) => {
    await page.goto('/');

    // A-1: Order of h2 headings (Material swapped to top)
    const headings = page.locator(
      'aside[aria-label="Inspector de parámetros y exportación"] h2'
    );
    await expect(headings).toHaveText([
      'Material',
      'Modelo',
      'Técnica de construcción',
      'Resultado',
    ]);

    // A-6: Dimension labels
    await expect(page.locator('text=Alto (Z)')).toBeVisible();
    await expect(page.locator('text=Ancho (X)')).toBeVisible();
    await expect(page.locator('text=Largo (Y)')).toBeVisible();

    // A-4: Lock button disabled with title
    const lockBtn = page.locator(
      'button[title="Escala no uniforme: no disponible"]'
    );
    await expect(lockBtn).toBeVisible();
    await expect(lockBtn).toBeDisabled();

    // Material is in a collapsible dropdown (initially closed)
    await expect(page.locator('[data-testid="toggle-material-collapse"]')).toBeVisible();
    await expect(page.getByLabel('Grosor de placa')).not.toBeVisible();

    // Open Material dropdown
    await page.click('[data-testid="toggle-material-collapse"]');
    await expect(page.getByLabel('Grosor de placa')).toBeVisible();

    // A-5: Avanzado collapsible and scrapTag checkbox visible inside Material
    await expect(page.locator('button:has-text("Avanzado")')).toBeVisible();
    await expect(
      page.locator('text=Margen 10 · Sep. 5 · Kerf 0.15 mm')
    ).not.toBeVisible();
    await expect(
      page.locator('text=Etiquetar sobrante aprovechable')
    ).toBeVisible();

    // Before technique selection: subcontrols are hidden
    await expect(page.locator('text=Eje de corte')).not.toBeVisible();
    await expect(page.locator('text=Número de placas')).not.toBeVisible();
    await expect(page.locator('[data-testid="select-joint"]')).not.toBeVisible();

    // In Phase 9: Waffle technique is enabled and selectable
    const waffleOption = page.locator('option[value="waffle"]');
    await expect(waffleOption).toBeEnabled();
    await expect(waffleOption).toHaveText(/waffle/i);

    // Select stacked technique
    await page.selectOption('[data-testid="select-technique"]', 'stacked');

    // Subcontrols under technique appear
    await expect(page.locator('text=Eje de corte')).toBeVisible();
    await expect(page.locator('text=Número de placas')).toBeVisible();
    await expect(page.locator('[data-testid="select-joint"]')).toBeVisible();

    // Before joint selection: disc options are hidden
    await expect(page.locator('text=Diámetro por defecto')).not.toBeVisible();

    // Check joint disabled options
    const rodOption = page.locator('option[value="rod"]');
    await expect(rodOption).toBeDisabled();
    await expect(rodOption).toHaveText(/varilla.*\(próximamente\)/i);

    // Select discs joint -> default diameter appears
    await page.selectOption('[data-testid="select-joint"]', 'discs');
    await expect(page.locator('text=Diámetro por defecto')).toBeVisible();

    // Switch to none joint -> default diameter input should not exist and pegado text is visible
    await page.selectOption('[data-testid="select-joint"]', 'none');
    await expect(page.locator('text=Diámetro por defecto')).not.toBeVisible();
    await expect(page.locator('text=Las placas se apilan pegadas')).toBeVisible();
  });

  test('7. Joint change with placed discs: confirmation dialog and undo/redo boundary', async ({
    page,
  }) => {
    await page.goto('/');
    await loadMeshAndSlice(page);

    // Enable add discs mode
    await page.click('[data-testid="toggle-add-discs"]');

    // Switch to top view ('7')
    await page.keyboard.press('7');

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(page.getByTestId('total-discs-count')).toHaveText('2');

    // Attempt to switch to 'none' and dismiss confirmation
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.selectOption('[data-testid="select-joint"]', 'none');

    // Joint stays at 'discs' and discs count remains 2
    await expect(page.locator('[data-testid="select-joint"]')).toHaveValue('discs');
    await expect(page.getByTestId('total-discs-count')).toHaveText('2');

    // Attempt to switch to 'none' and accept confirmation
    page.once('dialog', (dialog) => dialog.accept());
    await page.selectOption('[data-testid="select-joint"]', 'none');

    // With 'none', toggle-add-discs and stat-discs-total should not be visible
    await expect(page.locator('[data-testid="select-joint"]')).toHaveValue('none');
    await expect(page.locator('[data-testid="toggle-add-discs"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="stat-discs-total"]')).not.toBeVisible();

    // Ctrl+Z should do nothing
    await page.keyboard.press('Control+z');

    // Switch back to 'discs'
    await page.selectOption('[data-testid="select-joint"]', 'discs');
    await expect(page.getByTestId('total-discs-count')).toHaveText('0');

    // Undo button in dock is disabled
    const undoButton = page.locator('button[aria-label="Deshacer"]');
    await expect(undoButton).toBeDisabled();
  });

  test('8. Size ↔ plates coupling, local draft, and goal preservation', async ({
    page,
  }) => {
    await page.goto('/');
    await loadMeshAndSlice(page);

    const altoInput = page.getByTestId('dim-alto');
    const platesInput = page.getByLabel('Número de placas');

    // Initial plates count
    await expect(platesInput).toHaveValue('10');

    // Write in dim-alto without pressing Enter
    await altoInput.focus();
    await altoInput.fill('80');

    // Slicing/plates should not change yet
    await expect(platesInput).toHaveValue('10');
    await expect(page.locator('text=/Objetivo: /')).not.toBeVisible();

    // Press Enter to commit
    await altoInput.press('Enter');

    // Plates should update to new count
    await expect(page.locator('text=/Objetivo: 80.0 mm/')).toBeVisible();
    const newPlates = await platesInput.inputValue();
    expect(Number(newPlates)).not.toBe(10);

    // Change Grosor de placa: open Material dropdown first
    await page.click('[data-testid="toggle-material-collapse"]');
    const thicknessInput = page.getByLabel('Grosor de placa');
    await thicknessInput.focus();
    await thicknessInput.fill('6');
    await thicknessInput.press('Enter');

    // Goal is still preserved
    await expect(page.locator('text=/Objetivo: 80.0 mm/')).toBeVisible();

    // Editing plates clears the goal and auto-slices
    await platesInput.focus();
    await platesInput.fill('15');
    await platesInput.press('Enter');

    await expect(page.locator('text=/Objetivo: /')).not.toBeVisible();
    await expect(page.locator('text=/15 placas/')).toBeVisible({ timeout: 5_000 });

    // Pressing ArrowUp on platesInput immediately steps to 16 and re-slices
    await platesInput.press('ArrowUp');
    await expect(platesInput).toHaveValue('16');
    await expect(page.locator('text=/16 placas/')).toBeVisible({ timeout: 5_000 });
  });

  test('9. gap = 0 exports without discs and DXF has no circles', async ({
    page,
  }) => {
    await page.goto('/');
    await loadMeshAndSlice(page, { technique: 'stacked', joint: 'none' });

    // Slicing occurs automatically on joint change, so no "Aplicar corte" button needed
    await expect(page.locator('text=Piso 0')).toBeVisible();

    // Click 'Vista previa y exportar'
    await page.click('button:has-text("Vista previa y exportar")');
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Only Placas tabs, no Discos tab
    await expect(page.locator('button[role="tab"]:has-text("Discos")')).not.toBeVisible();

    // Download DXF
    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("Exportar esta hoja (.dxf)")');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.dxf');

    const stream = await download.createReadStream();
    if (stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const dxfContent = Buffer.concat(chunks).toString('utf-8');
      expect(dxfContent).toContain('CORTE');
      expect(dxfContent).not.toContain('\nCIRCLE\n');
    }
  });

  test('10. Full Waffle flow and DXF export (E2E 10)', async ({ page }) => {
    await page.goto('/');
    await loadMeshAndSlice(page, { technique: 'waffle' });

    // In Waffle mode, joint is implicit slots (redundant disabled selector is absent)
    await expect(page.locator('[data-testid="select-joint"]')).not.toBeVisible();

    // FloorNavigatorHUD & DiscsDockHUD are absent; WaffleNavigatorHUD is visible
    await expect(page.locator('aside[aria-label="Navegador de pisos"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="toggle-add-discs"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="waffle-navigator-hud"]')).toBeVisible();

    // Change 1st Axis count to 10 and slot clearance to 0.15 mm
    const axis1Input = page.locator('[data-testid="input-waffle-axis1"]');
    await axis1Input.focus();
    await axis1Input.fill('10');
    await axis1Input.press('Enter');

    const clearanceInput = page.locator('[data-testid="input-waffle-clearance"]');
    await clearanceInput.focus();
    await clearanceInput.fill('0.15');
    await clearanceInput.press('Enter');

    // Open "Vista previa y exportar"
    await page.click('button:has-text("Vista previa y exportar")');
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Download DXF and verify geometry: LWPOLYLINE in CORTE, X/Y labels in GRABADO, zero CIRCLE entities
    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("Exportar esta hoja (.dxf)")');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.dxf');

    const stream = await download.createReadStream();
    if (stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const dxfContent = Buffer.concat(chunks).toString('utf-8');
      expect(dxfContent).toContain('CORTE');
      expect(dxfContent).toContain('GRABADO');
      expect(dxfContent).toContain('LWPOLYLINE');
      expect(dxfContent).toMatch(/X1|Y1/);
      expect(dxfContent).not.toContain('\nCIRCLE\n');
    }
  });

  test('11. Confirmation when switching technique with discs placed (E2E 11)', async ({
    page,
  }) => {
    await page.goto('/');
    await loadMeshAndSlice(page, { technique: 'stacked', joint: 'discs' });

    // Switch to top view ('7') and add discs mode
    await page.click('[data-testid="toggle-add-discs"]');
    await page.keyboard.press('7');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(page.getByTestId('total-discs-count')).toHaveText('2');

    // Switch to waffle and cancel confirmation -> stays in stacked with discs intact
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Cambiar la técnica a Waffle eliminará los 2 discos colocados');
      await dialog.dismiss();
    });
    await page.selectOption('[data-testid="select-technique"]', 'waffle');
    await expect(page.locator('[data-testid="select-technique"]')).toHaveValue('stacked');
    await expect(page.getByTestId('total-discs-count')).toHaveText('2');

    // Switch to waffle and confirm -> switches to waffle, discs cleared
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Cambiar la técnica a Waffle eliminará los 2 discos colocados');
      await dialog.accept();
    });
    await page.selectOption('[data-testid="select-technique"]', 'waffle');
    await expect(page.locator('[data-testid="select-technique"]')).toHaveValue('waffle');
    await expect(page.locator('[data-testid="waffle-navigator-hud"]')).toBeVisible();

    // Switch back to stacked -> select discs, discs are 0, undo is disabled
    await page.selectOption('[data-testid="select-technique"]', 'stacked');
    await page.selectOption('[data-testid="select-joint"]', 'discs');
    await expect(page.getByTestId('total-discs-count')).toHaveText('0');
    const undoButton = page.locator('button[aria-label="Deshacer"]');
    await expect(undoButton).toBeDisabled();
  });

  test('12. Warnings panel and slot calibration comb sheet (E2E 12)', async ({
    page,
  }) => {
    await page.goto('/');
    await loadMeshAndSlice(page, { technique: 'waffle' });

    // Select distance method and set separation to 6.0 mm on test_l_block, which severs corner arm and triggers W4 warning
    await page.selectOption('[data-testid="select-waffle-method"]', 'distance');
    const distInput = page.locator('[data-testid="input-waffle-axis1"]');
    await distInput.focus();
    await distInput.fill('6');
    await distInput.press('Enter');

    // WaffleWarningsPanel appears with warning W4
    const warningsPanel = page.locator('[data-testid="waffle-warnings-panel"]');
    await expect(warningsPanel).toBeVisible({ timeout: 5_000 });
    const w4Button = page.locator('[data-testid="waffle-warning-W4"]').first();
    await expect(w4Button).toBeVisible();

    // Click warning: selects the affected piece in WaffleNavigatorHUD
    await w4Button.click();
    const pieceSelect = page.locator('[data-testid="waffle-piece-select"]');
    await expect(pieceSelect).not.toHaveValue('');

    // Click "Hoja de prueba de ranuras" -> opens SheetPreviewModal with calibration combs
    const calibBtn = page.locator('[data-testid="btn-slot-calibration-sheet"]');
    await expect(calibBtn).toBeVisible();
    await calibBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('120 × 80 mm');
    await expect(dialog).toContainText('Peine A');
  });
});
