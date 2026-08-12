import assert from "node:assert/strict"
import test from "node:test"
import { getIncomingWhatsAppMessages } from "../app/api/whatsapp/webhook/route"

function payload(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "test-waba",
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "test-phone-number" },
          messages: [message],
        },
      }],
    }],
  }
}

test("keeps an interactive list selection in the normal WhatsApp conversation path", () => {
  const previousWaba = process.env.WHATSAPP_WABA_ID
  const previousPhone = process.env.WHATSAPP_PHONE_NUMBER_ID
  process.env.WHATSAPP_WABA_ID = "test-waba"
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number"
  try {
    const messages = getIncomingWhatsAppMessages(payload({
      from: "15551234567",
      id: "wamid.selection",
      type: "interactive",
      interactive: {
        type: "list_reply",
        list_reply: { id: "svc-choice-2", title: "North Ridge", description: "SVC · Dallas" },
      },
    }))
    assert.deepEqual(messages, [{
      senderPhoneNumber: "15551234567",
      messageId: "wamid.selection",
      text: "Selected: North Ridge — SVC · Dallas",
    }])
  } finally {
    if (previousWaba === undefined) delete process.env.WHATSAPP_WABA_ID
    else process.env.WHATSAPP_WABA_ID = previousWaba
    if (previousPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID
    else process.env.WHATSAPP_PHONE_NUMBER_ID = previousPhone
  }
})

test("continues to ignore unsupported WhatsApp messages", () => {
  const messages = getIncomingWhatsAppMessages(payload({
    from: "15551234567",
    id: "wamid.image",
    type: "image",
    image: { id: "media-1" },
  }))
  assert.deepEqual(messages, [])
})
