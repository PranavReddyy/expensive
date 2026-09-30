import { NextResponse } from 'next/server';
// Pages are client-rendered shells. Firebase gates the UI; verified bearer
// tokens and database RLS authorize every financial data request.
export function middleware() {
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/', '/dashboard/:path*', '/expenses/:path*', '/analytics/:path*', '/owes/:path*'] };
