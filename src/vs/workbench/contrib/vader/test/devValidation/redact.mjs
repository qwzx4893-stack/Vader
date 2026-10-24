import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function redact(text, secret) {
	let value = String(text);
	if (secret) { value = value.split(secret).join('[REDACTED]'); }
	return value.replace(/Bearer\s+[A-Za-z0-9_./+\-=]+/gi, 'Bearer [REDACTED]');
}

export function sanitizeArtifacts(directory, secret) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isSymbolicLink()) { throw new Error('Symlink in validation artifacts'); }
		if (entry.isDirectory()) { sanitizeArtifacts(file, secret); }
		else if (/\.(jsonl?|log|txt|md|html)$/i.test(file)) {
			const raw = fs.readFileSync(file, 'utf8'); const safe = redact(raw, secret);
			if (safe !== raw) { fs.writeFileSync(file, safe); }
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	sanitizeArtifacts(path.resolve(process.env.DEV_VALIDATION_OUT || 'dev-validation'), process.env.REAL_LLM_API_KEY);
	console.log('Validation text artifacts sanitized before upload.');
}
