#!/usr/bin/env python3
"""
Consolidate the 5 operational AppSheet workbooks into a single enricher-ready
"Operational Master" workbook (same 6-sheet contract as
SVC_Directory_Master_Source_of_Truth), plus a coverage report.

READ-ONLY. Writes nothing to Firestore. Produces two artifacts under out-dir:
  - Operational_Master.xlsx   (People_Master, Companies_Master, Jobs_Master,
                               Relationships_Master, Reference_Data, Review_Queue)
  - coverage-report.md

Bank fields (routing/checking/bank name) are deliberately DROPPED here — they do
not belong in the Directory. Provenance stamped so a later enricher run can write
them into a namespaced `operationalData` map, never overwriting Directory master
identity.

Usage:
  python3 scripts/consolidate-operational-master.py \
      --src import-data/operational/source \
      --out import-data/operational/out \
      [--proxy "New Database.xlsx"]
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PARSER = os.path.join(HERE, "parse-database-xlsx.py")

# ---- source file -> logical name -----------------------------------------
SOURCES = {
    "sales-database.xlsx": "sales",
    "time-sheets.xlsx": "timesheets",
    "week-ending.xlsx": "weekending",
    "scrapapalooza.xlsx": "scraps",
    "job-reports.xlsx": "jobreports",
}
INTERNAL_DOMAIN = "supervisioncompany.com"

# ---- cleaning ------------------------------------------------------------
INVALID = {
    "", "null", "none", "n/a", "na", "#error!", "#n/a", "#ref!", "#value!",
    "a whiteboard!", "this is a whiteboard", "blank", "no title", "no name",
    "unknown", "tbd", "$1.00", "0", "false", "true", "-", "--",
    "1/1/1950", "1/1/1950 15:32:50", "1/1/1950 0:00:00",
}
HEX_ID_RE = re.compile(r"^[0-9a-f]{8}$", re.I)          # AppSheet ref ids
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def clean(v):
    return str(v if v is not None else "").strip()


def is_invalid(v):
    c = clean(v)
    return (not c) or (c.lower() in INVALID)


def cv(v):
    """clean-or-empty, dropping junk placeholders"""
    c = clean(v)
    return "" if is_invalid(c) else c


def norm_email(v):
    # extract the first clean email, stripping trailing junk like ";"/"," that
    # AppSheet concatenation sometimes leaves on the cell
    m = re.search(r"[^\s@;,]+@[^\s@;,]+\.[a-z]{2,}", clean(v).lower())
    return m.group(0) if m else ""


def looks_email(v):
    return bool(EMAIL_RE.match(clean(v).lower()))


def norm_phone(v):
    raw = clean(v)
    m = re.match(r"^\d+\.\d+e\d+$", raw, re.I)
    if m:
        raw = str(int(float(raw)))
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) >= 7 else ""


def norm_name(v):
    c = clean(v).lower()
    c = c.encode("ascii", "ignore").decode()  # strip accents-ish
    c = re.sub(r"\s+", " ", c).strip(" ,.-")
    return c


def sid(prefix, *parts):
    h = hashlib.sha1("|".join(clean(p).lower() for p in parts).encode()).hexdigest()[:8]
    return f"{prefix}-{h}"


def title_case_name(first, last):
    parts = [p for p in [cv(first), cv(last)] if p]
    name = " ".join(parts).strip(" ,")
    # normalize ALLCAPS / alllower to Title Case, keep mixed as-is
    if name and (name.isupper() or name.islower()):
        name = " ".join(w.capitalize() for w in name.split())
    return name


def load(path):
    out = subprocess.run([sys.executable, PARSER, path], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"parse failed for {path}: {out.stderr[:400]}")
    return json.loads(out.stdout)


# =========================================================================
# Extraction
# =========================================================================
def build(workbooks, proxy):
    companies = {}   # norm_name -> record
    people = {}      # primary_email (or synthetic key) -> record
    jobs = {}        # norm_name -> record
    review = []
    reference = []

    def company_upsert(raw_name, **fields):
        name = cv(raw_name)
        if not name or norm_name(name) in ("", "supervision company"):
            return None
        nn = norm_name(name)
        rec = companies.get(nn)
        if not rec:
            rec = {"company_id": sid("oc", nn), "canonical_name": name,
                   "display_name": name, "aliases": set(), "phone": "",
                   "address": "", "website": "", "description": "",
                   "source_sheets": set()}
            companies[nn] = rec
        for k in ("phone", "address", "website", "description"):
            val = cv(fields.get(k))
            if val and not rec[k]:
                rec[k] = val
        if fields.get("alias"):
            a = cv(fields["alias"])
            if a and norm_name(a) != nn:
                rec["aliases"].add(a)
        if fields.get("source_sheet"):
            rec["source_sheets"].add(fields["source_sheet"])
        return rec

    def person_upsert(email, name, phone, company, role, source_type, sheet,
                      alias=None, address=None, extra_emails=None):
        pe = norm_email(email)
        key = pe or ("name:" + norm_name(name) + "|" + norm_name(company or ""))
        if not pe and not norm_name(name):
            return None
        rec = people.get(key)
        if not rec:
            rec = {"person_id": sid("op", key), "canonical_name": "", "display_name": "",
                   "primary_email": "", "all_emails": set(), "primary_phone": "",
                   "all_phones": set(), "company_name": "", "role_name": "",
                   "role_raw": set(), "address": "", "source_type": source_type,
                   "is_internal_user": "", "legacy_user_identifier": set(),
                   "source_sheets": set()}
            people[key] = rec
        nm = cv(name)
        if nm and (not rec["display_name"] or len(nm) > len(rec["display_name"])):
            rec["display_name"] = nm
            rec["canonical_name"] = nm
        if pe:
            rec["all_emails"].add(pe)
            if not rec["primary_email"]:
                rec["primary_email"] = pe
            rec["is_internal_user"] = "1" if pe.endswith("@" + INTERNAL_DOMAIN) else (rec["is_internal_user"] or "0")
        for e in (extra_emails or []):
            ne = norm_email(e)
            if ne:
                rec["all_emails"].add(ne)
        ph = norm_phone(phone)
        if ph:
            rec["all_phones"].add(ph)
            if not rec["primary_phone"]:
                rec["primary_phone"] = ph
        if cv(company) and not rec["company_name"]:
            rec["company_name"] = cv(company)
        if cv(role):
            rec["role_raw"].add(cv(role))
            if not rec["role_name"]:
                rec["role_name"] = cv(role)
        if cv(address) and not rec["address"]:
            rec["address"] = cv(address)
        if alias and cv(alias):
            rec["legacy_user_identifier"].add(cv(alias))
        rec["source_sheets"].add(sheet)
        return rec

    # ---------------- COMPANIES (Sales › Companies) ----------------------
    for row in workbooks["sales"].get("Companies", []):
        company_upsert(row.get("Name"), phone=row.get("Phone"), address=row.get("Address"),
                       website=row.get("Website"), description=row.get("Description"),
                       source_sheet="Sales:Companies")

    # ---------------- PEOPLE ---------------------------------------------
    for row in workbooks["sales"].get("Leads", []):
        person_upsert(row.get("Email"), title_case_name(row.get("First Name"), row.get("Last Name")),
                      row.get("Direct Phone"), row.get("Company"), row.get("Job Title"),
                      "sales_lead", "Sales:Leads")
        company_upsert(row.get("Company"), source_sheet="Sales:Leads")
    for row in workbooks["sales"].get("Copy of Leads", []):
        person_upsert(row.get("Email"), title_case_name(row.get("First Name"), row.get("Last Name")),
                      row.get("Direct Phone"), row.get("Company"), row.get("Job Title"),
                      "sales_lead", "Sales:CopyOfLeads")
        company_upsert(row.get("Company"), source_sheet="Sales:CopyOfLeads")
    for row in workbooks["sales"].get("Users", []):
        person_upsert(row.get("Email"), row.get("Username"), row.get("Phone"),
                      "Supervision Company", row.get("Position"), "sales_rep", "Sales:Users")
    for row in workbooks["timesheets"].get("QB User", []):
        person_upsert(row.get("Email") if looks_email(row.get("Email")) else row.get("User"),
                      "", row.get("Send to Email"), "", "Super", "workforce", "TimeSheets:QBUser",
                      alias=row.get("User"))
    for row in workbooks["weekending"].get("qb user", []):
        person_upsert(row.get("our user") or row.get("email"), row.get("full name"),
                      row.get("cell"), "", "Super", "workforce", "WeekEnding:qbuser",
                      alias=row.get("qb user"), address=row.get("address"),
                      extra_emails=[row.get("email")])

    # ---------------- JOBS (name = "{Company} - {Project} - {Location}") --
    def job_upsert(raw_name, ref, rate, sheet):
        name = cv(raw_name)
        if not name:
            return None
        nn = norm_name(name)
        rec = jobs.get(nn)
        if not rec:
            rec = {"job_id": sid("oj", nn), "canonical_name": name,
                   "source_project_name": name, "job_ref": cv(ref), "location_label": "",
                   "company_raw": "", "job_rate_amount": "", "source_sheets": set()}
            jobs[nn] = rec
            segs = [s.strip() for s in re.split(r"\s-\s", name) if s.strip()]
            if len(segs) >= 2:
                rec["company_raw"] = segs[0]
                rec["location_label"] = segs[-1] if len(segs) >= 3 else ""
        if cv(rate) and not rec["job_rate_amount"]:
            rec["job_rate_amount"] = cv(rate)
        rec["source_sheets"].add(sheet)
        return rec

    for row in workbooks["weekending"].get("qb job", []):
        job_upsert(row.get("qb job"), row.get("job ref"), row.get("rate"), "WeekEnding:qbjob")
    for row in workbooks["timesheets"].get("QB JobList", []):
        job_upsert(row.get("QB Job"), None, row.get("Rate"), "TimeSheets:QBJobList")
    for row in workbooks["weekending"].get("hours report", []):
        job_upsert(row.get("job name") or row.get("qb job ref"), row.get("job ref"),
                   row.get("job rate"), "WeekEnding:hoursreport")

    # ---------------- resolve job -> company via prefix ------------------
    resolved_jobcompany = 0
    for rec in jobs.values():
        craw = rec["company_raw"]
        rec["company_id"] = ""
        rec["company_name"] = ""
        rec["company_match_method"] = ""
        rec["company_match_confidence"] = "0"
        if not craw:
            continue
        cn = norm_name(craw)
        # exact company match
        comp = companies.get(cn)
        method, conf = "", 0.0
        if comp:
            method, conf = "exact_prefix", 1.0
        else:
            # startswith / alias fuzzy
            for nn2, c2 in companies.items():
                if nn2.startswith(cn) or cn.startswith(nn2):
                    comp, method, conf = c2, "prefix_startswith", 0.8
                    break
        if comp and conf >= 0.75:
            rec["company_id"] = comp["company_id"]
            rec["company_name"] = comp["canonical_name"]
            rec["company_match_method"] = method
            rec["company_match_confidence"] = str(conf)
            comp["aliases"].add(craw)
            resolved_jobcompany += 1
        else:
            rec["company_name"] = craw  # keep raw text, unlinked
            review.append({"issue_type": "job_company_unresolved", "entity_type": "job",
                           "entity_master_id": rec["job_id"], "entity_name": rec["canonical_name"],
                           "raw_value": craw, "reason": "job name prefix did not match a known company",
                           "confidence": "0", "source_sheet": ";".join(sorted(rec["source_sheets"]))})

    # ---------------- resolve person -> company (by name) ----------------
    resolved_personcompany = 0
    for rec in people.values():
        craw = rec["company_name"]
        rec["company_id"] = ""
        rec["company_match_method"] = ""
        rec["company_match_confidence"] = "0"
        if not craw:
            continue
        comp = companies.get(norm_name(craw))
        if comp:
            rec["company_id"] = comp["company_id"]
            rec["company_name"] = comp["canonical_name"]
            rec["company_match_method"] = "exact_name"
            rec["company_match_confidence"] = "1.0"
            resolved_personcompany += 1
        else:
            rec["company_match_confidence"] = "0"  # keep raw name, unlinked

    # ---------------- REFERENCE_DATA -------------------------------------
    for row in workbooks["sales"].get("Scratchpad", []):
        stage = cv(row.get("Funnel Stage"))
        station = cv(row.get("Station"))
        if stage:
            reference.append({"reference_type": "sales_funnel_stage",
                              "reference_id": sid("ref", stage, station),
                              "canonical_value": stage, "display_value": station,
                              "source_sheet": "Sales:Scratchpad"})
    for row in workbooks["scraps"].get("cat", []):
        c = cv(row.get("CAT"))
        if c:
            reference.append({"reference_type": "scrap_category", "reference_id": sid("ref", c),
                              "canonical_value": c, "display_value": c, "source_sheet": "Scraps:cat"})

    # ---------------- RELATIONSHIPS --------------------------------------
    relationships = []
    for rec in jobs.values():
        if rec["company_id"]:
            relationships.append({
                "relationship_id": sid("rel", rec["job_id"], rec["company_id"], "jobco"),
                "relationship_type": "job_company",
                "from_entity_type": "job", "from_entity_id": rec["job_id"], "from_entity_name": rec["canonical_name"],
                "to_entity_type": "company", "to_entity_id": rec["company_id"], "to_entity_name": rec["company_name"],
                "confidence": rec["company_match_confidence"], "is_valid": "1", "needs_review": "0",
                "source_sheet": ";".join(sorted(rec["source_sheets"])), "active": "1"})
    for rec in people.values():
        if rec["company_id"]:
            relationships.append({
                "relationship_id": sid("rel", rec["person_id"], rec["company_id"], "worksat"),
                "relationship_type": "person_company",
                "from_entity_type": "person", "from_entity_id": rec["person_id"], "from_entity_name": rec["display_name"],
                "to_entity_type": "company", "to_entity_id": rec["company_id"], "to_entity_name": rec["company_name"],
                "confidence": rec["company_match_confidence"], "is_valid": "1", "needs_review": "0",
                "source_sheet": ";".join(sorted(rec["source_sheets"])), "active": "1"})

    # ---------------- proxy overlap vs local Directory snapshot ----------
    proxy_stats = None
    if proxy and os.path.exists(proxy):
        pwb = load(proxy)
        known_emails, known_company_names = set(), set()
        for r in pwb.get("Contacts", []) + pwb.get("Users", []):
            e = norm_email(r.get("Email"))
            if e:
                known_emails.add(e)
        for r in pwb.get("Companies", []):
            if norm_name(r.get("Name")):
                known_company_names.add(norm_name(r.get("Name")))
        ppl_match = sum(1 for p in people.values() if p["primary_email"] and p["primary_email"] in known_emails)
        co_match = sum(1 for nn in companies if nn in known_company_names)
        proxy_stats = {"file": os.path.basename(proxy), "known_emails": len(known_emails),
                       "known_companies": len(known_company_names), "people_matched": ppl_match,
                       "people_new": len(people) - ppl_match, "companies_matched": co_match,
                       "companies_new": len(companies) - co_match}

    return {"companies": companies, "people": people, "jobs": jobs,
            "relationships": relationships, "review": review, "reference": reference,
            "resolved_jobcompany": resolved_jobcompany, "resolved_personcompany": resolved_personcompany,
            "proxy": proxy_stats}


# =========================================================================
# Serialize to enricher master rows
# =========================================================================
def to_master_rows(data):
    def joinset(s):
        return ";".join(sorted(x for x in s if clean(x)))

    people_rows = []
    for p in data["people"].values():
        people_rows.append({
            "person_id": p["person_id"], "canonical_name": p["canonical_name"],
            "display_name": p["display_name"], "source_type": p["source_type"],
            "is_internal_user": p["is_internal_user"], "primary_email": p["primary_email"],
            "all_emails": joinset(p["all_emails"]), "firebase_user_email": p["primary_email"] if p["is_internal_user"] == "1" else "",
            "primary_phone": p["primary_phone"], "all_phones": joinset(p["all_phones"]),
            "address": p["address"], "role_name": p["role_name"], "role_raw": joinset(p["role_raw"]),
            "company_id": p["company_id"], "company_name": p["company_name"],
            "company_match_method": p["company_match_method"], "company_match_confidence": p["company_match_confidence"],
            "legacy_user_identifier": joinset(p["legacy_user_identifier"]),
            "source_sheets": joinset(p["source_sheets"]), "needs_review": "0",
        })
    company_rows = []
    for c in data["companies"].values():
        company_rows.append({
            "company_id": c["company_id"], "canonical_name": c["canonical_name"],
            "display_name": c["display_name"], "aliases": joinset(c["aliases"]),
            "phone": c["phone"], "phone_valid": "1" if norm_phone(c["phone"]) else "0",
            "address": c["address"], "website": c["website"], "description": c["description"],
            "source_sheets": joinset(c["source_sheets"]), "needs_review": "0",
        })
    job_rows = []
    for j in data["jobs"].values():
        job_rows.append({
            "job_id": j["job_id"], "canonical_name": j["canonical_name"],
            "source_project_name": j["source_project_name"], "location_label": j["location_label"],
            "company_id": j["company_id"], "company_name": j["company_name"],
            "company_match_method": j["company_match_method"], "company_match_confidence": j["company_match_confidence"],
            "job_rate_amount": j["job_rate_amount"], "job_rate_currency": "USD" if j["job_rate_amount"] else "",
            "job_rate_unit": "hour" if j["job_rate_amount"] else "",
            "source_sheets": joinset(j["source_sheets"]), "needs_review": "0",
        })
    return {
        "People_Master": people_rows,
        "Companies_Master": company_rows,
        "Jobs_Master": job_rows,
        "Relationships_Master": data["relationships"],
        "Reference_Data": data["reference"],
        "Review_Queue": data["review"],
    }


# =========================================================================
# Minimal xlsx writer (stdlib zipfile, inlineStr cells) — parse-database-xlsx
# reads inlineStr + cell r-refs, so no sharedStrings needed.
# =========================================================================
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
    if not rows:
        headers = []
    else:
        headers = list(rows[0].keys())
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
    import zipfile
    names = list(sheets.keys())
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                     + "".join(f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                               for i in range(len(names))) + '</Types>')
    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                 '</Relationships>')
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
          + "".join(f'<sheet name="{esc(n)}" sheetId="{i+1}" r:id="rId{i+1}"/>' for i, n in enumerate(names))
          + '</sheets></workbook>')
    wb_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               + "".join(f'<Relationship Id="rId{i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i+1}.xml"/>'
                         for i in range(len(names))) + '</Relationships>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        for i, n in enumerate(names):
            z.writestr(f"xl/worksheets/sheet{i+1}.xml", sheet_xml(sheets[n]))


# =========================================================================
def coverage_md(data, master, args, wb_counts):
    p = data["proxy"]
    internal = sum(1 for x in data["people"].values() if x["is_internal_user"] == "1")
    withemail = sum(1 for x in data["people"].values() if x["primary_email"])
    lines = []
    lines.append("# Operational data — consolidation coverage report")
    lines.append("")
    lines.append(f"_Generated {datetime.now(timezone.utc).isoformat()} · READ-ONLY, no Firestore writes._")
    lines.append("")
    lines.append("## Source workbooks (rows parsed)")
    lines.append("| workbook | key views (rows) |")
    lines.append("|---|---|")
    for f, views in wb_counts.items():
        lines.append(f"| {f} | {views} |")
    lines.append("")
    lines.append("## Consolidated canonical entities")
    lines.append("| entity | count |")
    lines.append("|---|---:|")
    lines.append(f"| People (deduped) | {len(data['people'])} |")
    lines.append(f"|  · with email | {withemail} |")
    lines.append(f"|  · internal (@{INTERNAL_DOMAIN}) | {internal} |")
    lines.append(f"|  · external | {len(data['people']) - internal} |")
    lines.append(f"| Companies (deduped) | {len(data['companies'])} |")
    lines.append(f"| Jobs (deduped) | {len(data['jobs'])} |")
    lines.append(f"| Relationships (safe, ≥0.75) | {len(data['relationships'])} |")
    lines.append(f"| Reference data | {len(data['reference'])} |")
    lines.append(f"| Review queue | {len(data['review'])} |")
    lines.append("")
    lines.append("## Relationship resolution")
    lines.append(f"- job→company resolved by name prefix: **{data['resolved_jobcompany']}** / {len(data['jobs'])} jobs")
    lines.append(f"- person→company resolved by name: **{data['resolved_personcompany']}** / {withemail} people-with-company")
    lines.append("")
    if p:
        lines.append(f"## Overlap vs local Directory proxy (`{p['file']}`)")
        lines.append("_Proxy = pre-master local snapshot, NOT the live Directory. Live match happens in the enricher dry-run (needs approved prod read)._")
        lines.append("")
        lines.append("| | matched (already known) | new |")
        lines.append("|---|---:|---:|")
        lines.append(f"| People (by email) | {p['people_matched']} | {p['people_new']} |")
        lines.append(f"| Companies (by name) | {p['companies_matched']} | {p['companies_new']} |")
        lines.append("")
    lines.append("## Notes / caveats")
    lines.append("- Bank fields (routing/checking/bank name) were DROPPED — excluded from Directory by design.")
    lines.append("- AppSheet ref columns (e.g. Leads `State`/`Total Number of SMS` hold hex ids) were ignored.")
    lines.append("- Junk placeholders removed: whiteboard/blank/NONE/No Title/$1.00/1-1-1950/#ERROR.")
    lines.append("- Company/job/person ids are synthetic (`oc-`/`oj-`/`op-`); the enricher still matches to")
    lines.append("  existing Firestore docs by email/name before creating anything new.")
    lines.append("- Nothing here is written to Firestore. Next step: enricher dry-run (`--verify`/dry-run),")
    lines.append("  reviewed together, then an approved write wrapped in Directory lock/rebuild/unlock.")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="import-data/operational/source")
    ap.add_argument("--out", default="import-data/operational/out")
    ap.add_argument("--proxy", default="New Database.xlsx")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    workbooks, wb_counts = {}, {}
    for fname, logical in SOURCES.items():
        path = os.path.join(args.src, fname)
        if not os.path.exists(path):
            print(f"WARN missing source: {path}", file=sys.stderr)
            workbooks[logical] = {}
            continue
        wb = load(path)
        workbooks[logical] = wb
        wb_counts[fname] = ", ".join(f"{k} ({len(v)})" for k, v in wb.items() if v)[:300]

    data = build(workbooks, args.proxy)
    master = to_master_rows(data)

    xlsx_path = os.path.join(args.out, "Operational_Master.xlsx")
    write_xlsx(xlsx_path, master)
    report = coverage_md(data, master, args, wb_counts)
    with open(os.path.join(args.out, "coverage-report.md"), "w") as f:
        f.write(report)

    # round-trip validation
    rt = load(xlsx_path)
    print("Wrote", xlsx_path)
    print("Round-trip sheets:", {k: len(v) for k, v in rt.items()})
    print()
    print(report)


if __name__ == "__main__":
    main()
