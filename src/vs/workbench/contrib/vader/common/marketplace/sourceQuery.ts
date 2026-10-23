/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';

/** Each source gets a deadline, so one stalled IPC/feed cannot discard the other answers. */
export async function querySource<T>(run: () => Promise<T>, token: CancellationToken): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let listener: { dispose(): void } | undefined;
	try {
		const deadline = new Promise<never>((_, reject) => {
			if (token.isCancellationRequested) { reject(new Error('Search cancelled')); return; }
			listener = token.onCancellationRequested(() => reject(new Error('Search cancelled')));
			timer = setTimeout(() => reject(new Error('took too long to answer')), 12_000);
		});
		return await Promise.race([Promise.resolve().then(() => {
			if (token.isCancellationRequested) throw new Error('Search cancelled');
			return run();
		}), deadline]);
	} finally {
		clearTimeout(timer);
		listener?.dispose();
	}
}
