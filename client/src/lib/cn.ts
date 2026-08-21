/** Minimal className joiner — no clsx dep allowed (deps locked to next/react/tailwind/lucide-react). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
