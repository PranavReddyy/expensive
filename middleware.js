import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request) {
  const { pathname } = request.nextUrl
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    } },
  )
  // Validate with Auth, never trust the presence of a cookie or an embedded user.
  const { data: { user } } = await supabase.auth.getUser()
  const signedIn = !!user?.email_confirmed_at
  const destination = !signedIn && pathname !== '/' ? '/' : signedIn && pathname === '/' ? '/dashboard' : null
  if (destination) {
    const redirect = NextResponse.redirect(new URL(destination, request.url))
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
    response = redirect
  }
  if (request.cookies.has('auth-token')) response.cookies.delete('auth-token')
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/expenses/:path*', '/analytics/:path*', '/owes/:path*'],
}
