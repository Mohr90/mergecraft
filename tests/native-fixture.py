from pathlib import Path
import subprocess
import sys
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 tests/native-fixture.py NEW_DIRECTORY')
root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=False)
def git(*args):
    return subprocess.run(['git','-C',str(root),*args],check=True,capture_output=True,text=True)
git('init','-b','main');git('config','user.email','test@example.com');git('config','user.name','Mergecraft Test')
(root/'a.txt').write_text('first\nbase\nlast\n');(root/'asset.bin').write_bytes(bytes([0,255,1]))
git('add','.');git('commit','-m','base');git('switch','-c','feature/source')
(root/'a.txt').write_text('first\nincoming\nlast\n');(root/'asset.bin').write_bytes(bytes([0,254,2]))
git('add','.');git('commit','-m','incoming');git('switch','main')
(root/'a.txt').write_text('first\nlocal\nlast\n');(root/'asset.bin').write_bytes(bytes([0,253,3]))
git('add','.');git('commit','-m','local')
print(root)

# Use a local disposable bare remote; no real GitLab repository is contacted.
remote=root.with_name(root.name+'-remote.git')
if remote.exists(): raise SystemExit('Remote fixture already exists: '+str(remote))
subprocess.run(['git','init','--bare',str(remote)],check=True,capture_output=True)
git('remote','add','origin',str(remote))
hook=root/'.git/hooks/pre-push'
hook.write_text('#!/bin/sh\nsleep 1.5\n')
hook.chmod(0o755)

git('tag','-a','release/base','HEAD~1','-m','Base release')
git('tag','snapshot/current')
