import { createClient } from '@supabase/supabase-js'
import { queryCache } from './query-cache.mjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: async (input, init) => {
      const response = await fetch(input, init)
      const method = (init?.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase()
      if (response.ok && ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) {
        const url = new URL(typeof input === 'string' ? input : input.url || input.toString())
        const match = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)
        if (match) queryCache.invalidate([decodeURIComponent(match[1])])
      }
      return response
    },
  },
})
