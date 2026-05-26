import { useEffect, useRef, useState } from "react"
import { colors } from "./theme/colors.ts"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

export interface SpinnerProps {
	readonly fg?: string
	readonly intervalMs?: number
	readonly initialFrameIndex?: number
	/** Test seam: deterministic driver for frame advancement. When present,
	 *  Spinner registers its tick callback here instead of starting an interval. */
	readonly registerTick?: ((tick: () => void) => void) | null
}

export const Spinner = ({
	fg = colors.textMuted,
	intervalMs = 100,
	initialFrameIndex = 0,
	registerTick = null,
}: SpinnerProps) => {
	const [index, setIndex] = useState(initialFrameIndex)
	const tickRef = useRef<() => void>(() => undefined)
	tickRef.current = () => setIndex((prev) => (prev + 1) % FRAMES.length)

	useEffect(() => {
		if (registerTick) {
			registerTick(() => tickRef.current())
			return
		}
		const id = setInterval(() => {
			tickRef.current()
		}, intervalMs)
		return () => clearInterval(id)
	}, [intervalMs, registerTick])

	return <text content={FRAMES[index]} wrapMode="none" style={{ fg }} />
}
