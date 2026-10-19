/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { ChatImage, ImageMime, imageMimeOf, MAX_IMAGE_SIDE, MAX_STORED_IMAGE_BYTES, scaledSize } from '../../../../common/imageRules.js'

// Makes a file of an image into what a message carries: it is opened, made smaller when it is larger than providers use, and kept as base64 (common/imageRules.ts).
// Runs in the page; nothing leaves the computer here.

const toBase64 = (bytes: Uint8Array): string => {
	let bin = ''
	const step = 0x8000
	for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step))
	return btoa(bin)
}

const decode = (file: Blob): Promise<{ width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, close: () => void }> =>
	typeof createImageBitmap === 'function'
		? createImageBitmap(file).then(b => ({ width: b.width, height: b.height, draw: (ctx, w, h) => ctx.drawImage(b, 0, 0, w, h), close: () => b.close() }))
		: new Promise((resolve, reject) => {
			const url = URL.createObjectURL(file)
			const img = new Image()
			img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), close: () => URL.revokeObjectURL(url) })
			img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('it could not be opened as an image')) }
			img.src = url
		})

/** the image of a file, made smaller when needed; throws a sentence that says why when it cannot be opened */
export async function chatImageOfFile(file: File, id: string): Promise<ChatImage> {
	const mime = imageMimeOf(file)
	if (!mime) throw new Error('only PNG, JPEG, WebP and GIF images can be sent')
	let decoded: Awaited<ReturnType<typeof decode>>
	try { decoded = await decode(file) } catch { throw new Error('it could not be opened as an image') }
	try {
		const { width, height } = scaledSize(decoded.width, decoded.height, MAX_IMAGE_SIDE)
		const untouched = width === decoded.width && height === decoded.height && file.size <= MAX_STORED_IMAGE_BYTES
		let outMime: ImageMime = mime
		let bytes: Uint8Array
		if (untouched) {
			bytes = new Uint8Array(await file.arrayBuffer())
		} else {
			const canvas = document.createElement('canvas')
			canvas.width = width; canvas.height = height
			const ctx = canvas.getContext('2d')
			if (!ctx) throw new Error('it could not be made smaller')
			if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height) }
			decoded.draw(ctx, width, height)
			// a picture with transparency stays PNG; a photograph becomes JPEG, which is far smaller
			outMime = mime === 'image/png' ? 'image/png' : 'image/jpeg'
			let blob = await new Promise<Blob | null>(r => canvas.toBlob(r, outMime, 0.86))
			if (blob && blob.size > MAX_STORED_IMAGE_BYTES && outMime === 'image/png') { outMime = 'image/jpeg'; blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.82)) }
			if (!blob) throw new Error('it could not be made smaller')
			bytes = new Uint8Array(await blob.arrayBuffer())
		}
		if (bytes.length > MAX_STORED_IMAGE_BYTES * 2) throw new Error('it is too large even after it was made smaller')
		return { id, name: file.name || 'image', mimeType: outMime, base64: toBase64(bytes), bytes: bytes.length, width, height }
	} finally { decoded.close() }
}

/** the images on the clipboard (a screenshot that was copied), or none; asks the browser for them, which may need the person's permission */
export async function imagesOnClipboard(): Promise<File[]> {
	try {
		const items = await navigator.clipboard.read()
		const out: File[] = []
		for (const item of items) {
			const type = item.types.find(t => /^image\/(png|jpeg|webp|gif)$/.test(t))
			if (type) { const blob = await item.getType(type); out.push(new File([blob], `clipboard.${type.split('/')[1].replace('jpeg', 'jpg')}`, { type })) }
		}
		return out
	} catch { return [] }
}
