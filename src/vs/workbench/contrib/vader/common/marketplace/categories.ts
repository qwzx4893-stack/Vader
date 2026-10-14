/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The sections of Add-ons: what kind of skill, what kind of MCP server, what kind of extension. Most sources tell little or nothing about
// a category, so an item is placed by the words in its name, its description and its tags (and by the category its source gave, when it gave one).
// An item can sit in two sections; one that matches none is in "Other". Choosing a section also tells the sources what to look for (`seeds`).

export type CategoryKind = 'skill' | 'mcp' | 'extension';

export type Category = {
	readonly id: string;
	readonly label: string;
	/** whole words or phrases that put an item in this section */
	readonly keywords: readonly string[];
	/** what to ask the live sources for when this section is chosen (one search each) */
	readonly seeds: readonly string[];
	/** extensions: the name Open VSX gives this section, used as its own filter */
	readonly openVsx?: string;
};

export const CATEGORIES: { readonly [kind in CategoryKind]: readonly Category[] } = {
	skill: [
		{ id: 'documents', label: 'Documents and files', keywords: ['pdf', 'docx', 'word', 'excel', 'xlsx', 'spreadsheet', 'pptx', 'powerpoint', 'slides', 'document', 'documents', 'markdown', 'ocr', 'csv', 'presentation'], seeds: ['pdf', 'documents'] },
		{ id: 'coding', label: 'Coding and review', keywords: ['code', 'coding', 'review', 'refactor', 'lint', 'typescript', 'javascript', 'python', 'rust', 'golang', 'react', 'api', 'git', 'commit', 'pull request', 'debug', 'debugging', 'backend', 'frontend'], seeds: ['code review', 'refactor'] },
		{ id: 'testing', label: 'Testing and QA', keywords: ['test', 'tests', 'testing', 'qa', 'playwright', 'jest', 'pytest', 'e2e', 'coverage', 'benchmark', 'tdd'], seeds: ['testing', 'playwright'] },
		{ id: 'devops', label: 'DevOps and cloud', keywords: ['deploy', 'deployment', 'docker', 'kubernetes', 'k8s', 'ci', 'cd', 'terraform', 'aws', 'azure', 'gcp', 'cloudflare', 'infrastructure', 'devops', 'monitoring', 'observability'], seeds: ['deploy', 'docker'] },
		{ id: 'data', label: 'Data and analytics', keywords: ['data', 'sql', 'database', 'analytics', 'dataset', 'pandas', 'notebook', 'chart', 'charts', 'statistics', 'bigquery'], seeds: ['data analysis', 'sql'] },
		{ id: 'design', label: 'Design and UI', keywords: ['design', 'ui', 'ux', 'css', 'figma', 'brand', 'tailwind', 'theme', 'accessibility', 'layout', 'canvas'], seeds: ['design', 'ui'] },
		{ id: 'writing', label: 'Writing and content', keywords: ['write', 'writing', 'blog', 'copy', 'copywriting', 'email', 'translate', 'translation', 'summary', 'summarize', 'seo', 'content', 'article'], seeds: ['writing', 'content'] },
		{ id: 'research', label: 'Research and web', keywords: ['research', 'search', 'web', 'browser', 'scrape', 'scraping', 'crawl', 'fetch', 'news', 'wiki', 'wikipedia'], seeds: ['research', 'web'] },
		{ id: 'automation', label: 'Productivity and automation', keywords: ['automation', 'automate', 'workflow', 'calendar', 'task', 'tasks', 'notion', 'slack', 'productivity', 'schedule', 'planner', 'todo'], seeds: ['automation', 'workflow'] },
		{ id: 'agents', label: 'Agents and prompts', keywords: ['agent', 'agents', 'mcp', 'prompt', 'prompts', 'skill', 'skills', 'llm', 'claude', 'context', 'memory', 'subagent', 'subagents'], seeds: ['agent', 'prompt'] },
		{ id: 'security', label: 'Security', keywords: ['security', 'vulnerability', 'vulnerabilities', 'audit', 'secret', 'secrets', 'owasp', 'pentest', 'threat', 'malware'], seeds: ['security', 'audit'] },
	],
	mcp: [
		{ id: 'code', label: 'Code and Git', keywords: ['github', 'gitlab', 'bitbucket', 'git', 'repository', 'repositories', 'issues', 'pull request', 'pull requests', 'code', 'ide'], seeds: ['github', 'git'] },
		{ id: 'browser', label: 'Browser and testing', keywords: ['playwright', 'puppeteer', 'browser', 'selenium', 'chrome', 'scrape', 'scraping', 'screenshot', 'e2e'], seeds: ['playwright', 'browser'] },
		{ id: 'databases', label: 'Databases', keywords: ['postgres', 'postgresql', 'mysql', 'sqlite', 'mongodb', 'redis', 'database', 'databases', 'sql', 'supabase', 'neon', 'clickhouse', 'vector'], seeds: ['postgres', 'database'] },
		{ id: 'docs', label: 'Docs and knowledge', keywords: ['documentation', 'docs', 'notion', 'confluence', 'knowledge', 'wiki', 'context7', 'library', 'libraries', 'obsidian', 'notes'], seeds: ['documentation', 'notion'] },
		{ id: 'cloud', label: 'Cloud and DevOps', keywords: ['aws', 'azure', 'gcp', 'cloudflare', 'kubernetes', 'docker', 'terraform', 'vercel', 'netlify', 'deploy', 'infrastructure', 'sentry', 'monitoring'], seeds: ['cloud', 'kubernetes'] },
		{ id: 'chat', label: 'Chat and tickets', keywords: ['slack', 'discord', 'linear', 'jira', 'asana', 'email', 'gmail', 'calendar', 'teams', 'ticket', 'tickets', 'telegram', 'whatsapp', 'trello'], seeds: ['slack', 'linear'] },
		{ id: 'search', label: 'Search and web', keywords: ['search', 'brave', 'tavily', 'exa', 'web', 'fetch', 'crawl', 'firecrawl', 'news', 'maps'], seeds: ['search', 'fetch'] },
		{ id: 'files', label: 'Files and storage', keywords: ['filesystem', 'files', 'file', 'folder', 'drive', 's3', 'storage', 'dropbox'], seeds: ['filesystem', 'storage'] },
		{ id: 'design', label: 'Design and media', keywords: ['figma', 'design', 'canva', 'image', 'images', 'video', 'audio', 'music', 'photo'], seeds: ['figma', 'image'] },
		{ id: 'data', label: 'Data and finance', keywords: ['analytics', 'bigquery', 'snowflake', 'dataset', 'finance', 'stripe', 'payment', 'payments', 'stocks', 'crypto', 'excel'], seeds: ['analytics', 'stripe'] },
		{ id: 'ai', label: 'Memory and AI', keywords: ['memory', 'llm', 'openai', 'anthropic', 'agent', 'agents', 'reasoning', 'thinking', 'sequential', 'knowledge graph'], seeds: ['memory', 'reasoning'] },
	],
	extension: [
		{ id: 'languages', label: 'Programming languages', keywords: ['language', 'languages', 'python', 'java', 'rust', 'golang', 'go', 'typescript', 'php', 'ruby', 'kotlin', 'swift', 'c#', 'dart', 'csharp'], seeds: ['language'], openVsx: 'Programming Languages' },
		{ id: 'linters', label: 'Linters', keywords: ['lint', 'linter', 'eslint', 'pylint', 'static analysis'], seeds: ['lint'], openVsx: 'Linters' },
		{ id: 'formatters', label: 'Formatters', keywords: ['format', 'formatter', 'prettier', 'beautify'], seeds: ['formatter'], openVsx: 'Formatters' },
		{ id: 'debuggers', label: 'Debuggers', keywords: ['debug', 'debugger', 'debugging'], seeds: ['debugger'], openVsx: 'Debuggers' },
		{ id: 'testing', label: 'Testing', keywords: ['test', 'testing', 'jest', 'pytest', 'coverage'], seeds: ['test'], openVsx: 'Testing' },
		{ id: 'scm', label: 'Source control', keywords: ['git', 'github', 'gitlab', 'scm', 'merge'], seeds: ['git'], openVsx: 'SCM Providers' },
		{ id: 'themes', label: 'Themes', keywords: ['theme', 'themes', 'icon theme', 'color theme'], seeds: ['theme'], openVsx: 'Themes' },
		{ id: 'snippets', label: 'Snippets', keywords: ['snippet', 'snippets'], seeds: ['snippets'], openVsx: 'Snippets' },
		{ id: 'ml', label: 'Machine learning', keywords: ['machine learning', 'ai', 'copilot', 'llm', 'jupyter'], seeds: ['ai'], openVsx: 'Machine Learning' },
		{ id: 'data', label: 'Data science and notebooks', keywords: ['data science', 'notebook', 'notebooks', 'jupyter', 'data', 'visualization'], seeds: ['notebook'], openVsx: 'Data Science' },
		{ id: 'keymaps', label: 'Keymaps', keywords: ['keymap', 'keymaps', 'vim', 'emacs', 'keybindings'], seeds: ['vim'], openVsx: 'Keymaps' },
		{ id: 'other', label: 'Other', keywords: [], seeds: ['extension'], openVsx: 'Other' },
	],
};

export const categoryOf = (kind: CategoryKind, id: string): Category | undefined => CATEGORIES[kind].find(c => c.id === id);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = new Map<string, RegExp>();
/** whole-word match, case-insensitive; "c#" and other keywords with symbols still work because the edges are tested around the escaped text */
const hasWord = (text: string, word: string): boolean => {
	let re = wordRe.get(word);
	if (!re) { re = new RegExp(`(^|[^a-z0-9])${escapeRe(word)}($|[^a-z0-9])`, 'i'); wordRe.set(word, re); }
	return re.test(text);
};

export type Classifiable = {
	readonly name: string;
	readonly description?: string;
	readonly tags?: readonly string[];
	/** the section names a source itself gave ("Productivity", "Linters"), matched to ours by their words */
	readonly sourceCategories?: readonly string[];
};

/**
 * The sections an item belongs to, best first, at most two. A word in the name counts for more than one in the description or the tags, and a
 * section the source named itself counts for most. An item that matches nothing is left out of every section (the page lists it under "All").
 */
export function classify(kind: CategoryKind, item: Classifiable): string[] {
	const name = item.name;
	const rest = `${item.description ?? ''} ${(item.tags ?? []).join(' ')}`;
	const given = (item.sourceCategories ?? []).join(' ');
	const scored: { id: string; score: number }[] = [];
	for (const c of CATEGORIES[kind]) {
		let score = 0;
		for (const k of c.keywords) {
			if (hasWord(given, k)) score += 6;
			if (hasWord(name, k)) score += 4;
			if (hasWord(rest, k)) score += 1;
		}
		if (c.openVsx && (item.sourceCategories ?? []).some(s => s.toLowerCase() === c.openVsx!.toLowerCase())) score += 20;
		if (c.id === 'other' && score === 0) continue;
		if (score > 0) scored.push({ id: c.id, score });
	}
	return scored.sort((a, b) => b.score - a.score).slice(0, 2).filter((s, i) => i === 0 || s.score >= 4).map(s => s.id);
}
