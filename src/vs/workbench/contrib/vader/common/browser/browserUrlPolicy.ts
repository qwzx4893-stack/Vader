/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the agent's browser tool may open. The model picks the URL, and page text goes back to the
// model, so `file:///...` would read local files around the Policy Engine's path rules, and cloud
// metadata endpoints would hand out instance credentials. localhost and private networks stay
// allowed on purpose: testing a local dev server is the main use of this tool.

const BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata.azure.com', 'instance-data', '[fd00:ec2::254]']);

export function assertNavigableUrl(input: string): string {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new Error(`"${input}" is not a valid absolute URL. Include the scheme, for example https://example.com.`);
	}
	if (url.href === 'about:blank') {
		return url.href;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`The browser tool only opens http and https pages, not "${url.protocol}". Use the file tools to read local files.`);
	}
	const host = url.hostname.toLowerCase();
	if (BLOCKED_HOSTS.has(host) || /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) || /^\[fe80:/.test(host)) {
		throw new Error(`The browser tool does not open link-local or cloud-metadata addresses ("${host}").`);
	}
	return url.href;
}
