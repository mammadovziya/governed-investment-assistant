# Third-party software notices

This repository declares its direct and transitive JavaScript dependencies in
`package.json` and `package-lock.json`. Those packages are licensed by their
respective authors under their own terms; Apache-2.0 for this project does not
replace those terms.

The production build retains dependency license files inside the pruned
`node_modules` tree. `npm run license:verify` checks that every package shipped
in that runtime tree has a reviewed permissive license expression.

`@mastra/editor` is a development-only dependency used by the loopback Mastra
Studio. The project imports only the package root, whose bundled `LICENSE.md`
identifies non-`ee/` content as Apache-2.0. The separately governed `ee` export
is not imported and the entire editor package is pruned from the production
application and container. Any change to that package boundary requires a new
license review.

An SBOM is generated in CI for every verified revision. Downstream
distributors remain responsible for retaining all dependency notices and for
reviewing the licenses and terms that apply to their chosen model, market-data,
knowledge, identity, and portfolio providers.
