/**
 * Derive Footer StatusIndicator descriptors from `@house/options` footer
 * opt-ins and the live session. House supplies optional per-key Activate
 * overrides when setting the value alone is not enough (theme apply, notices).
 */

import {
	footerControlActive,
	footerKeys,
	nextFooterValue,
	type Catalog,
	type OptionKey,
	type Options,
	type Session,
} from "@house/options"
import type { StatusIndicatorProps } from "../StatusIndicator.tsx"

export type FooterControlDescriptor = StatusIndicatorProps & {
	readonly id: string
}

export type FooterControlHandlers<C extends Catalog> = {
	readonly [K in OptionKey<C>]?: {
		/** Replace default toggle/cycle + session.set. */
		readonly onActivate?: () => void
		/** Override highlight; default uses footerControlActive. */
		readonly active?: boolean
	}
}

export const footerControlsFromSession = <C extends Catalog>(
	options: Options<C>,
	session: Session<C>,
	handlers: FooterControlHandlers<C> = {},
): FooterControlDescriptor[] => {
	const controls: FooterControlDescriptor[] = []
	for (const key of footerKeys(options.specs)) {
		const spec = options.specs[key]!
		const footer = spec.footer
		if (footer === undefined) continue
		const value = session.get(key)
		const handler = handlers[key]
		controls.push({
			id: key,
			icon: footer.icon,
			variant: "info",
			active: handler?.active ?? footerControlActive(spec, value),
			onMouseUp: () => {
				if (handler?.onActivate !== undefined) {
					handler.onActivate()
					return
				}
				const current = session.get(key)
				void session.set(key, nextFooterValue(spec, current))
			},
		})
	}
	return controls
}
