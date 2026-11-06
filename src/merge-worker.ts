import {analyzeConflict} from './auto';
self.onmessage = (event:MessageEvent<{path:string;index:number;base:string[];ours:string[];theirs:string[]}>) => {
 const {path,index,base,ours,theirs}=event.data;
 self.postMessage({index,proposal:analyzeConflict(base,ours,theirs,path)});
};
