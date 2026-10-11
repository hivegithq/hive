import { motion } from "motion/react";
import type { ReactNode } from "react";

// A landing-page section: its heading rises in once, the first time it scrolls into view.
export function Section(props: { id: string; title: string; children: ReactNode; className?: string }) {
	return (
		<section id={props.id} className={`relative scroll-mt-20 px-4 py-24 sm:px-8 lg:py-32 ${props.className ?? ""}`}>
			<div className="mx-auto max-w-6xl">
				<motion.h2
					initial={{ opacity: 0, y: 16 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
					className="mb-6 max-w-3xl font-display text-3xl font-semibold leading-tight text-wax sm:text-5xl"
				>
					{props.title}
				</motion.h2>
				{props.children}
			</div>
		</section>
	);
}
