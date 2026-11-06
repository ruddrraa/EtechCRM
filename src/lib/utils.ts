export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export function titleFromPath(pathname: string) {
  const segment = pathname.split('/').filter(Boolean).at(-1) ?? 'dashboard'
  return segment.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
