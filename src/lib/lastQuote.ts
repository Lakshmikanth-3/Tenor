const KEY = 'tenor.lastQuote'

/** Remember the last quote link the wallet opened, so the Business dashboard can take you back to Lock rate. */
export function rememberQuote(path: string): void {
  try {
    sessionStorage.setItem(KEY, path)
  } catch {
    // storage unavailable: the shortcut is simply not offered
  }
}

export function lastQuote(): string | undefined {
  try {
    return sessionStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined
  }
}
