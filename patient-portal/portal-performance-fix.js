(function(){
"use strict";

/*
  The portal has several compatibility scripts that observe #portal-root.
  They only need to react when the main app replaces the root view, not to
  every nested DOM change they themselves make.  Observing the whole subtree
  caused the observers to wake each other repeatedly and could freeze Chrome.

  Keep MutationObserver native everywhere else, but for #portal-root force
  subtree=false.  This preserves login/profile re-render detection while
  preventing self-triggering loops inside tabs, cards and content sections.
*/
var NativeMutationObserver=window.MutationObserver;
if(typeof NativeMutationObserver!=="function")return;

window.MutationObserver=function(callback){
  var observer=new NativeMutationObserver(callback);
  var nativeObserve=observer.observe.bind(observer);
  observer.observe=function(target,options){
    var next=options||{};
    if(target&&target.id==="portal-root"){
      next=Object.assign({},next,{subtree:false,childList:true});
    }
    return nativeObserve(target,next);
  };
  return observer;
};
window.MutationObserver.prototype=NativeMutationObserver.prototype;
})();
