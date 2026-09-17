'use client'

import { ThemeProvider } from '@/components/vibes/theme-provider'
import { VibesDashboard } from '@/components/vibes/vibes-dashboard'

export default function Home() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <VibesDashboard />
    </ThemeProvider>
  )
}
