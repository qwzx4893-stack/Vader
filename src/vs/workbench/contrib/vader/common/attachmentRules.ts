/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Files dropped on the message box (board S03, "Files attached" and "Dropping a file"): how many and how big, which can be read as text, and the words for what was
// not taken. A text file is read and kept beside the message like a long paste; an image or another binary file is not taken, and the note says why. Pure.

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type DroppedFile = { readonly name: string, readonly size: number, readonly type?: string };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|heic|avif|tiff?)$/i;
const BINARY_EXT = /\.(zip|gz|tgz|7z|rar|tar|pdf|docx?|xlsx?|pptx?|exe|dll|so|dylib|bin|class|jar|mp3|mp4|mov|wav|avi|woff2?|ttf|otf|sqlite|db)$/i;

/** 84 KB, 1.2 MB, 512 B */
export function sizeWords(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	const mb = bytes / (1024 * 1024);
	return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`;
}

export type DropVerdict = { readonly accepted: DroppedFile[], readonly refused: { readonly name: string, readonly why: string }[] };

/** which of the dropped files are taken (the room left for them is what is not yet attached) and why each other one is not */
export function checkDrop(files: readonly DroppedFile[], alreadyAttached: number): DropVerdict {
	const accepted: DroppedFile[] = [];
	const refused: { name: string, why: string }[] = [];
	for (const f of files) {
		if (f.type?.startsWith('image/') || IMAGE_EXT.test(f.name)) refused.push({ name: f.name, why: 'images are not sent yet, only text files' });
		else if (BINARY_EXT.test(f.name)) refused.push({ name: f.name, why: 'it is not a text file' });
		else if (f.size === 0) refused.push({ name: f.name, why: 'it is empty' });
		else if (f.size > MAX_FILE_BYTES) refused.push({ name: f.name, why: `it is ${sizeWords(f.size)}, and the limit is ${sizeWords(MAX_FILE_BYTES)}` });
		else if (alreadyAttached + accepted.length >= MAX_FILES) refused.push({ name: f.name, why: `${MAX_FILES} files is the most for one message` });
		else accepted.push(f);
	}
	return { accepted, refused };
}

/** a file that was read and turned out not to be text (a binary file with a text name) */
export const looksBinary = (text: string): boolean => text.includes('\u0000') || (text.length > 0 && (text.match(/�/g)?.length ?? 0) / text.length > 0.02);

/** the note under the box after a drop */
export function dropNote(v: DropVerdict): string | undefined {
	if (v.refused.length === 0) return undefined;
	const lines = v.refused.slice(0, 3).map(r => `${r.name}: ${r.why}.`);
	const more = v.refused.length > 3 ? ` ${v.refused.length - 3} more were not attached.` : '';
	return `${v.accepted.length > 0 ? `${v.accepted.length} attached. ` : ''}Not attached — ${lines.join(' ')}${more}`;
}

export const DROP_TITLE = 'Drop to attach';
export const dropHint = (): string => `Up to ${MAX_FILES} files, ${sizeWords(MAX_FILE_BYTES)} each`;
