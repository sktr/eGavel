"use client"

import { useEffect } from "react"

/**
 * Mark every Material Icons element as untranslatable so Chrome's page
 * translator does not translate the ligature text (e.g. "gavel") into words.
 * Watches the DOM for late-mounted icons (e.g. the account button, which
 * renders after identity loads) so all icons get the attribute. The page
 * itself stays translatable.
 */
export function MaterialIconsTranslationGuard() {
  useEffect(() => {
    const mark = () => {
      for (const el of document.querySelectorAll<HTMLElement>(".material-icons")) {
        el.setAttribute("translate", "no")
      }
    }
    mark()
    const observer = new MutationObserver(mark)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return null
}
