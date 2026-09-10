(function(){
"use strict";

function installHeightField(){
  var weight=document.getElementById("mp-weight");
  if(!weight||document.getElementById("mp-height"))return;
  var weightField=weight.closest(".field");
  if(!weightField||!weightField.parentNode)return;
  var field=document.createElement("div");
  field.className="field";
  field.style.cssText="flex:1;min-width:120px;";
  field.innerHTML='<label>الطول</label><input id="mp-height" placeholder="مثال: 170 سم">';
  weightField.insertAdjacentElement("afterend",field);

  var patientId=null;
  var modal=weight.closest(".modal");
  if(modal){
    var title=modal.querySelector(".modal-head h3");
    if(title)title.dataset.heightExtension="1";
  }
}

function wrapSave(){
  if(!window.SSMPDDb||typeof window.SSMPDDb.savePatientMedicalProfile!=="function"||window.SSMPDDb.__heightWrapped)return;
  var original=window.SSMPDDb.savePatientMedicalProfile;
  window.SSMPDDb.savePatientMedicalProfile=function(patientId,patch,updatedBy){
    var height=document.getElementById("mp-height");
    if(height&&patch&&typeof patch==="object")patch.height=height.value.trim()||null;
    return original.call(this,patientId,patch,updatedBy);
  };
  window.SSMPDDb.__heightWrapped=true;
}

function hydrateHeight(){
  var input=document.getElementById("mp-height");
  if(!input||input.dataset.hydrated==="1")return;
  input.dataset.hydrated="1";
  var patientId=null;
  var editBtn=document.querySelector('[data-edit-medical-profile][data-patient-id]');
  if(editBtn)patientId=editBtn.getAttribute("data-patient-id");
  if(!patientId||!window.SSMPDDb||typeof window.SSMPDDb.getPatientMedicalProfile!=="function")return;
  window.SSMPDDb.getPatientMedicalProfile(patientId).then(function(profile){
    if(document.getElementById("mp-height")===input&&profile)input.value=profile.height||"";
  }).catch(function(){});
}

function apply(){wrapSave();installHeightField();hydrateHeight();}
apply();
new MutationObserver(function(){setTimeout(apply,0);}).observe(document.body,{childList:true,subtree:true});
})();
