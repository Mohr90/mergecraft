from pathlib import Path
import subprocess,sys
root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=False)
def git(*args,check=True):return subprocess.run(['git','-C',str(root),*args],check=check,capture_output=True,text=True)
git('init','-b','main');git('config','user.email','test@example.com');git('config','user.name','Merge Test')
files=['left.txt','right.txt','both.txt','overlap.txt','removed.txt','tail.txt']
for name in files:(root/name).write_text('base' if name=='tail.txt' else 'base\n')
(root/'advanced.txt').write_text('const a=1;\nconst b=2;\nconst c=3;\n');(root/'personal.txt').write_text('original\n');(root/'auto.txt').write_text('let x = 1; let y = 2;\n');(root/'binary.dat').write_bytes(b'\x00base\xff');(root/'clean.txt').write_text('first\nmiddle\nlast\n')
(root/'imports.ts').write_text('export {};\n')
git('add','.');git('commit','-m','base');git('switch','-c','incoming')
for name in files:(root/name).write_text('incoming' if name=='tail.txt' else 'incoming\n')
(root/'advanced.txt').write_text('const a=1;\nconst b=20;\nconst c=3;\n');(root/'auto.txt').write_text('let x = 1; let y = 20;\n');(root/'binary.dat').write_bytes(b'\x00incoming\xfe');(root/'clean.txt').write_text('first\nmiddle\nincoming\n')
(root/'imports.ts').write_text("import { Remote } from './remote';\nexport {};\n")
git('add','.');git('commit','-m','incoming');git('switch','main')
for name in files:
 if name=='removed.txt':(root/name).unlink()
 else:(root/name).write_text('local\n')
(root/'advanced.txt').write_text('const a=10;\nconst b=2;\nconst c=30;\n');(root/'auto.txt').write_text('let x = 10; let y = 2;\n');(root/'binary.dat').write_bytes(b'\x00local\xfd');(root/'clean.txt').write_text('local\nmiddle\nlast\n')
(root/'imports.ts').write_text("import { Local } from './local';\nexport {};\n")
git('add','.');git('commit','-m','local');(root/'personal.txt').write_text('my unrelated local work\n');assert git('merge','incoming',check=False).returncode==1
(root/'notes.txt').write_text('leave me alone\n');print(root)
