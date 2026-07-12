#!/usr/bin/env python3
import json
import posixpath
import sys
from zipfile import ZipFile
from xml.etree import ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
REL_NS = {"rel": "http://schemas.openxmlformats.org/package/2006/relationships"}


def cell_ref_to_col(ref):
    col = "".join(ch for ch in ref if ch.isalpha())
    n = 0
    for ch in col:
        n = n * 26 + ord(ch.upper()) - 64
    return n


def load_shared_strings(zip_file):
    if "xl/sharedStrings.xml" not in zip_file.namelist():
        return []
    root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    strings = []
    for si in root.findall("a:si", NS):
        strings.append("".join((t.text or "") for t in si.findall(".//a:t", NS)))
    return strings


def load_workbook(path):
    with ZipFile(path) as zip_file:
        shared = load_shared_strings(zip_file)
        workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
        rels = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
        relmap = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels.findall("rel:Relationship", REL_NS)
        }
        output = {}
        for sheet in workbook.find("a:sheets", NS).findall("a:sheet", NS):
            name = sheet.attrib["name"]
            rid = sheet.attrib[
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            ]
            # Relationship targets may be relative ("worksheets/sheet1.xml")
            # or package-absolute ("/xl/worksheets/sheet1.xml"). Normalize both
            # forms without ever producing the invalid "xl//xl/..." path.
            target = relmap[rid].lstrip("/")
            if not target.startswith("xl/"):
                target = posixpath.normpath(posixpath.join("xl", target))
            root = ET.fromstring(zip_file.read(target))
            raw_rows = []
            for row in root.findall("a:sheetData/a:row", NS):
                values = {}
                for cell in row.findall("a:c", NS):
                    col = cell_ref_to_col(cell.attrib.get("r", ""))
                    cell_type = cell.attrib.get("t")
                    value_node = cell.find("a:v", NS)
                    inline_node = cell.find("a:is", NS)
                    value = ""
                    if cell_type == "s" and value_node is not None and value_node.text is not None:
                        index = int(value_node.text)
                        value = shared[index] if index < len(shared) else ""
                    elif cell_type == "inlineStr" and inline_node is not None:
                        value = "".join((t.text or "") for t in inline_node.findall(".//a:t", NS))
                    elif value_node is not None and value_node.text is not None:
                        value = value_node.text
                    value = str(value).strip()
                    if value:
                        values[col] = value
                if values:
                    raw_rows.append(values)
            if not raw_rows:
                continue
            max_col = max(max(row.keys()) for row in raw_rows)
            headers = [raw_rows[0].get(col, "").strip() or f"Column {col}" for col in range(1, max_col + 1)]
            rows = []
            for raw in raw_rows[1:]:
                rows.append({headers[col - 1]: raw.get(col, "").strip() for col in range(1, max_col + 1)})
            output[name] = rows
        return output


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: parse-database-xlsx.py <xlsx-path>", file=sys.stderr)
        sys.exit(1)
    json.dump(load_workbook(sys.argv[1]), sys.stdout)
