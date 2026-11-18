/* Authorization and mutations for the fictional, browser-only preview. */
(function (root) {
  'use strict';

  const fixture = root.SSMPDTrainingFixtures;
  const storageKey = 'ssmpd.training.preview.v1';
  const denied = 'هذا الإجراء غير متاح لحسابك.';
  let data = fixture.initialData();
  try {
    const stored = root.sessionStorage.getItem(storageKey);
    if (stored) data = JSON.parse(stored);
  } catch (_) {
    // The preview can still run for the current page when session storage is unavailable.
  }

  function save() {
    try {
      root.sessionStorage.setItem(storageKey, JSON.stringify(data));
    } catch (_) {
      // Keep changes in memory for this page.
    }
  }

  function actor(admin) {
    return fixture.accounts.includes(admin) && admin.active ? admin : null;
  }

  function current() {
    const admin = actor(root.SSMPDAuth.currentAdmin);
    if (!admin) throw new Error(denied);
    return admin;
  }

  function manager() {
    const admin = current();
    if (!admin.managesTraining) throw new Error(denied);
    return admin;
  }

  function canReview(admin, row) {
    return admin.reviewsTraining && row.reviewerId === admin.id && row.traineeId !== admin.id;
  }

  function byId(rows, id) {
    return rows.find(row => row.id === id);
  }

  function text(value, label, max, required = true) {
    const cleaned = typeof value === 'string' ? value.trim() : '';
    if ((required && !cleaned) || cleaned.length > max) {
      throw new Error(label + ' مطلوب بحد أقصى ' + max + ' حرفًا.');
    }
    return cleaned;
  }

  function activities(row) {
    return row.courses.flatMap(course => course.modules.flatMap(module => module.activities));
  }

  function status(row) {
    if (row.result?.outcome === 'pass') return 'passed';
    if (row.redo.length) return 'redo';
    if (activities(row).every(item => row.submissions[item.id])) return 'submitted';
    return Object.keys(row.submissions).length ? 'started' : 'assigned';
  }

  function assignmentView(row, reviewer) {
    const courses = row.courses.map(course => ({
      id: course.id, title: course.title,
      modules: course.modules.map(module => ({
        id: module.id, title: module.title, lesson: module.lesson,
        activities: module.activities.map(item => ({
          id: item.id, title: item.title, kind: item.kind, prompt: item.prompt,
          answer: row.submissions[item.id] || '',
          redo: row.redo.includes(item.id),
          ...(reviewer ? { modelAnswer: item.modelAnswer } : {})
        }))
      }))
    }));
    const result = row.result ? { outcome: row.result.outcome, feedback: row.result.feedback } : null;
    const summary = { id: row.id, title: row.title, due: row.due, status: status(row), courses, result };
    if (!reviewer) return summary;
    return {
      ...summary,
      traineeName: byId(fixture.accounts, row.traineeId).name,
      draft: row.draft ? { ...row.draft, redoIds: [...row.draft.redoIds] } : null,
      privateReview: row.privateReview ? { ...row.privateReview } : null
    };
  }

  function canView(admin) {
    const account = actor(admin);
    return !!(account && (account.trainee || account.managesTraining || account.reviewsTraining));
  }

  function dashboard() {
    const admin = current();
    const snapshot = {
      mine: data.assignments.filter(row => row.traineeId === admin.id).map(row => assignmentView(row, false)),
      reviews: admin.reviewsTraining ? data.assignments.filter(row => canReview(admin, row)).map(row => assignmentView(row, true)) : null,
      management: null,
      trainee: !!admin.trainee
    };
    if (!admin.managesTraining) return snapshot;
    snapshot.management = {
      tracks: data.tracks.map(({ id, title }) => ({ id, title })),
      courses: data.courses.map(({ id, trackId, title, modules }) => ({ id, trackId, title, unitCount: modules.length })),
      staff: fixture.accounts.filter(a => a.active && a.trainee).map(({ id, name }) => ({ id, name })),
      reviewers: fixture.accounts.filter(a => a.active && a.reviewsTraining).map(({ id, name }) => ({ id, name })),
      groups: data.groups.map(({ id, name, members }) => ({ id, name, count: members.length })),
      assignments: data.assignments.map(row => ({
        id: row.id, title: row.title, due: row.due, status: status(row),
        traineeName: byId(fixture.accounts, row.traineeId).name,
        reviewerName: byId(fixture.accounts, row.reviewerId).name
      }))
    };
    return snapshot;
  }

  function newActivity(input) {
    return {
      id: root.crypto.randomUUID(),
      title: input.kind === 'quiz' ? 'اختبار قصير' : 'مهمة تطبيقية',
      kind: input.kind === 'quiz' ? 'quiz' : 'task',
      prompt: text(input.prompt, 'نص النشاط', 2500),
      modelAnswer: text(input.modelAnswer, 'الإجابة النموذجية', 2500, false)
    };
  }

  function newUnit(input) {
    return {
      id: root.crypto.randomUUID(),
      title: text(input.unitTitle, 'اسم الوحدة', 120),
      lesson: text(input.lesson, 'محتوى الوحدة', 4000),
      activities: [newActivity(input)]
    };
  }

  function createTrack(input) {
    manager();
    const title = text(input.title, 'اسم المسار', 120);
    if (data.tracks.some(track => track.title === title)) throw new Error('يوجد بالفعل مسار بهذا الاسم.');
    data.tracks.push({ id: root.crypto.randomUUID(), title });
    save();
  }

  function createCourse(input) {
    manager();
    const track = byId(data.tracks, input.trackId);
    if (!track) throw new Error('اختر مسارًا موجودًا.');
    const title = text(input.title, 'اسم الدورة', 120);
    if (data.courses.some(course => course.trackId === track.id && course.title === title)) throw new Error('توجد بالفعل دورة بهذا الاسم في المسار.');
    data.courses.push({ id: root.crypto.randomUUID(), trackId: track.id, title, modules: [newUnit(input)] });
    save();
  }

  function addUnit(input) {
    manager();
    const course = byId(data.courses, input.courseId);
    if (!course) throw new Error('اختر دورة موجودة.');
    course.modules.push(newUnit(input));
    save();
  }

  function assign(input) {
    manager();
    const [kind, id] = String(input.scope).split(':');
    const track = kind === 'track' && byId(data.tracks, id);
    const course = kind === 'course' && byId(data.courses, id);
    const scope = track || course;
    if (!scope) throw new Error('اختر مسارًا أو دورة.');
    const courses = track ? data.courses.filter(item => item.trackId === track.id) : [course];
    if (!courses.length) throw new Error('أضف دورة للمسار قبل إسناده.');
    const group = input.targetType === 'group' && byId(data.groups, input.groupId);
    const traineeIds = input.targetType === 'group' ? [...new Set(group?.members || [])] : [input.traineeId];
    if (!traineeIds.length || !traineeIds.every(id => {
      const trainee = actor(byId(fixture.accounts, id));
      return trainee?.trainee;
    })) throw new Error('اختر متدرّبًا نشطًا أو مجموعة بها متدرّبون نشطون.');
    const reviewer = actor(byId(fixture.accounts, input.reviewerId));
    if (!reviewer?.reviewsTraining || traineeIds.includes(reviewer.id)) {
      throw new Error('اختر مراجعًا مخوّلًا من خارج المتدرّبين في هذا التكليف.');
    }
    const due = String(input.due);
    const date = new Date(due + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== due) {
      throw new Error('أدخل تاريخ إكمال صالحًا.');
    }
    if (data.assignments.some(row => row.scope === input.scope && traineeIds.includes(row.traineeId) && status(row) !== 'passed')) {
      throw new Error('يوجد تكليف مفتوح بهذا المحتوى لأحد المتدرّبين المحددين.');
    }
    const records = traineeIds.map(traineeId => ({
      id: root.crypto.randomUUID(), title: scope.title, scope: input.scope, due, traineeId,
      reviewerId: reviewer.id, courses: JSON.parse(JSON.stringify(courses)),
      submissions: {}, draft: null, result: null, redo: []
    }));
    data.assignments.push(...records);
    save();
    return records.length;
  }

  function submit(assignmentId, activityId, answer) {
    const admin = current();
    const row = byId(data.assignments, assignmentId);
    if (!row || row.traineeId !== admin.id) throw new Error(denied);
    const item = byId(activities(row), activityId);
    if (!item || status(row) === 'passed' || (row.submissions[item.id] && !row.redo.includes(item.id))) {
      throw new Error('هذا النشاط غير متاح للتسليم الآن.');
    }
    row.submissions[item.id] = text(answer, 'الإجابة', 4000);
    row.redo = row.redo.filter(id => id !== item.id);
    save();
  }

  function saveReview(assignmentId, input, publish) {
    const admin = current();
    const row = byId(data.assignments, assignmentId);
    if (!row || !canReview(admin, row)) throw new Error(denied);
    if (status(row) !== 'submitted') throw new Error('تُتاح المراجعة بعد اكتمال تسليم كل الأنشطة المطلوبة.');
    if (input.outcome !== 'pass' && input.outcome !== 'redo') throw new Error('اختر نتيجة للمراجعة.');
    const redoIds = input.outcome === 'redo' ? [...new Set(input.redoIds)] : [];
    if (redoIds.some(id => !byId(activities(row), id)) || (publish && input.outcome === 'redo' && !redoIds.length)) {
      throw new Error('حدّد الأنشطة المطلوب إعادتها من هذا التكليف.');
    }
    const review = {
      outcome: input.outcome,
      feedback: text(input.feedback, 'الملاحظة الموجّهة للمتدرّب', 2500, publish && input.outcome === 'redo'),
      recommendation: text(input.recommendation, 'التوصية الإدارية', 2500, false),
      internalNote: text(input.internalNote, 'الملاحظة الداخلية', 2500, false),
      redoIds
    };
    if (publish) {
      row.result = { outcome: review.outcome, feedback: review.feedback };
      row.privateReview = { recommendation: review.recommendation, internalNote: review.internalNote };
      row.redo = redoIds;
      row.draft = null;
    } else {
      row.draft = review;
    }
    save();
  }

  root.SSMPDTrainingPreview = Object.freeze({ canView, dashboard, createTrack, createCourse, addUnit, assign, submit, saveReview });
})(window);
