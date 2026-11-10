// Synthetic bridge shared by application and language-switch tests.
module.exports = function mockBridge() {
      const state={current:'main',merging:false,resolved:[],created:[],stashes:[],parked:false,rolledPaths:[],externalAhead:null};
      window.testState=state;
      window.testCalls=[];
      window.__TAURI_INTERNALS__={invoke:async(cmd,args={})=>{
        window.testCalls.push({cmd,args});
        const {mockInvoke}=await import('/src/mock.ts');
        if(window.testNoRepository&&['snapshot','open_repo'].includes(cmd))throw new Error('No repository selected');
        if(window.testNoRepository&&cmd==='recent_repos')return [];
        if(window.testStandalone&&cmd==='standalone_data')return mockInvoke('conflict_data',{path:'example.rs'});
        const ok={ok:true,code:0,stdout:'ok',stderr:''};
        if(cmd==='commit_files'&&['slow-test','fast-test'].includes(args.hash)){
          await new Promise(r=>setTimeout(r,args.hash==='slow-test'?150:5));return [{status:'M',path:args.hash+'.txt'}];
        }
        if(cmd==='commit_files'&&args.hash==='failed-test')throw new Error('test commit read failure');
        if(cmd==='stashes')return state.stashes;
        if(cmd==='rollback'){
          state.rolledPaths=args.paths;return ok;
        }
        if(cmd==='save_stash'){
          state.parked=true;state.stashes.unshift({oid:String(state.stashes.length+1).repeat(40),selector:'stash@{0}',message:args.message,timestamp:Date.now()/1000});return ok;
        }
        if(cmd==='apply_stash'){state.parked=false;state.rolledPaths=[];return {...ok,conflicts:[],completed:true};}
        if(cmd==='set_title')return;
        if(cmd==='snapshot'||cmd==='open_repo')return {...await mockInvoke('snapshot'),head_branch:state.current,merging:state.merging};
        if(cmd==='branches'){
          const branches=await mockInvoke('branches');
          for(const name of state.created)branches.push({...branches[0],name,checkout_name:name,full_name:'refs/heads/'+name,upstream:null});
          if(window.testManyBranches)for(let i=0;i<326;i++)branches.push({...branches[0],name:'origin/work/feature-'+String(i).padStart(3,'0'),full_name:'refs/remotes/origin/work/feature-'+String(i).padStart(3,'0'),is_remote:true,is_current:false,upstream:null});
          return branches.map(b=>({...b,is_current:b.name===state.current,...(b.name==='main' && state.externalAhead!==null?{ahead:state.externalAhead}:{})}));
        }
        if(cmd==='branch_log') {
          const commits=await mockInvoke('history');
          return args.outgoing ? commits.slice(0,state.externalAhead??2) : commits;
        }
        if(cmd==='status'){
          const st=await mockInvoke('status');st.merging=state.merging;
          st.conflicts=state.merging ? st.conflicts.filter(c=>!state.resolved.includes(c.path)) : [];
          st.all=st.all.filter(e=>e.state!=='conflicted').concat(st.conflicts);
          if(state.parked){st.all=[];st.staged=[];st.changed=[];st.untracked=[];}
          for(const group of ['all','staged','changed'])st[group]=st[group].filter(e=>!state.rolledPaths.includes(e.path));
          return st;
        }
        if(cmd==='checkout_branch'){state.current=args.track||args.update_from_remote?args.local_name:args.name;return ok;}
        if(cmd==='create_branch'){state.created.push(args.name);state.current=args.name;return ok;}
        if(cmd==='merge_branch'||cmd==='merge_checked'){state.merging=true;return mockInvoke('merge_branch',args);}
        if(cmd==='save_conflict'){if(args.mark_resolved)state.resolved.push(args.path);return ok;}
        if(cmd==='resolve_with_side'){state.resolved.push(args.path);return ok;}
        if(cmd==='merge_abort'&&window.testAbortFailure)return {...ok,ok:false,code:1,stderr:'test abort failure'};
        if(cmd==='merge_continue'||cmd==='merge_abort'){state.merging=false;return ok;}
        if(cmd==='git_raw'&&args.args[0]==='rev-parse')return {...ok,stdout:'d41d8cd98f00b204e9800998ecf8427e0000000000'};
        if(cmd==='commit')return args.message==='fail' ? {...ok,ok:false,code:1,stderr:'test rejection'} : ok;
        return mockInvoke(cmd,args);
      }};
};
