"use client"

import { useState, useEffect } from "react"

export function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const diff = target - now
  if (diff <= 0) {
    return <span style={{ color: "#EF4444", fontWeight: 600 }}>ended</span>
  }

  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)

  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {h}h {m}m {s}s
    </span>
  )
}
