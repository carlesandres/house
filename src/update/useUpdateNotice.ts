/**
 * React hook for the update-available footer toast.
 *
 * Returns the formatted one-liner once the singleton probe resolves with a
 * strictly-newer-and-downloadable version, and `null` otherwise. Mounting
 * multiple consumers is safe — they all share the same probe via
 * `runtime.ts`.
 */

import { useEffect, useState } from "react"
import { currentUpdateInfo, subscribeUpdateInfo } from "./runtime.ts"
import { formatFooterNotice } from "./notice.ts"

export const useUpdateNotice = (): string | null => {
	const [text, setText] = useState<string | null>(() => {
		const cur = currentUpdateInfo()
		return cur ? formatFooterNotice(cur) : null
	})
	useEffect(() => {
		const unsub = subscribeUpdateInfo((info) => setText(formatFooterNotice(info)))
		return unsub
	}, [])
	return text
}
