// Screenshot-only masking; does not alter the app, user actions or result assertions.
export function protectScreenshots(page, secret) {
	const capture = page.screenshot.bind(page);
	page.screenshot = options => capture({ ...options,
		mask: [...(options?.mask ?? []), page.locator('input[type="password"],input[placeholder^="API Key"],input[data-testid="vader-onboarding-key"]'),
			...(secret ? [page.getByText(secret, { exact: false })] : [])],
	});
}
