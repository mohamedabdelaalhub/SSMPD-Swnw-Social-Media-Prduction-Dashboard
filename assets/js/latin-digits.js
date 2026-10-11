/* Mohamed 2026-10-11: every design and AI text uses English digits (1234), never ١٢٣٤ / ۱۲۳۴. */
(function(){
 'use strict';
 var map={};'٠١٢٣٤٥٦٧٨٩'.split('').forEach(function(d,i){map[d]=String(i);});'۰۱۲۳۴۵۶۷۸۹'.split('').forEach(function(d,i){map[d]=String(i);});
 function latin(s){return typeof s==='string'?s.replace(/[٠-٩۰-۹]/g,function(d){return map[d];}):s;}
 function deep(v){if(typeof v==='string')return latin(v);if(Array.isArray(v))return v.map(deep);if(v&&typeof v==='object'){var o={};Object.keys(v).forEach(function(k){o[k]=deep(v[k]);});return o;}return v;}
 // Canvas renderers (Dina, doctor, before/after, composer) — draw and measure with English digits.
 var P=window.CanvasRenderingContext2D&&window.CanvasRenderingContext2D.prototype;
 if(P&&!P.__latinDigits){P.__latinDigits=true;['fillText','strokeText','measureText'].forEach(function(n){var f=P[n];if(f)P[n]=function(t){var a=Array.prototype.slice.call(arguments);a[0]=latin(String(t));return f.apply(this,a);};});}
 window.SSMPDDigits={latin:latin,deep:deep};
})();
