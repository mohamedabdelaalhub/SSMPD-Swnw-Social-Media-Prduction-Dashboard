(function(){
"use strict";

// Prevent no-op textContent assignments from creating DOM mutations.
// This breaks the MutationObserver feedback loop caused by the compatibility
// layer repeatedly writing the same tab labels back into the DOM.
var d=Object.getOwnPropertyDescriptor(Node.prototype,"textContent");
if(!d||typeof d.get!=="function"||typeof d.set!=="function"||d.configurable===false)return;

Object.defineProperty(Node.prototype,"textContent",{
  configurable:d.configurable,
  enumerable:d.enumerable,
  get:d.get,
  set:function(value){
    var next=value==null?"":String(value);
    if(d.get.call(this)===next)return;
    d.set.call(this,value);
  }
});
})();
