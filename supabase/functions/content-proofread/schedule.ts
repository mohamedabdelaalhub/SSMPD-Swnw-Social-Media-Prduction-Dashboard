import { checkedReview } from './review.ts';
type Fields = Record<string,string>;
export function isSchedule(fields:Fields,labels:Fields) {
  return Object.keys(fields).every(key=>fields[key].length<=80&&/^العيادة \d+ — (اسم الطبيب|التخصص)$/.test(labels[key]||''));
}
function word(text:string,before:string,after:string) {
  return text.replace(new RegExp('(^|[^\\p{L}\\p{M}])'+before+'(?=$|[^\\p{L}\\p{M}])','gu'),(_,prefix)=>prefix+after);
}
export function knownScheduleSpelling(fields:Fields,labels:Fields):Fields {
  const result={...fields};
  for(const key of Object.keys(fields)) {
    if(!/^العيادة \d+ — اسم الطبيب$/.test(labels[key]||''))continue;
    // Explicitly requested spellings. Suggestions only, never an automatic database write.
    result[key]=word(word(fields[key],'أية','آية'),'مصطفي','مصطفى');
  }
  return result;
}
export async function reviewSchedule(fields:Fields,labels:Fields,generate:(fields:Fields,round:number)=>Promise<any>) {
  let working=knownScheduleSpelling(fields,labels);
  const reasons:Record<string,string[]>={};
  for(const key of Object.keys(fields))if(working[key]!==fields[key]){
    reasons[key]=[];
    if(word(fields[key],'أية','آية')!==fields[key])reasons[key].push('كتابة اسم آية بألف المد.');
    if(word(fields[key],'مصطفي','مصطفى')!==fields[key])reasons[key].push('كتابة اسم مصطفى بألف مقصورة.');
  }
  // A second sweep happens even when the first model response misses every error.
  // Merge discoveries against the original fields so the employee acts only once.
  for(let round=0;round<3;round++) {
    const reviewed=checkedReview(await generate({...working},round),working);
    for(const key of Object.keys(working)) {
      const changes=reviewed.issues.filter((issue:any)=>issue.field===key).map((issue:any)=>({...issue,start:working[key].indexOf(issue.before)})).sort((a:any,b:any)=>b.start-a.start);
      for(const issue of changes) {
        working[key]=working[key].slice(0,issue.start)+issue.after+working[key].slice(issue.start+issue.before.length);
        (reasons[key]||=[]).push(issue.reason);
      }
    }
    working=knownScheduleSpelling(working,labels);
    if(round>0&&!reviewed.issues.length)break;
  }
  const issues=Object.keys(fields).filter(key=>working[key]!==fields[key]).map(key=>({
    field:key,category:'spelling',before:fields[key],after:working[key],
    reason:[...new Set(reasons[key]||['تصحيحات لغوية مجمعة لهذا الحقل.'])].join(' ').slice(0,350)
  }));
  return checkedReview({complete:true,issues},fields);
}
