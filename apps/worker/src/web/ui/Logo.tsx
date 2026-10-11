// Hive's mark: a honey cell holding a smaller dark one, as in the favicon.
export function HiveMark({ size = 28, className }: { size?: number; className?: string }) {
	return (
		<svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
			<path d="M16 2 28 9v14l-12 7-12-7V9z" fill="#fbad41" />
			<path d="M16 9.5 22 13v7l-6 3.5-6-3.5v-7z" fill="#0d0d0f" />
			<path d="M16 13.2 18.8 14.8v3.4L16 19.8l-2.8-1.6v-3.4z" fill="#f6821f" />
		</svg>
	);
}

export function Wordmark({ className = "" }: { className?: string }) {
	return (
		<a href="/" className={`flex items-center gap-2.5 ${className}`}>
			<HiveMark />
			<span className="font-display text-xl font-semibold tracking-wide text-wax">Hive</span>
		</a>
	);
}
