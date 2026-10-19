/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Images in a message (boards S03 and R06): which are taken, how big they are made before they are sent, what they cost in the model's window, how a message that
// carries them is given to each kind of provider, and the words for a model that cannot read them. An image goes only to the model the person chose; it is never sent
// anywhere else, and a model that cannot read images is told so before anything is sent. Pure.

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** an image kept with a message: its bytes as base64, and what it looked like when it was taken */
export type ChatImage = {
	readonly id: string;
	readonly name: string;
	readonly mimeType: ImageMime;
	/** raw base64, no "data:...;base64," prefix */
	readonly base64: string;
	readonly bytes: number;
	readonly width: number;
	readonly height: number;
};

export const MAX_IMAGES = 4;
/** an image larger than this on disk is not opened at all */
export const MAX_IMAGE_SOURCE_BYTES = 15 * 1024 * 1024;
/** the longest side of what is sent; a larger image is made smaller first (providers resize anyway, and a big one costs time and money for nothing) */
export const MAX_IMAGE_SIDE = 1568;
/** what is kept with the chat for each image, after it was made smaller */
export const MAX_STORED_IMAGE_BYTES = 1_500_000;

const MIME_OF_EXT: { [ext: string]: ImageMime } = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/** the type of an image file from its type or its name, or undefined when it is not an image Vader can send */
export function imageMimeOf(file: { readonly name: string, readonly type?: string }): ImageMime | undefined {
	const t = (file.type ?? '').toLowerCase();
	if (t === 'image/png' || t === 'image/jpeg' || t === 'image/webp' || t === 'image/gif') return t;
	if (t === 'image/jpg') return 'image/jpeg';
	if (t.startsWith('image/') && t !== 'image/') return undefined; // an image of a kind that is not sent (svg, bmp, tiff, heic)
	const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
	return ext ? MIME_OF_EXT[ext] : undefined;
}

/** is it an image at all, of any kind (so that one that cannot be sent can be refused with a reason) */
export const looksLikeImage = (file: { readonly name: string, readonly type?: string }): boolean => (file.type ?? '').toLowerCase().startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?|heic|avif)$/i.test(file.name);

/** the size an image is made to: its longest side at most `max`, the shape kept */
export function scaledSize(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number, height: number } {
	if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
	const longest = Math.max(width, height);
	if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
	const k = max / longest;
	return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** roughly what an image takes of the model's window, in tokens (width times height over 750, the figure providers publish, at most about 1,600) */
export const imageTokens = (width: number, height: number): number => Math.min(1600, Math.max(85, Math.round((width * height) / 750)));
/** the same in characters, the unit the context budget counts in */
export const imageChars = (width: number, height: number): number => imageTokens(width, height) * 4;

export type ImageRefusal = { readonly name: string, readonly why: string };

/** which of the files dropped or pasted are taken as images, and why each other one is not */
export function checkImages(files: readonly { readonly name: string, readonly size: number, readonly type?: string }[], alreadyAttached: number): { accepted: number[], refused: ImageRefusal[] } {
	const accepted: number[] = [];
	const refused: ImageRefusal[] = [];
	files.forEach((f, i) => {
		if (!looksLikeImage(f)) { refused.push({ name: f.name, why: 'it is not an image' }); return; }
		if (!imageMimeOf(f)) { refused.push({ name: f.name, why: 'only PNG, JPEG, WebP and GIF images can be sent' }); return; }
		if (f.size > MAX_IMAGE_SOURCE_BYTES) { refused.push({ name: f.name, why: `it is larger than ${Math.round(MAX_IMAGE_SOURCE_BYTES / 1024 / 1024)} MB` }); return; }
		if (f.size === 0) { refused.push({ name: f.name, why: 'it is empty' }); return; }
		if (alreadyAttached + accepted.length >= MAX_IMAGES) { refused.push({ name: f.name, why: `${MAX_IMAGES} images is the most for one message` }); return; }
		accepted.push(i);
	});
	return { accepted, refused };
}

/** the words for a model that cannot read images (board S03) */
export const cannotReadImagesWords = (modelName: string): string => `${modelName} cannot read images.`;

// ---- how a message that carries images is given to each kind of provider

export type ProviderImageStyle = 'anthropic' | 'openai' | 'gemini';

export type TextPart = { type: 'text'; text: string };
export type AnthropicImagePart = { type: 'image'; source: { type: 'base64'; media_type: ImageMime; data: string } };
export type OpenAIImagePart = { type: 'image_url'; image_url: { url: string } };
export type GeminiImagePart = { inlineData: { mimeType: ImageMime; data: string } };

/** the parts of a user message with its images: the images first (the order providers advise), then the text */
export function userPartsWithImages(style: 'anthropic', text: string, images: readonly ChatImage[]): (TextPart | AnthropicImagePart)[];
export function userPartsWithImages(style: 'openai', text: string, images: readonly ChatImage[]): (TextPart | OpenAIImagePart)[];
export function userPartsWithImages(style: 'gemini', text: string, images: readonly ChatImage[]): ({ text: string } | GeminiImagePart)[];
export function userPartsWithImages(style: ProviderImageStyle, text: string, images: readonly ChatImage[]): unknown[] {
	if (style === 'anthropic') return [...images.map((i): AnthropicImagePart => ({ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.base64 } })), { type: 'text', text }];
	if (style === 'openai') return [...images.map((i): OpenAIImagePart => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.base64}` } })), { type: 'text', text }];
	return [...images.map((i): GeminiImagePart => ({ inlineData: { mimeType: i.mimeType, data: i.base64 } })), { text }];
}

/** which style a provider takes images in: Anthropic's own, Gemini's own, or the OpenAI-compatible one every other provider uses */
export const imageStyleOfProvider = (providerName: string): ProviderImageStyle => providerName === 'anthropic' ? 'anthropic' : (providerName === 'gemini' || providerName === 'googleVertex') ? 'gemini' : 'openai';

/** what a chat export or a summary says in place of an image (the bytes are never in them) */
export const imagePlaceholder = (i: Pick<ChatImage, 'name'>): string => `[image: ${i.name}]`;

export const dataUrlOf = (i: Pick<ChatImage, 'mimeType' | 'base64'>): string => `data:${i.mimeType};base64,${i.base64}`;

/** which of the messages that carry images are sent with them: none when the model cannot read images, else only the latest few (an older one is named, not repeated) */
export function sentWithImages(carrierIndexes: readonly number[], modelSeesImages: boolean, max: number): Set<number> {
	return new Set(modelSeesImages ? carrierIndexes.slice(-max) : []);
}

/** turns every user message that carries `images` into the parts the provider takes, and removes the field; other messages are left as they are */
export function giveImagesToMessages(messages: { role: string, content: unknown, images?: readonly ChatImage[] }[], style: 'anthropic' | 'openai'): void {
	for (const m of messages) {
		if (m.images && m.images.length > 0 && m.role === 'user') {
			const text = typeof m.content === 'string' ? m.content : (m.content as { type: string, text?: string }[]).filter(c => c.type === 'text').map(c => c.text).join('\n');
			m.content = style === 'anthropic' ? userPartsWithImages('anthropic', text, m.images) : userPartsWithImages('openai', text, m.images);
		}
		delete m.images;
	}
}
