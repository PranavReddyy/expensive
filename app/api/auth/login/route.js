import { NextResponse } from 'next/server'

export async function POST(request) {
  try {
    const { username, password } = await request.json()

    if (
      username === process.env.AUTH_USERNAME &&
      password === process.env.AUTH_PASSWORD
    ) {
      const response = NextResponse.json({ success: true })
      response.cookies.set('auth-token', 'ok', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
        path: '/',
      })
      return response
    }

    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 })
  } catch {
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
