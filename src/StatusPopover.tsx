import { useTerminalDimensions } from "@opentui/react"
import { useMemo, useState } from "react"
import { colors } from "./theme/colors.ts"

export type StatusPopoverVariant = "info" | "warning" | "error" | "success"
export type StatusPopoverPlacement = "auto" | "top" | "bottom" | "left" | "right"

export interface StatusPopoverProps {
	readonly icon: string
	readonly content: string
	readonly variant?: StatusPopoverVariant
	readonly placement?: StatusPopoverPlacement
	readonly open?: boolean
	readonly defaultOpen?: boolean
	readonly onOpenChange?: (open: boolean) => void
	readonly minWidth?: number
	readonly maxWidth?: number
	readonly maxHeight?: number
	readonly zIndex?: number
	readonly x?: number
	readonly y?: number
}

export interface StatusPopoverPanelProps {
	readonly content: string
	readonly variant?: StatusPopoverVariant
	readonly maxWidth?: number
	readonly maxHeight?: number
	readonly zIndex?: number
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

const variantFg = (variant: StatusPopoverVariant): string => {
	switch (variant) {
		case "info":
			return colors.info
		case "warning":
			return colors.warning
		case "error":
			return colors.error
		case "success":
			return colors.success
	}
}

const measureLine = (line: string): number => line.length

const wrapLine = (line: string, width: number): string[] => {
	if (width <= 0) return [line]
	if (line.length <= width) return [line]
	const out: string[] = []
	let i = 0
	while (i < line.length) {
		out.push(line.slice(i, i + width))
		i += width
	}
	return out
}

export const StatusPopover = ({
	icon,
	content,
	variant = "warning",
	placement = "auto",
	open,
	defaultOpen = false,
	onOpenChange,
	minWidth = 14,
	maxWidth = 40,
	maxHeight = 12,
	zIndex = 30,
	x = 0,
	y = 0,
}: StatusPopoverProps) => {
	const { width: viewportWidth, height: viewportHeight } = useTerminalDimensions()
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
	const isOpen = open ?? uncontrolledOpen
	const setOpen = (next: boolean) => {
		if (open === undefined) setUncontrolledOpen(next)
		onOpenChange?.(next)
	}

	const lines = useMemo(() => content.split(/\r?\n/), [content])
	const textWidth = useMemo(() => {
		const widest = Math.max(1, ...lines.map(measureLine))
		return clamp(widest, minWidth, Math.min(maxWidth, Math.max(1, viewportWidth - 4)))
	}, [content, lines, maxWidth, minWidth, viewportWidth])

	const wrapped = useMemo(
		() => lines.flatMap((line) => wrapLine(line, textWidth)),
		[lines, textWidth],
	)
	const bodyHeight = Math.min(maxHeight, Math.max(1, wrapped.length))
	const popoverWidth = Math.min(textWidth + 2, Math.max(1, viewportWidth - 2))
	const popoverHeight = Math.min(bodyHeight + 2, Math.max(3, viewportHeight - 2))

	const left = 1
	const top = Math.max(0, viewportHeight - popoverHeight - 2)

	const linesToRender = wrapped.slice(0, Math.max(0, popoverHeight - 2))
	while (linesToRender.length < popoverHeight - 2) linesToRender.push("")
	const triggerFg = variantFg(variant)

	return (
		<>
			<box
				onMouseDown={() => setOpen(!isOpen)}
				onMouseUp={() => setOpen(!isOpen)}
				style={{
					width: 3,
					height: 1,
					flexDirection: "row",
					backgroundColor: colors.backgroundElement,
				}}
			>
				<text
					content={` ${icon} `}
					wrapMode="none"
					onMouseDown={() => setOpen(!isOpen)}
					onMouseUp={() => setOpen(!isOpen)}
					style={{ fg: triggerFg, attributes: 1 }}
				/>
			</box>
			{isOpen && (
				<box
					position="absolute"
					left={left}
					top={top}
					width={popoverWidth}
					height={popoverHeight}
					zIndex={zIndex}
					style={{
						border: true,
						borderColor: colors.border,
						backgroundColor: colors.backgroundPanel,
						flexDirection: "column",
					}}
				>
					<text content="" />
					{linesToRender.map((line, i) => (
						<text key={i} content={line} wrapMode="none" style={{ fg: colors.text }} />
					))}
					<text content="" />
				</box>
			)}
		</>
	)
}

export const StatusPopoverPanel = ({
	content,
	maxWidth = 40,
	maxHeight = 12,
	zIndex = 30,
}: StatusPopoverPanelProps) => {
	const { width: viewportWidth, height: viewportHeight } = useTerminalDimensions()
	const lines = useMemo(() => content.split(/\r?\n/), [content])
	const textWidth = useMemo(() => {
		const widest = Math.max(1, ...lines.map(measureLine))
		return clamp(widest, 14, Math.min(maxWidth, Math.max(1, viewportWidth - 4)))
	}, [lines, maxWidth, viewportWidth])
	const wrapped = useMemo(
		() => lines.flatMap((line) => wrapLine(line, textWidth)),
		[lines, textWidth],
	)
	const bodyHeight = Math.min(maxHeight, Math.max(1, wrapped.length))
	const popoverWidth = Math.min(textWidth + 2, Math.max(1, viewportWidth - 2))
	const popoverHeight = Math.min(bodyHeight + 2, Math.max(3, viewportHeight - 2))
	const linesToRender = wrapped.slice(0, Math.max(0, popoverHeight - 2))
	while (linesToRender.length < popoverHeight - 2) linesToRender.push("")

	return (
		<box
			position="absolute"
			left={1}
			top={Math.max(0, viewportHeight - popoverHeight - 2)}
			width={popoverWidth}
			height={popoverHeight}
			zIndex={zIndex}
			style={{
				border: true,
				borderColor: colors.border,
				backgroundColor: colors.backgroundPanel,
				flexDirection: "column",
			}}
		>
			<text content="" />
			{linesToRender.map((line, i) => (
				<text key={i} content={line} wrapMode="none" style={{ fg: colors.text }} />
			))}
			<text content="" />
		</box>
	)
}
