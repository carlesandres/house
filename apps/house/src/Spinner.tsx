import { useEffect, useRef, useState } from "react"
import { colors } from "./theme/colors.ts"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const
const FRAME_COUNT = FRAMES.length
const normalizeFrameIndex = (index: number) => ((index % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT

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
	const [index, setIndex] = useState(() => normalizeFrameIndex(initialFrameIndex))
	const tickRef = useRef<() => void>(() => undefined)
	tickRef.current = () => setIndex((prev) => (prev + 1) % FRAME_COUNT)

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

	return <text content={FRAMES[index] ?? FRAMES[0]} wrapMode="none" style={{ fg }} />
}
