import assert from "node:assert/strict"
import test from "node:test"
import { markWhatsAppMessageRead, sendWhatsAppReply } from "../lib/whatsapp-cloud-api"

test("marks an inbound message as read and starts Meta's native typing indicator", async () => {
  const originalFetch = globalThis.fetch
  const originalAccessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const originalPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  let request: { url: string; init?: RequestInit } | null = null

  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token"
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id"
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    await markWhatsAppMessageRead("wamid.test-message", { showTypingIndicator: true })
    assert.deepEqual(request, {
      url: "https://graph.facebook.com/v26.0/test-phone-number-id/messages",
      init: {
        method: "POST",
        headers: {
          Authorization: "Bearer test-access-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: "wamid.test-message",
          typing_indicator: { type: "text" },
        }),
        cache: "no-store",
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    if (originalAccessToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN
    else process.env.WHATSAPP_ACCESS_TOKEN = originalAccessToken
    if (originalPhoneNumberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhoneNumberId
  }
})

test("does not add a typing indicator unless requested", async () => {
  const originalFetch = globalThis.fetch
  const originalAccessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const originalPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  let body: Record<string, unknown> | null = null

  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token"
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id"
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  try {
    await markWhatsAppMessageRead("wamid.read-only")
    assert.deepEqual(body, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.read-only",
    })
  } finally {
    globalThis.fetch = originalFetch
    if (originalAccessToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN
    else process.env.WHATSAPP_ACCESS_TOKEN = originalAccessToken
    if (originalPhoneNumberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhoneNumberId
  }
})

test("sends the official interactive list payload for an authorized choice", async () => {
  const originalFetch = globalThis.fetch
  const originalAccessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const originalPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  let body: Record<string, unknown> | null = null

  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token"
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id"
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ messages: [{ id: "wamid.list" }] }), { status: 200 })
  }

  try {
    await sendWhatsAppReply("15551234567", {
      text: "I found two possible jobs. Select the right one to continue.",
      presentation: {
        kind: "list",
        body: "I found two possible jobs. Select the right one to continue.",
        buttonText: "Select one",
        sectionTitle: "Matches",
        rows: [{ id: "svc-choice-1", title: "North Ridge", description: "SVC · Dallas" }],
      },
    })
    assert.deepEqual(body, {
      messaging_product: "whatsapp",
      to: "15551234567",
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "I found two possible jobs. Select the right one to continue." },
        action: {
          button: "Select one",
          sections: [{ title: "Matches", rows: [{ id: "svc-choice-1", title: "North Ridge", description: "SVC · Dallas" }] }],
        },
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    if (originalAccessToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN
    else process.env.WHATSAPP_ACCESS_TOKEN = originalAccessToken
    if (originalPhoneNumberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhoneNumberId
  }
})

test("sends the official CTA URL payload for an SVC deep link", async () => {
  const originalFetch = globalThis.fetch
  const originalAccessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const originalPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  let body: Record<string, unknown> | null = null

  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token"
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id"
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ messages: [{ id: "wamid.cta" }] }), { status: 200 })
  }

  try {
    await sendWhatsAppReply("15551234567", {
      text: "The project is on track.",
      presentation: {
        kind: "cta_url",
        body: "The project is on track.",
        buttonText: "Open Project",
        url: "https://communication-svc.vercel.app/?questCoral=proj-onboarding",
      },
    })
    assert.deepEqual(body, {
      messaging_product: "whatsapp",
      to: "15551234567",
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: "The project is on track." },
        action: {
          name: "cta_url",
          parameters: {
            display_text: "Open Project",
            url: "https://communication-svc.vercel.app/?questCoral=proj-onboarding",
          },
        },
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    if (originalAccessToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN
    else process.env.WHATSAPP_ACCESS_TOKEN = originalAccessToken
    if (originalPhoneNumberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhoneNumberId
  }
})
