// Our cloud Chromium, not the user's browser. Only localhost is opened.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  fs.mkdirSync('docs/screenshots', { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const failures = []; page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  const base = process.env.CONTROL_PANEL_URL || 'http://127.0.0.1:4317';
  try {
    await page.goto(base); await page.waitForFunction(() => document.querySelector('#stream-state').textContent === '实时同步');
    assert.equal(await page.locator('.role-card').count(), 4);
    assert.equal(await page.locator('#run-button').isDisabled(), true);
    await page.screenshot({ path: 'docs/screenshots/01-disconnected-desktop.png', fullPage: true });
    // Dismiss and reopen; verify the modal does not mutate history or run state.
    const initialUrl = page.url(); await page.click('#demo-top'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#demo-dialog').evaluate(d => d.open), false); assert.equal(page.url(), initialUrl);
    await page.click('#demo-top'); await page.click('[data-scenario="success"]');
    await page.waitForFunction(() => document.querySelector('#run-status').textContent.includes('已完成'));
    assert.equal(await page.locator('#demo-banner').isVisible(), true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'docs/screenshots/02-demo-completed-desktop.png', fullPage: true });
    await page.click('[data-filter="review"]'); assert.match(await page.locator('#event-list').innerText(), /审核|审查/);
    await page.click('[data-filter="all"]');
    // Repeated error and approval flows must pause, not look successful.
    for (const scenario of ['repeated-error', 'approval']) {
      await page.click('#demo-top'); await page.click(`[data-scenario="${scenario}"]`);
      await page.waitForFunction(() => document.querySelector('#run-status').textContent.includes('暂停'));
      assert.equal(await page.locator('#interrupt-button').isVisible(), true);
      await page.screenshot({ path: `docs/screenshots/03-${scenario}.png`, fullPage: true });
      await page.click('#interrupt-button');
      await page.waitForFunction(() => document.querySelector('#run-status').textContent.includes('中断'));
    }
    await page.click('#exit-demo');
    await page.click('#connect-button');
    await page.waitForFunction(() => document.querySelector('#server-version').textContent.includes('0.159.2'));
    assert.match(await page.locator('#connection-message').innerText(), /未登录/);
    assert.equal(await page.locator('#run-button').isDisabled(), true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'docs/screenshots/04-real-connected-no-auth.png', fullPage: true });
    // Disconnect-reconnect and SSE reload preserve truthful connection state.
    await page.reload(); await page.waitForFunction(() => document.querySelector('#server-version').textContent.includes('0.159.2'));
    await page.click('#connect-button'); await page.waitForFunction(() => document.querySelector('#mode-badge').textContent.includes('未连接'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'docs/screenshots/05-mobile.png', fullPage: true });
    const dims = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dims.scroll <= dims.width + 1, `Mobile horizontal overflow ${JSON.stringify(dims)}`);
    await page.click('#help-button'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#info-dialog').evaluate(d => d.open), false);
    assert.deepEqual(errors, []); assert.deepEqual(failures.filter(e => !e.includes('favicon')), []);
    const report = { browser: 'Own cloud headless Chromium', platform: process.platform, desktop: '1440x1100', mobile: '390x844', checks: 20, runtimeErrors: errors, consoleErrors: failures, liveInferenceAttempted: false, passed: true };
    fs.writeFileSync('docs/ui-test-result.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
