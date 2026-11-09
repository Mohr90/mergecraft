import type { ConflictData, Region } from "./api";
import { analyzeConflict, changes, type Proposal } from "./auto";

export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

type Side = "base" | "ours" | "theirs";
const sides: Side[] = ["base","ours","theirs"];

// Split only mixed regions. The diff aligns insertions and deletions to base
// offsets. Touching an insertion from either side keeps the boundary together.
function splitMixed(region: Region, lines: Record<Side,string[]>): Region[] {
  if (region.kind !== "conflict" || region.base[1] < 2 || Math.max(...sides.map(s=>region[s][1])) > 400) return [region];
  const slice = (s:Side) => lines[s].slice(region[s][0], region[s][0]+region[s][1]);
  const base = slice("base"), originals = new Set(base);
  if (originals.size !== base.length) return [region];
  const edits = [];
  for (const side of ["ours","theirs"] as const) {
    const value = slice(side);
    if (!value.length || new Set(value).size !== value.length) return [region];
    const delta = changes(base,value);
    if (!delta || delta.some(e=>e.text.some(line=>originals.has(line)))) return [region];
    for (const edit of delta) {
      const length = edit.end-edit.start;
      // Positional splitting of adjacent replacements needs an identifiable
      // line on both sides (e.g. the same assignment or return statement).
      const key = (line:string) => line.trim().match(/^[\w.$]+(?:\s+[\w.$]+)*(?=[\s=(;:]|$)/)?.[0];
      const aligned = length>1 && length===edit.text.length && edit.text.every((line,i)=>{
        const prefix=key(base[edit.start+i]);
        return !!prefix && prefix===key(line);
      });
      if (aligned) {
        for (let i=0;i<length;i++) edits.push({side,start:edit.start+i,end:edit.start+i+1,count:1});
      } else edits.push({side,start:edit.start,end:edit.end,count:edit.text.length});
    }
  }
  edits.sort((a,b)=>a.start-b.start || a.end-b.end);
  const groups: {start:number;end:number;boundary:boolean;ours:number;theirs:number}[]=[];
  for (const e of edits) {
    let group=groups[groups.length-1];
    if (!group || e.start>group.end || (e.start===group.end && !group.boundary && e.start!==e.end)) {
      group={start:e.start,end:e.end,boundary:false,ours:0,theirs:0};
      groups.push(group);
    }
    group.end=Math.max(group.end,e.end);
    group.boundary=e.start===e.end && e.end===group.end;
    group[e.side]+=e.count-(e.end-e.start);
  }
  let offset=0;
  const pos={base:region.base[0],ours:region.ours[0],theirs:region.theirs[0]};
  const parts:Region[]=[];
  function add(kind:Region["kind"],b:number,l:number,r:number) {
    parts.push({kind,base:[pos.base,b],ours:[pos.ours,l],theirs:[pos.theirs,r]});
    pos.base+=b;pos.ours+=l;pos.theirs+=r;
  }
  for (const group of groups) {
    const gap=group.start-offset, len=group.end-group.start;
    if (gap) add("unchanged",gap,gap,gap);
    add("conflict",len,len+group.ours,len+group.theirs);
    offset=group.end;
  }
  if (offset<base.length) add("unchanged",base.length-offset,base.length-offset,base.length-offset);
  const equal=(s:Side,other:Side,r:Region)=>r[s][1]===r[other][1] &&
    lines[s].slice(r[s][0],r[s][0]+r[s][1]).every((line,i)=>line===lines[other][r[other][0]+i]);
  const disputed=(r:Region)=>!equal("ours","theirs",r)&&!equal("base","ours",r)&&!equal("base","theirs",r);
  const conflict=parts.filter(p=>p.kind==="conflict");
  return conflict.some(disputed)&&conflict.some(p=>!disputed(p)) ? parts : [region];
}

export function prepareConflict(data:ConflictData):ConflictData {
  if (data.guarded || data.working_modified || data.ours.binary || data.theirs.binary || !data.ours.exists || !data.theirs.exists) return data;
  const lines={base:splitLines(data.base.text),ours:splitLines(data.ours.text),theirs:splitLines(data.theirs.text)};
  return {...data,regions:data.regions.flatMap(region=>splitMixed(region,lines))};
}

export interface PlannedRegion {index:number;proposal:Proposal|null}
export function planFile(source:ConflictData):PlannedRegion[] {
  if (source.working_modified || source.ours.binary || source.theirs.binary || !source.ours.exists || !source.theirs.exists) return [{index:-1,proposal:null}];
  const data=prepareConflict(source);
  const lines={base:splitLines(data.base.text),ours:splitLines(data.ours.text),theirs:splitLines(data.theirs.text)};
  return data.regions.flatMap((r,index)=>{
    if (r.kind!=="conflict" && !(data.guarded && r.kind!=="unchanged")) return [];
    const part=(s:Side)=>lines[s].slice(r[s][0],r[s][0]+r[s][1]);
    const eof=index===data.regions.length-1 && data.ours.text.endsWith("\n")!==data.theirs.text.endsWith("\n");
    return [{index,proposal:data.guarded||eof?null:analyzeConflict(part("base"),part("ours"),part("theirs"),data.path)}];
  });
}
