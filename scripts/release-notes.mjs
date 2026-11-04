import {readFileSync,writeFileSync} from 'node:fs';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const section=readFileSync('CHANGELOG.md','utf8').split(`## ${version} —`)[1]?.split('\n## ')[0];
if(!section)throw new Error('Missing release notes');
writeFileSync(process.argv[2]||'release-notes.md',`## Mergecraft ${version}\n${section.slice(section.indexOf('\n'))}\n\n### Downloads\n- **Debian/Ubuntu x86_64:** install the attached .deb using your package manager.\n- **Manual user installation:** the standalone Linux x86_64 executable is attached as mergecraft-linux-x86_64. Requires the same GTK/WebKitGTK libraries as the Debian package.\n- **Integrity:** SHA256SUMS.txt lists all download checksums. These checksums are not independent code signatures.\n\nAvoid parallel installations in /usr/bin and ~/.local/bin: the latter may take precedence in PATH.\n\n[Installation and update guide](https://github.com/Mohr90/mergecraft/blob/v${version}/docs/releases.md)\n`);
