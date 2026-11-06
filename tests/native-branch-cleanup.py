"""Exercise destructive confirmations only in disposable repositories."""
from pathlib import Path
import os, subprocess, sys, tempfile
from native_process import run_native

tests = Path(__file__).resolve().parent
binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory(prefix="mergecraft-cleanup-") as directory:
    root = Path(directory)
    repo = root / "repo"
    repo.mkdir()
    def git(*args):
        return subprocess.check_output(["git", "-C", str(repo), *args], stderr=subprocess.DEVNULL)
    git("init", "-qb", "main")
    git("config", "user.name", "Test")
    git("config", "user.email", "test@example.com")
    (repo / "file.txt").write_text("base\n")
    git("add", ".")
    git("commit", "-qm", "base")
    git("branch", "merged")
    git("worktree", "add", "-b", "linked", str(root / "linked"))
    git("switch", "-qc", "own-work")
    (repo / "own.txt").write_text("own commit\n")
    git("add", ".")
    git("commit", "-qm", "own")
    git("switch", "-qc", "source", "main")
    (repo / "file.txt").write_text("incoming\n")
    git("commit", "-qam", "incoming")
    git("remote", "add", "origin", "/unused-local-remote")
    git("update-ref", "refs/remotes/origin/task", git("rev-parse", "HEAD").decode().strip())
    git("switch", "main")
    (repo / "file.txt").write_text("my local change\n")
    git("add", "file.txt")
    (repo / "notes.txt").write_text("untracked notes\n")
    report = root / "report.txt"
    env = dict(os.environ, GDK_BACKEND="x11", MERGECRAFT_SELFTEST=str(tests / "native-branch-cleanup.js"),
               MERGECRAFT_SELFTEST_OUT=str(report), XDG_CONFIG_HOME=str(root / "config"),
               XDG_DATA_HOME=str(root / "data"), XDG_CACHE_HOME=str(root / "cache"))
    code, stdout, stderr = run_native([binary, str(repo)], env, root / "process")
    notes = report.read_text() if report.exists() else ""
    assert code == 0 and "PASS" in notes and "FAIL" not in notes, (notes, stdout, stderr)
    assert (repo / "file.txt").read_text() == "incoming\n"
    assert (repo / "notes.txt").read_text() == "untracked notes\n"
    assert git("branch", "--list", "own-work", "merged").strip() == b""
    assert git("symbolic-ref", "--short", "HEAD").strip() == b"task"
    assert git("rev-parse", "--abbrev-ref", "@{upstream}").strip() == b"origin/task"
    assert git("branch", "--list", "linked").strip(), "linked worktree branch was deleted"
    assert git("show-ref", "--verify", "refs/remotes/origin/task").strip()
    print(notes, flush=True)
