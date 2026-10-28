import { useEffect, useState } from 'react'
import { buildShareLink } from '@/lib/share'

/** Resolves a shareable absolute link for an in-app path. Undefined until the share base is known. */
export function useShareLink(path: string | undefined): string | undefined {
  const [link, setLink] = useState<{ path: string; url: string }>()
  useEffect(() => {
    if (!path) return
    let live = true
    buildShareLink(path)
      .then((url) => {
        if (live) setLink({ path, url })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [path])
  return link && link.path === path ? link.url : undefined
}
