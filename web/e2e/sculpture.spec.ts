import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/test_l_block.obj', import.meta.url)
);

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

    await page.setInputFiles('[data-testid="mesh-file-input"]', FIXTURE_PATH);

    await expect(page.locator('text=test_l_block.obj')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('text=Piso 0')).toBeVisible({ timeout: 10_000 });

    const nonLocalFailed = externalRequests.filter(
      (url) => !url.includes('localhost') && !url.includes('127.0.0.1')
    );
    expect(nonLocalFailed.length).toBe(0);
  });

  test('2. Add discs mode: 100px camera orbit does not place discs, placing discs works on static click', async ({
    page,
  }) => {
    await page.goto('/');
    await page.setInputFiles('[data-testid="mesh-file-input"]', FIXTURE_PATH);
    await expect(page.locator('text=Piso 0')).toBeVisible({ timeout: 10_000 });

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
    await page.setInputFiles('[data-testid="mesh-file-input"]', FIXTURE_PATH);
    await expect(page.locator('text=Piso 0')).toBeVisible({ timeout: 10_000 });

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
    await page.setInputFiles('[data-testid="mesh-file-input"]', FIXTURE_PATH);
    await expect(page.locator('text=Piso 0')).toBeVisible({ timeout: 10_000 });

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
    await page.setInputFiles('[data-testid="mesh-file-input"]', FIXTURE_PATH);
    await expect(page.locator('text=Piso 0')).toBeVisible({ timeout: 10_000 });

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
});
