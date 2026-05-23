import { NextResponse } from 'next/server'

export function middleware(request) {
  const { pathname } = request.nextUrl
  const authToken = request.cookies.get('auth-token')

  const isPublic = pathname === '/'
  const isApi = pathname.startsWith('/api')

  if (isApi) return NextResponse.next()

  if (!authToken && !isPublic) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (authToken && isPublic) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
