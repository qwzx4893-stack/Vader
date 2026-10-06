# Extensions in Vader

Vader installs extensions from the **Open VSX** registry (`open-vsx.org`, run by the Eclipse Foundation), configured in `product.json` under
`extensionsGallery`. Microsoft's Visual Studio Marketplace is not used: its terms restrict it to Microsoft's own products.

## Signature verification is off by default

VS Code can verify that a downloaded extension was signed before installing it. That check (the `@vscode/vsce-sign` module) only trusts the
certificate chain of Microsoft's marketplace. Open VSX extensions are not signed with that chain, so with the check on, **every** extension is
refused with "Cannot install ... because Vader cannot verify the extension signature". Vader therefore ships with
`extensions.verifySignature` set to `false`.

What that means in practice:

- Extensions are still downloaded over HTTPS from `open-vsx.org`; what you give up is the signature check VS Code runs on top of that.
- Install only extensions you trust, as with any editor. Installing an extension always asks first, and the agent can never install one without
  your approval.
- Prefer extensions from verified publishers (Open VSX marks them) and check the publisher and download count on the extension page.
- You can turn the check back on in Settings (`extensions.verifySignature`); expect most extensions to be refused unless they carry a signature
  your build can verify.

## Not finding an extension

Some publishers (notably Microsoft's own C/C++, Remote and Live Share extensions) do not publish to Open VSX. Search for an Open VSX alternative,
or install a `.vsix` you trust with **Extensions: Install from VSIX...**.
