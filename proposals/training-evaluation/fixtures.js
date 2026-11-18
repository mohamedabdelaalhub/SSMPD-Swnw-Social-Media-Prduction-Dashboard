/* Fictional accounts and training content for the isolated preview. */
(function (root) {
  'use strict';

  const accounts = [
    { id: 'trainee-a', name: 'متدرّب الفرع', role: 'reception', active: true, trainee: true },
    { id: 'trainee-b', name: 'متدرّب الفريق', role: 'customer_service', active: true, trainee: true },
    { id: 'coordinator', name: 'مسؤول التدريب التجريبي', role: 'general_manager', active: true, managesTraining: true },
    { id: 'reviewer-a', name: 'مراجع الفرع التجريبي', role: 'head_nursing', active: true, trainee: true, reviewsTraining: true },
    { id: 'reviewer-b', name: 'مراجع الفريق التجريبي', role: 'approver', active: true, reviewsTraining: true },
    { id: 'unassigned', name: 'حساب بلا تكليف', role: 'designer', active: true },
    { id: 'inactive', name: 'حساب متوقف', role: 'general_manager', active: false, managesTraining: true }
  ].map(Object.freeze);

  const topics = [
    ['التشغيل اليومي', 'ابدأ الوردية بتأكيد الجاهزية، وتوزيع المسؤوليات، وتحديد من يتابع البنود المفتوحة عند التسليم.',
      'اكتب قائمة بدء وردية لفرع افتراضي عنده نقص في التغطية.',
      'اكتب رسالة تسليم وردية توضح المسؤول عن كل بند مفتوح.',
      'تتضمن الإجابة الأولوية والمسؤول ووقت المتابعة وطريقة توثيق التسليم.'],
    ['تجربة المريض والشكاوى', 'استمع للشكوى، وسجّل أثرها بلغة محايدة، وحدد خطوة المتابعة وموعد تحديث صاحب الشكوى.',
      'اقترح طريقة تعامل الفرع مع شكوى افتراضية عن تأخر الخدمة.',
      'اكتب ردًا أوليًا لشكوى افتراضية وبيّن متى تحتاج تصعيدها.',
      'اعتراف بالأثر، خطوة تالية واضحة، وتوثيق مناسب مع الحفاظ على الخصوصية.'],
    ['قيادة الفريق والموارد البشرية', 'اتفق على التوقعات مسبقًا، وناقش الأداء بأمثلة قابلة للتحقق، وحدد موعدًا للمتابعة.',
      'حدّد كيف توزّع تغطية ورديتين افتراضيتين بعد غياب مفاجئ.',
      'حضّر محادثة متابعة مع موظف افتراضي تكرر تأخره عن التسليم.',
      'يُذكر أثر المشكلة، الإجراء المتفق عليه، وموعد مراجعة التنفيذ.'],
    ['سلامة المريض ومكافحة العدوى', 'أمّن المكان عند الاشتباه في خطر، وأبلغ المسؤول المختص، واتبع تعليمات المنشأة المعتمدة.',
      'في تمرين مكتبي، صف قرارك عند الإبلاغ عن نقص مستلزمات الوقاية في الفرع.',
      'حدّد ما الذي يفعله الفريق عند ملاحظة مخالفة افتراضية لإجراء وقائي.',
      'تأمين فوري ضمن الصلاحية، إبلاغ المسؤول المختص، وتوثيق الحالة دون بيانات شخصية.'],
    ['الصلاحيات والتصعيد', 'فرّق بين ما تستطيع اتخاذ قرار بشأنه وما يتطلب موافقة، وحدد مسؤول التصعيد والمهلة.',
      'تَلقّى الفرع طلب استثناء من إجراء معتمد. اكتب مسار التصعيد الافتراضي.',
      'حدّد متى تسند المشكلة داخل الفريق ومتى ترفعها للإدارة.',
      'حدود صلاحية واضحة، تصعيد للجهة المختصة، ومتابعة حتى إغلاق الطلب.'],
    ['المؤشرات وتحسين الخدمة', 'اربط كل مؤشر بقرار، وحدّد مصدره والفترة، وقارن قبل وبعد أي تغيير.',
      'زاد متوسط الانتظار الافتراضي من 20 إلى 30 دقيقة. اكتب خطة اختبار لتحسينه.',
      'انخفض اكتمال تسليم الورديات في بيانات محاكاة. حدّد مؤشرًا وخطوة تحسين.',
      'خط أساس، فرضية قابلة للاختبار، فترة قياس، ومسؤول يتابع الأثر.'],
    ['إدارة الأزمات واستمرارية التشغيل', 'حدّد الأولويات عند التعطّل، ووزّع الأدوار، وحدّد متى تنتهي الخطة البديلة.',
      'اكتب خطة تشغيل مؤقتة لفرع افتراضي تعطّل فيه النظام لمدة ساعة.',
      'اكتب رسالة للفريق توضح طريقة العمل أثناء تعطل افتراضي ومن يتابع الاستعادة.',
      'استمرار الأعمال ذات الأولوية، قناة تصعيد، وتوثيق ومراجعة عند العودة.']
  ];

  function modules(prefix, promptIndex, selection) {
    return selection.map(index => {
      const [title, lesson, , , modelAnswer] = topics[index];
      const id = prefix + '-' + (index + 1);
      return {
        id, title, lesson,
        activities: [{
          id: id + '-activity',
          title: index % 2 ? 'اختبار قصير' : 'مهمة تطبيقية',
          kind: index % 2 ? 'quiz' : 'task',
          prompt: topics[index][promptIndex],
          modelAnswer
        }]
      };
    });
  }

  function deadline(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function initialData() {
    const tracks = [
      { id: 'branch', title: 'مدير فرع' },
      { id: 'team', title: 'مدير فريق' }
    ];
    const courses = [
      { id: 'branch-ops', trackId: 'branch', title: 'تشغيل الفرع وتجربة المريض', modules: modules('branch-ops', 2, [0, 1, 3, 4]) },
      { id: 'branch-leadership', trackId: 'branch', title: 'قيادة الفرع وتحسين الخدمة', modules: modules('branch-leadership', 2, [2, 5, 6]) },
      { id: 'team-people', trackId: 'team', title: 'قيادة الفريق وتجربة المريض', modules: modules('team-people', 3, [0, 1, 2, 3]) },
      { id: 'team-quality', trackId: 'team', title: 'التصعيد والجودة واستمرارية العمل', modules: modules('team-quality', 3, [4, 5, 6]) }
    ];
    const groups = [{ id: 'cohort', name: 'دفعة التدريب التجريبية', members: ['trainee-a', 'trainee-b'] }];
    const assignments = [
      { id: 'branch-assignment', scope: 'track:branch', title: tracks[0].title, due: deadline(10), traineeId: 'trainee-a', reviewerId: 'reviewer-a', courses: courses.slice(0, 2), submissions: {}, draft: null, result: null, redo: [] },
      {
        id: 'team-assignment', scope: 'course:team-quality', title: courses[3].title, due: deadline(14), traineeId: 'trainee-b', reviewerId: 'reviewer-b', courses: [courses[3]],
        submissions: {
          'team-quality-5-activity': 'أراجع حد الصلاحية وأرفع الطلب للمسؤول وأحدد موعدًا للمتابعة.',
          'team-quality-6-activity': 'أقيس نسبة التسليم في الموعد، وأجرّب قائمة تحقق أسبوعية.',
          'team-quality-7-activity': 'نستخدم سجل المحاكاة المؤقت ونحدد مسؤولًا عن التحديث.'
        },
        draft: { outcome: 'pass', feedback: 'مسودة ملاحظة تجريبية.', recommendation: 'توصية إدارية تجريبية.', internalNote: 'ملاحظة داخلية تجريبية.', redoIds: [] },
        result: null, redo: []
      },
      { id: 'reviewer-own', scope: 'course:branch-leadership', title: courses[1].title, due: deadline(18), traineeId: 'reviewer-a', reviewerId: 'reviewer-b', courses: [courses[1]], submissions: {}, draft: null, result: null, redo: [] }
    ];
    return { tracks, courses, groups, assignments };
  }

  root.SSMPDTrainingFixtures = { accounts: Object.freeze(accounts), initialData };
})(window);
