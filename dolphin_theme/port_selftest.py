"""EVERY PORT SCREEN, CHECKED AGAINST ITSELF, WITH REAL EXAMPLES.

22 Aug 2026. His words: "after implementing check page by page port and stock
reconcilation, dc to dc shipping agency arrivals etc if you dont check I need to
send screen shots one by one" and "check all the logic by many examples trial and
error method only then you will know the flaws and improvisation required".

So this module opens every screen the way the page does - by calling the very same
functions the page calls - and then asks of the result the questions he would ask
looking at it. Nothing here writes anything, ever. `report()` is safe to run on the
live site at any time, and each failing check hands back real block numbers and
challan names, not a count, so a flaw can be opened and looked at.

The checks, in his order:

  PORT & STOCK        a number on the page is a block number, never a record id
                      the block behind the row answers to the number shown
                      no number is ambiguous - one number, one block
  DRAFT CHALLANS      a draft challan is permit paperwork; nothing on it reaches
                      the port, on any screen
  RECONCILIATION      the tonne tolerance is applied where the weight is real,
                      and nothing inside a tonne is left waiting for a person
  DC TO DC            the verdict and the blocks under it tell the same story
  STOCK AT PORT       every block in the register got there with evidence
  SHIPMENT LOTS       a block in a lot is at the port, and is in one lot only
"""

import frappe

from dolphin_theme.block_resolve import _s


def _cap(seq, n=20):
    seq = list(seq)
    return {"count": len(seq), "examples": seq[:n]}


def _check(key, title, ok, detail=None, fix=None):
    out = {"check": key, "title": title, "ok": bool(ok)}
    if detail is not None:
        out["detail"] = detail
    if not ok and fix:
        out["what_it_means"] = fix
    return out


# --------------------------------------------------------------------------
# PORT & STOCK - identity
# --------------------------------------------------------------------------
def _identity_checks():
    from dolphin_theme import api_arrivals as A

    blocks = frappe.get_all("Quarry Block",
                            fields=["name", "block_number", "export_block_no"],
                            limit_page_length=0)
    ids = {_s(b.name) for b in blocks}
    numbers = {}
    for b in blocks:
        for f in ("block_number", "export_block_no"):
            v = _s(b.get(f))
            if v:
                numbers.setdefault(v, set()).add(_s(b.name))

    # 1. a number that is also somebody's record id - the whole root cause
    ambiguous = sorted(n for n in numbers if n in ids and n not in numbers.get(n, set()))

    rows = A.ledger_view() or []
    if isinstance(rows, dict):
        rows = rows.get("rows") or []

    shows_id, wrong_owner, blank = [], [], []
    for r in rows:
        shown = _s(r.get("export_block_no") or r.get("block_no"))
        rec = _s(r.get("qb"))
        if not shown:
            blank.append(rec or "(row with no number at all)")
            continue
        if shown in ids and shown not in numbers:
            shows_id.append(shown)
        if rec:
            owner = numbers.get(shown) or set()
            if owner and rec not in owner:
                wrong_owner.append({"shown": shown, "record": rec,
                                    "number_belongs_to": sorted(owner)})

    return [
        _check("identity.no_record_ids_on_page",
               "Port & Stock shows block numbers, never record ids",
               not shows_id, _cap(shows_id),
               "A row is showing an internal id in place of a block number."),
        _check("identity.row_matches_its_block",
               "The block behind each row answers to the number shown",
               not wrong_owner, _cap(wrong_owner),
               "A row shows one number while pointing at a different block."),
        _check("identity.every_row_has_a_number",
               "No row reaches the page without a number",
               not blank, _cap(blank),
               "A row with no number cannot be acted on and must not be listed."),
        _check("identity.numbers_are_unambiguous",
               "No number is also some other block's record id",
               not ambiguous, _cap(ambiguous, 40),
               "Until the seven-digit rename is run these numbers can be read two "
               "ways. block_rename.run(confirm=\"YES\", limit=N) fixes it."),
    ]


# --------------------------------------------------------------------------
# DRAFT CHALLANS - strict, everywhere
# --------------------------------------------------------------------------
def _draft_checks():
    from dolphin_theme import api_arrivals as A

    draft_dcs = set(frappe.get_all("Delivery Challan", filters={"docstatus": 0},
                                   pluck="name"))
    submitted = set(frappe.get_all("Delivery Challan", filters={"docstatus": 1},
                                   pluck="name"))

    on_draft, on_submitted = {}, set()
    if draft_dcs or submitted:
        for r in frappe.get_all("DC Block Row",
                                filters={"parenttype": "Delivery Challan"},
                                fields=["parent", "block", "block_no",
                                        "export_block_no"],
                                limit_page_length=0):
            keys = {_s(r.block), _s(r.block_no), _s(r.export_block_no)} - {""}
            if r.parent in submitted:
                on_submitted |= keys
            elif r.parent in draft_dcs:
                for k in keys:
                    on_draft.setdefault(k, r.parent)

    # only-on-a-draft blocks: they have not been dispatched at all
    only_draft = {k: v for k, v in on_draft.items() if k not in on_submitted}

    rows = A.ledger_view() or []
    if isinstance(rows, dict):
        rows = rows.get("rows") or []
    # A draft-only block on the page is a fault ONLY when nothing else puts it
    # there. Two things legitimately do, and hiding either would hide something
    # worse than it shows:
    #   * the agency says it arrived - our paperwork and theirs disagree, and that
    #     disagreement is exactly what a person needs to see
    #   * it is already in a shipment lot
    leaked, contradiction = [], []
    for r in rows:
        hit = None
        for k in (_s(r.get("export_block_no")), _s(r.get("block_no")),
                  _s(r.get("qb"))):
            if k and k in only_draft:
                hit = k
                break
        if not hit:
            continue
        item = {"block": hit, "draft_challan": only_draft[hit],
                "arrival": _s(r.get("arrival")), "lot": _s(r.get("lot")),
                "shown_as": _s(r.get("state"))}
        if r.get("arrival") or r.get("lot"):
            contradiction.append(item)
        else:
            leaked.append(item)

    # the DC-to-DC screen must not list a draft challan at all
    dcd = A.dc_weight_check_v2() or {}
    listed = {_s(c.get("dc")) for c in (dcd.get("detail") or [])}
    dcd_leak = sorted(listed & draft_dcs)

    return [
        _check("draft.not_on_port_and_stock",
               "A block that is only on a draft challan is not listed at the port",
               not leaked, _cap(leaked),
               "A draft challan is DMG paperwork. These blocks have not left."),
        _check("draft.our_paperwork_agrees_with_theirs",
               "No block where the agency says arrived and our challan is still a draft",
               not contradiction, _cap(contradiction),
               "Not an app fault - a real disagreement. The agency has these at the "
               "port while our challan for them was never submitted. Either submit "
               "the challan or ask the agency which block they actually received."),
        _check("draft.not_in_dc_to_dc",
               "DC to DC compares submitted challans only",
               not dcd_leak, _cap(dcd_leak),
               "A draft challan has no dispatch to compare against."),
        _check("draft.counted",
               "Draft challans on the site right now",
               True, {"draft_challans": len(draft_dcs),
                      "blocks_only_on_a_draft": len(only_draft)}),
    ]


# --------------------------------------------------------------------------
# RECONCILIATION - the tonne rule
# --------------------------------------------------------------------------
def _tolerance_checks():
    from dolphin_theme import api_arrivals as A

    rows = A.ledger_view() or []
    if isinstance(rows, dict):
        rows = rows.get("rows") or []
    g = A._classify_for_auto(rows)
    bad_dc = A._challans_out_of_tolerance(rows)

    # nothing inside the tonne should be sitting in "conflict" for weight reasons
    held_inside_tol = []
    for r in g["conflict"]:
        if _s(r.get("dc")) in bad_dc:
            continue
        if A._size_conflict(r):
            continue
        held_inside_tol.append({
            "block": _s(r.get("export_block_no") or r.get("block_no")),
            "dc": _s(r.get("dc")),
            "why": "no challan and no port row - cannot be settled by the app",
        })

    # and nothing OUTSIDE the tonne should have slipped into verified
    out_but_verified = [
        _s(r.get("export_block_no") or r.get("block_no"))
        for r in g["verified"] if _s(r.get("dc")) in bad_dc
    ]

    return [
        _check("tolerance.inside_a_tonne_is_matched",
               "Nothing inside one tonne is left waiting for a person",
               not [h for h in held_inside_tol if h.get("dc")],
               _cap(held_inside_tol),
               "A block on a challan inside tolerance should be settleable."),
        _check("tolerance.outside_a_tonne_never_auto",
               "Nothing outside one tonne is settled by the app",
               not out_but_verified, _cap(out_but_verified),
               "This is the expensive mistake - a block auto-moved on a bad weight."),
        _check("tolerance.summary",
               "What the app would settle right now",
               True, {"verified": len(g["verified"]),
                      "no_conflict_agency_silent": len(g["noconflict"]),
                      "needs_a_person": len(g["conflict"]),
                      "already_settled": len(g["settled"]),
                      "challans_out_of_tolerance": sorted(bad_dc)[:20],
                      "tolerance_mt": A.AUTO_TOL_MT}),
    ]


# --------------------------------------------------------------------------
# DC TO DC - the verdict and the blocks must agree
# --------------------------------------------------------------------------
def _dc_to_dc_checks():
    from dolphin_theme import api_arrivals as A

    d = A.dc_weight_check_v2() or {}
    detail = d.get("detail") or []

    # THE CHECK THAT WOULD HAVE CAUGHT IT. 23 Aug 2026.
    #
    # His words: "a Dc cannot be partially received ... practically once a truck
    # unloads all the blocks in the Dc should be there it cannot miss so easily
    # since each block weigh in tons". He was right, and the screen was wrong: 81
    # of the 110 blocks it called "never sent by the agency" were sitting on the
    # agency's sheet under the very same digits.
    #
    # So: take every number the screen reports as unmatched, and simply look for
    # those digits on the sheets. If they are there, the fault is ours.
    on_sheet = set()
    for r in frappe.get_all("Port Arrival Block", fields=["block_no"],
                            limit_page_length=0):
        v = _s(r.get("block_no"))
        if v:
            on_sheet.add(v)
    ours_not_theirs = []
    for c in detail:
        for u in (c.get("unmatched") or []):
            if _s(u) in on_sheet:
                ours_not_theirs.append({"block": _s(u), "dc": _s(c.get("dc"))})

    JUDGED = ("FLAG", "Agrees")
    contradictions, draft_judged, mixed_judged, wrong_count = [], [], [], []
    for c in detail:
        verdict = _s(c.get("verdict"))
        per = c.get("per_block") or []
        on_sheet = [b for b in per if b.get("sheet")]
        dc = _s(c.get("dc"))

        # THE screen he caught: a tonnage gap quoted while the blocks under it
        # say they were never received. A verdict needs every block on a sheet.
        if verdict in JUDGED and len(on_sheet) != len(per):
            contradictions.append({"dc": dc, "verdict": verdict,
                                   "blocks_on_a_sheet": len(on_sheet),
                                   "blocks_on_challan": len(per),
                                   "difference": c.get("difference")})
        # a verdict may never rest on an unsubmitted sheet
        if verdict in JUDGED and c.get("any_draft_sheet"):
            draft_judged.append(dc)
        # nor on rows gathered from several sheets
        if verdict in JUDGED and len(c.get("sheets") or []) > 1:
            mixed_judged.append({"dc": dc, "sheets": c.get("sheets")})
        # the header count and the rows under it must be the same number
        if c.get("agency_rows") != len(on_sheet):
            wrong_count.append({"dc": dc, "header_says": c.get("agency_rows"),
                                "rows_under_it": len(on_sheet)})

    return [
        _check("dctodc.never_blames_the_agency_for_our_matching",
               "Nothing is called 'not sent' while its number sits on their sheet",
               not ours_not_theirs, _cap(ours_not_theirs, 30),
               "These numbers ARE on the agency's sheets. Saying the agency did "
               "not send them sends the team chasing a fault that is ours."),
        _check("dctodc.verdict_agrees_with_blocks",
               "A weight verdict is only given when every block under it was received",
               not contradictions, _cap(contradictions),
               "This is the screen he caught: a gap quoted while the same screen "
               "said the blocks were never received."),
        _check("dctodc.verdict_never_rests_on_a_draft_sheet",
               "No verdict is given from an unconfirmed arrival sheet",
               not draft_judged, _cap(draft_judged),
               "A draft sheet is not a weighing."),
        _check("dctodc.verdict_never_mixes_sheets",
               "No verdict is given from rows spread across several sheets",
               not mixed_judged, _cap(mixed_judged),
               "Two sheets can double-count or half-count the same truck."),
        _check("dctodc.header_matches_rows",
               "The count in the header is the count of rows under it",
               not wrong_count, _cap(wrong_count),
               "The summary line and the expanded rows disagree."),
        _check("dctodc.summary", "DC to DC as it stands", True,
               {"agree": d.get("agree"), "flagged": d.get("flagged"),
                "no_verdict": d.get("incomplete"),
                "never_sent": d.get("agency_never_sent"),
                "challans_compared": len(detail)}),
    ]


# --------------------------------------------------------------------------
# STOCK AT PORT - a register, and only a register
# --------------------------------------------------------------------------
def _at_port_checks():
    from dolphin_theme import api_arrivals as A

    rows = A.ledger_view() or []
    if isinstance(rows, dict):
        rows = rows.get("rows") or []
    at_port = [r for r in rows if _s(r.get("state")) in ("port", "recon", "ready")]

    no_evidence = []
    for r in at_port:
        has_arrival = bool(r.get("arrival"))
        has_port_figures = any(r.get(k) for k in ("pt_l", "pt_w", "pt_h",
                                                  "pt_cbm", "net_wt"))
        if not has_arrival and not has_port_figures:
            no_evidence.append(_s(r.get("export_block_no") or r.get("block_no")))

    return [
        _check("atport.every_block_got_here_with_evidence",
               "Every block in the register arrived on an arrival row or a push",
               not no_evidence, _cap(no_evidence),
               "A block at the port with no arrival row and no port figures was "
               "moved with nothing behind it."),
        _check("atport.summary", "The register", True,
               {"blocks_at_port_or_beyond": len(at_port)}),
    ]


# --------------------------------------------------------------------------
# SHIPMENT LOTS
# --------------------------------------------------------------------------
def _lot_checks():
    from dolphin_theme import api_arrivals as A

    rows = A.ledger_view() or []
    if isinstance(rows, dict):
        rows = rows.get("rows") or []
    state, evidence = {}, {}
    for r in rows:
        for k in (_s(r.get("export_block_no")), _s(r.get("block_no"))):
            if k:
                state.setdefault(k, _s(r.get("state")))
                evidence.setdefault(k, bool(r.get("arrival")))

    seen, twice, no_evidence, unconfirmed = {}, [], [], []
    for l in (A.lots_view() or []):
        lot = _s(l.get("name"))
        for b in (l.get("block_nos") or []):
            bn = _s(b)
            if not bn:
                continue
            if bn in seen and seen[bn] != lot:
                twice.append({"block": bn, "lots": [seen[bn], lot]})
            seen[bn] = lot
            st = state.get(bn)
            if st in ("await", "unconfirmed"):
                # An unconfirmed sheet is a missing signature, not a missing block.
                # Separate the two so a real gap is never buried under a paperwork one.
                (unconfirmed if evidence.get(bn) else no_evidence).append(
                    {"block": bn, "lot": lot, "state": st})

    return [
        _check("lots.one_lot_per_block", "No block is in two lots",
               not twice, _cap(twice),
               "The same block cannot be shipped twice."),
        _check("lots.only_blocks_the_port_has_seen",
               "No block sits in a lot with nothing saying it ever arrived",
               not no_evidence, _cap(no_evidence),
               "A lot is built from Stock at Port - a block with no arrival row "
               "at all has no business in one."),
        _check("lots.blocks_waiting_on_a_confirmed_sheet",
               "Every block in a lot rests on a confirmed arrival sheet",
               not unconfirmed, _cap(unconfirmed),
               "The agency did send these, but the sheet has not been confirmed on "
               "the Arrivals tab. Confirm the sheet and they settle."),
    ]


@frappe.whitelist()
def report():
    """Run every check. Reads only - changes nothing at all."""
    groups = [
        ("Port & Stock", _identity_checks),
        ("Draft challans", _draft_checks),
        ("Reconciliation", _tolerance_checks),
        ("DC to DC", _dc_to_dc_checks),
        ("Stock at Port", _at_port_checks),
        ("Shipment Lots", _lot_checks),
    ]
    out, failed, ran = [], 0, 0
    for title, fn in groups:
        try:
            checks = fn()
        except Exception as e:
            out.append({"screen": title, "error": _s(e),
                        "traceback": frappe.get_traceback()[-1500:]})
            failed += 1
            continue
        bad = [c for c in checks if not c["ok"]]
        ran += len(checks)
        failed += len(bad)
        out.append({"screen": title, "checks": checks,
                    "failing": [c["check"] for c in bad]})
    return {"ran": ran, "failing": failed, "screens": out,
            "changed_anything": False}
