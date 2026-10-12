import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";

// A command or snippet with a copy button. A leading "$ " on a line is left out of the copy.
export function Code({ children, lang = "sh", className = "my-5" }: { children: string; lang?: string; className?: string }) {
	const [copied, setCopied] = useState(false);
	const text = children.replace(/^\n/, "").replace(/\n\s*$/, "");
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text.replace(/^\$ /gm, ""));
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {}
	};
	return (
		<div className={`group relative cut-sm bg-black/40 ring-1 ring-comb-line ${className}`}>
			<pre className="overflow-x-auto px-4 py-3.5 pr-12 font-mono text-[13px] leading-relaxed text-wax" data-lang={lang}>
				<code>{text}</code>
			</pre>
			<button
				type="button"
				onClick={copy}
				aria-label={copied ? "Copied" : "Copy"}
				className="absolute right-2 top-2 rounded bg-[#151518] p-1.5 text-kumo-subtle ring-1 ring-comb-line transition hover:bg-[#222226] hover:text-wax focus-visible:text-wax"
			>
				{copied ? <CheckIcon size={16} className="text-honey" /> : <CopyIcon size={16} />}
			</button>
		</div>
	);
}
