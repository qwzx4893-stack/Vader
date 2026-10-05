// Vader stand-in (see package.json). @cline/llms does `import { createSAPAIProvider } from '@jerome-benoit/sap-ai-provider'` at load time,
// so the export must exist; calling it - i.e. selecting the SAP AI Core provider - reports clearly that it is not part of Vader.
export function createSAPAIProvider() {
	throw new Error('The SAP AI Core provider is not included in Vader.');
}
