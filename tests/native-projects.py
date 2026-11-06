"""Check repository shortcuts against two disposable real Git repositories."""
from pathlib import Path
import json,os,subprocess,sys,tempfile
from native_process import run_native
binary=str(Path(sys.argv[1]).resolve())
script=Path(__file__).with_suffix('.js').read_text()
with tempfile.TemporaryDirectory(prefix='mergecraft-projects-',ignore_cleanup_errors=True) as directory:
 root=Path(directory);a=root/'team-a'/'demo';b=root/'team-b'/'demo'
 def git(repo,*args):return subprocess.check_output(['git',*args],cwd=repo,stderr=subprocess.DEVNULL)
 for repo in [a,b]:
  repo.mkdir(parents=True);git(repo,'init','-qb','main');git(repo,'config','user.name','Test');git(repo,'config','user.email','test@example.com')
  (repo/'Example.ts').write_text('export const name = "base";\n')
  (repo/'Sample.java').write_text('public class Sample { int count = 1; }\n')
  git(repo,'add','.');git(repo,'commit','-qm','base')
 git(a,'switch','-qc','incoming');(a/'Example.ts').write_text('export const name = "incoming";\n');git(a,'commit','-qam','incoming')
 git(a,'switch','-q','main');(a/'Example.ts').write_text('export const name = "current";\n');git(a,'commit','-qam','current')
 assert subprocess.run(['git','merge','incoming'],cwd=a,capture_output=True).returncode==1
 (a/'Sample.java').write_text('public class Sample { int count = 2; }\n')
 before={str(repo):(git(repo,'rev-parse','HEAD'),git(repo,'ls-files','--stage'),[(p.name,p.read_bytes()) for p in repo.iterdir() if p.is_file()]) for repo in [a,b]}
 for restart in [False,True]:
  test=root/f'test-{restart}.js';report=root/f'report-{restart}.txt'
  test.write_text('window.projectFixture='+json.dumps({'a':str(a),'b':str(b),'restart':restart})+';\n'+script)
  env=dict(os.environ,GDK_BACKEND='x11',MERGECRAFT_SELFTEST=str(test),MERGECRAFT_SELFTEST_OUT=str(report),XDG_CONFIG_HOME=str(root/'config'),XDG_DATA_HOME=str(root/'data'),XDG_CACHE_HOME=str(root/'cache'))
  code,stdout,stderr=run_native([binary,str(a)],env,root/f'process-{restart}')
  notes=report.read_text() if report.exists() else ''
  assert code==0 and 'PASS' in notes and 'FAIL' not in notes,(notes,stderr)
  print(notes,flush=True)
 for repo in [a,b]:
  after=(git(repo,'rev-parse','HEAD'),git(repo,'ls-files','--stage'),[(p.name,p.read_bytes()) for p in repo.iterdir() if p.is_file()])
  assert after==before[str(repo)],'Project switching changed Git state'
 print('PASS real repository worktrees, index stages and HEAD unchanged')
