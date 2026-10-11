# Release and deployment

The project builds a static web application in `dist/`. Generated output is
not committed to the source repository and no hosting service is configured by
this project.

## Pre-release checks

1. Confirm that application and embedded encoder versions are correct in
   `package.json`, `web/index.html`, `CHANGELOG.md`, and `README.md`.
2. Review `git status` and the staged diff. Do not commit local environment
   files, credentials, private keys, signing material, or generated `dist/`
   output.
3. Verify the vendored source checksum:

   ```bash
   sha256sum --check SHA256SUMS.txt
   ```

4. Build and run all local checks:

   ```bash
   npm run build
   npm test
   npm run serve
   ```

5. In another terminal, run:

   ```bash
   npm run smoke
   ```

6. Manually review at least one light-theme and one dark-theme layout on a
   desktop viewport and on a narrow portrait viewport. Test keyboard focus,
   a custom HCC2D4 palette, a file input, PNG download, and an intentional
   capacity error. Switch through all five languages and check the longest
   translated labels at both viewport sizes.
7. Using the local server, generate and download a symbol, then reload once
   without network access to confirm that the service-worker cache was
   populated.

## Static self-hosting

Run `npm run build` and publish the contents of `dist/`. The host should:

- use HTTPS in production so service workers are available;
- serve `.wasm` files as `application/wasm`;
- preserve the relative directory layout;
- serve `index.html` for the application root;
- apply cache invalidation suitable for the site's release process.

Apache-2.0 permits self-hosting and redistribution subject to the complete
terms in [LICENSE](LICENSE). Do not replace the license text with this summary.
