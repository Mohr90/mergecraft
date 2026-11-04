import {readFileSync} from 'node:fs';
const json = path => JSON.parse(readFileSync(path,'utf8'));
const version = json('package.json').version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be stable SemVer.');
for (const file of ['package-lock.json','src-tauri/tauri.conf.json']) {
 if (json(file).version !== version) throw new Error(`Version mismatch in ${file}`);
}
if (json('package-lock.json').packages[''].version !== version) throw new Error('Lockfile root version mismatch.');
for (const file of ['src-tauri/Cargo.toml','core/Cargo.toml']) {
 if (!readFileSync(file,'utf8').includes(`version = "${version}"`)) throw new Error(`Version mismatch in ${file}`);
}
const tag = process.env.RELEASE_TAG;
if (tag && tag !== `v${version}`) throw new Error(`Tag ${tag} does not match v${version}.`);
const changelog = readFileSync('CHANGELOG.md','utf8');
if (!changelog.includes(`## ${version} —`)) throw new Error(`Missing changelog for ${version}.`);
console.log(`Release metadata consistent: v${version}`);
