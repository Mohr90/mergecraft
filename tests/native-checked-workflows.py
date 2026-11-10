"""Exercise v1.4.0 through the real Tauri bridge on a disposable virtual desktop."""
from pathlib import Path
import os, subprocess, sys, tempfile
from native_process import run_native
binary=str(Path(sys.argv[1]).resolve())
tests=Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='mergecraft-v140-native-') as directory:
    root=Path(directory);repo=root/'repo';repo.mkdir()
    def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL)
    git('init','-qb','work');git('config','user.name','Test');git('config','user.email','test@example.com');git('config','core.autocrlf','false')
    (repo/'file.txt').write_text('base\n');(repo/'lines.txt').write_text(''.join(f'line {i}\n' for i in range(20)))
    git('add','.');git('commit','-qm','base');git('switch','-qc','source')
    (repo/'file.txt').write_text('incoming\n');git('commit','-qam','incoming');git('switch','work')
    (repo/'file.txt').write_text('ours\n');git('commit','-qam','ours')
    (repo/'fix.txt').write_text('fix\n');git('add','.');git('commit','-qm','fix')
    (repo/'lines.txt').write_text((repo/'lines.txt').read_text().replace('line 1\n','first\n').replace('line 18\n','last\n'))
    report=root/'report.txt'
    env=dict(os.environ,GDK_BACKEND='x11',MERGECRAFT_SELFTEST=str(tests/'native-checked-workflows.js'),MERGECRAFT_SELFTEST_OUT=str(report),XDG_CONFIG_HOME=str(root/'config'),XDG_DATA_HOME=str(root/'data'),XDG_CACHE_HOME=str(root/'cache'))
    code,stdout,stderr=run_native([binary,str(repo)],env,root/'process')
    notes=report.read_text() if report.exists() else ''
    assert code==0 and 'FAIL' not in notes and 'PASS' in notes,(notes,stdout,stderr)
    assert git('status','--porcelain').strip()==b''
    assert not (repo/'fix.txt').exists()
    assert git('log','-1','--format=%s').decode().startswith('Revert')
    print(notes,flush=True)
