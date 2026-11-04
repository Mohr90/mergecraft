"""Exercise native language switching/restart against a disposable real Git conflict."""
from pathlib import Path
import os
import signal
import subprocess
import sys
import tempfile

binary=str(Path(sys.argv[1]).resolve())
script=Path(__file__).with_suffix('.js').resolve()
with tempfile.TemporaryDirectory(prefix='mergecraft-i18n-',ignore_cleanup_errors=True) as directory:
    root=Path(directory)
    repo=root/'repo'
    repo.mkdir()
    def git(*args):
        return subprocess.check_output(['git',*args],cwd=repo,stderr=subprocess.DEVNULL)
    git('init','-q','-b','main')
    git('config','user.name','Test')
    git('config','user.email','test@example.com')
    file=repo/'a.txt'
    file.write_text('base\n')
    git('add','a.txt');git('commit','-qm','base')
    git('switch','-qc','feature')
    file.write_text('incoming\n');git('commit','-qam','incoming')
    git('switch','-q','main')
    file.write_text('local\n');git('commit','-qam','local')
    merge=subprocess.run(['git','merge','feature'],cwd=repo,capture_output=True)
    assert merge.returncode==1
    before_file=file.read_bytes()
    before_index=git('ls-files','--stage')
    before_head=git('rev-parse','HEAD')
    before_merge=git('rev-parse','MERGE_HEAD')
    for restart in [False,True]:
        report=root/f'report-{restart}.txt'
        test_script=root/f'test-{restart}.js'
        test_script.write_text(f'window.__MERGECRAFT_I18N_RESTART__ = {str(restart).lower()};\n'+script.read_text())
        env=dict(os.environ,GDK_BACKEND='x11',MERGECRAFT_SELFTEST=str(test_script),MERGECRAFT_SELFTEST_OUT=str(report),XDG_CONFIG_HOME=str(root/'config'),XDG_DATA_HOME=str(root/'data'),XDG_CACHE_HOME=str(root/'cache'))
        process=subprocess.Popen(['xvfb-run','-a',binary,str(repo)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        try:
            stdout,stderr=process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGTERM)
            stdout,stderr=process.communicate(timeout=5)
            raise AssertionError(f"Native startup timeout\nstdout: {stdout}\nstderr: {stderr}\nreport: {report.read_text() if report.exists() else 'missing'}")
        notes=report.read_text() if report.exists() else ''
        assert process.returncode==0 and 'PASS' in notes and 'FAIL' not in notes,(notes,stderr)
        assert file.read_bytes()==before_file,'language test modified the working file'
        assert git('ls-files','--stage')==before_index,'language test modified index stages'
        assert git('rev-parse','HEAD')==before_head,'language test modified HEAD'
        assert git('rev-parse','MERGE_HEAD')==before_merge,'language test changed the running merge'
        print(notes)
    print('PASS native language changes leave worktree, conflict stages, HEAD and running merge unchanged')
