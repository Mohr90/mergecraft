"""Run the real app on an isolated virtual desktop with bounded startup time."""
from pathlib import Path
import os
import signal
import subprocess


def run_native(arguments, env, log_base, timeout=90):
    log_base = Path(log_base)
    runtime = log_base.parent / 'runtime'
    runtime.mkdir(mode=0o700, exist_ok=True)
    env = dict(env, XDG_RUNTIME_DIR=str(runtime), XDG_CURRENT_DESKTOP='GNOME')
    stdout_path = log_base.with_suffix('.stdout')
    stderr_path = log_base.with_suffix('.stderr')
    # Activated desktop services may inherit stdio and outlive the app. Pipes
    # would wait forever for their EOF even after the app exited successfully.
    with stdout_path.open('w') as out, stderr_path.open('w') as err:
        process = subprocess.Popen(
            ['xvfb-run', '-a', 'dbus-run-session', '--', *arguments],
            env=env, stdout=out, stderr=err, start_new_session=True,
        )
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)
            raise AssertionError('Native startup timeout\n' + stderr_path.read_text(errors='replace')[-16000:])
    return process.returncode, stdout_path.read_text(errors='replace'), stderr_path.read_text(errors='replace')
