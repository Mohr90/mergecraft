import { combineImports, extendNamedImport } from "./import-proposal";

// Explicit text proposals, never semantic or automatic writes.
function same(a:string[],b:string[]) {return a.length===b.length&&a.every((v,i)=>v===b[i]);}
type Edit={start:number;end:number;text:string[]};
function changes(base:string[],value:string[]):Edit[]|null {
 const n=base.length,m=value.length;
 if ((n+1)*(m+1)>250000) {
  // A large region can contain just a small edit. Bound the diff matrix by
  // the changed window; combine still validates ambiguity against the full base.
  let start=0, end=0;
  while(start<n && start<m && base[start]===value[start])start++;
  while(end<n-start && end<m-start && base[n-end-1]===value[m-end-1])end++;
  if(!start && !end)return null;
  const inner=changes(base.slice(start,n-end),value.slice(start,m-end));
  return inner?.map(edit=>({...edit,start:edit.start+start,end:edit.end+start})) ?? null;
 }
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
   // Adjacent replacements consume disjoint half-open line ranges. An
   // insertion at a shared boundary still needs an ordering decision.
   const adjacentReplacements = !characters && own.start < own.end && change.start < change.end
     && (own.end === change.start || change.end === own.start);
   if (!(own.end < change.start || change.end < own.start || adjacentReplacements)) return null;
  }
  if(!duplicate)all.push(change);
 }
 if(!characters){
  const originals = new Set(base);
  for(const change of all){
   // Copied or moved source lines make positional alignment ambiguous.
   if (change.text.some(line => originals.has(line))) return null;
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

export interface Proposal { lines:string[]; kind:'safe'|'review'; reason:'same'|'one-side'|'separate'|'characters'|'imports'; }
export function analyzeConflict(base:string[],left:string[],right:string[], path = ""):Proposal|null {
 if(same(left,right))return {lines:[...left],kind:'safe',reason:'same'};
 if(same(base,left)||same(base,right))return {lines:same(base,left)?[...right]:[...left],kind:'safe',reason:'one-side'};
 if (!base.length && left.length && right.length) {
  const lines = combineImports(path, left, right);
  return lines ? {lines, kind:'review', reason:'imports'} : null;
 }
 if(!base.length||!left.length||!right.length)return null;
 // Import declarations with conflicting bindings or module changes should
 // never fall through to a character-level guess.
 if (/\.[cm]?[jt]sx?$/.test(path) && [base,left,right].every(side => side.length === 1) &&
     [base,left,right].some(side => /^\s*import\b/.test(side[0]))) {
  const line = extendNamedImport(base[0],left[0],right[0]);
  return line === null ? null : {lines:[line],kind:'review',reason:'imports'};
 }
 const safe=combine(base,left,right);
 if(safe!==null)return {lines:safe,kind:'safe',reason:'separate'};
 if (base.length !== left.length || base.length !== right.length) return null;
 const originals = new Set(base);
 if (originals.size !== base.length || !base.some((line,i) =>
   left[i] !== line && right[i] !== line && left[i] !== right[i])) return null;
 if ([left,right].some(side => side.some((line,i) => line !== base[i] && originals.has(line)))) return null;
 const proposal=simpleConflictResolution(base,left,right);
 return proposal===null ? null : {lines:proposal,kind:'review',reason:'characters'};
}
