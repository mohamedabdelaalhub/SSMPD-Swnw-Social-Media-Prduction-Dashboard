/* Read-only bridge. Update the EXISTING ads-expenses Web App deployment.
   Do not replace the Drive archive Code.gs or change dashboard config.js.
   Bank reconciliation is deliberately never read or added to totals. */
var ADS_EXPENSES_SHEET_ID = '1iWLoprZNt-F2GTEhpTs6JiOYV5mq7YfIbN7ugAfx_ik';

function doGet(e) {
  var out;
  try { out = readAdsExpenses_(SpreadsheetApp.openById(ADS_EXPENSES_SHEET_ID)); }
  catch (error) { out = { error: 'تعذر قراءة المصدر المالي: ' + error.message }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function readAdsExpenses_(ss) {
  var tz = ss.getSpreadsheetTimeZone();
  var currentMonth = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM');
  function text(value) { return value == null ? '' : String(value).trim(); }
  function date(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    if (typeof value === 'number' && isFinite(value) && value > 0) return new Date(Math.floor(value - 25569) * 86400000).toISOString().slice(0, 10);
    var s = text(value), m;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return '';
  }
  function month(value, day) {
    if (value instanceof Date) return Utilities.formatDate(value, tz, 'yyyy-MM');
    var s = text(value);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return s;
    if (s && s !== '-') throw new Error('شهر غير صالح: ' + s);
    return day ? day.slice(0, 7) : '';
  }
  function money(value, location) {
    if (value === '' || value == null) throw new Error('قيمة مالية فارغة في ' + location);
    var s = text(value).replace(/[٠-٩]/g, function(c) { return String(c.charCodeAt(0)-1632); }).replace(/[,٬\s]/g, '').replace(/٫/g, '.').replace(/−/g, '-');
    var n = typeof value === 'number' ? value : /^[-+]?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
    if (!isFinite(n)) throw new Error('قيمة مالية أو معادلة غير صالحة في ' + location);
    return Math.round(n * 100) / 100;
  }
  function table(name, required) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('الشيت غير موجود: ' + name);
    var rows = sheet.getDataRange().getValues(), headers = (rows[0] || []).map(text), columns = {};
    required.forEach(function(h) { var index = headers.indexOf(h); if (index < 0) throw new Error('عمود غير موجود في ' + name + ': ' + h); columns[h] = index; });
    return { name: name, rows: rows.slice(1), headers: headers, columns: columns };
  }
  function cell(t, row, h) { var index = t.headers.indexOf(h); return index < 0 ? '' : row[index]; }
  function detailRows(t, vendorHeader) {
    var result = [];
    t.rows.forEach(function(row, i) {
      var day = date(cell(t,row,'التاريخ')), value = cell(t,row,'القيمة (جم)');
      if (!day && (value === '' || value == null)) return;
      if (!day && text(cell(t,row,'التاريخ'))) throw new Error('تاريخ غير صالح في ' + t.name + ' صف ' + (i+2));
      var m = month(cell(t,row,'الشهر'),day);
      if (!m) throw new Error('الحركة بلا تاريخ أو شهر في ' + t.name + ' صف ' + (i+2));
      if (day && m !== day.slice(0,7)) throw new Error('الشهر لا يطابق التاريخ في ' + t.name + ' صف ' + (i+2));
      var amount = money(value,t.name+' صف '+(i+2)), type = vendorHeader ? '' : text(cell(t,row,'النوع'));
      if (!vendorHeader && type !== 'سحب' && type !== 'سداد') throw new Error('نوع حركة غير معروف في صف '+(i+2));
      if ((vendorHeader || type === 'سحب') && amount > 0 || type === 'سداد' && amount < 0) throw new Error('إشارة القيمة لا تطابق نوع الحركة في '+t.name+' صف '+(i+2));
      var code=text(cell(t,row,'كود العملية')), card=text(cell(t,row,'آخر 4 أرقام')), vendor=vendorHeader?text(cell(t,row,vendorHeader)):'Facebook';
      var timeValue=cell(t,row,'الوقت'), time=timeValue instanceof Date?Utilities.formatDate(timeValue,tz,'HH:mm'):text(timeValue);
      var item={date:day,time:time,amount:amount,opCode:code,description:text(cell(t,row,'البيان')),month:m,notes:text(cell(t,row,'ملاحظات')),source:text(cell(t,row,'المصدر')),verificationStatus:text(cell(t,row,'حالة التحقق')),cardLast4:card,sourceFile:text(cell(t,row,'ملف المصدر')),sourceRow:i+2};
      if(vendorHeader){item.vendor=vendor;item.originalCurrency=text(cell(t,row,'العملة الأصلية'));item.originalAmount=cell(t,row,'القيمة الأصلية');item.exchangeRate=cell(t,row,'سعر الصرف (AED->EGP)');}else item.type=type;
      // Calculate a matching key independently of the broken ARRAYFORMULA.
      // Keep all source rows. A matching key is not permission to delete a transaction.
      item.dedupeKey=[day||m,amount.toFixed(2),code&&code!=='-'?code.toUpperCase():vendor,type,card].join('|');
      result.push(item);
    });
    return result;
  }
  var tx=table('سجل الحركات',['التاريخ','النوع','القيمة (جم)','الشهر']);
  var oe=table('اشتراكات ومصروفات أخرى',['التاريخ','الجهة/الاشتراك','القيمة (جم)','الشهر']);
  var close=table('الإقفال الشهري',['الشهر','إجمالي سحوبات فيسبوك','إجمالي المسدد','إجمالي اشتراكات ومصروفات أخرى','صافي الحركة','الرصيد المرحّل (افتتاحي)','الرصيد الختامي']);
  var transactions=detailRows(tx,null), otherExpensesItems=detailRows(oe,'الجهة/الاشتراك'), monthly=[];
  close.rows.forEach(function(row,i){
    var value=cell(close,row,'الشهر');
    if(!(value instanceof Date)&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(text(value)))return;
    var m=month(value);if(m>currentMonth)return;
    function n(h){return money(cell(close,row,h),close.name+' صف '+(i+2)+' '+h);}
    monthly.push({month:m,fbSpend:n('إجمالي سحوبات فيسبوك'),paid:n('إجمالي المسدد'),otherExpenses:n('إجمالي اشتراكات ومصروفات أخرى'),netMovement:n('صافي الحركة'),openingBalance:n('الرصيد المرحّل (افتتاحي)'),closingBalance:n('الرصيد الختامي')});
  });
  monthly.sort(function(a,b){return a.month.localeCompare(b.month);});
  var issues=[],seen={};
  transactions.concat(otherExpensesItems).forEach(function(t){if(seen[t.dedupeKey])issues.push('حركتان لهما مفتاح مطابقة واحد: '+t.date);seen[t.dedupeKey]=true;});
  function sum(items,m,type){return items.filter(function(t){return t.month===m&&(!type||t.type===type);}).reduce(function(total,t){return total+Math.round(t.amount*100);},0);}
  monthly.forEach(function(m,i){
    var matches=sum(transactions,m.month,'سحب')===Math.round(m.fbSpend*100)&&sum(transactions,m.month,'سداد')===Math.round(m.paid*100)&&sum(otherExpensesItems,m.month)===Math.round(m.otherExpenses*100);
    var net=Math.round(m.fbSpend*100)+Math.round(m.paid*100)+Math.round(m.otherExpenses*100);
    if(!matches||net!==Math.round(m.netMovement*100)||Math.round(m.openingBalance*100)+net!==Math.round(m.closingBalance*100))issues.push('اختلاف بين الإقفال والحركات في '+m.month);
    if(i&&Math.round(m.openingBalance*100)!==Math.round(monthly[i-1].closingBalance*100))issues.push('الرصيد الافتتاحي لا يطابق الشهر السابق في '+m.month);
  });
  var days=transactions.concat(otherExpensesItems).map(function(t){return t.date;}).filter(Boolean).sort();
  return {sourceSpreadsheetId:ADS_EXPENSES_SHEET_ID,sourceTitle:ss.getName(),generatedAt:new Date().toISOString(),lastRecordAt:days.length?days[days.length-1]:null,monthly:monthly,transactions:transactions,otherExpensesItems:otherExpensesItems,dataQualityIssues:issues};
}
