// End-to-end test of the builder against a running stack (start-local.ps1 -WithBuilder).
// Needs Playwright: npm i -D playwright && npx playwright install chromium. Run: FORGE_URL=http://127.0.0.1:8140/ GT_PASSWORD=... node e2e/builder.e2e.cjs
// It creates, generates and then deletes a 'Maintenance Crew' pair through the UI (it writes to the configured app).
// UI Forge builder end-to-end: home, design (drag/drop, inspector, undo), preview, code, wizard, save, generate.
const { chromium } = require('playwright');
const URL = process.env.FORGE_URL || 'http://127.0.0.1:8140/';
const out = (n) => `${process.env.SHOTS || __dirname}/forge-${n}.png`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const results = [];
  const step = async (name, fn) => {
    try { await fn(); results.push(['ok', name]); }
    catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); await page.screenshot({ path: out('fail-' + name.replace(/\W+/g, '_')) }); }
  };

  await step('home lists displays', async () => {
    await page.goto(URL);
    await page.getByText('Design screens. Generate the code').waitFor();
    await page.getByRole('heading', { name: 'Generation Assets' }).first().waitFor();
    await page.screenshot({ path: out('home') });
  });

  await step('open entry display and drag a control in', async () => {
    await page.locator('.dcard', { hasText: 'assets.generation-asset' }).filter({ hasNotText: 'assets.generation-assets' }).first().click();
    await page.locator('.form-canvas').waitFor();
    const before = await page.locator('.fitem').count();
    const src = page.locator('.tb-item', { hasText: 'Currency' });
    const target = page.locator('.fsec').first().locator('.fdrop-end');
    await src.dragTo(target);
    await page.waitForFunction((n) => document.querySelectorAll('.fitem').length === n + 1, before);
    await page.locator('.inspector', { hasText: 'Form field' }).waitFor();
    await page.screenshot({ path: out('design-entry') });
  });

  await step('inspector edits label, undo and redo', async () => {
    const label = page.locator('.inspector .prow', { hasText: /^Label/ }).last().locator('input');
    await label.fill('Insurance value');
    await label.press('Enter');
    await page.locator('.fitem.sel', { hasText: 'Insurance value' }).waitFor();
    await page.locator('.center').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.locator('.fitem', { hasText: 'Insurance value' }).waitFor({ state: 'detached' });
    await page.keyboard.press('Control+y');
    await page.locator('.fitem', { hasText: 'Insurance value' }).waitFor();
  });

  await step('click-to-add and resize span', async () => {
    await page.locator('.fitem', { hasText: 'Insurance value' }).click();
    await page.locator('.tb-item', { hasText: 'Switch' }).click();
    await page.locator('.fitem.sel', { hasText: 'Enabled' }).waitFor();
    await page.locator('.inspector .seg button', { hasText: '2' }).first().click();
    await page.waitForFunction(() => document.querySelector('.fitem.sel')?.style.gridColumn === 'span 2');
  });

  await step('issues panel validates', async () => {
    await page.locator('.issue-btn').click();
    await page.locator('.issues').waitFor();
    await page.screenshot({ path: out('issues') });
    await page.locator('.issues .btn[title=Close]').click();
  });

  await step('preview renders the real form', async () => {
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.locator('.pv-frame').waitFor();
    await page.locator('.pv-frame').getByText('Insurance value').waitFor({ timeout: 15000 });
    await page.screenshot({ path: out('preview-entry') });
  });

  await step('code view shows generated + developer files', async () => {
    await page.getByRole('tab', { name: 'Code' }).click();
    await page.locator('.cv-file').first().waitFor();
    await page.locator('.cv-file', { hasText: '.config.generated.ts' }).first().click();
    await page.locator('.cv-head', { hasText: 'config.generated.ts' }).waitFor();
    await page.locator('.cv-ok').waitFor();
    await page.locator('.cv-file', { hasText: '.hooks.ts' }).first().click();
    await page.locator('.cv-head .badge', { hasText: 'yours' }).waitFor();
    await page.screenshot({ path: out('code') });
  });

  await step('discard edits', async () => {
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.getByText('saved', { exact: true }).waitFor();
  });

  await step('summary display: column drag and preview grid', async () => {
    await page.locator('.brand').click();
    await page.locator('.dcard', { hasText: 'assets.generation-assets' }).click();
    await page.locator('.grid-canvas').waitFor();
    await page.locator('.gcol').nth(1).click();
    await page.locator('.inspector', { hasText: 'Grid column' }).waitFor();
    await page.screenshot({ path: out('design-summary') });
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.locator('.pv-frame .ag-row').first().waitFor({ timeout: 15000 });
    await page.screenshot({ path: out('preview-summary') });
  });

  await step('master-slave canvas and preview', async () => {
    await page.locator('.brand').click();
    await page.locator('.dcard', { hasText: 'assets.asset-outages' }).click();
    await page.locator('.ms-canvas').waitFor();
    await page.screenshot({ path: out('design-ms') });
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.locator('.pv-frame .ag-row').first().waitFor({ timeout: 15000 });
    await page.locator('.pv-frame .ag-row').first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: out('preview-ms') });
  });

  await step('wizard creates a summary + entry pair', async () => {
    await page.locator('.brand').click();
    await page.getByRole('button', { name: 'New display' }).first().click();
    await page.locator('.kind-card', { hasText: 'Summary' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Entity name').fill('Maintenance Crew');
    await page.getByLabel('Entity name').press('Tab');
    await page.getByLabel('Module').fill('assets');
    await page.getByLabel('Module').press('Tab');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('.mt-row', { hasText: 'Assets' }).first().click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.screenshot({ path: out('wizard-review') });
    await page.getByRole('button', { name: 'Create display' }).click();
    await page.locator('.doc-title', { hasText: 'Maintenance Crews' }).waitFor();
    await page.locator('.gcol').first().waitFor();
  });

  await step('add search field and save', async () => {
    await page.getByRole('tab', { name: 'Fields' }).click();
    await page.locator('.fl-f', { hasText: 'Name' }).dragTo(page.locator('.search-strip .slot'));
    await page.locator('.schip', { hasText: 'Name' }).waitFor();
    await page.keyboard.press('Control+s');
    await page.getByText('saved', { exact: true }).waitFor();
  });

  await step('generate: plan, apply', async () => {
    await page.getByRole('tab', { name: 'Generate' }).click();
    await page.locator('.plan-head').waitFor({ timeout: 20000 });
    await page.screenshot({ path: out('plan') });
    await page.locator('.chg-row', { hasText: 'maintenance-crew' }).first().click();
    await page.locator('.diff').first().waitFor();
    await page.getByRole('button', { name: 'Apply to project' }).click();
    await page.locator('.gen-result').waitFor({ timeout: 30000 });
    await page.locator('.vbox', { hasText: 'Integration checklist' }).waitFor({ timeout: 30000 });
    await page.screenshot({ path: out('generated'), fullPage: true });
  });

  await step('stage for review writes a README folder', async () => {
    await page.getByRole('button', { name: 'Stage for review' }).click();
    await page.locator('.gen-result.staged').waitFor({ timeout: 30000 });
    if (!(await page.locator('.out.readme').innerText()).includes('## Put it in the project')) throw new Error('no README');
  });

  await step('verify: type-check and API tests from the builder', async () => {
    await page.getByRole('button', { name: 'Type-check app' }).click();
    await page.locator('.vbox', { hasText: 'Type check (tsc)' }).locator('.badge', { hasText: 'passed' }).waitFor({ timeout: 180000 });
    await page.getByRole('button', { name: 'API tests' }).click();
    await page.locator('.vbox', { hasText: 'API tests' }).locator('.badge', { hasText: 'passed' }).waitFor({ timeout: 120000 });
  });

  await step('live API sign-in and registry dry run', async () => {
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.getByRole('radio', { name: 'Live API' }).click();
    await page.getByLabel('Password').fill(process.env.GT_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.locator('.pv-signed').waitFor();
    await page.screenshot({ path: out('preview-live') });
    await page.getByRole('tab', { name: 'Generate' }).click();
    await page.getByRole('button', { name: 'Dry run' }).click();
    await page.locator('.vbox', { hasText: 'Registry' }).waitFor({ timeout: 30000 });
    console.log('registry:', await page.locator('.vbox', { hasText: 'Registry' }).innerText());
  });

  await step('phone preview', async () => {
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.getByRole('radio', { name: 'Phone' }).click();
    await page.locator('.pv-frame').waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: out('preview-phone') });
  });

  await step('cleanup through the UI: delete displays, entity, prune', async () => {
    await page.getByRole('radio', { name: 'Desktop' }).click().catch(() => {});
    await page.locator('.brand').click();
    for (const id of ['assets.maintenance-crews', 'assets.maintenance-crew']) {
      const card = page.locator('.dcard').filter({ has: page.locator('.mono', { hasText: new RegExp('^' + id.replace('.', '\\.') + '$') }) });
      await card.hover();
      await card.locator('.dcard-del').click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await card.waitFor({ state: 'detached' });
    }
    await page.locator('.other.ent', { hasText: 'Maintenance Crew' }).locator('.mini-x').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.locator('.other.ent', { hasText: 'Maintenance Crew' }).waitFor({ state: 'detached' });
    await page.locator('.dcard', { hasText: 'assets.generation-assets' }).click();
    await page.getByRole('tab', { name: 'Generate' }).click();
    await page.locator('.gstep', { hasText: 'Review the plan' }).locator('.tog').click();
    await page.locator('.chg-row', { hasText: 'retire' }).first().waitFor({ timeout: 20000 });
    await page.screenshot({ path: out('prune-plan') });
    await page.getByRole('button', { name: 'Apply to project' }).click();
    await page.locator('.gen-result', { hasText: 'moved aside' }).waitFor({ timeout: 30000 });
  });

  for (const r of results) console.log(r.join('  '));
  const real = errors.filter((e) => !/favicon|401|Failed to load resource/.test(e));
  console.log('console errors:', real.length ? real : 'none');
  await browser.close();
  process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
})();
