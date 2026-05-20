import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth is handled client-side via useAuth hook.
// This proxy just passes all requests through.
export async function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
