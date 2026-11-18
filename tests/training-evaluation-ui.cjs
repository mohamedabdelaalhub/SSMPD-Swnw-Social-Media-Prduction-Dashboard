const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const preview = '/proposals/training-evaluation/preview.html';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
};

async function serve(request, response) {
  const name = new URL(request.url, 'http://localhost').pathname;
  const type = types[path.extname(name)];
  if (!type || (name !== preview && !/^\/(?:assets\/(?:js|css|img|fonts)\/|proposals\/training-evaluation\/)[\w./-]+$/.test(name))) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(path.join(root, name));
    response.writeHead(200, { 'Content-Type': type }).end(body);
  } catch (_) {
    response.writeHead(404).end();
  }
}

async function main() {
  const server = createServer(serve);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const external = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const diagnostics = [];
    page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) diagnostics.push(response.status() + ' ' + response.url()); });
    page.setDefaultTimeout(8000);
    await page.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await page.goto(origin + preview);

    async function account(id, view = true) {
      await Promise.all([
        page.waitForURL(url => url.searchParams.get('account') === id),
        page.locator('#training-preview-account').selectOption(id)
      ]);
      const locator = view ? page.getByRole('heading', { name: 'التدريب والتقييم', exact: true }) : page.locator('.training-page-section');
      await locator.waitFor();
    }

    const detail = id => page.locator('[data-training-detail="' + id + '"]');
    const action = name => page.locator('[data-training-action="' + name + '"]');
    const formField = (form, field) => form.locator('[name="' + field + '"]');
    const note = page.locator('.training-notice');
    const title = page.getByRole('heading', { name: 'التدريب والتقييم', exact: true });
    await title.waitFor().catch(async error => {
      console.error('Preview startup:', errors, diagnostics, await page.evaluate(() => ({
        base: document.baseURI,
        ready: document.readyState,
        scripts: [...document.scripts].map(script => script.src),
        hasRoles: !!window.SSMPDRoles,
        hasFixture: !!window.SSMPDTrainingFixtures,
        auth: !!window.SSMPDAuth,
        app: document.getElementById('app-root').innerText.slice(0, 700)
      })));
      throw error;
    });

    assert.equal(await detail('branch-assignment').count(), 1);
    assert.equal(await detail('team-assignment').count(), 0);
    assert.equal(await page.locator('[data-training-management], [data-training-reviews]').count(), 0);
    assert.doesNotMatch(await page.locator('.training-workspace').innerText(), /الإجابة النموذجية|الملاحظة الداخلية|التوصية الإدارية/);

    await page.locator('#user-menu-btn').click();
    const menuLink = page.locator('#user-dropdown [data-goto="training_evaluation"]');
    assert.equal(await menuLink.getAttribute('aria-current'), 'page');
    await menuLink.click();
    await page.locator('#global-search-toggle').click();
    await page.locator('#global-search-input').fill('الدورات');
    await page.locator('#global-search-input').press('Enter');
    await page.locator('[data-id="tab-training_evaluation"]').click();
    await title.waitFor();

    const firstActivity = detail('branch-assignment').locator('[data-activity="branch-ops-1-activity"]');
    await formField(firstActivity, 'answer').fill('<img src=x onerror=alert(1)> إجابة تجريبية');
    await firstActivity.getByRole('button', { name: 'تسليم الإجابة' }).click();
    assert.match(await note.innerText(), /تم تسليم/);
    assert.match(await detail('branch-assignment').innerText(), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await detail('branch-assignment').locator('img').count(), 0);
    assert.equal(await firstActivity.count(), 0);

    const candidateBoundary = await page.evaluate(() => {
      const store = window.SSMPDTrainingPreview;
      const view = JSON.stringify(store.dashboard());
      let denied = 0;
      for (const attempt of [
        () => store.submit('team-assignment', 'team-quality-5-activity', 'forbidden'),
        () => store.createTrack({ title: 'forbidden' }),
        () => store.saveReview('team-assignment', { outcome: 'pass', redoIds: [] }, true),
        () => store.submit('branch-assignment', 'team-quality-5-activity', 'forbidden')
      ]) {
        try { attempt(); } catch (_) { denied++; }
      }
      return {
        denied,
        privateData: /modelAnswer|internalNote|recommendation|team-assignment/.test(view),
        ordinaryAdmin: window.SSMPDRoles.canSeeTab({ id: 'coordinator', active: true, role: 'general_manager' }, 'training_evaluation'),
        inactive: window.SSMPDRoles.canSeeTab(window.SSMPDTrainingFixtures.accounts.find(item => !item.active), 'training_evaluation')
      };
    });
    assert.deepEqual(candidateBoundary, { denied: 4, privateData: false, ordinaryAdmin: false, inactive: false });

    await account('reviewer-a');
    assert.equal(await page.locator('[data-training-reviews] [data-training-detail]').count(), 1);
    assert.equal(await page.locator('[data-training-reviews] [data-training-detail="branch-assignment"]').count(), 1);
    assert.equal(await page.locator('[data-training-mine] [data-training-detail="reviewer-own"]').count(), 1);
    assert.equal(await page.locator('[data-training-reviews] [data-training-detail="reviewer-own"]').count(), 0);
    assert.equal(await page.evaluate(() => {
      try {
        window.SSMPDTrainingPreview.saveReview('reviewer-own', { outcome: 'pass', redoIds: [] }, true);
        return false;
      } catch (error) { return /غير متاح لحسابك/.test(error.message); }
    }), true);
    assert.equal(await page.locator('[data-training-management]').count(), 0);

    await account('trainee-b');
    assert.equal(await detail('branch-assignment').count(), 0);
    assert.match(await detail('team-assignment').innerText(), /قيد المراجعة/);
    assert.doesNotMatch(await detail('team-assignment').innerText(), /مسودة ملاحظة|التوصية|الملاحظة الداخلية|آخر نتيجة معتمدة/);

    await account('reviewer-b');
    assert.equal(await detail('branch-assignment').count(), 0);
    const review = detail('team-assignment').locator('[data-training-action="review"]');
    await formField(review, 'outcome').selectOption('redo');
    await formField(review, 'redoIds').first().check();
    await formField(review, 'feedback').fill('وضّح وقت التصعيد.');
    await formField(review, 'internalNote').fill('ملاحظة سرية تجريبية 765');
    await formField(review, 'recommendation').fill('توصية داخلية تجريبية 987');
    await review.getByRole('button', { name: 'حفظ مسودة' }).click();
    assert.match(await note.innerText(), /تم حفظ مسودة/);
    await account('trainee-b');
    assert.doesNotMatch(await detail('team-assignment').innerText(), /وقت التصعيد|آخر نتيجة معتمدة|765|987/);

    await account('reviewer-b');
    assert.equal(await formField(review, 'feedback').inputValue(), 'وضّح وقت التصعيد.');
    await review.getByRole('button', { name: 'اعتماد النتيجة' }).click();
    assert.match(await note.innerText(), /تم اعتماد النتيجة/);
    await account('trainee-b');
    assert.match(await detail('team-assignment').innerText(), /آخر نتيجة معتمدة: يحتاج إعادة/);
    assert.match(await detail('team-assignment').innerText(), /وضّح وقت التصعيد/);
    assert.equal(await detail('team-assignment').locator('[aria-label="النتيجة المعتمدة"] li').count(), 1);
    assert.doesNotMatch(await detail('team-assignment').innerText(), /765|987|الإجابة النموذجية/);
    const repeat = detail('team-assignment').locator('[data-activity="team-quality-5-activity"]');
    assert.equal(await action('submit').count(), 1);
    await formField(repeat, 'answer').fill('أصعّد للمسؤول خلال 15 دقيقة.');
    await repeat.getByRole('button', { name: 'إعادة التسليم' }).click();
    assert.match(await detail('team-assignment').innerText(), /قيد المراجعة/);
    assert.equal(await action('submit').count(), 0);
    await account('reviewer-b');
    await formField(review, 'outcome').selectOption('pass');
    await formField(review, 'feedback').fill('تم توضيح المهلة.');
    await review.getByRole('button', { name: 'اعتماد النتيجة' }).click();
    await account('trainee-b');
    assert.match(await detail('team-assignment').innerText(), /آخر نتيجة معتمدة: اجتاز/);

    await account('coordinator');
    assert.equal(await page.locator('[data-training-reviews], [data-training-mine]').count(), 0);
    assert.doesNotMatch(await page.locator('[data-training-management]').innerText(), /765|987|أصعّد للمسؤول/);
    await page.getByText('إنشاء مسار', { exact: true }).click();
    const track = action('createTrack');
    await formField(track, 'title').fill('مسار الاختبار');
    await track.getByRole('button').click();
    await page.getByText('إنشاء دورة', { exact: true }).click();
    const course = action('createCourse');
    await formField(course, 'trackId').selectOption({ label: 'مسار الاختبار' });
    await formField(course, 'title').fill('دورة الاختبار');
    await formField(course, 'unitTitle').fill('وحدة التمرين');
    await formField(course, 'lesson').fill('مادة تجريبية.');
    await formField(course, 'kind').selectOption('quiz');
    await formField(course, 'prompt').fill('اشرح الخطوات.');
    await formField(course, 'modelAnswer').fill('مفتاح اختبار خاص.');
    await course.getByRole('button').click();
    assert.match(await note.innerText(), /تم حفظ الدورة/);

    const assign = action('assign');
    await formField(assign, 'scope').selectOption({ label: 'دورة · دورة الاختبار' });
    await formField(assign, 'traineeId').selectOption('reviewer-a');
    await formField(assign, 'reviewerId').selectOption('reviewer-a');
    const due = new Date(Date.now() + 864000000).toISOString().slice(0, 10);
    await formField(assign, 'due').fill(due);
    await assign.getByRole('button').click();
    assert.match(await note.innerText(), /من خارج المتدرّبين/);
    await formField(assign, 'reviewerId').selectOption('reviewer-b');
    await assign.getByRole('button').click();
    assert.match(await note.innerText(), /التكليفات: 1/);

    await page.getByText('إضافة وحدة', { exact: true }).click();
    const unit = action('addUnit');
    await formField(unit, 'courseId').selectOption({ label: 'دورة الاختبار' });
    await formField(unit, 'unitTitle').fill('وحدة أضيفت بعد التكليف الأول');
    await formField(unit, 'lesson').fill('مادة إضافية للتجربة.');
    await formField(unit, 'prompt').fill('صف نتيجة المحاكاة.');
    await unit.getByRole('button').click();
    assert.match(await note.innerText(), /تم حفظ الوحدة/);

    await formField(assign, 'scope').selectOption({ label: 'مسار · مسار الاختبار' });
    await formField(assign, 'targetType').selectOption('group');
    assert.equal(await formField(assign, 'traineeId').isDisabled(), true);
    await formField(assign, 'groupId').selectOption('cohort');
    await formField(assign, 'reviewerId').selectOption('reviewer-a');
    await formField(assign, 'due').fill(due);
    await assign.getByRole('button').click();
    assert.match(await note.innerText(), /التكليفات: 2/);
    await account('reviewer-a');
    assert.doesNotMatch(await page.locator('[data-training-mine]').textContent(), /وحدة أضيفت بعد التكليف الأول/);
    await account('trainee-a');
    assert.match(await page.locator('[data-training-mine]').innerText(), /دورة الاختبار/);
    assert.match(await page.locator('[data-training-mine]').textContent(), /وحدة أضيفت بعد التكليف الأول/);
    assert.doesNotMatch(await page.locator('[data-training-mine]').innerText(), /مفتاح اختبار خاص/);
    await account('trainee-b');
    assert.match(await page.locator('[data-training-mine]').innerText(), /دورة الاختبار/);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await account('unassigned', false);
    assert.equal(await page.locator('#user-dropdown [data-goto="training_evaluation"]').count(), 0);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    console.log('PASS training preview navigation, assignment creation, candidate and reviewer isolation, draft, redo and approval, mobile layout, no external requests');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
