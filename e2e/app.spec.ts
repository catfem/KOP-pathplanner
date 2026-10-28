import { type Page, expect, test } from '@playwright/test';

const FIELD = { length: 16.541, width: 8.069 };
const PAD = 28;

/** Screen position of a field coordinate on the canvas (matches fitView). */
async function fieldPoint(page: Page, x: number, y: number) {
  const box = await page.locator('canvas.field-canvas').boundingBox();
  if (!box) throw new Error('canvas not visible');
  const scale = Math.min((box.width - 2 * PAD) / FIELD.length, (box.height - 2 * PAD) / FIELD.width);
  const ox = (box.width - FIELD.length * scale) / 2;
  const oy = (box.height + FIELD.width * scale) / 2;
  return { x: box.x + ox + x * scale, y: box.y + oy - y * scale };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
}

const pointCount = (page: Page) => page.locator('.auto-list li.active .auto-meta');
const xField = (page: Page) => page.getByLabel('X', { exact: true });
const xValue = async (page: Page) => Number(await xField(page).inputValue());

/** Waits (retrying) until the selected point's X field shows `value`. */
async function expectX(page: Page, value: number, precision = 2) {
  await expect.poll(() => xValue(page)).toBeCloseTo(value, precision);
}

let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  await page.goto('/');
  // First visit opens the help dialog.
  await expect(page.getByRole('dialog', { name: 'KOP Path Planner' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test.afterEach(() => {
  expect(consoleErrors, 'console errors').toEqual([]);
});

test('edits points with drag, undo/redo, add, nudge, delete and insert', async ({ page }) => {
  // Point 2 of the example sits at (5.9, 2.5).
  await drag(page, await fieldPoint(page, 5.9, 2.5), await fieldPoint(page, 6.2, 3.0));
  await expect(page.locator('.point-title')).toContainText('Point 2');
  await expectX(page, 6.2, 1);

  await page.keyboard.press('Control+z');
  await expectX(page, 5.9);
  await page.keyboard.press('Control+Shift+z');
  await expectX(page, 6.2, 1);

  await page.keyboard.press('a');
  const add = await fieldPoint(page, 9, 4);
  await page.mouse.click(add.x, add.y);
  await expect(pointCount(page)).toHaveText('5 pts');

  await page.keyboard.press('v');
  await expectX(page, 9, 1);
  const before = await xValue(page);
  await page.keyboard.press('ArrowRight');
  await expectX(page, before + 0.05, 6);
  await page.keyboard.press('Delete');
  await expect(pointCount(page)).toHaveText('4 pts');

  // Double-click on the first curve to insert a point (cubic from (2.6, 2.2) to (6.2, 3.0)).
  const p0 = { x: 2.6, y: 2.2 };
  const p1 = { x: 3.8, y: 2.2 };
  const p2 = { x: 5.2, y: 3.0 };
  const p3 = { x: 6.2, y: 3.0 };
  const t = 0.5;
  const u = 1 - t;
  const bx = u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x;
  const by = u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y;
  const mid = await fieldPoint(page, bx, by);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.dblclick(mid.x, mid.y);
  await expect(pointCount(page)).toHaveText('5 pts');
  await page.keyboard.press('Control+z');
  await expect(pointCount(page)).toHaveText('4 pts');
});

test('Escape cancels a drag and a plain click adds no undo step', async ({ page }) => {
  const start = await fieldPoint(page, 5.9, 2.5);
  await page.mouse.click(start.x, start.y);
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const end = await fieldPoint(page, 7, 4);
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await expect.poll(() => xValue(page)).toBeGreaterThan(6.5);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expectX(page, 5.9);
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
});

test('stop points, reverse and undo while a checkbox has focus', async ({ page }) => {
  const p = await fieldPoint(page, 5.9, 2.5);
  await page.mouse.click(p.x, p.y);
  await page.getByRole('radio', { name: 'Stop here' }).click();
  await page.getByLabel('Drive backwards to the next stop').check();
  await expect(page.locator('.point-title')).toContainText('stop');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.point-title')).toContainText('smooth');
});

test('actions register named commands and persist across reloads', async ({ page }) => {
  const p = await fieldPoint(page, 2.6, 2.2);
  await page.mouse.click(p.x, p.y);
  await page.getByPlaceholder('Command name, e.g. Shoot').fill('Climb');
  await page.getByPlaceholder('Command name, e.g. Shoot').press('Enter');
  await expect(page.locator('.command-list .command-name', { hasText: 'Climb' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.command-list .command-name', { hasText: 'Climb' })).toBeVisible();
});

test('deleting an auto asks first, and undo brings it back', async ({ page }) => {
  const autos = page.locator('.auto-list li');
  await expect(autos).toHaveCount(2);
  const deleteButton = autos.first().getByRole('button', { name: 'Delete' });
  await autos.first().hover();
  await deleteButton.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(autos).toHaveCount(2);

  await autos.first().hover();
  await deleteButton.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete auto' }).click();
  await expect(autos).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(autos).toHaveCount(2);
});

test('code dialog: switch language, download the zip, keep focus inside, Escape closes', async ({ page }) => {
  const open = page.getByRole('button', { name: /Generate code/ });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Generated robot code' });
  await expect(dialog.getByRole('button', { name: /KopAutos\.java/ })).toBeVisible();
  await dialog.getByRole('radio', { name: 'Python' }).click();
  await expect(dialog.getByRole('button', { name: /autos\.py/ })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: /Download all/ }).click()]);
  expect(download.suggestedFilename()).toBe('kop-autos-python.zip');

  // Tab never leaves the dialog.
  for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('HUB aiming, bumper against the HUB and bumper placement readouts', async ({ page }) => {
  const end = await fieldPoint(page, 3.1, 2.7);
  await page.mouse.click(end.x, end.y);
  await expect(page.locator('.point-title')).toContainText('Point 4');
  const readout = page.locator('.readout');
  await expect(readout).toContainText('HUB center');
  await page.getByRole('button', { name: /bumper against the HUB/ }).click();
  await expect(readout).toContainText(/Front bumper to HUB0\.0\d m/);

  await page.getByRole('button', { name: 'Previous point' }).click();
  await page.getByRole('button', { name: 'Previous point' }).click();
  await page.getByRole('button', { name: 'Previous point' }).click();
  const placement = page.locator('.section', { hasText: 'Bumper position' });
  await expect(placement).toContainText('alliance wall');
  await expect(placement).toContainText('guardrail');
});

test('NEO drivetrain preset sets motor, controller and encoders', async ({ page }) => {
  await page.getByRole('tab', { name: 'Robot' }).click();
  await page.getByLabel('Quick setup').selectOption('neo-sparkmax');
  await expect(page.getByLabel('Motor', { exact: true })).toHaveValue('NEO');
  await expect(page.getByLabel('Controllers')).toHaveValue('can-sparkmax-brushless');
  await expect(page.getByLabel('Encoders')).toHaveValue('integrated');
});

test('tabs work with the keyboard', async ({ page }) => {
  await page.getByRole('tab', { name: 'Point' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Auto' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Simulate' })).toBeFocused();
});

test('side panels collapse to give the field more room', async ({ page }) => {
  const canvas = page.locator('canvas.field-canvas');
  const before = (await canvas.boundingBox())!.width;
  await page.getByRole('button', { name: 'Hide autos list' }).click();
  await page.getByRole('button', { name: 'Hide inspector' }).click();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(before + 400);
});

test('invalid numbers are flagged and do not change the robot', async ({ page }) => {
  await page.getByRole('tab', { name: 'Robot' }).click();
  const track = page.getByLabel('Track width (effective)');
  await track.fill('');
  await expect(page.locator('.field-error').first()).toContainText('Enter a number');
  await track.blur();
  await expect(track).toHaveValue('0.56');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('has no horizontal overflow', async ({ page }) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
