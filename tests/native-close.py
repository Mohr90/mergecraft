"""Verify real native close events, including cancellation of a dirty merge."""
from pathlib import Path
import os
import signal
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
script = str(Path(__file__).with_suffix('.js').resolve())
with tempfile.TemporaryDirectory(prefix='mergecraft-close-', ignore_cleanup_errors=True) as directory:
    root = Path(directory)
    repo = root / 'repo'
    repo.mkdir()
    subprocess.run(['git', 'init', '-q', '-b', 'main', str(repo)], check=True)
    for name, value in {'ours': 'a\nLOCAL\nz\n', 'base': 'a\nBASE\nz\n', 'theirs': 'a\nREMOTE\nz\n', 'merged': 'a\nLOCAL\nz\n'}.items():
        (root / name).write_text(value)
    for mode in ['normal', 'dirty-merge', 'saved-merge', 'partial-merge']:
        (root / 'merged').write_text('a\nLOCAL\nz\n')
        result_file = root / (mode + '.txt')
        mode_script = root / (mode + '.js')
        mode_script.write_text('window.__MERGECRAFT_CLOSE_TEST_SAVE__ = '+('true' if mode == 'saved-merge' else 'false')+';\nwindow.__MERGECRAFT_CLOSE_TEST_PARTIAL__ = '+('true' if mode == 'partial-merge' else 'false')+';\n'+Path(script).read_text())
        env = dict(os.environ, GDK_BACKEND='x11', MERGECRAFT_SELFTEST=str(mode_script),
                   MERGECRAFT_SELFTEST_OUT=str(result_file), XDG_CONFIG_HOME=str(root / 'config'),
                   XDG_DATA_HOME=str(root / 'data'), XDG_CACHE_HOME=str(root / 'cache'))
        args = [str(repo)] if mode == 'normal' else ['--merge', *[str(root / name) for name in ['ours', 'base', 'theirs', 'merged']]]
        process = subprocess.Popen(['xvfb-run', '-a', binary, *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            stdout, stderr = process.communicate(timeout=25)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=5)
            raise AssertionError(f'{mode}: application did not close; {result_file.read_text() if result_file.exists() else stderr}')
        notes = result_file.read_text() if result_file.exists() else ''
        assert 'FAIL' not in notes and 'PASS' in notes, (mode, notes, stderr)
        assert process.returncode == (1 if mode in ['dirty-merge','partial-merge'] else 0), (mode, process.returncode, notes, stderr)
        if mode == 'dirty-merge':
            assert 'close cancelled, edits preserved' in notes
            assert (root / 'merged').read_text() == 'a\nLOCAL\nz\n'
        if mode == 'saved-merge':
            assert (root / 'merged').read_text() == 'a\nREMOTE\nz\n'
        if mode == 'partial-merge':
            assert '<<<<<<<' in (root / 'merged').read_text()
        print(f'PASS native window close and exit code: {mode}')
