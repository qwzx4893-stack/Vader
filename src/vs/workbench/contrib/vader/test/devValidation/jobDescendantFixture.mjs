// Isolated fixture. Only writes to the test-provided fresh temporary directory.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [role, directory] = process.argv.slice(2);
const script = fileURLToPath(import.meta.url);
if (role === 'grandchild') {
	globalThis.heldPrivateMemory = Buffer.alloc(32 * 1024 * 1024, 1);
	fs.writeFileSync(path.join(directory, 'grandchild.json'), JSON.stringify({ pid: process.pid, launcher: Number(process.argv[4]) }));
	console.log('grandchild inherited stdout');
	console.error('grandchild inherited stderr');
	setInterval(() => {}, 1000);
} else if (role === 'launcher') {
	// Work completed before the first sample must still contribute to kernel job accounting.
	const bytes = Buffer.alloc(8 * 1024 * 1024, 2);
	fs.writeFileSync(path.join(directory, 'completed-launcher.bin'), bytes);
	fs.readFileSync(path.join(directory, 'completed-launcher.bin'));
	let value = 0;
	const until = Date.now() + 150;
	while (Date.now() < until) { for (let i = 0; i < 100000; i++) { value += Math.sqrt(i); } }
	if (!Number.isFinite(value)) { throw new Error('CPU fixture failed'); }
	const child = spawn(process.execPath, [script, 'grandchild', directory, String(process.pid)], {
		stdio: ['ignore', 'inherit', 'inherit'], detached: true, windowsHide: true,
	});
	child.once('error', () => process.exit(2));
	child.unref();
} else if (role === 'driver') {
	const launcher = spawn(process.execPath, [script, 'launcher', directory], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
	const code = await new Promise((resolve, reject) => { launcher.once('exit', resolve); launcher.once('error', reject); });
	if (code !== 0) { process.exit(3); }
	const deadline = Date.now() + 10000;
	while (!fs.existsSync(path.join(directory, 'grandchild.json'))) {
		if (Date.now() > deadline) { throw new Error('Grandchild fixture did not start'); }
		await new Promise(resolve => setTimeout(resolve, 20));
	}
	console.log('driver exits before any observer sample');
} else { throw new Error('Invalid containment fixture role'); }
