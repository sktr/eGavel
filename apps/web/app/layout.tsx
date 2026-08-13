import type { ReactNode } from "react"
import { Header } from "./header"
import { RecoveryPhraseDialog } from "./recovery-dialog"
import { MaterialIconsTranslationGuard } from "../components/material-icons-translation-guard"
import { ThemeProvider } from "@wrksz/themes/next"

export const metadata = {
  title: "eGavel",
  description: "A non-custodial Cashu e-cash auction platform (2-of-3 P2PK)",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style>{`
          @font-face{
            font-family:'Material Icons';
            font-style:normal;
            font-weight:400;
            font-display:block;
            src:url(/fonts/material-icons.woff2) format('woff2');
          }

          .material-icons{
            font-family:'Material Icons';
            font-weight:normal;
            font-style:normal;
            font-size:24px;
            line-height:1;
            letter-spacing:normal;
            text-transform:none;
            display:inline-block;
            white-space:nowrap;
            word-wrap:normal;
            direction:ltr;
            font-feature-settings:'liga';
            -webkit-font-feature-settings:'liga';
            -webkit-font-smoothing:antialiased;
          }
          *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

          :root{
            --bg:          oklch(99% 0.002 240);
            --surface:     oklch(100% 0 0);
            --fg:          oklch(18% 0.012 250);
            --muted:       oklch(54% 0.012 250);
            --text-dim:    oklch(54% 0.012 250);
            --text-muted:  oklch(45% 0.01 250);
            --border:      oklch(92% 0.005 250);
            --accent:      #8B5CF6;
            --accent-soft: #F0ECFA;
            --success:     oklch(42% 0.12 145);
            --amber:       oklch(55% 0.16 85);
            --glow:        rgba(139,92,246,0.1);
            --placeholder: #f3f4f6;
            --shadow-card: 0 1px 3px rgba(0,0,0,0.06);
            --shadow-hover: 0 4px 12px rgba(0,0,0,0.08);
            --radius:      8px;
            --space-xs:    4px;
            --space-sm:    8px;
            --space-md:    16px;
            --space-lg:    24px;
            --space-xl:    40px;
            --space-2xl:   64px;
            --font-display:-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif;
            --font-body:   -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;
            --font-mono:   'SF Mono',ui-monospace,Menlo,monospace;
          }

          .dark{
            --bg:          #1A1614;
            --surface:     #241F1C;
            --fg:          #EDE6DD;
            --muted:       #B8AFA5;
            --text-dim:    #B8AFA5;
            --text-muted:  #7A7268;
            --border:      #332D28;
            --accent:      #8B5CF6;
            --accent-soft: #2A2535;
            --success:     oklch(60% 0.15 145);
            --amber:       oklch(70% 0.16 85);
            --glow:        rgba(139,92,246,0.12);
            --placeholder: #2A2522;
            --shadow-card: 0 1px 3px rgba(0,0,0,0.3);
            --shadow-hover: 0 4px 12px rgba(0,0,0,0.4);
          }

          html{font-size:16px}
          body{
            font-family:var(--font-body);
            font-size:15px;
            line-height:1.5;
            color:var(--fg);
            background:var(--bg);
            -webkit-font-smoothing:antialiased;
            min-height:100vh;
            transition:background .15s,color .15s;
          }
          a{color:var(--accent);text-decoration:none}
          a:hover{text-decoration:underline}

          h1,h2,h3{font-family:var(--font-display);font-weight:600;letter-spacing:-0.02em;line-height:1.2}
          h1{font-size:clamp(28px,4vw,44px)}
          h2{font-size:20px}
          p{margin:0}
          label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}

          input,textarea,select{
            width:100%;border:1px solid var(--border);border-radius:var(--radius);
            padding:10px 14px;font-size:14px;font-family:inherit;
            background:var(--surface);color:var(--fg);
            transition:border-color .15s;outline:none;
          }
          input:focus,textarea:focus,select:focus{border-color:var(--accent)}
          textarea{resize:vertical;min-height:140px}
          select{cursor:pointer;appearance:none;
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23858585' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
            background-repeat:no-repeat;background-position:right 12px center;padding-right:32px;
          }

          button{
            font-family:var(--font-body);font-weight:500;font-size:15px;
            padding:10px 20px;border-radius:var(--radius);border:none;
            cursor:pointer;transition:all .15s;line-height:1.4;
            background:var(--accent);color:#fff;
          }
          button:disabled{opacity:0.5;cursor:not-allowed}

          code{font-family:var(--font-mono);background:var(--border);padding:0.15em 0.4em;border-radius:4px;font-size:0.85em}

          @media(prefers-reduced-motion:reduce){
            *,*::before,*::after{transition-duration:0s!important;animation-duration:0s!important}
          }

          @media (max-width: 639px) {
            .header-mobile-hide { display: none !important; }
          }

          @media (max-width: 639px) {
            .resp-grid-2col { grid-template-columns: 1fr !important; }
            .resp-grid-form { grid-template-columns: 1fr !important; }
            .resp-grid-row { grid-template-columns: 56px 1fr !important; }
            .resp-grid-row > :last-child { grid-column: 1 / -1; text-align: right !important; }
          }
        `}</style>
      </head>
      <body>
        <ThemeProvider attribute="class" storage="cookie" disableTransitionOnChange="color 0s">
          <MaterialIconsTranslationGuard />
          <Header />
          <RecoveryPhraseDialog />
          {children}
          <footer style={{
            borderTop: "1px solid var(--border)",
            maxWidth: 1200,
            margin: "var(--space-2xl) auto 0",
            padding: "var(--space-xl) 24px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 13, flexWrap: "wrap", gap: "var(--space-md)" }}>
              <span>© 2025 eGavel</span>
              <div style={{ display: "flex", gap: "var(--space-lg)" }}>
                <a href="/how-it-works" style={{ color: "var(--muted)", textDecoration: "none" }}>How it Works</a>
                <a href="https://github.com/sktr/egavel" style={{ color: "var(--muted)", textDecoration: "none" }}>GitHub</a>
              </div>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  )
}
