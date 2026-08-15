const rejectIncomingCall = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>', {
    headers: { "content-type": "text/xml; charset=utf-8" },
  })

/**
 * Safe default for the Twilio number while voice routing is not part of the
 * SVC Secretary product. Rejecting avoids answering, recording, or billing
 * inbound calls; WhatsApp traffic does not use this endpoint.
 */
export async function GET() {
  return rejectIncomingCall()
}

export async function POST() {
  return rejectIncomingCall()
}
