import { execSync } from "node:child_process";

// A one-line summary of a report title, upper-cased by the system's tr.
export function shoutTitle(title: string): string {
	return execSync(`echo ${title} | tr a-z A-Z`).toString().trim();
}
