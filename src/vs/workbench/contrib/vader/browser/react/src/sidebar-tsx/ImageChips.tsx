/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { ChatImage, cannotReadImagesWords, dataUrlOf } from '../../../../common/imageRules.js'
import { sizeWords } from '../../../../common/attachmentRules.js'

// The images beside a message (boards S03 and R06): each is a small picture with its name and size, and can be removed; when the model that was chosen cannot read
// images, one card says so before anything is sent, with the two ways on. The class names are written out in each className on purpose: the build that scopes
// Tailwind to Vader's UI prefixes only the names it finds written there.

export const ImageChips = ({ images, onRemove }: { images: readonly ChatImage[], onRemove: (id: string) => void }) => {
	if (images.length === 0) return null
	return <div className='flex flex-wrap gap-1.5 px-1 pb-1' data-testid='vader-images'>
		{images.map(i => <div key={i.id} className='flex items-center gap-2 rounded-lg border border-vader-border-2 bg-vader-bg-2 pl-1 pr-2 py-1 motion-safe:animate-card-in' data-testid='vader-image-chip' title={`${i.name}, ${i.width} by ${i.height}`}>
			<img src={dataUrlOf(i)} alt={i.name} className='w-8 h-8 rounded object-cover shrink-0' data-testid='vader-image-thumb' />
			<span className='text-vader-fg-1 max-w-[140px] truncate'>{i.name}</span>
			<span className='text-vader-fg-3 text-xs'>{sizeWords(i.bytes)}</span>
			<button type='button' aria-label={`Remove ${i.name}`} data-testid='vader-image-remove' className='text-vader-fg-3 hover:text-vader-fg-1 text-sm px-0.5' onClick={() => onRemove(i.id)}>&times;</button>
		</div>)}
	</div>
}

export const ImagesBlockedCard = ({ modelName, count, onChoose, onRemove }: { modelName: string, count: number, onChoose: () => void, onRemove: () => void }) =>
	<div className='motion-safe:animate-card-in rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2' data-testid='vader-images-blocked' role='alert'>
		<div className='flex items-center gap-2'>
			<svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' className='shrink-0'><path d='M7.5 2.2 13.3 12.6H1.7z' fill='none' stroke='#e2a93f' strokeWidth='1.3' strokeLinejoin='round' /></svg>
			<span className='font-semibold text-vader-fg-1' data-testid='vader-images-blocked-title'>{cannotReadImagesWords(modelName)}</span>
		</div>
		<div className='text-vader-fg-2 leading-relaxed'>{count === 1 ? 'The image' : `The ${count} images`} would not be sent. Nothing leaves this computer until you choose.</div>
		<div className='flex flex-wrap gap-2 items-center'>
			<button type='button' data-testid='vader-images-choose' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={onChoose}>Choose another model</button>
			<button type='button' data-testid='vader-images-remove-all' className='px-2 py-1 text-vader-fg-2 hover:text-vader-fg-1 text-sm' onClick={onRemove}>{count === 1 ? 'Remove the image' : 'Remove the images'}</button>
		</div>
	</div>
