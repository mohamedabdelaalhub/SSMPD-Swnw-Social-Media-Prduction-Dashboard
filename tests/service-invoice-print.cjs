'use strict';
const assert=require('node:assert/strict');
global.window=global;require('../assets/js/service-invoice-print.js');
const R=require('../proposals/doctor-insurance-20261105/service-orders-rules.js');
const P=window.SSMPDServiceInvoicePrint;
const mk=(id,price)=>({id,kind:'lab',service:{id:'s'+id,name:'تحليل <b>'+id+'</b>',price},quantity:1,contract:{discountPercent:10,copayPercent:20}});
const {invoices}=R.buildInvoices([mk(1,100),mk(2,50)]);
const h=P.invoiceHtml(invoices[0],{patientName:'أحمد "س"',insurerName:'شركة',invoiceNo:'INV-1',date:'2026-11-06'});
assert.ok(h.includes('swnw-official-letterhead.png'));assert.ok(h.includes('المعامل'));
assert.ok(!h.includes('<b>1</b>'));assert.ok(h.includes('&lt;b&gt;1&lt;/b&gt;'));assert.ok(h.includes('&quot;'));
assert.ok(h.includes('135.00'));assert.ok(h.includes('27.00'));assert.ok(h.includes('108.00')); // total after 135, patient 27, insurer 108
assert.ok(!/عمولة|commission|referral|provider/i.test(h));
const many=Array.from({length:30},(_,i)=>mk(i+1,10));
const big=R.buildInvoices(many).invoices[0];
const hp=P.invoiceHtml(big,{patientName:'x'});
assert.equal((hp.match(/class="pg"/g)||[]).length,3);assert.equal((hp.match(/class="tot"/g)||[]).length,1);
assert.throws(()=>P.invoiceHtml({lines:[]},{patientName:'x'}));assert.throws(()=>P.invoiceHtml(invoices[0],{}));
console.log('service-invoice-print tests passed');
