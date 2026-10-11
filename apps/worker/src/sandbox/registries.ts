// Package registries the containers may reach directly, so setup can install dependencies for every
// language evidence supports, and osv-scanner can look up advisories. Nothing else gets out:
// git traffic goes through the Outbound gateway with repo-scoped tokens.
export const REGISTRY_HOSTS = [
	"registry.npmjs.org",
	"registry.yarnpkg.com",
	"repo.yarnpkg.com",
	"index.crates.io",
	"static.crates.io",
	"crates.io",
	"pypi.org",
	"files.pythonhosted.org",
	"proxy.golang.org",
	"sum.golang.org",
	"api.osv.dev",
	"api.deps.dev",
];
