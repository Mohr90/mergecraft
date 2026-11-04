"""Run real merge resolution and abort fixtures in isolated desktop sessions."""
from pathlib import Path
import os,subprocess,sys,tempfile
from native_process import run_native
binary=str(Path(sys.argv[1]).resolve())
tests=Path(__file__).resolve().parent
for fixture,script in [('native-merge-fixture.py','native-merge-actions.js'),('native-advanced-fixture.py','native-merge-abort.js'),('native-advanced-fixture.py','native-advanced-actions.js')]:
 with tempfile.TemporaryDirectory(prefix='mergecraft-merge-',ignore_cleanup_errors=True) as directory:
  root=Path(directory);repo=root/'repo'
  subprocess.run([sys.executable,str(tests/fixture),str(repo)],check=True,capture_output=True)
  report=root/'report.txt'
  env=dict(os.environ,GDK_BACKEND='x11',MERGECRAFT_SELFTEST=str(tests/script),MERGECRAFT_SELFTEST_OUT=str(report),XDG_CONFIG_HOME=str(root/'config'),XDG_DATA_HOME=str(root/'data'),XDG_CACHE_HOME=str(root/'cache'))
  code,stdout,stderr=run_native([binary,str(repo)],env,root/'process')
  notes=report.read_text() if report.exists() else ''
  print(script,notes,flush=True)
  if code or not notes or 'FAIL' in notes: raise AssertionError(f'{script}: exit={code}\n{stdout}\n{stderr}\n{notes}')
