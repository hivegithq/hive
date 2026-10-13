// Which repositories this deployment has, for the "repositories" home page and the landing totals.
// A small list in the R2 bucket (new repositories register themselves); the repositories that existed
// before it did seed it.

const KEY = "directory/repos.json";
export const SEED = ["scale2k", "final1k", "clean1k", "swarm1k", "load1k", "load", "vulnshop", "itoa", "sampleproject", "uuid", "store", "shop", "hive"];

type Bucket = { get(key: string): Promise<{ json<T>(): Promise<T> } | null>; put(key: string, value: string): Promise<unknown> } | undefined;

export async function registered(bucket: Bucket): Promise<string[]> {
	return stored(bucket);
}

async function stored(bucket: Bucket): Promise<string[]> {
	try {
		return (await (await bucket?.get(KEY))?.json<string[]>()) ?? [];
	} catch {
		return [];
	}
}

export async function listRepos(bucket: Bucket): Promise<string[]> {
	return [...new Set([...SEED, ...(await stored(bucket))])];
}

export async function registerRepo(bucket: Bucket, name: string): Promise<void> {
	if (!bucket) return;
	const names = await stored(bucket);
	if (names.includes(name) || SEED.includes(name)) return;
	await bucket.put(KEY, JSON.stringify([...names, name].slice(-500)));
}
