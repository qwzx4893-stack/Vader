// Vader addition. A Node ESM loader hook (node:module `register()`/`--import` API, Node 22) used
// only by dependencyReachabilityE2E.mjs. Records whether any of @cline/llms's optional,
// lazily-loaded AI-SDK provider packages that carry known-vulnerable nested dependencies
// (dify-ai-provider, @jerome-benoit/sap-ai-provider, ai-sdk-provider-opencode-sdk) are ever
// actually loaded into the process while running Vader's real code. This is direct, empirical
// evidence for "is this reachable," not an assumption from reading minified bundler output.
const WATCHED = ['dify-ai-provider', 'sap-ai-provider', 'ai-sdk-provider-opencode-sdk'];

export async function load(url, context, nextLoad) {
	if (WATCHED.some(name => url.includes(name))) {
		process.stderr.write(`TRACE-LOAD:${url}\n`);
	}
	return nextLoad(url, context);
}
