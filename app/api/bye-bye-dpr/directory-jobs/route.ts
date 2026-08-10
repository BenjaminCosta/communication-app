import { verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { searchDirectoryJobs } from "@/lib/bye-bye-dpr-directory-link"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/bye-bye-dpr/directory-jobs?q=<query>
 * Auth: Bearer <Firebase ID token>
 * Bounded name search over existing SVC Directory job contexts, so "Add Job
 * Site" links to a real, already-known job instead of creating a
 * disconnected duplicate. See lib/bye-bye-dpr-directory-link.ts.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await verifyByeByeDprUserRequest(request)
    const url = new URL(request.url)
    const query = url.searchParams.get("q") ?? ""
    const results = await searchDirectoryJobs(query)
    return Response.json({ results }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
