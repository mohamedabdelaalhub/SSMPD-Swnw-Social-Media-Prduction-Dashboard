/* Training and Evaluation workspace. The data provider is installed only by the isolated preview. */
(function (root) {
  'use strict';

  const statuses = {
    assigned: 'لم يبدأ',
    started: 'قيد الإكمال',
    submitted: 'قيد المراجعة',
    redo: 'يحتاج إعادة',
    passed: 'اجتاز'
  };

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function displayDate(date) {
    return new Intl.DateTimeFormat('ar-EG-u-ca-gregory', {
      dateStyle: 'medium', timeZone: 'UTC'
    }).format(new Date(date + 'T00:00:00Z'));
  }

  function statusChip(status) {
    return `<span class="training-status" data-status="${escape(status)}">${statuses[status]}</span>`;
  }

  function assignmentSummary(row) {
    return `<article class="training-row">
      <div>
        <h3>${escape(row.title)}</h3>
        ${row.traineeName ? `<p>${escape(row.traineeName)}${row.reviewerName ? ' · المراجع: ' + escape(row.reviewerName) : ''}</p>` : ''}
        <p>آخر موعد للإكمال: <time datetime="${escape(row.due)}">${displayDate(row.due)}</time></p>
      </div>
      ${statusChip(row.status)}
    </article>`;
  }

  function activityView(assignment, activity, reviewer) {
    const ready = activity.redo || !activity.answer;
    const answer = activity.answer && `<p class="training-text"><strong>الإجابة المسلّمة</strong><br>${escape(activity.answer)}</p>`;
    const model = reviewer && activity.modelAnswer &&
      `<p class="training-text"><strong>الإجابة النموذجية</strong><br>${escape(activity.modelAnswer)}</p>`;
    const maySubmit = !reviewer && ready && assignment.status !== 'passed';
    return `<section class="training-activity">
      <h5>${escape(activity.title)} ${activity.redo ? statusChip('redo') : ''}</h5>
      <p class="training-text">${escape(activity.prompt)}</p>
      ${answer || ''}${model || ''}
      ${maySubmit ? `<form data-training-action="submit" data-assignment="${escape(assignment.id)}" data-activity="${escape(activity.id)}">
        ${area('answer', 'إجابتك', 4000, true)}
        <button type="submit" class="btn sm">${activity.redo ? 'إعادة التسليم' : 'تسليم الإجابة'}</button>
      </form>` : ''}
    </section>`;
  }

  function coursesView(assignment, reviewer) {
    return assignment.courses.map(course => `<details class="training-course" data-course="${escape(course.id)}">
      <summary><strong>${escape(course.title)}</strong><span>${course.modules.length} وحدات</span></summary>
      ${course.modules.map(unit => `<section class="training-unit">
        <h4>${escape(unit.title)}</h4>
        <p class="training-text">${escape(unit.lesson)}</p>
        ${unit.activities.map(item => activityView(assignment, item, reviewer)).join('')}
      </section>`).join('')}
    </details>`).join('');
  }

  function publishedResult(row) {
    if (!row.result) return '';
    const toRedo = row.courses.flatMap(course => course.modules.flatMap(unit =>
      unit.activities.filter(item => item.redo).map(item => unit.title + ' · ' + item.title)));
    return `<section class="training-result" aria-label="النتيجة المعتمدة">
      <h4>آخر نتيجة معتمدة: ${row.result.outcome === 'pass' ? 'اجتاز' : 'يحتاج إعادة'}</h4>
      ${row.result.feedback ? `<p class="training-text"><strong>ملاحظة لك</strong><br>${escape(row.result.feedback)}</p>` : ''}
      ${toRedo.length ? `<p><strong>الأنشطة المطلوب إعادتها</strong></p>
        <ul>${toRedo.map(title => `<li>${escape(title)}</li>`).join('')}</ul>` : ''}
    </section>`;
  }

  function input(name, label, max) {
    return `<label class="training-field"><span>${label}</span><input name="${name}" maxlength="${max}" required></label>`;
  }

  function area(name, label, max, required, value = '') {
    return `<label class="training-field"><span>${label}</span>
      <textarea name="${name}" maxlength="${max}" rows="3"${required ? ' required' : ''}>${escape(value)}</textarea>
    </label>`;
  }

  function option(value, label) {
    return `<option value="${escape(value)}">${escape(label)}</option>`;
  }

  function options(rows) {
    return rows.map(row => option(row.id, row.name || row.title)).join('');
  }

  function select(name, label, choices) {
    return `<label class="training-field"><span>${label}</span>
      <select name="${name}" required>${choices}</select>
    </label>`;
  }

  function unitFields() {
    return input('unitTitle', 'اسم الوحدة', 120) +
      area('lesson', 'محتوى الوحدة', 4000, true) +
      select('kind', 'نوع النشاط', option('task', 'مهمة تطبيقية') + option('quiz', 'اختبار قصير')) +
      area('prompt', 'نص النشاط', 2500, true) +
      area('modelAnswer', 'الإجابة النموذجية (للمراجع)', 2500, false);
  }

  function managementView(data) {
    const scope = data.tracks.map(track => option('track:' + track.id, 'مسار · ' + track.title)).join('') +
      data.courses.map(course => option('course:' + course.id, 'دورة · ' + course.title)).join('');
    return `<section class="training-page-section" data-training-management aria-label="إدارة التدريب">
      <h2>إدارة التدريب</h2>
      <div class="training-tools">
        <details class="training-tool">
          <summary>إنشاء مسار</summary>
          <form data-training-action="createTrack">
            ${input('title', 'اسم المسار', 120)}
            <button type="submit" class="btn sm">حفظ المسار</button>
          </form>
        </details>
        <details class="training-tool">
          <summary>إنشاء دورة</summary>
          <form data-training-action="createCourse">
            ${select('trackId', 'المسار', options(data.tracks))}
            ${input('title', 'اسم الدورة', 120)}
            ${unitFields()}
            <button type="submit" class="btn sm">حفظ الدورة</button>
          </form>
        </details>
        <details class="training-tool">
          <summary>إضافة وحدة</summary>
          <form data-training-action="addUnit">
            ${select('courseId', 'الدورة', options(data.courses))}
            ${unitFields()}
            <button type="submit" class="btn sm">حفظ الوحدة</button>
          </form>
        </details>
        <details class="training-tool" open>
          <summary>إسناد تدريب</summary>
          <form data-training-action="assign">
            <div class="training-fields">
              ${select('scope', 'الدورة أو المسار', scope)}
              ${select('targetType', 'نوع الإسناد', option('person', 'فرد') + option('group', 'مجموعة'))}
              <div data-training-target="person">${select('traineeId', 'المتدرّب', options(data.staff))}</div>
              <div data-training-target="group" hidden>${select('groupId', 'المجموعة', data.groups.map(group => option(group.id, group.name + ' (' + group.count + ')')).join(''))}</div>
              ${select('reviewerId', 'المراجع', options(data.reviewers))}
              <label class="training-field"><span>آخر موعد للإكمال</span><input type="date" name="due" required></label>
            </div>
            <button type="submit" class="btn sm">إسناد التدريب</button>
          </form>
        </details>
      </div>
      <h3>المسارات والدورات</h3>
      <div class="training-catalog">
        ${data.tracks.map(track => `<section class="training-row">
          <div><h4>${escape(track.title)}</h4>
          <ul>${data.courses.filter(course => course.trackId === track.id).map(course =>
            `<li>${escape(course.title)} · ${course.unitCount} وحدات</li>`).join('') || '<li>لم تُضف دورات بعد.</li>'}</ul></div>
        </section>`).join('')}
      </div>
      <h3>متابعة التكليفات</h3>
      ${data.assignments.map(assignmentSummary).join('')}
    </section>`;
  }

  function reviewForm(row) {
    if (row.status !== 'submitted') return '';
    const draft = row.draft || {};
    const redoChoices = row.courses.flatMap(course => course.modules.flatMap(unit =>
      unit.activities.map(item => `<label class="training-choice">
        <input type="checkbox" name="redoIds" value="${escape(item.id)}"${draft.redoIds?.includes(item.id) ? ' checked' : ''}>
        <span>${escape(unit.title)} · ${escape(item.title)}</span>
      </label>`))).join('');
    return `<form class="training-review-form" data-training-action="review" data-assignment="${escape(row.id)}">
      <h4>تسجيل المراجعة</h4>
      ${select('outcome', 'نتيجة التقييم', option('pass', 'اجتاز') + option('redo', 'يحتاج إعادة'))}
      <fieldset data-training-redo hidden><legend>الأنشطة المطلوب إعادتها</legend>${redoChoices}</fieldset>
      ${area('feedback', 'الملاحظة الموجّهة للمتدرّب', 2500, false, draft.feedback)}
      ${area('internalNote', 'الملاحظة الداخلية', 2500, false, draft.internalNote)}
      ${area('recommendation', 'التوصية الإدارية', 2500, false, draft.recommendation)}
      <div class="training-actions">
        <button type="submit" class="btn ghost sm" value="draft">حفظ مسودة</button>
        <button type="submit" class="btn sm" value="publish">اعتماد النتيجة</button>
      </div>
    </form>`;
  }

  function assignmentDetail(row, reviewer) {
    const privateReview = reviewer && row.privateReview;
    return `<article class="training-assignment" data-training-detail="${escape(row.id)}">
      ${assignmentSummary(row)}${publishedResult(row)}
      ${privateReview ? `<section class="training-result" aria-label="مراجعة داخلية">
        <p class="training-text"><strong>الملاحظة الداخلية</strong><br>${escape(privateReview.internalNote)}</p>
        <p class="training-text"><strong>التوصية الإدارية</strong><br>${escape(privateReview.recommendation)}</p>
      </section>` : ''}
      ${coursesView(row, reviewer)}
      ${reviewer ? reviewForm(row) : ''}
    </article>`;
  }

  function assignmentSection(title, rows, reviewer) {
    return `<section class="training-page-section" ${reviewer ? 'data-training-reviews' : 'data-training-mine'} aria-label="${title}">
      <h2>${title}</h2>
      ${rows.length ? rows.map(row => assignmentDetail(row, reviewer)).join('') :
        `<p class="training-empty">${reviewer ? 'لا توجد تكليفات مسندة إليك للمراجعة.' : 'لا توجد دورات مسندة إليك حاليًا.'}</p>`}
    </section>`;
  }

  function adjustFields(form) {
    if (form.dataset.trainingAction === 'assign') {
      const type = form.elements.targetType.value;
      form.querySelectorAll('[data-training-target]').forEach(section => {
        section.hidden = section.dataset.trainingTarget !== type;
        section.querySelector('select').disabled = section.hidden;
      });
    }
    if (form.dataset.trainingAction === 'review') {
      const fieldset = form.querySelector('[data-training-redo]');
      fieldset.disabled = fieldset.hidden = form.elements.outcome.value !== 'redo';
    }
  }

  function render(container) {
    const provider = root.SSMPDTrainingPreview;
    if (!canView(root.SSMPDAuth.currentAdmin)) return;
    const doc = container.ownerDocument;
    const workspace = doc.createElement('div');
    workspace.className = 'training-workspace';
    workspace.dir = 'rtl';
    container.replaceChildren(workspace);

    function paint(message = '', openKeys = []) {
      const data = provider.dashboard();
      workspace.innerHTML = `<header class="training-header">
        <div><h1>التدريب والتقييم</h1><p>معاينة ببيانات وحسابات تجريبية</p></div>
      </header>
      <p class="training-notice" role="status" tabindex="-1">${escape(message)}</p>
      ${data.management ? managementView(data.management) : ''}
      ${data.reviews ? assignmentSection('التكليفات المسندة لمراجعتي', data.reviews, true) : ''}
      ${data.trainee ? assignmentSection('دوراتي وتكليفاتي', data.mine, false) : ''}`;
      workspace.querySelectorAll('[data-training-detail]').forEach(section => {
        const courses = [...section.querySelectorAll('[data-course]')];
        const opened = courses.filter(course => openKeys.includes(section.dataset.trainingDetail + '/' + course.dataset.course));
        (opened.length ? opened : courses.slice(0, 1)).forEach(course => { course.open = true; });
      });
      workspace.querySelectorAll('[data-training-action="review"]').forEach(form => {
        const row = data.reviews.find(item => item.id === form.dataset.assignment);
        form.elements.outcome.value = row.draft?.outcome || 'pass';
      });
      workspace.querySelectorAll('form[data-training-action]').forEach(adjustFields);
    }

    workspace.addEventListener('change', event => {
      const form = event.target.form;
      if (form?.dataset.trainingAction) adjustFields(form);
    });

    workspace.addEventListener('submit', event => {
      const form = event.target;
      const action = form.dataset.trainingAction;
      if (!action) return;
      event.preventDefault();
      const values = new root.FormData(form);
      const input = Object.fromEntries(values);
      const open = [...workspace.querySelectorAll('[data-course][open]')].map(course =>
        course.closest('[data-training-detail]').dataset.trainingDetail + '/' + course.dataset.course);
      let message;
      try {
        switch (action) {
          case 'createTrack':
            provider.createTrack(input);
            message = 'تم حفظ المسار.';
            break;
          case 'createCourse':
            provider.createCourse(input);
            message = 'تم حفظ الدورة.';
            break;
          case 'addUnit':
            provider.addUnit(input);
            message = 'تم حفظ الوحدة.';
            break;
          case 'assign':
            message = 'تم إنشاء التكليفات: ' + provider.assign(input) + '.';
            break;
          case 'submit':
            provider.submit(form.dataset.assignment, form.dataset.activity, input.answer);
            message = 'تم تسليم الإجابة.';
            break;
          case 'review': {
            const publish = event.submitter?.value === 'publish';
            input.redoIds = values.getAll('redoIds');
            provider.saveReview(form.dataset.assignment, input, publish);
            message = publish ? 'تم اعتماد النتيجة وإتاحتها للمتدرّب.' : 'تم حفظ مسودة المراجعة.';
            break;
          }
          default:
            return;
        }
        paint(message, open);
      } catch (error) {
        workspace.querySelector('.training-notice').textContent = error.message;
      }
      workspace.querySelector('.training-notice').focus();
    });

    paint();
  }

  function canView(admin) {
    return root.SSMPDTrainingPreview?.canView(admin) === true;
  }

  root.SSMPDTrainingEvaluation = { render, canView };
})(window);
