import Link from "next/link"

export default function NotFound() {
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(32px, 5vw, 48px)",
          fontWeight: 700,
          marginBottom: 12,
        }}
      >
        404
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 15, marginBottom: 32 }}>
        This page could not be found.
      </p>
      <Link
        href="/"
        style={{
          display: "inline-block",
          background: "var(--accent)",
          color: "#fff",
          padding: "10px 24px",
          borderRadius: "var(--radius)",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Back to home
      </Link>
    </main>
  )
}
