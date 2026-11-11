import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest): NextResponse {
  throw new Error(`not implemented: ${request.url}`);
}
