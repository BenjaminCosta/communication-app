#!/usr/bin/env python3
"""
Build the "Directory Master — CURRENT" workbook from a Firestore snapshot.

READ-ONLY. Consumes the JSON produced by
scripts/export-directory-firestore-snapshot.mjs (a verbatim dump of
/contacts, /contexts, /directoryRelations, /directoryReviewQueue,
/directoryReferenceData) and re-shapes it into the SAME 6-sheet contract as
the original curated master workbook
(SVC_Directory_Master_Source_of_Truth(1).xlsx / scripts/enrich-directory-from-master.mjs):

    People_Master, Companies_Master, Jobs_Master, Relationships_Master,
    Review_Queue, Reference_Data

...plus one extra sheet not present in the original contract,
Other_Directory_Entries, for the handful of contexts that are neither a
company nor a job (manual notes/ideas).

Every row carries the live Firestore document id (contact_firestore_id /
context_firestore_id / relation_firestore_id / ...) so this sheet can be used
to identify duplicates and plan cleanup, then be traced back to the exact
document before any future re-import. Nothing is written to Firestore.

Usage:
  python3 scripts/build-directory-master-current.py \
      --snapshot import-data/directory-master/firestore-snapshot.json \
      --out import-data/directory-master
"""
import argparse
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PARSER = os.path.join(HERE, "parse-database-xlsx.py")


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def clean(v):
    return str(v if v is not None else "").strip()


def join_list(items):
    seen, out = set(), []
    for it in items or []:
        c = clean(it)
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return ";".join(out)


def flag(v):
    if v is True:
        return "1"
    if v is False:
        return "0"
    return ""


def get_field_value(fields, label):
    if not isinstance(fields, list):
        return ""
    for f in fields:
        if clean(f.get("label")).lower() == label.lower():
            return clean(f.get("value"))
    return ""


def has_any_field(fields, labels):
    if not isinstance(fields, list):
        return False
    wanted = {l.lower() for l in labels}
    return any(clean(f.get("label")).lower() in wanted and clean(f.get("value")) for f in fields)


def classify_context(ctx):
    """Ported from scripts/audit-directory.mjs classifyContext() — keep in sync."""
    fields = ctx.get("fields") or []
    kind = get_field_value(fields, "Kind").lower()
    sheet = clean(ctx.get("sourceSheet")).lower()
    if kind == "company" or sheet == "companies":
        return "company"
    if kind in ("project/job", "job") or sheet == "jobs":
        return "job"
    if has_any_field(fields, ["Phone", "Website", "Timezone"]):
        return "company"
    if has_any_field(fields, ["Project Manager", "Project Lead", "Duration in Weeks", "Job Rate"]):
        return "job"
    return "other"


def num_or_blank(v):
    return "" if v is None else clean(v)


# ---------------------------------------------------------------------------
# People_Master  (row contract: scripts/enrich-directory-from-master.mjs personMasterData)
# ---------------------------------------------------------------------------
def person_row(contact):
    m = contact.get("masterData") or {}
    email_points = [p.get("value") for p in (contact.get("emails") or [])]
    phone_points = [p.get("value") for p in (contact.get("phones") or [])]
    addresses = contact.get("addresses") or []
    return {
        "contact_firestore_id": contact["id"],
        "person_id": m.get("canonicalId") or contact["id"],
        "canonical_name": m.get("canonicalName") or contact.get("name", ""),
        "display_name": m.get("displayName") or contact.get("name", ""),
        "source_type": m.get("sourceType") or contact.get("source", ""),
        "is_internal_user": flag(m.get("isInternalUser")),
        "firebase_user_email": join_list(m.get("firebaseUserEmails")),
        "primary_email": m.get("primaryEmail") or contact.get("email", ""),
        "all_emails": join_list((m.get("emails") or []) + email_points + [contact.get("email")]),
        "primary_phone": m.get("primaryPhone") or contact.get("phone", ""),
        "all_phones": join_list((m.get("phones") or []) + phone_points + [contact.get("phone")]),
        "address": m.get("address") or (addresses[0].get("formatted", "") if addresses else ""),
        "latitude": num_or_blank(m.get("latitude")),
        "longitude": num_or_blank(m.get("longitude")),
        "role_id": m.get("roleId", ""),
        "role_name": m.get("roleName") or contact.get("role", ""),
        "role_raw": join_list(m.get("roleRaw") or contact.get("roles") or []),
        "company_id": m.get("companyId", ""),
        "company_name": m.get("companyName") or contact.get("company", ""),
        "company_context_id": m.get("companyContextId", ""),
        "company_match_method": m.get("companyMatchMethod", ""),
        "company_match_confidence": num_or_blank(m.get("companyMatchConfidence")),
        "current_job_id": m.get("currentJobId", ""),
        "current_job_name": m.get("currentJobName", ""),
        "current_job_context_id": m.get("currentJobContextId", ""),
        "active": flag(m.get("active")),
        "profile_picture_path": m.get("profilePicturePath", ""),
        "photo_url": m.get("photoUrl", ""),
        "notes": m.get("notes") or contact.get("notes", ""),
        "legacy_contact_id": join_list(m.get("legacyContactIds")),
        "legacy_user_identifier": join_list(m.get("legacyUserIdentifiers")),
        "old_von_x_key": join_list(m.get("oldVonXKeys") or [contact.get("oldVonXKey")]),
        "old_von_x_company_key": join_list(m.get("oldVonXCompanyKeys") or [contact.get("oldVonXCompanyKey")]),
        "source_company_raw": join_list(m.get("sourceCompanyRaw") or [contact.get("sourceCompanyId")]),
        "source_position_raw": join_list(m.get("sourcePositionRaw") or [contact.get("sourcePositionId")]),
        "source_sheets": join_list(m.get("sourceSheets") or [contact.get("sourceSheet")]),
        "source_row_ids": join_list(m.get("sourceRowIds") or [contact.get("sourceRecordId")]),
        "needs_review": flag(m.get("needsReview")),
        "review_reason": m.get("reviewReason", ""),
        # extra traceability columns (not part of the original enrichment input contract)
        "linked_user_id": contact.get("linkedUserId") or "",
        "status": contact.get("status", ""),
        "visibility": contact.get("visibility", ""),
        "has_master_data": "1" if contact.get("masterData") else "0",
        "created_at": contact.get("createdAt", ""),
        "updated_at": contact.get("updatedAt", ""),
    }


# ---------------------------------------------------------------------------
# Companies_Master  (row contract: companyMasterData)
# ---------------------------------------------------------------------------
def company_row(ctx):
    m = ctx.get("masterData") or {}
    fields = ctx.get("fields") or []
    phone = m.get("phone") or get_field_value(fields, "Phone")
    return {
        "context_firestore_id": ctx["id"],
        "company_id": m.get("canonicalId") or ctx["id"],
        "canonical_name": m.get("canonicalName") or ctx.get("name", ""),
        "display_name": m.get("displayName") or ctx.get("name", ""),
        "aliases": join_list(m.get("aliases")),
        "phone": phone,
        "phone_valid": "1" if phone else "0",
        "phone_raw": join_list(m.get("phoneRaw")),
        "address": m.get("address") or get_field_value(fields, "Address"),
        "website": m.get("website") or get_field_value(fields, "Website"),
        "description": m.get("description") or ctx.get("description", ""),
        "legacy_company_ids": join_list(m.get("legacyCompanyIds")),
        "source_rows": join_list(m.get("sourceRowIds") or [ctx.get("sourceRecordId")]),
        "merged_record_count": num_or_blank(m.get("mergedRecordCount")),
        "needs_review": flag(m.get("needsReview")),
        "review_reason": m.get("reviewReason", ""),
        "source_sheet": ctx.get("sourceSheet", ""),
        "source_record_id": ctx.get("sourceRecordId", ""),
        "has_master_data": "1" if ctx.get("masterData") else "0",
        "created_at": ctx.get("createdAt", ""),
        "updated_at": ctx.get("updatedAt", ""),
    }


# ---------------------------------------------------------------------------
# Jobs_Master  (row contract: jobMasterData)
# ---------------------------------------------------------------------------
def job_row(ctx):
    m = ctx.get("masterData") or {}
    fields = ctx.get("fields") or []
    return {
        "context_firestore_id": ctx["id"],
        "job_id": m.get("canonicalId") or ctx["id"],
        "canonical_name": m.get("canonicalName") or ctx.get("name", ""),
        "source_project_name": m.get("sourceProjectName", ""),
        "date_added": m.get("dateAdded") or get_field_value(fields, "Date Added"),
        "address": m.get("address") or get_field_value(fields, "Address"),
        "location_label": m.get("location") or get_field_value(fields, "Location") or get_field_value(fields, "Company"),
        "source_company_raw": m.get("sourceCompanyRaw") or get_field_value(fields, "Company"),
        "latitude": num_or_blank(m.get("latitude")),
        "longitude": num_or_blank(m.get("longitude")),
        "company_id": m.get("companyId", ""),
        "company_name": m.get("companyName") or get_field_value(fields, "Parent Company"),
        "company_context_id": m.get("companyContextId") or get_field_value(fields, "Parent Company Context ID"),
        "company_match_method": m.get("companyMatchMethod", ""),
        "company_match_confidence": num_or_blank(m.get("companyMatchConfidence")),
        "project_manager_person_id": m.get("projectManagerPersonId", ""),
        "project_manager_name": m.get("projectManagerName", ""),
        "project_manager_raw": m.get("projectManagerRaw") or get_field_value(fields, "Project Manager"),
        "project_manager_contact_id": m.get("projectManagerContactId", ""),
        "project_lead_person_id": m.get("projectLeadPersonId", ""),
        "project_lead_name": m.get("projectLeadName", ""),
        "project_lead_raw": m.get("projectLeadRaw") or get_field_value(fields, "Project Lead"),
        "project_lead_contact_id": m.get("projectLeadContactId", ""),
        "estimated_start_date": m.get("estimatedStartDate") or get_field_value(fields, "Estimated Start Date"),
        "confirmed_start_date": m.get("confirmedStartDate") or get_field_value(fields, "Confirmed Start Date"),
        "confirmed_start_date_source": m.get("confirmedStartDateSource", ""),
        "operational_notes": m.get("operationalNotes", ""),
        "duration_weeks": m.get("durationWeeks") or get_field_value(fields, "Duration in Weeks"),
        "status": m.get("status") or get_field_value(fields, "Status"),
        "report_cadence": m.get("reportCadence", ""),
        "image_folder_url": m.get("imageFolderUrl") or get_field_value(fields, "Image Folder Url"),
        "operating_zone": m.get("operatingZone", ""),
        "project_type": m.get("projectType") or get_field_value(fields, "Type"),
        "heat_label": m.get("heatLabel", ""),
        "recruiting_stages": m.get("recruitingStages", ""),
        "job_rate_amount": m.get("jobRateAmount") or get_field_value(fields, "Job Rate"),
        "job_rate_currency": m.get("jobRateCurrency", ""),
        "job_rate_unit": m.get("jobRateUnit", ""),
        "legacy_net_raw": m.get("legacyNetRaw") or get_field_value(fields, "NET"),
        "legacy_rizz_raw": m.get("legacyRizzRaw") or get_field_value(fields, "RIZZ"),
        "source_sheets": join_list(m.get("sourceSheets") or [ctx.get("sourceSheet")]),
        "source_row_ids": join_list(m.get("sourceRowIds") or [ctx.get("sourceRecordId")]),
        "is_legacy_or_archived": flag(m.get("isLegacyOrArchived")),
        "needs_review": flag(m.get("needsReview")),
        "review_reason": m.get("reviewReason", ""),
        "has_master_data": "1" if ctx.get("masterData") else "0",
        "created_at": ctx.get("createdAt", ""),
        "updated_at": ctx.get("updatedAt", ""),
    }


def other_context_row(ctx):
    fields = ctx.get("fields") or []
    return {
        "context_firestore_id": ctx["id"],
        "name": ctx.get("name", ""),
        "description": ctx.get("description", ""),
        "kind_field": get_field_value(fields, "Kind"),
        "field_count": str(len(fields)),
        "source_sheet": ctx.get("sourceSheet", ""),
        "source_record_id": ctx.get("sourceRecordId", ""),
        "created_at": ctx.get("createdAt", ""),
        "updated_at": ctx.get("updatedAt", ""),
    }


# ---------------------------------------------------------------------------
# Relationships_Master / Review_Queue / Reference_Data
# ---------------------------------------------------------------------------
def relationship_row(rel):
    return {
        "relation_firestore_id": rel["id"],
        "relationship_id": rel.get("relationshipId", ""),
        "relationship_type": rel.get("relationshipType", ""),
        "from_entity_type": rel.get("fromEntityType", ""),
        "from_master_id": rel.get("fromMasterId", ""),
        "from_source_id": rel.get("fromSourceId", ""),
        "from_directory_id": rel.get("fromDirectoryId", ""),
        "from_name": rel.get("fromName", ""),
        "to_entity_type": rel.get("toEntityType", ""),
        "to_master_id": rel.get("toMasterId", ""),
        "to_source_id": rel.get("toSourceId", ""),
        "to_directory_id": rel.get("toDirectoryId", ""),
        "to_name": rel.get("toName", ""),
        "role": rel.get("role", ""),
        "supervisor_master_id": rel.get("supervisorMasterId", ""),
        "supervisor_source_id": rel.get("supervisorSourceId", ""),
        "supervisor_directory_id": rel.get("supervisorDirectoryId", ""),
        "supervisor_name": rel.get("supervisorName", ""),
        "source_relation_ids": join_list(rel.get("sourceRelationIds")),
        "source_sheets": join_list(rel.get("sourceSheets")),
        "source_value": rel.get("sourceValue", ""),
        "confidence": num_or_blank(rel.get("confidence")),
        "source_file": rel.get("sourceFile", ""),
        "active": flag(rel.get("active")),
    }


def review_row(item):
    return {
        "review_firestore_id": item["id"],
        "issue_id": item.get("issueId", ""),
        "issue_type": item.get("issueType", ""),
        "entity_type": item.get("entityType", ""),
        "entity_master_id": item.get("entityMasterId", ""),
        "entity_name": item.get("entityName", ""),
        "source_sheets": join_list(item.get("sourceSheets")),
        "source_row_ids": join_list(item.get("sourceRowIds")),
        "raw_value": item.get("rawValue", ""),
        "candidate_matches": join_list(item.get("candidateMatches")),
        "recommended_action": item.get("recommendedAction", ""),
        "confidence": num_or_blank(item.get("confidence")),
        "reason": item.get("reason", ""),
        "status": item.get("status", ""),
        "source_file": item.get("sourceFile", ""),
    }


def reference_row(item):
    return {
        "reference_firestore_id": item["id"],
        "reference_type": item.get("referenceType", ""),
        "reference_id": item.get("referenceId", ""),
        "canonical_value": item.get("canonicalValue", ""),
        "display_value": item.get("displayValue", ""),
        "aliases": join_list(item.get("aliases")),
        "url": item.get("url", ""),
        "image_path": item.get("imagePath", ""),
        "source_sheets": join_list(item.get("sourceSheets")),
        "notes": item.get("notes", ""),
    }


# ---------------------------------------------------------------------------
# minimal xlsx writer (stdlib zipfile, inlineStr cells) — ported verbatim
# from scripts/consolidate-operational-master.py so output round-trips with
# scripts/parse-database-xlsx.py the same way.
# ---------------------------------------------------------------------------
def col_letter(n):
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def esc(v):
    return (str(v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def sheet_xml(rows):
    headers = list(rows[0].keys()) if rows else []
    lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    all_rows = [headers] + [[clean(r.get(h, "")) for h in headers] for r in rows]
    for ri, row in enumerate(all_rows, start=1):
        cells = []
        for ci, val in enumerate(row, start=1):
            if val == "":
                continue
            ref = f"{col_letter(ci)}{ri}"
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{esc(val)}</t></is></c>')
        lines.append(f'<row r="{ri}">' + "".join(cells) + "</row>")
    lines.append("</sheetData></worksheet>")
    return "".join(lines)


def write_xlsx(path, sheets):
    names = list(sheets.keys())
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                      '<Default Extension="xml" ContentType="application/xml"/>'
                      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                      + "".join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                                for i in range(len(names))) + '</Types>')
    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                 '</Relationships>')
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
          + "".join(f'<sheet name="{esc(n)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, n in enumerate(names))
          + '</sheets></workbook>')
    wb_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               + "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
                         for i in range(len(names))) + '</Relationships>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        for i, n in enumerate(names):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", sheet_xml(sheets[n]))


# ---------------------------------------------------------------------------
def load(path):
    import subprocess
    out = subprocess.run([sys.executable, PARSER, path], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"parse failed for {path}: {out.stderr[:400]}")
    return json.loads(out.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default="import-data/directory-master/firestore-snapshot.json")
    ap.add_argument("--out", default="import-data/directory-master")
    ap.add_argument("--filename", default="SVC_Directory_Master_CURRENT.xlsx")
    args = ap.parse_args()

    with open(args.snapshot) as f:
        snap = json.load(f)

    contacts = snap["contacts"]
    contexts = snap["contexts"]
    relations = snap["directoryRelations"]
    reviews = snap["directoryReviewQueue"]
    references = snap["directoryReferenceData"]

    companies, jobs, others = [], [], []
    for ctx in contexts:
        t = classify_context(ctx)
        if t == "company":
            companies.append(ctx)
        elif t == "job":
            jobs.append(ctx)
        else:
            others.append(ctx)

    people_rows = [person_row(c) for c in contacts]
    company_rows = [company_row(c) for c in companies]
    job_rows = [job_row(c) for c in jobs]
    other_rows = [other_context_row(c) for c in others]
    relationship_rows = [relationship_row(r) for r in relations]
    review_rows = [review_row(r) for r in reviews]
    reference_rows = [reference_row(r) for r in references]

    generated_at = datetime.now(timezone.utc).isoformat()
    summary_rows = [
        {"key": "generated_at_utc", "value": generated_at},
        {"key": "source", "value": "Firestore svc-comms (live, read-only export)"},
        {"key": "firestore_snapshot_exported_at", "value": snap.get("exportedAt", "")},
        {"key": "", "value": ""},
        {"key": "contacts (People_Master)", "value": str(len(people_rows))},
        {"key": "contexts total", "value": str(len(contexts))},
        {"key": "  -> companies (Companies_Master)", "value": str(len(company_rows))},
        {"key": "  -> jobs (Jobs_Master)", "value": str(len(job_rows))},
        {"key": "  -> other (Other_Directory_Entries)", "value": str(len(other_rows))},
        {"key": "directoryRelations (Relationships_Master)", "value": str(len(relationship_rows))},
        {"key": "directoryReviewQueue (Review_Queue)", "value": str(len(review_rows))},
        {"key": "directoryReferenceData (Reference_Data)", "value": str(len(reference_rows))},
        {"key": "", "value": ""},
        {"key": "NOTE", "value": "Read-only snapshot. No Firestore data was changed to produce this file."},
        {"key": "NOTE", "value": "IDs preserved: contact_firestore_id / context_firestore_id / *_firestore_id map 1:1 to live Firestore docs."},
        {"key": "NOTE", "value": "Same 6-sheet contract as SVC_Directory_Master_Source_of_Truth(1).xlsx (docs/svc-master-enrichment-migration.md), plus Other_Directory_Entries."},
    ]

    sheets = {
        "_Summary": summary_rows,
        "People_Master": people_rows,
        "Companies_Master": company_rows,
        "Jobs_Master": job_rows,
        "Other_Directory_Entries": other_rows,
        "Relationships_Master": relationship_rows,
        "Review_Queue": review_rows,
        "Reference_Data": reference_rows,
    }

    os.makedirs(args.out, exist_ok=True)
    xlsx_path = os.path.join(args.out, args.filename)
    write_xlsx(xlsx_path, sheets)

    # round-trip validation (same check consolidate-operational-master.py does)
    rt = load(xlsx_path)
    print("Wrote", xlsx_path)
    print("Round-trip sheets:", {k: len(v) for k, v in rt.items()})
    print("Row counts:", {k: len(v) for k, v in sheets.items()})


if __name__ == "__main__":
    main()
