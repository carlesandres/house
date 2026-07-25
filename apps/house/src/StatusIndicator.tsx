import { colors } from "./theme/colors.ts"

export type StatusIndicatorVariant = "info" | "warning" | "error" | "success"

export interface StatusIndicatorProps {
	readonly icon: string
	readonly variant?: StatusIndicatorVariant
	readonly active?: boolean
	readonly onMouseUp?: () => void
}

export const statusIndicatorFg = (variant: StatusIndicatorVariant): string => {
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

export const StatusIndicator = ({
	icon,
	variant = "info",
	active = true,
	onMouseUp,
}: StatusIndicatorProps) => {
	const activeColor = statusIndicatorFg(variant)
	const backgroundColor = active ? activeColor : colors.backgroundElement

	return (
		<box
			{...(onMouseUp === undefined ? {} : { onMouseUp })}
			style={{
				width: 3,
				height: 1,
				flexDirection: "row",
				backgroundColor,
			}}
		>
			<text
				content={` ${icon} `}
				wrapMode="none"
				style={{
					fg: active ? colors.backgroundPanel : colors.textMuted,
					bg: backgroundColor,
					attributes: active ? 1 : 0,
				}}
			/>
		</box>
	)
}
