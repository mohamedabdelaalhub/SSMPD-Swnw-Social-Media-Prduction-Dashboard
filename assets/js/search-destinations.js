/* Local navigation catalogue. No business data requests or permission changes. */
(function(root){'use strict';
var aliases={reports:'تقارير reports تقرير خزنة إيرادات مستحقات اقفال فلاش',training_evaluation:'تدريب تقييم دورة كورس اختبار امتحان تكليف مقابلة training evaluation exam course',home:'الرئيسية الصفحة الشخصية بروفايل profile home',summary:'ملخص overview',production:'بوست منشور محتوى كتابة post content',review:'مراجعة اعتماد المحتوى approval',design:'تصميم صور فيديو ريلز كاروسيل design',publish:'نشر جدولة scheduled publishing',patients:'مرضى مريض ملف ملفات ارشيف patients archive',leads:'ليد عملاء تواصل leads crm',tasks:'تاسك تكليف مشروع مراحل tasks projects',admin:'ادارة مستخدم موظف موظفين صلاحيات users settings permissions',inventory:'مخزن مخازن جرد مستلزمات شراء توريد صرف inventory stock supplies',accounting:'حسابات مالية محاسبة accounting finance',reception_services:'حجز حجوزات موعد مواعيد ربط طبيب تواجد استقبال زيارة خدمات booking appointments reception',booking_cash:'خزنة تحصيل استلام نقدية cash',contracting_entities:'جهات شركات عقود تعاقد insurance contracts',clinic_info:'شات بوت chatbot معلومات تحديث',org_legal:'الشركة الفروع سجل تجاري بطاقة ضريبية ختم تراخيص ترخيص بنك حساب بنكي IBAN company branch license',indicator_reports:'مؤشرات تقرير توصيات اجراءات reports indicators',staff_kpi:'اداء الموظفين الفريق kpi',performance:'اداء المنشورات البوستات posts analytics',my_kpi:'ادائي الشخصي',metaads:'اعلانات ميتا فيسبوك meta ads',mediabuyer:'وكيل الاعلانات media buyer'};
var features=[
 ['ledger-chart','الشجرة المحاسبية','شجرة حساب اضافة حساب تعديل حساب حذف حساب chart accounts tree','cash','chart'],
 ['ledger-manual','الأرصدة والتصحيحات','قيد مسودة افتتاحي تصحيح عكس تعديل حذف journal draft correction','cash','manual'],
 ['ledger-trial','القيود وميزان المراجعة','قيود ميزان مراجعة ledger trial balance','cash','ledger'],
 ['doctor-contracts','الأطباء والأتعاب','عقود الأطباء اعتماد مراجعة عقد طبيب دكتور دكاترة نسب اتعاب doctors contracts','cash','doctors'],
 ['doctor-accounts','حساب الأطباء','حساب الأطباء رصيد الدكتور مستحق كشف حساب دكتور دكاترة مستحقات الأطباء doctor accounts statement','cash','doctor-accounts'],
 ['staff-tax','سداد ضريبة المرتبات','سداد ضريبة المرتبات ضريبة كسب العمل ضريبة الدخل الموظفين المصلحة income tax payroll withholding','cash','staff-tax'],
 ['staff-settlement','مخالصات الموظفين','مخالصة نهائية إنهاء خدمة استقالة شهادة خبرة تسوية الموظف settlement end of service','cash','staff-settlement'],
 ['staff-insurance','سداد التأمينات','سداد التأمينات تأمينات اجتماعية تأمين طبي استقطاع حصة المركز تأمينات الموظفين insurance premium','cash','staff-insurance'],
 ['pricing-services','الخدمات والتسعير','تسعير خدمة اسعار سعر تكلفة services pricing prices','pricing','services'],
 ['pricing-packages','الباكجز','باقة باقات باكج باكدج packages bundles','pricing','packages'],
 ['pricing-supplies','المستلزمات والتسعير','مستلزم مستلزمات تكلفة supplies pricing','pricing','supplies'],
 ['cash-shifts','الخزائن والورديات','خزنة خزينة وردية نقدي cash register shifts','cash','shifts'],
 ['cash-invoices','الخدمات والفواتير','فاتورة فواتير مديونية invoices billing','cash','invoices'],
 ['cash-payments','التحصيل','تحصيل دفع مدفوعات payments collections','cash','payments'],
 ['cash-requests','طلبات الصرف والاسترداد','صرف استرداد رد مستحقات refund disbursement','cash','requests'],
 ['cash-suppliers','الموردون والمرتجعات','مورد موردين توريد مرتجع suppliers returns','cash','suppliers'],
 ['cash-payroll','المرتبات والسلف','مرتب رواتب راتب سلفة سلف payroll salaries','cash','payroll'],
 ['cash-advances','مقدمات الحجز والتأكيد','مقدم عربون تأكيد حجز booking advances','cash','advances'],
 ['cash-insurance','التأمين','تأمين مطالبات insurance claims','cash','insurance'],
 ['cash-bank','البنك والبطاقات','بنك فيزا بطاقات تحويل bank cards','cash','bank'],
 ['cash-assets','الأصول والإهلاك','اصل اصول اهلاك assets depreciation','cash','assets'],
 ['cash-taxes','الضرائب','ضريبة ضرائب taxes','cash','taxes']
];
/* Reception «التحصيل والمستلزمات» sub-tabs and key action buttons (owner 2026-11-22): [id,label,terms,subTab,actionButton] */
var rxFeatures=[
 ['rx-summary','الحساب والفواتير','فواتير حساب المريض مديونية تحصيل invoices','summary',''],
 ['rx-collect','تسجيل تحصيل','تسجيل تحصيل تحصيل فاتورة دفع من المريض سداد collect payment','summary','collect'],
 ['rx-credit','استخدام رصيد المريض','رصيد المريض استخدام رصيد credit','summary','credit_apply'],
 ['rx-stock','المستلزمات والمخزون','مستلزمات مخزون جرد تحويل مخزن stock inventory','stock',''],
 ['rx-shifts','الخزن والورديات','خزنة خزن خزينة وردية ورديات فتح وردية اغلاق وردية shifts','shifts',''],
 ['rx-controls','التعاقدات والتصحيحات','تعاقدات تصحيحات ارصدة الاطباء جهة عقد جهة تصحيح','controls',''],
 ['rx-request','طلب مالي / استرداد','طلب مالي استرداد رد فلوس مصروف تصحيح طريقة الدفع اشعار دائن refund','controls','request'],
 ['rx-void','إلغاء خدمة','الغاء خدمة خدمة اتدخلت بالغلط الغاء service void','controls','request'],
 ['rx-followup','المتابعة والتواصل','متابعة تواصل مهمة متابعة رسالة followup','followup',''],
 ['rx-reports','التقارير والتحليل','تقارير تحليل اعلان انفاق مصدر الحجز reports','reports','']
];
function rxOpen(r,navigate){navigate('reception_services');var tries=0;(function step(){tries++;var host=document.getElementById('view-container')||document,sec=host.querySelector('[data-rx-section="operations"]'),back=host.querySelector('[data-rx-action="back"]');
 if(!sec&&back&&tries<4)back.click();
 sec=host.querySelector('[data-rx-section="operations"]');if(!sec){if(tries<40)setTimeout(step,100);return;}
 sec.click();setTimeout(function(){var t=host.querySelector('[data-rx-action="operations-tab"][data-id="'+r.rx.tab+'"]');if(t)t.click();
  if(r.rx.action)setTimeout(function(){var b=host.querySelector('[data-rx-action="'+r.rx.action+'"]');if(b)b.click();},250);},150);})();}
function normal(v){return String(v||'').normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase().replace(/\s+/g,' ').trim().replace(/(^| )ال/g,'$1');}
function t(v){return root.SSMPDI18n?root.SSMPDI18n.t(v):v;}
function catalog(admin,tabs){var R=root.SSMPDRoles,T=root.SSMPDUITitles,rows=[];Object.keys(T.tabs).forEach(function(tab){if(tabs.indexOf(tab)<0||!R.canSeeTab(admin,tab))return;var label=T.label(tab,admin);rows.push({id:'tab-'+tab,tab:tab,label:t(label),path:t('فتح القسم'),terms:label+' '+t(label)+' '+(aliases[tab]||'')});});if(tabs.indexOf('accounting')>=0&&R.canModuleAction(admin,'accounting','view'))features.forEach(function(f){if(f[0].startsWith('ledger-')&&!(R.hasAnyRole(admin,['super_admin','general_manager'])||R.hasAnyRole(admin,['financial_manager'])&&R.canModuleAction(admin,'accounting','update')))return;rows.push({id:f[0],tab:'accounting',sub:f[3],section:f[4],label:t(f[1]),path:t('الحسابات')+' / '+t(f[3]==='pricing'?'التسعير والخدمات والباكجز':'الخزينة والدورة المالية'),terms:f[1]+' '+t(f[1])+' '+f[2]});});var investment=root.document.querySelector('#user-dropdown a.ud-item[href*="sono-dashboard"]');if(investment&&(R.isSuperAdmin(admin)||admin.role==='general_manager'))rows.push({id:'investment',label:t('لوحة مؤشرات الاستثمار'),path:t('يفتح في تبويب آخر'),terms:'لوحة مؤشرات الاستثمار تحليل الإيراد الايرادات حاسبة فرع جديد investment revenue dashboard',external:investment});if(tabs.indexOf('reception_services')>=0&&R.canSeeTab(admin,'reception_services'))rxFeatures.forEach(function(f){rows.push({id:f[0],tab:'reception_services',rx:{tab:f[3],action:f[4]},label:t(f[1]),path:t('التحصيل والمستلزمات'),terms:f[1]+' '+t(f[1])+' '+f[2]});});return rows;}
function find(term,admin,tabs){var q=normal(term),words=q.split(' ');if(q.length<2)return [];return catalog(admin,tabs).map(function(r){var hay=normal(r.terms);if(!words.every(function(w){return hay.includes(w);}))return null;var label=normal(r.label);r.rank=label===q?0:label.startsWith(q)?1:label.includes(q)?2:3;return r;}).filter(Boolean).sort(function(a,b){return a.rank-b.rank;}).slice(0,12);}
function open(id,admin,tabs,navigate){var r=catalog(admin,tabs).find(function(r){return r.id===id;});if(!r)return false;if(r.external){r.external.click();return true;}if(r.rx){rxOpen(r,navigate);return true;}if(r.sub){if(!root.SSMPDRenderAccounting)return false;root.SSMPDRenderAccounting.selectSection(r.sub,r.section);if(r.sub==='cash'&&root.SSMPDFinanceCash&&root.SSMPDFinanceCash.openSection)root.SSMPDFinanceCash.openSection(r.section);}navigate(r.tab);return true;}
root.SSMPDSearchDestinations={find:find,open:open,catalog:catalog};
})(window);
