import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Define which paths are "public" (only accessible if NOT logged in)
  const isPublicPath = path === '/'; 

  // Grab the session token from cookies
  const token = request.cookies.get('__Secure-next-auth.session-token')?.value || 
                request.cookies.get('next-auth.session-token')?.value;

  // If user is logged in and tries to access the home page, send them to dashboard
  if (isPublicPath && token) {
    return NextResponse.redirect(new URL('/dashboard', request.nextUrl));
  }

  // If user is NOT logged in and tries to access dashboard, send them home
  if (!isPublicPath && !token && path.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/', request.nextUrl));
  }
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: [
    '/',
    '/dashboard/:path*',
  ],
};