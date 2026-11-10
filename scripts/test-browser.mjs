import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], { stdio: 'inherit' });
let test;
const stop = () => { test?.kill('SIGTERM'); server.kill('SIGTERM'); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  let ready = false;
  for (let attempt = 0; attempt < 200 && server.exitCode === null; attempt++) {
    try { ready = (await fetch(url)).ok; } catch { /* Server is still starting. */ }
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('The browser test server did not start.');
  for (const file of ['tests/browser.cjs','tests/i18n.cjs','tests/updates.cjs','tests/projects.cjs','tests/branch-cleanup.cjs','tests/bulk-branches.cjs','tests/checked-workflows.cjs','tests/v050-demo.cjs',...(process.env.MERGECRAFT_SCREENSHOT_DIR?['tests/merge-demo.cjs']:[])]) {
    test = spawn(process.execPath, [file], { stdio: 'inherit', env: { ...process.env, MERGECRAFT_TEST_URL: url, MERGECRAFT_I18N_SCREENSHOT_DIR:process.env.MERGECRAFT_I18N_SCREENSHOT_DIR||process.env.MERGECRAFT_SCREENSHOT_DIR } });
    const code = await new Promise((resolve, reject) => {
      test.once('error', reject);
      test.once('exit', code => resolve(code ?? 1));
    });
    if(code!==0){process.exitCode=code;break;}
  }
} finally {
  stop();
}
