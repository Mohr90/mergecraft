// Explicit text proposals, never semantic or automatic writes.
function same(a:string[],b:string[]) {return a.length===b.length&&a.every((v,i)=>v===b[i]);}
type Edit={start:number;end:number;text:string[]};
function changes(base:string[],value:string[]):Edit[]|null {
 const n=base.length,m=value.length;if((n+1)*(m+1)>250000)return null;
 const width=m+1,dp=new Uint32Array((n+1)*width);
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i*width+j]=base[i]===value[j]?1+dp[(i+1)*width+j+1]:Math.max(dp[(i+1)*width+j],dp[i*width+j+1]);
 const out:Edit[]=[];let i=0,j=0;
 while(i<n||j<m){
  if(i<n&&j<m&&base[i]===value[j]){i++;j++;continue;}
  const start=i,text:string[]=[];
  while(i<n||j<m){
   if(i<n&&j<m&&base[i]===value[j])break;
   if(j<m&&(i===n||dp[i*width+j+1]>dp[(i+1)*width+j]))text.push(value[j++]);else i++;
  }
  out.push({start,end:i,text});
 }
 return out;
}
function combine(base:string[],left:string[],right:string[],characters=false):string[]|null {
 const a=changes(base,left),b=changes(base,right);if(!a||!b)return null;
 const all:Edit[]=[...a];
 for(const change of b){
  let duplicate=false;
  for(const own of a){
   if(own.start===change.start&&own.end===change.end&&same(own.text,change.text)){duplicate=true;continue;}
   // Shared boundaries including insertion points remain manual.
   if(!(own.end<change.start||change.end<own.start))return null;
  }
  if(!duplicate)all.push(change);
 }
 if(!characters){
  for(const change of all){
   const context=change.end>change.start ? base.slice(change.start,change.end) : base.slice(Math.max(0,change.start-2),Math.min(base.length,change.end+2));
   let matches=0;
   for(let i=0;i+context.length<=base.length;i++)if(context.every((line,k)=>base[i+k]===line))matches++;
   if(!context.length||matches!==1)return null;
  }
 }
 if(characters){
  const original=base.join('');
  for(const change of all){
   const removed=base.slice(change.start,change.end).join('');
   const context=removed||base.slice(Math.max(0,change.start-8),Math.min(base.length,change.end+8)).join('');
   if(!context||original.indexOf(context)!==original.lastIndexOf(context))return null;
  }
 }
 let result=[...base];
 for(const change of all.sort((x,y)=>y.start-x.start))result.splice(change.start,change.end-change.start,...change.text);
 return result;
}
export function simpleConflictResolution(base:string[],left:string[],right:string[]):string[]|null {
 if(same(left,right))return [...left];if(same(base,left))return [...right];if(same(base,right))return [...left];
 if(base.length===left.length&&base.length===right.length){
  const result:string[]=[];
  for(let i=0;i<base.length;i++){
   if(left[i]===right[i])result.push(left[i]);else if(left[i]===base[i])result.push(right[i]);else if(right[i]===base[i])result.push(left[i]);
   else {const line=combine([...base[i]],[...left[i]],[...right[i]],true);if(line===null)return null;result.push(line.join(''));}
  }
  return result;
 }
 // Empty-base competing insertions and modify/delete remain explicit choices.
 if(!base.length||!left.length||!right.length)return null;
 return combine(base,left,right);
}

export interface Proposal { lines:string[]; kind:'safe'|'review'; reason:'same'|'one-side'|'separate'|'characters'; }
export function analyzeConflict(base:string[],left:string[],right:string[]):Proposal|null {
 if(same(left,right))return {lines:[...left],kind:'safe',reason:'same'};
 if(same(base,left)||same(base,right))return {lines:same(base,left)?[...right]:[...left],kind:'safe',reason:'one-side'};
 if(!base.length||!left.length||!right.length)return null;
 const safe=combine(base,left,right);
 if(safe!==null)return {lines:safe,kind:'safe',reason:'separate'};
 const proposal=simpleConflictResolution(base,left,right);
 return proposal===null ? null : {lines:proposal,kind:'review',reason:'characters'};
}
