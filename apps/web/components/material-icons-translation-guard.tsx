"use client"

import { useEffect } from "react"

/**
 * Mark every Material Icons element as untranslatable so Chrome's page
 * translator does not translate the ligature text (e.g. "gavel") into words.
 * Runs once on mount; the page itself stays translatable.
 */
export function MaterialIconsTranslationGuard() {
  useEffect(() => {
    for (const el of document.querySelectorAll<HTMLElement>(".material-icons")) {
      el.setAttribute("translate", "no")
    }
  }, [])
  return null
}
