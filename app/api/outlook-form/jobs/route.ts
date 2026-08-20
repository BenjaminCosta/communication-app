import { listActiveJobsForFanOut } from "@/lib/whatsapp-secretary/tools/job-fanout"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/outlook-form/jobs
 * Public, no auth — feeds the job picker on the public 3-Week Outlook intake
 * form. Only {id, name}: directoryContextId is resolved server-side again at
 * submit time and never exposed here.
 */
export async function GET(): Promise<Response> {
  try {
    const jobs = await listActiveJobsForFanOut()
    return Response.json(
      { jobs: jobs.map((job) => ({ id: job.id, name: job.name, address: job.address ?? null })) },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return Response.json({ error: "Unable to load jobs." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
