import assert from "node:assert/strict"
import test from "node:test"
import { parseVcfImportedContacts, normalizeVcfPhone } from "../lib/vcf-import.ts"

const baseOptions = {
  ownerUserId: "owner-1",
  registeredUsers: [
    { id: "u1", name: "Existing User", email: "alt@example.com", emailNormalized: "alt@example.com", initials: "EU", color: "bg-test" },
  ],
  existingImported: [],
  importBatchId: "test-batch",
}

test("maps repeated contact fields into compatibility fields and metadata", () => {
  const result = parseVcfImportedContacts(`BEGIN:VCARD
VERSION:2.1
N:Swope;Conlan;;;
FN:Conlan Swope
TEL;WORK:7175987871
TEL;CELL;PREF:+17176297720
EMAIL:CONLAN@example.com
EMAIL;PREF:alt@example.com
ORG:Warfel Construction
TITLE:VP Operations
NOTE:Primary site contact
ADR;WORK:;;1 Main St;Somerset;NJ;08873;United States
URL:https://example.com
END:VCARD`, baseOptions)

  assert.equal(result.contacts.length, 1)
  const contact = result.contacts[0]
  assert.equal(contact.name, "Conlan Swope")
  assert.equal(contact.email, "alt@example.com")
  assert.equal(contact.phone, "+17176297720")
  assert.equal(contact.phoneNormalized, "7176297720")
  assert.equal(contact.company, "Warfel Construction")
  assert.equal(contact.role, "VP Operations")
  assert.equal(contact.notes, "Primary site contact")
  assert.equal(contact.status, "registered")
  assert.deepEqual(contact.emailNormalizedCandidates, ["conlan@example.com", "alt@example.com"])
  assert.equal(contact.phones?.length, 2)
  assert.equal(contact.addresses?.[0].formatted, "1 Main St, Somerset, NJ, 08873, United States")
  assert.equal(contact.urls?.[0].value, "https://example.com")
})

test("skips duplicates by normalized email before phone", () => {
  const result = parseVcfImportedContacts(`BEGIN:VCARD
VERSION:2.1
FN:First
EMAIL:first@example.com
TEL;CELL:9085551000
END:VCARD
BEGIN:VCARD
VERSION:2.1
FN:Second
EMAIL:FIRST@example.com
TEL;CELL:9085552000
END:VCARD`, baseOptions)

  assert.equal(result.contacts.length, 1)
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].detail, "Email already exists: first@example.com")
})

test("skips duplicates by normalized phone when no email duplicates exist", () => {
  const result = parseVcfImportedContacts(`BEGIN:VCARD
VERSION:2.1
FN:First
TEL;CELL:+19085551000
END:VCARD
BEGIN:VCARD
VERSION:2.1
FN:Second
TEL;WORK:908-555-1000
END:VCARD`, baseOptions)

  assert.equal(result.contacts.length, 1)
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].detail, "Phone already exists: 9085551000")
})

test("skips address-only and location-only cards", () => {
  const result = parseVcfImportedContacts(`BEGIN:VCARD
VERSION:2.1
FN:Current Location
URL:http://maps.apple.com/?ll=40.1,-74.1
END:VCARD
BEGIN:VCARD
VERSION:2.1
ADR;WORK:;;1 Infinite Loop;Cupertino;CA;95014;United States
ORG:Apple Inc.
END:VCARD`, baseOptions)

  assert.equal(result.contacts.length, 0)
  assert.equal(result.skipped.length, 2)
})

test("ignores embedded photos and decodes custom quoted-printable labels", () => {
  const result = parseVcfImportedContacts(`BEGIN:VCARD
VERSION:2.1
FN:AT&T Service Contacts
TEL;X-CUSTOM(CHARSET=UTF-8,ENCODING=QUOTED-PRINTABLE,=43=75=73=74=6F=6D=65=72=20=53=65=72=76=69=63=65):611
PHOTO;ENCODING=BASE64;JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD
END:VCARD`, baseOptions)

  assert.equal(result.contacts.length, 1)
  assert.equal(result.contacts[0].phones?.[0].label, "Customer Service")
  assert.equal("photo" in result.contacts[0], false)
})

test("normalizes US leading country code for phone dedupe", () => {
  assert.equal(normalizeVcfPhone("+1 (908) 555-1000"), "9085551000")
  assert.equal(normalizeVcfPhone("011447745814938"), "011447745814938")
})
