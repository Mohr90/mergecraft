import {analyzeConflict} from './auto';
self.onmessage = (event:MessageEvent<{index:number;base:string[];ours:string[];theirs:string[]}>) => {
 const {index,base,ours,theirs}=event.data;
 self.postMessage({index,proposal:analyzeConflict(base,ours,theirs)});
};
